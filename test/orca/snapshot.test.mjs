import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { buildSnapshot } from '../fixtures/build-snapshot.mjs';

const path = new URL('../fixtures/snapshot.json', import.meta.url);
const snap = JSON.parse(readFileSync(path, 'utf8'));

// the C6 keys: screen-data-map.md section 4 / mk-data-schema.md section 5
const C6_KEYS = ['meta', 'badges', 'projects', 'overview', 'lanes', 'plan', 'waiting', 'events', 'inbox', 'bugs', 'todo', 'settings'];

function walk(v, fn, p = '$') {
  fn(v, p);
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, fn, `${p}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, fn, `${p}.${k}`);
}

test('snapshot.json has every C6 key and is under 64 KB', () => {
  for (const k of C6_KEYS) assert.ok(k in snap, `missing key ${k}`);
  assert.deepEqual(Object.keys(snap).sort(), [...C6_KEYS].sort());
  assert.ok(statSync(path).size < 64 * 1024, `snapshot is ${statSync(path).size} bytes`);
});

test('each key has the fields the screens read', () => {
  const has = (o, keys, what) => { for (const k of keys) assert.ok(k in o, `${what} lacks ${k}`); };
  has(snap.meta, ['schema', 'at', 'orca', 'runtimeOk', 'repoId', 'planId', 'runId', 'stale'], 'meta');
  has(snap.meta.stale, ['ps', 'orchestration', 'git', 'quota'], 'meta.stale');
  has(snap.badges, ['lanes', 'waiting', 'inbox', 'bugs'], 'badges');
  has(snap.projects, ['machine', 'active', 'total', 'lanesLive', 'waiting', 'waitingList', 'repos'], 'projects');
  has(snap.projects.repos[0], ['id', 'name', 'path', 'worktrees', 'lastActivityAt', 'plans', 'idleWorktrees'], 'projects.repos[0]');
  has(snap.overview, ['stage', 'stageProgress', 'wave', 'lanesLive', 'tasks', 'needsYou', 'bus', 'decision', 'waves'], 'overview');
  has(snap.lanes[0], ['label', 'dispatchId', 'paneKey', 'worktreeId', 'terminalHandle', 'agent', 'model', 'effort', 'branch', 'head', 'path',
    'state', 'phase', 'turns', 'startedAt', 'task', 'git', 'checks', 'activity', 'askId'], 'lanes[0]');
  has(snap.plan, ['title', 'done', 'total', 'subtasks', 'phases'], 'plan');
  has(snap.plan.phases[0], ['id', 'title', 'status', 'done', 'total', 'tasks'], 'plan.phases[0]');
  has(snap.plan.phases[0].tasks[0], ['id', 'title', 'status', 'meta', 'after', 'subs', 'attempts'], 'plan task');
  has(snap.waiting, ['open', 'resolved'], 'waiting');
  has(snap.waiting.open[0], ['id', 'kind', 'title', 'body', 'rec', 'options', 'lane', 'agent', 'task', 'ageMs'], 'waiting.open[0]');
  has(snap.events, ['cursor', 'rows'], 'events');
  has(snap.events.rows[0], ['id', 'at', 'kind', 'text', 'src', 'payloadRef'], 'events.rows[0]');
  has(snap.inbox, ['dir', 'archived', 'files'], 'inbox');
  has(snap.inbox.files[0], ['name', 'title', 'editedAt', 'check', 'missing', 'state', 'planId'], 'inbox.files[0]');
  has(snap.bugs, ['total', 'needWork', 'rows'], 'bugs');
  has(snap.bugs.rows[0], ['id', 'title', 'where', 'risk', 'status', 'lane'], 'bugs.rows[0]');
  has(snap.todo, ['open', 'done', 'rows'], 'todo');
  has(snap.todo.rows[0], ['id', 'text', 'group', 'done', 'link'], 'todo.rows[0]');
  has(snap.settings, ['values', 'agents', 'baseBranch', 'version'], 'settings');
  has(snap.settings.agents[0], ['id', 'cli', 'found', 'quota'], 'settings.agents[0]');
});

test('it has the edge cases the screens must meet: an empty list, a failed task, a long name', () => {
  let empty = 0;
  walk(snap, (v) => { if (Array.isArray(v) && v.length === 0) empty++; });
  assert.ok(empty >= 1, 'no empty list');
  assert.ok(snap.projects.repos.some((r) => r.plans.length === 0), 'a repo with no plan');

  const tasks = snap.plan.phases.flatMap((p) => p.tasks);
  const failed = tasks.filter((t) => t.status === 'failed');
  assert.ok(failed.length >= 1, 'no failed task');
  assert.ok(failed[0].attempts >= 1, 'a failed task shows its attempts');

  const longest = Math.max(
    ...tasks.map((t) => t.title.length),
    ...snap.bugs.rows.map((b) => b.title.length),
    ...snap.lanes.map((l) => l.branch.length),
  );
  assert.ok(longest >= 100, `longest name is ${longest} characters`);
});

test('its numbers agree with its lists', () => {
  const tasks = snap.plan.phases.flatMap((p) => p.tasks);
  assert.equal(snap.plan.total, tasks.length);
  assert.equal(snap.plan.done, tasks.filter((t) => t.status === 'done').length);
  assert.equal(snap.plan.subtasks, tasks.reduce((n, t) => n + t.subs.length, 0));
  for (const p of snap.plan.phases) assert.equal(p.total, p.tasks.length);
  assert.equal(snap.badges.waiting, snap.waiting.open.length);
  assert.equal(snap.badges.lanes, snap.lanes.filter((l) => l.state !== 'done').length);
  assert.equal(snap.bugs.total, snap.bugs.rows.length);
  assert.equal(snap.bugs.needWork, snap.bugs.rows.filter((b) => ['open', 'fixing', 'waiting'].includes(b.status)).length);
  assert.equal(snap.todo.open + snap.todo.done, snap.todo.rows.length);
  assert.equal(snap.events.cursor, Math.max(...snap.events.rows.map((r) => r.id)));
  assert.ok(snap.lanes.length <= 12 && snap.events.rows.length <= 50);
});

test('it carries no conversation text and no redaction placeholders', () => {
  walk(snap, (v, p) => {
    const key = p.split('.').pop();
    for (const k of ['prompt', 'lastAssistantMessage', 'toolInput', 'preview']) assert.notEqual(key, k, `${p} is a ${k} field`);
    if (typeof v === 'string') assert.ok(!v.includes('[redacted'), `${p} holds a placeholder`);
  });
});

test('it is what the builder makes from the recorded fixtures (not hand-edited)', async () => {
  assert.deepEqual(await buildSnapshot(), snap);
});
