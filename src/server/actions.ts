/**
 * POST /api/action {name, args}: what the dashboard's buttons do (SERVE.2).
 *
 * Rules every action follows:
 *   1. Orca first, then the row. An action that changes Orca calls the adapter's allowlisted `runAction` (through
 *      callOrca, which adds the A6 coordinator-terminal fallback), and only on success updates MK's own columns.
 *      Bug and todo changes go through the mk CLI's own code (`main`), so the dashboard and an agent's `mk bug fix`
 *      do exactly the same thing.
 *   2. Approve, rework and answer wait in decision_log for the Undo window; `undo` cancels one.
 *   3. Every call returns {ok:true,...} or {ok:false,error:{kind,message,...}}. An unknown name is refused.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ActionArgs } from '../orca/index.js';
import { main as cliMain, realOrca } from '../store/cli.js';
import { one, tx, type Row } from '../store/db.js';
import { ImportError, importFile, scanInbox } from '../store/import.js';
import { loadSettings, saveSettings, setting, SettingsError, type Settings } from '../store/settings.js';
import { CANCELLED_RESULT, cut, fail, J, parseJson, type ActionError, type ActionOutcome, type ServerCtx } from './common.js';
import { Decisions } from './decisions.js';
import { callOrca, orcaFailure, receiptId } from './orca-call.js';
import type { Sync } from './sync.js';

export const ACTION_NAMES = [
  'approve', 'rework', 'answer', 'undo', 'ask.snooze',
  'plan.start', 'plan.park', 'plan.resume', 'plan.markMerged',
  'task.start', 'task.retry', 'task.cancel',
  'inbox.import', 'inbox.reimport', 'inbox.archive', 'inbox.restore', 'inbox.delete',
  'bug.add', 'bug.fix', 'bug.close', 'bug.reopen',
  'todo.add', 'todo.done', 'todo.makeTask',
  'settings.save',
] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

type Args = Record<string, unknown>;

/** Thrown inside a handler to return a typed error. */
class Refuse extends Error {
  constructor(public readonly error: ActionError) {
    super(error.message);
  }
}
const refuse = (kind: ActionError['kind'], message: string, extra: Partial<ActionError> = {}): never => {
  throw new Refuse({ kind, message, ...extra });
};

const reqStr = (a: Args, k: string, max = 4000): string => {
  const v = a[k];
  if (typeof v !== 'string' || v.trim() === '' || v.includes('\0')) return refuse('bad_args', `"${k}" is required (text)`);
  if (v.length > max) return refuse('bad_args', `"${k}" is too long (limit ${max})`);
  return v;
};
const optStr = (a: Args, k: string, max = 4000): string | undefined => (a[k] === undefined || a[k] === null || a[k] === '' ? undefined : reqStr(a, k, max));
const reqInt = (a: Args, k: string): number => {
  const v = a[k];
  if (typeof v !== 'number' || !Number.isInteger(v)) return refuse('bad_args', `"${k}" is required (a whole number)`);
  return v;
};
const CLI_CHILD = join(dirname(fileURLToPath(import.meta.url)), 'cli-child.js');
const CLI_CHILD_TIMEOUT_MS = 180_000;
const SETTINGS_PATCH_MAX = 16_000;
const bugId = (a: Args): string => {
  const id = reqStr(a, 'bugId', 20);
  return /^B-\d+$/.test(id) ? id : refuse('bad_args', '"bugId" must look like B-12');
};
const planFile = (name: string): string => {
  if (!/^[^/\\\0]+\.md$/.test(name) || name.startsWith('.')) refuse('bad_args', 'a plan file name like "my-plan.md" is required');
  return name;
};

const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, '');

export class Actions {
  readonly decisions: Decisions;
  private readonly c: ServerCtx;
  private readonly sync: Sync;

  constructor(ctx: ServerCtx, sync: Sync, decisions: Decisions) {
    this.c = ctx;
    this.sync = sync;
    this.decisions = decisions;
  }

