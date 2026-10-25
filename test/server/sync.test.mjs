// T11: the real Sync class (src/server/sync.ts) against recorded Orca JSON, on a temp data dir.
// Spec: mk-data-schema.md section 4 (sync rules) and section 3 (lifecycles). Never touches ~/.matrixkoder or the real `orca`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../../out/store/db.js';
import { importFile } from '../../out/store/import.js';
import { GONE_AFTER_COMPLETE_PULLS } from '../../out/server/sync.js';
import { fakeClock, fixtureRoutes, fx, startTestService, stubRunner, tmpDir } from './helpers.mjs';

const T0 = 1_792_930_000_000; // just after the recorded fixtures
const RUN = 'run_aa2cc2982670'; // the fixture run with tasks, workers and inbox traffic
const RUN2 = 'run_aa8ea15012d0';
const REPO = '4d01f6f8-887c-47fb-af0d-5387e7248caf'; // repo that owns RUN in the fixtures
const REAL_PLAN = new URL('../../.matrixkoder/inbox/orca-dashboard-wiring.md', import.meta.url).pathname;
const PLAN_NAME = 'orca-dashboard-wiring.md';

// ---------------------------------------------------------------- helpers

const clone = (v) => structuredClone(v);
const settle = async (n = 40) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
const q = (db, sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
const q1 = (db, sql, ...p) => q(db, sql, ...p)[0];
const val = (db, sql, ...p) => {
  const r = q1(db, sql, ...p);
  return r ? Object.values(r)[0] : undefined;
};
const ms = (iso) => Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:/.test(iso) ? `${iso.replace(' ', 'T')}Z` : iso);
const okEnv = (result) => ({ ok: true, result });
const key = (argv) => `${argv[0]} ${argv[1]}`;
const callsOf = (runner, k) => runner.calls.filter((a) => key(a) === k);

/** A git stub that answers like a healthy checkout, so every sync source succeeds. */
const okGit = async (_cwd, args) => {
  if (args[0] === 'rev-list') return '2';
  if (args[0] === 'diff') return ' 1 file changed, 3 insertions(+), 1 deletion(-)';
  if (args[0] === 'status') return ' M a.txt';
  if (args[0] === 'symbolic-ref') return 'refs/remotes/origin/main';
  return null;
};

/** Mutable Orca world: every route reads the current value of w.<name>, and w.fail turns every read into a failure. */
function world() {
  const w = {
    ps: fx('worktree-ps'), wl: fx('worktree-list'), terms: fx('terminal-list'), runs: fx('run-list'),
    tasks: fx('task-list-big'), workers: fx('worker-list'), show: fx('worker-show'), gates: fx('gate-list'),
    inbox: fx('inbox'), accounts: fx('account-list'), repos: fx('repo-list'), hosts: fx('host-list'),
    fail: null,
    failOnly: new Set(),
  };
  const pick = (name, k) => () => {
    if (w.fail === 'envelope' || w.failOnly.has(k)) return { ok: false, error: { code: 'boom', message: 'orca is down' } };
    if (w.fail === 'throw') return new Error('spawn failed');
    return w[name];
  };
  w.routes = {
    'worktree ps': pick('ps', 'worktree ps'),
    'worktree list': pick('wl', 'worktree list'),
    'terminal list': pick('terms', 'terminal list'),
    'orchestration run-list': pick('runs', 'orchestration run-list'),
    'orchestration task-list': pick('tasks', 'orchestration task-list'),
    'orchestration worker-list': pick('workers', 'orchestration worker-list'),
    'orchestration worker-show': pick('show', 'orchestration worker-show'),
    'orchestration gate-list': pick('gates', 'orchestration gate-list'),
    'orchestration inbox': pick('inbox', 'orchestration inbox'),
    'account list': pick('accounts', 'account list'),
    'repo list': pick('repos', 'repo list'),
    'host list': pick('hosts', 'host list'),
  };
  return w;
}

function trackBugRun(db, repoId = REPO, runId = RUN, path = '/placeholder') {
  db.prepare('INSERT INTO repo(id,path,display_name,kind,first_seen_at,last_seen_at,bug_run_id) VALUES(?,?,?,?,?,?,?)').run(repoId, path, 'tracked', 'git', 1, 1, runId);
}

/** Start the real service on a temp dir with stubs and a fake clock. */
async function boot(t, o = {}) {
  const w = o.w ?? world();
  const clock = o.clock ?? fakeClock(T0);
  const runner = o.runner ?? stubRunner(w.routes);
  const svc = await startTestService({ runner, clock, git: o.git ?? okGit, dir: o.dir });
  let closed = false;
  svc.shutdown = async () => {
    if (!closed) {
      closed = true;
      await svc.close();
    }
  };
  t.after(() => svc.shutdown());
  const db = svc.ctx.db;
  if (o.track !== false) trackBugRun(db);
  return { svc, db, w, runner, clock };
}

const addTask = (w, id, status, result = null) => {
  const base = clone(w.tasks.result.tasks[0]);
  w.tasks.result.tasks.push({ ...base, id, status, result, completed_at: null });
};
const setTask = (w, id, patch) => Object.assign(w.tasks.result.tasks.find((x) => x.id === id), patch);
const gate = (id, taskId, status, extra = {}) => ({
  id, run_id: RUN, task_id: taskId, question: `Approve ${id}?\nDetails for ${id}`, options: '["approve","rework"]',
  status, resolution: null, created_at: '2026-10-25T02:10:00Z', resolved_at: null, ...extra,
});
const msg = (o) => ({
  id: o.id ?? `msg_t${o.sequence}`, run_id: RUN, delivery_contract: 'current_delivery', from_handle: o.from, to_handle: o.to,
  subject: o.subject ?? `subject ${o.sequence}`, body: o.body ?? '', type: o.type, priority: 'normal', thread_id: o.thread ?? null,
  payload: o.payload === undefined ? null : JSON.stringify(o.payload), read: 0, sequence: o.sequence, created_at: o.at,
  delivered_at: null, sender_pane_key: null, pointer_enter_pending: 0, pointer_pty_id: null, pointer_process_incarnation: null,
});

