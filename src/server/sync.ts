/**
 * The sync loop (mk-data-schema.md §4): Orca and git in, cached columns of mk-data.db out.
 *
 *   fast group, every 10 s:  worktree ps + list, terminals, runs, then per tracked run its tasks, workers and gates,
 *                            the inbox, and git for worktrees that have a live lane.
 *   slow group, every 60 s:  repos, quota, hosts (and the repo base branch and the agent CLI probe, every 10 min).
 *   at once (debounced 500 ms) on agent.status.changed, worktree.created and worktree.removed.
 *
 * Rules the code keeps:
 *   1. It writes only cached [C]/[G]/[S] columns and the derived [D] ones. MK-owned [M] columns belong to the
 *      CLI and the actions (the one exception, pane.turns, is the sync loop's by the schema).
 *   2. An object is marked gone only after it is missing from GONE_AFTER_COMPLETE_PULLS consecutive pulls that were
 *      complete (not truncated, no next page). A failed or partial pull changes nothing.
 *   3. Orca's ISO times become epoch ms. Prompt, assistant text and tool input never reach this file: the adapter
 *      drops them, and message bodies are not stored at all (only a question's own text and subjects).
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  accountList, gateList, hostList, inbox, repoList, runList, taskList, terminalList, workerList, workerShow,
  worktreeList, worktreePs,
} from '../orca/index.js';
import type {
  AccountListProjection, GateListProjection, HostListProjection, InboxProjection, OrcaResult, RepoListProjection,
  RunListProjection, TaskListProjection, TerminalListProjection, WorkerListProjection, WorktreeListProjection, WorktreePsProjection,
} from '../orca/index.js';
import { all, one, tx, type Db } from '../store/db.js';
import { importFile, inboxPlace, scanInbox } from '../store/import.js';
import { loadSettings, setting } from '../store/settings.js';
import { Notifier } from './notify.js';
import { CANCELLED_RESULT, cut, isoToMs, J, readSettings, type CliProbe, type CliProber, type GitRunner, type ServerCtx } from './common.js';
import { deriveLaneState, recomputeBugs, recomputePlanTasks } from './status.js';

export const GONE_AFTER_COMPLETE_PULLS = 2;
export const AGENT_CLI_IDS = ['claude', 'codex', 'agy', 'opencode', 'omp', 'gemini'];
const PANE_STATES = new Set(['working', 'blocked', 'waiting', 'done']);
const DAY = 86_400_000;
/** A base branch is used inside `${base}..HEAD`, so a name that starts with "-" (read by git as an option) or holds odd characters is not accepted. */
const SAFE_REF = /^\w[\w./-]*$/;
const safeRef = (v: unknown): string => (typeof v === 'string' && SAFE_REF.test(v) && !v.includes('..') ? v : 'main');
const GIT_TARGETS_PER_TICK = 6;
const WORKER_SHOWS_PER_RUN = 4;

export const execGit: GitRunner = (cwd, args) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 10_000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : String(stdout).trim()),
    );
  });

export const execProbe: CliProber = (command) =>
  new Promise((resolve) => {
    execFile('/bin/sh', ['-c', 'command -v "$1"', 'sh', command], { timeout: 5000, encoding: 'utf8' }, (err, out) => {
      const path = String(out ?? '').trim().split('\n')[0];
      if (err || !path) return resolve({ found: false, error: 'not found on PATH' });
      execFile(path, ['--version'], { timeout: 5000, encoding: 'utf8' }, (verr, vout) =>
        resolve({ found: true, path, version: verr ? undefined : cut(String(vout).trim().split('\n')[0], 80), error: verr ? cut(verr.message, 120) : undefined }),
      );
    });
  });

export interface SyncOptions {
  git?: GitRunner;
  probeCli?: CliProber;
  /** How long to wait after an Orca event before pulling (default 500 ms). */
  debounceMs?: number;
  /** Sends the notifications sync raises (default: one built from the context). */
  notifier?: Notifier;
}

type Alert = Parameters<Notifier['notify']>;

export class Sync {
  private readonly c: ServerCtx;
  private readonly git: GitRunner;
  private readonly probe: CliProber;
  private readonly debounceMs: number;
  private readonly notifier: Notifier;
  /** Notifications noticed inside a transaction; sent by `flushAlerts` once it has committed. */
  private alerts: Alert[] = [];
  private readonly misses = new Map<string, number>();
  private readonly lastTool = new Map<number, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private debounce: unknown = null;
  private wantSlow = false;
  private intervals: NodeJS.Timeout[] = [];
  private startOpts: { fastMs?: number; slowMs?: number; filesMs?: number } = {};
  /** The timer lengths now running ("fast/slow/files" in ms), and whether `start` has been called. */
  private armed = '';
  private running = false;

  constructor(ctx: ServerCtx, opts: SyncOptions = {}) {
    this.c = ctx;
    this.git = opts.git ?? execGit;
    this.probe = opts.probeCli ?? execProbe;
    this.debounceMs = opts.debounceMs ?? 500;
    this.notifier = opts.notifier ?? new Notifier(ctx);
  }

  private get db(): Db {
    return this.c.db;
  }
  private now(): number {
    return this.c.clock.now();
  }

  // ---------------------------------------------------------------- scheduling

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** The three timer lengths: an explicit option (tests) wins over `sync.*`. */
  private timing(): { fastMs: number; slowMs: number; filesMs: number } {
    const o = this.startOpts;
    const st = readSettings(this.c);
    return {
      fastMs: o.fastMs ?? setting<number>(st, 'sync.fastSeconds') * 1000,
      slowMs: o.slowMs ?? setting<number>(st, 'sync.slowSeconds') * 1000,
      filesMs: o.filesMs ?? setting<number>(st, 'sync.filesSeconds') * 1000,
    };
  }

  private arm(): void {
    for (const t of this.intervals) clearInterval(t);
    this.intervals = [];
    const guard = (p: Promise<unknown>): void => void p.catch((e) => this.c.log(`[sync] ${(e as Error).message}`));
    const every = (ms: number, fn: () => Promise<unknown>): void => {
      const t = setInterval(() => guard(fn()), ms);
      t.unref?.();
      this.intervals.push(t);
    };
    const tm = this.timing();
    this.armed = `${tm.fastMs}/${tm.slowMs}/${tm.filesMs}`;
    every(tm.fastMs, () => this.pullFast());
    every(tm.slowMs, () => this.pullSlow());
    every(tm.filesMs, () => this.scanFiles());
  }

  /** Start the timers. The first pull runs at once. */
  start(opts: { fastMs?: number; slowMs?: number; filesMs?: number } = {}): void {
    this.stop();
    this.startOpts = opts;
    this.arm();
    this.running = true;
    void this.pullAll().catch((e) => this.c.log(`[sync] ${(e as Error).message}`));
  }

