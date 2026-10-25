/**
 * Derived status columns ([D] in mk-data-schema.md): plan task status (§3.3), bug status (§3.5), lane state (§3.6).
 * The sync loop calls these after every pull. They read cached columns and write only the derived ones.
 */
import { all, tx, type Db, type Row } from '../store/db.js';
import { J, parseJson } from './common.js';

const pendingAskTasks = (db: Db): Set<string> =>
  new Set(
    all(db, "SELECT DISTINCT orca_task_id AS t FROM ask WHERE orca_status='pending' AND gone_at IS NULL AND orca_task_id IS NOT NULL").map((r) =>
      String(r.t),
    ),
  );

// ---------------------------------------------------------------- plan tasks (§3.3)

function fromLastState(t: Row, asks: Set<string>): string {
  const cur = String(t.status);
  const ls = t.last_state === null ? null : String(t.last_state);
  const asking = asks.has(String(t.orca_task_id));
  switch (ls) {
    case null:
      return cur === 'pending' || cur === 'blocked' ? 'ready' : cur; // an Orca task exists, the first pull has not seen it yet
    case 'completed':
      return 'done';
    case 'failed':
      return cur === 'cancelled' ? 'cancelled' : 'failed';
    case 'missing':
      return cur;
    case 'blocked':
      return asking ? 'waiting' : 'blocked';
    case 'dispatched':
      return asking ? 'waiting' : 'working';
    default: // ready, pending
      return asking ? 'waiting' : 'ready';
  }
}

/** Recompute plan_task.status for every live plan. Returns how many rows changed. */
export function recomputePlanTasks(db: Db, at: number): number {
  const asks = pendingAskTasks(db);
  let changed = 0;
  tx(db, () => {
    for (const plan of all(db, "SELECT id FROM plan WHERE status IN ('imported','running','parked')")) {
      const planId = plan.id as number;
      const phases = all(db, 'SELECT id, code, wave, deps FROM plan_phase WHERE plan_id = ? AND dropped_at IS NULL', planId);
      const tasks = all(db, 'SELECT * FROM plan_task WHERE plan_id = ? AND dropped_at IS NULL ORDER BY id', planId);
      const next = new Map<number, string>();

      // tasks that have an Orca task: status follows the cached Orca state
      for (const t of tasks) if (t.orca_task_id) next.set(t.id as number, fromLastState(t, asks));
      const doneCodes = new Set(tasks.filter((t) => next.get(t.id as number) === 'done').map((t) => String(t.code)));

      // tasks without one: pending / blocked / ready from the plan's own order
      const phaseDone = new Map<number, boolean>();
      for (const p of phases) {
        const own = tasks.filter((t) => t.phase_id === p.id);
        phaseDone.set(p.id as number, own.every((t) => (t.orca_task_id ? next.get(t.id as number) === 'done' : false)));
      }
      const phaseByCode = new Map(phases.map((p) => [String(p.code), p]));
      const phaseIsDone = (code: string): boolean => {
        const p = phaseByCode.get(code);
        return p ? phaseDone.get(p.id as number) === true : true;
      };
      for (const t of tasks) {
        if (t.orca_task_id) continue;
        const phase = phases.find((p) => p.id === t.phase_id);
        const phaseDeps = parseJson<string[]>(phase?.deps, []);
        const waveReached = phases.every((p) => Number(p.wave) >= Number(phase?.wave ?? 0) || phaseDone.get(p.id as number) === true);
        if (!waveReached || !phaseDeps.every((c) => phaseByCode.has(c) ? phaseIsDone(c) : true)) {
          next.set(t.id as number, 'pending');
          continue;
        }
        const taskDeps = parseJson<string[]>(t.deps, []);
        const unmet = taskDeps.some((c) => {
          if (tasks.some((x) => x.code === c)) return !doneCodes.has(c);
          return phaseByCode.has(c) ? !phaseIsDone(c) : false;
        });
        next.set(t.id as number, unmet ? 'blocked' : 'ready');
      }

      for (const t of tasks) {
        const to = next.get(t.id as number);
        if (!to || to === t.status) continue;
        changed++;
        db.prepare('UPDATE plan_task SET status = ?, done_at = ?, updated_at = ? WHERE id = ?').run(
          to,
          to === 'done' ? (t.done_at as number | null) ?? at : null,
          at,
          t.id as number,
        );
        if (to === 'done') {
          db.prepare("UPDATE plan_subtask SET status = 'done', updated_at = ? WHERE task_id = ? AND status <> 'done' AND dropped_at IS NULL").run(at, t.id as number);
        }
      }
    }
  });
  return changed;
}

// ---------------------------------------------------------------- bugs (§3.5)

/** Bugs that are fixing or waiting follow their Orca task. open, fixed and wontfix are never moved by absence or by an old state. */
export function recomputeBugs(db: Db, at: number): number {
  const asks = pendingAskTasks(db);
  let changed = 0;
  tx(db, () => {
    for (const b of all(db, "SELECT * FROM bug WHERE status IN ('fixing','waiting') AND orca_task_id IS NOT NULL")) {
      const ls = b.last_state === null ? null : String(b.last_state);
      let to: string = String(b.status);
      if (ls === 'completed') to = 'fixed';
      else if (ls === 'failed') to = 'open';
      else if (ls === 'dispatched' || ls === 'ready' || ls === 'pending' || ls === 'blocked') to = asks.has(String(b.orca_task_id)) ? 'waiting' : 'fixing';
      if (to === b.status) continue;
      changed++;
      db.prepare('UPDATE bug SET status = ?, fixed_at = ?, updated_at = ? WHERE id = ?').run(to, to === 'fixed' ? at : null, at, String(b.id));
    }
  });
  return changed;
}

// ---------------------------------------------------------------- lanes (§3.6)

export type LaneState = 'working' | 'waiting' | 'blocked' | 'done' | 'failed' | 'stopped';

export function deriveLaneState(lane: Row, paneState: string | null, paneGone: boolean, asking: boolean): LaneState {
  if (lane.kind === 'worktree') {
    if (paneGone) return 'stopped';
    if (paneState === 'done') return 'done';
    if (asking || paneState === 'waiting') return 'waiting';
    if (paneState === 'blocked') return 'blocked';
    return 'working';
  }
  const ws = String(lane.worker_state ?? '');
  const ds = String(lane.dispatch_status ?? '');
  if (ws === 'failed' || ds === 'failed' || ds === 'circuit_broken') return 'failed';
  if (['stopped', 'stopping', 'abandoned', 'stop_unknown'].includes(ws)) return 'stopped';
  if (ws === 'succeeded' || ds === 'completed') return 'done';
  const attention = String(lane.attention ?? '').split(',');
  const needsYou = lane.requires_action === 1 && attention.some((c) => ['input', 'approval', 'guidance'].includes(c));
  if (asking || needsYou) return 'waiting';
  if (lane.stage_activity === 'blocked' || paneState === 'blocked') return 'blocked';
  return 'working';
}

export const jsonList = (v: unknown): string => J(Array.isArray(v) ? v : []);