/** The fully set-up world of test 1/2: a tracked run, two bugs on fixture tasks, a bug that waits, and two gates. */
async function fullWorld(t) {
  const ctx = await boot(t);
  const { db, w } = ctx;
  addTask(w, 'task_bug_wait', 'dispatched');
  w.gates.result = { runId: RUN, count: 3, gates: [
    gate('gate_p1', 'task_cae84c459bb0', 'pending'),
    gate('gate_r1', 'task_ef719b77ef10', 'resolved', { resolution: 'approved', resolved_at: '2026-10-25T02:20:00Z' }),
    gate('gate_bw', 'task_bug_wait', 'pending'),
  ] };
  const bug = db.prepare("INSERT INTO bug(id,repo_id,title,status,orca_run_id,orca_task_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
  bug.run('b-fixed', REPO, 'completed task', 'fixing', RUN, 'task_7b50bdbc7dfa', 1, 1);
  bug.run('b-failed', REPO, 'failed task', 'fixing', RUN, 'task_60555b90ea31', 1, 1);
  bug.run('b-wait', REPO, 'asked task', 'fixing', RUN, 'task_bug_wait', 1, 1);
  await ctx.svc.sync.pullAll();
  await ctx.svc.sync.pullAll(); // the second pull lets worker-show fill the dispatches the first one had no room for
  return ctx;
}

function tables(db) {
  return q(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
}

// ---------------------------------------------------------------- 1. fixtures map to cache rows

test('T11.1 a pull with the recorded fixtures fills repo, worktree, pane, run, quota, kv and sync_state', async (t) => {
  const { db, w } = await fullWorld(t);
  const ps = w.ps.result;

  // repo
  const rawRepos = w.repos.result.repos;
  assert.ok(rawRepos.length >= 2);
  for (const r of rawRepos) {
    const row = q1(db, 'SELECT * FROM repo WHERE id = ?', r.id);
    assert.ok(row, `repo ${r.id}`);
    assert.equal(row.display_name, r.displayName);
    assert.equal(row.path, r.path);
    assert.equal(row.added_at, r.addedAt);
    assert.equal(row.gone_at, null);
  }
  assert.equal(val(db, 'SELECT bug_run_id FROM repo WHERE id = ?', REPO), RUN, 'the repo pull keeps the MK-owned bug_run_id');

  // worktree: head from worktree-list (7 chars), branch without refs/heads/
  assert.equal(val(db, 'SELECT count(*) FROM worktree'), ps.worktrees.length);
  for (const x of ps.worktrees) {
    const row = q1(db, 'SELECT * FROM worktree WHERE id = ?', x.worktreeId);
    assert.ok(row, `worktree ${x.worktreeId}`);
    assert.equal(row.repo_id, x.repoId);
    assert.equal(row.path, x.path);
    assert.equal(row.branch, x.branch.replace(/^refs\/heads\//, ''));
    assert.ok(!row.branch.startsWith('refs/'));
    assert.equal(row.is_main, x.isMainWorktree ? 1 : 0);
    assert.equal(row.gone_at, null);
    const listed = w.wl.result.worktrees.find((l) => l.id === x.worktreeId);
    assert.ok(listed, 'worktree-list has the same worktree');
    assert.equal(row.head, listed.head.slice(0, 7));
    assert.match(row.head, /^[0-9a-f]{7}$/);
  }

  // pane: agent columns from ps, every terminal on exactly one pane
  let agents = 0;
  for (const x of ps.worktrees) {
    for (const a of x.agents) {
      agents++;
      const row = q1(db, 'SELECT * FROM pane WHERE pane_key = ?', a.paneKey);
      assert.ok(row, `pane ${a.paneKey}`);
      assert.equal(row.worktree_id, x.worktreeId);
      assert.equal(row.agent_type, a.agentType);
      assert.equal(row.agent_state, a.state);
      assert.equal(row.agent_state_since, a.stateStartedAt);
      assert.equal(row.agent_updated_at, a.updatedAt);
      assert.equal(row.gone_at, null);
    }
  }
  assert.ok(agents >= 3);
  for (const tm of w.terms.result.terminals) {
    assert.equal(val(db, 'SELECT count(*) FROM pane WHERE terminal_handle = ?', tm.handle), 1, `terminal ${tm.handle} sits on one pane`);
  }

  // run: ISO to epoch ms, the legacy placeholder is not stored
  const rawRuns = w.runs.result.runs;
  assert.ok(rawRuns.some((r) => r.id === 'run_legacy_local'), 'fixture has the legacy run');
  assert.equal(q1(db, "SELECT * FROM run WHERE id = 'run_legacy_local'"), undefined);
  const real = rawRuns.filter((r) => r.id !== 'run_legacy_local' && !r.legacy);
  assert.equal(val(db, 'SELECT count(*) FROM run'), real.length);
  for (const r of real) {
    const row = q1(db, 'SELECT * FROM run WHERE id = ?', r.id);
    assert.equal(row.created_at, ms(r.created_at));
    assert.equal(row.updated_at, ms(r.updated_at));
    assert.equal(row.coordinator_handle, r.coordinator_handle);
    assert.equal(row.gone_at, null);
  }
  assert.equal(val(db, 'SELECT repo_id FROM run WHERE id = ?', RUN), REPO, 'a tracked run is tied to its repo');

  // quota
  const limits = w.accounts.result.rateLimits;
  assert.deepEqual(new Set(q(db, 'SELECT provider FROM quota').map((r) => r.provider)), new Set(Object.keys(limits).filter((k) => limits[k] && typeof limits[k].provider === 'string'))); // keyed as rateLimits.<provider> (spec section 4)
  for (const win of ['session', 'weekly']) {
    const row = q1(db, 'SELECT * FROM quota WHERE provider = ? AND win = ?', 'claude', win);
    assert.equal(row.used_percent, limits.claude[win].usedPercent);
    assert.equal(row.window_minutes, limits.claude[win].windowMinutes);
    assert.equal(row.resets_at, limits.claude[win].resetsAt);
  }

  // kv host.machine_name
  const local = w.hosts.result.hosts.find((h) => h.kind === 'local');
  assert.equal(val(db, "SELECT value FROM kv WHERE key = 'host.machine_name'"), local.machineName);

  // sync_state: one row per source, with last_ok_at and items, no error
  const want = {
    ps: ps.worktrees.length, 'worktree-list': w.wl.result.worktrees.length, terminals: w.terms.result.terminals.length, runs: real.length,
    [`tasks:${RUN}`]: w.tasks.result.tasks.length, [`workers:${RUN}`]: w.workers.result.workers.length, [`gates:${RUN}`]: 3,
    inbox: w.inbox.result.messages.length, repos: rawRepos.length, hosts: w.hosts.result.hosts.length,
  };
  for (const [source, items] of Object.entries(want)) {
    const row = q1(db, 'SELECT * FROM sync_state WHERE source = ?', source);
    assert.ok(row, `sync_state ${source}`);
    assert.equal(row.items, items, `${source} items`);
    assert.equal(row.last_error, null, `${source} error`);
    assert.equal(row.last_error_at, null);
  }
  for (const source of [...Object.keys(want), 'quota', 'git']) {
    const row = q1(db, 'SELECT * FROM sync_state WHERE source = ?', source);
    assert.ok(row, `sync_state ${source}`);
    assert.equal(typeof row.last_ok_at, 'number', `${source} last_ok_at`);
    assert.equal(typeof row.items, 'number');
    assert.equal(row.last_error, null);
  }
  assert.equal(val(db, 'SELECT count(*) FROM sync_state'), Object.keys(want).length + 2, 'one row per source');
});

test('T11.1 lanes, asks, task states and bugs from the tracked run', async (t) => {
  const { db, w } = await fullWorld(t);

  // lanes from worker-list
  const workers = w.workers.result.workers;
  for (const x of workers) {
    const lane = q1(db, 'SELECT * FROM lane WHERE dispatch_id = ?', x.dispatchId);
    assert.ok(lane, `lane for ${x.dispatchId}`);
    assert.equal(lane.lane_key, `dsp:${x.dispatchId}`);
    assert.equal(lane.kind, 'dispatch');
    assert.equal(lane.run_id, RUN);
    assert.equal(lane.worker_state, x.workerState);
    assert.equal(lane.dispatch_status, x.dispatchStatus);
    assert.equal(lane.orca_task_id, x.taskId);
    assert.equal(lane.terminal_handle, x.agentTerminalHandle);
    assert.equal(lane.liveness, x.projection.liveness.verdict);
    assert.equal(lane.requires_action, x.projection.attention.requiresAction ? 1 : 0);
    assert.equal(lane.attention, x.projection.attention.categories.join(','));
    if (x.resource?.worktreeId) {
      assert.equal(lane.worktree_id, x.resource.worktreeId);
      const wt = q1(db, 'SELECT repo_id FROM worktree WHERE id = ?', x.resource.worktreeId);
      if (wt) assert.equal(lane.repo_id, wt.repo_id);
    }
    assert.equal(lane.started_at, ms(w.show.result.dispatch.dispatchedAt), 'worker-show filled started_at');
  }
  assert.deepEqual(q(db, 'SELECT repo_id, label, count(*) c FROM lane GROUP BY repo_id, label HAVING c > 1'), [], 'a label is unique per repo');
  assert.equal(val(db, 'SELECT state FROM lane WHERE dispatch_id = ?', 'ctx_f18a42f2381f'), 'done');
  assert.equal(val(db, 'SELECT state FROM lane WHERE dispatch_id = ?', 'ctx_110dcf08ae68'), 'failed');
  assert.notEqual(val(db, 'SELECT ended_at FROM lane WHERE dispatch_id = ?', 'ctx_110dcf08ae68'), null);

  // question asks: answered when a later non-heartbeat message is addressed to the asker
  const msgs = w.inbox.result.messages;
  const questions = msgs.filter((m) => m.type === 'question');
  assert.ok(questions.length >= 3);
  const statuses = new Set();
  for (const m of questions) {
    const reply = msgs.find((r) => r.sequence > m.sequence && r.to_handle === m.from_handle && r.type !== 'heartbeat' && r.type !== 'question');
    const p = JSON.parse(m.payload);
    const row = q1(db, 'SELECT * FROM ask WHERE id = ?', m.id);
    assert.ok(row, `ask ${m.id}`);
    assert.equal(row.kind, 'question');
    assert.equal(row.run_id, RUN);
    assert.equal(row.orca_status, reply ? 'answered' : 'pending', `status of ${m.id}`);
    assert.equal(row.orca_task_id, p.taskId);
    assert.equal(row.dispatch_id, p.dispatchId);
    assert.equal(row.asked_at, ms(m.created_at));
    assert.equal(row.resolved_at, reply ? ms(reply.created_at) : null);
    assert.deepEqual(JSON.parse(row.options), p.options);
    statuses.add(row.orca_status);
  }
  assert.deepEqual([...statuses].sort(), ['answered', 'pending'], 'the fixture has both an answered and a pending question');
  assert.equal(val(db, "SELECT orca_status FROM ask WHERE id = 'msg_f63362af4aa9'"), 'pending');

  // gate asks
  const g1 = q1(db, "SELECT * FROM ask WHERE id = 'gate_p1'");
  assert.equal(g1.kind, 'gate');
  assert.equal(g1.orca_status, 'pending');
  assert.equal(g1.orca_task_id, 'task_cae84c459bb0');
  assert.equal(g1.title, 'Approve gate_p1?');
  assert.equal(g1.body, 'Details for gate_p1');
  assert.deepEqual(JSON.parse(g1.options), ['approve', 'rework']);
  assert.equal(g1.asked_at, ms('2026-10-25T02:10:00Z'));
  const g2 = q1(db, "SELECT * FROM ask WHERE id = 'gate_r1'");
  assert.equal(g2.orca_status, 'resolved');
  assert.equal(g2.resolution, 'approved');
  assert.equal(g2.resolved_at, ms('2026-10-25T02:20:00Z'));
  assert.equal(val(db, "SELECT count(*) FROM event_log WHERE kind = 'ask' AND ref = 'ask:gate_p1'"), 1, 'a new pending gate logs one ask event');
  assert.equal(val(db, "SELECT count(*) FROM event_log WHERE ref = 'ask:gate_r1'"), 0, 'a gate first seen already resolved logs nothing');

  // bugs follow their Orca task (3.5)
  const fixed = q1(db, "SELECT * FROM bug WHERE id = 'b-fixed'");
  assert.equal(fixed.last_state, 'completed');
  assert.equal(typeof fixed.last_state_at, 'number');
  assert.equal(fixed.status, 'fixed');
  assert.equal(typeof fixed.fixed_at, 'number');
  const failed = q1(db, "SELECT * FROM bug WHERE id = 'b-failed'");
  assert.equal(failed.last_state, 'failed');
  assert.equal(failed.status, 'open');
  assert.equal(failed.fixed_at, null);
  const waiting = q1(db, "SELECT * FROM bug WHERE id = 'b-wait'");
  assert.equal(waiting.last_state, 'dispatched');
  assert.equal(waiting.status, 'waiting', 'a pending gate on the bug task shows waiting');
});

// ---------------------------------------------------------------- 2. ISO to ms

test('T11.2 every Orca ISO time is an integer of epoch ms in the database', async (t) => {
  const { svc, db, w } = await fullWorld(t);
  // a heartbeat for a known dispatch, so lane.last_heartbeat_at is filled by a message too
  w.inbox.result.messages.push(msg({
    sequence: 500, type: 'heartbeat', from: 'dispatch:ctx_f18a42f2381f', to: `run:${RUN}`, at: '2030-01-02T03:04:05Z',
    payload: { dispatchId: 'ctx_f18a42f2381f', taskId: 'task_482f4dae657a', phase: 'verifying' },
  }));
  await svc.sync.pullFast();

  const checks = [
    ['run', 'created_at'], ['run', 'updated_at'], ['ask', 'asked_at'], ['ask', 'first_seen_at'], ['lane', 'started_at'],
    ['lane', 'last_heartbeat_at'], ['event_log', 'at'], ['worktree', 'last_activity_at'], ['pane', 'agent_state_since'],
    ['repo', 'added_at'], ['quota', 'resets_at'], ['bug', 'last_state_at'], ['sync_state', 'last_ok_at'], ['sync_state', 'last_try_at'],
  ];
  for (const [table, col] of checks) {
    const types = q(db, `SELECT DISTINCT typeof(${col}) AS ty FROM ${table} WHERE ${col} IS NOT NULL`).map((r) => r.ty);
    assert.ok(types.length > 0, `${table}.${col} has values`);
    assert.deepEqual(types, ['integer'], `${table}.${col} is integer`);
  }
  assert.equal(typeof val(db, "SELECT resolved_at FROM ask WHERE orca_status IN ('answered','resolved') LIMIT 1"), 'number');
  assert.equal(val(db, "SELECT last_heartbeat_at FROM lane WHERE dispatch_id = 'ctx_f18a42f2381f'"), Date.parse('2030-01-02T03:04:05Z'));
  assert.equal(val(db, "SELECT phase FROM lane WHERE dispatch_id = 'ctx_f18a42f2381f'"), 'verifying');

  // no cell anywhere keeps an ISO string as its value
  for (const tb of tables(db)) {
    for (const row of q(db, `SELECT * FROM ${tb}`)) {
      for (const [col, v] of Object.entries(row)) {
        if (typeof v === 'string') assert.doesNotMatch(v, /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/, `${tb}.${col} holds an ISO time`);
      }
    }
  }
});

// ---------------------------------------------------------------- 3. no prompt text

/** Walk a JSON value; collect string leaves under keys that carry conversation text. */
function collectSecrets(doc, keys, out) {
  const leaves = (v) => {
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) v.forEach(leaves);
    else if (v && typeof v === 'object') Object.values(v).forEach(leaves);
  };
  (function walk(v) {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (keys.has(k)) leaves(x);
        walk(x);
      }
    }
  })(doc);
}

test('T11.3 prompt, assistant text, tool input, previews and message bodies never reach the database', async (t) => {
  const { svc, db, w } = await boot(t);
  const keys = new Set(['prompt', 'lastAssistantMessage', 'toolInput', 'preview', 'body']);
  const secrets = new Set();
  // the recorded values first (redacted placeholders), then distinct text injected into deep copies
  for (const name of ['ps', 'terms', 'show', 'workers', 'inbox']) collectSecrets(w[name], keys, secrets);
  let n = 0;
  const inject = (doc) => {
    (function walk(v) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) {
          if (k === 'prompt') v[k] = `SECRET-PROMPT-${++n} please do the secret thing`;
          else if (k === 'lastAssistantMessage') v[k] = `SECRET-ASSISTANT-${++n} I did the secret thing`;
          else if (k === 'toolInput') v[k] = { command: `SECRET-TOOLINPUT-${++n} rm -rf /secret` };
          else if (k === 'preview') v[k] = `SECRET-PREVIEW-${++n} terminal tail`;
          else walk(v[k]);
        }
      }
    })(doc);
  };
  for (const name of ['ps', 'terms', 'show', 'workers']) inject(w[name]);
  // make sure each of the four keys is present at least once
  w.ps.result.worktrees[1].agents[0].toolInput = { command: 'SECRET-TOOLINPUT-X rm -rf /secret' };
  w.ps.result.worktrees[1].agents[0].prompt = 'SECRET-PROMPT-X please do the secret thing';
  w.ps.result.worktrees[1].agents[0].lastAssistantMessage = 'SECRET-ASSISTANT-X I did the secret thing';
  for (const m of w.inbox.result.messages) if (m.type !== 'heartbeat') m.body = `SECRET-MSGBODY-${m.sequence} the whole message text`;
  w.inbox.result.messages.push(msg({
    sequence: 501, type: 'heartbeat', from: 'dispatch:ctx_f18a42f2381f', to: `run:${RUN}`, at: '2026-10-25T03:00:00Z', body: 'SECRET-HEARTBEAT-BODY text',
    payload: { dispatchId: 'ctx_f18a42f2381f', phase: 'working' },
  }));
  w.inbox.result.messages.push(msg({
    sequence: 502, type: 'status', from: `run:${RUN}`, to: 'dispatch:ctx_f18a42f2381f', at: '2026-10-25T03:01:00Z', body: 'SECRET-STATUS-BODY text',
    payload: { dispatchId: 'ctx_f18a42f2381f' },
  }));
  collectSecrets(w.ps, keys, secrets);
  collectSecrets(w.terms, keys, secrets);
  collectSecrets(w.show, keys, secrets);
  collectSecrets(w.inbox, keys, secrets);
  const list = [...secrets].filter((s) => s.length >= 8);
  assert.ok(list.some((s) => s.startsWith('SECRET-PROMPT')));
  assert.ok(list.some((s) => s.startsWith('SECRET-ASSISTANT')));
  assert.ok(list.some((s) => s.startsWith('SECRET-TOOLINPUT')));
  assert.ok(list.some((s) => s.startsWith('SECRET-PREVIEW')));
  assert.ok(list.some((s) => s.startsWith('SECRET-MSGBODY')));
  assert.ok(list.some((s) => s.startsWith('[redacted')), 'recorded placeholders are scanned too');

  await svc.sync.pullAll();
  await svc.sync.pullAll();
  assert.ok(val(db, 'SELECT count(*) FROM event_log') > 0, 'the scan is not vacuous');

  let cells = 0;
  for (const tb of tables(db)) {
    for (const row of q(db, `SELECT * FROM ${tb}`)) {
      for (const [col, v] of Object.entries(row)) {
        if (typeof v !== 'string') continue;
        cells++;
        for (const s of list) assert.ok(!v.includes(s), `${tb}.${col} contains conversation text: ${s.slice(0, 40)}`);
      }
    }
  }
  assert.ok(cells > 100);

  // events: heartbeats are never rows, and no payload carries a message body
  assert.equal(val(db, "SELECT count(*) FROM event_log WHERE text LIKE 'heartbeat%'"), 0);
  assert.equal(val(db, "SELECT count(*) FROM event_log WHERE ref IN ('msg:msg_0e0a077281e4','msg:msg_e40acb3f46ad','msg:msg_t501')"), 0);
  let withPayload = 0;
  for (const r of q(db, 'SELECT kind, payload FROM event_log WHERE payload IS NOT NULL')) {
    withPayload++;
    const p = JSON.parse(r.payload);
    assert.ok(!('body' in p), 'payload has no body key');
    assert.notEqual(p.type, 'heartbeat');
    assert.notEqual(r.kind, 'heartbeat');
  }
  assert.ok(withPayload > 0);
  assert.equal(val(db, "SELECT count(*) FROM event_log WHERE payload LIKE '%\"body\"%'"), 0);
});