  /** After a settings change: re-arm the timers only when a `sync.*` length actually changed. No pull. */
  retime(): void {
    if (!this.running) return;
    const tm = this.timing();
    if (`${tm.fastMs}/${tm.slowMs}/${tm.filesMs}` !== this.armed) this.arm();
  }

  stop(): void {
    for (const t of this.intervals) clearInterval(t);
    this.intervals = [];
    this.running = false;
    if (this.debounce) this.c.clock.clearTimeout(this.debounce);
    this.debounce = null;
  }

  /** A pull soon (debounced), for events and for actions that changed Orca. */
  request(opts: { slow?: boolean } = {}): void {
    this.wantSlow ||= !!opts.slow;
    if (this.debounce) return;
    this.debounce = this.c.clock.setTimeout(() => {
      this.debounce = null;
      const slow = this.wantSlow;
      this.wantSlow = false;
      void (slow ? this.pullAll() : this.pullFast()).catch((e) => this.c.log(`[sync] ${(e as Error).message}`));
    }, this.debounceMs);
  }

  pullAll(): Promise<void> {
    return this.pullFast().then(() => this.pullSlow());
  }

  // ---------------------------------------------------------------- bookkeeping

  private record(source: string, t0: number, err: string | null, items: number | null): void {
    const at = this.now();
    tx(this.db, () =>
      this.db
        .prepare(
          `INSERT INTO sync_state(source, last_try_at, last_ok_at, last_error, last_error_at, duration_ms, items)
           VALUES(?,?,?,?,?,?,?)
           ON CONFLICT(source) DO UPDATE SET last_try_at=excluded.last_try_at,
             last_ok_at=COALESCE(excluded.last_ok_at, sync_state.last_ok_at), last_error=excluded.last_error,
             last_error_at=COALESCE(excluded.last_error_at, sync_state.last_error_at), duration_ms=excluded.duration_ms,
             items=COALESCE(excluded.items, sync_state.items)`,
        )
        .run(source, t0, err ? null : at, err, err ? at : null, at - t0, items),
    );
  }

  /** Apply one source's result in a single transaction and note it in sync_state. Returns the value, or null on any failure. */
  private applyResult<T>(source: string, t0: number, r: OrcaResult<T>, fn: (v: T) => number | void): T | null {
    if (!r.ok) {
      this.record(source, t0, cut(`${r.error.kind}: ${r.error.message}`, 300), null);
      return null;
    }
    try {
      let items = 0;
      tx(this.db, () => {
        items = fn(r.value) ?? 0;
      });
      this.record(source, t0, null, items);
      return r.value;
    } catch (e) {
      this.record(source, t0, cut((e as Error).message, 300), null);
      return null;
    }
  }

  private seenOnce(key: string): void {
    this.misses.delete(key);
  }
  /** One more complete pull without `key`; true when that makes GONE_AFTER_COMPLETE_PULLS in a row. */
  private missed(key: string): boolean {
    const n = (this.misses.get(key) ?? 0) + 1;
    if (n >= GONE_AFTER_COMPLETE_PULLS) {
      this.misses.delete(key);
      return true;
    }
    this.misses.set(key, n);
    return false;
  }

  /** Mark rows of a fixed table gone after enough complete pulls without them. Only complete pulls count. */
  private markGone(table: 'worktree' | 'repo' | 'run' | 'pane', keyCol: string, seen: Set<string>, complete: boolean, at: number, where = '1=1', ...params: (string | number)[]): string[] {
    if (!complete) return [];
    const gone: string[] = [];
    for (const r of all(this.db, `SELECT ${keyCol} AS k FROM ${table} WHERE gone_at IS NULL AND ${where}`, ...params)) {
      const k = String(r.k);
      const key = `${table}:${k}`;
      if (seen.has(k)) this.seenOnce(key);
      else if (this.missed(key)) {
        this.db.prepare(`UPDATE ${table} SET gone_at = ? WHERE ${keyCol} = ?`).run(at, k);
        gone.push(k);
      }
    }
    return gone;
  }

  private addEvent(kind: 'lane' | 'gate' | 'ask' | 'commit' | 'bus', at: number, text: string, src: string | null, ref: string | null, repoId: string | null, payload: unknown): void {
    let p = payload === null || payload === undefined ? null : J(payload);
    if (p && p.length > 2000) p = J({ truncated: true });
    this.db.prepare('INSERT OR IGNORE INTO event_log(at, kind, repo_id, text, src, ref, payload) VALUES(?,?,?,?,?,?,?)').run(at, kind, repoId, cut(text, 200), src === null ? null : cut(src, 120), ref, p);
  }

  private addActivity(laneId: number, at: number, kind: 'state' | 'tool' | 'check' | 'commit' | 'note', text: string): void {
    this.db.prepare('INSERT INTO lane_activity(lane_id, at, kind, text) VALUES(?,?,?,?)').run(laneId, at, kind, cut(text, 120));
  }

  /** Runs worth pulling in full: the run of a running or parked plan, and each repo's bug run. */
  trackedRuns(): { runId: string; repoId: string }[] {
    const rows = all(
      this.db,
      `SELECT orca_run_id AS run_id, repo_id FROM plan WHERE status IN ('running','parked') AND orca_run_id IS NOT NULL
       UNION SELECT bug_run_id, id FROM repo WHERE bug_run_id IS NOT NULL AND gone_at IS NULL`,
    );
    const seen = new Set<string>();
    const out: { runId: string; repoId: string }[] = [];
    for (const r of rows) {
      const runId = String(r.run_id);
      if (seen.has(runId)) continue;
      seen.add(runId);
      out.push({ runId, repoId: String(r.repo_id) });
    }
    return out;
  }

  // ---------------------------------------------------------------- fast group

  pullFast(): Promise<void> {
    return this.exclusive(() => this.doFast());
  }

  private async doFast(): Promise<void> {
    const rn = this.c.runner;
    const tracked = this.trackedRuns();
    const t0 = this.now();
    const [ps, wl, tl, rl, ib, perRun] = await Promise.all([
      worktreePs(rn),
      worktreeList(rn),
      terminalList(rn),
      runList(rn),
      inbox(rn, { limit: 100 }),
      Promise.all(
        tracked.map(async (t) => {
          const [tasks, workers, gates] = await Promise.all([taskList(rn, { runId: t.runId, brief: true }), workerList(rn, { runId: t.runId }), gateList(rn, { runId: t.runId })]);
          return { ...t, tasks, workers, gates };
        }),
      ),
    ]);
    const at = this.now();

    const paneKeys = new Set<string>();
    let psComplete = false;
    let termComplete = false;
    this.applyResult('ps', t0, ps, (v) => {
      psComplete = !v.truncated;
      return this.applyPs(v, at, paneKeys);
    });
    this.applyResult('worktree-list', t0, wl, (v) => this.applyWorktreeList(v));
    this.applyResult('terminals', t0, tl, (v) => {
      termComplete = !v.truncated;
      return this.applyTerminals(v, at, paneKeys);
    });
    if (psComplete && termComplete) {
      tx(this.db, () => {
        const gone = this.markGone('pane', 'pane_key', paneKeys, true, at);
        if (gone.length) this.c.log(`[sync] ${gone.length} pane(s) gone`);
      });
    }
    this.applyResult('runs', t0, rl, (v) => this.applyRuns(v, at));

    for (const r of perRun) {
      this.applyResult(`tasks:${r.runId}`, t0, r.tasks, (v) => this.applyTasks(r.runId, v, at));
      const w = this.applyResult(`workers:${r.runId}`, t0, r.workers, (v) => this.applyWorkers(r.runId, r.repoId, v, at));
      this.applyResult(`gates:${r.runId}`, t0, r.gates, (v) => this.applyGates(r.runId, v, at));
      if (w) await this.fillWorkerDetails(r.runId);
    }
    this.applyResult('inbox', t0, ib, (v) => this.applyInbox(v, at));

    // derived columns, after every cached source above had its chance
    tx(this.db, () => this.reconcileLanes(at));
    recomputePlanTasks(this.db, at);
    recomputeBugs(this.db, at);
    this.collectStalls(at);
    await this.pullGit();
    await this.flushAlerts();
  }

