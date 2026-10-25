/**
 * Approve, rework and answer (Q2): Orca resolutions are final, so each one waits in decision_log for the Undo
 * window (10 s) and only then runs its single Orca command. A restart inside or after the window is handled by
 * replay(): a pending row whose commit time passed within 10 minutes runs, an older one expires.
 */
import { buildActionArgv } from '../orca/index.js';
import { all, one, tx, type Row } from '../store/db.js';
import { cut, fail, J, parseJson, type ActionOutcome, type ServerCtx } from './common.js';
import { callOrca, decisionActionFromArgv } from './orca-call.js';

export const REPLAY_WINDOW_MS = 10 * 60_000;
export type DecisionAction = 'approve' | 'rework' | 'answer';

export class Decisions {
  private readonly timers = new Map<number, unknown>();
  private readonly c: ServerCtx;

  constructor(ctx: ServerCtx) {
    this.c = ctx;
  }

  /** Queue a decision for an ask. Nothing is sent to Orca until the Undo window ends. */
  create(askId: string, action: DecisionAction, text: string | null): ActionOutcome {
    const { db, clock } = this.c;
    const ask = one(db, 'SELECT * FROM ask WHERE id = ?', askId);
    if (!ask) return fail('not_found', `no ask ${askId}`);
    if (ask.orca_status !== 'pending' || ask.gone_at !== null) return fail('conflict', 'this ask is no longer waiting for an answer');
    if (one(db, "SELECT 1 AS x FROM decision_log WHERE ask_id = ? AND status = 'pending'", askId)) {
      return fail('conflict', 'a decision for this ask is already waiting to be sent; undo it first');
    }
    const kind = ask.kind === 'gate' ? 'gate' : 'question';
    const at = clock.now();
    const requestId = `mk-dec-${askId}-${at}`;
    let value: string;
    if (action === 'approve') value = kind === 'gate' ? 'approved' : 'approve';
    else if (action === 'rework') value = `rework: ${text ?? ''}`.trim();
    else value = text ?? '';
    if (action !== 'approve' && (text === null || text.trim() === '')) return fail('bad_args', action === 'rework' ? 'rework needs text' : 'answer needs a choice or text');
    const built =
      kind === 'gate'
        ? buildActionArgv('gate-resolve', { id: askId, resolution: value, 'retry-request': requestId })
        : buildActionArgv('reply', { id: askId, body: value, run: String(ask.run_id), 'retry-request': requestId });
    if (!built.ok) return fail('bad_args', built.error.message);

    const commitAt = at + this.c.undoMs;
    const repo = one(db, 'SELECT repo_id FROM run WHERE id = ?', String(ask.run_id));
    const id = tx(db, () =>
      Number(
        db
          .prepare(
            `INSERT INTO decision_log(repo_id, run_id, ask_id, kind, title, action, answer, actor, status, command, request_id, commit_at, created_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
          )
          .get(repo?.repo_id ?? null, String(ask.run_id), askId, kind, cut(ask.title, 160), action, action === 'approve' ? null : cut(text, 500), 'user', 'pending', J(built.argv), requestId, commitAt, at)!.id,
      ),
    );
    this.schedule(id, this.c.undoMs);
    return { ok: true, decisionId: id, action, commitAt, undoUntil: commitAt };
  }

  private schedule(id: number, ms: number): void {
    this.cancelTimer(id);
    this.timers.set(
      id,
      this.c.clock.setTimeout(() => {
        this.timers.delete(id);
        void this.commit(id).catch((e) => this.c.log(`[decision ${id}] ${(e as Error).message}`));
      }, ms),
    );
  }

  private cancelTimer(id: number): void {
    const t = this.timers.get(id);
    if (t !== undefined) this.c.clock.clearTimeout(t);
    this.timers.delete(id);
  }

  /** Cancel a decision that has not been sent. Only possible inside the window. */
  undo(id: number): ActionOutcome {
    const { db, clock } = this.c;
    const row = one(db, 'SELECT * FROM decision_log WHERE id = ?', id);
    if (!row) return fail('not_found', `no decision ${id}`);
    const changed = tx(db, () =>
      Number(
        db
          .prepare("UPDATE decision_log SET status = 'undone' WHERE id = ? AND status = 'pending' AND sent_at IS NULL AND commit_at > ?")
          .run(id, clock.now()).changes,
      ),
    );
    if (changed === 0) return fail('conflict', row.status === 'pending' ? 'the Undo window has ended; the decision is being sent' : `this decision is already ${row.status}`);
    this.cancelTimer(id);
    return { ok: true, decisionId: id, status: 'undone' };
  }

  /** Send the decision's Orca command now. Safe to call twice: the claim needs sent_at to be empty, so only one caller gets it. */
  async commit(id: number): Promise<void> {
    const { db, clock } = this.c;
    const claimed = tx(db, () => Number(db.prepare("UPDATE decision_log SET sent_at = ? WHERE id = ? AND status = 'pending' AND sent_at IS NULL").run(clock.now(), id).changes));
    if (claimed === 0) return;
    const row = one(db, 'SELECT * FROM decision_log WHERE id = ?', id) as Row;
    const finish = (status: 'sent' | 'failed', error: string | null): void => {
      tx(db, () => db.prepare('UPDATE decision_log SET status = ?, error = ?, sent_at = ? WHERE id = ?').run(status, error, clock.now(), id));
    };
    const action = decisionActionFromArgv(parseJson<unknown>(row.command, null));
    if (!action) return finish('failed', 'the stored command is not an allowed decision');
    const r = await callOrca(this.c, action.name, action.args, String(row.run_id));
    if (!r.ok) return finish('failed', cut(r.error.message, 300));
    finish('sent', null);
    this.c.requestSync();
  }

  /** On start: run what is due (within 10 min), expire what is older, and re-arm timers for what is still inside its window. */
  async replay(): Promise<{ ran: number; expired: number; scheduled: number }> {
    const { db, clock } = this.c;
    const at = clock.now();
    const out = { ran: 0, expired: 0, scheduled: 0 };
    for (const r of all(db, "SELECT id, commit_at, sent_at FROM decision_log WHERE status = 'pending' ORDER BY id")) {
      const commitAt = Number(r.commit_at ?? 0);
      const id = r.id as number;
      if (r.sent_at !== null && at - commitAt <= REPLAY_WINDOW_MS) {
        // The worker stopped after claiming this row and before recording the result. Sending again is deliberate:
        // the command keeps its --retry-request, so Orca returns the first receipt instead of resolving twice.
        this.c.log(`[decision ${id}] was claimed but never finished; sending it again with the same retry-request`);
        tx(db, () => db.prepare("UPDATE decision_log SET sent_at = NULL WHERE id = ? AND status = 'pending'").run(id));
      }
      if (commitAt > at) {
        this.schedule(id, commitAt - at);
        out.scheduled++;
      } else if (at - commitAt <= REPLAY_WINDOW_MS) {
        await this.commit(id);
        out.ran++;
      } else {
        tx(db, () => db.prepare("UPDATE decision_log SET status = 'expired', error = 'the worker was not running when the Undo window ended' WHERE id = ? AND status = 'pending'").run(id));
        out.expired++;
      }
    }
    return out;
  }

  close(): void {
    for (const id of [...this.timers.keys()]) this.cancelTimer(id);
  }
}