// ---------------------------------------------------------------- 4. gone rules (K13)

const WT_BRANCH = 'refs/heads/v3/rel8';
const WT_TWO_PANES = 'refs/heads/Interstellar-code/lane-orca'; // an agent pane plus a terminal-only pane
const psWithout = (ps, wid, o = {}) => {
  const c = clone(ps);
  c.result.worktrees = c.result.worktrees.filter((x) => x.worktreeId !== wid);
  c.result.totalCount = c.result.worktrees.length;
  if (o.truncated) c.result.truncated = true;
  if (o.omitted) c.result.hostScope.omittedHostIds = o.omitted;
  return c;
};
const termsWithout = (terms, pred, o = {}) => {
  const c = clone(terms);
  c.result.terminals = c.result.terminals.filter((x) => !pred(x));
  c.result.totalCount = c.result.terminals.length;
  if (o.truncated) c.result.truncated = true;
  return c;
};
const goneWorktrees = (db) => val(db, 'SELECT count(*) FROM worktree WHERE gone_at IS NOT NULL');
const gonePanes = (db) => val(db, 'SELECT count(*) FROM pane WHERE gone_at IS NOT NULL');

test('T11.4a an incomplete worktree ps (truncated:true) never sets gone_at, however often it is pulled', async (t) => {
  const { svc, db, w } = await boot(t);
  const base = { ps: clone(w.ps), terms: clone(w.terms) };
  const W = base.ps.result.worktrees.find((x) => x.branch === WT_BRANCH);
  assert.ok(W && W.agents.length === 1, 'fixture worktree with one agent');
  await svc.sync.pullFast();
  await svc.sync.pullFast();
  assert.equal(goneWorktrees(db), 0);
  assert.equal(gonePanes(db), 0);

  w.ps = psWithout(base.ps, W.worktreeId, { truncated: true });
  w.terms = termsWithout(base.terms, (x) => x.worktreeId === W.worktreeId);
  for (let i = 0; i < 6; i++) {
    await svc.sync.pullFast();
    assert.equal(goneWorktrees(db), 0, `pull ${i + 1}: no worktree gone`);
    assert.equal(gonePanes(db), 0, `pull ${i + 1}: no pane gone`);
  }
  assert.equal(val(db, 'SELECT gone_at FROM worktree WHERE id = ?', W.worktreeId), null);
  assert.equal(val(db, 'SELECT gone_at FROM pane WHERE pane_key = ?', W.agents[0].paneKey), null);

  // the truncated pulls did not count: it takes GONE_AFTER_COMPLETE_PULLS complete ones from here
  w.ps = psWithout(base.ps, W.worktreeId);
  for (let i = 1; i < GONE_AFTER_COMPLETE_PULLS; i++) {
    await svc.sync.pullFast();
    assert.equal(goneWorktrees(db), 0, `complete pull ${i} is not enough`);
  }
  await svc.sync.pullFast();
  assert.equal(typeof val(db, 'SELECT gone_at FROM worktree WHERE id = ?', W.worktreeId), 'number');
});

