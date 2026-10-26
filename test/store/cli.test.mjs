import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tmpDataDir } from './helpers.mjs';

const BIN = new URL('../../bin/mk.mjs', import.meta.url).pathname;
const STUB = new URL('./fixtures/orca-stub.mjs', import.meta.url).pathname;

/** A sandbox: fresh data dir, a PATH dir whose `orca` is the stub, and a log of the stub's argv. */
function sandbox() {
  const dir = tmpDataDir('cli');
  const bindir = mkdtempSync(join(tmpdir(), 'mk-stubbin-'));
  const orca = join(bindir, 'orca');
  writeFileSync(orca, `#!${process.execPath}\nimport ${JSON.stringify(STUB)};\n`);
  chmodSync(orca, 0o755);
  const log = join(bindir, 'calls.jsonl');
  writeFileSync(log, '');
  const mk = (args, { cwd, env } = {}) => {
    const r = spawnSync(process.execPath, [BIN, ...args], {
      cwd: cwd ?? dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bindir}:${process.env.PATH}`, MK_DATA_DIR: dir, MK_STUB_LOG: log, ...env },
    });
    let json;
    try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
  };
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const db = () => new DatabaseSync(join(dir, 'mk-data.db'));
  const query = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p).map((r) => ({ ...r })); } finally { d.close(); } };
  return { dir, mk, calls, query, db };
}

const add = (s, title, repo = 'repo-1', extra = []) =>
  s.mk(['bug', 'add', '--title', title, '--details', `details of ${title}`, '--repo', repo, ...extra]);

test('mk bug add prints the new bug as JSON, ids are global across repos', () => {
  const s = sandbox();
  const a = add(s, 'first', 'repo-1', ['--file', 'src/a.ts', '--line', '42', '--risk', '4']);
  assert.equal(a.code, 0);
  assert.equal(a.stderr, '', 'no warning noise on stderr');
  assert.deepEqual(
    { id: a.json.id, repo: a.json.repo_id, title: a.json.title, file: a.json.file, line: a.json.line, risk: a.json.risk, status: a.json.status, attempts: a.json.attempts, past: a.json.past_task_ids },
    { id: 'B-1', repo: 'repo-1', title: 'first', file: 'src/a.ts', line: 42, risk: 4, status: 'open', attempts: 0, past: [] },
  );
  const b = add(s, 'second', 'repo-2');
  assert.equal(b.json.id, 'B-2');
  assert.equal(b.json.risk, 3, 'risk defaults to 3');
  assert.equal(b.json.details, 'details of second');
  assert.equal(s.query('SELECT COUNT(*) AS c FROM bug')[0].c, 2);
  const list = s.mk(['bug', 'list', '--repo', 'repo-2']);
  assert.deepEqual(list.json.map((x) => x.id), ['B-2']);
});

test('bad input fails with a one-line error and a non-zero exit, and changes nothing', () => {
  const s = sandbox();
  for (const args of [
    ['bug', 'add', '--details', 'x', '--repo', 'r'],
    ['bug', 'add', '--title', 't', '--risk', '9', '--repo', 'r'],
    ['bug', 'add', '--title', 't', '--line', 'abc', '--repo', 'r'],
    ['bug', 'fix', 'B-77'],
    ['bug', 'close'],
    ['nonsense'],
  ]) {
    const r = s.mk(args);
    assert.notEqual(r.code, 0, args.join(' '));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^mk: [^\n]+\n$/, `one line: ${args.join(' ')}`);
  }
  assert.equal(s.query('SELECT COUNT(*) AS c FROM bug')[0].c, 0);
});

test('mk bug fix creates the repo bug run once, then the task with --retry-request and an mk-ref spec', () => {
  const s = sandbox();
  add(s, 'login crashes', 'repo-1', ['--file', 'src/login.ts', '--line', '9', '--risk', '5']);
  add(s, 'second bug', 'repo-1');
  const f = s.mk(['bug', 'fix', 'B-1']);
  assert.equal(f.code, 0, f.stderr);

  const [runCreate, taskCreate] = s.calls();
  assert.deepEqual(runCreate.slice(0, 2), ['orchestration', 'run-create']);
  assert.equal(runCreate[runCreate.indexOf('--retry-request') + 1], 'mk-run-bug-repo-1');
  assert.ok(runCreate.includes('--json'));
  assert.deepEqual(taskCreate.slice(0, 2), ['orchestration', 'task-create']);
  const arg = (n) => taskCreate[taskCreate.indexOf(`--${n}`) + 1];
  assert.equal(arg('retry-request'), 'mk-bug-B-1-1');
  assert.equal(arg('task-title'), 'B-1 login crashes');
  assert.equal(arg('run'), f.json.orca_run_id);
  assert.ok(taskCreate.includes('--json'));
  const spec = arg('spec').split('\n');
  assert.equal(spec[0], 'mk-ref: bug:B-1#1', 'spec starts with the mk-ref line');
  assert.match(arg('spec'), /Fix bug B-1: login crashes/);
  assert.match(arg('spec'), /Risk: 5\/5/);
  assert.match(arg('spec'), /Where: src\/login\.ts:9/);
  assert.match(arg('spec'), /details of login crashes/);

  assert.match(f.json.orca_task_id, /^task_[0-9a-f]{12}$/);
  assert.match(f.json.orca_run_id, /^run_[0-9a-f]{12}$/);
  assert.equal(f.json.attempts, 1);
  assert.equal(f.json.status, 'fixing');
  assert.deepEqual(f.json.past_task_ids, []);
  assert.equal(s.query("SELECT bug_run_id FROM repo WHERE id='repo-1'")[0].bug_run_id, f.json.orca_run_id);

  // A second bug in the same repo reuses the run: no run-create this time.
  const g = s.mk(['bug', 'fix', 'B-2']);
  assert.equal(g.code, 0, g.stderr);
  const rest = s.calls().slice(2);
  assert.deepEqual(rest.map((c) => c[1]), ['task-create']);
  assert.equal(g.json.orca_run_id, f.json.orca_run_id);
  assert.equal(s.calls().filter((c) => c[1] === 'run-create').length, 1);
});

test('a second fix moves the old task id into past_task_ids and bumps attempts', () => {
  const s = sandbox();
  add(s, 'flaky');
  const one = s.mk(['bug', 'fix', 'B-1']).json;
  const two = s.mk(['bug', 'fix', 'B-1']);
  assert.equal(two.code, 0, two.stderr);
  assert.equal(two.json.attempts, 2);
  assert.notEqual(two.json.orca_task_id, one.orca_task_id);
  assert.deepEqual(two.json.past_task_ids, [one.orca_task_id]);
  const taskCalls = s.calls().filter((c) => c[1] === 'task-create');
  assert.equal(taskCalls[1][taskCalls[1].indexOf('--retry-request') + 1], 'mk-bug-B-1-2');
  assert.equal(taskCalls[1][taskCalls[1].indexOf('--spec') + 1].split('\n')[0], 'mk-ref: bug:B-1#2');
  const three = s.mk(['bug', 'fix', 'B-1']).json;
  assert.deepEqual(three.past_task_ids, [one.orca_task_id, two.json.orca_task_id]);
  assert.equal(three.attempts, 3);
  assert.equal(s.query('SELECT json_array_length(past_task_ids) AS n FROM bug')[0].n, 2);
});

test('replaying a fix after a crash between the Orca call and the row update keeps one task (no duplicate)', () => {
  const s = sandbox();
  add(s, 'crashy');
  const first = s.mk(['bug', 'fix', 'B-1']).json;
  // Simulate the crash: Orca has the task, the row never learned of it.
  const d = s.db();
  d.prepare("UPDATE bug SET orca_task_id=NULL, orca_run_id=NULL, attempts=0, status='open', past_task_ids='[]' WHERE id='B-1'").run();
  d.close();
  const again = s.mk(['bug', 'fix', 'B-1']);
  assert.equal(again.code, 0, again.stderr);
  const reqs = s.calls().filter((c) => c[1] === 'task-create').map((c) => c[c.indexOf('--retry-request') + 1]);
  assert.deepEqual(reqs, ['mk-bug-B-1-1', 'mk-bug-B-1-1'], 'same request id both times');
  assert.equal(again.json.orca_task_id, first.orca_task_id, 'same Orca task');
  assert.equal(again.json.attempts, 1);
  assert.deepEqual(again.json.past_task_ids, []);
});

test('an Orca failure leaves the bug row untouched and exits non-zero with one line', () => {
  const s = sandbox();
  add(s, 'doomed');
  const r = s.mk(['bug', 'fix', 'B-1'], { env: { MK_STUB_FAIL_TASK_CREATE: '1' } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^mk: orca orchestration task-create failed: stub: orca runtime is not running\n$/);
  const b = s.query("SELECT status, attempts, orca_task_id, past_task_ids FROM bug WHERE id='B-1'")[0];
  assert.deepEqual(b, { status: 'open', attempts: 0, orca_task_id: null, past_task_ids: '[]' });
});

test('close sets wontfix; fix on a closed or fixed bug is refused; reopen brings it back', () => {
  const s = sandbox();
  add(s, 'x');
  assert.equal(s.mk(['bug', 'close', 'B-1']).json.status, 'wontfix');
  const refuse = s.mk(['bug', 'fix', 'B-1']);
  assert.equal(refuse.code, 1);
  assert.match(refuse.stderr, /wontfix/);
  assert.equal(s.calls().length, 0, 'no Orca call for a refused fix');
  assert.equal(s.mk(['bug', 'close', 'B-1']).code, 1, 'closing twice is an error');
  assert.equal(s.mk(['bug', 'reopen', 'B-1']).json.status, 'open');
});

test('mk todo add, done and list', () => {
  const s = sandbox();
  const a = s.mk(['todo', 'add', 'write the docs', '--repo', 'repo-1']);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(a.json.text, 'write the docs');
  assert.equal(a.json.grp, 'today');
  assert.equal(a.json.done, 0);
  const b = s.mk(['todo', 'add', 'later thing', '--group', 'later', '--repo', 'repo-1']);
  assert.equal(b.json.grp, 'later');
  assert.equal(s.mk(['todo', 'add', 'x', '--group', 'never', '--repo', 'repo-1']).code, 2);
  const d = s.mk(['todo', 'done', String(a.json.id)]);
  assert.equal(d.json.done, 1);
  assert.ok(d.json.done_at > 0);
  assert.deepEqual(s.mk(['todo', 'list', '--repo', 'repo-1']).json.map((t) => t.text), ['later thing']);
  assert.deepEqual(s.mk(['todo', 'list', '--repo', 'repo-1', '--all']).json.map((t) => t.text).sort(), ['later thing', 'write the docs']);
  assert.equal(s.mk(['todo', 'done', '999']).code, 1);
});

function seedPlan(s, slug) {
  const d = s.db();
  const t = Date.now();
  const plan = d.prepare("INSERT INTO plan(slug, repo_id, title, status, created_at, updated_at) VALUES(?,?,?,?,?,?) RETURNING id").get(slug, 'r', 'T', 'imported', t, t).id;
  const ph = d.prepare('INSERT INTO plan_phase(plan_id, code, ord, title) VALUES(?,?,?,?) RETURNING id').get(plan, 'P', 1, 'P').id;
  const task = d.prepare('INSERT INTO plan_task(plan_id, phase_id, code, ord, title, created_at, updated_at) VALUES(?,?,?,?,?,?,?) RETURNING id').get(plan, ph, 'P.1', 1, 'x', t, t).id;
  d.prepare("INSERT INTO plan_subtask(plan_id, task_id, code, ord, title) VALUES(?,?,'P.1.1',1,'sub')").run(plan, task);
  d.close();
}

test('mk subtask set changes status and note; ambiguous codes need --plan', () => {
  const s = sandbox();
  s.mk(['bug', 'add', '--title', 'x', '--repo', 'r']); // opens the db
  seedPlan(s, 'plan-a');
  const r = s.mk(['subtask', 'set', 'P.1.1', 'working', '--note', 'now']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.status, 'working');
  assert.equal(r.json.note, 'now');
  assert.equal(s.mk(['subtask', 'set', 'P.1.1', 'done']).json.note, 'now', 'note kept when --note is not given');
  assert.equal(s.mk(['subtask', 'set', 'P.1.1', 'bogus']).code, 2);
  assert.equal(s.mk(['subtask', 'set', 'NOPE.1', 'done']).code, 1);
  seedPlan(s, 'plan-b');
  const amb = s.mk(['subtask', 'set', 'P.1.1', 'done']);
  assert.equal(amb.code, 2);
  assert.match(amb.stderr, /plan-a, plan-b|plan-b, plan-a/);
  assert.equal(s.mk(['subtask', 'set', 'P.1.1', 'blocked', '--plan', 'plan-b']).json.status, 'blocked');
});

test('mk ask note sets the recommendation (and only for an existing ask)', () => {
  const s = sandbox();
  s.mk(['bug', 'add', '--title', 'x', '--repo', 'r']);
  const d = s.db();
  d.prepare("INSERT INTO ask(id, kind, run_id, title, orca_status, asked_at, first_seen_at, last_seen_at) VALUES('gate_1','gate','run_1','Approve?','pending',1,1,1)").run();
  d.close();
  const r = s.mk(['ask', 'note', 'gate_1', '--text', 'Jev: approve, tests pass']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.recommendation, 'Jev: approve, tests pass');
  assert.equal(s.query("SELECT recommendation FROM ask WHERE id='gate_1'")[0].recommendation, 'Jev: approve, tests pass');
  assert.equal(s.mk(['ask', 'note', 'nope', '--text', 'x']).code, 1);
  assert.equal(s.mk(['ask', 'note', 'gate_1']).code, 2);
});

test('the repo is found from the working directory: mk-data.db first, then orca repo list', () => {
  const s = sandbox();
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'mk-gitrepo-')));
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  // 1. unknown to the db and to orca: a clear error
  const none = s.mk(['bug', 'add', '--title', 't'], { cwd: repo });
  assert.equal(none.code, 2);
  assert.match(none.stderr, /pass --repo/);
  // 2. orca knows it
  const viaOrca = s.mk(['bug', 'add', '--title', 't'], { cwd: repo, env: { MK_STUB_REPO_PATH: repo } });
  assert.equal(viaOrca.code, 0, viaOrca.stderr);
  assert.equal(viaOrca.json.repo_id, 'repo-from-orca');
  assert.equal(s.query("SELECT path FROM repo WHERE id='repo-from-orca'")[0].path, repo);
  // 3. now the db knows it: no orca call needed
  const before = s.calls().length;
  const cached = s.mk(['bug', 'add', '--title', 'again'], { cwd: repo });
  assert.equal(cached.json.repo_id, 'repo-from-orca');
  assert.equal(s.calls().length, before);
  // MK_REPO env also works
  assert.equal(s.mk(['bug', 'add', '--title', 'env'], { env: { MK_REPO: 'repo-9' } }).json.repo_id, 'repo-9');
});

test('USE.5: mk bug fix renders the fix template; a bad user template falls back with warnings[] in the JSON and on stderr', () => {
  const s = sandbox();
  writeFileSync(join(s.dir, 'mk-settings.json'), JSON.stringify({ schema: 2, work: { specTemplates: { fix: 'nope/missing.md' } } }));
  add(s, 'login crashes', 'repo-1', ['--file', 'src/login.ts', '--line', '9']);
  const f = s.mk(['bug', 'fix', 'B-1']);
  assert.equal(f.code, 0, f.stderr);
  assert.equal(f.json.warnings.length, 1);
  assert.match(f.json.warnings[0], /spec template for fix \(nope\/missing\.md\) not used: .*using the built-in template/);
  assert.match(f.stderr, /^warning: spec template for fix/m);
  const spec = (() => { const c = s.calls()[1]; return c[c.indexOf('--spec') + 1]; })();
  assert.equal(spec.split('\n')[0], 'mk-ref: bug:B-1#1');
  assert.match(spec, /Fix bug B-1: login crashes/);
  assert.match(spec, /Reproduce the problem first/, 'the fix scenario text is in the built-in');
  assert.ok(!spec.includes('{{'), 'no placeholder left behind');

  // a clean run has no warnings key at all
  const s2 = sandbox();
  add(s2, 'x', 'repo-1');
  assert.ok(!('warnings' in s2.mk(['bug', 'fix', 'B-1']).json));
});
