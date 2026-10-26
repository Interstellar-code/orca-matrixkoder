/**
 * T6: confirm before high-risk tasks (C7), advisory rules in the brief (C7) and solo mode (C8).
 * Orca is a stub that records argv.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSettings } from '../../out/store/settings.js';
import { fakeClock, startTestService, stubRunner } from './helpers.mjs';

const REAL_PLAN = new URL('../../.matrixkoder/inbox/orca-dashboard-wiring.md', import.meta.url).pathname;
const NAME = 'orca-dashboard-wiring.md';
const SLUG = 'orca-dashboard-wiring';
const flagsOf = (argv) => Object.fromEntries(argv.slice(2).filter((t) => t.startsWith('--') && t !== '--json').map((t) => { const i = t.indexOf('='); return i < 0 ? [t.slice(2), true] : [t.slice(2, i), t.slice(i + 1)]; }));

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
  const repoPath = mkdtempSync(join(tmpdir(), 'mk-safety-repo-'));
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
    svc, task, set, runner, repoPath,
    risk: (n) => set('UPDATE plan_task SET risk = ? WHERE id = ?', n, task.id),
    start: (args = {}) => svc.action('task.start', { taskId: task.id, ...args }),
    starts: () => runner.calls.filter((c) => c[0] === 'orchestration' && c[1] === 'worker-start'),
    spec: () => flagsOf(runner.calls.filter((c) => c[0] === 'orchestration' && c[1] === 'task-create').at(-1)).spec,
  };
  runner.calls.length = 0;
  return w;
}

test('C7: needs_confirm at and above the threshold; confirm: true passes', async (t) => {
  const w = await world(t);
  saveSettings({ safety: { confirmRiskAtLeast: 4 } }, w.svc.dir);
  w.risk(3);
  assert.equal((await w.start()).ok, true, 'below the threshold starts without confirm');

  for (const risk of [4, 5]) {
    const w2 = await world(t);
    saveSettings({ safety: { confirmRiskAtLeast: 4 } }, w2.svc.dir);
    w2.risk(risk);
    const r = await w2.start();
    assert.equal(r.ok, false, `risk ${risk}`);
    assert.equal(r.error.kind, 'conflict');
    assert.equal(r.error.code, 'needs_confirm');
    assert.match(r.error.message, /Settings > Safety/);
    assert.equal(w2.starts().length, 0, 'nothing was started');
    assert.equal(w2.runner.calls.filter((c) => c[1] === 'task-create').length, 0, 'no Orca task was made either');
    assert.equal((await w2.start({ confirm: 'yes' })).ok, false, 'only boolean true confirms');
    const again = await w2.start({ confirm: true });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(w2.starts().length, 1);
  }
});

test('C7: threshold 6 never asks, even at the highest risk', async (t) => {
  const w = await world(t);
  saveSettings({ safety: { confirmRiskAtLeast: 6 } }, w.svc.dir);
  w.risk(5);
  const r = await w.start();
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('C7: the brief carries the advisory rules from the configured values', async (t) => {
  const w = await world(t);
  saveSettings({ safety: { protectedBranches: ['main', 'prod/*'], neverRun: ['rm -rf /', 'git push --force'], askBeforePush: true, confirmRiskAtLeast: 6 } }, w.svc.dir);
  assert.equal((await w.start()).ok, true);
  const spec = w.spec();
  assert.match(spec, /Rules from MatrixKoder settings/);
  assert.match(spec, /never commit or merge to them\): main, prod\/\*/);
  assert.match(spec, /rm -rf \//);
  assert.match(spec, /git push --force/);
  assert.match(spec, /Ask before any push/);
  assert.doesNotMatch(spec, /Solo mode/);
  assert.match(spec.split('\n')[0], /^mk-ref: /, 'mk-ref stays the first line');

  const w2 = await world(t);
  saveSettings({ safety: { protectedBranches: [], neverRun: [], askBeforePush: false, confirmRiskAtLeast: 6 } }, w2.svc.dir);
  assert.equal((await w2.start()).ok, true);
  assert.doesNotMatch(w2.spec(), /Rules from MatrixKoder settings/, 'no rules, no section');
});

test('C8: orchestrator mode uses new-child; solo mode uses the repo path and the brief has the solo line', async (t) => {
  const w = await world(t);
  saveSettings({ safety: { confirmRiskAtLeast: 6 } }, w.svc.dir);
  assert.equal((await w.start()).ok, true);
  assert.equal(flagsOf(w.starts()[0]).worktree, 'new-child');
  assert.doesNotMatch(w.spec(), /Solo mode/);

  const s = await world(t);
  saveSettings({ general: { mode: 'solo' }, safety: { confirmRiskAtLeast: 6 } }, s.svc.dir);
  const r = await s.start();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(flagsOf(s.starts()[0]).worktree, `path:${s.repoPath}`);
  assert.match(s.spec(), /Solo mode: work in this checkout; use in-session subagents for parallel parts, not Orca lanes or worktrees/);
});