test('T11.4a a pull with omitted hosts (hostScope.omittedHostIds) is incomplete too', async (t) => {
  const { svc, db, w } = await boot(t);
  const base = { ps: clone(w.ps), terms: clone(w.terms) };
  const W = base.ps.result.worktrees.find((x) => x.branch === WT_BRANCH);
  await svc.sync.pullFast();
  w.ps = psWithout(base.ps, W.worktreeId, { omitted: ['ssh-1792462802357-vkq5ca'] });
  w.terms = termsWithout(base.terms, (x) => x.worktreeId === W.worktreeId);
  for (let i = 0; i < 5; i++) await svc.sync.pullFast();
  assert.equal(goneWorktrees(db), 0, 'an omitted host means the list is partial (spec section 4)');
  assert.equal(gonePanes(db), 0);
});

test('T11.4a a partial worker page or run page does not stop lanes or mark runs gone', async (t) => {
  const { svc, db, w } = await boot(t);
  await svc.sync.pullFast();
  await svc.sync.pullFast();
  // worker-list says hasMore: the missing workers might be on the next page
  w.workers = clone(w.workers);
  w.workers.result.workers = w.workers.result.workers.slice(0, 2);
  w.workers.result.page.hasMore = true;
  // run-list has a next page
  w.runs = clone(w.runs);
  w.runs.result.runs = w.runs.result.runs.filter((r) => r.id === RUN || r.id === 'run_legacy_local');
  w.runs.result.nextCursor = 'next-page';
  for (let i = 0; i < 5; i++) await svc.sync.pullFast();
  assert.equal(val(db, "SELECT count(*) FROM lane WHERE kind = 'dispatch' AND state = 'stopped'"), 0);
  assert.equal(val(db, 'SELECT count(*) FROM run WHERE gone_at IS NOT NULL'), 0);
});

test('T11.4b a failed pull (error envelope or a throw) changes nothing and records sync_state.last_error', async (t) => {
  const { svc, db, w, clock } = await boot(t);
  await svc.sync.pullAll();
  await svc.sync.pullAll();
  const dump = () => {
    const out = {};
    for (const tb of tables(db)) {
      if (tb === 'sync_state') continue;
      out[tb] = q(db, `SELECT * FROM ${tb} ORDER BY rowid`).map((r) => Object.fromEntries(Object.entries(r).filter(([c]) => !c.startsWith('git_'))));
    }
    return out;
  };
  const before = dump();
  const okAt = Object.fromEntries(q(db, 'SELECT source, last_ok_at FROM sync_state').map((r) => [r.source, r.last_ok_at]));
  assert.ok(Object.keys(okAt).length >= 10);
  clock.advance(30_000); // any write that stamps the time would now differ

  for (const mode of ['envelope', 'throw']) {
    w.fail = mode;
    for (let i = 0; i < 4; i++) await svc.sync.pullAll(); // more than GONE_AFTER_COMPLETE_PULLS
    assert.deepEqual(dump(), before, `${mode}: no table changed`);
    for (const source of ['ps', 'worktree-list', 'terminals', 'runs', `tasks:${RUN}`, `workers:${RUN}`, `gates:${RUN}`, 'inbox', 'repos', 'quota', 'hosts']) {
      const row = q1(db, 'SELECT * FROM sync_state WHERE source = ?', source);
      assert.ok(row.last_error && row.last_error.length > 0, `${mode}: ${source} records its error`);
      assert.equal(typeof row.last_error_at, 'number');
      assert.equal(row.last_ok_at, okAt[source], `${mode}: ${source} keeps its last good time`);
    }
  }
  assert.equal(goneWorktrees(db), 0);
  assert.equal(gonePanes(db), 0);

  w.fail = null;
  await svc.sync.pullAll();
  for (const source of ['ps', 'inbox', 'repos']) assert.equal(val(db, 'SELECT last_error FROM sync_state WHERE source = ?', source), null, `${source} recovers`);
});

test('T11.4b one failing source does not stop the others, and does not count as a miss', async (t) => {
  const { svc, db, w } = await boot(t);
  await svc.sync.pullFast();
  const base = clone(w.ps);
  const W = base.result.worktrees.find((x) => x.branch === WT_BRANCH);
  // worktree ps fails while the worktree is also absent from nothing: only ps is down
  w.failOnly.add('worktree ps');
  for (let i = 0; i < 4; i++) await svc.sync.pullFast();
  assert.match(val(db, "SELECT last_error FROM sync_state WHERE source = 'ps'"), /boom|down/);
  assert.equal(val(db, "SELECT last_error FROM sync_state WHERE source = 'inbox'"), null);
  assert.equal(val(db, "SELECT last_error FROM sync_state WHERE source = 'terminals'"), null);
  assert.equal(goneWorktrees(db), 0);
  assert.equal(val(db, 'SELECT gone_at FROM worktree WHERE id = ?', W.worktreeId), null);
});

test('T11.4c a worktree missing from complete pulls goes gone after GONE_AFTER_COMPLETE_PULLS, and clears when it reappears', async (t) => {
  assert.equal(GONE_AFTER_COMPLETE_PULLS, 2);
  const { svc, db, w, clock } = await boot(t);
  const base = { ps: clone(w.ps), terms: clone(w.terms) };
  const W = base.ps.result.worktrees.find((x) => x.branch === WT_TWO_PANES);
  const P = W.agents[0].paneKey;
  await svc.sync.pullFast();
  await svc.sync.pullFast();
  assert.equal(val(db, 'SELECT count(*) FROM pane WHERE worktree_id = ?', W.worktreeId) >= 2, true, 'the worktree has an agent pane and a terminal pane');

  w.ps = psWithout(base.ps, W.worktreeId);
  w.terms = termsWithout(base.terms, (x) => x.worktreeId === W.worktreeId);
  await svc.sync.pullFast();
  assert.equal(val(db, 'SELECT gone_at FROM worktree WHERE id = ?', W.worktreeId), null, 'not gone after 1 complete pull');
  assert.equal(gonePanes(db), 0);

  clock.advance(10_000);
  await svc.sync.pullFast();
  const goneAt = val(db, 'SELECT gone_at FROM worktree WHERE id = ?', W.worktreeId);
  assert.equal(goneAt, clock.now(), 'gone after 2 complete pulls');
  assert.equal(goneWorktrees(db), 1, 'only the missing worktree');
  const panes = q(db, 'SELECT pane_key, gone_at FROM pane WHERE worktree_id = ?', W.worktreeId);
  assert.ok(panes.length >= 2);
  for (const p of panes) assert.equal(typeof p.gone_at, 'number', `pane ${p.pane_key} of a gone worktree is gone`);
  assert.equal(val(db, 'SELECT count(*) FROM pane WHERE worktree_id <> ? AND gone_at IS NOT NULL', W.worktreeId), 0);

  // it comes back: gone_at clears on the worktree and its panes
  w.ps = clone(base.ps);
  w.terms = clone(base.terms);
  await svc.sync.pullFast();
  assert.equal(val(db, 'SELECT gone_at FROM worktree WHERE id = ?', W.worktreeId), null);
  assert.equal(val(db, 'SELECT gone_at FROM pane WHERE pane_key = ?', P), null);
  assert.equal(gonePanes(db), 0);
  assert.equal(goneWorktrees(db), 0);
});

