import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../out/server/index.js';

export const tmpDir = (label = 'srv') => mkdtempSync(join(tmpdir(), `mk-${label}-`));

/** A recorded Orca JSON envelope from test/fixtures/orca/<name>.json. */
export const fx = (name) => JSON.parse(readFileSync(new URL(`../fixtures/orca/${name}.json`, import.meta.url), 'utf8'));

/**
 * An Orca runner for the adapter. `routes` maps "<argv0> <argv1>" (e.g. "worktree ps", "orchestration run-list",
 * "orchestration gate-resolve") to an envelope object, or to (argv) => envelope | Error. Every call is recorded in
 * runner.calls as an argv array. A command with no route answers {ok:false,error:{code:'no_stub'}} so a test
 * notices an unexpected call.
 */
export function stubRunner(routes = {}) {
  const calls = [];
  const runner = async (argv) => {
    calls.push(argv);
    const key = `${argv[0]} ${argv[1]}`;
    let r = routes[key];
    if (typeof r === 'function') r = r(argv);
    if (r instanceof Error) throw r;
    if (r === undefined) r = { ok: false, error: { code: 'no_stub', message: `no stub for ${key}` } };
    return { stdout: JSON.stringify(r), exitCode: 0 };
  };
  runner.calls = calls;
  return runner;
}

/** The recorded reads, as routes for stubRunner. */
export function fixtureRoutes() {
  return {
    'worktree ps': fx('worktree-ps'),
    'worktree list': fx('worktree-list'),
    'terminal list': fx('terminal-list'),
    'orchestration run-list': fx('run-list'),
    'orchestration task-list': fx('task-list-big'),
    'orchestration worker-list': fx('worker-list'),
    'orchestration worker-show': fx('worker-show'),
    'orchestration gate-list': fx('gate-list'),
    'orchestration inbox': fx('inbox'),
    'account list': fx('account-list'),
    'repo list': fx('repo-list'),
    'host list': fx('host-list'),
  };
}

/** A fake clock: now() moves only with advance(); timers fire from advance() in time order. */
export function fakeClock(start = 1_800_000_000_000) {
  let t = start;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    pending: () => timers.size,
    /** Move time forward and run the timers that come due (their callbacks may be async; await a tick after). */
    advance(ms) {
      const to = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = Math.max(t, due[1].at);
        due[1].fn();
      }
      t = to;
    },
  };
}

/** Start the real service on a temp data dir with stubs and no timers. Close it with svc.close(). */
export async function startTestService(o = {}) {
  const dir = o.dir ?? tmpDir();
  const web = join(dir, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<!doctype html><html><head><title>t</title></head><body>dash</body></html>');
  const cliCalls = [];
  const svc = await startService({
    dir,
    webDir: web,
    loops: false,
    runner: o.runner ?? stubRunner({}),
    cliOrca: o.cliOrca ?? ((args) => { cliCalls.push(args); throw new Error('unexpected mk CLI orca call'); }),
    git: o.git ?? (async () => null),
    probeCli: o.probeCli ?? (async () => ({ found: false, error: 'stub' })),
    clock: o.clock,
    undoMs: o.undoMs,
    log: () => {},
  });
  svc.cliCalls = cliCalls;
  svc.dir = dir;
  return svc;
}

export const get = (svc, path, headers = {}) =>
  fetch(`http://127.0.0.1:${svc.port}${path}`, { headers: { 'x-mk-token': svc.token, ...headers } });
export const post = (svc, name, args) =>
  fetch(`http://127.0.0.1:${svc.port}/api/action`, {
    method: 'POST',
    headers: { 'x-mk-token': svc.token, 'content-type': 'application/json' },
    body: JSON.stringify({ name, args }),
  });
