/**
 * T4: routing by size and quota floors (contract C5), the C9 route check at task.start, and one task.start call
 * through Actions proving it uses the resolver. Orca is a stub that records argv.
 */
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRoute, checkQuota } from '../../out/server/routes.js';
import { orcaAgentId, providerOf } from '../../out/server/providers.js';
import { checkRoute } from '../../out/store/routes-check.js';
import { defaultSettings, mergeSettings, saveSettings } from '../../out/store/settings.js';
import { fakeClock, startTestService, stubRunner } from './helpers.mjs';

const REAL_PLAN = new URL('../../.matrixkoder/inbox/orca-dashboard-wiring.md', import.meta.url).pathname;
const NAME = 'orca-dashboard-wiring.md';
const SLUG = 'orca-dashboard-wiring';

const resolve = (input, patch = {}) => resolveRoute(mergeSettings(defaultSettings(), patch), { args: {}, ...input });
const routeOf = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return { ...r.route, source: r.source }; };
const flagsOf = (argv) => Object.fromEntries(argv.slice(2).filter((t) => t.startsWith('--') && t !== '--json').map((t) => { const i = t.indexOf('='); return i < 0 ? [t.slice(2), true] : [t.slice(2, i), t.slice(i + 1)]; }));

// ------------------------------------------------------------------------------------------------ resolver

test('C5 routing table: args, task, phase, size, then the standard fallback', () => {
  const sizes = { trivial: 'claude haiku low', standard: 'claude sonnet medium', complex: 'claude opus high' };
  assert.deepEqual(routeOf(resolve({ args: { agent: 'codex', model: 'gpt-6-astra', effort: 'high' }, task: 'claude haiku low', phase: 'claude opus high', size: 'trivial' })),
    { agent: 'codex', model: 'gpt-6-astra', effort: 'high', source: 'args' });
  assert.deepEqual(routeOf(resolve({ task: 'codex gpt-6-luna max', phase: 'claude opus high', size: 'trivial' })), { agent: 'codex', model: 'gpt-6-luna', effort: 'max', source: 'task' });
  assert.deepEqual(routeOf(resolve({ task: '  ', phase: 'claude opus max', size: 'trivial' })), { agent: 'claude', model: 'opus', effort: 'max', source: 'phase' });
  for (const [size, text] of Object.entries(sizes)) {
    const [agent, model, effort] = text.split(' ');
    assert.deepEqual(routeOf(resolve({ task: '', phase: '', size })), { agent, model, effort, source: 'size' }, size);
  }
  assert.deepEqual(routeOf(resolve({ task: '', phase: '', size: null })), { agent: 'claude', model: 'sonnet', effort: 'medium', source: 'standard' });
  assert.equal(routeOf(resolve({ size: 'huge' })).source, 'standard', 'an unknown size falls back');
  // a size route follows the saved setting
  assert.deepEqual(routeOf(resolve({ size: 'trivial' }, { routing: { bySize: { trivial: 'codex gpt-6-luna low' } } })), { agent: 'codex', model: 'gpt-6-luna', effort: 'low', source: 'size' });
});