test('T11.4c the misses must be consecutive: a pull that sees it again starts the count over', async (t) => {
  const { svc, db, w } = await boot(t);
  const base = { ps: clone(w.ps), terms: clone(w.terms) };
  const W = base.ps.result.worktrees.find((x) => x.branch === WT_BRANCH);
  await svc.sync.pullFast();
  const missing = () => {
    w.ps = psWithout(base.ps, W.worktreeId);
    w.terms = termsWithout(base.terms, (x) => x.worktreeId === W.worktreeId);
  };
  missing();
  await svc.sync.pullFast(); // miss 1
  w.ps = clone(base.ps);
  w.terms = clone(base.terms);
  await svc.sync.pullFast(); // seen again
  missing();
  await svc.sync.pullFast(); // miss 1 again
  assert.equal(goneWorktrees(db), 0);
  await svc.sync.pullFast(); // miss 2
  assert.equal(goneWorktrees(db), 1);
});

test('T11.4d a terminal-only pane: incomplete lists never remove it, two complete pulls do, and it comes back', async (t) => {
  const { svc, db, w } = await boot(t);
  const base = { ps: clone(w.ps), terms: clone(w.terms) };
  const T = base.terms.result.terminals.find((x) => !x.agentIdentity && x.handle.startsWith('term_'));
  assert.ok(T, 'fixture has a terminal with no agent');
  const paneOf = () => q1(db, 'SELECT * FROM pane WHERE terminal_handle = ?', T.handle);
  await svc.sync.pullFast();
  await svc.sync.pullFast();
  assert.ok(paneOf() && paneOf().agent_type === null);

  // terminal list truncated, or ps truncated: the pane is not counted missing
  w.terms = termsWithout(base.terms, (x) => x.handle === T.handle, { truncated: true });
  for (let i = 0; i < 5; i++) await svc.sync.pullFast();
  assert.equal(paneOf().gone_at, null, 'truncated terminal list');
  w.terms = termsWithout(base.terms, (x) => x.handle === T.handle);
  w.ps = clone(base.ps);
  w.ps.result.truncated = true;
  for (let i = 0; i < 5; i++) await svc.sync.pullFast();
  assert.equal(paneOf().gone_at, null, 'truncated ps');
  assert.equal(gonePanes(db), 0);

  // both lists complete
  w.ps = clone(base.ps);
  await svc.sync.pullFast();
  assert.equal(paneOf().gone_at, null, 'not gone after 1 complete pull');
  await svc.sync.pullFast();
  assert.equal(typeof paneOf().gone_at, 'number', 'gone after 2 complete pulls');
  assert.equal(gonePanes(db), 1, 'only that pane');

  w.terms = clone(base.terms);
  await svc.sync.pullFast();
  assert.equal(paneOf().gone_at, null, 'back');
});

test('T11.4d a repo missing from repo-list goes gone after 2 pulls and comes back', async (t) => {
  const { svc, db, w } = await boot(t);
  const base = clone(w.repos);
  const R = base.result.repos.find((r) => r.displayName === 'cc-workflows');
  assert.ok(R);
  await svc.sync.pullSlow();
  const goneAt = () => val(db, 'SELECT gone_at FROM repo WHERE id = ?', R.id);
  assert.equal(goneAt(), null);

  w.repos = clone(base);
  w.repos.result.repos = w.repos.result.repos.filter((r) => r.id !== R.id);
  w.failOnly.add('repo list');
  for (let i = 0; i < 4; i++) await svc.sync.pullSlow();
  assert.equal(goneAt(), null, 'a failing repo list never counts');
  w.failOnly.delete('repo list');

  await svc.sync.pullSlow();
  assert.equal(goneAt(), null, 'not gone after 1 complete pull');
  await svc.sync.pullSlow();
  assert.equal(typeof goneAt(), 'number', 'gone after 2');
  assert.equal(val(db, 'SELECT count(*) FROM repo WHERE gone_at IS NOT NULL'), 1);

  w.repos = clone(base);
  await svc.sync.pullSlow();
  assert.equal(goneAt(), null);
});

// ---------------------------------------------------------------- 5. events from Orca

test('T11.5 agent.status.changed updates the pane at once, counts a turn on done to working, logs one lane event per receivedAt', async (t) => {
  const { svc, db, w } = await boot(t);
  await svc.sync.pullFast();
  const W = w.ps.result.worktrees.find((x) => x.agents.some((a) => a.state === 'working'));
  const P = W.agents.find((a) => a.state === 'working').paneKey;
  const pane = () => q1(db, 'SELECT * FROM pane WHERE pane_key = ?', P);
  const lane = () => q(db, "SELECT * FROM event_log WHERE kind = 'lane' AND ref LIKE ?", `pane:${P}:%`);
  assert.equal(pane().agent_state, 'working');
  assert.equal(pane().turns, 0);
  assert.equal(lane().length, 0);

  const T1 = T0 + 1000;
  const T2 = T0 + 2000;
  svc.sync.onAgentStatus({ paneKey: P, state: 'done', receivedAt: T1, worktreeId: W.worktreeId });
  assert.equal(pane().agent_state, 'done', 'applied without a pull');
  assert.equal(pane().agent_state_since, T1);
  assert.equal(pane().turns, 0, 'working to done is not a new turn');
  assert.equal(lane().length, 1);
  assert.equal(lane()[0].ref, `pane:${P}:${T1}`);

  svc.sync.onAgentStatus({ paneKey: P, state: 'working', receivedAt: T2, worktreeId: W.worktreeId });
  assert.equal(pane().agent_state, 'working');
  assert.equal(pane().turns, 1, 'done to working counts a turn');
  assert.equal(lane().length, 2);

  // the same event twice: one row, no second turn
  svc.sync.onAgentStatus({ paneKey: P, state: 'working', receivedAt: T2, worktreeId: W.worktreeId });
  svc.sync.onAgentStatus({ paneKey: P, state: 'done', receivedAt: T1, worktreeId: W.worktreeId });
  assert.equal(lane().length, 2, 'unique (kind, ref) keeps one row per receivedAt');
  assert.deepEqual(lane().map((r) => r.ref).sort(), [`pane:${P}:${T1}`, `pane:${P}:${T2}`].sort());
  assert.equal(lane()[0].kind, 'lane');
  assert.equal(typeof lane()[0].at, 'number');

  // an unknown pane or garbage payload does not throw and does not write a pane
  svc.sync.onAgentStatus({ paneKey: 'nope:nope', state: 'working', receivedAt: T2 });
  svc.sync.onAgentStatus(undefined);
  assert.equal(val(db, "SELECT count(*) FROM pane WHERE pane_key = 'nope:nope'"), 0);
});

test('T11.5 worktree.removed sets gone_at on the worktree and its panes at once', async (t) => {
  const { svc, db, w, clock } = await boot(t);
  await svc.sync.pullFast();
  const W = w.ps.result.worktrees.find((x) => x.branch === WT_TWO_PANES);
  assert.ok(W);
  assert.ok(val(db, 'SELECT count(*) FROM pane WHERE worktree_id = ?', W.worktreeId) >= 2);
  clock.advance(7000);
  svc.sync.onWorktreeRemoved({ worktreeId: W.worktreeId });
  assert.equal(val(db, 'SELECT gone_at FROM worktree WHERE id = ?', W.worktreeId), clock.now());
  for (const p of q(db, 'SELECT pane_key, gone_at FROM pane WHERE worktree_id = ?', W.worktreeId)) assert.equal(p.gone_at, clock.now(), p.pane_key);
  assert.equal(goneWorktrees(db), 1);
  assert.equal(val(db, 'SELECT count(*) FROM pane WHERE worktree_id <> ? AND gone_at IS NOT NULL', W.worktreeId), 0);

  // by path, and a repeat keeps the first time
  const W2 = w.ps.result.worktrees.find((x) => x.branch === 'refs/heads/v3/rel8');
  clock.advance(1000);
  svc.sync.onWorktreeRemoved({ path: W2.path });
  assert.equal(val(db, 'SELECT gone_at FROM worktree WHERE id = ?', W2.worktreeId), clock.now());
  const first = val(db, 'SELECT gone_at FROM worktree WHERE id = ?', W.worktreeId);
  clock.advance(1000);
  svc.sync.onWorktreeRemoved({ worktreeId: W.worktreeId });
  assert.equal(val(db, 'SELECT gone_at FROM worktree WHERE id = ?', W.worktreeId), first);
  svc.sync.onWorktreeRemoved({ worktreeId: 'unknown' }); // no throw
});

