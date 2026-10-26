// test/panel/settings-screens.test.mjs
// T9 integration test for SCREENS phase:
// 1. Verifies runtime helper bind('<key>') reads value, schema (min/max/options), and saves nested patch.
// 2. Verifies General screen renders fixture snapshot with non-default values shown.
// 3. Verifies General screen displays migrationNotes when present.
// 4. Verifies General screen controls save one change as the right nested patch.
// 5. Verifies General screen Reset and Export buttons call C4 actions.
// 6. Verifies dev-snapshot-server handles settings.reset, settings.export, ui.remember, and notify.test.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createDevServer } from '../../scripts/dev-snapshot-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Settings screens integration tests (T9)', () => {
  let devServer;
  let chromeProcess;
  let userDataDir;
  let ws;

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
    // 1. Start dev-snapshot-server
    devServer = await createDevServer({ verbose: false });

    // 2. Launch Chrome headless with CDP
    userDataDir = mkdtempSync(join(tmpdir(), 'chrome-settings-t9-'));
    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    chromeProcess = spawn(chromePath, [
      '--headless',
      '--remote-debugging-port=0',
      '--user-data-dir=' + userDataDir,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    // Wait for DevToolsActivePort
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

    // 3. Connect WebSocket to page target
    const targetsRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const targets = await targetsRes.json();
    const pageTarget = targets.find((t) => t.type === 'page');
    assert.ok(pageTarget && pageTarget.webSocketDebuggerUrl, 'No page target found in Chrome');

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    await sendCDP('Page.enable');
    await sendCDP('Runtime.enable');

    // Navigate to dashboard
    await sendCDP('Page.navigate', { url: devServer.url });
    await new Promise((r) => setTimeout(r, 800));

    const title = await evaluate('document.title');
    assert.equal(title, 'MatrixKoder', 'Dashboard title should be MatrixKoder');
  });

  after(async () => {
    try {
      if (ws) ws.close();
    } catch (_) {}

    try {
      if (chromeProcess && !chromeProcess.killed) {
        chromeProcess.kill('SIGTERM');
      }
    } catch (_) {}

    try {
      if (userDataDir) {
        rmSync(userDataDir, { recursive: true, force: true });
      }
    } catch (_) {}

    try {
      if (devServer) {
        await devServer.close();
      }
    } catch (_) {}
  });

  test('runtime helper bind("<key>") reads value, schema (min/max/options) and saves nested patch', async () => {
    // Read an int setting
    const intBind = await evaluate(`(() => {
      const b = window.MK_BIND('general.undoSeconds');
      return {
        key: b.key,
        val: b.val,
        min: b.min,
        max: b.max,
        type: b.type,
      };
    })()`);

    assert.equal(intBind.key, 'general.undoSeconds');
    assert.equal(intBind.val, 15);
    assert.equal(intBind.min, 0);
    assert.equal(intBind.max, 60);
    assert.equal(intBind.type, 'int');

    // Read an enum setting
    const enumBind = await evaluate(`(() => {
      const b = window.MK_BIND('general.openOnStart');
      return {
        key: b.key,
        val: b.val,
        options: b.options,
        type: b.type,
      };
    })()`);

    assert.equal(enumBind.key, 'general.openOnStart');
    assert.equal(enumBind.val, 'lanes');
    assert.deepEqual(enumBind.options, ['projects', 'lanes', 'waiting', 'plan', 'last']);
    assert.equal(enumBind.type, 'enum');

    // Save one key as a nested patch
    devServer.actions.length = 0;
    await evaluate(`(() => {
      const b = window.MK_BIND('general.undoSeconds');
      b.save(25);
    })()`);
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(devServer.actions.length, 1);
    assert.equal(devServer.actions[0]?.name, 'settings.save');
    assert.deepEqual(devServer.actions[0]?.args, { patch: { general: { undoSeconds: 25 } } });
  });

  test('General screen renders fixture snapshot with non-default values shown', async () => {
    await evaluate('window.MK.go("Settings")');
    await new Promise((r) => setTimeout(r, 200));

    const vals = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Settings"]');
      if (!host || !host.shadowRoot) return null;
      const text = host.shadowRoot.textContent || '';
      return {
        hasOpenOnStart: text.includes('lanes'),
        hasUndoSeconds: text.includes('15s'),
        hasSnoozeMinutes: text.includes('30m'),
        hasBackupKeep: text.includes('14'),
        hasGoneDays: text.includes('60d'),
        hasDecisionDays: text.includes('120d'),
        hasEventMax: text.includes('10000'),
        hasFastSeconds: text.includes('15s'),
        hasSlowSeconds: text.includes('90s'),
        hasFilesSeconds: text.includes('45s'),
      };
    })()`);

    assert.ok(vals, 'Settings host and shadowRoot must exist');
    assert.equal(vals.hasOpenOnStart, true, 'openOnStart value "lanes" must be shown');
    assert.equal(vals.hasUndoSeconds, true, 'undoSeconds value "15s" must be shown');
    assert.equal(vals.hasSnoozeMinutes, true, 'snoozeMinutes value "30m" must be shown');
    assert.equal(vals.hasBackupKeep, true, 'backupKeep value "14" must be shown');
    assert.equal(vals.hasGoneDays, true, 'goneDays value "60d" must be shown');
    assert.equal(vals.hasDecisionDays, true, 'decisionDays value "120d" must be shown');
    assert.equal(vals.hasEventMax, true, 'eventMax value "10000" must be shown');
    assert.equal(vals.hasFastSeconds, true, 'fastSeconds value "15s" must be shown');
    assert.equal(vals.hasSlowSeconds, true, 'slowSeconds value "90s" must be shown');
    assert.equal(vals.hasFilesSeconds, true, 'filesSeconds value "45s" must be shown');
  });

  test('General screen displays migrationNotes when present', async () => {
    await evaluate('window.MK.go("Settings")');
    await new Promise((r) => setTimeout(r, 150));

    const noteCheck = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Settings"]');
      if (!host || !host.shadowRoot) return { found: false };
      const sec = host.shadowRoot.querySelector('section[aria-label="Migration notes"]');
      if (!sec) return { found: false };
      return {
        found: true,
        text: sec.textContent || '',
      };
    })()`);

    assert.equal(noteCheck.found, true, 'Migration notes section should be present');
    assert.ok(
      noteCheck.text.includes('migrated routing.spareClaudeBelowPct'),
      'Migration note text should be rendered'
    );
  });

  test('General screen controls save changes as nested patches', async () => {
    devServer.actions.length = 0;
    await evaluate('window.MK.go("Settings")');
    await new Promise((r) => setTimeout(r, 150));

    // Click Increase undo window button
    const clickResult = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Settings"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Increase undo window"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);

    assert.equal(clickResult, true, 'Button Increase undo window must be clickable');

    let foundAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        foundAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.ok(foundAction, 'Expected action to be received by devServer');
    assert.equal(foundAction.name, 'settings.save');
    assert.deepEqual(foundAction.args, { patch: { general: { undoSeconds: 16 } } });
  });

  test('General screen Reset and Export buttons call C4 actions', async () => {
    await evaluate('window.MK.go("Settings")');
    await new Promise((r) => setTimeout(r, 150));

    // 1. Export button
    devServer.actions.length = 0;
    const exportClicked = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Settings"]');
      if (!host || !host.shadowRoot) return false;
      const btns = Array.from(host.shadowRoot.querySelectorAll('button.btn'));
      const expBtn = btns.find((b) => b.textContent.trim() === 'Export');
      if (!expBtn) return false;
      expBtn.click();
      return true;
    })()`);

    assert.equal(exportClicked, true, 'Export button must be found and clickable');

    let expAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        expAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(expAction, 'settings.export action must be posted');
    assert.equal(expAction.name, 'settings.export');

    // 2. Reset button
    devServer.actions.length = 0;
    const resetClicked = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Settings"]');
      if (!host || !host.shadowRoot) return false;
      const btns = Array.from(host.shadowRoot.querySelectorAll('button.btn'));
      const resetBtn = btns.find((b) => b.textContent.trim() === 'Reset');
      if (!resetBtn) return false;
      resetBtn.click();
      return true;
    })()`);

    assert.equal(resetClicked, true, 'Reset button must be found and clickable');

    let resetAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        resetAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(resetAction, 'settings.reset action must be posted');
    assert.equal(resetAction.name, 'settings.reset');
    assert.deepEqual(resetAction.args, { section: 'general' });
  });

  test('dev-snapshot-server handles settings.reset, settings.export, ui.remember, and notify.test', async () => {
    // settings.export
    const expRes = await fetch(`${devServer.url.split('/?')[0]}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mk-token': devServer.token },
      body: JSON.stringify({ name: 'settings.export', args: {} }),
    });
    const expJson = await expRes.json();
    assert.equal(expRes.status, 200);
    assert.equal(expJson.ok, true);
    assert.ok(expJson.settings && typeof expJson.settings === 'object');

    // settings.reset
    const resetRes = await fetch(`${devServer.url.split('/?')[0]}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mk-token': devServer.token },
      body: JSON.stringify({ name: 'settings.reset', args: { section: 'general' } }),
    });
    const resetJson = await resetRes.json();
    assert.equal(resetRes.status, 200);
    assert.equal(resetJson.ok, true);
    assert.equal(resetJson.section, 'general');

    // ui.remember
    const uiRes = await fetch(`${devServer.url.split('/?')[0]}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mk-token': devServer.token },
      body: JSON.stringify({ name: 'ui.remember', args: { screen: 'lanes' } }),
    });
    const uiJson = await uiRes.json();
    assert.equal(uiRes.status, 200);
    assert.equal(uiJson.ok, true);
    assert.equal(uiJson.screen, 'lanes');

    // notify.test stub
    const notifyRes = await fetch(`${devServer.url.split('/?')[0]}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mk-token': devServer.token },
      body: JSON.stringify({ name: 'notify.test', args: {} }),
    });
    const notifyJson = await notifyRes.json();
    assert.equal(notifyRes.status, 409);
    assert.equal(notifyJson.ok, false);
    assert.equal(notifyJson.error?.code, 'not_ready');
  });
});