test('C5: the route is taken whole; sources are never mixed field by field', () => {
  // args name only an agent: the task route's model and effort are NOT borrowed
  const r = routeOf(resolve({ args: { agent: 'codex' }, task: 'claude opus max' }));
  assert.deepEqual([r.agent, r.model, r.effort], ['codex', '', '']);
  // a task route with only an agent does not take the phase's model
  const t = routeOf(resolve({ task: 'claude', phase: 'claude opus max' }));
  assert.deepEqual([t.agent, t.model, t.effort, t.source], ['claude', '', '', 'task']);
  const bad = resolve({ args: { model: 'opus' }, task: 'claude' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.kind, 'bad_args');
});

test('C5: missing model and effort come from agents.<id>; empty stays empty', () => {
  const patch = { agents: { claude: { model: 'opus', effort: 'max' }, codex: { model: '', effort: '' } } };
  assert.deepEqual(routeOf(resolve({ task: 'claude' }, patch)), { agent: 'claude', model: 'opus', effort: 'max', source: 'task' });
  assert.deepEqual(routeOf(resolve({ task: 'claude haiku' }, patch)), { agent: 'claude', model: 'haiku', effort: 'max', source: 'task' });
  assert.deepEqual(routeOf(resolve({ task: 'codex' }, patch)), { agent: 'codex', model: '', effort: '', source: 'task' });
  assert.deepEqual(routeOf(resolve({ args: { agent: 'claude' } }, patch)), { agent: 'claude', model: 'opus', effort: 'max', source: 'args' });
});

test('C5: an agent that is not routable is refused naming the setting; C9 runs first', () => {
  const off = resolve({ task: 'codex gpt-6-astra high' }, { agents: { codex: { routable: false } } });
  assert.equal(off.ok, false);
  assert.equal(off.error.kind, 'bad_args');
  assert.equal(off.error.code, 'not_routable');
  assert.match(off.error.message, /agents\.codex\.routable/);
  // a route that is both unroutable and bad reports the C9 problem (bad_route is earlier in the order)
  const both = resolve({ task: 'codex nope' }, { agents: { codex: { routable: false } } });
  assert.equal(both.error.code, 'bad_route');
});

test('C9 checkRoute cases', () => {
  const s = defaultSettings();
  const issue = (route) => { const r = checkRoute(route, s); assert.equal(r.ok, false, route); return r.issue; };
  assert.match(issue('nobody'), /unknown agent/);
  assert.match(issue('__proto__'), /unknown agent/);
  assert.match(issue('claude gpt-9'), /model/);
  assert.match(issue('claude haiku ultra'), /effort/);
  assert.match(issue({ agent: 'claude', model: '', effort: 'high' }), /--effort requires --model/);
  assert.match(issue('omp m high'), /does not support an effort/);
  assert.match(issue('opencode m high'), /does not support an effort/);
  assert.match(issue('agy gemini-3.1-pro-high high'), /takes no effort/);
  assert.deepEqual(checkRoute('opencode any-model-at-all', s), { ok: true }, 'an empty models list accepts any model');
  assert.deepEqual(checkRoute('', s), { ok: true }, 'empty route text is ok');
  assert.deepEqual(checkRoute('claude opus high', s), { ok: true });
});

test('providers: one agent to provider map and the Orca --agent ids', () => {
  assert.deepEqual(['claude', 'codex', 'agy', 'opencode', 'gemini', 'omp', 'nope'].map(providerOf), ['claude', 'codex', 'antigravity', 'opencodeGo', 'gemini', null, null]);
  assert.deepEqual(['agy', 'claude', 'codex', 'opencode', 'omp'].map(orcaAgentId), ['antigravity', 'claude', 'codex', 'opencode', 'omp']);
  assert.equal(providerOf('__proto__'), null);
});

// ------------------------------------------------------------------------------------------------ through Actions

async function world(t) {
  const clock = fakeClock();
  let taskN = 0;
  const ok = (result = {}) => ({ ok: true, result });
  const runner = stubRunner({
    'orchestration run-create': () => ok({ run: { id: 'run_plan1' } }),
    'orchestration task-create': () => ok({ task: { id: `task_orca${++taskN}` } }),
    'orchestration worker-start': () => ok({ dispatch: { id: 'dsp_1' } }),
    'terminal send': () => ok({ send: { handle: 'term_coord' } }),
  });
  const svc = await startTestService({ runner, clock });
  t.after(() => svc.close());
  const repoPath = mkdtempSync(join(tmpdir(), 'mk-routes-repo-'));
  mkdirSync(join(repoPath, '.matrixkoder', 'inbox'), { recursive: true });
  copyFileSync(REAL_PLAN, join(repoPath, '.matrixkoder', 'inbox', NAME));
  const at = clock.now();
  svc.ctx.db.prepare('INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at) VALUES(?,?,?,?,?)').run('repo-1', repoPath, 'r', at, at);
  assert.equal((await svc.action('inbox.import', { repoId: 'repo-1', name: NAME })).ok, true);
  const plan = svc.ctx.db.prepare('SELECT * FROM plan WHERE slug = ?').get(SLUG);
  assert.equal((await svc.action('plan.start', { planId: plan.id })).ok, true);
  const task = { ...svc.ctx.db.prepare("SELECT * FROM plan_task WHERE plan_id = ? AND status = 'ready' AND dropped_at IS NULL ORDER BY id").get(plan.id) };
  const set = (sql, ...p) => svc.ctx.db.prepare(sql).run(...p);
  set("UPDATE plan_task SET route = '' WHERE id = ?", task.id);
  set("UPDATE plan_phase SET route = '' WHERE id = ?", task.phase_id);
  const w = {
    svc, task, set, runner, clock,
    route: (text) => set('UPDATE plan_task SET route = ? WHERE id = ?', text, task.id),
    start: (args = {}) => svc.action('task.start', { taskId: task.id, ...args }),
    quota: (provider, win, used) =>
      set('INSERT OR REPLACE INTO quota(provider, win, used_percent, updated_at) VALUES(?,?,?,?)', provider, win, used, clock.now()),
    starts: () => runner.calls.filter((c) => c[0] === 'orchestration' && c[1] === 'worker-start'),
    reset: () => { runner.calls.length = 0; },
  };
  w.reset();
  return w;
}

test('task.start uses the resolver: the stubbed runner sees the resolved agent, model and effort', async (t) => {
  const w = await world(t);
  saveSettings({ agents: { codex: { model: 'gpt-6-luna', effort: 'high' } } }, w.svc.dir);
  w.route('codex'); // model and effort come from agents.codex
  const r = await w.start();
  assert.equal(r.ok, true, JSON.stringify(r));
  const f = flagsOf(w.starts()[0]);
  assert.deepEqual([f.agent, f.model, f.effort], ['codex', 'gpt-6-luna', 'high']);
  // with no task or phase route, the task's size picks the saved size route
  w.route('');
  w.set('UPDATE plan_task SET size = ? WHERE id = ?', 'trivial', w.task.id);
  saveSettings({ routing: { bySize: { trivial: 'codex gpt-6-astra low' } } }, w.svc.dir);
  w.reset();
  assert.equal((await w.start()).ok, true);
  const g = flagsOf(w.starts()[0]);
  assert.deepEqual([g.agent, g.model, g.effort], ['codex', 'gpt-6-astra', 'low']);
});

test('task.start passes Orca the mapped --agent id (agy is antigravity)', async (t) => {
  const w = await world(t);
  w.route('agy gemini-3.1-pro-high');
  const r = await w.start();
  assert.equal(r.ok, true, JSON.stringify(r));
  const f = flagsOf(w.starts()[0]);
  assert.equal(f.agent, 'antigravity');
  assert.equal(f.model, 'gemini-3.1-pro-high');
  assert.equal(f.effort, undefined);
});

test('task.start refuses bad_route after filling from agents.<id>, naming the setting, before any Orca call', async (t) => {
  const w = await world(t);
  // settings may change after import, so task.start checks the filled route again
  saveSettings({ agents: { claude: { model: 'opus', effort: 'max' } } }, w.svc.dir);
  w.route('claude haiku');
  assert.equal((await w.start()).ok, true, 'haiku takes max');
  // now the saved model list loses haiku: the same route is bad
  saveSettings({ agents: { claude: { models: [{ id: 'opus', efforts: ['low', 'max'], note: '' }], model: 'opus', effort: 'max' } } }, w.svc.dir);
  w.reset();
  const r = await w.start();
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'bad_args');
  assert.equal(r.error.code, 'bad_route');
  assert.match(r.error.message, /Settings > Routing/);
  assert.match(r.error.message, /haiku/);
  assert.equal(w.runner.calls.length, 0);
  // an effort filled from agents.<id> that the route's own model cannot take (hand-built settings: a save would refuse them)
  const filled = resolveRoute(mergeSettings(defaultSettings(), { agents: { agy: { effort: 'high' } } }), { args: {}, task: 'agy gemini-3.1-pro-high' });
  assert.equal(filled.ok, false);
  assert.equal(filled.error.code, 'bad_route');
  assert.match(filled.error.message, /takes no effort/);
});