  async run(name: unknown, rawArgs: unknown): Promise<ActionOutcome> {
    if (typeof name !== 'string' || !(ACTION_NAMES as readonly string[]).includes(name)) {
      return fail('unknown_action', `unknown action "${String(name).slice(0, 60)}"`, { details: { known: ACTION_NAMES } });
    }
    if (rawArgs !== undefined && (rawArgs === null || typeof rawArgs !== 'object' || Array.isArray(rawArgs))) return fail('bad_args', 'args must be an object');
    const a = (rawArgs ?? {}) as Args;
    try {
      return await this.dispatch(name as ActionName, a);
    } catch (e) {
      if (e instanceof Refuse) return { ok: false, error: e.error };
      return fail('store_failed', cut((e as Error).message, 300));
    }
  }

  private async dispatch(name: ActionName, a: Args): Promise<ActionOutcome> {
    switch (name) {
      case 'approve': return this.decisions.create(reqStr(a, 'askId'), 'approve', null);
      case 'rework': return this.decisions.create(reqStr(a, 'askId'), 'rework', reqStr(a, 'text', 500));
      case 'answer': return this.decisions.create(reqStr(a, 'askId'), 'answer', reqStr(a, 'answer', 500));
      case 'undo': return this.decisions.undo(reqInt(a, 'decisionId'));
      case 'ask.snooze': return this.snooze(a);
      case 'plan.start': return this.planStart(reqInt(a, 'planId'));
      case 'plan.park': return this.planStatus(reqInt(a, 'planId'), 'running', 'parked');
      case 'plan.resume': return this.planStatus(reqInt(a, 'planId'), 'parked', 'running');
      case 'plan.markMerged': return this.planMerged(reqInt(a, 'planId'));
      case 'task.start': return this.taskStart(a);
      case 'task.retry': return this.taskRetry(reqInt(a, 'taskId'));
      case 'task.cancel': return this.taskCancel(reqInt(a, 'taskId'));
      case 'inbox.import': return this.inboxImport(a, false);
      case 'inbox.reimport': return this.inboxImport(a, true);
      case 'inbox.archive': return this.inboxArchive(a);
      case 'inbox.restore': return this.inboxRestore(a);
      case 'inbox.delete': return this.inboxDelete(a);
      case 'bug.add': return this.bugAdd(a);
      case 'bug.fix': return this.cli(['bug', 'fix', bugId(a)], 'bug', true);
      case 'bug.close': return this.cli(['bug', 'close', bugId(a)], 'bug');
      case 'bug.reopen': return this.cli(['bug', 'reopen', bugId(a)], 'bug');
      case 'todo.add': return this.todoAdd(a);
      case 'todo.done': return this.todoDone(a);
      case 'todo.makeTask': return this.todoMakeTask(a);
      case 'settings.save': return this.settingsSave(a);
    }
  }

  // ---------------------------------------------------------------- waiting

  private snooze(a: Args): ActionOutcome {
    const id = reqStr(a, 'askId');
    const minutes = a.minutes === undefined ? 60 : reqInt(a, 'minutes');
    if (minutes < 1 || minutes > 1440) refuse('bad_args', '"minutes" must be 1 to 1440');
    if (!one(this.c.db, 'SELECT 1 AS x FROM ask WHERE id = ?', id)) refuse('not_found', `no ask ${id}`);
    const until = this.c.clock.now() + minutes * 60_000;
    tx(this.c.db, () => this.c.db.prepare('UPDATE ask SET snoozed_until = ? WHERE id = ?').run(until, id));
    return { ok: true, askId: id, snoozedUntil: until };
  }

  // ---------------------------------------------------------------- plans and tasks

  private plan(id: number): Row {
    return one(this.c.db, 'SELECT * FROM plan WHERE id = ?', id) ?? refuse('not_found', `no plan ${id}`);
  }

  private async planStart(planId: number): Promise<ActionOutcome> {
    const plan = this.plan(planId);
    if (plan.status !== 'imported') refuse('conflict', `plan ${plan.slug} is ${plan.status}; only an imported plan can be started`);
    const attempt = parseJson<string[]>(plan.past_run_ids, []).length + 1;
    const r = await callOrca(this.c, 'run-create', { objective: cut(plan.title, 200), 'retry-request': `mk-plan-${planId}-run-${attempt}` });
    if (!r.ok) return orcaFailure('Orca could not create the run', r);
    const runId = receiptId(r.receipt, 'run');
    if (!runId) refuse('orca_failed', 'Orca created a run but its reply had no run id', { details: r.receipt });
    const at = this.c.clock.now();
    tx(this.c.db, () =>
      this.c.db.prepare("UPDATE plan SET orca_run_id = ?, status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?").run(runId, at, at, planId),
    );
    this.sync.request({ slow: false });
    return { ok: true, plan: { id: planId, status: 'running', orcaRunId: runId } };
  }