test('T11.5 request() debounces: ten requests make exactly one pull after 500 ms', async (t) => {
  const { svc, runner, clock } = await boot(t, { track: false });
  assert.equal(clock.pending(), 0);
  for (let i = 0; i < 10; i++) svc.sync.request();
  assert.equal(clock.pending(), 1, 'one timer, not ten');
  clock.advance(499);
  await settle();
  assert.equal(callsOf(runner, 'worktree ps').length, 0, 'nothing before the debounce ends');
  clock.advance(1);
  await settle();
  assert.equal(callsOf(runner, 'worktree ps').length, 1, 'exactly one pull');
  assert.equal(callsOf(runner, 'repo list').length, 0, 'a plain request is a fast pull only');
  assert.equal(clock.pending(), 0);

  // a second burst makes a second pull; a slow request pulls the slow group too
  for (let i = 0; i < 10; i++) svc.sync.request();
  svc.sync.request({ slow: true });
  clock.advance(500);
  await settle();
  assert.equal(callsOf(runner, 'worktree ps').length, 2);
  assert.equal(callsOf(runner, 'repo list').length, 1);

  // events feed the same debounce
  svc.sync.onWorktreeCreated();
  svc.sync.onAgentStatus({ paneKey: 'x:y', state: 'working' });
  svc.sync.onWorktreeRemoved({ worktreeId: 'none' });
  assert.equal(clock.pending(), 1);
  clock.advance(500);
  await settle();
  assert.equal(callsOf(runner, 'worktree ps').length, 3);
  assert.equal(callsOf(runner, 'repo list').length, 2, 'worktree.created asks for the slow group too');
});

// ---------------------------------------------------------------- 6. event_log from the inbox

test('T11.6 inbox: cursor, no duplicates, heartbeats update the lane only, ask vs bus, history gap', async (t) => {
  const { svc, db, w } = await boot(t);
  const events = () => q(db, "SELECT * FROM event_log WHERE ref LIKE 'msg:%' ORDER BY id");
  const cursor = () => val(db, "SELECT value FROM kv WHERE key = 'inbox.sequence'");
  const raw = w.inbox.result.messages;
  const nonHeartbeat = raw.filter((m) => m.type !== 'heartbeat');
  const highest = Math.max(...raw.map((m) => m.sequence));

  await svc.sync.pullFast();
  assert.equal(cursor(), String(highest));
  assert.equal(events().length, nonHeartbeat.length);
  for (const m of nonHeartbeat) {
    const row = events().find((e) => e.ref === `msg:${m.id}`);
    assert.ok(row, `event for ${m.id}`);
    assert.equal(row.kind, m.type === 'question' ? 'ask' : 'bus', `kind of a ${m.type}`);
    assert.equal(row.at, ms(m.created_at));
    assert.equal(row.src, `${m.from_handle} → ${m.to_handle}`);
  }
  assert.ok(events().some((e) => e.kind === 'ask') && events().some((e) => e.kind === 'bus'));
  for (const m of raw.filter((x) => x.type === 'heartbeat')) assert.equal(events().find((e) => e.ref === `msg:${m.id}`), undefined, 'a heartbeat has no event row');

  // identical second pull: nothing added
  const ids = events().map((e) => e.id);
  await svc.sync.pullFast();
  assert.deepEqual(events().map((e) => e.id), ids);
  assert.equal(cursor(), String(highest));

  // a new message with a higher sequence: exactly one more row
  raw.push(msg({ sequence: highest + 1, type: 'status', from: `run:${RUN}`, to: 'dispatch:ctx_zzz', at: '2026-10-25T04:00:00Z', subject: 'one more' }));
  await svc.sync.pullFast();
  assert.equal(events().length, ids.length + 1);
  assert.equal(events().at(-1).kind, 'bus');
  assert.equal(events().at(-1).ref, `msg:msg_t${highest + 1}`);
  assert.equal(cursor(), String(highest + 1));
  await svc.sync.pullFast();
  assert.equal(events().length, ids.length + 1);

  // a heartbeat: lane.phase and last_heartbeat_at, no event row
  const beforeEvents = val(db, 'SELECT count(*) FROM event_log');
  raw.push(msg({
    sequence: highest + 2, type: 'heartbeat', from: 'term_e808e888-0e79-4b98-accc-17bc3b933fa4', to: `run:${RUN}`, at: '2030-05-06T07:08:09Z',
    payload: { dispatchId: 'ctx_f18a42f2381f', taskId: 'task_482f4dae657a', phase: 'verifying: gates running' },
  }));
  await svc.sync.pullFast();
  const lane = q1(db, "SELECT phase, last_heartbeat_at FROM lane WHERE dispatch_id = 'ctx_f18a42f2381f'");
  assert.equal(lane.phase, 'verifying: gates running');
  assert.equal(lane.last_heartbeat_at, Date.parse('2030-05-06T07:08:09Z'));
  assert.equal(val(db, 'SELECT count(*) FROM event_log'), beforeEvents, 'a heartbeat adds no event row');
  assert.equal(cursor(), String(highest + 2), 'the cursor moves past heartbeats too');
  // an older heartbeat never moves the time back
  raw.push(msg({
    sequence: highest + 3, type: 'heartbeat', from: 'term_e808e888-0e79-4b98-accc-17bc3b933fa4', to: `run:${RUN}`, at: '2029-01-01T00:00:00Z',
    payload: { dispatchId: 'ctx_f18a42f2381f', phase: 'older' },
  }));
  await svc.sync.pullFast();
  assert.equal(val(db, "SELECT last_heartbeat_at FROM lane WHERE dispatch_id = 'ctx_f18a42f2381f'"), Date.parse('2030-05-06T07:08:09Z'));

  // questions: ask event; a heartbeat or a message to someone else does not answer; a later message to the asker does
  const s = highest + 10;
  raw.push(msg({
    sequence: s, type: 'question', id: 'msg_q_new', from: 'dispatch:ctx_newq', to: `run:${RUN}`, at: '2026-10-25T05:00:00Z',
    payload: { taskId: 'task_newq', dispatchId: 'ctx_newq', question: 'Which way?\nA or B, with reasons', options: ['a', 'b'] },
  }));
  raw.push(msg({ sequence: s + 1, type: 'heartbeat', from: `run:${RUN}`, to: 'dispatch:ctx_newq', at: '2026-10-25T05:00:10Z', payload: { dispatchId: 'ctx_newq' } }));
  raw.push(msg({ sequence: s + 2, type: 'status', from: `run:${RUN}`, to: 'dispatch:ctx_other', at: '2026-10-25T05:00:20Z' }));
  await svc.sync.pullFast();
  const ask = () => q1(db, "SELECT * FROM ask WHERE id = 'msg_q_new'");
  assert.equal(ask().orca_status, 'pending');
  assert.equal(ask().title, 'Which way?');
  assert.equal(ask().body, 'A or B, with reasons');
  const qe = events().find((e) => e.ref === 'msg:msg_q_new');
  assert.equal(qe.kind, 'ask');
  assert.match(qe.text, /Which way\?/);
  // a later status to the same dispatch that is not in the question's thread does not answer it (review 2, finding 5)
  raw.push(msg({ sequence: s + 3, type: 'status', from: `run:${RUN}`, to: 'dispatch:ctx_newq', at: '2026-10-25T05:00:40Z' }));
  raw.push(msg({ sequence: s + 4, type: 'status', from: `run:${RUN}`, to: 'dispatch:ctx_newq', at: '2026-10-25T05:00:50Z', thread: 'msg_some_other_thread' }));
  await svc.sync.pullFast();
  assert.equal(ask().orca_status, 'pending', 'a nudge to the same dispatch is not a reply');
  assert.equal(ask().resolved_at, null);
  raw.push(msg({ sequence: s + 5, type: 'status', from: `run:${RUN}`, to: 'dispatch:ctx_newq', at: '2026-10-25T05:01:00Z', thread: 'msg_q_new' }));
  await svc.sync.pullFast();
  assert.equal(ask().orca_status, 'answered');
  assert.equal(ask().resolved_at, ms('2026-10-25T05:01:00Z'));
  assert.equal(val(db, "SELECT count(*) FROM event_log WHERE ref = 'msg:msg_q_new'"), 1);

  // a jump of more than 100 logs one 'history gap' row, once
  assert.equal(val(db, "SELECT count(*) FROM event_log WHERE text LIKE '%history gap%'"), 0);
  const last = Number(cursor());
  raw.push(msg({ sequence: last + 150, type: 'status', from: `run:${RUN}`, to: 'dispatch:ctx_zzz', at: '2026-10-25T06:00:00Z' }));
  await svc.sync.pullFast();
  await svc.sync.pullFast();
  const gap = q(db, "SELECT * FROM event_log WHERE text LIKE '%history gap%'");
  assert.equal(gap.length, 1);
  assert.equal(gap[0].kind, 'bus');
  assert.equal(cursor(), String(last + 150));
  // a jump of exactly 100 or less is not a gap
  raw.push(msg({ sequence: last + 250, type: 'status', from: `run:${RUN}`, to: 'dispatch:ctx_zzz', at: '2026-10-25T06:10:00Z' }));
  await svc.sync.pullFast();
  assert.equal(val(db, "SELECT count(*) FROM event_log WHERE text LIKE '%history gap%'"), 1);
  assert.equal(cursor(), String(last + 250));
});

// ---------------------------------------------------------------- 7. derived status

