// Runs Orca's real plugin-host-entry.js (extracted from app.asar 1.4.239) in Orca's own binary,
// forked the same way plugin-host-process.ts does: ELECTRON_RUN_AS_NODE=1, execArgv [], advanced
// serialization, stdio [ignore,pipe,pipe,ipc], allowlisted env. Then sends init + invokeCommand.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
export const ORCA_BIN = '/Applications/Orca.app/Contents/MacOS/Orca';
export function startHost() {
  const allow = ['PATH','HOME','LANG','LC_ALL','LC_CTYPE','TZ','TMPDIR','TEMP','TMP'];
  const env = { ELECTRON_RUN_AS_NODE: '1' };
  for (const k of allow) if (process.env[k] !== undefined) env[k] = process.env[k];
  const child = fork(join(here, 'tmp/asar/plugin-host-entry.js'), [], {
    execPath: ORCA_BIN, execArgv: [], serialization: 'advanced', env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const log = { stdout: '', stderr: '', msgs: [] };
  child.stdout.on('data', (d) => (log.stdout += d));
  child.stderr.on('data', (d) => (log.stderr += d));
  const pending = new Map(); let nextId = 0; let readyRes;
  const ready = new Promise((r) => (readyRes = r));
  child.on('message', (m) => {
    log.msgs.push(m);
    if (m.type === 'ready') readyRes(m);
    if (m.type === 'fatal') readyRes(m);
    if (m.type === 'commandResult') pending.get(m.callId)?.(m);
  });
  child.send({ type: 'init', pluginId: 'spike', pluginRoot: join(here, 'plugin'), mainEntry: 'out/worker.mjs', grantedCapabilities: [] });
  return {
    child, log, ready,
    invoke(commandId, args) { const callId = nextId++; return new Promise((res) => { pending.set(callId, res); child.send({ type: 'invokeCommand', callId, commandId, args }); }); },
    async stop() { child.send({ type: 'shutdown' }); await new Promise((r) => child.once('exit', r)); },
  };
}