  private applyPs(p: WorktreePsProjection, at: number, paneKeys: Set<string>): number {
    const { db } = this;
    const seen = new Set<string>();
    const upsertWt = db.prepare(
      `INSERT INTO worktree(id, repo_id, path, branch, display_name, is_main, is_archived, parent_worktree_id, workspace_status, status,
         live_terminal_count, terminal_verdict, last_activity_at, last_output_at, first_seen_at, last_seen_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET repo_id=excluded.repo_id, path=excluded.path, branch=excluded.branch, display_name=excluded.display_name,
         is_main=excluded.is_main, is_archived=excluded.is_archived, parent_worktree_id=excluded.parent_worktree_id,
         workspace_status=excluded.workspace_status, status=excluded.status, live_terminal_count=excluded.live_terminal_count,
         terminal_verdict=excluded.terminal_verdict, last_activity_at=excluded.last_activity_at, last_output_at=excluded.last_output_at,
         last_seen_at=excluded.last_seen_at, gone_at=NULL`,
    );
    const upsertPane = db.prepare(
      `INSERT INTO pane(pane_key, worktree_id, repo_id, agent_type, agent_state, agent_state_since, agent_updated_at, parent_pane_key,
         tool_name, task_title, interrupted, first_seen_at, last_seen_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(pane_key) DO UPDATE SET worktree_id=excluded.worktree_id, repo_id=excluded.repo_id, agent_type=excluded.agent_type,
         agent_state=excluded.agent_state, agent_state_since=excluded.agent_state_since, agent_updated_at=excluded.agent_updated_at,
         parent_pane_key=excluded.parent_pane_key, tool_name=excluded.tool_name, task_title=excluded.task_title,
         interrupted=excluded.interrupted, last_seen_at=excluded.last_seen_at, gone_at=NULL, turns=pane.turns + ?`,
    );
    for (const w of p.worktrees) {
      seen.add(w.worktreeId);
      upsertWt.run(
        w.worktreeId, w.repoId, w.path, w.branch, cut(w.displayName, 200), w.isMainWorktree ? 1 : 0, w.isArchived ? 1 : 0,
        w.parentWorktreeId, w.workspaceStatus, w.status, w.liveTerminalCount, w.terminalVerdict, w.lastActivityAt, w.lastOutputAt, at, at,
      );
      for (const a of w.agents) {
        paneKeys.add(a.paneKey);
        const prev = one(db, 'SELECT agent_state FROM pane WHERE pane_key = ?', a.paneKey);
        const state = PANE_STATES.has(a.state) ? a.state : null;
        const newTurn = prev?.agent_state === 'done' && state === 'working' ? 1 : 0;
        upsertPane.run(
          a.paneKey, w.worktreeId, w.repoId, a.agentType, state, a.stateStartedAt, a.updatedAt, a.parentPaneKey,
          a.toolName === null ? null : cut(a.toolName, 60), a.taskTitle === null ? null : cut(a.taskTitle, 120), a.interrupted ? 1 : 0, at, at, newTurn,
        );
      }
      if (!p.truncated) {
        // an agent that left agents[] keeps its pane (the terminal may still be listed), without agent columns
        const keep = w.agents.map((a) => a.paneKey);
        db.prepare(
          `UPDATE pane SET agent_type=NULL, agent_state=NULL, agent_state_since=NULL, agent_updated_at=NULL, parent_pane_key=NULL,
             tool_name=NULL, task_title=NULL, interrupted=NULL
           WHERE worktree_id = ? AND agent_state IS NOT NULL AND pane_key NOT IN (${keep.map(() => '?').join(',') || "''"})`,
        ).run(w.worktreeId, ...keep);
      }
    }
    const gone = this.markGone('worktree', 'id', seen, !p.truncated, at);
    for (const id of gone) db.prepare('UPDATE pane SET gone_at = ? WHERE worktree_id = ? AND gone_at IS NULL').run(at, id);
    return p.worktrees.length;
  }

  private applyWorktreeList(l: WorktreeListProjection): number {
    const upd = this.db.prepare('UPDATE worktree SET head = ? WHERE id = ?');
    for (const w of l.worktrees) upd.run(w.head.slice(0, 7), w.id);
    return l.worktrees.length;
  }

  private applyTerminals(t: TerminalListProjection, at: number, paneKeys: Set<string>): number {
    const { db } = this;
    for (const term of t.terminals) {
      const wt = one(db, 'SELECT repo_id FROM worktree WHERE id = ?', term.worktreeId);
      let key: string | null = (one(db, 'SELECT pane_key FROM pane WHERE terminal_handle = ?', term.handle)?.pane_key as string | undefined) ?? null;
      if (key === null || key.startsWith('term:')) {
        // The adapter's terminal projection has no tab or leaf id, so join to an agent pane by worktree + agent type,
        // and only when that is unambiguous on both sides.
        const sameKind = t.terminals.filter((x) => x.worktreeId === term.worktreeId && x.agentIdentity === term.agentIdentity).length;
        const cands = term.agentIdentity
          ? all(db, 'SELECT pane_key FROM pane WHERE worktree_id = ? AND agent_type = ? AND terminal_handle IS NULL AND gone_at IS NULL', term.worktreeId, term.agentIdentity)
          : [];
        if (cands.length === 1 && sameKind === 1) {
          if (key) db.prepare('DELETE FROM pane WHERE pane_key = ?').run(key);
          key = String(cands[0].pane_key);
        }
      }
      key ??= `term:${term.handle}`;
      paneKeys.add(key);
      db.prepare(
        `INSERT INTO pane(pane_key, worktree_id, repo_id, terminal_handle, title, connected, writable, last_output_at, first_seen_at, last_seen_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(pane_key) DO UPDATE SET terminal_handle=excluded.terminal_handle, title=excluded.title, connected=excluded.connected,
           writable=excluded.writable, last_output_at=excluded.last_output_at, last_seen_at=excluded.last_seen_at, gone_at=NULL,
           repo_id=COALESCE(pane.repo_id, excluded.repo_id)`,
      ).run(key, term.worktreeId, wt ? String(wt.repo_id) : null, term.handle, cut(term.title, 120), term.connected ? 1 : 0, term.writable ? 1 : 0, term.lastOutputAt, at, at);
    }
    return t.terminals.length;
  }