test('T11.7 plan_task status follows the cached Orca task state (3.3)', async (t) => {
  const { svc, db, w } = await boot(t, { track: false });
  const repoPath = tmpDir('plan-repo');
  mkdirSync(join(repoPath, '.matrixkoder', 'inbox'), { recursive: true });
  copyFileSync(REAL_PLAN, join(repoPath, '.matrixkoder', 'inbox', PLAN_NAME));
  db.prepare('INSERT INTO repo(id,path,display_name,kind,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?)').run(REPO, repoPath, 'plan-repo', 'git', 1, 1);
  const imp = importFile(db, { repoId: REPO, repoPath }, PLAN_NAME);
  assert.equal(imp.action, 'created');

  // Orca tasks: completed (x4 in the fixture), failed (x2), plus ones made here
  setTask(w, 'task_cae84c459bb0', { status: 'ready', result: null });
  setTask(w, 'task_ef719b77ef10', { status: 'dispatched', result: null });
  setTask(w, 'task_836032ca9528', { result: 'cancelled' });
  addTask(w, 'task_blk1', 'blocked');
  addTask(w, 'task_pend1', 'pending');
  w.gates.result = { runId: RUN, count: 1, gates: [gate('gate_s1', 'task_cae84c459bb0', 'pending')] };

  const map = {
    'SPIKE.1': 'task_7b50bdbc7dfa', // completed
    'SPIKE.2': 'task_78d56a11b54c', // completed (and a pending question in the inbox)
    'STORE.1': 'task_cae84c459bb0', // ready + pending gate
    'STORE.2': 'task_836032ca9528', // failed, result cancelled
    'STORE.3': 'task_60555b90ea31', // failed
    'STORE.4': 'task_gone_from_orca', // not in task-list
    'ORCA.1': 'task_ef719b77ef10', // dispatched
    'ORCA.2': 'task_blk1', // blocked
    'WIRE.1': 'task_pend1', // pending
    'WIRE.2': 'task_290d9384c8d0', // completed, has subtasks
  };
  db.prepare("UPDATE plan SET status = 'running', orca_run_id = ?").run(RUN);
  for (const [code, task] of Object.entries(map)) {
    db.prepare('UPDATE plan_task SET orca_run_id = ?, orca_task_id = ? WHERE code = ?').run(RUN, task, code);
  }
  db.prepare("UPDATE plan_task SET status = 'working' WHERE code = 'STORE.4'").run();
  assert.equal(val(db, "SELECT count(*) FROM plan_subtask WHERE task_id = (SELECT id FROM plan_task WHERE code = 'WIRE.2') AND status <> 'done'"), 3);
  const row = (code) => q1(db, 'SELECT * FROM plan_task WHERE code = ?', code);

  // a failing task-list must not mark anything missing
  w.failOnly.add('orchestration task-list');
  await svc.sync.pullFast();
  for (const code of Object.keys(map)) assert.equal(row(code).last_state, null, `${code}: a failed task-list sets no state`);
  assert.equal(row('STORE.4').status, 'working');
  w.failOnly.clear();

  await svc.sync.pullFast();
  const expect = {
    'SPIKE.1': ['completed', 'done'],
    'SPIKE.2': ['completed', 'done'],
    'STORE.1': ['ready', 'waiting'],
    'STORE.2': ['failed', 'cancelled'],
    'STORE.3': ['failed', 'failed'],
    'STORE.4': ['missing', 'working'],
    'ORCA.1': ['dispatched', 'working'],
    'ORCA.2': ['blocked', 'blocked'],
    'WIRE.1': ['pending', 'ready'],
    'WIRE.2': ['completed', 'done'],
  };
  for (const [code, [last, status]] of Object.entries(expect)) {
    const r = row(code);
    assert.equal(r.last_state, last, `${code} last_state`);
    assert.equal(r.status, status, `${code} status`);
    assert.equal(typeof r.last_state_at, 'number', `${code} last_state_at`);
  }
  assert.equal(typeof row('SPIKE.1').done_at, 'number');
  assert.equal(row('STORE.3').done_at, null);

  // subtasks of a done task become done; others stay as they were
  assert.equal(val(db, "SELECT count(*) FROM plan_subtask WHERE task_id = ? AND status = 'done'", row('WIRE.2').id), 3);

  // a second pull changes nothing (no flapping, done_at kept)
  const snap = q(db, 'SELECT code, status, last_state, done_at FROM plan_task ORDER BY id');
  await svc.sync.pullFast();
  assert.deepEqual(q(db, 'SELECT code, status, last_state, done_at FROM plan_task ORDER BY id'), snap);

  // the gate is resolved: the waiting task goes back to ready
  w.gates.result.gates[0] = gate('gate_s1', 'task_cae84c459bb0', 'resolved', { resolution: 'approved', resolved_at: '2026-10-25T03:00:00Z' });
  await svc.sync.pullFast();
  assert.equal(row('STORE.1').status, 'ready');
  assert.equal(val(db, "SELECT orca_status FROM ask WHERE id = 'gate_s1'"), 'resolved');

  // a pending question for the task also shows waiting (payload.taskId)
  w.inbox.result.messages.push(msg({
    sequence: 900, type: 'question', id: 'msg_q_dispatched', from: 'dispatch:ctx_x1', to: `run:${RUN}`, at: '2026-10-25T04:00:00Z',
    payload: { taskId: 'task_ef719b77ef10', dispatchId: 'ctx_x1', question: 'Proceed?', options: ['y', 'n'] },
  }));
  await svc.sync.pullFast();
  assert.equal(row('ORCA.1').status, 'waiting');
  assert.equal(row('ORCA.1').last_state, 'dispatched');
  // task absent from a later successful list: state missing, status kept
  w.tasks.result.tasks = w.tasks.result.tasks.filter((x) => x.id !== 'task_blk1');
  await svc.sync.pullFast();
  assert.equal(row('ORCA.2').last_state, 'missing');
  assert.equal(row('ORCA.2').status, 'blocked', 'absence never changes the status');
  assert.equal(row('SPIKE.1').status, 'done', 'done stays done');
});

// ---------------------------------------------------------------- 8. decision replay (K16)

test('T11.8 decisions: a restart sends what is due, expires what is older than 10 minutes, re-arms what is in the future', async (t) => {
  const dir = tmpDir('replay');
  const first = await startTestService({ dir });
  await first.close();

  const db = openDb(dir);
  const cmd = (id, req) => JSON.stringify(['orchestration', 'gate-resolve', `--id=${id}`, '--resolution=approved', `--retry-request=${req}`, '--json']);
  const ins = db.prepare(
    `INSERT INTO decision_log(kind, title, action, status, command, request_id, commit_at, created_at, run_id)
     VALUES('gate', ?, 'approve', 'pending', ?, ?, ?, ?, ?)`,
  );
  const now = T0;
  ins.run('due', cmd('g1', 'r1'), 'r1', now - 2000, now - 12_000, RUN);
  ins.run('old', cmd('g2', 'r2'), 'r2', now - 11 * 60_000, now - 11 * 60_000 - 10_000, RUN);
  ins.run('future', cmd('g3', 'r3'), 'r3', now + 5000, now - 5000, RUN);
  ins.run('forbidden', JSON.stringify(['orchestration', 'check']), 'r4', now - 1000, now - 11_000, RUN);
  ins.run('forbidden2', JSON.stringify(['orchestration', 'gate-resolve', '--id=g9', '--resolution=x', '--unknown-flag=1']), 'r5', now - 1000, now - 11_000, RUN);
  db.close();

  const clock = fakeClock(now);
  const runner = stubRunner({ 'orchestration gate-resolve': okEnv({ resolved: true }) });
  const { svc, db: db2 } = await boot(t, { dir, clock, runner, track: false });
  const row = (title) => q1(db2, 'SELECT * FROM decision_log WHERE title = ?', title);

  // (i) due 2 s ago: sent once
  assert.equal(row('due').status, 'sent');
  assert.equal(typeof row('due').sent_at, 'number');
  assert.equal(row('due').error, null);
  const resolves = () => callsOf(runner, 'orchestration gate-resolve');
  assert.equal(resolves().length, 1);
  assert.ok(resolves()[0].includes('--id=g1'));
  assert.ok(resolves()[0].includes('--retry-request=r1'));
  assert.equal(resolves()[0].at(-1), '--json');

  // (ii) 11 minutes old: expired, no Orca call
  assert.equal(row('old').status, 'expired');
  assert.ok(row('old').error);
  assert.ok(!resolves().some((a) => a.includes('--id=g2')));

  // not an allowed decision argv: failed, never reached the runner
  assert.equal(row('forbidden').status, 'failed');
  assert.ok(row('forbidden').error);
  assert.equal(row('forbidden2').status, 'failed');
  assert.equal(runner.calls.filter((a) => a[1] === 'check').length, 0);
  assert.ok(!runner.calls.some((a) => a.includes('--id=g9')));

  // (iii) 5 s in the future: still pending, sent once the clock passes commit_at
  assert.equal(row('future').status, 'pending');
  assert.equal(row('future').sent_at, null);
  assert.ok(!resolves().some((a) => a.includes('--id=g3')));
  clock.advance(4999);
  await settle();
  assert.equal(row('future').status, 'pending', 'not before commit_at');
  clock.advance(2);
  await settle();
  assert.equal(row('future').status, 'sent');
  assert.equal(resolves().length, 2);
  assert.ok(resolves()[1].includes('--id=g3'));
  assert.equal(runner.calls.filter((a) => a[1] === 'check').length, 0);
  await svc.shutdown();
});