  private planStatus(planId: number, from: string, to: string): ActionOutcome {
    const plan = this.plan(planId);
    if (plan.status !== from) refuse('conflict', `plan ${plan.slug} is ${plan.status}, not ${from}`);
    tx(this.c.db, () => this.c.db.prepare('UPDATE plan SET status = ?, updated_at = ? WHERE id = ?').run(to, this.c.clock.now(), planId));
    return { ok: true, plan: { id: planId, status: to } };
  }

  private planMerged(planId: number): ActionOutcome {
    const plan = this.plan(planId);
    if (plan.status !== 'running' && plan.status !== 'parked') refuse('conflict', `plan ${plan.slug} is ${plan.status}; only a started plan can be marked merged`);
    const at = this.c.clock.now();
    const left = one(this.c.db, "SELECT COUNT(*) AS n FROM plan_task WHERE plan_id = ? AND dropped_at IS NULL AND status <> 'done'", planId);
    const done = Number(left?.n) === 0;
    tx(this.c.db, () =>
      this.c.db
        .prepare('UPDATE plan SET merged_at = COALESCE(merged_at, ?), status = ?, done_at = ?, updated_at = ? WHERE id = ?')
        .run(at, done ? 'done' : String(plan.status), done ? at : null, at, planId),
    );
    return { ok: true, plan: { id: planId, status: done ? 'done' : plan.status, mergedAt: at }, allTasksDone: done };
  }

  private taskRow(id: number): { task: Row; plan: Row; phase: Row } {
    const task = one(this.c.db, 'SELECT * FROM plan_task WHERE id = ? AND dropped_at IS NULL', id) ?? refuse('not_found', `no task ${id}`);
    const plan = this.plan(task.plan_id as number);
    const phase = one(this.c.db, 'SELECT * FROM plan_phase WHERE id = ?', task.phase_id as number)!;
    if (!plan.orca_run_id || (plan.status !== 'running' && plan.status !== 'parked')) refuse('conflict', `plan ${plan.slug} has no Orca run; start the plan first`);
    return { task, plan, phase };
  }

  private taskSpec(t: Row, plan: Row, phase: Row, attempt: number): string {
    const list = (k: string): string[] => parseJson<string[]>(t[k], []);
    const lines = [`mk-ref: plan:${plan.slug}:${t.code}#${attempt}`, '', `${t.code} ${t.title}`, `Phase: ${phase.title}`, `Risk: ${t.risk}/5`];
    if (t.description) lines.push('', String(t.description));
    if (list('acceptance').length) lines.push('', 'Acceptance:', ...list('acceptance').map((x) => `- ${x}`));
    if (list('owned').length) lines.push('', `Files you own: ${list('owned').join(', ')}`);
    if (t.gate) lines.push('', `Gate: ${t.gate}`);
    if (t.manual) lines.push(`Manual check: ${t.manual}`);
    return lines.join('\n');
  }

  /** task-create in the plan's run, then the row. A replay with the same attempt returns the same Orca task. */
  private async createOrcaTask(task: Row, plan: Row, phase: Row): Promise<string | ActionOutcome> {
    const attempt = Number(task.attempts) + 1;
    const r = await callOrca(this.c, 'task-create', {
      spec: this.taskSpec(task, plan, phase, attempt),
      'task-title': cut(`${task.code} ${task.title}`, 120),
      run: String(plan.orca_run_id),
      'retry-request': `mk-task-${task.id}-${attempt}`,
    });
    if (!r.ok) return orcaFailure('Orca could not create the task', r);
    const id = receiptId(r.receipt, 'task');
    if (!id) return fail('orca_failed', 'Orca created a task but its reply had no task id', { details: r.receipt });
    const at = this.c.clock.now();
    tx(this.c.db, () => {
      const cur = one(this.c.db, 'SELECT orca_task_id, past_task_ids, attempts FROM plan_task WHERE id = ?', task.id as number)!;
      const past = parseJson<string[]>(cur.past_task_ids, []);
      if (cur.orca_task_id && cur.orca_task_id !== id) past.push(String(cur.orca_task_id));
      this.c.db
        .prepare(
          `UPDATE plan_task SET orca_run_id = ?, orca_task_id = ?, attempts = ?, past_task_ids = ?, last_state = NULL, last_state_at = NULL,
             status = 'ready', done_at = NULL, started_at = COALESCE(started_at, ?), spec_drift = 0, updated_at = ? WHERE id = ?`,
        )
        .run(String(plan.orca_run_id), id, Math.max(Number(cur.attempts), attempt), J(past), at, at, task.id as number);
    });
    return id;
  }