  private applyRuns(r: RunListProjection, at: number): number {
    const { db } = this;
    const seen = new Set<string>();
    const up = db.prepare(
      `INSERT INTO run(id, objective, coordinator_handle, legacy, created_at, updated_at, first_seen_at, last_seen_at)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET objective=excluded.objective, coordinator_handle=excluded.coordinator_handle, legacy=excluded.legacy,
         created_at=excluded.created_at, updated_at=excluded.updated_at, last_seen_at=excluded.last_seen_at, gone_at=NULL`,
    );
    for (const run of r.runs) {
      if (run.legacy || run.id === 'run_legacy_local') continue; // the placeholder run is not a real run
      seen.add(run.id);
      up.run(run.id, cut(run.objective, 200), run.coordinatorHandle, 0, isoToMs(run.createdAt), isoToMs(run.updatedAt), at, at);
    }
    db.exec(
      `UPDATE run SET repo_id = COALESCE(repo_id, (SELECT repo_id FROM plan WHERE plan.orca_run_id = run.id), (SELECT id FROM repo WHERE repo.bug_run_id = run.id))
        WHERE repo_id IS NULL`,
    );
    const complete = r.nextCursor === null;
    this.markGone('run', 'id', seen, complete, at);
    if (complete) {
      for (const p of all(db, 'SELECT id, orca_run_id FROM plan WHERE orca_run_id IS NOT NULL')) {
        db.prepare('UPDATE plan SET run_last_state = ? WHERE id = ?').run(seen.has(String(p.orca_run_id)) ? 'listed' : 'missing', p.id as number);
      }
    }
    return seen.size;
  }

  /**
   * Known limit (review 2, finding 8): Orca's task-list has no paging or completeness field (A7), so a partial list looks
   * like a complete one and a task that fell off it is marked 'missing'. Only the cached state changes (status and data are
   * kept), and the next full list puts it back, so nothing is lost. A count check would need Orca to report a total.
   */
  private applyTasks(runId: string, tl: TaskListProjection, at: number): number {
    const { db } = this;
    const byId = new Map(tl.tasks.map((t) => [t.id, t]));
    const stateOf = (id: string): { state: string; cancelled: boolean } => {
      const t = byId.get(id);
      // the dashboard's own cancel (actions.ts taskCancel) sets result "cancelled"; free text that merely mentions it is not a cancel
      return t ? { state: t.status, cancelled: t.status === 'failed' && (t.result ?? '').trim().toLowerCase() === CANCELLED_RESULT } : { state: 'missing', cancelled: false };
    };
    for (const row of all(db, 'SELECT id, code, title, orca_task_id, last_state, status FROM plan_task WHERE orca_run_id = ? AND orca_task_id IS NOT NULL AND dropped_at IS NULL', runId)) {
      const { state, cancelled } = stateOf(String(row.orca_task_id));
      if (state !== row.last_state) {
        db.prepare('UPDATE plan_task SET last_state = ?, last_state_at = ?, updated_at = ? WHERE id = ?').run(state, at, at, row.id as number);
        if (state === 'failed' && !cancelled) this.alert('taskFailed', `taskFailed:plan_task:${row.id}:${row.orca_task_id}`, 'MatrixKoder: task failed', `${String(row.code)} ${cut(String(row.title), 120)} failed.`);
      }
      if (cancelled && row.status !== 'cancelled') db.prepare("UPDATE plan_task SET status = 'cancelled', updated_at = ? WHERE id = ?").run(at, row.id as number);
    }
    for (const row of all(db, 'SELECT id, title, orca_task_id, last_state FROM bug WHERE orca_run_id = ? AND orca_task_id IS NOT NULL', runId)) {
      const { state, cancelled } = stateOf(String(row.orca_task_id));
      if (state !== row.last_state) {
        db.prepare('UPDATE bug SET last_state = ?, last_state_at = ? WHERE id = ?').run(state, at, String(row.id));
        if (state === 'failed' && !cancelled) this.alert('taskFailed', `taskFailed:bug:${row.id}:${row.orca_task_id}`, 'MatrixKoder: bug fix failed', `${String(row.id)} ${cut(String(row.title), 120)}: the fix task failed.`);
      }
    }
    return tl.tasks.length;
  }

  private laneLabel(repoId: string, orcaTaskId: string | null): string {
    const { db } = this;
    const free = (l: string): boolean => !one(db, 'SELECT 1 AS x FROM lane WHERE repo_id = ? AND label = ? AND ended_at IS NULL', repoId, l);
    if (orcaTaskId) {
      const t = one(db, 'SELECT ph.lane_group AS g, ph.code AS c FROM plan_task t JOIN plan_phase ph ON ph.id = t.phase_id WHERE t.orca_task_id = ?', orcaTaskId);
      const cand = t ? String(t.g || t.c) : '';
      if (cand && free(cand)) return cand;
    }
    for (let n = 1; ; n++) if (free(`L${n}`)) return `L${n}`;
  }

  private applyWorkers(runId: string, runRepo: string, wl: WorkerListProjection, at: number): number {
    const { db } = this;
    const seen = new Set<string>();
    for (const w of wl.workers) {
      seen.add(w.dispatchId);
      const wt = w.worktreeId ? one(db, 'SELECT repo_id FROM worktree WHERE id = ?', w.worktreeId) : undefined;
      const repoId = wt ? String(wt.repo_id) : runRepo;
      if (!repoId) continue;
      const pane = w.terminalHandle ? one(db, 'SELECT pane_key, agent_type FROM pane WHERE terminal_handle = ? AND gone_at IS NULL', w.terminalHandle) : undefined;
      const vals = [
        w.workerState, w.dispatchStatus, w.stage.activity, w.liveness.verdict, w.attention.categories.join(','), w.attention.requiresAction ? 1 : 0,
        w.outcome, w.worktreeId, w.terminalHandle, w.taskId, pane ? String(pane.pane_key) : null, pane?.agent_type ? String(pane.agent_type) : null,
      ];
      const existing = one(db, 'SELECT id FROM lane WHERE dispatch_id = ?', w.dispatchId);
      if (existing) {
        db.prepare(
          `UPDATE lane SET worker_state=?, dispatch_status=?, stage_activity=?, liveness=?, attention=?, requires_action=?, outcome=?,
             worktree_id=COALESCE(?, worktree_id), terminal_handle=COALESCE(?, terminal_handle), orca_task_id=?, pane_key=COALESCE(?, pane_key),
             agent=COALESCE(agent, ?), last_seen_at=? WHERE id=?`,
        ).run(...vals, at, existing.id as number);
      } else {
        db.prepare(
          `INSERT INTO lane(lane_key, kind, repo_id, label, run_id, dispatch_id, worker_state, dispatch_status, stage_activity, liveness, attention,
             requires_action, outcome, worktree_id, terminal_handle, orca_task_id, pane_key, agent, state, state_at, first_seen_at, last_seen_at)
           VALUES(?,'dispatch',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'working',?,?,?)`,
        ).run(`dsp:${w.dispatchId}`, repoId, this.laneLabel(repoId, w.taskId || null), runId, w.dispatchId, ...vals, at, at, at);
      }
    }
    if (!wl.page.hasMore) {
      for (const l of all(db, "SELECT id, dispatch_id FROM lane WHERE kind = 'dispatch' AND run_id = ? AND ended_at IS NULL", runId)) {
        const id = String(l.dispatch_id);
        if (seen.has(id)) this.seenOnce(`lane:${id}`);
        else if (this.missed(`lane:${id}`)) {
          db.prepare("UPDATE lane SET state = 'stopped', state_at = ?, ended_at = ? WHERE id = ?").run(at, at, l.id as number);
          this.addActivity(l.id as number, at, 'state', 'stopped: worker no longer listed');
        }
      }
    }
    return wl.workers.length;
  }