test('C5 order: a high-risk task with a bad route gets bad_route (the C7 confirm comes last)', async (t) => {
  const w = await world(t);
  w.set('UPDATE plan_task SET risk = 5, route = ? WHERE id = ?', 'nobody x', w.task.id);
  const r = await w.start();
  assert.equal(r.error.code, 'bad_route');
  assert.notEqual(r.error.code, 'needs_confirm');
  assert.equal(w.runner.calls.length, 0);
  // an unroutable agent is refused before the lane limit and the quota
  w.route('codex gpt-6-astra high');
  saveSettings({ agents: { codex: { routable: false } } }, w.svc.dir);
  const off = await w.start();
  assert.equal(off.error.code, 'not_routable');
  assert.match(off.error.message, /agents\.codex\.routable/);
});

test('quota floors: block refuses, warn adds warnings, off skips, a null window or unknown provider only warns', async (t) => {
  const w = await world(t);
  w.route('claude sonnet medium');
  w.quota('claude', 'session', 70); // 30% left, floor 40
  w.quota('claude', 'weekly', 10); // 90% left, floor 30

  const blocked = await w.start();
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.kind, 'conflict');
  assert.equal(blocked.error.code, 'quota_floor');
  assert.match(blocked.error.message, /quota\.floor\.claude\.sessionPct/);
  assert.equal(w.runner.calls.length, 0, 'refused before Orca');

  saveSettings({ quota: { onBelowFloor: 'warn' } }, w.svc.dir);
  const warned = await w.start();
  assert.equal(warned.ok, true, JSON.stringify(warned));
  assert.equal(warned.warnings.length, 1);
  assert.match(warned.warnings[0], /session quota is at 30% left, below the 40% floor/);

  saveSettings({ quota: { onBelowFloor: 'off' } }, w.svc.dir);
  const off = await w.start();
  assert.equal(off.ok, true);
  assert.equal(off.warnings, undefined);

  // exactly at the floor is not below it; a floor change applies at once
  saveSettings({ quota: { onBelowFloor: 'block', floor: { claude: { sessionPct: 30 } } } }, w.svc.dir);
  assert.equal((await w.start()).ok, true);

  // a null window skips the check and says so
  w.quota('claude', 'session', null);
  const nul = await w.start();
  assert.equal(nul.ok, true);
  assert.ok(nul.warnings.some((x) => /no session reading for claude/.test(x)), JSON.stringify(nul.warnings));

  // other agents use the "others" floors (10 / 15)
  w.route('codex gpt-6-astra high');
  w.quota('codex', 'session', 95); // 5% left < 10
  w.quota('codex', 'weekly', 50);
  const codex = await w.start();
  assert.equal(codex.error.code, 'quota_floor');
  assert.match(codex.error.message, /quota\.floor\.others\.sessionPct/);

  // no provider (omp): no check, one warning
  w.route('omp');
  const omp = await w.start();
  assert.equal(omp.ok, true, JSON.stringify(omp));
  assert.deepEqual(omp.warnings, ['quota not checked: Orca reports no quota for omp']);
});

