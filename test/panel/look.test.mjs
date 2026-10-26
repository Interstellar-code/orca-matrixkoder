// test/panel/look.test.mjs
// T10 integration tests for SCREENS.4:
// 1. Appearance screen binds look.* (rain, brightness, speed, reduceMotion, textSize, density), saves nested patches, reset calls settings.reset.
// 2. Appearance applied app-wide: look.rain.enabled false and textSize L renders Main and other screens with rain off and large text; textSize S applies zoom 0.9.
// 3. Mode solo renders Lanes, Projects and Plan without worktree-only columns and controls; orchestrator mode shows them.
// 4. general.openOnStart picks the first screen; 'last' opens snapshot settings.lastScreen (projects when empty), and screen changes call ui.remember.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createDevServer } from '../../scripts/dev-snapshot-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Appearance and look integration tests (T10)', () => {
  let devServer;
  let chromeProcess;
  let userDataDir;
  let ws;
  let baseSnapshot;

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
    baseSnapshot = JSON.parse(readFileSync(join(__dirname, '../fixtures/snapshot.json'), 'utf8'));

    // 1. Start dev-snapshot-server
    devServer = await createDevServer({ verbose: false });

    // 2. Launch Chrome headless with CDP
    userDataDir = mkdtempSync(join(tmpdir(), 'chrome-look-t10-'));
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
    assert.equal(title, 'MatrixKoder');
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

    if (devServer) {
      await devServer.close();
    }
  });

  test('Appearance screen binds look.*, saves nested patches, and Reset calls settings.reset', async () => {
    // Navigate to SettingsLook
    devServer.actions.length = 0;
    await evaluate('window.MK.go("SettingsLook")');
    await new Promise((r) => setTimeout(r, 200));

    // Verify controls exist in SettingsLook
    const controls = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsLook"]');
      if (!host || !host.shadowRoot) return null;
      const sr = host.shadowRoot;
      return {
        rainSwitch: !!sr.querySelector('button.sw[aria-label="Show rain"]'),
        brightnessRange: !!sr.querySelector('#rb'),
        speedGroup: !!sr.querySelector('.segc[aria-label="Rain speed"]'),
        motionGroup: !!sr.querySelector('.segc[aria-label="Reduce motion"]'),
        textSizeGroup: !!sr.querySelector('.segc[aria-label="Text size"]'),
        densityGroup: !!sr.querySelector('.segc[aria-label="Density"]'),
        resetBtn: !!sr.querySelector('button.btn'),
        orcaNote: sr.textContent.includes('Set in Orca: Settings > Appearance'),
      };
    })()`);

    assert.ok(controls, 'SettingsLook screen should be mounted');
    assert.equal(controls.rainSwitch, true, 'Rain switch present');
    assert.equal(controls.brightnessRange, true, 'Brightness input present');
    assert.equal(controls.speedGroup, true, 'Speed buttons present');
    assert.equal(controls.motionGroup, true, 'Motion buttons present');
    assert.equal(controls.textSizeGroup, true, 'Text size buttons present');
    assert.equal(controls.densityGroup, true, 'Density buttons present');
    assert.equal(controls.resetBtn, true, 'Reset button present');
    assert.equal(controls.orcaNote, true, 'Orca-owned theme note present');

    // 1. Test clicking text size 'L'
    devServer.actions.length = 0;
    const clickedSize = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsLook"]');
      const btn = Array.from(host.shadowRoot.querySelectorAll('.segc[aria-label="Text size"] button'))
        .find(b => b.textContent.trim() === 'L');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(clickedSize, true);

    await new Promise((r) => setTimeout(r, 200));
    const sizeAction = devServer.actions.find((a) => a.name === 'settings.save');
    assert.ok(sizeAction, 'settings.save should be triggered for text size change');
    assert.deepEqual(sizeAction.args.patch, { look: { textSize: 'L' } });

    // 2. Test changing rain brightness slider
    devServer.actions.length = 0;
    await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsLook"]');
      const input = host.shadowRoot.querySelector('#rb');
      input.value = '80';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);

    await new Promise((r) => setTimeout(r, 200));
    const brightAction = devServer.actions.find((a) => a.name === 'settings.save');
    assert.ok(brightAction, 'settings.save should be triggered for brightness change');
    assert.deepEqual(brightAction.args.patch, { look: { rain: { brightness: 80 } } });

    // 3. Test clicking Reset button
    devServer.actions.length = 0;
    await evaluate(`(() => {
      const host = document.querySelector('[data-screen="SettingsLook"]');
      const resetBtn = Array.from(host.shadowRoot.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'Reset');
      if (resetBtn) resetBtn.click();
    })()`);

    await new Promise((r) => setTimeout(r, 200));
    const resetAction = devServer.actions.find((a) => a.name === 'settings.reset');
    assert.ok(resetAction, 'settings.reset should be triggered');
    assert.deepEqual(resetAction.args, { section: 'look' });
  });

  test('Appearance applied app-wide: rain off and textSize L scales Main and other screens', async () => {
    // Configure snapshot with look.rain.enabled = false and look.textSize = 'L'
    const snap = JSON.parse(JSON.stringify(baseSnapshot));
    snap.settings.values.look = {
      rain: { enabled: false, brightness: 60, speed: 'normal' },
      reduceMotion: 'off',
      textSize: 'L',
      density: 'compact',
    };
    devServer.setSnapshot(snap);

    await evaluate('window.MK.refresh()');
    await new Promise((r) => setTimeout(r, 300));

    // Verify Main, Lanes, and Waiting
    const screensToCheck = ['Main', 'Lanes', 'Waiting'];
    for (const screen of screensToCheck) {
      await evaluate(`window.MK.go("${screen}")`);
      await new Promise((r) => setTimeout(r, 200));

      const screenState = await evaluate(`(() => {
        const host = document.querySelector('[data-screen="${screen}"]');
        if (!host || !host.shadowRoot) return null;
        const sr = host.shadowRoot;
        const rainCols = sr.querySelectorAll('.rain .rcol').length;
        const hostZoom = host.style.zoom;
        const rootZoom = document.documentElement.style.getPropertyValue('--mk-zoom');
        const hasTextSizeL = document.documentElement.classList.contains('text-size-l');
        const hasCompact = document.documentElement.classList.contains('density-compact');
        return { rainCols, hostZoom, rootZoom, hasTextSizeL, hasCompact };
      })()`);

      assert.ok(screenState, `Screen ${screen} should be mounted`);
      assert.equal(screenState.rainCols, 0, `Screen ${screen} should have 0 rain columns when rain is disabled`);
      assert.equal(screenState.hostZoom, '1.15', `Screen ${screen} host zoom should be 1.15 for textSize L`);
      assert.equal(screenState.rootZoom, '1.15', `Root --mk-zoom should be 1.15`);
      assert.equal(screenState.hasTextSizeL, true, `Root class should include text-size-l`);
      assert.equal(screenState.hasCompact, true, `Root class should include density-compact`);
    }

    // Now switch to textSize 'S' and rain enabled true
    snap.settings.values.look.rain.enabled = true;
    snap.settings.values.look.textSize = 'S';
    snap.settings.values.look.density = 'comfy';
    devServer.setSnapshot(snap);

    await evaluate('window.MK.refresh()');
    await new Promise((r) => setTimeout(r, 300));

    for (const screen of screensToCheck) {
      await evaluate(`window.MK.go("${screen}")`);
      await new Promise((r) => setTimeout(r, 200));

      const screenState = await evaluate(`(() => {
        const host = document.querySelector('[data-screen="${screen}"]');
        if (!host || !host.shadowRoot) return null;
        const sr = host.shadowRoot;
        const rainCols = sr.querySelectorAll('.rain .rcol').length;
        const hostZoom = host.style.zoom;
        const rootZoom = document.documentElement.style.getPropertyValue('--mk-zoom');
        return { rainCols, hostZoom, rootZoom };
      })()`);

      assert.ok(screenState, `Screen ${screen} should be mounted`);
      assert.ok(screenState.rainCols > 0, `Screen ${screen} should have rain columns when rain is enabled`);
      assert.equal(screenState.hostZoom, '0.9', `Screen ${screen} host zoom should be 0.9 for textSize S`);
      assert.equal(screenState.rootZoom, '0.9', `Root --mk-zoom should be 0.9`);
    }
  });

  test('Solo mode hides worktree columns and controls on Lanes and Projects, Plan renders cleanly', async () => {
    // 1. Solo mode
    const soloSnap = JSON.parse(JSON.stringify(baseSnapshot));
    soloSnap.settings.values.general.mode = 'solo';
    devServer.setSnapshot(soloSnap);

    await evaluate('window.MK.refresh()');
    await new Promise((r) => setTimeout(r, 300));

    // Check Lanes in solo mode
    await evaluate('window.MK.go("Lanes")');
    await new Promise((r) => setTimeout(r, 200));

    const lanesSolo = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Lanes"]');
      if (!host || !host.shadowRoot) return null;
      const sr = host.shadowRoot;
      const text = sr.textContent;
      // In solo mode, branch line (.mono under agent), Worktree row (.kv with "Worktree") are hidden
      const worktreeKv = Array.from(sr.querySelectorAll('.kv')).some(el => el.textContent.includes('Worktree'));
      // Summary text shows "N lanes" instead of "N worktrees"
      const summaryText = sr.querySelector('header span, .mk span')?.textContent || text;
      const hasLanesSummary = /\\d+\\s+lanes\\b/.test(text);
      const hasWorktreesSummary = /\\d+\\s+worktrees\\b/.test(text);
      return { worktreeKv, hasLanesSummary, hasWorktreesSummary };
    })()`);

    assert.ok(lanesSolo, 'Lanes screen mounted');
    assert.equal(lanesSolo.worktreeKv, false, 'Worktree row should be hidden on Lanes in solo mode');
    assert.equal(lanesSolo.hasLanesSummary, true, 'Summary text should show "N lanes" in solo mode');
    assert.equal(lanesSolo.hasWorktreesSummary, false, 'Summary text should NOT show "N worktrees" in solo mode');

    // Check Projects in solo mode
    await evaluate('window.MK.go("Projects")');
    await new Promise((r) => setTimeout(r, 200));

    const projectsSolo = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Projects"]');
      if (!host || !host.shadowRoot) return null;
      const sr = host.shadowRoot;
      const text = sr.textContent;
      const hasSubWorktrees = Array.from(sr.querySelectorAll('article')).some(a => a.textContent.includes('·') && a.textContent.includes('worktrees'));
      const hasIdleWorktrees = text.includes('idle worktrees');
      return { hasSubWorktrees, hasIdleWorktrees };
    })()`);

    assert.ok(projectsSolo, 'Projects screen mounted');
    assert.equal(projectsSolo.hasSubWorktrees, false, 'Sub line should not include "· N worktrees" in solo mode');
    assert.equal(projectsSolo.hasIdleWorktrees, false, 'Should not show "N idle worktrees" in solo mode');

    // Check Plan renders without error in solo mode
    await evaluate('window.MK.go("Plan")');
    await new Promise((r) => setTimeout(r, 200));
    const planMounted = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Plan"]');
      return !!(host && host.shadowRoot);
    })()`);
    assert.equal(planMounted, true, 'Plan screen mounts without error in solo mode');

    // 2. Orchestrator mode
    const orchSnap = JSON.parse(JSON.stringify(baseSnapshot));
    orchSnap.settings.values.general.mode = 'orchestrator';
    devServer.setSnapshot(orchSnap);

    await evaluate('window.MK.refresh()');
    await new Promise((r) => setTimeout(r, 300));

    // Check Lanes in orchestrator mode
    await evaluate('window.MK.go("Lanes")');
    await new Promise((r) => setTimeout(r, 200));

    const lanesOrch = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Lanes"]');
      if (!host || !host.shadowRoot) return null;
      const sr = host.shadowRoot;
      const text = sr.textContent;
      const worktreeKv = Array.from(sr.querySelectorAll('.kv')).some(el => el.textContent.includes('Worktree'));
      const hasWorktreesSummary = /\\d+\\s+worktrees\\b/.test(text);
      return { worktreeKv, hasWorktreesSummary };
    })()`);

    assert.ok(lanesOrch, 'Lanes screen mounted');
    assert.equal(lanesOrch.worktreeKv, true, 'Worktree row should be visible on Lanes in orchestrator mode');
    assert.equal(lanesOrch.hasWorktreesSummary, true, 'Summary text should show "N worktrees" in orchestrator mode');

    // Check Projects in orchestrator mode
    await evaluate('window.MK.go("Projects")');
    await new Promise((r) => setTimeout(r, 200));

    const projectsOrch = await evaluate(`(() => {
      const host = document.querySelector('[data-screen="Projects"]');
      if (!host || !host.shadowRoot) return null;
      const sr = host.shadowRoot;
      const text = sr.textContent;
      const hasSubWorktrees = Array.from(sr.querySelectorAll('article')).some(a => a.textContent.includes('worktrees'));
      const hasIdleWorktrees = text.includes('idle worktrees');
      return { hasSubWorktrees, hasIdleWorktrees };
    })()`);

    assert.ok(projectsOrch, 'Projects screen mounted');
    assert.equal(projectsOrch.hasSubWorktrees, true, 'Sub line should show worktrees in orchestrator mode');
    assert.equal(projectsOrch.hasIdleWorktrees, true, 'Should show idle worktrees in orchestrator mode');
  });

  test('openOnStart picks the first screen and last opens settings.lastScreen, screen changes call ui.remember', async () => {
    // 1. Verify screen changes call ui.remember
    devServer.actions.length = 0;
    await evaluate('window.MK.go("Lanes")');
    await new Promise((r) => setTimeout(r, 200));

    const remLanes = devServer.actions.find((a) => a.name === 'ui.remember');
    assert.ok(remLanes, 'ui.remember should be called on screen change');
    assert.equal(remLanes.args.screen, 'lanes');

    devServer.actions.length = 0;
    await evaluate('window.MK.go("Main")');
    await new Promise((r) => setTimeout(r, 200));

    const remMain = devServer.actions.find((a) => a.name === 'ui.remember');
    assert.ok(remMain, 'ui.remember should be called on screen change to Main');
    assert.equal(remMain.args.screen, 'overview', 'Main screen maps to overview in ui.remember');

    devServer.actions.length = 0;
    await evaluate('window.MK.go("Settings")');
    await new Promise((r) => setTimeout(r, 200));

    const remSettings = devServer.actions.find((a) => a.name === 'ui.remember');
    assert.ok(remSettings, 'ui.remember should be called on screen change to Settings');
    assert.equal(remSettings.args.screen, 'settings');

    // 2. Test openOnStart: 'last' with settings.lastScreen = 'waiting'
    const snap = JSON.parse(JSON.stringify(baseSnapshot));
    snap.settings.values.general.openOnStart = 'last';
    snap.settings.lastScreen = 'waiting';
    devServer.setSnapshot(snap);

    // Navigate to empty url (no hash) so MK_BOOT runs with resolveStartScreen()
    await sendCDP('Page.navigate', { url: devServer.url });
    await new Promise((r) => setTimeout(r, 800));

    const currentScreenWaiting = await evaluate(`(() => {
      const active = Array.from(document.querySelectorAll('.mk-screen')).find(el => !el.hidden);
      return active ? active.dataset.screen : null;
    })()`);
    assert.equal(currentScreenWaiting, 'Waiting', 'openOnStart: last should open Waiting when settings.lastScreen is waiting');

    // 3. Test openOnStart: 'last' with settings.lastScreen = '' (default projects)
    snap.settings.lastScreen = '';
    devServer.setSnapshot(snap);

    await sendCDP('Page.navigate', { url: devServer.url });
    await new Promise((r) => setTimeout(r, 800));

    const currentScreenProjects = await evaluate(`(() => {
      const active = Array.from(document.querySelectorAll('.mk-screen')).find(el => !el.hidden);
      return active ? active.dataset.screen : null;
    })()`);
    assert.equal(currentScreenProjects, 'Projects', 'openOnStart: last should open Projects when settings.lastScreen is empty');
  });
});