  private async taskStart(a: Args): Promise<ActionOutcome> {
    const { task, plan, phase } = this.taskRow(reqInt(a, 'taskId'));
    if (task.status !== 'ready') {
      const why = task.status === 'failed' || task.status === 'cancelled' ? 'retry it first' : `it is ${task.status}`;
      refuse('conflict', `task ${task.code} cannot start: ${why}`);
    }
    const route = String(task.route || phase.route || '').trim().split(/\s+/).filter(Boolean);
    const agent = optStr(a, 'agent', 40) ?? route[0];
    if (!agent) refuse('bad_args', `task ${task.code} has no route; choose an agent`);
    const model = optStr(a, 'model', 80) ?? route[1];
    const effort = optStr(a, 'effort', 20) ?? route[2];

    const max = setting<number>(loadSettings(this.c.dir), 'routing.maxLanes');
    const live = Number(one(this.c.db, "SELECT COUNT(*) AS n FROM lane WHERE ended_at IS NULL AND state IN ('working','waiting','blocked')")!.n);
    if (live >= max) refuse('conflict', `${live} lanes are already running (the limit is ${max}); raise "Lanes at once" in Settings or wait`, { code: 'max_lanes' });

    let orcaTaskId = task.orca_task_id ? String(task.orca_task_id) : '';
    if (!orcaTaskId) {
      const made = await this.createOrcaTask(task, plan, phase);
      if (typeof made !== 'string') return made;
      orcaTaskId = made;
    }
    const attempt = Number(one(this.c.db, 'SELECT attempts FROM plan_task WHERE id = ?', task.id as number)!.attempts);
    const args: ActionArgs = { task: orcaTaskId, worktree: 'new-child', agent, run: String(plan.orca_run_id), 'retry-request': `mk-start-${task.id}-${attempt}` };
    if (model) args.model = model;
    if (effort) args.effort = effort;
    const r = await callOrca(this.c, 'worker-start', args);
    this.sync.request();
    if (!r.ok) return orcaFailure(`task ${task.code} was created in Orca (${orcaTaskId}) but its worker did not start`, r);
    return { ok: true, task: { id: task.id, code: task.code, orcaTaskId } };
  }

  private async taskRetry(taskId: number): Promise<ActionOutcome> {
    const { task, plan, phase } = this.taskRow(taskId);
    if (!['failed', 'cancelled'].includes(String(task.status)) && task.last_state !== 'missing') {
      refuse('conflict', `task ${task.code} is ${task.status}; only a failed, cancelled or missing task can be retried`);
    }
    const made = await this.createOrcaTask(task, plan, phase);
    if (typeof made !== 'string') return made;
    this.sync.request();
    return { ok: true, task: { id: task.id, code: task.code, orcaTaskId: made, attempts: Number(task.attempts) + 1 } };
  }

  private async taskCancel(taskId: number): Promise<ActionOutcome> {
    const { task, plan } = this.taskRow(taskId);
    if (!task.orca_task_id) refuse('conflict', `task ${task.code} was never started in Orca`);
    if (['done', 'failed', 'cancelled'].includes(String(task.status))) refuse('conflict', `task ${task.code} is already ${task.status}`);
    // Orca has no cancel; the recipe is a task-update to failed with result "cancelled" (the worker, if any, is stopped by its lane).
    const r = await callOrca(this.c, 'task-update', {
      id: String(task.orca_task_id), status: 'failed', result: CANCELLED_RESULT, run: String(plan.orca_run_id), 'retry-request': `mk-cancel-${task.id}-${task.attempts}`,
    });
    if (!r.ok) return orcaFailure('Orca could not cancel the task', r);
    const at = this.c.clock.now();
    tx(this.c.db, () => this.c.db.prepare("UPDATE plan_task SET last_state = 'failed', last_state_at = ?, status = 'cancelled', updated_at = ? WHERE id = ?").run(at, at, taskId));
    this.sync.request();
    return { ok: true, task: { id: taskId, status: 'cancelled' } };
  }

