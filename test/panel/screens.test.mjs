// test/panel/screens.test.mjs
// T7 integration test for WIRE phase:
// 1. Scans panel/screens/*.dc.html to verify no mock data constants remain.
// 2. Loads built page in headless Chrome over DevTools protocol against dev-snapshot-server.mjs.
// 3. Verifies all 16 screens render from fixture snapshot without console errors.
// 4. Verifies all 16 screens render from empty snapshot without console errors.
// 5. Verifies failed fetch shows the stale banner (#mk-stale-banner).
// 6. Verifies clicking one button per screen POSTs the expected action name.
// 7. Cleans up every Chrome and server process started by the test.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createDevServer } from '../../scripts/dev-snapshot-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const screensDir = join(root, 'panel', 'screens');

const ALL_16_SCREENS = [
  'Projects',
  'Main',
  'Lanes',
  'Plan',
  'Waiting',
  'Events',
  'Inbox',
  'Bugs',
  'Todo',
  'Settings',
  'SettingsAgents',
  'SettingsRouting',
  'SettingsSafety',
  'SettingsAlerts',
  'SettingsLook',
  'SettingsShortcuts',
];

test('no mock data constants remain in panel/screens/*.dc.html', () => {
  const files = readdirSync(screensDir).filter((f) => f.endsWith('.dc.html'));
  assert.equal(files.length, 16, 'All 16 screens must exist in panel/screens');

  const mockPatterns = [
    /\bconst\s+BUGS\s*=/,
    /\bconst\s+EVENTS\s*=/,
    /\bconst\s+FILES\s*=/,
    /\bconst\s+PLAN\s*=/,
    /\bconst\s+START\s*=/,
    /\bconst\s+ASKS\s*=/,
    /\bconst\s+AGENTS\s*=/,
    /\bconst\s+TIERS\s*=/,
    /\bconst\s+GUARDS\s*=/,
    /\bconst\s+CMDS\s*=/,
    /\bconst\s+DEFS\s*=/,
    /\bconst\s+ALL\s*=/,
    /\bconst\s+BADGES\s*=/,
    /\bconst\s+STABS\s*=/,
    /\bconst\s+RAIN\s*=/,
    /\bconst\s+GLYPHS\s*=/,
  ];

  for (const file of files) {
    const content = readFileSync(join(screensDir, file), 'utf8');
    for (const pattern of mockPatterns) {
      assert.equal(
        pattern.test(content),
        false,
        `File ${file} must not contain mock data constant matching ${pattern}`
      );
    }

    // Ensure no top-level const declarations exist in the <script> block
    const scriptMatch = content.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      const scriptBody = scriptMatch[1];
      const topLevelConst = scriptBody.match(/^const\s+[A-Za-z0-9_]+\s*=/m);
      assert.equal(
        topLevelConst,
        null,
        `File ${file} has top-level const declaration in script: ${topLevelConst?.[0]}`
      );
    }
  }
});

