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

  // ---- SCREENS.2 tests: SettingsRouting and SettingsWork ----

  test('Routing & Quota screen renders fixture snapshot values and binds settings', async () => {
    await evaluate('window.MK.go("SettingsRouting")');
    await new Promise((r) => setTimeout(r, 200));

    const routingData = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsRouting"]');
      if (!host || !host.shadowRoot) return null;
      const text = host.shadowRoot.textContent || '';
      return {
        hasMaxLanes: text.includes('5'),
        hasClaudeSessionFloor: text.includes('40%'),
        hasClaudeWeeklyFloor: text.includes('30%'),
        hasOthersSessionFloor: text.includes('10%'),
        hasOthersWeeklyFloor: text.includes('15%'),
        hasTrivialRoute: text.includes('claude haiku low'),
        hasStandardRoute: text.includes('claude sonnet medium'),
        hasComplexRoute: text.includes('claude opus high'),
        hasClaudeAgent: text.includes('Claude Code'),
        hasCodexAgent: text.includes('Codex'),
        hasAgyAgent: text.includes('AGY'),
        hasOpencodeAgent: text.includes('OpenCode'),
        hasReadyState: text.includes('Ready'),
        hasQuota5h: text.includes('96% left'),
      };
    })()`);

    assert.ok(routingData, 'SettingsRouting host and shadowRoot must exist');
    assert.equal(routingData.hasMaxLanes, true, 'maxLanes value 5 must be rendered');
    assert.equal(routingData.hasClaudeSessionFloor, true, 'Claude 5h floor 40% must be rendered');
    assert.equal(routingData.hasClaudeWeeklyFloor, true, 'Claude weekly floor 30% must be rendered');
    assert.equal(routingData.hasOthersSessionFloor, true, 'Others 5h floor 10% must be rendered');
    assert.equal(routingData.hasOthersWeeklyFloor, true, 'Others weekly floor 15% must be rendered');
    assert.equal(routingData.hasTrivialRoute, true, 'Trivial route must be rendered');
    assert.equal(routingData.hasStandardRoute, true, 'Standard route must be rendered');
    assert.equal(routingData.hasComplexRoute, true, 'Complex route must be rendered');
    assert.equal(routingData.hasClaudeAgent, true, 'Claude agent must be rendered');
    assert.equal(routingData.hasReadyState, true, 'Ready state must be rendered');
    assert.equal(routingData.hasQuota5h, true, 'Live quota 96% left must be rendered');

    // Test maxLanes stepper button saves patch
    devServer.actions.length = 0;
    const laneClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsRouting"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="More lanes"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(laneClick, true, 'More lanes button must be clickable');

    let laneAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        laneAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(laneAction, 'settings.save action must be posted for maxLanes');
    assert.equal(laneAction.name, 'settings.save');
    assert.deepEqual(laneAction.args, { patch: { routing: { maxLanes: 6 } } });

    // Test quota floor stepper saves patch
    devServer.actions.length = 0;
    const floorClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsRouting"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Increase Claude 5h floor"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(floorClick, true, 'Increase Claude 5h floor button must be clickable');

    let floorAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        floorAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(floorAction, 'settings.save action must be posted for quota.floor');
    assert.equal(floorAction.name, 'settings.save');
    assert.deepEqual(floorAction.args, { patch: { quota: { floor: { claude: { sessionPct: 45 } } } } });

    // Test agent routable switch saves patch
    devServer.actions.length = 0;
    const routableClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsRouting"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Use Claude Code"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(routableClick, true, 'Routable toggle button for Claude Code must be clickable');

    let routableAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        routableAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(routableAction, 'settings.save action must be posted for routable toggle');
    assert.equal(routableAction.name, 'settings.save');
    assert.deepEqual(routableAction.args, { patch: { agents: { claude: { routable: false } } } });
  });

  test('Routing & Quota models management: lists models, adds, edits, and removes models per agent', async () => {
    await evaluate('window.MK.go("SettingsRouting")');
    await new Promise((r) => setTimeout(r, 200));

    // 1. Verify models listed for Claude
    const modelsListed = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsRouting"]');
      if (!host || !host.shadowRoot) return false;
      const text = host.shadowRoot.textContent || '';
      return text.includes('haiku') && text.includes('sonnet') && text.includes('opus') && text.includes('fable');
    })()`);
    assert.equal(modelsListed, true, 'Claude models haiku, sonnet, opus, fable must be listed');

    // 2. Add model via UI buttons and form
    devServer.actions.length = 0;
    const startAddClicked = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsRouting"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Add model to claude"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(startAddClicked, true, 'Add model button for claude must be clickable');
    await new Promise((r) => setTimeout(r, 100));

    const submitAdd = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsRouting"]');
      if (!host || !host.shadowRoot) return false;
      const idInput = host.shadowRoot.querySelector('input[aria-label="New model ID for claude"]');
      const effortsInput = host.shadowRoot.querySelector('input[aria-label="New model efforts for claude"]');
      const noteInput = host.shadowRoot.querySelector('input[aria-label="New model note for claude"]');
      const saveBtn = host.shadowRoot.querySelector('button[aria-label="Save new model for claude"]');
      if (!idInput || !saveBtn) return false;

      idInput.value = 'test-model';
      idInput.dispatchEvent(new Event('input', { bubbles: true }));
      idInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (effortsInput) {
        effortsInput.value = 'low, medium';
        effortsInput.dispatchEvent(new Event('input', { bubbles: true }));
        effortsInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (noteInput) {
        noteInput.value = 'Custom test';
        noteInput.dispatchEvent(new Event('input', { bubbles: true }));
        noteInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      saveBtn.click();
      return true;
    })()`);
    assert.equal(submitAdd, true, 'Save new model button must be clickable');

    let addAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        addAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(addAction, 'settings.save action must be posted for addModel');
    assert.equal(addAction.name, 'settings.save');
    assert.ok(Array.isArray(addAction.args?.patch?.agents?.claude?.models));
    const addedModels = addAction.args.patch.agents.claude.models;
    assert.equal(addedModels[addedModels.length - 1]?.id, 'test-model');

    // 3. Edit model via UI
    devServer.actions.length = 0;
    const startEditClicked = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsRouting"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Edit model haiku for claude"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(startEditClicked, true, 'Edit model haiku button must be clickable');
    await new Promise((r) => setTimeout(r, 100));

    const submitEdit = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsRouting"]');
      if (!host || !host.shadowRoot) return false;
      const noteInput = host.shadowRoot.querySelector('input[aria-label="Edit model note for haiku"]');
      const saveBtn = host.shadowRoot.querySelector('button[aria-label="Save model haiku changes"]');
      if (!saveBtn) return false;
      if (noteInput) {
        noteInput.value = 'Edited note';
        noteInput.dispatchEvent(new Event('input', { bubbles: true }));
        noteInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      saveBtn.click();
      return true;
    })()`);
    assert.equal(submitEdit, true, 'Save model haiku changes must be clickable');

    let editAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        editAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(editAction, 'settings.save action must be posted for editModel');
    assert.equal(editAction.name, 'settings.save');
    assert.equal(editAction.args?.patch?.agents?.claude?.models?.[0]?.note, 'Edited note');

    // 4. Remove model via UI
    devServer.actions.length = 0;
    const removeClicked = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsRouting"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Remove model fable from claude"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(removeClicked, true, 'Remove model fable button must be clickable');

    let removeAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        removeAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(removeAction, 'settings.save action must be posted for removeModel');
    assert.equal(removeAction.name, 'settings.save');
    assert.ok(Array.isArray(removeAction.args?.patch?.agents?.claude?.models));
    const remModels = removeAction.args.patch.agents.claude.models;
    assert.equal(remModels.some((m) => m.id === 'fable'), false);
  });

  test('Work screen renders fixture snapshot and binds work settings', async () => {
    await evaluate('window.MK.go("SettingsWork")');
    await new Promise((r) => setTimeout(r, 200));

    const workData = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsWork"]');
      if (!host || !host.shadowRoot) return null;
      const text = host.shadowRoot.textContent || '';
      return {
        hasStallMinutes: text.includes('15m'),
        hasDefaultRisk: text.includes('3'),
        hasInboxDir: text.includes('.matrixkoder/inbox'),
        hasWorkFlow: text.includes('Work Flow'),
        hasTemplatesSec: text.includes('Task spec templates'),
      };
    })()`);

    assert.ok(workData, 'SettingsWork host and shadowRoot must exist');
    assert.equal(workData.hasStallMinutes, true, 'stallMinutes value 15m must be rendered');
    assert.equal(workData.hasDefaultRisk, true, 'defaultRisk value 3 must be rendered');
    assert.equal(workData.hasWorkFlow, true, 'Work Flow section must exist');
    assert.equal(workData.hasTemplatesSec, true, 'Task spec templates section must exist');

    // 1. Test stallMinutes stepper
    devServer.actions.length = 0;
    const stallClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsWork"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Increase stall threshold"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(stallClick, true, 'Increase stall threshold button must be clickable');

    let stallAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        stallAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(stallAction, 'settings.save action must be posted for lanes.stallMinutes');
    assert.equal(stallAction.name, 'settings.save');
    assert.deepEqual(stallAction.args, { patch: { lanes: { stallMinutes: 16 } } });

    // 2. Test bugRisk stepper
    devServer.actions.length = 0;
    const riskClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsWork"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Increase default bug risk"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(riskClick, true, 'Increase default bug risk button must be clickable');

    let riskAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        riskAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(riskAction, 'settings.save action must be posted for bugs.defaultRisk');
    assert.equal(riskAction.name, 'settings.save');
    assert.deepEqual(riskAction.args, { patch: { bugs: { defaultRisk: 4 } } });

    // 3. Test plan autoImport toggle
    devServer.actions.length = 0;
    const autoClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsWork"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Plan auto-import"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(autoClick, true, 'Plan auto-import button must be clickable');

    let autoAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        autoAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(autoAction, 'settings.save action must be posted for plans.autoImport');
    assert.equal(autoAction.name, 'settings.save');
    assert.deepEqual(autoAction.args, { patch: { plans: { autoImport: true } } });
  });

  test('Work screen displays C8 shared-checkout hint in solo mode when maxLanes > 1', async () => {
    // 1. Inject snapshot with solo mode and maxLanes 3 via devServer
    const currentSnap = await evaluate('window.MK.getState()');
    const soloSnap = JSON.parse(JSON.stringify(currentSnap));
    soloSnap.settings.values.general.mode = 'solo';
    soloSnap.settings.values.routing.maxLanes = 3;
    devServer.setSnapshot(soloSnap);

    await evaluate('window.MK.refresh()');
    await new Promise((r) => setTimeout(r, 200));
    await evaluate('window.MK.go("SettingsWork")');
    await new Promise((r) => setTimeout(r, 200));

    const soloHintFound = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsWork"]');
      if (!host || !host.shadowRoot) return false;
      const text = host.shadowRoot.textContent || '';
      return text.includes('Solo mode: lanes share this checkout; set Lanes at once to 1 to avoid clashes');
    })()`);

    assert.equal(soloHintFound, true, 'C8 shared checkout hint must be displayed in solo mode when maxLanes > 1');

    // 2. Switch back to orchestrator mode via devServer
    const orchSnap = JSON.parse(JSON.stringify(soloSnap));
    orchSnap.settings.values.general.mode = 'orchestrator';
    devServer.setSnapshot(orchSnap);

    await evaluate('window.MK.refresh()');
    await new Promise((r) => setTimeout(r, 200));

    const soloHintHidden = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsWork"]');
      if (!host || !host.shadowRoot) return false;
      const text = host.shadowRoot.textContent || '';
      return !text.includes('Solo mode: lanes share this checkout; set Lanes at once to 1 to avoid clashes');
    })()`);

    assert.equal(soloHintHidden, true, 'C8 shared checkout hint must be hidden in orchestrator mode');
  });

  test('Work screen Task spec templates section renders all 5 scenarios with purpose, path binding, and status', async () => {
    await evaluate('window.MK.go("SettingsWork")');
    await new Promise((r) => setTimeout(r, 200));

    const scenariosCheck = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsWork"]');
      if (!host || !host.shadowRoot) return null;
      const text = host.shadowRoot.textContent || '';
      return {
        hasInvestigate: text.includes('Investigate'),
        hasImplement: text.includes('Implement'),
        hasSubdispatch: text.includes('Subdispatch'),
        hasReview: text.includes('Review'),
        hasFix: text.includes('Fix'),
        hasBuiltin: text.includes('built-in'),
        hasInvestigatePurpose: text.includes('Read-only research or spike'),
        hasImplementPurpose: text.includes('Build with explicit file/component ownership'),
      };
    })()`);

    assert.ok(scenariosCheck, 'SettingsWork host and shadowRoot must exist');
    assert.equal(scenariosCheck.hasInvestigate, true, 'Investigate scenario must be rendered');
    assert.equal(scenariosCheck.hasImplement, true, 'Implement scenario must be rendered');
    assert.equal(scenariosCheck.hasSubdispatch, true, 'Subdispatch scenario must be rendered');
    assert.equal(scenariosCheck.hasReview, true, 'Review scenario must be rendered');
    assert.equal(scenariosCheck.hasFix, true, 'Fix scenario must be rendered');
    assert.equal(scenariosCheck.hasBuiltin, true, 'built-in status badge must be rendered');
    assert.equal(scenariosCheck.hasInvestigatePurpose, true, 'Investigate purpose must be rendered');
    assert.equal(scenariosCheck.hasImplementPurpose, true, 'Implement purpose must be rendered');

    // Test saving template path
    devServer.actions.length = 0;
    await evaluate(`(() => {
      const b = window.MK_BIND('work.specTemplates.investigate');
      b.save('templates/spec/custom-investigate.md');
    })()`);
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(devServer.actions.length, 1);
    assert.equal(devServer.actions[0]?.name, 'settings.save');
    assert.deepEqual(devServer.actions[0]?.args, {
      patch: { work: { specTemplates: { investigate: 'templates/spec/custom-investigate.md' } } },
    });
  });

  // ---- SCREENS.3 tests: SettingsSafety, SettingsNotify, and Plan Start button ----

  test('Safety screen renders fixture snapshot values, labels rows from schema, and binds safety.*', async () => {
    await evaluate('window.MK.go("SettingsSafety")');
    await new Promise((r) => setTimeout(r, 200));

    const safetyData = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsSafety"]');
      if (!host || !host.shadowRoot) return null;
      const text = host.shadowRoot.textContent || '';
      return {
        hasConfirmRiskVal: text.includes('4'),
        hasC7Label: text.includes('checked by MK; the dashboard asks you, agents must confirm explicitly'),
        hasAdvisoryLabel: text.includes('advisory: written into briefs'),
        hasMainBranch: text.includes('main'),
        hasReleaseBranch: text.includes('release/*'),
        hasNeverRunCmd: text.includes('git reset --hard'),
        hasAskBeforePush: text.includes('Ask before git push'),
      };
    })()`);

    assert.ok(safetyData, 'SettingsSafety host and shadowRoot must exist');
    assert.equal(safetyData.hasConfirmRiskVal, true, 'confirmRiskAtLeast value 4 must be rendered');
    assert.equal(safetyData.hasC7Label, true, 'C7 wording for confirmRiskAtLeast must be rendered');
    assert.equal(safetyData.hasAdvisoryLabel, true, 'advisory wording must be rendered');
    assert.equal(safetyData.hasMainBranch, true, 'main branch chip must be rendered');
    assert.equal(safetyData.hasReleaseBranch, true, 'release/* branch chip must be rendered');
    assert.equal(safetyData.hasNeverRunCmd, true, 'neverRun command must be rendered');
    assert.equal(safetyData.hasAskBeforePush, true, 'Ask before git push must be rendered');

    // 1. Test confirmRiskAtLeast stepper
    devServer.actions.length = 0;
    const riskClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsSafety"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Increase risk threshold"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(riskClick, true, 'Increase risk threshold button must be clickable');

    let riskAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        riskAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(riskAction, 'settings.save action must be posted for confirmRiskAtLeast');
    assert.equal(riskAction.name, 'settings.save');
    assert.deepEqual(riskAction.args, { patch: { safety: { confirmRiskAtLeast: 5 } } });

    // 2. Test askBeforePush toggle
    devServer.actions.length = 0;
    const pushClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsSafety"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Ask before git push"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(pushClick, true, 'Ask before git push button must be clickable');

    let pushAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        pushAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(pushAction, 'settings.save action must be posted for askBeforePush');
    assert.equal(pushAction.name, 'settings.save');
    assert.deepEqual(pushAction.args, { patch: { safety: { askBeforePush: false } } });

    // 3. Test list editable: remove branch
    devServer.actions.length = 0;
    const removeBranchClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsSafety"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Remove main"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(removeBranchClick, true, 'Remove main button must be clickable');

    let branchAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        branchAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(branchAction, 'settings.save action must be posted for protectedBranches');
    assert.equal(branchAction.name, 'settings.save');
    assert.deepEqual(branchAction.args, { patch: { safety: { protectedBranches: ['release/*'] } } });

    // 4. Test list editable: remove command
    devServer.actions.length = 0;
    const removeCmdClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsSafety"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Remove command git reset --hard"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(removeCmdClick, true, 'Remove command button must be clickable');

    let cmdAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        cmdAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(cmdAction, 'settings.save action must be posted for neverRun');
    assert.equal(cmdAction.name, 'settings.save');
    assert.ok(Array.isArray(cmdAction.args?.patch?.safety?.neverRun));
    assert.equal(cmdAction.args.patch.safety.neverRun.includes('git reset --hard'), false);

    // 5. Test reset safety button
    devServer.actions.length = 0;
    const resetClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsSafety"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('section[aria-labelledby="s-reset"] button');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(resetClick, true, 'Reset safety button must be clickable');

    let resetAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        resetAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(resetAction, 'settings.reset action must be posted for safety');
    assert.equal(resetAction.name, 'settings.reset');
    assert.deepEqual(resetAction.args, { section: 'safety' });
  });

  test('Notifications screen renders fixture snapshot values, binds notify.*, has Test button, and shows Orca notes', async () => {
    await evaluate('window.MK.go("SettingsNotify")');
    await new Promise((r) => setTimeout(r, 200));

    const notifyData = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsNotify"]');
      if (!host || !host.shadowRoot) return null;
      const text = host.shadowRoot.textContent || '';
      return {
        hasAskEvent: text.includes('A lane is waiting on you'),
        hasLaneDoneEvent: text.includes('A lane finishes its task'),
        hasTaskFailedEvent: text.includes('A task fails'),
        hasStallEvent: text.includes('A lane goes quiet'),
        hasQuotaLowEvent: text.includes('Quota is low'),
        hasQuietHours: text.includes('Quiet hours'),
        hasWake: text.includes('Wake the orchestrator on events'),
        hasOrcaNote: text.includes('Set in Orca: Settings > Notifications'),
        hasOrcaLabel: text.includes('OS notifications and sounds'),
      };
    })()`);

    assert.ok(notifyData, 'SettingsNotify host and shadowRoot must exist');
    assert.equal(notifyData.hasAskEvent, true, 'ask event toggle must be rendered');
    assert.equal(notifyData.hasLaneDoneEvent, true, 'laneDone event toggle must be rendered');
    assert.equal(notifyData.hasTaskFailedEvent, true, 'taskFailed event toggle must be rendered');
    assert.equal(notifyData.hasStallEvent, true, 'stall event toggle must be rendered');
    assert.equal(notifyData.hasQuotaLowEvent, true, 'quotaLow event toggle must be rendered');
    assert.equal(notifyData.hasQuietHours, true, 'Quiet hours section must be rendered');
    assert.equal(notifyData.hasWake, true, 'Wake orchestrator section must be rendered');
    assert.equal(notifyData.hasOrcaNote, true, 'Set in Orca: Settings > Notifications note must be rendered');
    assert.equal(notifyData.hasOrcaLabel, true, 'OS notifications and sounds label must be rendered');

    // 1. Test event toggle (stall)
    devServer.actions.length = 0;
    const stallToggle = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsNotify"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="A lane goes quiet"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(stallToggle, true, 'Stall event toggle button must be clickable');

    let stallAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        stallAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(stallAction, 'settings.save action must be posted for notify.events.stall');
    assert.equal(stallAction.name, 'settings.save');
    assert.deepEqual(stallAction.args, { patch: { notify: { events: { stall: true } } } });

    // 2. Test quiet hours toggle
    devServer.actions.length = 0;
    const quietToggle = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsNotify"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Quiet hours"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(quietToggle, true, 'Quiet hours toggle button must be clickable');

    let quietAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        quietAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(quietAction, 'settings.save action must be posted for notify.quietHours.enabled');
    assert.equal(quietAction.name, 'settings.save');
    assert.deepEqual(quietAction.args, { patch: { notify: { quietHours: { enabled: true } } } });

    // 3. Test wake orchestrator toggle
    devServer.actions.length = 0;
    const wakeToggle = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsNotify"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Wake the orchestrator on events"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(wakeToggle, true, 'Wake orchestrator toggle button must be clickable');

    let wakeAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        wakeAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(wakeAction, 'settings.save action must be posted for notify.wakeOrchestrator');
    assert.equal(wakeAction.name, 'settings.save');
    assert.deepEqual(wakeAction.args, { patch: { notify: { wakeOrchestrator: true } } });

    // 4. Test Test button calling notify.test
    devServer.actions.length = 0;
    const testClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsNotify"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Send a test notification"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(testClick, true, 'Send a test notification button must be clickable');

    let testAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        testAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(testAction, 'notify.test action must be posted');
    assert.equal(testAction.name, 'notify.test');

    // 5. Test reset notification settings
    devServer.actions.length = 0;
    const resetClick = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsNotify"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('section[aria-labelledby="a-reset"] button');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(resetClick, true, 'Reset notification button must be clickable');

    let resetAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        resetAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(resetAction, 'settings.reset action must be posted for notify');
    assert.equal(resetAction.name, 'settings.reset');
    assert.deepEqual(resetAction.args, { section: 'notify' });
  });

  test('Plan screen Start button calls task.start, handles needs_confirm, shows confirm dialog, and resends with confirm: true', async () => {
    await evaluate('window.MK.go("Plan")');
    await new Promise((r) => setTimeout(r, 200));

    // Find and verify a Start task button exists
    const hasStartBtn = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Plan"]');
      if (!host || !host.shadowRoot) return false;
      const btns = Array.from(host.shadowRoot.querySelectorAll('button[aria-label="Start task"]'));
      return btns.length > 0;
    })()`);
    assert.equal(hasStartBtn, true, 'Start task button must exist for unstarted tasks');

    // Click the Start task button
    devServer.actions.length = 0;
    const startClicked = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Plan"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Start task"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(startClicked, true, 'Start task button must be clickable');

    // Wait for the first task.start call (without confirm)
    let firstStartAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        firstStartAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(firstStartAction, 'First task.start action must be received');
    assert.equal(firstStartAction.name, 'task.start');
    assert.equal(Boolean(firstStartAction.args?.confirm), false, 'Initial task.start must not have confirm: true');

    // Wait for UI to display confirm dialog
    await new Promise((r) => setTimeout(r, 200));

    const dialogShown = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Plan"]');
      if (!host || !host.shadowRoot) return false;
      const dialog = host.shadowRoot.querySelector('[role="dialog"][aria-modal="true"]');
      return dialog !== null;
    })()`);
    assert.equal(dialogShown, true, 'Confirm dialog must be displayed on needs_confirm');

    // Click the Confirm & Start button in dialog
    devServer.actions.length = 0;
    const confirmClicked = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Plan"]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('button[aria-label="Confirm task start"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(confirmClicked, true, 'Confirm task start button must be clickable');

    // Wait for the second task.start call (with confirm: true)
    let secondStartAction = null;
    for (let i = 0; i < 20; i++) {
      if (devServer.actions.length > 0) {
        secondStartAction = devServer.actions[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(secondStartAction, 'Second task.start action must be received');
    assert.equal(secondStartAction.name, 'task.start');
    assert.equal(secondStartAction.args?.confirm, true, 'Resent task.start must carry confirm: true');

    // Verify dialog is closed after confirmation
    await new Promise((r) => setTimeout(r, 150));
    const dialogClosed = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Plan"]');
      if (!host || !host.shadowRoot) return true;
      const dialog = host.shadowRoot.querySelector('[role="dialog"][aria-modal="true"]');
      return dialog === null;
    })()`);
    assert.equal(dialogClosed, true, 'Confirm dialog must be closed after confirmation');
  });

  test('Plan screen shows Retry, not Start, on a failed task that has no Orca task', async () => {
    const baseSnap = await evaluate('window.MK.getState()');
    const failedSnap = JSON.parse(JSON.stringify(baseSnap));
    const tasks = (failedSnap.plan?.phases ?? []).flatMap((ph) => ph.tasks ?? []);
    assert.ok(tasks.length > 0, 'fixture plan must have tasks');
    for (const t of tasks) {
      t.status = 'failed';
      delete t.orcaTaskId;
      delete t.orca_task_id;
    }
    devServer.setSnapshot(failedSnap);
    try {
      await evaluate('window.MK.refresh()');
      await evaluate('window.MK.go("Plan")');
      await new Promise((r) => setTimeout(r, 200));
      const counts = await evaluate(`(() => {
        const host = document.querySelector('[data-screen="Plan"]');
        if (!host || !host.shadowRoot) return null;
        const btns = Array.from(host.shadowRoot.querySelectorAll('button'));
        return {
          start: btns.filter((b) => b.getAttribute('aria-label') === 'Start task').length,
          retry: btns.filter((b) => (b.textContent || '').trim() === 'Retry task').length,
        };
      })()`);
      assert.ok(counts, 'Plan screen must render');
      assert.ok(counts.retry > 0, 'a failed task shows Retry task');
      assert.equal(counts.start, 0, 'a failed task with no Orca task must not show Start task');
    } finally {
      devServer.setSnapshot(baseSnap);
      await evaluate('window.MK.refresh()');
    }
  });
});