  // ---------------------------------------------------------------- inbox files

  private repoPath(repoId: string): string {
    const r = one(this.c.db, 'SELECT path FROM repo WHERE id = ?', repoId);
    if (!r || !r.path) return refuse('not_found', `no repo ${repoId}`);
    return String(r.path);
  }

  private inboxImport(a: Args, reimport: boolean): ActionOutcome {
    const repoId = reqStr(a, 'repoId');
    const name = planFile(reqStr(a, 'name'));
    const repoPath = this.repoPath(repoId);
    if (reimport) {
      scanInbox(this.c.db, { repoId, repoPath });
      const f = one(this.c.db, 'SELECT plan_id FROM inbox_file WHERE repo_id = ? AND path = ?', repoId, `inbox/${name}`);
      if (!f?.plan_id) refuse('conflict', `${name} has no plan to update; use import`);
    }
    try {
      const res = importFile(this.c.db, { repoId, repoPath }, name);
      return { ok: true, result: res };
    } catch (e) {
      if (e instanceof ImportError) return fail('conflict', e.message, { details: { conflicts: e.conflicts } });
      throw e;
    }
  }

  private inboxRoot(a: Args): { repoId: string; name: string; root: string } {
    const repoId = reqStr(a, 'repoId');
    return { repoId, name: planFile(reqStr(a, 'name')), root: join(this.repoPath(repoId), '.matrixkoder', 'inbox') };
  }

  private fileRow(repoId: string, path: string): Row | undefined {
    return one(this.c.db, 'SELECT * FROM inbox_file WHERE repo_id = ? AND path = ?', repoId, path);
  }

  private inboxArchive(a: Args): ActionOutcome {
    const { repoId, name, root } = this.inboxRoot(a);
    const src = join(root, name);
    const dst = join(root, 'archive', name);
    if (!existsSync(src)) refuse('not_found', `${name} is not in the inbox`);
    if (existsSync(dst)) refuse('conflict', `${name} already exists in inbox/archive`);
    scanInbox(this.c.db, { repoId, repoPath: this.repoPath(repoId) });
    mkdirSync(join(root, 'archive'), { recursive: true });
    renameSync(src, dst);
    const at = this.c.clock.now();
    tx(this.c.db, () => {
      this.c.db.prepare("DELETE FROM inbox_file WHERE repo_id = ? AND path = ? AND status IN ('missing','deleted')").run(repoId, `inbox/archive/${name}`);
      this.c.db.prepare("UPDATE inbox_file SET path = ?, status = 'archived', status_at = ? WHERE repo_id = ? AND path = ?").run(`inbox/archive/${name}`, at, repoId, `inbox/${name}`);
    });
    return { ok: true, file: this.fileRow(repoId, `inbox/archive/${name}`) ?? null };
  }

  private inboxRestore(a: Args): ActionOutcome {
    const { repoId, name, root } = this.inboxRoot(a);
    const src = join(root, 'archive', name);
    const dst = join(root, name);
    if (!existsSync(src)) refuse('not_found', `${name} is not in inbox/archive`);
    if (existsSync(dst)) refuse('conflict', `${name} already exists in the inbox; rename or remove it first`);
    renameSync(src, dst);
    const at = this.c.clock.now();
    tx(this.c.db, () => {
      this.c.db.prepare("DELETE FROM inbox_file WHERE repo_id = ? AND path = ? AND status IN ('missing','deleted')").run(repoId, `inbox/${name}`);
      this.c.db.prepare('UPDATE inbox_file SET path = ?, status_at = ? WHERE repo_id = ? AND path = ?').run(`inbox/${name}`, at, repoId, `inbox/archive/${name}`);
    });
    scanInbox(this.c.db, { repoId, repoPath: this.repoPath(repoId) }); // recompute new or changed
    return { ok: true, file: this.fileRow(repoId, `inbox/${name}`) ?? null };
  }

