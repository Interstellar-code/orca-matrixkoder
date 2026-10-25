import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, tx, nextBugId, nextCounter, dataDir, dbPath, SCHEMA_VERSION } from '../../out/store/db.js';
import { backupIfDue, prune, runMaintenance } from '../../out/store/maintenance.js';
import { tmpDataDir, TABLES, VIEWS, INDEXES } from './helpers.mjs';

const names = (db, type) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%'").all(type).map((r) => r.name);

test('dataDir honours MK_DATA_DIR and defaults to ~/.matrixkoder', () => {
  assert.equal(dataDir({ MK_DATA_DIR: '/x/y' }), '/x/y');
  assert.match(dataDir({}), /\.matrixkoder$/);
});

test('open creates every C1 table, index and view', () => {
  const dir = tmpDataDir('db');
  const db = openDb(dir);
  assert.deepEqual(names(db, 'table').sort(), [...TABLES].sort());
  assert.deepEqual(names(db, 'view').sort(), [...VIEWS].sort());
  const idx = names(db, 'index').filter((n) => !n.startsWith('sqlite_autoindex'));
  assert.deepEqual(idx.sort(), [...INDEXES].sort());
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_version').get().v, SCHEMA_VERSION);
  db.close();
});

test('PRAGMAs apply on every open: WAL, busy_timeout 5000, foreign_keys on', () => {
  const dir = tmpDataDir('db');
  for (let i = 0; i < 2; i++) {
    const db = openDb(dir);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    db.close();
  }
});

test('re-open is a no-op: no new schema_version row, schema text unchanged', () => {
  const dir = tmpDataDir('db');
  const a = openDb(dir);
  const before = a.prepare('SELECT * FROM schema_version').all();
  const sql = a.prepare("SELECT group_concat(sql, ';') AS s FROM sqlite_master ORDER BY name").get().s;
  a.close();
  const b = openDb(dir);
  assert.deepEqual(b.prepare('SELECT * FROM schema_version').all(), before);
  assert.equal(b.prepare("SELECT group_concat(sql, ';') AS s FROM sqlite_master ORDER BY name").get().s, sql);
  b.close();
  assert.ok(existsSync(dbPath(dir)));
});

test('CHECK constraints reject bad rows', () => {
  const db = openDb(tmpDataDir('db'));
  const t = Date.now();
  const bug = (risk, status = 'open') =>
    db.prepare('INSERT INTO bug(id, repo_id, title, risk, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(`B-${Math.random()}`, 'r', 't', risk, status, t, t);
  bug(3);
  assert.throws(() => bug(6), /CHECK/);
  assert.throws(() => bug(0), /CHECK/);
  assert.throws(() => bug(3, 'bogus'), /CHECK/);
  assert.throws(
    () => db.prepare("INSERT INTO todo(repo_id, text, link_kind, created_at) VALUES('r','x','task',?)").run(t),
    /CHECK/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO bug(id, repo_id, title, past_task_ids, created_at, updated_at) VALUES('B-j','r','t','not json',?,?)").run(t, t),
    /CHECK/,
  );
  db.close();
});

test('counter gives global B-n ids', () => {
  const db = openDb(tmpDataDir('db'));
  assert.deepEqual([nextBugId(db), nextBugId(db), nextBugId(db)], ['B-1', 'B-2', 'B-3']);
  assert.equal(nextCounter(db, 'other'), 1);
  assert.equal(nextBugId(db), 'B-4');
  db.close();
});

test('two writers at once (child process plus this one) both commit every row; integrity ok', async () => {
  const dir = tmpDataDir('db');
  const N = 250;
  // Both processes open an EMPTY database at the same moment, so the migration race is covered too.
  const child = spawn(process.execPath, [new URL('./writer-child.mjs', import.meta.url).pathname, dir, 'child', String(N)], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const exited = new Promise((res) => child.on('exit', res));
  const db = openDb(dir);
  for (let i = 0; i < N; i++) {
    tx(db, () => {
      const t = Date.now();
      db.prepare('INSERT INTO bug(id, repo_id, title, created_at, updated_at) VALUES(?,?,?,?,?)').run(nextBugId(db), 'repo-x', `parent-${i}`, t, t);
    });
  }
  assert.equal(await exited, 0, 'child writer exited 0');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM bug WHERE title LIKE 'parent-%'").get().c, N);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM bug WHERE title LIKE 'child-%'").get().c, N);
  assert.equal(db.prepare('SELECT COUNT(DISTINCT id) AS c FROM bug').get().c, 2 * N, 'every B-n unique');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM schema_version').get().c, 1, 'migrated exactly once');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
});