test('checkQuota is pure over the quota rows', async (t) => {
  const w = await world(t);
  const s = defaultSettings();
  assert.deepEqual(checkQuota(w.svc.ctx.db, mergeSettings(s, { quota: { onBelowFloor: 'off' } }), 'claude'), { refuse: null, warnings: [] });
  const none = checkQuota(w.svc.ctx.db, s, 'claude');
  assert.equal(none.refuse, null);
  assert.equal(none.warnings.length, 2, 'no rows: both windows are skipped with a warning');
});

test('maxLanes is unchanged: the limit still refuses with max_lanes, before the quota check', async (t) => {
  const w = await world(t);
  w.route('claude sonnet medium');
  w.quota('claude', 'session', 99);
  const at = w.clock.now();
  for (let i = 0; i < 3; i++) {
    w.svc.ctx.db.prepare('INSERT INTO lane(lane_key, kind, repo_id, label, run_id, dispatch_id, state, first_seen_at, last_seen_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(`dsp:d${i}`, 'dispatch', 'repo-1', `L${i}`, 'run_z', `d${i}`, 'working', at, at);
  }
  const r = await w.start();
  assert.equal(r.error.code, 'max_lanes');
});

test('C9: a model or effort starting with "-" or holding whitespace is refused, even for an agent with no model list', () => {
  const s = defaultSettings();
  for (const route of [{ agent: 'opencode', model: '--dangerously' }, { agent: 'omp', model: 'a b' }, { agent: 'claude', model: 'opus', effort: '-x' }]) {
    const r = checkRoute(route, s);
    assert.equal(r.ok, false, JSON.stringify(route));
    assert.match(r.issue, new RegExp(`"${(route.effort ?? route.model).replace(/[-]/g, '\\-')}"`));
  }
  assert.deepEqual(checkRoute({ agent: 'opencode', model: 'glm-5' }, s), { ok: true });
});

test('quota floor compares the unrounded remainder: 60.4 used is 39.6 left, below a 40 floor', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE quota(provider TEXT, win TEXT, used_percent REAL)');
  db.prepare("INSERT INTO quota VALUES('claude','session',60.4)").run();
  db.prepare("INSERT INTO quota VALUES('claude','weekly',0)").run();
  const v = checkQuota(db, mergeSettings(defaultSettings(), { quota: { onBelowFloor: 'block', floor: { claude: { sessionPct: 40 } } } }), 'claude');
  assert.equal(v.refuse?.code, 'quota_floor');
  assert.match(v.refuse.message, /at 40% left, below the 40% floor/, 'the shown number is rounded');
});