  /** Copy to inbox/.deleted/<name>-<time>/, check the copy is byte for byte the same, then remove the original. */
  private inboxDelete(a: Args): ActionOutcome {
    const { repoId, name, root } = this.inboxRoot(a);
    const where = a.location === 'archive' ? 'archive' : '';
    const src = join(root, where, name);
    if (!existsSync(src) || !statSync(src).isFile()) refuse('not_found', `${name} is not in the ${where ? 'archive' : 'inbox'}`);
    scanInbox(this.c.db, { repoId, repoPath: this.repoPath(repoId) });
    const at = this.c.clock.now();
    const base = `${name.replace(/\.md$/, '')}-${stamp(at)}`;
    let leaf = base;
    for (let n = 2; existsSync(join(root, '.deleted', leaf)) || one(this.c.db, 'SELECT 1 AS x FROM inbox_file WHERE repo_id = ? AND path = ?', repoId, `inbox/.deleted/${leaf}/${name}`); n++) leaf = `${base}-${n}`;
    const folder = join(root, '.deleted', leaf);
    mkdirSync(folder, { recursive: true });
    const copy = join(folder, name);
    copyFileSync(src, copy);
    if (!readFileSync(src).equals(readFileSync(copy))) {
      rmSync(folder, { recursive: true, force: true });
      refuse('store_failed', `the copy of ${name} did not match; nothing was deleted`);
    }
    const rel = `inbox/${where ? 'archive/' : ''}${name}`;
    // row first (it can fail), then remove the original, so a failure never loses the file
    tx(this.c.db, () =>
      this.c.db.prepare("UPDATE inbox_file SET status = 'deleted', path = ?, status_at = ? WHERE repo_id = ? AND path = ?").run(`inbox/.deleted/${leaf}/${name}`, at, repoId, rel),
    );
    rmSync(src);
    return { ok: true, deletedTo: folder };
  }

  // ---------------------------------------------------------------- bugs and todos (the mk CLI's own code)

  /** Run `mk <argv>` and return its JSON as {ok:true,[key]}. `slow` commands (the ones that call Orca) run in a child process. */
  private async cli(argv: string[], key: string, slow = false): Promise<ActionOutcome> {
    // An injected runner (tests) stays in this process; the real one is synchronous, so it goes to a child.
    const { code, out, err } = slow && this.c.cliOrca === realOrca ? await this.cliChild(argv) : this.cliInline(argv);
    if (code === 0) return { ok: true, [key]: parseJson<unknown>(out, null) };
    const message = (err.split('\n').find((l) => l.startsWith('mk:')) ?? err).replace(/^mk:\s*/, '').trim() || 'the command failed';
    if (code === 2) return fail('bad_args', message);
    if (/^no (bug|todo) /.test(message)) return fail('not_found', message);
    if (/^orca /.test(message)) return fail('orca_failed', message);
    if (/already|reopen/.test(message)) return fail('conflict', message);
    return fail('store_failed', message);
  }

  private cliInline(argv: string[]): { code: number; out: string; err: string } {
    let out = '';
    let err = '';
    const code = cliMain(argv, {
      out: (l) => (out += l),
      err: (l) => (err += l),
      env: { MK_REPORTED_BY: 'user' },
      cwd: this.c.dir,
      orca: this.c.cliOrca,
      dir: this.c.dir,
    });
    return { code, out, err };
  }

  /** The same CLI in its own process, so a slow `orca` call never stops this one. */
  private cliChild(argv: string[]): Promise<{ code: number; out: string; err: string }> {
    return new Promise((resolve) => {
      let out = '';
      let err = '';
      const child = spawn(process.execPath, [CLI_CHILD, ...argv], {
        cwd: this.c.dir,
        env: { ...process.env, MK_REPORTED_BY: 'user', MK_DATA_DIR: this.c.dir },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: CLI_CHILD_TIMEOUT_MS,
      });
      child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
      child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
      child.on('error', (e) => resolve({ code: 1, out, err: `mk: could not run the mk command: ${e.message}` }));
      child.on('close', (code) => resolve({ code: code ?? 1, out, err: code === null ? 'mk: the mk command timed out' : err }));
    });
  }

