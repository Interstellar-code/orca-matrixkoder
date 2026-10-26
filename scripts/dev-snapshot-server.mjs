// scripts/dev-snapshot-server.mjs
// A lightweight local server that serves test/fixtures/snapshot.json on the C7 paths,
// serves web/index.html and web/launcher.html, and logs POSTed actions.
// Used for development without SERVE and for T7 integration tests.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const FIXTURE_PATH = join(root, 'test', 'fixtures', 'snapshot.json');

const ACTION_NAMES = [
  'approve', 'rework', 'answer', 'undo', 'ask.snooze',
  'plan.start', 'plan.park', 'plan.resume', 'plan.markMerged',
  'task.start', 'task.retry', 'task.cancel',
  'inbox.import', 'inbox.reimport', 'inbox.archive', 'inbox.restore', 'inbox.delete',
  'bug.add', 'bug.fix', 'bug.close', 'bug.reopen',
  'todo.add', 'todo.done', 'todo.makeTask',
  'settings.save', 'settings.reset', 'settings.export', 'ui.remember', 'notify.test',
];

export function emptySnapshot() {
  return {
    meta: {
      schema: 1,
      at: Date.now(),
      orca: '1.4.239',
      runtimeOk: true,
      repoId: null,
      planId: null,
      runId: null,
      stale: { ps: 0, orchestration: 0, git: 0, quota: 0 },
    },
    badges: { lanes: 0, waiting: 0, inbox: 0, bugs: 0 },
    projects: {
      machine: 'this Mac',
      active: 0,
      total: 0,
      lanesLive: 0,
      waiting: 0,
      waitingList: [],
      repos: [],
    },
    overview: {
      stage: 'plan',
      stageProgress: { plan: 0, build: 0, verify: 0, merge: 0 },
      wave: [0, 0],
      lanesLive: 0,
      tasks: [0, 0],
      needsYou: 0,
      bus: null,
      decision: null,
      waves: [],
    },
    lanes: [],
    plan: {
      title: 'No plan',
      done: 0,
      total: 0,
      subtasks: 0,
      phases: [],
    },
    waiting: {
      open: [],
      resolved: [],
    },
    events: {
      cursor: 0,
      rows: [],
    },
    inbox: {
      dir: '',
      archived: 0,
      files: [],
    },
    bugs: {
      total: 0,
      needWork: 0,
      rows: [],
    },
    todo: {
      open: 0,
      done: 0,
      rows: [],
    },
    settings: {
      values: {},
      schema: {},
      migrationNotes: [],
      lastScreen: null,
      specTemplates: {},
      agents: [],
      baseBranch: 'main',
      version: '0.1.1',
    },
  };
}

export function createDevServer(options = {}) {
  const token = options.token || 'mk-dev-token-' + Math.random().toString(16).slice(2, 10);
  const fixturePath = options.snapshotPath || FIXTURE_PATH;
  let mode = options.mode || 'normal'; // 'normal' | 'empty' | 'fail'
  const recordedActions = [];

  function getSnapshot() {
    if (mode === 'empty') return emptySnapshot();
    if (existsSync(fixturePath)) {
      return JSON.parse(readFileSync(fixturePath, 'utf8'));
    }
    return emptySnapshot();
  }

  const server = createServer(async (req, res) => {
    const host = req.headers.host || '';
    const hostOk = host.startsWith('127.0.0.1') || host.startsWith('localhost');
    if (!hostOk) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('forbidden: invalid host');
      return;
    }

    const parsedUrl = new URL(req.url, `http://${host}`);
    const pathname = parsedUrl.pathname;
    const reqToken = req.headers['x-mk-token'] || parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('t');

    // CORS & CSP headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MK-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Static pages
    if (pathname === '/' || pathname === '/index.html') {
      const p = join(root, 'web', 'index.html');
      if (existsSync(p)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readFileSync(p, 'utf8'));
      } else {
        res.writeHead(404);
        res.end('web/index.html not found, run npm run build first');
      }
      return;
    }

    if (pathname === '/launcher.html') {
      const p = join(root, 'web', 'launcher.html');
      if (existsSync(p)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readFileSync(p, 'utf8'));
      } else {
        res.writeHead(404);
        res.end('web/launcher.html not found');
      }
      return;
    }

    // Test control endpoints (no auth required for test runner)
    if (pathname === '/_test/actions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(recordedActions));
      return;
    }

    if (pathname === '/_test/mode' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          mode = parsed.mode || mode;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, mode }));
        } catch (e) {
          res.writeHead(400);
          res.end(e.message);
        }
      });
      return;
    }

    // Token check for /api/
    if (pathname.startsWith('/api/')) {
      if (reqToken !== token) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'forbidden: bad or missing token' }));
        return;
      }
    }

    // /api/state
    if (pathname === '/api/state') {
      if (mode === 'fail' || parsedUrl.searchParams.get('fail') === '1') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'simulated server failure' }));
        return;
      }
      const data = parsedUrl.searchParams.get('empty') === '1' ? emptySnapshot() : getSnapshot();
      const screen = parsedUrl.searchParams.get('screen');
      // If a specific screen is asked, return the snapshot enriched or sliced per contract C6/C7
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    // /api/events
    if (pathname === '/api/events') {
      const data = getSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, events: data.events?.rows || [] }));
      return;
    }

    // /api/event/:id
    if (pathname.startsWith('/api/event/')) {
      const id = pathname.slice('/api/event/'.length);
      const data = getSnapshot();
      const ev = (data.events?.rows || []).find((r) => r.id === id || r[0] === id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, event: ev || null }));
      return;
    }

    // /api/action
    if (pathname === '/api/action' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (!parsed.name || !ACTION_NAMES.includes(parsed.name)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: { kind: 'unknown_action', message: `unknown action "${String(parsed.name || '').slice(0, 60)}"` } }));
            return;
          }
          const entry = {
            name: parsed.name,
            args: parsed.args || {},
            at: Date.now(),
          };
          recordedActions.push(entry);
          if (options.verbose) {
            console.log(`[dev-server] POST /api/action -> ${entry.name}`, entry.args);
          }
          if (parsed.name === 'notify.test') {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: { kind: 'conflict', code: 'not_ready', message: 'notifier not built yet' } }));
            return;
          }
          if (parsed.name === 'settings.export') {
            const data = getSnapshot();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, settings: data.settings?.values || {} }));
            return;
          }
          if (parsed.name === 'settings.reset') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, section: parsed.args?.section }));
            return;
          }
          if (parsed.name === 'ui.remember') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, screen: parsed.args?.screen }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: entry }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid json: ' + e.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    const port = options.port ?? 0;
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const assignedPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://127.0.0.1:${assignedPort}/?token=${token}`;
      resolve({
        server,
        port: assignedPort,
        token,
        url,
        actions: recordedActions,
        setMode: (m) => { mode = m; },
        close: () => new Promise((cb) => server.close(cb)),
      });
    });
    server.on('error', reject);
  });
}

// Standalone execution
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = parseInt(process.argv[2], 10) || 5173;
  createDevServer({ port, verbose: true }).then((inst) => {
    console.log(`MatrixKoder dev snapshot server listening on http://127.0.0.1:${inst.port}/`);
    console.log(`Dashboard URL: ${inst.url}`);
    console.log(`Token: ${inst.token}`);
    const cleanExit = () => {
      inst.close().then(() => process.exit(0));
    };
    process.on('SIGINT', cleanExit);
    process.on('SIGTERM', cleanExit);
  }).catch((err) => {
    console.error('Failed to start dev server:', err);
    process.exit(1);
  });
}