test('a sync UPSERT and a CLI/import write do not overwrite each other (column ownership)', () => {
  const db = openDb(tmpDataDir('db'));
  const t = Date.now();
  db.prepare("INSERT INTO repo(id, path, display_name, bug_run_id, first_seen_at, last_seen_at) VALUES('r1','/a','A','run_mk',?,?)").run(t, t);
  // The sync loop's shape: update only the [C] and [S] columns.
  db.prepare(
    `INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at) VALUES('r1','/b','B',?,?)
     ON CONFLICT(id) DO UPDATE SET path=excluded.path, display_name=excluded.display_name, last_seen_at=excluded.last_seen_at`,
  ).run(t, t + 1);
  const r = db.prepare("SELECT * FROM repo WHERE id='r1'").get();
  assert.equal(r.path, '/b');
  assert.equal(r.bug_run_id, 'run_mk', 'the MK-owned bug_run_id survives the sync upsert');
  db.close();
});

test('v_orca_task_owner returns current and past ids; deleting a plan cascades', () => {
  const db = openDb(tmpDataDir('db'));
  const t = Date.now();
  db.prepare("INSERT INTO bug(id, repo_id, title, orca_task_id, past_task_ids, created_at, updated_at) VALUES('B-1','r','t','task_cur','[\"task_old\"]',?,?)").run(t, t);
  const plan = db.prepare("INSERT INTO plan(slug, repo_id, title, status, created_at, updated_at) VALUES('s','r','T','imported',?,?) RETURNING id").get(t, t).id;
  const phase = db.prepare("INSERT INTO plan_phase(plan_id, code, ord, title) VALUES(?,?,?,?) RETURNING id").get(plan, 'P', 1, 'P').id;
  db.prepare("INSERT INTO plan_task(plan_id, phase_id, code, ord, title, orca_task_id, past_task_ids, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(plan, phase, 'P.1', 1, 'x', 'task_ptc', '["task_ptp"]', t, t);
  const owners = db.prepare('SELECT orca_task_id, owner_kind, owner_id, is_current FROM v_orca_task_owner ORDER BY orca_task_id').all().map((r) => ({ ...r }));
  assert.deepEqual(owners.map((o) => [o.orca_task_id, o.owner_kind, o.is_current]), [
    ['task_cur', 'bug', 1], ['task_old', 'bug', 0], ['task_ptc', 'plan_task', 1], ['task_ptp', 'plan_task', 0],
  ]);
  assert.throws(() => db.prepare("UPDATE plan_task SET status='bogus'").run(), /CHECK/);
  db.prepare("INSERT INTO plan_subtask(plan_id, task_id, code, ord, title) VALUES(?,(SELECT id FROM plan_task WHERE plan_id=?),'P.1.1',1,'s')").run(plan, plan);
  db.prepare("INSERT INTO plan_version(plan_id, version, source_sha, source_path, body, fit, imported_at) VALUES(?,1,'x','inbox/s.md','b','pass',?)").run(plan, t);
  assert.throws(() => db.prepare('DELETE FROM plan_phase WHERE plan_id=?').run(plan), /FOREIGN KEY/, 'a phase with tasks cannot be deleted alone');
  db.prepare('DELETE FROM plan WHERE id=?').run(plan);
  for (const tbl of ['plan_phase', 'plan_task', 'plan_subtask', 'plan_version']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM ${tbl}`).get().c, 0, `${tbl} cascaded`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM bug').get().c, 1, 'bugs are not touched');
  db.close();
});

test('daily backup: VACUUM INTO once a day, keeps 7, copy opens with the data', () => {
  const dir = tmpDataDir('db');
  const db = openDb(dir);
  const t = Date.UTC(2026, 9, 1, 12);
  db.prepare("INSERT INTO bug(id, repo_id, title, created_at, updated_at) VALUES('B-1','r','keep me',?,?)").run(t, t);
  const first = backupIfDue(db, dir, t);
  assert.ok(first && existsSync(first));
  assert.equal(backupIfDue(db, dir, t + 1000), null, 'same day: no second copy');
  const copy = new DatabaseSync(first, { readOnly: true });
  assert.equal(copy.prepare("SELECT title FROM bug WHERE id='B-1'").get().title, 'keep me');
  copy.close();
  for (let d = 1; d <= 9; d++) backupIfDue(db, dir, t + d * 86_400_000);
  const baks = readdirSync(dir).filter((f) => f.startsWith('mk-data.db.bak-'));
  assert.equal(baks.length, 7);
  assert.ok(!baks.some((f) => f.endsWith('20261001')), 'oldest copies were dropped');
  db.close();
});

test('runMaintenance backs up and prunes once per day', () => {
  const dir = tmpDataDir('db');
  const db = openDb(dir);
  const t = Date.UTC(2026, 9, 1, 12);
  const first = runMaintenance(db, dir, t);
  assert.ok(first && first.backup);
  assert.equal(runMaintenance(db, dir, t + 1000), null);
  assert.ok(runMaintenance(db, dir, t + 86_400_000));
  db.close();
});

test('prune applies the section 7 rules and never touches bug, todo, plan or counter', () => {
  const db = openDb(tmpDataDir('db'));
  const D = 86_400_000;
  const t = Date.UTC(2026, 9, 25);
  tx(db, () => {
    const ev = db.prepare("INSERT INTO event_log(at, kind, text) VALUES(?, 'bus', 'e')");
    for (let i = 0; i < 5100; i++) ev.run(t - i);
    const dl = db.prepare("INSERT INTO decision_log(kind, title, action, status, command, request_id, created_at) VALUES('gate','x','approve',?, '[]', 'r', ?)");
    dl.run('pending', t - 200 * D); // pending rows are never pruned
    dl.run('sent', t - 200 * D); // older than 90 days
    dl.run('sent', t - 1 * D);
    db.prepare("INSERT INTO pane(pane_key, worktree_id, first_seen_at, last_seen_at, gone_at) VALUES('a:1','w',1,1,?)").run(t - 8 * D);
    db.prepare("INSERT INTO pane(pane_key, worktree_id, first_seen_at, last_seen_at, gone_at) VALUES('a:2','w',1,1,?)").run(t - 6 * D);
    db.prepare("INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at, gone_at) VALUES('r-old','/o','O',1,1,?)").run(t - 40 * D);
    db.prepare("INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at, gone_at) VALUES('r-bug','/b','B',1,1,?)").run(t - 40 * D);
    db.prepare("INSERT INTO bug(id, repo_id, title, created_at, updated_at) VALUES('B-1','r-bug','t',1,1)").run();
    db.prepare("INSERT INTO todo(repo_id, text, created_at) VALUES('r-bug','x',1)").run();
    db.prepare("INSERT INTO alert_sent(key, at) VALUES('old', ?), ('new', ?)").run(t - 31 * D, t - D);
    const pid = db.prepare("INSERT INTO plan(slug, repo_id, title, status, version, created_at, updated_at) VALUES('s','r-bug','T','imported',14,1,1) RETURNING id").get().id;
    for (let v = 1; v <= 14; v++)
      db.prepare("INSERT INTO plan_version(plan_id, version, source_sha, source_path, body, fit, imported_at) VALUES(?,?,'x','p','b','pass',1)").run(pid, v);
    const cr = db.prepare("INSERT INTO check_result(orca_task_id, name, status, source, at) VALUES('task_a','test','passed',?,?)");
    for (let i = 0; i < 25; i++) cr.run(`msg:${i}`, t - i * 1000);
    db.prepare("INSERT INTO check_result(orca_task_id, name, status, source, at) VALUES('task_b','test','passed','msg:b',?)").run(t - 60 * D); // latest for its task: kept
  });
  const out = prune(db, t);
  const n = (sql) => db.prepare(sql).get().c;
  assert.equal(n('SELECT COUNT(*) AS c FROM event_log'), 5000);
  assert.equal(n("SELECT COUNT(*) AS c FROM decision_log WHERE status='pending'"), 1);
  assert.equal(n("SELECT COUNT(*) AS c FROM decision_log WHERE status='sent'"), 1);
  assert.equal(n('SELECT COUNT(*) AS c FROM pane'), 1);
  assert.equal(n("SELECT COUNT(*) AS c FROM repo WHERE id='r-old'"), 0, 'unreferenced gone repo pruned');
  assert.equal(n("SELECT COUNT(*) AS c FROM repo WHERE id='r-bug'"), 1, 'repo with a bug is kept');
  assert.equal(n('SELECT COUNT(*) AS c FROM alert_sent'), 1);
  assert.equal(n('SELECT COUNT(*) AS c FROM plan_version'), 10);
  assert.equal(n('SELECT COUNT(*) AS c FROM plan_version WHERE version=14'), 1, 'current version always kept');
  assert.equal(n("SELECT COUNT(*) AS c FROM check_result WHERE orca_task_id='task_a'"), 20);
  assert.equal(n("SELECT COUNT(*) AS c FROM check_result WHERE orca_task_id='task_b'"), 1);
  assert.equal(n('SELECT COUNT(*) AS c FROM bug'), 1);
  assert.equal(n('SELECT COUNT(*) AS c FROM todo'), 1);
  assert.equal(n('SELECT COUNT(*) AS c FROM plan'), 1);
  assert.equal(out.event_log, 100);
  db.close();
});