  private bugAdd(a: Args): Promise<ActionOutcome> {
    const argv = ['bug', 'add', `--repo=${reqStr(a, 'repoId')}`, `--title=${reqStr(a, 'title', 300)}`, '--reported-by=user'];
    const details = optStr(a, 'details', 20_000);
    const file = optStr(a, 'file', 300);
    if (details) argv.push(`--details=${details}`);
    if (file) argv.push(`--file=${file}`);
    if (a.line !== undefined && a.line !== null) argv.push(`--line=${reqInt(a, 'line')}`);
    if (a.risk !== undefined && a.risk !== null) argv.push(`--risk=${reqInt(a, 'risk')}`);
    return this.cli(argv, 'bug');
  }

  private todoAdd(a: Args): Promise<ActionOutcome> {
    const argv = ['todo', 'add', `--repo=${reqStr(a, 'repoId')}`, `--text=${reqStr(a, 'text', 500)}`];
    const group = optStr(a, 'group', 10);
    if (group) argv.push(`--group=${group}`);
    return this.cli(argv, 'todo');
  }

  private async todoDone(a: Args): Promise<ActionOutcome> {
    const id = reqInt(a, 'todoId');
    if (a.done === false) {
      if (!one(this.c.db, 'SELECT 1 AS x FROM todo WHERE id = ?', id)) refuse('not_found', `no todo ${id}`);
      tx(this.c.db, () => this.c.db.prepare('UPDATE todo SET done = 0, done_at = NULL WHERE id = ?').run(id));
      return { ok: true, todo: one(this.c.db, 'SELECT * FROM todo WHERE id = ?', id) };
    }
    return this.cli(['todo', 'done', String(id)], 'todo');
  }

  /** "Make task": a plan_task (origin 'todo') in the chosen phase replaces the to-do. No Orca call; the task starts later. */
  private todoMakeTask(a: Args): ActionOutcome {
    const todoId = reqInt(a, 'todoId');
    const todo = one(this.c.db, 'SELECT * FROM todo WHERE id = ?', todoId) ?? refuse('not_found', `no todo ${todoId}`);
    const phaseId = a.phaseId !== undefined ? reqInt(a, 'phaseId') : todo.link_kind === 'phase' ? Number(todo.link_ref) : refuse('bad_args', '"phaseId" is required');
    const phase = one(this.c.db, 'SELECT * FROM plan_phase WHERE id = ? AND dropped_at IS NULL', phaseId) ?? refuse('not_found', `no phase ${phaseId}`);
    const at = this.c.clock.now();
    const out = tx(this.c.db, () => {
      const planId = phase.plan_id as number;
      let code = `TODO.${todoId}`;
      for (let n = 2; one(this.c.db, 'SELECT 1 AS x FROM plan_task WHERE plan_id = ? AND code = ?', planId, code); n++) code = `TODO.${todoId}-${n}`;
      const ord = Number(one(this.c.db, 'SELECT COALESCE(MAX(ord), 0) + 1 AS n FROM plan_task WHERE phase_id = ?', phaseId)!.n);
      const id = Number(
        this.c.db
          .prepare("INSERT INTO plan_task(plan_id, phase_id, code, ord, origin, title, status, created_at, updated_at) VALUES(?,?,?,?,'todo',?,'pending',?,?) RETURNING id")
          .get(planId, phaseId, code, ord, cut(todo.text, 300), at, at)!.id,
      );
      this.c.db.prepare('DELETE FROM todo WHERE id = ?').run(todoId);
      return { id, code, planId, phaseId };
    });
    return { ok: true, task: out };
  }

  // ---------------------------------------------------------------- settings

  private settingsSave(a: Args): ActionOutcome {
    const patch = a.patch;
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) refuse('bad_args', '"patch" must be an object of settings to change');
    if (J(patch).length > SETTINGS_PATCH_MAX) refuse('too_large', `"patch" is too large (limit ${SETTINGS_PATCH_MAX} characters)`);
    try {
      return { ok: true, settings: saveSettings(patch as Settings, this.c.dir) };
    } catch (e) {
      if (e instanceof SettingsError) return fail('bad_args', e.message, { details: { issues: e.issues } });
      throw e;
    }
  }
}