  /** worker-show once per dispatch (its start time never changes); retried on later ticks until it has one. */
  private async fillWorkerDetails(runId: string): Promise<void> {
    const rows = all(this.db, "SELECT id, dispatch_id FROM lane WHERE kind = 'dispatch' AND run_id = ? AND started_at IS NULL LIMIT ?", runId, WORKER_SHOWS_PER_RUN);
    for (const l of rows) {
      const r = await workerShow(this.c.runner, { dispatchId: String(l.dispatch_id) });
      if (!r.ok) continue;
      const started = isoToMs(r.value.dispatch.dispatchedAt);
      const beat = isoToMs(r.value.dispatch.lastHeartbeatAt);
      if (started === null && beat === null) continue;
      tx(this.db, () =>
        this.db.prepare('UPDATE lane SET started_at = COALESCE(?, started_at), last_heartbeat_at = COALESCE(?, last_heartbeat_at) WHERE id = ?').run(started, beat, l.id as number),
      );
    }
  }

  private splitQuestion(text: string): { title: string; body: string } {
    const lines = text.split('\n');
    const first = lines.findIndex((l) => l.trim() !== '');
    if (first < 0) return { title: '', body: '' };
    return { title: cut(lines[first].trim(), 160), body: cut(lines.slice(first + 1).join('\n').trim(), 1500) };
  }

  /**
   * Known limit (review 2, finding 8): gate-list has no paging or completeness field (A7) either. A gate absent from a
   * partial list is marked gone only after two consecutive pulls (`missed`), and a later pull that sees it clears gone_at.
   */
  private applyGates(runId: string, gl: GateListProjection, at: number): number {
    const { db } = this;
    const seen = new Set<string>();
    const repoRow = one(db, 'SELECT repo_id FROM run WHERE id = ?', runId);
    for (const g of gl.gates) {
      seen.add(g.id);
      const { title, body } = this.splitQuestion(g.question);
      const status = ['pending', 'resolved', 'timeout'].includes(g.status) ? g.status : 'closed';
      const had = one(db, 'SELECT 1 AS x FROM ask WHERE id = ?', g.id);
      db.prepare(
        `INSERT INTO ask(id, kind, run_id, orca_task_id, title, body, options, orca_status, resolution, asked_at, resolved_at, first_seen_at, last_seen_at)
         VALUES(?,'gate',?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, options=excluded.options, orca_status=excluded.orca_status,
           resolution=excluded.resolution, resolved_at=excluded.resolved_at, orca_task_id=excluded.orca_task_id, last_seen_at=excluded.last_seen_at, gone_at=NULL`,
      ).run(g.id, runId, g.taskId || null, title || '(no title)', body, J(g.options), status, g.resolution === null ? null : cut(g.resolution, 300), isoToMs(g.createdAt) ?? at, isoToMs(g.resolvedAt), at, at);
      if (!had && status === 'pending') this.alert('ask', `ask:${g.id}`, 'MatrixKoder: waiting for you', title || '(no title)', runId);
      if (!had && status === 'pending') this.addEvent('ask', isoToMs(g.createdAt) ?? at, `gate: ${title}`, null, `ask:${g.id}`, repoRow ? String(repoRow.repo_id) : null, { kind: 'gate', task: g.taskId });
    }
    for (const a of all(db, "SELECT id FROM ask WHERE kind = 'gate' AND run_id = ? AND gone_at IS NULL", runId)) {
      const id = String(a.id);
      if (seen.has(id)) this.seenOnce(`ask:${id}`);
      else if (this.missed(`ask:${id}`)) db.prepare('UPDATE ask SET gone_at = ? WHERE id = ?').run(at, id);
    }
    return gl.gates.length;
  }

