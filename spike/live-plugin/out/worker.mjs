// THROWAWAY spike worker, loaded by the running Orca app as a dev plugin.
// Proves on the real worker: A2 (orca on PATH), A3 (a 127.0.0.1 server an Orca tab can load),
// A4 (worker lifetime, with and without a keep-alive host call). Results go to spike/tmp/live/.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tmp', 'live');
mkdirSync(out, { recursive: true });
const startedAt = Date.now();
const log = (kind, data) => appendFileSync(join(out, 'log.jsonl'), JSON.stringify({ at: new Date().toISOString(), up_s: Math.round((Date.now() - startedAt) / 1000), pid: process.pid, kind, ...data }) + '\n');

let server = null, info = null, keepAlive = null, beat = null;

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 10000 }, (err, stdout, stderr) =>
    resolve({ cmd: [cmd, ...args].join(' '), ok: !err, code: err ? err.code : 0, error: err ? String(err.message).slice(0, 300) : null, stdout: String(stdout).slice(0, 400), stderr: String(stderr).slice(0, 300) })));
}

async function probePath() {
  const result = { PATH: process.env.PATH, HOME: process.env.HOME };
  result.which = await run('/bin/sh', ['-c', 'command -v orca claude codex sqlite3 git gh || true']);
  result.orcaVersion = await run('orca', ['--version']);
  result.orcaStatus = await run('orca', ['status', '--json']);
  writeFileSync(join(out, 'a2-path.json'), JSON.stringify(result, null, 2));
  log('a2', { orcaOk: result.orcaVersion.ok, which: result.which.stdout.trim() });
  return result;
}

function startServer() {
  if (server) return Promise.resolve(info);
  const token = randomBytes(16).toString('hex');
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const hostOk = req.headers.host === `127.0.0.1:${server.address().port}`;
    const tokenOk = url.searchParams.get('t') === token || req.headers['x-mk-token'] === token;
    log('http', { path: url.pathname, hostOk, tokenOk, ua: String(req.headers['user-agent'] || '').slice(0, 80) });
    if (!hostOk || !tokenOk) { res.writeHead(403); res.end('forbidden'); return; }
    if (url.pathname === '/api/ping') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pid: process.pid, up_s: Math.round((Date.now() - startedAt) / 1000) }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>MK spike</title><body style="background:#020604;color:#19e35a;font:14px monospace">
<h1>MK spike server</h1><p id="s">checking…</p>
<script>fetch('/api/ping',{headers:{'x-mk-token':'${token}'}}).then(r=>r.json()).then(j=>{document.getElementById('s').textContent='fetch ok, worker pid '+j.pid+', up '+j.up_s+'s'}).catch(e=>{document.getElementById('s').textContent='fetch failed: '+e})</script>`);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    info = { port, token, url: `http://127.0.0.1:${port}/?t=${token}`, pid: process.pid };
    writeFileSync(join(out, 'a3-server.json'), JSON.stringify(info, null, 2));
    log('a3-listen', { port });
    resolve(info);
  }));
}

export default async function activate(orca) {
  log('activate', { grantedCapabilities: orca.grantedCapabilities });
  beat = setInterval(() => log('beat', {}), 30000);
  // Keep-alive: a cheap host call counts as worker activity in Orca's idle reaper.
  keepAlive = setInterval(() => {
    orca.host.call('workspace.readContext').then(() => log('keepalive', { ok: true }), (e) => log('keepalive', { ok: false, error: String(e && e.message || e) }));
  }, 60000);

  orca.events.on('agent.status.changed', (p) => log('event', { name: 'agent.status.changed', state: p && p.state }));
  orca.events.on('worktree.created', () => log('event', { name: 'worktree.created' }));

  orca.commands.register('spike-start', async () => {
    const a2 = await probePath();
    const a3 = await startServer();
    return { a2ok: a2.orcaVersion.ok, url: a3.url };
  });
  orca.commands.register('spike-keepalive-off', async () => {
    clearInterval(keepAlive); keepAlive = null; log('keepalive-off', {});
    return { keepAlive: false };
  });
  orca.commands.register('spike-status', async () => ({ pid: process.pid, up_s: Math.round((Date.now() - startedAt) / 1000), keepAlive: !!keepAlive, server: info }));

  // Run the probes at activation too, so one click on any command is enough.
  await probePath();
  await startServer();
}

export async function deactivate() {
  log('deactivate', {});
  clearInterval(beat); clearInterval(keepAlive);
  if (server) server.close();
}
