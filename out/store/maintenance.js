/**
 * Daily backup and the prune job (mk-data-schema.md §7).
 * Neither blocks writers: VACUUM INTO only reads (WAL), and each prune rule is its own short write transaction.
 * Never pruned: bug, todo, plan*, counter.
 */
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, tx } from './db.js';
const DAY = 86_400_000;
const KEEP_BACKUPS = 7;
const BACKUP_PREFIX = 'mk-data.db.bak-';
const day = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
/** Copy the database with VACUUM INTO once per UTC day; keep the newest 7. Returns the new file or null if one exists. */
export function backupIfDue(db, dir = dataDir(), at = Date.now()) {
    const target = join(dir, `${BACKUP_PREFIX}${day(at)}`);
    let made = null;
    if (!existsSync(target)) {
        const tmp = `${target}.tmp`;
        rmSync(tmp, { force: true });
        db.prepare('VACUUM INTO ?').run(tmp);
        renameSync(tmp, target);
        made = target;
    }
    const old = readdirSync(dir)
        .filter((f) => f.startsWith(BACKUP_PREFIX) && !f.endsWith('.tmp'))
        .sort()
        .reverse()
        .slice(KEEP_BACKUPS);
    for (const f of old)
        rmSync(join(dir, f), { force: true });
    return made;
}
const changes = (r) => Number(r.changes);
/** Apply every §7 rule. Returns rows deleted per rule. */
export function prune(db, at = Date.now()) {
    const out = {};
    const rule = (name, sql, ...params) => {
        out[name] = tx(db, () => changes(db.prepare(sql).run(...params)));
    };
    rule('event_log', 'DELETE FROM event_log WHERE id NOT IN (SELECT id FROM event_log ORDER BY at DESC, id DESC LIMIT 5000)');
    rule('decision_log.age', "DELETE FROM decision_log WHERE status <> 'pending' AND created_at < ?", at - 90 * DAY);
    rule('decision_log.max', `DELETE FROM decision_log WHERE status <> 'pending' AND id NOT IN
       (SELECT id FROM decision_log WHERE status <> 'pending' ORDER BY created_at DESC, id DESC LIMIT 2000)`);
    rule('lane_activity', `DELETE FROM lane_activity WHERE id IN
       (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY lane_id ORDER BY at DESC, id DESC) AS n FROM lane_activity)
         WHERE n > 50)`);
    rule('lane', 'DELETE FROM lane WHERE ended_at IS NOT NULL AND ended_at < ?', at - 30 * DAY);
    rule('pane', 'DELETE FROM pane WHERE gone_at IS NOT NULL AND gone_at < ?', at - 7 * DAY);
    const gone = at - 30 * DAY;
    rule('worktree', `DELETE FROM worktree WHERE gone_at IS NOT NULL AND gone_at < ?
       AND NOT EXISTS (SELECT 1 FROM lane WHERE lane.worktree_id = worktree.id)`, gone);
    rule('run', `DELETE FROM run WHERE gone_at IS NOT NULL AND gone_at < ?
       AND NOT EXISTS (SELECT 1 FROM plan WHERE plan.orca_run_id = run.id OR EXISTS (SELECT 1 FROM json_each(plan.past_run_ids) j WHERE j.value = run.id))
       AND NOT EXISTS (SELECT 1 FROM repo WHERE repo.bug_run_id = run.id)
       AND NOT EXISTS (SELECT 1 FROM plan_task WHERE plan_task.orca_run_id = run.id)
       AND NOT EXISTS (SELECT 1 FROM bug WHERE bug.orca_run_id = run.id)
       AND NOT EXISTS (SELECT 1 FROM decision_log WHERE decision_log.run_id = run.id)`, gone);
    rule('ask', `DELETE FROM ask WHERE gone_at IS NOT NULL AND gone_at < ?
       AND NOT EXISTS (SELECT 1 FROM decision_log WHERE decision_log.ask_id = ask.id)`, gone);
    rule('repo', `DELETE FROM repo WHERE gone_at IS NOT NULL AND gone_at < ?
       AND NOT EXISTS (SELECT 1 FROM plan WHERE plan.repo_id = repo.id)
       AND NOT EXISTS (SELECT 1 FROM bug WHERE bug.repo_id = repo.id)
       AND NOT EXISTS (SELECT 1 FROM todo WHERE todo.repo_id = repo.id)
       AND NOT EXISTS (SELECT 1 FROM decision_log WHERE decision_log.repo_id = repo.id)
       AND NOT EXISTS (SELECT 1 FROM inbox_file WHERE inbox_file.repo_id = repo.id AND inbox_file.status = 'imported')`, gone);
    rule('check_result.count', `DELETE FROM check_result WHERE id IN
       (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY orca_task_id, name ORDER BY at DESC, id DESC) AS n FROM check_result)
         WHERE n > 20)`);
    rule('check_result.age', `DELETE FROM check_result WHERE at < ? AND id NOT IN
       (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY orca_task_id ORDER BY at DESC, id DESC) AS n FROM check_result)
         WHERE n = 1)`, at - 30 * DAY);
    rule('plan_version', `DELETE FROM plan_version WHERE (plan_id, version) IN
       (SELECT plan_id, version FROM (SELECT v.plan_id, v.version,
                ROW_NUMBER() OVER (PARTITION BY v.plan_id ORDER BY v.version DESC) AS n, p.version AS cur
           FROM plan_version v JOIN plan p ON p.id = v.plan_id)
         WHERE n > 10 AND version <> cur)`);
    rule('alert_sent', 'DELETE FROM alert_sent WHERE at < ?', at - 30 * DAY);
    rule('inbox_file', "DELETE FROM inbox_file WHERE status IN ('deleted','missing') AND status_at < ?", at - 30 * DAY);
    return out;
}
/** Backup then prune, at most once per UTC day (kv 'maintenance.day'). Safe to call on every start. */
export function runMaintenance(db, dir = dataDir(), at = Date.now()) {
    const today = day(at);
    const last = db.prepare("SELECT value FROM kv WHERE key='maintenance.day'").get();
    if (last?.value === today)
        return null;
    const backup = backupIfDue(db, dir, at);
    const pruned = prune(db, at);
    tx(db, () => db
        .prepare("INSERT INTO kv(key, value, updated_at) VALUES('maintenance.day', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
        .run(today, at));
    return { backup, pruned };
}