// ---------------------------------------------------------------- 9. maintenance on start

test('T11.9 runMaintenance ran on start: kv maintenance.day and a mk-data.db.bak-* file', async (t) => {
  const { svc, db } = await boot(t, { track: false });
  const day = val(db, "SELECT value FROM kv WHERE key = 'maintenance.day'");
  assert.match(day, /^\d{8}$/);
  const backups = readdirSync(svc.dir).filter((f) => f.startsWith('mk-data.db.bak-'));
  assert.ok(backups.length >= 1, 'a backup file exists');
  assert.ok(backups.includes(`mk-data.db.bak-${day}`));
  assert.ok(existsSync(join(svc.dir, 'mk-data.db')));
});

// ---------------------------------------------------------------- 10. cadence and parallelism

test('T11.10 the fast group is parallel and complete; the slow group has repo, account and host; never `orchestration check`', async (t) => {
  const w = world();
  const base = stubRunner(w.routes);
  let inflight = 0;
  let peak = 0;
  let release;
  const gateOpen = new Promise((r) => (release = r));
  let expected = Infinity;
  const runner = async (argv, o) => {
    runner.calls.push(argv);
    inflight++;
    peak = Math.max(peak, inflight);
    if (inflight >= expected) release();
    // hold every call until the whole group is in flight; the timer only keeps a serial implementation from hanging
    await Promise.race([gateOpen, new Promise((r) => setTimeout(r, 400))]);
    inflight--;
    return base(argv, o);
  };
  runner.calls = [];
  const { svc, db } = await boot(t, { w, runner });
  trackBugRun(db, '3b490a08-b835-42d4-b2b7-acc983a33433', RUN2, '/placeholder2'); // a second tracked run

  // fast group: 5 run-independent reads + 3 per tracked run, all in flight together
  expected = 5 + 3 * 2;
  await svc.sync.pullFast();
  assert.equal(peak, expected, 'all fast reads were in flight at the same time');
  const keys = runner.calls.map(key);
  const count = (k) => keys.filter((x) => x === k).length;
  for (const k of ['worktree ps', 'worktree list', 'terminal list', 'orchestration run-list', 'orchestration inbox']) assert.equal(count(k), 1, k);
  for (const k of ['orchestration task-list', 'orchestration worker-list', 'orchestration gate-list']) assert.equal(count(k), 2, `${k} once per tracked run`);
  for (const run of [RUN, RUN2]) {
    for (const k of ['task-list', 'worker-list', 'gate-list']) {
      assert.ok(runner.calls.some((a) => a[1] === k && a.includes(`--run=${run}`)), `${k} --run=${run}`);
    }
  }
  const allowed = new Set(['worktree ps', 'worktree list', 'terminal list', 'orchestration run-list', 'orchestration inbox', 'orchestration task-list',
    'orchestration worker-list', 'orchestration gate-list', 'orchestration worker-show']);
  for (const k of keys) assert.ok(allowed.has(k), `unexpected fast call: ${k}`);
  assert.ok(!keys.includes('repo list') && !keys.includes('account list') && !keys.includes('host list'), 'the slow reads are not in the fast group');
  assert.ok(callsOf(runner, 'orchestration inbox')[0].includes('--limit=100'));

  // slow group
  runner.calls.length = 0;
  peak = 0;
  expected = 3;
  await svc.sync.pullSlow();
  assert.deepEqual([...runner.calls.map(key)].sort(), ['account list', 'host list', 'repo list']);
  assert.equal(peak, 3, 'the slow reads run together');

  // pullAll is fast then slow
  runner.calls.length = 0;
  expected = Infinity;
  const done = svc.sync.pullAll();
  await done;
  const all = runner.calls.map(key);
  assert.ok(all.indexOf('repo list') > all.lastIndexOf('worktree ps'));

  // across every pull: no `orchestration check`, and every argv ends with --json
  for (const a of runner.calls) {
    assert.equal(a.at(-1), '--json', a.join(' '));
    assert.ok(!(a[0] === 'orchestration' && a[1] === 'check'), 'never orchestration check');
  }
  assert.ok(runner.calls.length > 0);
});

test('T11.10 every argv of a long session ends with --json and none is `orchestration check`', async (t) => {
  const { svc, runner, db } = await boot(t);
  db.prepare("UPDATE repo SET bug_run_id = ? WHERE id = ?").run(RUN, REPO);
  for (let i = 0; i < 3; i++) await svc.sync.pullAll();
  svc.sync.onAgentStatus({ paneKey: 'x:y', state: 'working', receivedAt: T0 });
  svc.sync.onWorktreeRemoved({ worktreeId: 'none' });
  assert.ok(runner.calls.length > 20);
  for (const a of runner.calls) {
    assert.equal(a.at(-1), '--json', a.join(' '));
    assert.ok(a.every((x) => typeof x === 'string'));
    assert.ok(!(a[0] === 'orchestration' && a[1] === 'check'));
    assert.ok(!a.includes('check') || a[0] !== 'orchestration');
  }
});

test('T11.adapter: a list that omitted a host (hostScope.omittedHostIds) projects as truncated, so it is never a complete pull', async () => {
  const { worktreePs, worktreeList, terminalList } = await import('../../out/orca/index.js');
  const cases = [['worktree-ps', worktreePs], ['worktree-list', worktreeList], ['terminal-list', terminalList]];
  for (const [name, fn] of cases) {
    const raw = JSON.parse(JSON.stringify(fx(name)));
    assert.equal((await fn(async () => ({ stdout: JSON.stringify(raw) }))).value.truncated, false, `${name}: complete as recorded`);
    raw.result.hostScope = { hostIds: ['local'], omittedHostIds: ['ssh-down'] };
    assert.equal((await fn(async () => ({ stdout: JSON.stringify(raw) }))).value.truncated, true, `${name}: a host was omitted`);
  }
});

// ---------------------------------------------------------------- review round 2

test('R2.9 a failed task is cancelled only when its result is exactly "cancelled"', async (t) => {
  const { svc, db, w } = await boot(t, { track: false });
  const repoPath = tmpDir('cancel-repo');
  mkdirSync(join(repoPath, '.matrixkoder', 'inbox'), { recursive: true });
  copyFileSync(REAL_PLAN, join(repoPath, '.matrixkoder', 'inbox', PLAN_NAME));
  db.prepare('INSERT INTO repo(id,path,display_name,kind,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?)').run(REPO, repoPath, 'plan-repo', 'git', 1, 1);
  importFile(db, { repoId: REPO, repoPath }, PLAN_NAME);
  db.prepare("UPDATE plan SET status = 'running', orca_run_id = ?").run(RUN);
  addTask(w, 'task_c1', 'failed', 'could not cancel subscription');
  addTask(w, 'task_c2', 'failed', 'Cancelled');
  addTask(w, 'task_c3', 'failed', 'user cancelled the run');
  for (const [code, task] of [['STORE.2', 'task_c1'], ['STORE.3', 'task_c2'], ['STORE.4', 'task_c3']]) {
    db.prepare('UPDATE plan_task SET orca_run_id = ?, orca_task_id = ? WHERE code = ?').run(RUN, task, code);
  }
  await svc.sync.pullFast();
  const status = (code) => val(db, 'SELECT status FROM plan_task WHERE code = ?', code);
  assert.equal(status('STORE.2'), 'failed', 'free text that mentions cancel is a plain failure');
  assert.equal(status('STORE.3'), 'cancelled', 'the dashboard\'s own result, however it is cased');
  assert.equal(status('STORE.4'), 'failed');
});

test('R2.11 a base branch that git would read as an option is never passed to git', async (t) => {
  const seen = [];
  const git = async (cwd, args) => {
    seen.push(args);
    return okGit(cwd, args);
  };
  const { svc, db } = await boot(t, { git });
  await svc.sync.pullAll();
  const live = val(db, 'SELECT count(*) FROM worktree w JOIN lane l ON l.worktree_id = w.id WHERE l.ended_at IS NULL AND w.gone_at IS NULL');
  assert.ok(live > 0, 'the fixtures have a live lane to compare');
  db.prepare("UPDATE repo SET base_ref = '--output=/tmp/mk-pwned', base_ref_at = ?").run(Date.now() + 86_400_000);
  seen.length = 0;
  await svc.sync.pullGit();
  const revs = seen.filter((a) => a[0] === 'rev-list' || (a[0] === 'diff' && a[1] === '--shortstat'));
  assert.ok(revs.length > 0);
  for (const a of seen) assert.ok(!a.some((x) => x.startsWith('--output') || x.startsWith('-') && x !== '--count' && x !== '--shortstat' && x !== '--porcelain'), `unsafe argv ${a.join(' ')}`);
  assert.ok(revs.some((a) => a.includes('main..HEAD') || a.includes('main...HEAD')), 'falls back to main');
});