describe('Chrome headless integration tests (T7)', () => {
  let devServer;
  let chromeProcess;
  let userDataDir;
  let ws;
  let consoleErrors = [];
  let pageExceptions = [];

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
    userDataDir = mkdtempSync(join(tmpdir(), 'chrome-t7-'));
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

    // Track console errors and exceptions
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        if (msg.params.type === 'error') {
          consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        pageExceptions.push(msg.params.exceptionDetails?.text || 'Uncaught exception');
      }
    });

    await sendCDP('Page.enable');
    await sendCDP('Runtime.enable');

    // Navigate to dashboard
    await sendCDP('Page.navigate', { url: devServer.url });
    await new Promise((r) => setTimeout(r, 800));

    // Verify page loaded
    const title = await evaluate('document.title');
    assert.equal(title, 'MatrixKoder', 'Dashboard title should be MatrixKoder');
  });

  after(async () => {
    // Teardown everything cleanly
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

  test('all 16 screens render from fixture snapshot without console errors', async () => {
    consoleErrors.length = 0;
    pageExceptions.length = 0;

    for (const screen of ALL_16_SCREENS) {
      await evaluate(`window.MK.go("${screen}")`);
      await new Promise((r) => setTimeout(r, 100));

      const res = await evaluate(`(() => {
        const host = document.querySelector('[data-screen="${screen}"]');
        if (!host) return { found: false };
        const shadow = host.shadowRoot;
        return {
          found: true,
          hidden: host.hidden,
          hasChildren: shadow && shadow.childNodes.length > 0,
          textLen: shadow ? (shadow.textContent || '').trim().length : 0
        };
      })()`);

      assert.ok(res.found, `Screen ${screen} should be mounted in DOM`);
      assert.equal(res.hidden, false, `Screen ${screen} should be visible`);
      assert.ok(res.hasChildren, `Screen ${screen} shadowRoot should have children`);
      assert.ok(res.textLen > 10, `Screen ${screen} should have non-empty text rendered`);
    }

    assert.equal(consoleErrors.length, 0, `No console errors expected: ${consoleErrors.join(', ')}`);
    assert.equal(pageExceptions.length, 0, `No page exceptions expected: ${pageExceptions.join(', ')}`);
  });

  test('all 16 screens render from empty snapshot without console errors', async () => {
    consoleErrors.length = 0;
    pageExceptions.length = 0;

    devServer.setMode('empty');
    await evaluate('window.MK.refresh()');
    await new Promise((r) => setTimeout(r, 400));

    for (const screen of ALL_16_SCREENS) {
      await evaluate(`window.MK.go("${screen}")`);
      await new Promise((r) => setTimeout(r, 100));

      const res = await evaluate(`(() => {
        const host = document.querySelector('[data-screen="${screen}"]');
        if (!host) return { found: false };
        const shadow = host.shadowRoot;
        return {
          found: true,
          hidden: host.hidden,
          hasChildren: shadow && shadow.childNodes.length > 0
        };
      })()`);

      assert.ok(res.found, `Screen ${screen} should render in empty mode`);
      assert.equal(res.hidden, false, `Screen ${screen} should be visible in empty mode`);
      assert.ok(res.hasChildren, `Screen ${screen} should have shadowRoot children in empty mode`);
    }

    assert.equal(consoleErrors.length, 0, `No console errors expected on empty data: ${consoleErrors.join(', ')}`);
    assert.equal(pageExceptions.length, 0, `No page exceptions expected on empty data: ${pageExceptions.join(', ')}`);
  });

  test('a failed fetch shows the stale banner', async () => {
    devServer.setMode('fail');
    await evaluate('window.MK.refresh()');
    await new Promise((r) => setTimeout(r, 400));

    const bannerState = await evaluate(`(() => {
      const b = document.getElementById('mk-stale-banner');
      if (!b) return { exists: false };
      const style = window.getComputedStyle(b);
      return {
        exists: true,
        display: style.display,
        visible: style.display !== 'none',
        text: b.textContent.trim()
      };
    })()`);

    assert.ok(bannerState.exists, 'Stale banner element #mk-stale-banner should exist');
    assert.equal(bannerState.visible, true, 'Stale banner should be visible when server fails');
    assert.ok(bannerState.text.includes('stale') || bannerState.text.includes('Stale'), 'Stale banner should indicate stale data');
  });

  test('clicking one button per screen POSTs the expected action name', async () => {
    // Restore normal server mode and refresh state
    devServer.setMode('normal');
    await evaluate('window.MK.refresh()');
    await new Promise((r) => setTimeout(r, 400));

    const screenActionChecks = [
      ['Projects', 'button[aria-label="Sweep lanes now"]', 'sweep-lanes'],
      ['Main', 'button[aria-label="Sweep lanes now"]', 'sweep-lanes'],
      ['Lanes', 'button[aria-label="Sweep lanes now"]', 'sweep-lanes'],
      ['Plan', 'button[aria-label="Sweep lanes now"]', 'sweep-lanes'],
      ['Waiting', 'button[aria-label="Sweep lanes now"]', 'sweep-lanes'],
      ['Events', 'button.btn.sm', 'pause'],
      ['Inbox', 'button[aria-label="Sweep lanes now"]', 'sweep-lanes'],
      ['Bugs', 'button[aria-label="Sweep lanes now"]', 'sweep-lanes'],
      ['Todo', 'button[aria-label="Sweep lanes now"]', 'sweep-lanes'],
      ['Settings', 'button.btn', 'repo set-base-ref'],
      ['SettingsAgents', 'button.btn', 'settings save'],
      ['SettingsRouting', 'button[aria-label="Fewer lanes"]', 'settings save'],
      ['SettingsSafety', 'button.sw', 'settings save'],
      ['SettingsAlerts', 'button.btn', 'settings testNotification'],
      ['SettingsLook', 'button.sw', 'settings save'],
      ['SettingsShortcuts', 'button.btn', 'settings save'],
    ];

    for (const [screen, selector, expectedAction] of screenActionChecks) {
      devServer.actions.length = 0;
      await evaluate(`window.MK.go("${screen}")`);
      await new Promise((r) => setTimeout(r, 150));

      const clickResult = await evaluate(`(() => {
        const host = document.querySelector('[data-screen="${screen}"]');
        if (!host || !host.shadowRoot) return { ok: false, reason: 'no host/shadow' };
        const btn = host.shadowRoot.querySelector('${selector}');
        if (!btn) return { ok: false, reason: 'button not found: ${selector}' };
        btn.click();
        return { ok: true };
      })()`);

      assert.equal(clickResult.ok, true, `Button ${selector} on screen ${screen} should be clickable: ${clickResult.reason}`);

      // Wait for the action to reach devServer
      let foundAction = null;
      for (let i = 0; i < 20; i++) {
        if (devServer.actions.length > 0) {
          foundAction = devServer.actions[0]?.name;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      assert.equal(
        foundAction,
        expectedAction,
        `Screen ${screen} button click should trigger action ${expectedAction}, got ${foundAction}`
      );
    }
  });
});
