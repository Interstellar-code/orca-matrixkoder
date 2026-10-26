// T5: the notifier (contract C6): every source fires once with its key, toggles and quiet hours, de-dupe, the wake line
// and notify.test. Real service on a temp data dir, recorded Orca JSON, a fake clock; the host call is a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveSettings } from '../../out/store/settings.js';
import { fakeClock, fixtureRoutes, fx, startTestService, stubRunner } from './helpers.mjs';

const T0 = 1_792_930_000_000;
const RUN = 'run_aa2cc2982670';
const REPO = '4d01f6f8-887c-47fb-af0d-5387e7248caf';

const clone = (v) => structuredClone(v);
const q = (db, sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
const okGit = async (_cwd, args) => (args[0] === 'symbolic-ref' ? 'refs/remotes/origin/main' : args[0] === 'rev-list' ? '0' : null);
const gate = (id, status = 'pending') => ({
  id, run_id: RUN, task_id: 'task_x', question: `Approve ${id}?\nDetails`, options: '["approve"]', status, resolution: null,
  created_at: '2026-10-25T02:10:00Z', resolved_at: null,
});

/** A service with a mutable Orca world, a fake clock and a recording notify stub. */
async function boot(t, { host = true } = {}) {
  const w = {
    gates: fx('gate-list'), accounts: fx('account-list'), workers: fx('worker-list'),
    routes: null,
  };
  const base = fixtureRoutes();
  w.routes = { ...base, 'orchestration gate-list': () => w.gates, 'account list': () => w.accounts, 'orchestration worker-list': () => w.workers, 'terminal send': { ok: true, result: {} } };
  const runner = stubRunner(w.routes);
  const clock = fakeClock(T0);
  const svc = await startTestService({ runner, clock, git: okGit });
  t.after(() => svc.close());
  const sent = [];
  if (host) svc.ctx.notify = (n) => { sent.push(n); };
  svc.ctx.db.prepare('INSERT INTO repo(id,path,display_name,kind,first_seen_at,last_seen_at,bug_run_id) VALUES(?,?,?,?,?,?,?)').run(REPO, '/placeholder', 'tracked', 'git', 1, 1, RUN);
  return { svc, db: svc.ctx.db, w, runner, clock, sent };
}

test('T5.1 a source with its toggle on sends once; the same key twice sends once; off suppresses and does not fire later', async (t) => {
  const { svc, sent } = await boot(t);
  assert.equal(await svc.notifier.notify('ask', 'ask:a1', 'T', 'B'), true);
  assert.equal(await svc.notifier.notify('ask', 'ask:a1', 'T', 'B'), false);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { title: 'T', body: 'B' });
  // stall is off by default
  assert.equal(await svc.notifier.notify('stall', 'stall:x:1', 'T', 'B'), false);
  saveSettings({ notify: { events: { stall: true } } }, svc.dir);
  assert.equal(await svc.notifier.notify('stall', 'stall:x:1', 'T', 'B'), false, 'a key seen while off stays spent');
  assert.equal(await svc.notifier.notify('stall', 'stall:x:2', 'T', 'B'), true);
  assert.equal(sent.length, 2);
});

test('T5.2 quiet hours keep only ask', async (t) => {
  const { svc, sent, clock } = await boot(t);
  const h = new Date(clock.now()).getHours();
  const hh = (n) => `${String((n + 24) % 24).padStart(2, '0')}:00`;
  saveSettings({ notify: { quietHours: { enabled: true, from: hh(h - 1), to: hh(h + 1) } } }, svc.dir);
  assert.equal(await svc.notifier.notify('laneDone', 'laneDone:p:1', 'T', 'B'), false);
  assert.equal(await svc.notifier.notify('taskFailed', 'taskFailed:x', 'T', 'B'), false);
  assert.equal(await svc.notifier.notify('ask', 'ask:q1', 'T', 'B'), true);
  assert.equal(sent.length, 1);
  saveSettings({ notify: { quietHours: { enabled: false } } }, svc.dir);
  assert.equal(await svc.notifier.notify('laneDone', 'laneDone:p:2', 'T', 'B'), true);
});

