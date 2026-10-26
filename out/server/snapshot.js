/**
 * The C6 state snapshot, built only from mk-data.db (never a live Orca call), and the events API.
 *
 * Size rule (mk-data-schema.md §7): a response is always under 64 KB. The screens that are small are always sent in
 * full (projects, overview, lanes, waiting, settings); the heavy ones (plan, events, inbox, bugs, todo) are full only
 * for the requested screen and counts for the rest. If the result is still over the target, every list cap is halved
 * and the snapshot rebuilt, down to one row per list.
 */
import { all, one } from '../store/db.js';
import { defaultSettings, describeSettings, loadSettingsDetailed, setting } from '../store/settings.js';
import { templateStatuses } from '../store/spec-templates.js';
import { providerOf } from './providers.js';
import { cut, homeAbbrev, maybeNum, num, parseJson } from './common.js';
export const SCREENS = ['projects', 'overview', 'lanes', 'plan', 'waiting', 'events', 'inbox', 'bugs', 'todo', 'settings'];
export const SNAPSHOT_LIMIT = 64 * 1024;
const TARGET = 60_000;
const FULL_CAPS = { repos: 20, waiting: 8, lanes: 12, resolved: 10, tasks: 40, subs: 120, events: 30, inbox: 30, bugs: 40, todo: 40, text: 160 };
const scale = (c, f) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, k === 'text' ? Math.max(40, Math.floor(v * f)) : Math.max(1, Math.floor(v * f))]));
export function buildState(c, q = {}, info = { version: null }) {
    const screen = q.screen && SCREENS.includes(q.screen) ? q.screen : 'projects';
    let caps = FULL_CAPS;
    let out = {};
    for (let i = 0; i < 7; i++) {
        out = new Builder(c, q, screen, caps, info).build();
        if (Buffer.byteLength(JSON.stringify(out)) <= TARGET)
            return out;
        caps = scale(caps, 0.5);
    }
    // Last guard: the page is never sent over the limit. The settings values are the one block the caps cannot shrink.
    if (Buffer.byteLength(JSON.stringify(out)) > SNAPSHOT_LIMIT && out.settings && typeof out.settings === 'object') {
        const block = out.settings;
        const schema = Object.fromEntries(Object.entries((block.schema ?? {})).filter(([k]) => !k.startsWith('agents.')));
        out = { ...out, settings: { ...block, schema } };
        if (Buffer.byteLength(JSON.stringify(out)) > SNAPSHOT_LIMIT)
            out = { ...out, settings: { ...block, schema, values: {} } };
    }
    return out;
}
/** Keep only the keys the settings schema knows (agent ids are free, their fields are not), so a stray key in the file cannot grow the snapshot. */
function knownSettings(actual, known, isAgents = false) {
    if (known === null || typeof known !== 'object' || Array.isArray(known))
        return actual;
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual))
        return known;
    const a = actual;
    const k = known;
    const out = {};
    if (isAgents) {
        const shape = k.claude;
        for (const id of Object.keys(a).slice(0, 20))
            out[id] = knownSettings(a[id], shape);
        return out;
    }
    for (const key of Object.keys(k)) {
        if (key in a)
            out[key] = knownSettings(a[key], k[key], key === 'agents');
    }
    return out;
}
const ISO = (v) => v;
class Builder {
    c;
    q;
    screen;
    caps;
    info;
    db;
    at;
    repo;
    plan;
    settings = {};
    migrationNotes = [];
    constructor(c, q, screen, caps, info) {
        this.c = c;
        this.q = q;
        this.screen = screen;
        this.caps = caps;
        this.info = info;
        this.db = c.db;
        this.at = c.clock.now();
        try {
            const loaded = loadSettingsDetailed(c.dir);
            this.settings = loaded.settings;
            this.migrationNotes = loaded.migrationNotes;
        }
        catch (e) {
            this.settings = {};
            this.migrationNotes = [cut(`mk-settings.json was not used: ${e.message}`, 300)];
        }
        this.select();
    }
    // ---------------------------------------------------------------- selection
    select() {
        const { db } = this;
        const live = (id) => one(db, 'SELECT * FROM repo WHERE id = ? AND gone_at IS NULL', id);
        const active = setting(this.settings, 'general.activeRepo');
        this.repo =
            (this.q.repoId ? live(this.q.repoId) : undefined) ??
                (typeof active === 'string' ? live(active) : undefined) ??
                one(db, "SELECT r.* FROM repo r JOIN plan p ON p.repo_id = r.id WHERE r.gone_at IS NULL AND p.status = 'running' ORDER BY p.started_at DESC LIMIT 1") ??
                one(db, `SELECT r.* FROM repo r LEFT JOIN worktree w ON w.repo_id = r.id AND w.gone_at IS NULL WHERE r.gone_at IS NULL
          GROUP BY r.id ORDER BY MAX(w.last_activity_at) DESC, r.display_name LIMIT 1`);
        if (!this.repo)
            return;
        const rid = String(this.repo.id);
        this.plan =
            (this.q.planId !== undefined ? one(db, 'SELECT * FROM plan WHERE id = ? AND repo_id = ?', this.q.planId, rid) : undefined) ??
                one(db, "SELECT * FROM plan WHERE repo_id = ? AND status IN ('running','parked') ORDER BY started_at DESC LIMIT 1", rid) ??
                one(db, "SELECT * FROM plan WHERE repo_id = ? AND status <> 'archived' ORDER BY updated_at DESC LIMIT 1", rid);
    }
    get repoId() {
        return this.repo ? String(this.repo.id) : '';
    }
    // ---------------------------------------------------------------- top level
    build() {
        const heavy = (s) => this.screen === s;
        return {
            meta: this.meta(),
            badges: this.badges(),
            projects: this.projects(),
            overview: this.overview(),
            lanes: this.lanes(),
            plan: heavy('plan') ? this.planFull() : this.planCounts(),
            waiting: this.waiting(),
            events: heavy('events') ? this.events() : this.eventCounts(),
            inbox: heavy('inbox') ? this.inboxFull() : this.inboxCounts(),
            bugs: heavy('bugs') ? this.bugsFull() : this.bugCounts(),
            todo: heavy('todo') ? this.todoFull() : this.todoCounts(),
            settings: this.settingsBlock(),
        };
    }
    meta() {
        const rows = all(this.db, 'SELECT source, last_ok_at, last_error FROM sync_state');
        const age = (r) => (r && r.last_ok_at !== null ? Math.max(0, this.at - Number(r.last_ok_at)) : null);
        const by = new Map(rows.map((r) => [String(r.source), r]));
        const worst = (prefix) => {
            const ages = rows.filter((r) => String(r.source).startsWith(prefix)).map(age);
            if (ages.length === 0)
                return null;
            return ages.some((a) => a === null) ? null : Math.max(...ages);
        };
        const orchestration = [worst('tasks:'), worst('workers:'), worst('gates:'), age(by.get('inbox')), age(by.get('runs'))].filter((a) => a !== null);
        const errors = {};
        for (const r of rows)
            if (r.last_error !== null && Object.keys(errors).length < 8)
                errors[String(r.source)] = cut(r.last_error, 120);
        const ps = by.get('ps');
        return {
            schema: 1,
            at: this.at,
            orca: one(this.db, "SELECT value FROM kv WHERE key = 'orca.version'")?.value ?? null,
            runtimeOk: !!ps && ps.last_ok_at !== null && ps.last_error === null,
            repoId: this.repo ? String(this.repo.id) : null,
            planId: this.plan ? Number(this.plan.id) : null,
            runId: this.plan?.orca_run_id ?? null,
            screen: this.screen,
            stale: {
                ps: age(by.get('ps')),
                terminals: age(by.get('terminals')),
                repos: age(by.get('repos')),
                runs: age(by.get('runs')),
                orchestration: orchestration.length ? Math.max(...orchestration) : null,
                inbox: age(by.get('inbox')),
                git: age(by.get('git')),
                quota: age(by.get('quota')),
                files: age(by.get('files')),
            },
            errors,
        };
    }
    pendingAsks(repoOnly) {
        return all(this.db, `SELECT a.*, r.repo_id AS run_repo FROM ask a LEFT JOIN run r ON r.id = a.run_id
        WHERE a.orca_status = 'pending' AND a.gone_at IS NULL AND (a.snoozed_until IS NULL OR a.snoozed_until < ?)
          AND NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.ask_id = a.id AND d.status = 'pending')
        ${repoOnly ? 'AND (r.repo_id = ? OR r.repo_id IS NULL)' : ''} ORDER BY a.asked_at`, ...(repoOnly ? [this.at, this.repoId] : [this.at]));
    }
    badges() {
        const n = (sql, ...p) => num(one(this.db, sql, ...p)?.n);
        const rid = this.repoId;
        return {
            lanes: n("SELECT COUNT(*) AS n FROM lane WHERE repo_id = ? AND ended_at IS NULL AND state IN ('working','waiting','blocked')", rid),
            waiting: this.pendingAsks(true).length,
            inbox: n("SELECT COUNT(*) AS n FROM inbox_file WHERE repo_id = ? AND status IN ('new','changed')", rid),
            bugs: n("SELECT COUNT(*) AS n FROM bug WHERE repo_id = ? AND status IN ('open','fixing','waiting')", rid),
        };
    }
    // ---------------------------------------------------------------- shared lookups
    laneFor(a) {
        return one(this.db, `SELECT label, agent FROM lane WHERE (dispatch_id IS NOT NULL AND dispatch_id = ?) OR (orca_task_id IS NOT NULL AND orca_task_id = ?)
        ORDER BY ended_at IS NULL DESC, last_seen_at DESC LIMIT 1`, a.dispatch_id === null || a.dispatch_id === undefined ? '' : String(a.dispatch_id), a.orca_task_id === null || a.orca_task_id === undefined ? '' : String(a.orca_task_id));
    }
    ownerOf(orcaTaskId) {
        if (orcaTaskId === null || orcaTaskId === undefined)
            return { task: null, plan: null };
        const o = one(this.db, 'SELECT owner_kind, owner_id FROM v_orca_task_owner WHERE orca_task_id = ? ORDER BY is_current DESC LIMIT 1', String(orcaTaskId));
        if (!o)
            return { task: null, plan: null };
        if (o.owner_kind === 'bug')
            return { task: String(o.owner_id), plan: null };
        const t = one(this.db, 'SELECT t.code, p.title FROM plan_task t JOIN plan p ON p.id = t.plan_id WHERE t.id = ?', Number(o.owner_id));
        return { task: t ? String(t.code) : null, plan: t ? String(t.title) : null };
    }
    askRow(a) {
        const lane = this.laneFor(a);
        const own = this.ownerOf(a.orca_task_id);
        const repo = a.run_repo ? one(this.db, 'SELECT display_name FROM repo WHERE id = ?', String(a.run_repo)) : undefined;
        return {
            id: String(a.id),
            kind: String(a.kind),
            title: cut(a.title, this.caps.text),
            body: cut(a.body, 600),
            rec: a.recommendation ? cut(a.recommendation, 300) : '',
            options: parseJson(a.options, []).slice(0, 8).map((o) => cut(o, 80)),
            runId: String(a.run_id),
            lane: lane ? String(lane.label) : null,
            agent: lane?.agent ? String(lane.agent) : null,
            task: own.task,
            plan: own.plan,
            repo: repo ? String(repo.display_name) : null,
            ageMs: Math.max(0, this.at - Number(a.asked_at)),
        };
    }
    // ---------------------------------------------------------------- projects
    projects() {
        const { db } = this;
        const repos = all(db, `SELECT r.*, (SELECT MAX(last_activity_at) FROM worktree w WHERE w.repo_id = r.id AND w.gone_at IS NULL) AS act
         FROM repo r WHERE r.gone_at IS NULL ORDER BY act DESC, r.display_name`);
        const asks = this.pendingAsks(false);
        const lanesLive = num(one(db, "SELECT COUNT(*) AS n FROM lane WHERE ended_at IS NULL AND state IN ('working','waiting','blocked')")?.n);
        const activeIds = new Set(all(db, "SELECT DISTINCT repo_id AS r FROM plan WHERE status = 'running' UNION SELECT DISTINCT repo_id FROM lane WHERE ended_at IS NULL AND state IN ('working','waiting','blocked')").map((r) => String(r.r)));
        const machine = one(db, "SELECT value FROM kv WHERE key = 'host.machine_name'")?.value;
        return {
            machine: machine ? String(machine) : 'this Mac',
            active: repos.filter((r) => activeIds.has(String(r.id))).length,
            total: repos.length,
            lanesLive,
            waiting: asks.length,
            waitingList: asks.slice(0, this.caps.waiting).map((a) => this.askRow(a)),
            repos: repos.slice(0, this.caps.repos).map((r) => this.repoCard(r)),
        };
    }
    repoCard(r) {
        const { db } = this;
        const id = String(r.id);
        const wts = num(one(db, 'SELECT COUNT(*) AS n FROM worktree WHERE repo_id = ? AND gone_at IS NULL', id)?.n);
        const idle = num(one(db, "SELECT COUNT(*) AS n FROM worktree WHERE repo_id = ? AND gone_at IS NULL AND status = 'inactive'", id)?.n);
        const plans = all(db, "SELECT * FROM plan WHERE repo_id = ? AND status <> 'archived' ORDER BY updated_at DESC LIMIT 5", id).map((p) => this.planSummary(p));
        return {
            id, name: cut(r.display_name, 80), path: homeAbbrev(String(r.path)), worktrees: wts, idleWorktrees: idle,
            lastActivityAt: maybeNum(r.act), plans,
        };
    }
    waves(planId) {
        const phases = all(this.db, 'SELECT * FROM v_phase WHERE plan_id = ? ORDER BY wave, ord', planId);
        const waves = [...new Set(phases.map((p) => Number(p.wave)))].sort((a, b) => a - b);
        const open = phases.find((p) => p.status !== 'done');
        return {
            list: phases.slice(0, 12).map((p) => ({ code: String(p.code), title: cut(p.title, 80), wave: Number(p.wave), done: num(p.done), total: num(p.total), status: String(p.status) })),
            current: open ? waves.indexOf(Number(open.wave)) + 1 : waves.length,
            total: waves.length,
        };
    }
    stage(p, done, total) {
        const started = num(one(this.db, 'SELECT COUNT(*) AS n FROM plan_task WHERE plan_id = ? AND dropped_at IS NULL AND orca_task_id IS NOT NULL', Number(p.id))?.n) > 0;
        let stage = 'plan';
        if (p.merged_at)
            stage = 'done';
        else if (total > 0 && done === total) {
            const checks = all(this.db, `SELECT status FROM (SELECT status, ROW_NUMBER() OVER (PARTITION BY orca_task_id, name ORDER BY at DESC, id DESC) AS n FROM check_result WHERE orca_task_id IN
        (SELECT orca_task_id FROM plan_task WHERE plan_id = ? AND orca_task_id IS NOT NULL)) WHERE n = 1`, Number(p.id));
            stage = checks.length > 0 && checks.every((r) => r.status === 'passed' || r.status === 'skipped') ? 'merge' : 'verify';
        }
        else if (started)
            stage = 'build';
        const checked = num(one(this.db, `SELECT COUNT(DISTINCT orca_task_id) AS n FROM check_result WHERE status = 'passed' AND orca_task_id IN (SELECT orca_task_id FROM plan_task WHERE plan_id = ?)`, Number(p.id))?.n);
        return { stage, progress: { plan: 1, build: total ? done / total : 0, verify: total ? Math.min(1, checked / total) : 0, merge: p.merged_at ? 1 : 0 } };
    }
    planSummary(p) {
        const cnt = one(this.db, 'SELECT * FROM v_plan_counts WHERE plan_id = ?', Number(p.id));
        const done = num(cnt?.tasks_done);
        const total = num(cnt?.tasks);
        const w = this.waves(Number(p.id));
        const run = p.orca_run_id ? String(p.orca_run_id) : '';
        return {
            id: Number(p.id), slug: String(p.slug), title: cut(p.title, 100), status: String(p.status), stage: this.stage(p, done, total).stage,
            wave: [w.current, w.total], tasks: [done, total],
            lanes: run ? num(one(this.db, "SELECT COUNT(*) AS n FROM lane WHERE run_id = ? AND ended_at IS NULL AND state IN ('working','waiting','blocked')", run)?.n) : 0,
            waiting: run ? num(one(this.db, "SELECT COUNT(*) AS n FROM ask WHERE run_id = ? AND orca_status = 'pending' AND gone_at IS NULL", run)?.n) : 0,
            pr: p.pr_number ?? null, runLastState: p.run_last_state ?? null,
        };
    }
    // ---------------------------------------------------------------- overview, lanes
    overview() {
        const p = this.plan;
        if (!p)
            return { plan: null, plans: [], needsYou: this.pendingAsks(true).length };
        const s = this.planSummary(p);
        const [done, total] = s.tasks;
        const st = this.stage(p, done, total);
        const w = this.waves(Number(p.id));
        const bus = one(this.db, "SELECT ref, at FROM event_log WHERE kind = 'bus' ORDER BY id DESC LIMIT 1");
        const asks = this.pendingAsks(true);
        return {
            plan: { id: Number(p.id), slug: String(p.slug), title: cut(p.title, 100), status: String(p.status) },
            plans: all(this.db, "SELECT id, title FROM plan WHERE repo_id = ? AND status <> 'archived' ORDER BY updated_at DESC LIMIT 10", this.repoId).map((x) => ({ id: Number(x.id), title: cut(x.title, 80) })),
            stage: st.stage, stageProgress: st.progress, wave: s.wave, lanesLive: s.lanes, tasks: s.tasks, needsYou: asks.length,
            bus: bus ? { id: String(bus.ref ?? '').replace(/^msg:/, ''), at: Number(bus.at) } : null,
            decision: asks[0] ? this.askRow(asks[0]) : null,
            waves: w.list,
        };
    }
    lanes() {
        const { db } = this;
        const rows = all(db, `SELECT l.*, w.branch, w.head, w.path, w.git_base_ref, w.git_ahead, w.git_files, w.git_added, w.git_removed, w.git_at, p.turns
         FROM lane l LEFT JOIN worktree w ON w.id = l.worktree_id LEFT JOIN pane p ON p.pane_key = l.pane_key
        WHERE l.repo_id = ? AND (l.ended_at IS NULL OR l.ended_at > ?)
        ORDER BY (l.ended_at IS NULL) DESC, l.state_at DESC LIMIT ?`, this.repoId, this.at - 3_600_000, this.caps.lanes);
        return rows.map((l) => {
            const t = l.orca_task_id ? one(db, 'SELECT t.id, t.code, t.title, ph.wave FROM plan_task t JOIN plan_phase ph ON ph.id = t.phase_id WHERE t.orca_task_id = ?', String(l.orca_task_id)) : undefined;
            const ask = one(db, "SELECT id FROM ask WHERE orca_status = 'pending' AND gone_at IS NULL AND ((dispatch_id IS NOT NULL AND dispatch_id = ?) OR (orca_task_id IS NOT NULL AND orca_task_id = ?)) LIMIT 1", String(l.dispatch_id ?? ''), String(l.orca_task_id ?? ''));
            return {
                id: Number(l.id), label: String(l.label), kind: String(l.kind), dispatchId: l.dispatch_id ?? null, paneKey: l.pane_key ?? null,
                worktreeId: l.worktree_id ?? null, terminalHandle: l.terminal_handle ?? null, agent: l.agent ?? null, model: l.model ?? null, effort: l.effort ?? null,
                branch: l.branch ?? null, head: l.head ?? null, path: l.path ? homeAbbrev(String(l.path)) : null,
                state: String(l.state), phase: l.phase ?? null, turns: num(l.turns), startedAt: ISO(maybeNum(l.started_at)),
                task: t ? { id: String(t.code), planTaskId: Number(t.id), title: cut(t.title, this.caps.text), wave: Number(t.wave), orcaTaskId: l.orca_task_id } : l.orca_task_id ? { id: null, orcaTaskId: l.orca_task_id } : null,
                git: l.git_at === null ? null : { ahead: num(l.git_ahead), files: num(l.git_files), added: num(l.git_added), removed: num(l.git_removed), baseRef: l.git_base_ref ?? null, at: Number(l.git_at) },
                checks: l.orca_task_id
                    ? all(db, `SELECT name, status, passed, total, at FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY name ORDER BY at DESC, id DESC) AS n FROM check_result WHERE orca_task_id = ?) WHERE n = 1`, String(l.orca_task_id)).map((c) => ({ ...c }))
                    : [],
                activity: all(db, 'SELECT at, kind, text FROM lane_activity WHERE lane_id = ? ORDER BY at DESC, id DESC LIMIT 5', Number(l.id)).map((x) => ({ at: Number(x.at), kind: String(x.kind), text: cut(x.text, 120) })),
                askId: ask ? String(ask.id) : null,
            };
        });
    }
    // ---------------------------------------------------------------- plan
    planCounts() {
        const p = this.plan;
        if (!p)
            return { id: null, total: 0, done: 0, subtasks: 0 };
        const cnt = one(this.db, 'SELECT * FROM v_plan_counts WHERE plan_id = ?', Number(p.id));
        return { id: Number(p.id), title: cut(p.title, 100), status: String(p.status), done: num(cnt?.tasks_done), total: num(cnt?.tasks), subtasks: num(cnt?.subtasks), phases: num(cnt?.phases) };
    }
    planFull() {
        const p = this.plan;
        if (!p)
            return { id: null, phases: [] };
        const { db } = this;
        const head = this.planCounts();
        const phases = all(db, 'SELECT * FROM v_phase WHERE plan_id = ? ORDER BY wave, ord', Number(p.id));
        const asks = new Set(all(db, "SELECT orca_task_id AS t FROM ask WHERE orca_status = 'pending' AND gone_at IS NULL AND orca_task_id IS NOT NULL").map((r) => String(r.t)));
        let taskBudget = this.caps.tasks;
        let subBudget = this.caps.subs;
        let truncated = false;
        const out = phases.map((ph) => {
            const tasks = all(db, 'SELECT * FROM plan_task WHERE phase_id = ? AND dropped_at IS NULL ORDER BY ord', Number(ph.phase_id));
            const shown = tasks.slice(0, Math.max(0, taskBudget));
            if (shown.length < tasks.length)
                truncated = true;
            taskBudget -= shown.length;
            return {
                id: Number(ph.phase_id), code: String(ph.code), title: cut(ph.title, 80), wave: Number(ph.wave), status: String(ph.status), done: num(ph.done), total: num(ph.total),
                tasks: shown.map((t) => {
                    const lane = t.orca_task_id ? one(db, 'SELECT label, agent FROM lane WHERE orca_task_id = ? ORDER BY ended_at IS NULL DESC, last_seen_at DESC LIMIT 1', String(t.orca_task_id)) : undefined;
                    const turns = lane ? num(one(db, 'SELECT p.turns FROM lane l JOIN pane p ON p.pane_key = l.pane_key WHERE l.orca_task_id = ? LIMIT 1', String(t.orca_task_id))?.turns) : 0;
                    const deps = parseJson(t.deps, []);
                    const after = t.status === 'blocked' ? deps[0] ?? null : null;
                    let meta = 'no lane yet';
                    if (lane)
                        meta = `${lane.label}${lane.agent ? ` ${lane.agent}` : ''}${turns ? ` · turn ${turns}` : ''}`;
                    else if (t.status === 'done')
                        meta = 'done';
                    else if (t.status === 'pending')
                        meta = `waits for wave ${ph.wave}`;
                    else if (t.origin === 'todo')
                        meta = 'from a to-do';
                    const subsAll = all(db, 'SELECT code, title, status, note FROM plan_subtask WHERE task_id = ? AND dropped_at IS NULL ORDER BY ord', Number(t.id));
                    const subs = subsAll.slice(0, Math.max(0, subBudget));
                    if (subs.length < subsAll.length)
                        truncated = true;
                    subBudget -= subs.length;
                    const asking = t.orca_task_id !== null && asks.has(String(t.orca_task_id));
                    return {
                        id: Number(t.id), code: String(t.code), title: cut(t.title, this.caps.text), status: String(t.status), attempts: num(t.attempts), lastState: t.last_state ?? null,
                        meta, after, specDrift: num(t.spec_drift) === 1, orcaTaskId: t.orca_task_id ?? null,
                        subs: subs.map((s) => [String(s.code), cut(s.title, 100), String(s.status), s.status === 'working' && asking ? 'decide' : cut(s.note, 40)]),
                    };
                }),
            };
        });
        return { ...head, slug: String(p.slug), version: num(p.version), orcaRunId: p.orca_run_id ?? null, runLastState: p.run_last_state ?? null, mergedAt: maybeNum(p.merged_at), phases: out, truncated };
    }
    // ---------------------------------------------------------------- waiting
    waiting() {
        const { db } = this;
        const open = this.pendingAsks(true);
        const pendingDecisions = all(db, "SELECT * FROM decision_log WHERE status = 'pending' ORDER BY id DESC LIMIT 10");
        const since = this.at - 86_400_000;
        const sent = all(db, "SELECT * FROM decision_log WHERE status = 'sent' AND sent_at > ? ORDER BY sent_at DESC LIMIT ?", since, this.caps.resolved);
        const sentAsks = new Set(sent.map((d) => String(d.ask_id)));
        const orcaResolved = all(db, "SELECT * FROM ask WHERE orca_status IN ('resolved','answered') AND resolved_at > ? ORDER BY resolved_at DESC LIMIT ?", since, this.caps.resolved)
            .filter((a) => !sentAsks.has(String(a.id)));
        const label = (d) => (d.action === 'approve' ? 'Approved' : d.action === 'rework' ? `Rework: ${cut(String(d.answer ?? '').replace(/^rework:\s*/, ''), 60)}` : `Answered: ${cut(d.answer, 60)}`);
        const resolved = [
            ...pendingDecisions.map((d) => ({ decisionId: Number(d.id), askId: d.ask_id, title: cut(d.title, 100), outcome: label(d), src: 'you · waiting to send', at: Number(d.created_at), canUndo: Number(d.commit_at) > this.at, undoUntil: maybeNum(d.commit_at) })),
            ...sent.map((d) => ({ decisionId: Number(d.id), askId: d.ask_id, title: cut(d.title, 100), outcome: label(d), src: `you · ${new Date(Number(d.sent_at)).toISOString().slice(11, 16)}`, at: Number(d.sent_at), canUndo: false, undoUntil: null })),
            ...orcaResolved.map((a) => ({ decisionId: null, askId: String(a.id), title: cut(a.title, 100), outcome: a.resolution ? cut(a.resolution, 60) : 'Answered', src: 'orchestrator', at: Number(a.resolved_at), canUndo: false, undoUntil: null })),
        ]
            .sort((x, y) => Number(y.at) - Number(x.at))
            .slice(0, this.caps.resolved);
        return {
            total: open.length,
            blocking: open.filter((a) => a.kind === 'gate').length,
            questions: open.filter((a) => a.kind === 'question').length,
            open: open.slice(0, this.caps.waiting).map((a) => this.askRow(a)),
            resolved,
        };
    }
    // ---------------------------------------------------------------- events
    eventRows(before, limit) {
        return all(this.db, `SELECT id, at, kind, text, src FROM event_log ${before !== undefined ? 'WHERE id < ?' : ''} ORDER BY id DESC LIMIT ?`, ...(before !== undefined ? [before, limit] : [limit])).map((e) => ({
            id: Number(e.id), at: Number(e.at), kind: String(e.kind), text: cut(e.text, this.caps.text), src: e.src === null ? null : cut(e.src, 80), payloadRef: Number(e.id),
        }));
    }
    eventCounts() {
        const r = one(this.db, 'SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM event_log');
        return { cursor: num(r?.m), count: num(r?.n) };
    }
    events() {
        const rows = this.eventRows(undefined, this.caps.events);
        const c = this.eventCounts();
        return { ...c, rows, hasMore: rows.length > 0 && num(c.count) > rows.length };
    }
    // ---------------------------------------------------------------- inbox, bugs, todo
    inboxCounts() {
        const n = (s) => num(one(this.db, 'SELECT COUNT(*) AS n FROM inbox_file WHERE repo_id = ? AND status = ?', this.repoId, s)?.n);
        return { new: n('new') + n('changed'), imported: n('imported'), archived: n('archived') };
    }
    /** `plans.inboxDir`, relative to the repo root. */
    inboxRel() {
        return setting(this.settings, 'plans.inboxDir');
    }
    inboxFull() {
        const rows = all(this.db, `SELECT f.*, p.slug AS plan_slug FROM inbox_file f LEFT JOIN plan p ON p.id = f.plan_id
        WHERE f.repo_id = ? AND f.status IN ('new','changed','imported') ORDER BY f.mtime DESC LIMIT ?`, this.repoId, this.caps.inbox);
        return {
            ...this.inboxCounts(),
            dir: this.repo ? `${homeAbbrev(String(this.repo.path))}/${this.inboxRel()}` : null,
            files: rows.map((f) => ({
                id: Number(f.id), name: String(f.name), title: f.title === null ? null : cut(f.title, 120), editedAt: Number(f.mtime), check: String(f.fit),
                missing: parseJson(f.missing, []).slice(0, 8).map((m) => cut(m, 80)), state: String(f.status), planId: f.plan_id ?? null, planSlug: f.plan_slug ?? null,
            })),
        };
    }
    bugCounts() {
        const total = num(one(this.db, 'SELECT COUNT(*) AS n FROM bug WHERE repo_id = ?', this.repoId)?.n);
        const need = num(one(this.db, "SELECT COUNT(*) AS n FROM bug WHERE repo_id = ? AND status IN ('open','fixing','waiting')", this.repoId)?.n);
        return { total, needWork: need };
    }
    bugsFull() {
        const offset = Math.max(0, this.q.offset ?? 0);
        const limit = Math.min(this.caps.bugs, this.q.limit ?? this.caps.bugs);
        const rows = all(this.db, `SELECT b.*, (SELECT label FROM lane l WHERE l.orca_task_id = b.orca_task_id ORDER BY l.ended_at IS NULL DESC, l.last_seen_at DESC LIMIT 1) AS lane
         FROM bug b WHERE b.repo_id = ? ORDER BY b.created_at DESC, b.id DESC LIMIT ? OFFSET ?`, this.repoId, limit, offset);
        const counts = this.bugCounts();
        return {
            ...counts, offset, hasMore: offset + rows.length < num(counts.total),
            rows: rows.map((b) => ({
                id: String(b.id), title: cut(b.title, this.caps.text), where: b.file ? `${cut(b.file, 100)}${b.line ? `:${b.line}` : ''}` : null, risk: num(b.risk), status: String(b.status),
                lane: b.lane ?? null, attempts: num(b.attempts), lastState: b.last_state ?? null, reportedBy: String(b.reported_by), createdAt: Number(b.created_at),
            })),
        };
    }
    todoCounts() {
        const n = (d) => num(one(this.db, 'SELECT COUNT(*) AS n FROM todo WHERE repo_id = ? AND done = ?', this.repoId, d)?.n);
        return { open: n(0), done: n(1) };
    }
    todoFull() {
        const offset = Math.max(0, this.q.offset ?? 0);
        const limit = Math.min(this.caps.todo, this.q.limit ?? this.caps.todo);
        const rows = all(this.db, 'SELECT * FROM todo WHERE repo_id = ? ORDER BY done, grp, sort, id LIMIT ? OFFSET ?', this.repoId, limit, offset);
        const counts = this.todoCounts();
        return {
            ...counts, offset, hasMore: offset + rows.length < num(counts.open) + num(counts.done),
            rows: rows.map((t) => ({ id: Number(t.id), text: cut(t.text, this.caps.text), group: String(t.grp), done: num(t.done) === 1, link: this.todoLink(t) })),
        };
    }
    todoLink(t) {
        if (t.link_kind === null)
            return null;
        const ref = String(t.link_ref);
        if (t.link_kind === 'bug')
            return { kind: 'bug', ref, label: ref };
        if (t.link_kind === 'task') {
            const x = one(this.db, 'SELECT t.code, p.title FROM plan_task t JOIN plan p ON p.id = t.plan_id WHERE t.id = ?', Number(ref));
            return x ? { kind: 'task', ref, label: `${x.code} · ${cut(x.title, 40)}` } : null;
        }
        const x = one(this.db, 'SELECT title FROM plan_phase WHERE id = ?', Number(ref));
        return x ? { kind: 'phase', ref, label: cut(x.title, 40) } : null;
    }
    // ---------------------------------------------------------------- settings
    settingsBlock() {
        const quota = all(this.db, 'SELECT * FROM quota');
        const clis = all(this.db, 'SELECT * FROM agent_cli ORDER BY agent_id');
        return {
            values: knownSettings(this.settings, defaultSettings()),
            schema: describeSettings(this.settings),
            migrationNotes: this.migrationNotes.slice(0, 40).map((n) => cut(n, 200)),
            lastScreen: one(this.db, "SELECT value FROM kv WHERE key = 'panel.lastScreen'")?.value ?? null,
            specTemplates: templateStatuses(this.settings, { dir: this.c.dir, repoPath: String(this.repo?.path ?? '') }),
            agents: clis.map((a) => ({
                id: String(a.agent_id), found: num(a.found) === 1, cli: a.cli_path ?? null, version: a.version ?? null,
                quota: quota.filter((q) => q.provider === providerOf(String(a.agent_id))).map((q) => ({
                    label: q.win === 'session' ? (q.window_minutes === 300 ? '5h window' : 'Session') : q.win === 'weekly' ? 'Weekly' : 'Monthly',
                    leftPct: q.used_percent === null ? null : Math.max(0, Math.round(100 - Number(q.used_percent))), resetsAt: maybeNum(q.resets_at),
                    note: q.error ? cut(q.error, 80) : null,
                })),
            })),
            baseBranch: this.repo?.base_ref ?? 'main',
            dataDir: homeAbbrev(this.c.dir),
            inboxDir: this.repo ? `${homeAbbrev(String(this.repo.path))}/${this.inboxRel()}` : null,
            version: this.info.version,
        };
    }
}
// ---------------------------------------------------------------- events API
export function eventsPage(c, q) {
    const limit = Math.min(100, Math.max(1, q.limit ?? 50));
    const rows = all(c.db, `SELECT id, at, kind, text, src FROM event_log ${q.before !== undefined ? 'WHERE id < ?' : ''} ORDER BY id DESC LIMIT ?`, ...(q.before !== undefined ? [q.before, limit] : [limit])).map((e) => ({
        id: Number(e.id), at: Number(e.at), kind: String(e.kind), text: String(e.text), src: e.src ?? null, payloadRef: Number(e.id),
    }));
    const last = rows.length ? Number(rows[rows.length - 1].id) : null;
    const more = last !== null && num(one(c.db, 'SELECT COUNT(*) AS n FROM event_log WHERE id < ?', last)?.n) > 0;
    return { rows, next: more ? last : null };
}
export function eventDetail(c, id) {
    const e = one(c.db, 'SELECT * FROM event_log WHERE id = ?', id);
    if (!e)
        return null;
    return { id: Number(e.id), at: Number(e.at), kind: String(e.kind), text: String(e.text), src: e.src ?? null, ref: e.ref ?? null, repoId: e.repo_id ?? null, payload: e.payload === null ? null : parseJson(e.payload, null) };
}
