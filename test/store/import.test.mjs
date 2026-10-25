import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../out/store/db.js';
import { scanInbox, importFile, ImportError } from '../../out/store/import.js';
import { parsePlan, parseToml } from '../../out/store/plan-parse.js';
import { tmpDataDir } from './helpers.mjs';

const REAL_PLAN = new URL('../../.matrixkoder/inbox/orca-dashboard-wiring.md', import.meta.url).pathname;
const NAME = 'orca-dashboard-wiring.md';
const planText = () => readFileSync(REAL_PLAN, 'utf8');

/** A temp repo whose inbox holds a copy of the real plan, and a fresh database. Never touches the real inbox. */
function setup(text = planText()) {
  const repoPath = mkdtempSync(join(tmpdir(), 'mk-repo-'));
  const inbox = join(repoPath, '.matrixkoder', 'inbox');
  mkdirSync(inbox, { recursive: true });
  if (text === planText()) copyFileSync(REAL_PLAN, join(inbox, NAME));
  else writeFileSync(join(inbox, NAME), text);
  const db = openDb(tmpDataDir('imp'));
  const t = { repoId: 'repo-1', repoPath };
  const drop = (txt, name = NAME) => writeFileSync(join(inbox, name), txt);
  return { db, t, inbox, repoPath, drop };
}
const q = (db, sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
const q1 = (db, sql, ...p) => q(db, sql, ...p)[0];
const json = (s) => JSON.parse(s);

test('the real plan scans as a pass and imports into 6 phases, every task and the nested WIRE.2 subtasks', () => {
  const { db, t, inbox } = setup();
  const [row] = scanInbox(db, t);
  assert.equal(row.status, 'new');
  assert.equal(row.fit, 'pass');
  assert.deepEqual(json(row.missing), []);
  assert.equal(row.slug, 'orca-dashboard-wiring');
  assert.equal(row.path, `inbox/${NAME}`);

  const r = importFile(db, t, NAME);
  assert.equal(r.action, 'created');
  assert.equal(r.version, 1);
  assert.ok(!existsSync(join(inbox, NAME)), 'file left the inbox');
  assert.ok(existsSync(join(inbox, 'archive', NAME)), 'file is in inbox/archive/');
  const inboxRow = q1(db, 'SELECT * FROM inbox_file');
  assert.equal(inboxRow.status, 'imported');
  assert.equal(inboxRow.path, `inbox/archive/${NAME}`);
  assert.equal(inboxRow.plan_id, r.planId);

  const plan = q1(db, 'SELECT * FROM plan');
  assert.equal(plan.slug, 'orca-dashboard-wiring');
  assert.equal(plan.status, 'imported');
  assert.equal(plan.file_status, 'draft');
  assert.equal(plan.integration_branch, 'main');
  assert.equal(plan.pushed, 0);
  assert.equal(plan.title, 'the MatrixKoder dashboard shows real Orca and MK data, served by the plugin worker');

  // phases: waves, lanes, deps, settings
  const phases = q(db, 'SELECT * FROM plan_phase ORDER BY ord');
  assert.deepEqual(phases.map((p) => [p.code, p.wave]), [['SPIKE', 1], ['STORE', 2], ['ORCA', 3 - 1], ['SERVE', 3], ['WIRE', 3], ['LAUNCH', 4]]);
  assert.equal(phases.length, 6);
  assert.ok(phases.every((p) => p.lane_group === ''), 'no lane_group in this plan: each phase is its own lane');
  const store = phases[1];
  assert.deepEqual(json(store.deps), ['SPIKE']);
  assert.deepEqual(json(store.owned), ['src/store/', 'bin/', 'test/store/']);
  assert.equal(store.commit_msg, 'feat(store): mk-data.db, mk-settings.json and the mk CLI');
  assert.equal(store.size, 'complex');
  assert.equal(store.route, 'claude sonnet medium');
  assert.equal(store.reviewer, 'claude opus');
  assert.equal(store.subagents, 1);
  assert.deepEqual(json(store.serves), ['G2', 'G3', 'G4']);
  assert.deepEqual(json(store.hazards), ['K3']);
  assert.deepEqual(json(store.carries), ['C1', 'C2', 'C3', 'C4', 'T1', 'T2', 'T3', 'T10', 'A1']);
  assert.match(store.goal, /^`~\/\.matrixkoder\/mk-data\.db` and `mk-settings\.json` are created/);
  assert.deepEqual(json(phases[3].deps), ['STORE', 'ORCA']);
  assert.deepEqual(json(phases[4].qa), ['dashboard-live']);

  // tasks
  const tasks = q(db, 'SELECT t.*, p.code AS phase FROM plan_task t JOIN plan_phase p ON p.id=t.phase_id ORDER BY p.ord, t.ord');
  assert.equal(tasks.length, 19);
  assert.deepEqual(tasks.map((x) => x.code), [
    'SPIKE.1', 'SPIKE.2', 'STORE.1', 'STORE.2', 'STORE.3', 'STORE.4', 'ORCA.1', 'ORCA.2', 'ORCA.3', 'SERVE.1', 'SERVE.2', 'SERVE.3',
    'WIRE.1', 'WIRE.2', 'WIRE.3', 'WIRE.4', 'LAUNCH.1', 'LAUNCH.2', 'LAUNCH.3',
  ]);
  const byCode = Object.fromEntries(tasks.map((x) => [x.code, x]));
  assert.equal(byCode['STORE.4'].risk, 4);
  assert.equal(byCode['STORE.4'].gate, 'node --test test/store/import.test.mjs');
  assert.deepEqual(json(byCode['STORE.4'].deps), ['STORE.1']);
  assert.deepEqual(json(byCode['STORE.4'].covers), ['T10']);
  assert.equal(byCode['STORE.4'].subagent, 0);
  assert.equal(byCode['STORE.2'].subagent, 1);
  assert.deepEqual(json(byCode['STORE.2'].owned), ['src/store/settings.ts', 'test/store/settings.test.mjs']);
  assert.equal(json(byCode['STORE.1'].acceptance).length, 4);
  assert.equal(byCode['SPIKE.1'].manual.startsWith('the orchestrator reads spike-report.md'), true);
  assert.equal(byCode['LAUNCH.3'].risk, 3);
  assert.deepEqual(json(byCode['WIRE.4'].deps), ['WIRE.2', 'SERVE']);
  assert.equal(byCode['SPIKE.1'].status, 'ready', 'wave 1 task without deps is ready');
  assert.equal(byCode['STORE.1'].status, 'pending', 'its phase waits on SPIKE');
  assert.ok(tasks.every((x) => x.orca_task_id === null && x.attempts === 0 && x.past_task_ids === '[]'));

  // nested subtasks
  const subs = q(db, 'SELECT s.*, t.code AS task FROM plan_subtask s JOIN plan_task t ON t.id=s.task_id ORDER BY s.code');
  assert.deepEqual(subs.map((s) => [s.code, s.task, s.ord]), [['WIRE.2.1', 'WIRE.2', 1], ['WIRE.2.2', 'WIRE.2', 2], ['WIRE.2.3', 'WIRE.2', 3]]);
  assert.deepEqual(json(subs[0].owned), ['panel/screens/Main.dc.html', 'panel/screens/Lanes.dc.html', 'panel/screens/Waiting.dc.html']);
  assert.equal(json(subs[1].acceptance).length, 1);
  assert.ok(subs.every((s) => s.status === 'pending'));

  // items
  const kinds = Object.fromEntries(q(db, 'SELECT kind, COUNT(*) AS n FROM plan_item GROUP BY kind').map((k) => [k.kind, k.n]));
  assert.deepEqual(kinds, { goal: 4, meta: 3, contract: 8, test: 11, assumption: 8, rollout: 2, setting: 6, gate: 3, risk: 17, question: 11, log: 11 });
  const gates = q(db, "SELECT code, data FROM plan_item WHERE kind='gate' ORDER BY ord").map((g) => [g.code, json(g.data).command, json(g.data).extra, json(g.data).timeout]);
  assert.deepEqual(gates, [['unit', 'npm test', true, 600], ['types', 'npx tsc --noEmit', true, 600], ['bundle', 'npm run build', true, 600]]);
  const k14 = q1(db, "SELECT * FROM plan_item WHERE kind='risk' AND code='K14'");
  assert.deepEqual([json(k14.data).level, json(k14.data).ref], [4, 'STORE.4']);
  assert.equal(q1(db, "SELECT done FROM plan_item WHERE code='Q11'").done, 1);
  assert.equal(json(q1(db, "SELECT data FROM plan_item WHERE code='T10'").data).written_by, 'STORE.4');

  // version and views
  const v = q1(db, 'SELECT * FROM plan_version');
  assert.equal(v.body, planText());
  assert.equal(v.fit, 'pass');
  assert.equal(v.note, 'initial');
  assert.equal(v.source_path, `inbox/${NAME}`);
  assert.match(v.source_sha, /^[0-9a-f]{64}$/);
  const counts = q1(db, 'SELECT * FROM v_plan_counts');
  assert.deepEqual([counts.phases, counts.waves, counts.tasks, counts.subtasks], [6, 4, 19, 3]);
  assert.equal(q(db, 'SELECT * FROM v_phase ORDER BY ord').length, 6);
  assert.equal(q1(db, 'PRAGMA integrity_check').integrity_check, 'ok');
});

/** Make STORE.1 look started, the way the Start action and the sync loop would leave it. */
function startTask(db) {
  db.prepare("UPDATE plan SET status='running', orca_run_id='run_abc123def456', started_at=100 WHERE slug='orca-dashboard-wiring'").run();
  db.prepare(
    `UPDATE plan_task SET orca_run_id='run_abc123def456', orca_task_id='task_current', attempts=2, past_task_ids='["task_old"]',
            status='working', last_state='dispatched', last_state_at=200, started_at=150 WHERE code='STORE.1'`,
  ).run();
  db.prepare("UPDATE plan_task SET status='done', orca_task_id='task_spike2', attempts=1, done_at=300 WHERE code='SPIKE.2'").run();
  db.prepare("UPDATE plan_subtask SET status='done', note='shipped' WHERE code='WIRE.2.1'").run();
}

const v2Text = () =>
  planText()
    .replace('title = "mk-data.db schema and access"', 'title = "mk-data.db schema and access, revised"')
    .replace('title = "Bugs, Todo, Settings"', 'title = "Bugs, Todo and Settings tabs"')
    .replace(/\+\+\+ 5\.3\.3 ORCA\.3[\s\S]*?\n\/\+\+\+\n\n/, '') // ORCA.3 removed from the plan
    .replace(
      '+++ 5.3 ORCA',
      `+++ 5.2.5 STORE.5 — extra task [toml]
id = "STORE.5"
title = "extra task"
acceptance = ["it exists"]
risk = 2
/+++

+++ 5.3 ORCA`,
    );

test('re-import of a running plan: a new plan_version and the change shows, started tasks keep their Orca links and status', () => {
  const { db, t, inbox, drop } = setup();
  importFile(db, t, NAME);
  startTask(db);
  const before = q1(db, "SELECT * FROM plan_task WHERE code='STORE.1'");

  drop(v2Text());
  const changed = scanInbox(db, t).find((r) => r.path === `inbox/${NAME}`);
  assert.equal(changed.status, 'changed', 'a changed file shows as changed in the inbox');
  assert.equal(changed.path, `inbox/${NAME}`);
  assert.equal(changed.fit, 'pass');

  const r = importFile(db, t, NAME);
  assert.equal(r.action, 'merged');
  assert.equal(r.version, 2);
  assert.equal(r.note, 'merged: +1 tasks, ~1 changed, -1 dropped');
  assert.equal(q(db, 'SELECT version FROM plan_version ORDER BY version').map((x) => x.version).join(), '1,2');
  assert.equal(q1(db, 'SELECT version, status FROM plan').version, 2);
  assert.equal(q1(db, 'SELECT status FROM plan').status, 'running', 'plan status is not reset');

  const after = q1(db, "SELECT * FROM plan_task WHERE code='STORE.1'");
  assert.equal(after.title, 'mk-data.db schema and access, revised', 'the change shows');
  for (const col of ['orca_run_id', 'orca_task_id', 'attempts', 'past_task_ids', 'status', 'last_state', 'last_state_at', 'started_at', 'created_at', 'id']) {
    assert.equal(after[col], before[col], `${col} kept`);
  }
  assert.equal(after.orca_task_id, 'task_current');
  assert.equal(after.attempts, 2);
  assert.equal(after.past_task_ids, '["task_old"]');
  assert.equal(after.status, 'working');
  assert.equal(after.spec_drift, 1, 'the Orca task holds the old title, so spec_drift is set');

  const spike2 = q1(db, "SELECT * FROM plan_task WHERE code='SPIKE.2'");
  assert.deepEqual([spike2.status, spike2.orca_task_id, spike2.done_at, spike2.spec_drift], ['done', 'task_spike2', 300, 0]);
  assert.equal(q1(db, "SELECT status, note FROM plan_subtask WHERE code='WIRE.2.1'").status, 'done');
  assert.equal(q1(db, "SELECT note FROM plan_subtask WHERE code='WIRE.2.1'").note, 'shipped');
  assert.equal(q1(db, "SELECT title FROM plan_subtask WHERE code='WIRE.2.3'").title, 'Bugs, Todo and Settings tabs');
  assert.equal(q1(db, "SELECT status FROM plan_task WHERE code='STORE.5'").status, 'pending', 'new code is inserted pending');
  assert.ok(q1(db, "SELECT dropped_at FROM plan_task WHERE code='ORCA.3'").dropped_at > 0, 'a task with no Orca link that left the file is dropped');
  assert.equal(q1(db, 'SELECT tasks FROM v_plan_counts').tasks, 19, '19 + 1 new - 1 dropped');
  assert.equal(q1(db, "SELECT COUNT(*) AS n FROM plan_task WHERE code='ORCA.3'").n, 1, 'the dropped row is kept');

  // the file moved to the archive under a new name; the first import's copy is untouched
  assert.deepEqual(readdirSync(join(inbox, 'archive')).length, 2);
  assert.ok(!existsSync(join(inbox, NAME)));
  assert.equal(q1(db, 'SELECT COUNT(*) AS n FROM inbox_file').n, 2);
  assert.equal(q(db, "SELECT status FROM inbox_file WHERE status <> 'imported'").length, 0);
  assert.equal(q1(db, 'PRAGMA integrity_check').integrity_check, 'ok');
});

test('a re-import never clears Orca links even when the file removes the started task\'s siblings', () => {
  const { db, t, drop } = setup();
  importFile(db, t, NAME);
  startTask(db);
  // STORE.1 itself leaves the file while it holds a live Orca link and is working: refused, nothing changes.
  drop(planText().replace(/\+\+\+ 5\.2\.1 STORE\.1[\s\S]*?\n\/\+\+\+\n\n/, ''));
  assert.throws(() => importFile(db, t, NAME), (e) => e instanceof ImportError && e.conflicts.length === 1 && /task STORE\.1 is working/.test(e.message));
  assert.equal(q1(db, 'SELECT version FROM plan').version, 1);
  assert.equal(q1(db, "SELECT orca_task_id, dropped_at FROM plan_task WHERE code='STORE.1'").orca_task_id, 'task_current');
  assert.equal(q1(db, "SELECT dropped_at FROM plan_task WHERE code='STORE.1'").dropped_at, null);
  assert.equal(q1(db, 'SELECT COUNT(*) AS n FROM plan_version').n, 1);
  assert.ok(existsSync(join(t.repoPath, '.matrixkoder', 'inbox', NAME)), 'file stays in the inbox after a refusal');

  // A finished task that leaves the file is dropped, but a created-not-started task with an Orca link is kept as is.
  db.prepare("UPDATE plan_task SET status='done' WHERE code='STORE.1'").run();
  db.prepare("UPDATE plan_task SET orca_task_id='task_ready', status='ready' WHERE code='STORE.2'").run();
  drop(planText().replace(/\+\+\+ 5\.2\.1 STORE\.1[\s\S]*?\n\/\+\+\+\n\n/, '').replace(/\+\+\+ 5\.2\.2 STORE\.2[\s\S]*?\n\/\+\+\+\n\n/, ''));
  const r = importFile(db, t, NAME);
  assert.equal(r.action, 'merged');
  assert.ok(q1(db, "SELECT dropped_at FROM plan_task WHERE code='STORE.1'").dropped_at > 0);
  const kept = q1(db, "SELECT dropped_at, orca_task_id, status FROM plan_task WHERE code='STORE.2'");
  assert.deepEqual(kept, { dropped_at: null, orca_task_id: 'task_ready', status: 'ready' });
});

test('re-import of an imported (not started) plan rebuilds the structure and keeps todo links by code', () => {
  const { db, t, drop } = setup();
  importFile(db, t, NAME);
  const oldId = q1(db, "SELECT id FROM plan_task WHERE code='STORE.3'").id;
  const orcaId = q1(db, "SELECT id FROM plan_task WHERE code='ORCA.3'").id;
  const t0 = Date.now();
  db.prepare("INSERT INTO todo(repo_id, text, link_kind, link_ref, created_at) VALUES('repo-1','a','task',?,?)").run(String(oldId), t0);
  db.prepare("INSERT INTO todo(repo_id, text, link_kind, link_ref, created_at) VALUES('repo-1','b','task',?,?)").run(String(orcaId), t0);
  drop(v2Text());
  const r = importFile(db, t, NAME);
  assert.equal(r.action, 'replaced');
  assert.equal(r.version, 2);
  assert.equal(q1(db, "SELECT COUNT(*) AS n FROM plan_task WHERE code='ORCA.3'").n, 0, 'rebuilt: the dropped task is gone');
  assert.equal(q1(db, 'SELECT COUNT(*) AS n FROM plan_task').n, 19);
  const newId = q1(db, "SELECT id FROM plan_task WHERE code='STORE.3'").id;
  assert.equal(q1(db, "SELECT link_ref FROM todo WHERE text='a'").link_ref, String(newId));
  assert.deepEqual(q1(db, "SELECT link_kind, link_ref FROM todo WHERE text='b'"), { link_kind: null, link_ref: null }, 'a dropped target becomes plain text');
});

test('the same text again is a no-op that links to the existing plan; finished plans refuse', () => {
  const { db, t, drop } = setup();
  const first = importFile(db, t, NAME);
  drop(planText());
  const row = scanInbox(db, t).find((r) => r.path === `inbox/${NAME}`);
  assert.equal(row.status, 'imported', 'same sha as the current version: already imported');
  assert.equal(row.plan_id, first.planId);
  const r = importFile(db, t, NAME);
  assert.equal(r.action, 'noop');
  assert.equal(q1(db, 'SELECT COUNT(*) AS n FROM plan_version').n, 1);

  db.prepare("UPDATE plan SET status='done'").run();
  drop(v2Text());
  assert.throws(() => importFile(db, t, NAME), /plan orca-dashboard-wiring is done; use a new slug/);
});

test('fit: not_a_plan cannot be imported; partial lists what is missing and can', () => {
  // no block 1
  let s = setup(planText().replace(/\+\+\+ 1 Top block[\s\S]*?\n\/\+\+\+\n\n/, ''));
  let [row] = scanInbox(s.db, s.t);
  assert.equal(row.fit, 'not_a_plan');
  assert.match(row.missing, /no block 1/);
  assert.throws(() => importFile(s.db, s.t, NAME), /is not a plan/);
  assert.equal(q1(s.db, 'SELECT COUNT(*) AS n FROM plan').n, 0);
  assert.ok(existsSync(join(s.inbox, NAME)));

  // a block that never closes
  s = setup(planText().replace('/+++\n\n+++ 9 Log', '\n+++ 9 Log'));
  [row] = scanInbox(s.db, s.t);
  assert.equal(row.fit, 'not_a_plan');

  // zero phase and task blocks
  s = setup(planText().replace(/\+\+\+ 5\.\d[\s\S]*?\n\/\+\+\+\n\n/g, ''));
  [row] = scanInbox(s.db, s.t);
  assert.equal(row.fit, 'not_a_plan');
  assert.match(row.missing, /no phase or task blocks/);

  // bad slug
  s = setup(planText().replace('plan = "orca-dashboard-wiring"', 'plan = "Orca Wiring"'));
  assert.equal(scanInbox(s.db, s.t)[0].fit, 'not_a_plan');

  // partial: no Log, a phase without commit, a bad dep, a duplicate id, an unknown covers id
  const partialText = planText()
    .replace(/\+\+\+ 9 Log[\s\S]*?\n\/\+\+\+\n/, '')
    .replace('commit = "feat(store): mk-data.db, mk-settings.json and the mk CLI"\n', '')
    .replace('deps = ["STORE.1"]\nsubagent = true\nowned = ["src/store/settings.ts"', 'deps = ["NOPE.9"]\nsubagent = true\nowned = ["src/store/settings.ts"')
    .replace('id = "STORE.3"', 'id = "STORE.2"')
    .replace('covers = ["T10"]', 'covers = ["T99"]');
  s = setup(partialText);
  [row] = scanInbox(s.db, s.t);
  assert.equal(row.fit, 'partial');
  const missing = JSON.parse(row.missing);
  for (const m of ['Block 9 Log', 'phase STORE: commit', 'task STORE.2: deps names unknown id NOPE.9', 'duplicate id STORE.2', 'task STORE.4: covers names unknown id T99']) {
    assert.ok(missing.includes(m), `missing lists "${m}" (got ${JSON.stringify(missing)})`);
  }
  const r = importFile(s.db, s.t, NAME);
  assert.equal(r.action, 'created');
  assert.equal(q1(s.db, 'SELECT fit, missing FROM plan_version').fit, 'partial');
});

test('a file moved by hand shows as missing; a file over 1 MB is not a plan', () => {
  const s = setup();
  scanInbox(s.db, s.t);
  writeFileSync(join(s.inbox, 'big.md'), 'x'.repeat(1024 * 1024 + 1));
  const rows = scanInbox(s.db, s.t);
  assert.equal(rows.find((r) => r.name === 'big.md').fit, 'not_a_plan');
  mkdirSync(join(s.inbox, 'elsewhere'));
  writeFileSync(join(s.inbox, 'elsewhere', 'x'), '');
  const gone = join(s.inbox, NAME);
  assert.ok(existsSync(gone));
  // delete from disk
  writeFileSync(gone, 'x'); // keep the file but make it not a plan
  assert.equal(scanInbox(s.db, s.t).find((r) => r.name === NAME).fit, 'not_a_plan');
});

test('the TOML reader handles what plans use: comments, multi-line arrays, tables, escapes', () => {
  const t = parseToml(`# c
id = "A.1"   # trailing
n = 3
b = true
d = 2026-10-24
arr = [
  "x",   # why
  "y \\"quoted\\"",
]
empty = []

[extra]
unit = "npm test"
`);
  assert.deepEqual(t, { id: 'A.1', n: 3, b: true, d: '2026-10-24', arr: ['x', 'y "quoted"'], empty: [], extra: { unit: 'npm test' } });
  assert.throws(() => parseToml('a = '), /line 1/);
  assert.throws(() => parseToml('a = "open'), /not closed/);
  assert.equal(parsePlan('nothing here').fit, 'not_a_plan');
});