test('T5.3 wakeOrchestrator sends one line to the run coordinator handle; none when there is no handle or it is off', async (t) => {
  const { svc, db, runner } = await boot(t);
  db.prepare('INSERT INTO run(id, objective, coordinator_handle, legacy, created_at, updated_at, first_seen_at, last_seen_at) VALUES(?,?,?,?,?,?,?,?)').run('run_w', 'o', 'term_coord', 0, 1, 1, 1, 1);
  db.prepare('INSERT INTO run(id, objective, coordinator_handle, legacy, created_at, updated_at, first_seen_at, last_seen_at) VALUES(?,?,?,?,?,?,?,?)').run('run_n', 'o', null, 0, 1, 1, 1, 1);
  const sends = () => runner.calls.filter((a) => a[0] === 'terminal' && a[1] === 'send');
  await svc.notifier.notify('ask', 'ask:w0', 'Which way?', 'b', 'run_w');
  assert.equal(sends().length, 0, 'off by default');
  saveSettings({ notify: { wakeOrchestrator: true } }, svc.dir);
  await svc.notifier.notify('ask', 'ask:w1', 'Which way?\nsecond line', 'b', 'run_w');
  assert.equal(sends().length, 1);
  const argv = sends()[0];
  assert.ok(argv.join(' ').includes('term_coord'));
  assert.ok(!/[\n\r]/.test(argv.find((a) => a.includes('Which way?'))), 'one line');
  await svc.notifier.notify('ask', 'ask:w1', 'again', 'b', 'run_w');
  assert.equal(sends().length, 1, 'the same ask wakes once');
  await svc.notifier.notify('ask', 'ask:w2', 'no handle', 'b', 'run_n');
  await svc.notifier.notify('laneDone', 'laneDone:w3', 'not an ask', 'b', 'run_w');
  assert.equal(sends().length, 1);
});

test('T5.4 notify.test sends one notification and bypasses toggles, quiet hours and de-dupe; no host refuses', async (t) => {
  const { svc, sent, clock } = await boot(t);
  const h = new Date(clock.now()).getHours();
  const hh = (n) => `${String((n + 24) % 24).padStart(2, '0')}:00`;
  saveSettings({ notify: { events: { ask: false, laneDone: false, taskFailed: false }, quietHours: { enabled: true, from: hh(h - 1), to: hh(h + 1) } } }, svc.dir);
  for (let i = 0; i < 2; i++) assert.equal((await svc.action('notify.test')).ok, true);
  assert.equal(sent.length, 2);
  svc.ctx.notify = undefined;
  const r = await svc.action('notify.test');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'no_host');
});

test('T5.5 sync: a new gate and a new question each notify once, with the ask key, across repeated pulls', async (t) => {
  const { svc, w, sent, db } = await boot(t);
  w.gates.result = { runId: RUN, count: 1, gates: [gate('gate_n1')] };
  await svc.sync.pullFast();
  await svc.sync.pullFast();
  assert.equal(sent.filter((n) => n.body === 'Approve gate_n1?').length, 1);
  assert.deepEqual(q(db, "SELECT key FROM alert_sent WHERE key = 'ask:gate_n1'").map((r) => r.key), ['ask:gate_n1']);
  // a resolved gate seen for the first time is not news
  w.gates.result.gates.push(gate('gate_old', 'resolved'));
  await svc.sync.pullFast();
  assert.equal(q(db, "SELECT key FROM alert_sent WHERE key = 'ask:gate_old'").length, 0);
  // the fixture inbox already holds pending questions: each fired once, keyed ask:<message id>
  const qs = q(db, "SELECT id FROM ask WHERE kind = 'question' AND orca_status = 'pending'");
  for (const a of qs) assert.equal(q(db, 'SELECT 1 FROM alert_sent WHERE key = ?', `ask:${a.id}`).length, 1);
});

test('T5.6 sync: a task or bug that turns failed notifies once with its key', async (t) => {
  const { svc, db, sent } = await boot(t);
  const now = Date.now();
  const plan = db.prepare("INSERT INTO plan(slug, repo_id, title, status, created_at, updated_at) VALUES('s',?,'T','running',?,?) RETURNING id").get(REPO, now, now).id;
  const ph = db.prepare('INSERT INTO plan_phase(plan_id, code, ord, title) VALUES(?,?,?,?) RETURNING id').get(plan, 'P', 1, 'P').id;
  const ptask = db.prepare('INSERT INTO plan_task(plan_id, phase_id, code, ord, title, orca_run_id, orca_task_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id')
    .get(plan, ph, 'P.1', 1, 'build it', RUN, 'task_60555b90ea31', now, now).id;
  db.prepare("INSERT INTO bug(id,repo_id,title,status,orca_run_id,orca_task_id,created_at,updated_at) VALUES('b-f',?,'bug title','fixing',?,'task_60555b90ea31',1,1)").run(REPO, RUN);
  await svc.sync.pullFast();
  await svc.sync.pullFast();
  const failed = sent.filter((n) => /failed/.test(n.title));
  assert.equal(failed.length, 2, JSON.stringify(sent));
  assert.ok(failed.some((n) => n.body.startsWith('P.1 build it')));
  assert.ok(failed.some((n) => n.body.startsWith('b-f bug title')));
  const keys = q(db, "SELECT key FROM alert_sent WHERE key LIKE 'taskFailed:%'").map((r) => r.key).sort();
  assert.deepEqual(keys, ['taskFailed:bug:b-f:task_60555b90ea31', `taskFailed:plan_task:${ptask}:task_60555b90ea31`].sort());
});

