/**
 * T7: the remaining settings consumers (USE.4): sync timers, maintenance limits, undo window and snooze default,
 * the inbox folder and auto-import, `mk bug add` default risk, and the route check at plan import (C9) with the
 * `plan_partial` refusal in `plan.start`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../out/store/cli.js';
import { openDb } from '../../out/store/db.js';
import { importFile, scanInbox } from '../../out/store/import.js';
import { dataLimits, prune, runMaintenance } from '../../out/store/maintenance.js';
import { defaultSettings, mergeSettings, saveSettings } from '../../out/store/settings.js';
import { fakeClock, get, startTestService, stubRunner, tmpDir } from './helpers.mjs';
import { tempDir } from '../tmp.mjs';

const REAL_PLAN = new URL('../../.matrixkoder/inbox/orca-dashboard-wiring.md', import.meta.url).pathname;
const NAME = 'orca-dashboard-wiring.md';
const DAY = 86_400_000;
const planText = () => readFileSync(REAL_PLAN, 'utf8');
const q = (svc, sql, ...p) => svc.ctx.db.prepare(sql).all(...p);

async function world(t, o = {}) {
  const clock = fakeClock();
  const svc = await startTestService({ clock, runner: stubRunner({ 'orchestration run-create': () => ({ ok: true, result: { run: { id: 'run_p' } } }) }), ...o });
  t.after(() => svc.close());
  const repoPath = tempDir('mk-cons-repo-');
  const at = clock.now();
  svc.ctx.db.prepare('INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at) VALUES(?,?,?,?,?)').run('repo-1', repoPath, 'r', at, at);
  const put = (rel, text) => {
    const full = join(repoPath, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  };
  return { svc, clock, repoPath, put };
}

// ------------------------------------------------------------------------------------------------ sync timers

test('T7 timers: sync.* sets the three intervals; a sync change re-arms them with no extra pullAll; other keys do not', async (t) => {
  const svc = await startTestService();
  t.after(() => svc.close());
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const set = [];
  let cleared = 0;
  globalThis.setInterval = (fn, ms, ...r) => { set.push(ms); return realSet(fn, ms, ...r); };
  globalThis.clearInterval = (h) => { cleared++; return realClear(h); };
  t.after(() => { globalThis.setInterval = realSet; globalThis.clearInterval = realClear; svc.sync.stop(); });
  let pulls = 0;
  svc.sync.pullAll = async () => { pulls++; };

  saveSettings({ sync: { fastSeconds: 20, slowSeconds: 120, filesSeconds: 45 } }, svc.dir);
  svc.sync.start();
  assert.deepEqual(set, [20_000, 120_000, 45_000]);
  assert.equal(pulls, 1);

  set.length = 0;
  assert.equal((await svc.action('settings.save', { patch: { look: { density: 'compact' } } })).ok, true);
  assert.deepEqual(set, [], 'a non-sync key leaves the timers alone');

  const before = cleared;
  assert.equal((await svc.action('settings.save', { patch: { sync: { fastSeconds: 30 } } })).ok, true);
  assert.deepEqual(set, [30_000, 120_000, 45_000], 'a sync key re-arms');
  assert.ok(cleared >= before + 3, 'the old timers were cleared');
  assert.equal(pulls, 1, 'no extra pullAll');

  set.length = 0;
  assert.equal((await svc.action('settings.save', { patch: { sync: { fastSeconds: 30 } } })).ok, true);
  assert.deepEqual(set, [], 'the same value re-arms nothing');

  assert.equal((await svc.action('settings.reset', { section: 'sync' })).ok, true);
  assert.deepEqual(set, [10_000, 60_000, 30_000], 'reset puts the defaults back');
  assert.equal(pulls, 1);
});

test('T7 timers: explicit options win over settings and are not re-armed by a settings change', async (t) => {
  const svc = await startTestService();
  t.after(() => svc.close());
  const realSet = globalThis.setInterval;
  const set = [];
  globalThis.setInterval = (fn, ms, ...r) => { set.push(ms); return realSet(fn, ms, ...r); };
  t.after(() => { globalThis.setInterval = realSet; svc.sync.stop(); });
  svc.sync.pullAll = async () => {};
  saveSettings({ sync: { fastSeconds: 20 } }, svc.dir);
  svc.sync.start({ fastMs: 5_000, slowMs: 6_000, filesMs: 7_000 });
  assert.deepEqual(set, [5_000, 6_000, 7_000]);
  set.length = 0;
  await svc.action('settings.save', { patch: { sync: { fastSeconds: 40, slowSeconds: 200, filesSeconds: 90 } } });
  assert.deepEqual(set, []);
  svc.sync.stop();
  await svc.action('settings.save', { patch: { sync: { fastSeconds: 41 } } });
  assert.deepEqual(set, [], 'a stopped sync is not restarted by a settings change');
});

// ------------------------------------------------------------------------------------------------ maintenance

test('T7 maintenance: data.* limits drive backups, event_log, decision_log and the gone-days rules; pane stays 7 days', () => {
  const dir = tmpDir('maint');
  const db = openDb(dir);
  const t = Date.UTC(2026, 9, 25);
  db.exec('BEGIN');
  const ev = db.prepare("INSERT INTO event_log(at, kind, text) VALUES(?, 'bus', 'e')");
  for (let i = 0; i < 700; i++) ev.run(t - i);
  const dl = db.prepare("INSERT INTO decision_log(kind, title, action, status, command, request_id, created_at) VALUES('gate','x','approve','sent','[]','r',?)");
  dl.run(t - 20 * DAY);
  dl.run(t - 5 * DAY);
  const rp = db.prepare("INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at, gone_at) VALUES(?,?,?,1,1,?)");
  rp.run('r-12', '/a', 'A', t - 12 * DAY);
  rp.run('r-3', '/b', 'B', t - 3 * DAY);
  db.prepare("INSERT INTO pane(pane_key, worktree_id, first_seen_at, last_seen_at, gone_at) VALUES('a:1','w',1,1,?)").run(t - 8 * DAY);
  db.exec('COMMIT');

  assert.deepEqual(dataLimits({}), { backupKeep: 7, goneDays: 30, decisionDays: 90, eventMax: 5000 }, 'defaults when nothing is saved');
  const limits = dataLimits({ data: { backupKeep: 2, goneDays: 10, decisionDays: 10, eventMax: 600 } });
  assert.deepEqual(limits, { backupKeep: 2, goneDays: 10, decisionDays: 10, eventMax: 600 });
  const out = prune(db, t, limits);
  const n = (sql) => db.prepare(sql).get().c;
  assert.equal(n('SELECT COUNT(*) AS c FROM event_log'), 600);
  assert.equal(n('SELECT COUNT(*) AS c FROM decision_log'), 1, 'older than decisionDays pruned');
  assert.equal(n("SELECT COUNT(*) AS c FROM repo WHERE id='r-12'"), 0, 'gone longer than goneDays: pruned');
  assert.equal(n("SELECT COUNT(*) AS c FROM repo WHERE id='r-3'"), 1);
  assert.equal(n('SELECT COUNT(*) AS c FROM pane'), 0, 'pane rule is its own 7 days');
  assert.equal(out.event_log, 100);

  // the same rows with the defaults: nothing but the pane goes
  const db2 = openDb(tmpDir('maint2'));
  db2.prepare("INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at, gone_at) VALUES('r-12','/a','A',1,1,?)").run(t - 12 * DAY);
  prune(db2, t);
  assert.equal(db2.prepare("SELECT COUNT(*) AS c FROM repo").get().c, 1);
  db2.close();

  // backups: runMaintenance keeps data.backupKeep files
  for (let d = 0; d < 5; d++) writeFileSync(join(dir, `mk-data.db.bak-2026010${d + 1}`), 'x');
  const r = runMaintenance(db, dir, t, { data: { backupKeep: 3 } });
  assert.ok(r.backup);
  const left = ['1', '2', '3', '4', '5'].map((d) => existsSync(join(dir, `mk-data.db.bak-2026010${d}`)));
  assert.deepEqual(left, [false, false, false, true, true], 'the newest 3 stay (today\'s copy and 01-04, 01-05)');
  db.close();
});

// ------------------------------------------------------------------------------------------------ undo window and snooze

test('T7 undo window and snooze default read general.*; an explicit undoMs wins', async (t) => {
  const run = async (o, seconds) => {
    const clock = fakeClock();
    const dir = tmpDir('undo');
    if (seconds !== undefined) saveSettings({ general: { undoSeconds: seconds, snoozeMinutes: 15 } }, dir);
    const runner = stubRunner({ 'orchestration gate-resolve': () => ({ ok: true, result: {} }) });
    const svc = await startTestService({ dir, clock, runner, ...o });
    t.after(() => svc.close());
    const at = clock.now();
    svc.ctx.db.prepare('INSERT INTO run(id, objective, repo_id, first_seen_at, last_seen_at) VALUES(?,?,?,?,?)').run('run_a', 'o', null, at, at);
    svc.ctx.db.prepare('INSERT INTO ask(id, kind, run_id, title, orca_status, asked_at, first_seen_at, last_seen_at) VALUES(?,?,?,?,?,?,?,?)').run('gate_1', 'gate', 'run_a', 't', 'pending', at, at, at);
    return { svc, clock, at };
  };
  const a = await run({}, 3);
  const r = await a.svc.action('approve', { askId: 'gate_1' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.commitAt, a.at + 3000, 'general.undoSeconds');
  const s = await a.svc.action('ask.snooze', { askId: 'gate_1' });
  assert.equal(s.snoozedUntil, a.at + 15 * 60_000, 'general.snoozeMinutes');
  assert.equal((await a.svc.action('ask.snooze', { askId: 'gate_1', minutes: 5 })).snoozedUntil, a.at + 5 * 60_000, 'explicit minutes win');

  const b = await run({}, undefined);
  assert.equal((await b.svc.action('approve', { askId: 'gate_1' })).commitAt, b.at + 10_000, 'default 10 s');

  const c = await run({ undoMs: 777 }, 3);
  assert.equal((await c.svc.action('approve', { askId: 'gate_1' })).commitAt, c.at + 777, 'the test option wins');

  const d = await run({}, 0);
  assert.equal((await d.svc.action('approve', { askId: 'gate_1' })).commitAt, d.at, '0 = no undo window');
});

// ------------------------------------------------------------------------------------------------ inbox folder

test('T7 inbox: plans.inboxDir moves the scan, import and archive; rows of an older folder are left as they are', async (t) => {
  const w = await world(t);
  w.put('.matrixkoder/inbox/' + NAME, planText());
  scanInbox(w.svc.ctx.db, { repoId: 'repo-1', repoPath: w.repoPath });
  assert.deepEqual(q(w.svc, 'SELECT path, status FROM inbox_file').map((r) => [r.path, r.status]), [[`inbox/${NAME}`, 'new']]);

  assert.equal((await w.svc.action('settings.save', { patch: { plans: { inboxDir: 'docs/plans' } } })).ok, true);
  w.put('docs/plans/' + NAME, planText());
  await w.svc.sync.scanFiles();
  const rows = q(w.svc, 'SELECT path, status FROM inbox_file ORDER BY path').map((r) => [r.path, r.status]);
  assert.deepEqual(rows, [[`docs/plans/${NAME}`, 'new'], [`inbox/${NAME}`, 'new']], 'the old row is untouched, not marked missing');

  const imp = await w.svc.action('inbox.import', { repoId: 'repo-1', name: NAME });
  assert.equal(imp.ok, true, JSON.stringify(imp));
  assert.ok(existsSync(join(w.repoPath, 'docs/plans/archive')), 'archived inside the configured folder');
  assert.ok(existsSync(join(w.repoPath, '.matrixkoder/inbox', NAME)), 'the old folder is not touched');
  assert.match(imp.result.path, /^docs\/plans\/archive\//);

  const snap = await (await get(w.svc, '/api/state')).json();
  assert.match(String(snap.settings?.inboxDir ?? ''), /docs\/plans$/);
});

test('T7 inbox: plans.autoImport imports only new files with fit pass', async (t) => {
  const w = await world(t);
  w.put('.matrixkoder/inbox/good.md', planText());
  w.put('.matrixkoder/inbox/notes.md', '# just notes\n\nnothing to import\n');
  await w.svc.sync.scanFiles();
  assert.equal(q(w.svc, 'SELECT * FROM plan').length, 0, 'off by default');

  await w.svc.action('settings.save', { patch: { plans: { autoImport: true } } });
  await w.svc.sync.scanFiles();
  assert.equal(q(w.svc, 'SELECT * FROM plan').length, 1, 'the pass file is imported');
  const by = Object.fromEntries(q(w.svc, 'SELECT name, status, fit FROM inbox_file').map((r) => [r.name, r.status]));
  assert.equal(by['notes.md'], 'new', 'a file that is not a plan stays');

  // a partial plan (bad route) is not imported either
  w.put('.matrixkoder/inbox/bad.md', planText().replace('plan = "orca-dashboard-wiring"', 'plan = "bad-routes"').replace(/(id = "STORE\.1"\n)/, '$1route = "nope nothing"\n'));
  await w.svc.sync.scanFiles();
  const bad = q(w.svc, "SELECT fit, status FROM inbox_file WHERE name = 'bad.md'")[0];
  assert.deepEqual([bad.fit, bad.status], ['partial', 'new']);
  assert.equal(q(w.svc, 'SELECT * FROM plan').length, 1);
});

// ------------------------------------------------------------------------------------------------ mk bug add

test('T7 mk bug add: --risk defaults to bugs.defaultRisk', () => {
  const dir = tmpDir('bug');
  const out = [];
  const err = [];
  const run = (argv) => main(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: {}, cwd: dir, orca: () => { throw new Error('no orca'); }, dir });
  const db = openDb(dir);
  db.prepare("INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at) VALUES('r1', ?, 'r', 1, 1)").run(dir);
  db.close();
  assert.equal(run(['bug', 'add', '--title', 'a', '--repo', 'r1']), 0, err.join());
  assert.equal(JSON.parse(out.at(-1)).risk, 3, 'default 3');
  saveSettings({ bugs: { defaultRisk: 5 } }, dir);
  assert.equal(run(['bug', 'add', '--title', 'b', '--repo', 'r1']), 0, err.join());
  assert.equal(JSON.parse(out.at(-1)).risk, 5, 'bugs.defaultRisk');
  assert.equal(run(['bug', 'add', '--title', 'c', '--repo', 'r1', '--risk', '2']), 0, err.join());
  assert.equal(JSON.parse(out.at(-1)).risk, 2, 'the flag wins');
});

// ------------------------------------------------------------------------------------------------ C9 route check at import

test('T7 import: a bad task route and a bad phase reviewer each make the plan partial with the C9 reason; plan.start refuses plan_partial', async (t) => {
  const badTask = planText().replace(/(id = "STORE\.1"\n)/, '$1route = "claude nosuchmodel"\n');
  assert.notEqual(badTask, planText(), 'the fixture edit applied');
  const badReviewer = planText().replace('reviewer = "claude opus"', 'reviewer = "gemini opus"');
  assert.notEqual(badReviewer, planText());

  for (const [label, text, re] of [
    ['task', badTask, /^task STORE\.1: route "claude nosuchmodel": model "nosuchmodel" is not in the claude model list/],
    ['reviewer', badReviewer, /^phase \w+: reviewer "gemini opus": unknown agent "gemini"/],
  ]) {
    const w = await world(t);
    w.put(`.matrixkoder/inbox/${NAME}`, text);
    const imp = await w.svc.action('inbox.import', { repoId: 'repo-1', name: NAME });
    assert.equal(imp.ok, true, `${label}: a partial plan still imports: ${JSON.stringify(imp)}`);
    const file = q(w.svc, 'SELECT fit, missing FROM inbox_file')[0];
    assert.equal(file.fit, 'partial', label);
    const missing = JSON.parse(file.missing);
    assert.ok(missing.some((m) => re.test(m)), `${label}: ${JSON.stringify(missing)}`);
    const plan = q(w.svc, 'SELECT * FROM plan')[0];
    const r = await w.svc.action('plan.start', { planId: plan.id });
    assert.equal(r.ok, false, label);
    assert.equal(r.error.kind, 'conflict');
    assert.equal(r.error.code, 'plan_partial');
    assert.ok(r.error.message.includes(missing[0]), `${label}: names the first reason: ${r.error.message}`);
    assert.equal(w.svc.ctx.db.prepare("SELECT COUNT(*) AS c FROM plan WHERE status = 'running'").get().c, 0);
  }
});

test('T7 import: the check reads the settings given; a clean plan is pass and starts; a saved agent list changes the verdict', async (t) => {
  const w = await world(t);
  w.put(`.matrixkoder/inbox/${NAME}`, planText());
  const imp = await w.svc.action('inbox.import', { repoId: 'repo-1', name: NAME });
  assert.equal(imp.ok, true);
  assert.equal(q(w.svc, 'SELECT fit FROM inbox_file')[0].fit, 'pass');
  const plan = q(w.svc, 'SELECT * FROM plan')[0];
  const r = await w.svc.action('plan.start', { planId: plan.id });
  assert.equal(r.ok, true, JSON.stringify(r));

  // direct store call: settings in the target are what the check uses
  const dir = tempDir('mk-cons-direct-');
  const db = openDb(tmpDir('direct'));
  db.prepare("INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at) VALUES('r', ?, 'r', 1, 1)").run(dir);
  mkdirSync(join(dir, '.matrixkoder', 'inbox'), { recursive: true });
  copyFileSync(REAL_PLAN, join(dir, '.matrixkoder', 'inbox', NAME));
  const off = defaultSettings();
  off.agents = { ...off.agents, claude: { ...off.agents.claude, routable: false } };
  const [row] = scanInbox(db, { repoId: 'r', repoPath: dir, settings: off });
  assert.equal(row.fit, 'partial');
  assert.match(JSON.parse(row.missing)[0], /not routable/);
  const [again] = scanInbox(db, { repoId: 'r', repoPath: dir });
  assert.equal(again.fit, 'pass', 'defaults when no settings are given');
  assert.equal(importFile(db, { repoId: 'r', repoPath: dir }, NAME).action, 'created');
  db.close();
});

test('T7 inbox: an inbox folder nested under the default prefix is not marked missing when the default folder is scanned again', async (t) => {
  const w = await world(t);
  w.put('inbox/plans/x.md', '# not a plan\n');
  w.put('.matrixkoder/inbox/y.md', '# not a plan\n');
  const db = w.svc.ctx.db;
  const sub = mergeSettings(defaultSettings(), { plans: { inboxDir: 'inbox/plans' } });
  scanInbox(db, { repoId: 'repo-1', repoPath: w.repoPath, settings: sub });
  scanInbox(db, { repoId: 'repo-1', repoPath: w.repoPath, settings: defaultSettings() });
  const rows = db.prepare('SELECT path, status FROM inbox_file ORDER BY path').all().map((r) => [r.path, r.status]);
  assert.equal(rows.find((r) => r[0] === 'inbox/plans/x.md')?.[1], 'new', JSON.stringify(rows));
  assert.equal(rows.find((r) => r[0] === 'inbox/y.md')?.[1], 'new');
});
