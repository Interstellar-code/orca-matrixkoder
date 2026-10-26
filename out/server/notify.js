/**
 * The notifier (contract C6): every desktop notification MatrixKoder sends goes through `Notifier.notify`, which checks the
 * `notify.events.<event>` toggle, keeps quiet hours quiet (only `ask` gets through) and de-dupes on `alert_sent.key`.
 * The host call itself is `ctx.notify`, filled by worker.ts with `notifications.show` (tests stub it).
 */
import { runAction } from '../orca/index.js';
import { setting } from '../store/settings.js';
import { coordinatorHandle, safeToType } from './orca-call.js';
import { cut, fail, readSettings } from './common.js';
export const NOTIFY_EVENTS = ['ask', 'laneDone', 'taskFailed', 'stall', 'quotaLow'];
/** True when `nowMs` (local time) falls inside the quiet window; a window that crosses midnight (22:00 to 07:00) works too. */
export function inQuietHours(nowMs, from, to) {
    const mins = (hhmm) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
        return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
    };
    const a = mins(from);
    const b = mins(to);
    if (Number.isNaN(a) || Number.isNaN(b) || a === b)
        return false;
    const d = new Date(nowMs);
    const m = d.getHours() * 60 + d.getMinutes();
    return a < b ? m >= a && m < b : m >= a || m < b;
}
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
export class Notifier {
    c;
    constructor(c) {
        this.c = c;
    }
    /**
     * Raise one event. The key is recorded first, so a repeat of the same key never sends twice, and an event the user has
     * switched off (or that fell in quiet hours) does not fire later for the same key. Resolves true when a notification went out.
     * `runId` is only for `ask`: with `notify.wakeOrchestrator` on, one line is typed into that run's coordinator terminal
     * (a nudge to the orchestrating agent, so it is not held back by the toggle or quiet hours).
     */
    async notify(event, key, title, body, runId) {
        const at = this.c.clock.now();
        const settings = readSettings(this.c); // before the key is recorded, so a failure here can never use a key up
        const ins = this.c.db.prepare('INSERT OR IGNORE INTO alert_sent(key, at) VALUES(?, ?)').run(key, at);
        if (Number(ins.changes) === 0)
            return false;
        if (event === 'ask' && runId && setting(settings, 'notify.wakeOrchestrator'))
            await this.wake(runId, title);
        if (!setting(settings, `notify.events.${event}`))
            return false;
        if (event !== 'ask' && setting(settings, 'notify.quietHours.enabled')
            && inQuietHours(at, setting(settings, 'notify.quietHours.from'), setting(settings, 'notify.quietHours.to')))
            return false;
        return this.send(title, body);
    }
    /** The Settings "Send a test" button: one notification now, ignoring the toggles, quiet hours and de-dupe. */
    async test() {
        if (!this.c.notify)
            return fail('conflict', 'notifications are not connected to Orca here', { code: 'no_host' });
        const sent = await this.send('MatrixKoder: test notification', 'If you can read this, MatrixKoder notifications work.');
        return sent ? { ok: true, sent: true } : fail('orca_failed', 'Orca did not accept the notification', { code: 'notify_failed' });
    }
    async send(title, body) {
        if (!this.c.notify)
            return false;
        try {
            await this.c.notify({ title: cut(title, 120), body: cut(body, 300) });
            return true;
        }
        catch (e) {
            this.c.log(`[notify] ${e.message}`);
            return false;
        }
    }
    async wake(runId, title) {
        const handle = coordinatorHandle(this.c, runId);
        if (!handle)
            return;
        const text = cut(`MatrixKoder: a question is waiting for the user: ${title}`.replace(CONTROL, ' '), 200);
        if (!safeToType([text]))
            return;
        const r = await runAction('terminal send', { terminal: handle, text, enter: true }, this.c.runner);
        if (!r.ok)
            this.c.log(`[notify] wake of ${handle} failed: ${r.error.message}`);
    }
}