test('T5.7 sync: a lane without a heartbeat for lanes.stallMinutes notifies once per heartbeat, with a fake clock', async (t) => {
  const { svc, db, sent, clock, w } = await boot(t);
  saveSettings({ notify: { events: { stall: true } } }, svc.dir);
  Object.assign(w.workers.result.workers[0], { workerState: 'ready', dispatchStatus: 'dispatched' }); // one worker still running
  await svc.sync.pullAll();
  const lane = q(db, "SELECT lane_key, id FROM lane WHERE kind = 'dispatch' AND ended_at IS NULL AND (worker_state IS NULL OR worker_state IN ('starting','ready','start_unknown')) LIMIT 1")[0];
  assert.ok(lane, 'the fixture has a live dispatch lane');
  const beat = clock.now() - 5 * 60_000;
  db.prepare('UPDATE lane SET last_heartbeat_at = ? WHERE id = ?').run(beat, lane.id);
  const stalls = () => sent.filter((n) => /stuck/.test(n.title)).length;
  const before = stalls();
  await svc.sync.pullFast();
  assert.equal(stalls(), before, '5 minutes of silence is not a stall');
  clock.advance(11 * 60_000); // 16 minutes now; the default limit is 15
  db.prepare('UPDATE lane SET last_heartbeat_at = ? WHERE id = ?').run(beat, lane.id);
  await svc.sync.pullFast();
  assert.equal(stalls(), before + 1);
  await svc.sync.pullFast();
  assert.equal(stalls(), before + 1, 'the same heartbeat alerts once');
  assert.equal(q(db, 'SELECT 1 FROM alert_sent WHERE key = ?', `stall:${lane.lane_key}:${beat}`).length, 1);
  // a longer limit moves the line
  saveSettings({ lanes: { stallMinutes: 60 } }, svc.dir);
  clock.advance(10 * 60_000);
  db.prepare('UPDATE lane SET last_heartbeat_at = ? WHERE id = ?').run(beat + 1, lane.id);
  await svc.sync.pullFast();
  assert.equal(stalls(), before + 1);
});

test('T5.8 sync: a pulled window below its floor notifies once per window reset', async (t) => {
  const { svc, w, db, sent } = await boot(t);
  saveSettings({ notify: { events: { quotaLow: true } } }, svc.dir);
  await svc.sync.pullSlow();
  await svc.sync.pullSlow();
  const low = () => sent.filter((n) => /quota/.test(n.title));
  // fixture: antigravity weekly is 100% used (0 left, floor 15); claude is 96% and 38% left (floors 40 session, 30 weekly)
  assert.equal(low().length, 1, JSON.stringify(sent));
  assert.match(low()[0].body, /antigravity weekly quota is at 0% left/);
  const resets = q(db, "SELECT resets_at FROM quota WHERE provider = 'antigravity' AND win = 'weekly'")[0].resets_at;
  assert.equal(q(db, 'SELECT 1 FROM alert_sent WHERE key = ?', `quotaLow:antigravity:weekly:${resets}`).length, 1);
  const acc = clone(w.accounts);
  acc.result.rateLimits.claude.weekly.usedPercent = 80;
  w.accounts = acc;
  await svc.sync.pullSlow();
  assert.equal(low().length, 2);
  assert.match(low()[1].body, /claude weekly quota is at 20% left \(floor 30%\)/);
  // a new window (resets_at moved) alerts again
  acc.result.rateLimits.claude.weekly.resetsAt += 1000;
  await svc.sync.pullSlow();
  assert.equal(low().length, 3);
});
