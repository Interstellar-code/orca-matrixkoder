// test/panel/contract.test.mjs
// Contract test:
// 1. Scans panel/screens/*.dc.html to verify every this.action('<name>', ...) is in ACTION_NAMES.
// 2. Starts the REAL server against a temp data dir with stubbed Orca runner, stubbed cliOrca, and loops: false.
// 3. Drives todo add -> todo done -> todo makeTask (seeded plan phase), bug add, settings save, and inbox action
//    through the built page in headless Chrome and asserts rows changed in mk-data.db.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { startService, ACTION_NAMES } from '../../out/server/index.js';
import { openDb } from '../../out/store/db.js';
import { settingsPath } from '../../out/store/settings.js';
import { scanInbox } from '../../out/store/import.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const screensDir = join(root, 'panel', 'screens');
const webDir = join(root, 'web');
const REAL_PLAN = join(root, '.matrixkoder', 'inbox', 'orca-dashboard-wiring.md');

test('every screen this.action() call uses an action name in ACTION_NAMES', () => {
  const files = readdirSync(screensDir).filter((f) => f.endsWith('.dc.html')).sort();
  assert.ok(files.length >= 16, 'Expected 16 screens');

  const knownNames = new Set(ACTION_NAMES);
  const violations = [];

  for (const file of files) {
    const content = readFileSync(join(screensDir, file), 'utf8');
    // Match this.action('...', ...) or this.action("...", ...)
    const actionRegex = /this\.action\(\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = actionRegex.exec(content)) !== null) {
      const actionName = match[1];
      if (!knownNames.has(actionName)) {
        violations.push({ file, actionName });
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found invalid this.action() names not in ACTION_NAMES: ${JSON.stringify(violations, null, 2)}`
  );
});

describe('Live contract tests in headless Chrome against real server', () => {
  let tempDir;
  let repoDir;
  let svc;
  let runnerCalls = [];
  let cliCalls = [];
  let chromeProcess;
  let userDataDir;
  let ws;
  let consoleErrors = [];

  function sendCDP(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 10000000);
      const handler = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const res = await sendCDP('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }

  before(async () => {
    // 1. Temp dir for data and repo
    tempDir = mkdtempSync(join(tmpdir(), 'mk-contract-data-'));
    repoDir = mkdtempSync(join(tmpdir(), 'mk-contract-repo-'));

    // Copy plan file into repo's inbox
    const inboxDir = join(repoDir, '.matrixkoder', 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    copyFileSync(REAL_PLAN, join(inboxDir, 'orca-dashboard-wiring.md'));

    // Seed database with repo, plan, and phase (so todo.makeTask can succeed)
    const db = openDb(tempDir);
    const now = Date.now();
    db.prepare('INSERT INTO repo (id, path, display_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
      'repo-contract-1',
      repoDir,
      'contract-repo',
      now,
      now
    );
    db.prepare('INSERT INTO plan (id, repo_id, slug, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      1,
      'repo-contract-1',
      'contract-plan',
      'Contract Test Plan',
      'imported',
      now,
      now
    );
    db.prepare('INSERT INTO plan_phase (id, plan_id, ord, wave, code, title) VALUES (?, ?, ?, ?, ?, ?)').run(
      1,
      1,
      1,
      1,
      'PH1',
      'Phase 1'
    );
    scanInbox(db, { repoId: 'repo-contract-1', repoPath: repoDir });
    db.close();

    // 2. Start the REAL server
    runnerCalls = [];
    cliCalls = [];
    const stubRunner = async (argv) => {
      runnerCalls.push(argv);
      const key = `${argv[0]} ${argv[1]}`;
      if (key === 'orchestration run-create') return { stdout: JSON.stringify({ ok: true, result: { run: { id: 'run_1' } } }), exitCode: 0 };
      if (key === 'orchestration task-create') return { stdout: JSON.stringify({ ok: true, result: { task: { id: 'task_1' } } }), exitCode: 0 };
      if (key === 'orchestration worker-start') return { stdout: JSON.stringify({ ok: true, result: { dispatch: { id: 'dsp_1' } } }), exitCode: 0 };
      return { stdout: JSON.stringify({ ok: true }), exitCode: 0 };
    };
    runnerCalls.calls = runnerCalls;

    const stubCli = (args) => {
      cliCalls.push(args);
      if (args[1] === 'run-create') return JSON.stringify({ ok: true, result: { run: { id: 'run_cli_1' } } });
      if (args[1] === 'task-create') return JSON.stringify({ ok: true, result: { task: { id: 'task_cli_1' } } });
      return JSON.stringify({ ok: true });
    };

    svc = await startService({
      dir: tempDir,
      webDir,
      loops: false,
      runner: stubRunner,
      cliOrca: stubCli,
      log: () => {},
    });

    // 3. Launch Chrome headless with CDP
    userDataDir = mkdtempSync(join(tmpdir(), 'chrome-contract-'));
    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    chromeProcess = spawn(
      chromePath,
      [
        '--headless',
        '--remote-debugging-port=0',
        '--user-data-dir=' + userDataDir,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        'about:blank',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let cdpPort = 0;
    for (let i = 0; i < 60; i++) {
      try {
        const portFile = readFileSync(join(userDataDir, 'DevToolsActivePort'), 'utf8');
        const lines = portFile.split('\n');
        cdpPort = parseInt(lines[0], 10);
        if (cdpPort) break;
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(cdpPort > 0, 'Headless Chrome failed to write DevToolsActivePort');

    const targetsRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const targets = await targetsRes.json();
    const pageTarget = targets.find((t) => t.type === 'page');
    assert.ok(pageTarget && pageTarget.webSocketDebuggerUrl, 'No page target found in Chrome');

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
      }
    });

    await sendCDP('Page.enable');
    await sendCDP('Runtime.enable');

    // Navigate to real dashboard page
    await sendCDP('Page.navigate', { url: svc.url });
    await new Promise((r) => setTimeout(r, 800));
  });

  after(async () => {
    try { if (ws) ws.close(); } catch (_) {}
    try { if (chromeProcess && !chromeProcess.killed) chromeProcess.kill('SIGTERM'); } catch (_) {}
    try { if (userDataDir) rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
    try { if (svc) await svc.close(); } catch (_) {}
    try { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    try { if (repoDir) rmSync(repoDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('drive todo add -> todo done -> todo makeTask through UI against real server', async () => {
    await evaluate('window.MK.go("Todo")');
    await new Promise((r) => setTimeout(r, 200));

    // 1. Add todo
    await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Todo"]');
      const input = host.shadowRoot.querySelector('#tq');
      input.value = "Verify contract test";
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const addBtn = host.shadowRoot.querySelector('button.btn.pri');
      addBtn.click();
    })()`);

    // Poll DB for todo row
    const db = openDb(tempDir);
    let todoRow = null;
    for (let i = 0; i < 30; i++) {
      todoRow = db.prepare('SELECT * FROM todo WHERE text = ?').get('Verify contract test');
      if (todoRow) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(todoRow, 'Todo item "Verify contract test" should be inserted in mk-data.db');
    assert.equal(todoRow.done, 0);

    // Refresh UI
    await evaluate('window.MK.refresh()');
    await new Promise((r) => setTimeout(r, 200));

    // 2. Mark todo done
    await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Todo"]');
      const row = host.shadowRoot.querySelector('.item');
      const chk = row.querySelector('input[type="checkbox"]');
      chk.click();
    })()`);

    let doneRow = null;
    for (let i = 0; i < 30; i++) {
      doneRow = db.prepare('SELECT * FROM todo WHERE id = ?').get(todoRow.id);
      if (doneRow && doneRow.done === 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(doneRow && doneRow.done === 1, 'Todo item should be updated to done=1 in mk-data.db');

    // 3. Add second todo and make task from it
    await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Todo"]');
      const input = host.shadowRoot.querySelector('#tq');
      input.value = "Todo to make task";
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const addBtn = host.shadowRoot.querySelector('button.btn.pri');
      addBtn.click();
    })()`);

    let todo2Row = null;
    for (let i = 0; i < 30; i++) {
      todo2Row = db.prepare('SELECT * FROM todo WHERE text = ?').get('Todo to make task');
      if (todo2Row) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(todo2Row, 'Todo2 should be inserted in mk-data.db');

    await evaluate('window.MK.refresh()');
    await new Promise((r) => setTimeout(r, 200));

    // Click Make task on the second todo item
    const clicked = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Todo"]');
      const btns = Array.from(host.shadowRoot.querySelectorAll('button.mini:not([disabled])'));
      const makeBtn = btns.find((b) => b.textContent.includes('Make task'));
      if (makeBtn) { makeBtn.click(); return true; }
      return false;
    })()`);
    assert.ok(clicked, 'Make task button should be found and clicked');

    let taskRow = null;
    let deletedTodo = null;
    for (let i = 0; i < 30; i++) {
      taskRow = db.prepare("SELECT * FROM plan_task WHERE origin = 'todo' AND title = ?").get('Todo to make task');
      deletedTodo = db.prepare('SELECT * FROM todo WHERE id = ?').get(todo2Row.id);
      if (taskRow && !deletedTodo) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    db.close();

    assert.ok(taskRow, 'plan_task row with origin="todo" should be inserted in mk-data.db');
    assert.equal(deletedTodo, undefined, 'Original todo row should be removed from mk-data.db');
  });

  test('drive bug add through UI against real server', async () => {
    await evaluate('window.MK.go("Bugs")');
    await new Promise((r) => setTimeout(r, 200));

    await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Bugs"]');
      const input = host.shadowRoot.querySelector('#bugq');
      input.value = "Contract bug test";
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const addBtn = host.shadowRoot.querySelector('button.btn');
      addBtn.click();
    })()`);

    const db = openDb(tempDir);
    let bugRow = null;
    for (let i = 0; i < 30; i++) {
      bugRow = db.prepare('SELECT * FROM bug WHERE title = ?').get('Contract bug test');
      if (bugRow) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    db.close();

    assert.ok(bugRow, 'Bug row should be inserted in mk-data.db');
    assert.equal(bugRow.title, 'Contract bug test');
  });

  test('drive settings save through UI against real server', async () => {
    await evaluate('window.MK.go("Settings")');
    await new Promise((r) => setTimeout(r, 200));

    // Click Solo mode button
    await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Settings"]');
      const soloBtn = host.shadowRoot.querySelectorAll('.segc button')[1];
      soloBtn.click();
    })()`);

    const sp = settingsPath(tempDir);
    let savedMode = null;
    for (let i = 0; i < 30; i++) {
      try {
        const s = JSON.parse(readFileSync(sp, 'utf8'));
        if (s.general && s.general.mode === 'solo') {
          savedMode = s.general.mode;
          break;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 100));
    }

    assert.equal(savedMode, 'solo', 'mk-settings.json should have general.mode = "solo"');
  });

  test('drive inbox action through UI against real server', async () => {
    await evaluate('window.MK.go("Inbox")');
    await new Promise((r) => setTimeout(r, 200));

    // Click Import on the plan file
    await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Inbox"]');
      const impBtn = host.shadowRoot.querySelector('article button.btn.sm.pri');
      if (impBtn) impBtn.click();
    })()`);

    const db = openDb(tempDir);
    let planRow = null;
    for (let i = 0; i < 30; i++) {
      planRow = db.prepare('SELECT * FROM plan WHERE slug = ?').get('orca-dashboard-wiring');
      if (planRow) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    db.close();

    assert.ok(planRow, 'Imported plan row should be in mk-data.db');
  });
});