  private applyInbox(ib: InboxProjection, at: number): number {
    const { db } = this;
    const msgs = [...ib.messages].sort((a, b) => a.sequence - b.sequence);
    const cursor = Number(one(db, "SELECT value FROM kv WHERE key = 'inbox.sequence'")?.value ?? 0);
    const newest = msgs.length ? msgs[msgs.length - 1].sequence : cursor;
    const repoOf = (runId: string): string | null => {
      const r = one(db, 'SELECT repo_id FROM run WHERE id = ?', runId);
      return r?.repo_id ? String(r.repo_id) : null;
    };
    if (cursor > 0 && newest - cursor > 100) {
      this.addEvent('bus', at, `history gap: messages #${cursor + 1} to #${newest - 100} were not read`, null, `gap:${cursor}`, null, { from: cursor, to: newest });
    }
    const questionIds = new Set<string>();
    for (const m of msgs) {
      if (m.type === 'heartbeat') {
        // only the latest phase and time per dispatch are kept; a heartbeat is never an event row
        const d = m.payload.dispatchId ?? (m.from.startsWith('dispatch:') ? m.from.slice(9) : undefined);
        const beat = isoToMs(m.createdAt);
        if (d && beat !== null) {
          db.prepare('UPDATE lane SET phase = COALESCE(?, phase), last_heartbeat_at = ? WHERE dispatch_id = ? AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= ?)').run(
            m.payload.phase ? cut(m.payload.phase, 60) : null, beat, d, beat,
          );
        }
        continue;
      }
      const when = isoToMs(m.createdAt) ?? at;
      if (m.type === 'question') {
        questionIds.add(m.id);
        const text = m.payload.question ?? m.subject;
        const { title, body } = this.splitQuestion(text);
        const dispatch = m.payload.dispatchId ?? (m.from.startsWith('dispatch:') ? m.from.slice(9) : null);
        // A reply is a later message in the same thread, addressed to the asker. Matching on the address alone would let an
        // unrelated status or nudge to the same dispatch close a question that is still open.
        const thread = m.threadId ?? m.id;
        const reply = msgs.find((r) => r.sequence > m.sequence && r.threadId === thread && r.to === m.from && r.type !== 'heartbeat' && r.type !== 'question');
        const prev = one(db, 'SELECT orca_status FROM ask WHERE id = ?', m.id);
        const status = reply || prev?.orca_status === 'answered' ? 'answered' : 'pending';
        if (!prev && status === 'pending') this.alert('ask', `ask:${m.id}`, 'MatrixKoder: waiting for you', title || '(question)', m.runId);
        db.prepare(
          `INSERT INTO ask(id, kind, run_id, orca_task_id, dispatch_id, thread_id, title, body, options, orca_status, asked_at, resolved_at, first_seen_at, last_seen_at)
           VALUES(?,'question',?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, options=excluded.options, orca_status=excluded.orca_status,
             resolved_at=COALESCE(excluded.resolved_at, ask.resolved_at), last_seen_at=excluded.last_seen_at, gone_at=NULL`,
        ).run(m.id, m.runId, m.payload.taskId ?? null, dispatch, m.id, title || '(question)', body, J(m.payload.options ?? []), status, when, reply ? isoToMs(reply.createdAt) : null, at, at);
      }
      if (m.sequence > cursor) {
        const isAsk = m.type === 'question';
        this.addEvent(
          isAsk ? 'ask' : 'bus',
          when,
          isAsk ? `asked: ${this.splitQuestion(m.payload.question ?? m.subject).title}` : `${m.type}${m.subject ? `: ${cut(m.subject, 140)}` : ''}`,
          `${m.from} → ${m.to}`,
          `msg:${m.id}`,
          repoOf(m.runId),
          { id: m.id, sequence: m.sequence, type: m.type, from: m.from, to: m.to, subject: cut(m.subject, 160), runId: m.runId, ...m.payload, question: undefined },
        );
      }
    }
    // a question that fell out of the 100-message window stays pending until answered, then closes after a day
    for (const a of all(db, "SELECT id, asked_at FROM ask WHERE kind = 'question' AND orca_status = 'pending' AND gone_at IS NULL")) {
      if (!questionIds.has(String(a.id)) && at - Number(a.asked_at) > DAY) db.prepare("UPDATE ask SET orca_status = 'closed' WHERE id = ?").run(String(a.id));
    }
    if (newest > cursor) {
      db.prepare("INSERT INTO kv(key, value, updated_at) VALUES('inbox.sequence', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(String(newest), at);
    }
    return msgs.length;
  }

  /** Lane state from cached columns, plus a lane for a worktree that has a live agent but no dispatch. */
  private reconcileLanes(at: number): void {
    const { db } = this;
    const askTasks = new Set(all(db, "SELECT orca_task_id AS t FROM ask WHERE orca_status = 'pending' AND gone_at IS NULL AND orca_task_id IS NOT NULL").map((r) => String(r.t)));
    const askDispatch = new Set(all(db, "SELECT dispatch_id AS d FROM ask WHERE orca_status = 'pending' AND gone_at IS NULL AND dispatch_id IS NOT NULL").map((r) => String(r.d)));

    // worktree lanes for live agents that no dispatch lane covers
    const covered = new Set(all(db, 'SELECT worktree_id AS w FROM lane WHERE ended_at IS NULL AND worktree_id IS NOT NULL').map((r) => String(r.w)));
    for (const p of all(db, "SELECT * FROM pane WHERE gone_at IS NULL AND agent_state IN ('working','blocked','waiting') AND parent_pane_key IS NULL AND repo_id IS NOT NULL")) {
      const wid = String(p.worktree_id);
      if (covered.has(wid)) continue;
      covered.add(wid);
      const key = `wt:${wid}`;
      const old = one(db, 'SELECT id, ended_at FROM lane WHERE lane_key = ?', key);
      if (old) {
        if (old.ended_at !== null) {
          db.prepare("UPDATE lane SET ended_at = NULL, state = 'working', state_at = ?, pane_key = ?, terminal_handle = ?, agent = ?, last_seen_at = ? WHERE id = ?").run(
            at, String(p.pane_key), p.terminal_handle, p.agent_type, at, old.id as number,
          );
        }
        continue;
      }
      db.prepare(
        `INSERT INTO lane(lane_key, kind, repo_id, label, worktree_id, pane_key, terminal_handle, agent, state, state_at, started_at, first_seen_at, last_seen_at)
         VALUES(?,'worktree',?,?,?,?,?,?,'working',?,?,?,?)`,
      ).run(key, String(p.repo_id), this.laneLabel(String(p.repo_id), null), wid, String(p.pane_key), p.terminal_handle, p.agent_type, at, p.agent_state_since, at, at);
    }

    const lanes = all(
      db,
      `SELECT l.*, p.agent_state AS pane_state, p.gone_at AS pane_gone, p.tool_name AS tool
         FROM lane l LEFT JOIN pane p ON p.pane_key = l.pane_key WHERE l.ended_at IS NULL`,
    );
    for (const l of lanes) {
      const asking = (l.orca_task_id !== null && askTasks.has(String(l.orca_task_id))) || (l.dispatch_id !== null && askDispatch.has(String(l.dispatch_id)));
      let paneGone = l.pane_gone !== null;
      if (l.kind === 'worktree') {
        const wt = one(db, 'SELECT gone_at FROM worktree WHERE id = ?', String(l.worktree_id));
        paneGone ||= wt?.gone_at !== null && wt?.gone_at !== undefined;
        if (l.pane_key === null) paneGone = true;
      }
      const state = deriveLaneState(l, l.pane_state === null ? null : String(l.pane_state), paneGone, asking);
      const id = l.id as number;
      if (state !== l.state) {
        const ends = state === 'done' || state === 'failed' || state === 'stopped';
        db.prepare('UPDATE lane SET state = ?, state_at = ?, ended_at = ? WHERE id = ?').run(state, at, ends ? at : null, id);
        this.addActivity(id, at, 'state', `${l.state} → ${state}`);
      }
      const tool = l.tool === null ? '' : String(l.tool);
      if (tool && this.lastTool.get(id) !== tool) {
        this.lastTool.set(id, tool);
        this.addActivity(id, at, 'tool', tool); // the tool's name only, never its input
      }
    }
  }

  // ---------------------------------------------------------------- git

  /** git numbers for worktrees that have a live lane (at most a few per tick). */
  async pullGit(): Promise<void> {
    const t0 = this.now();
    const targets = all(
      this.db,
      `SELECT DISTINCT w.id, w.path, w.repo_id FROM worktree w JOIN lane l ON l.worktree_id = w.id
        WHERE l.ended_at IS NULL AND w.gone_at IS NULL ORDER BY w.last_activity_at DESC LIMIT ?`,
      GIT_TARGETS_PER_TICK,
    );
    if (targets.length === 0) return;
    let firstError: string | null = null;
    for (const w of targets) {
      const repo = one(this.db, 'SELECT base_ref FROM repo WHERE id = ?', String(w.repo_id));
      const base = safeRef(repo?.base_ref);
      const path = String(w.path);
      let ahead = await this.git(path, ['rev-list', '--count', `${base}..HEAD`]);
      if (ahead === null) ahead = await this.git(path, ['rev-list', '--count', `origin/${base}..HEAD`]);
      const committed = await this.git(path, ['diff', '--shortstat', `${base}...HEAD`]);
      const working = await this.git(path, ['diff', '--shortstat', 'HEAD']);
      const status = await this.git(path, ['status', '--porcelain']);
      const at = this.now();
      if (ahead === null) {
        const msg = `git could not compare ${base}..HEAD`;
        firstError ??= msg;
        tx(this.db, () => this.db.prepare('UPDATE worktree SET git_error = ?, git_at = ? WHERE id = ?').run(msg, at, String(w.id)));
        continue;
      }
      const a = parseShortstat(committed);
      const b = parseShortstat(working);
      tx(this.db, () =>
        this.db
          .prepare(
            `UPDATE worktree SET git_base_ref=?, git_ahead=?, git_files=?, git_added=?, git_removed=?, git_dirty=?, git_at=?, git_error=NULL WHERE id=?`,
          )
          .run(base, Number(ahead) || 0, a.files + b.files, a.added + b.added, a.removed + b.removed, status ? 1 : 0, at, String(w.id)),
      );
    }
    this.record('git', t0, firstError, targets.length);
  }

  // ---------------------------------------------------------------- slow group

  pullSlow(): Promise<void> {
    return this.exclusive(() => this.doSlow());
  }

  private async doSlow(): Promise<void> {
    const rn = this.c.runner;
    const t0 = this.now();
    const [repos, quota, hosts] = await Promise.all([repoList(rn), accountList(rn), hostList(rn)]);
    const at = this.now();
    this.applyResult('repos', t0, repos, (v) => this.applyRepos(v, at));
    this.applyResult('quota', t0, quota, (v) => this.applyQuota(v, at));
    this.applyResult('hosts', t0, hosts, (v) => this.applyHosts(v, at));
    await this.refreshBaseRefs();
    await this.probeAgentClis();
    await this.flushAlerts();
  }

  // ---------------------------------------------------------------- notifications (C6)

  private alert(...a: Alert): void {
    this.alerts.push(a);
  }

  /** Send what the apply steps noticed. Runs outside the transactions: a send is async and may type into a terminal. */
  private async flushAlerts(): Promise<void> {
    const todo = this.alerts;
    this.alerts = [];
    for (const a of todo) {
      try {
        await this.notifier.notify(...a);
      } catch (e) {
        this.c.log(`[notify] ${(e as Error).message}`);
      }
    }
  }

  /** A dispatch lane whose worker is still going but has sent no heartbeat for `lanes.stallMinutes`. */
  private collectStalls(at: number): void {
    const limit = setting<number>(loadSettings(this.c.dir), 'lanes.stallMinutes') * 60_000;
    const rows = all(
      this.db,
      `SELECT lane_key, label, last_heartbeat_at FROM lane
        WHERE kind = 'dispatch' AND ended_at IS NULL AND last_heartbeat_at IS NOT NULL
          AND (worker_state IS NULL OR worker_state IN ('starting','ready','start_unknown'))`,
    );
    for (const l of rows) {
      const beat = Number(l.last_heartbeat_at);
      if (at - beat <= limit) continue;
      const mins = Math.floor((at - beat) / 60_000);
      this.alert('stall', `stall:${String(l.lane_key)}:${beat}`, 'MatrixKoder: lane may be stuck', `Lane ${String(l.label)} has sent no heartbeat for ${mins} minutes.`);
    }
  }

  private applyRepos(r: RepoListProjection, at: number): number {
    const { db } = this;
    const seen = new Set<string>();
    const up = db.prepare(
      `INSERT INTO repo(id, path, display_name, kind, remote_key, added_at, first_seen_at, last_seen_at) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET path=excluded.path, display_name=excluded.display_name, kind=excluded.kind, remote_key=excluded.remote_key,
         added_at=excluded.added_at, last_seen_at=excluded.last_seen_at, gone_at=NULL`,
    );
    for (const x of r.repos) {
      seen.add(x.id);
      up.run(x.id, x.path, x.displayName, x.kind, x.remote, x.addedAt, at, at);
    }
    this.markGone('repo', 'id', seen, true, at);
    return r.repos.length;
  }

  private applyQuota(a: AccountListProjection, at: number): number {
    const { db } = this;
    db.exec('DELETE FROM quota');
    const ins = db.prepare('INSERT INTO quota(provider, win, used_percent, window_minutes, resets_at, updated_at, error, status) VALUES(?,?,?,?,?,?,?,?)');
    let n = 0;
    for (const p of a.rateLimits) {
      const wins = ([['session', p.session], ['weekly', p.weekly], ['monthly', p.monthly]] as const).filter(([, w]) => w !== null);
      if (wins.length === 0) {
        ins.run(p.provider, 'session', null, null, null, p.updatedAt, p.error === null ? null : cut(p.error, 200), p.status || null); // "not reported by this CLI"
        n++;
        continue;
      }
      for (const [win, w] of wins) {
        ins.run(p.provider, win, w!.usedPercent, w!.windowMinutes, w!.resetsAt, p.updatedAt, p.error === null ? null : cut(p.error, 200), p.status || null);
        n++;
      }
    }
    this.collectLowQuota();
    void at;
    return n;
  }

  /** quotaLow: a pulled window with less left than its floor (the same floors task.start checks). One alert per reset of the window. */
  private collectLowQuota(): void {
    const settings = loadSettings(this.c.dir);
    for (const q of all(this.db, 'SELECT provider, win, used_percent, resets_at FROM quota WHERE used_percent IS NOT NULL')) {
      const key = q.win === 'session' ? 'sessionPct' : q.win === 'weekly' ? 'weeklyPct' : null;
      if (!key) continue;
      const group = q.provider === 'claude' ? 'claude' : 'others';
      const floor = setting<number>(settings, `quota.floor.${group}.${key}`);
      const left = Math.max(0, Math.round(100 - Number(q.used_percent)));
      if (left < floor) this.alert('quotaLow', `quotaLow:${String(q.provider)}:${String(q.win)}:${q.resets_at ?? 'none'}`, 'MatrixKoder: quota running low', `${String(q.provider)} ${String(q.win)} quota is at ${left}% left (floor ${floor}%).`);
    }
  }

  private applyHosts(h: HostListProjection, at: number): number {
    const host = h.hosts.find((x) => x.kind === 'local' || x.id === 'local') ?? h.hosts[0];
    if (host?.machineName) {
      this.db
        .prepare("INSERT INTO kv(key, value, updated_at) VALUES('host.machine_name', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
        .run(cut(host.machineName, 120), at);
    }
    return h.hosts.length;
  }

  private async refreshBaseRefs(): Promise<void> {
    const at = this.now();
    for (const r of all(this.db, 'SELECT id, path, base_ref_at FROM repo WHERE gone_at IS NULL AND path <> \'\'')) {
      if (r.base_ref_at !== null && at - Number(r.base_ref_at) < 600_000) continue;
      const out = await this.git(String(r.path), ['symbolic-ref', 'refs/remotes/origin/HEAD']);
      const ref = out ? out.replace(/^refs\/remotes\/origin\//, '') : 'main';
      tx(this.db, () => this.db.prepare('UPDATE repo SET base_ref = ?, base_ref_at = ? WHERE id = ?').run(safeRef(ref), at, String(r.id)));
    }
  }

  private async probeAgentClis(): Promise<void> {
    const at = this.now();
    const last = Number(one(this.db, "SELECT value FROM kv WHERE key = 'agent_cli.at'")?.value ?? 0);
    if (at - last < 600_000) return;
    const results = await Promise.all(
      AGENT_CLI_IDS.map(async (id): Promise<[string, CliProbe]> => [id, await this.probe(id).catch((e: Error): CliProbe => ({ found: false, error: e.message }))]),
    );
    tx(this.db, () => {
      for (const [id, p] of results) {
        this.db
          .prepare(
            `INSERT INTO agent_cli(agent_id, found, cli_path, version, error, checked_at) VALUES(?,?,?,?,?,?)
             ON CONFLICT(agent_id) DO UPDATE SET found=excluded.found, cli_path=excluded.cli_path, version=excluded.version, error=excluded.error, checked_at=excluded.checked_at`,
          )
          .run(id, p.found ? 1 : 0, p.path ?? null, p.version ?? null, p.error ?? null, at);
      }
      this.db.prepare("INSERT INTO kv(key, value, updated_at) VALUES('agent_cli.at', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(String(at), at);
    });
  }

  /** Re-detect the agent CLIs now (Settings > Agents "Detect again"). */
  async detectAgentClis(): Promise<void> {
    tx(this.db, () => this.db.prepare("DELETE FROM kv WHERE key = 'agent_cli.at'").run());
    await this.exclusive(() => this.probeAgentClis());
  }

  // ---------------------------------------------------------------- plan files

  /** inbox_file rows from disk, for each repo whose inbox folder exists; then, when `plans.autoImport` is on, the new `pass` files. */
  async scanFiles(): Promise<void> {
    const t0 = this.now();
    let n = 0;
    try {
      const settings = readSettings(this.c);
      const auto = setting<boolean>(settings, 'plans.autoImport');
      for (const r of all(this.db, "SELECT id, path FROM repo WHERE gone_at IS NULL AND path <> ''")) {
        const target = { repoId: String(r.id), repoPath: String(r.path), settings };
        const { folder, prefix } = inboxPlace(target);
        if (!existsSync(folder)) continue;
        n += scanInbox(this.db, target, this.now()).length;
        if (!auto) continue;
        const fresh = all(this.db, "SELECT name FROM inbox_file WHERE repo_id = ? AND status = 'new' AND fit = 'pass' AND path = ? || '/' || name", target.repoId, prefix);
        for (const f of fresh) {
          try {
            importFile(this.db, target, String(f.name), this.now());
          } catch (e) {
            this.c.log(`[sync] auto-import of ${String(f.name)} failed: ${(e as Error).message}`);
          }
        }
      }
      this.record('files', t0, null, n);
    } catch (e) {
      this.record('files', t0, cut((e as Error).message, 300), null);
    }
  }

  // ---------------------------------------------------------------- Orca events

  /** agent.status.changed: apply the new state to the pane at once, log it, and pull soon. */
  onAgentStatus(payload: unknown): void {
    const p = (payload ?? {}) as { paneKey?: unknown; state?: unknown; receivedAt?: unknown };
    const paneKey = typeof p.paneKey === 'string' ? p.paneKey : '';
    const state = typeof p.state === 'string' ? p.state : '';
    const at = this.now();
    if (paneKey) {
      try {
        tx(this.db, () => {
          const pane = one(this.db, 'SELECT * FROM pane WHERE pane_key = ?', paneKey);
          const since = typeof p.receivedAt === 'number' ? p.receivedAt : at;
          if (pane && PANE_STATES.has(state)) {
            const inc = pane.agent_state === 'done' && state === 'working' ? 1 : 0;
            this.db.prepare('UPDATE pane SET agent_state = ?, agent_state_since = ?, agent_updated_at = ?, turns = turns + ? WHERE pane_key = ?').run(state, since, at, inc, paneKey);
          }
          const lane = one(this.db, 'SELECT label, agent FROM lane WHERE pane_key = ? AND ended_at IS NULL', paneKey);
          const who = lane ? `${lane.label} ${lane.agent ?? pane?.agent_type ?? ''}`.trim() : String(pane?.agent_type ?? 'agent');
          this.addEvent('lane', at, `${who} ${state || 'changed'}`, `${who} · agent.status.changed`, `pane:${paneKey}:${since}`, pane?.repo_id ? String(pane.repo_id) : null, { paneKey, state });
          this.reconcileLanes(at);
        });
      } catch (e) {
        this.c.log(`[sync] agent event: ${(e as Error).message}`);
      }
    }
    this.request();
  }

  onWorktreeCreated(): void {
    this.request({ slow: true });
  }

  onWorktreeRemoved(payload: unknown): void {
    const p = (payload ?? {}) as { worktreeId?: unknown; path?: unknown };
    const at = this.now();
    try {
      tx(this.db, () => {
        const rows =
          typeof p.worktreeId === 'string'
            ? all(this.db, 'SELECT id FROM worktree WHERE id = ?', p.worktreeId)
            : typeof p.path === 'string'
              ? all(this.db, 'SELECT id FROM worktree WHERE path = ?', p.path)
              : [];
        for (const w of rows) {
          this.db.prepare('UPDATE worktree SET gone_at = ? WHERE id = ? AND gone_at IS NULL').run(at, String(w.id));
          this.db.prepare('UPDATE pane SET gone_at = ? WHERE worktree_id = ? AND gone_at IS NULL').run(at, String(w.id));
        }
        this.reconcileLanes(at);
      });
    } catch (e) {
      this.c.log(`[sync] worktree.removed: ${(e as Error).message}`);
    }
    this.request({ slow: true });
  }
}

/** " 6 files changed, 182 insertions(+), 40 deletions(-)" */
export function parseShortstat(s: string | null): { files: number; added: number; removed: number } {
  if (!s) return { files: 0, added: 0, removed: 0 };
  const g = (re: RegExp): number => Number(re.exec(s)?.[1] ?? 0);
  return { files: g(/(\d+) files? changed/), added: g(/(\d+) insertions?\(\+\)/), removed: g(/(\d+) deletions?\(-\)/) };
}

