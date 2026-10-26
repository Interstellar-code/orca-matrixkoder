/**
 * Plan import from `<repo>/.matrixkoder/inbox/*.md` into mk-data.db (mk-data-schema.md §6).
 *
 *   scanInbox   sets inbox_file status and fit (pass | partial | not_a_plan) for every plan file on disk.
 *   importFile  loads plan, plan_version, plan_phase, plan_task, plan_subtask and plan_item rows, then moves the
 *               file to inbox/archive/. A changed file for a plan that already exists is a RE-import:
 *               - plan `imported` (no run yet): the structure is rebuilt, version + 1;
 *               - plan `running` or `parked`: merged by `code` under column ownership, so a started task keeps
 *                 orca_task_id, attempts, past_task_ids, status, last_state*, started_at and done_at (hazard K14).
 *               Orca is never called. The whole import is one BEGIN IMMEDIATE transaction; a failed file move rolls it back.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { all, now, one, tx, type Db, type Row } from './db.js';
import { checkRoute } from './routes-check.js';
import { defaultSettings, setting, type Settings } from './settings.js';
import { parsePlan, type Fit, type ParsedPhase, type ParsedPlan, type ParsedTask, type ParseResult } from './plan-parse.js';

export class ImportError extends Error {
  constructor(message: string, public conflicts: string[] = []) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface InboxTarget {
  repoId: string;
  /** Repo checkout; the inbox is `<repoPath>/<plans.inboxDir>` (default `.matrixkoder/inbox`). */
  repoPath: string;
  /** The user's settings: `plans.inboxDir` and the agents the route check (C9) accepts. Default: `defaultSettings()`. */
  settings?: Settings;
}

const DEFAULT_INBOX_DIR = '.matrixkoder/inbox';
const settingsOf = (t: InboxTarget): Settings => t.settings ?? defaultSettings();

/**
 * Where a target's inbox is. `folder` is the directory on disk; `prefix` starts every inbox_file.path of this folder
 * ("inbox" for the default folder, as before, otherwise the folder itself), so rows made under an older `plans.inboxDir`
 * keep their own prefix and a scan of the new folder leaves them alone.
 */
export function inboxPlace(t: InboxTarget): { folder: string; prefix: string } {
  const dir = setting<string>(settingsOf(t), 'plans.inboxDir').replace(/^(\.\/)+/, '').replace(/\/+$/, '') || DEFAULT_INBOX_DIR;
  const prefix = dir === DEFAULT_INBOX_DIR ? 'inbox' : dir === 'inbox' ? './inbox' : dir;
  return { folder: join(t.repoPath, dir), prefix };
}

/** The disk path of an inbox_file.path of this folder (`<prefix>/x.md`, `<prefix>/archive/x.md`). */
const diskPath = (t: InboxTarget, path: string): string => join(inboxPlace(t).folder, path.slice(inboxPlace(t).prefix.length + 1));

export interface ImportResult {
  action: 'created' | 'replaced' | 'merged' | 'noop';
  planId: number;
  version: number;
  note: string;
  /** inbox_file.path after the import (inbox/archive/<name> unless the import was a no-op). */
  path: string;
}

const MAX_BYTES = 1024 * 1024;
const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const J = (v: unknown): string => JSON.stringify(v);

// ---------------------------------------------------------------- scanning the inbox

interface Read {
  sha: string;
  size: number;
  mtime: number;
  text: string;
  parsed: ParseResult;
}

/** C9: a task or phase route the settings do not accept makes a `pass` plan `partial`, with the reason in `missing[]`. */
function checkPlanRoutes(r: ParseResult, settings: Settings): ParseResult {
  if (!r.plan) return r;
  const issues: string[] = [];
  const check = (who: string, field: string, text: string): void => {
    const c = checkRoute(text, settings);
    if (!c.ok) issues.push(`${who}: ${field} "${text}": ${c.issue}`);
  };
  for (const ph of r.plan.phases) {
    check(`phase ${ph.code}`, 'route', ph.route);
    check(`phase ${ph.code}`, 'reviewer', ph.reviewer);
    for (const t of ph.tasks) check(`task ${t.code}`, 'route', t.route);
  }
  if (issues.length === 0) return r;
  return { ...r, fit: r.fit === 'pass' ? 'partial' : r.fit, missing: [...r.missing, ...issues] };
}

function readPlanFile(full: string, settings: Settings): Read {
  const st = statSync(full);
  if (st.size > MAX_BYTES) {
    return { sha: '', size: st.size, mtime: Math.floor(st.mtimeMs), text: '', parsed: { fit: 'not_a_plan', missing: ['file is over 1 MB'], slug: null, title: null, plan: null } };
  }
  const buf = readFileSync(full);
  const text = buf.toString('utf8');
  return { sha: sha256(buf), size: st.size, mtime: Math.floor(st.mtimeMs), text, parsed: checkPlanRoutes(parsePlan(text), settings) };
}

function currentSha(db: Db, planId: number, version: number): string | null {
  const r = one(db, 'SELECT source_sha FROM plan_version WHERE plan_id = ? AND version = ?', planId, version);
  return r ? String(r.source_sha) : null;
}

function syncFile(db: Db, t: InboxTarget, archive: boolean, name: string, at: number): void {
  const path = `${inboxPlace(t).prefix}/${archive ? 'archive/' : ''}${name}`;
  const r = readPlanFile(diskPath(t, path), settingsOf(t));
  const plan = r.parsed.slug ? one(db, 'SELECT id, version FROM plan WHERE repo_id = ? AND slug = ?', t.repoId, r.parsed.slug) : undefined;
  const row = one(db, 'SELECT * FROM inbox_file WHERE repo_id = ? AND path = ?', t.repoId, path);

  let status: string;
  let planId: number | null = null;
  let planVersion: number | null = null;
  if (archive) {
    status = row && row.status === 'imported' ? 'imported' : 'archived';
    if (row && row.status === 'imported') {
      planId = row.plan_id as number | null;
      planVersion = row.plan_version as number | null;
    }
  } else if (plan && currentSha(db, Number(plan.id), Number(plan.version)) === r.sha) {
    status = 'imported'; // this exact text is already the plan's current version
    planId = Number(plan.id);
    planVersion = Number(plan.version);
  } else {
    status = plan ? 'changed' : 'new';
    planId = plan ? Number(plan.id) : null;
  }

  if (!row) {
    db.prepare(
      `INSERT INTO inbox_file(repo_id, path, name, slug, title, sha, size, mtime, fit, missing, status, plan_id, plan_version, first_seen_at, status_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(t.repoId, path, name, r.parsed.slug, r.parsed.title, r.sha, r.size, r.mtime, r.parsed.fit, J(r.parsed.missing), status, planId, planVersion, at, at);
    return;
  }
  const keep = row.status === status;
  db.prepare(
    `UPDATE inbox_file SET slug=?, title=?, sha=?, size=?, mtime=?, fit=?, missing=?, status=?, plan_id=?, plan_version=?, status_at=? WHERE id=?`,
  ).run(
    r.parsed.slug, r.parsed.title, r.sha, r.size, r.mtime, r.parsed.fit, J(r.parsed.missing), status,
    planId ?? (keep ? (row.plan_id as number | null) : null), planVersion ?? (keep ? (row.plan_version as number | null) : null),
    keep ? Number(row.status_at) : at, row.id as number,
  );
}

/** Refresh inbox_file for every .md under the inbox folder and its archive/; rows of this folder whose file vanished become `missing`. */
export function scanInbox(db: Db, t: InboxTarget, at: number = now()): Row[] {
  const seen = new Set<string>();
  const { folder, prefix } = inboxPlace(t);
  const dirs: [boolean, string][] = [[false, folder], [true, join(folder, 'archive')]];
  tx(db, () => {
    for (const [archive, dir] of dirs) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
        if (!statSync(join(dir, name)).isFile()) continue;
        seen.add(`${prefix}/${archive ? 'archive/' : ''}${name}`);
        syncFile(db, t, archive, name, at);
      }
    }
    // Rows under another prefix belong to an earlier `plans.inboxDir`; they stay as they are.
    for (const r of all(db, "SELECT id, path FROM inbox_file WHERE repo_id = ? AND status NOT IN ('deleted','missing')", t.repoId)) {
      const path = String(r.path);
      if (path.startsWith(`${prefix}/`) && !seen.has(path) && !existsSync(diskPath(t, path))) {
        db.prepare("UPDATE inbox_file SET status='missing', status_at=? WHERE id=?").run(at, r.id as number);
      }
    }
  });
  return all(db, 'SELECT * FROM inbox_file WHERE repo_id = ? ORDER BY path', t.repoId);
}

// ---------------------------------------------------------------- loading a parsed plan

const taskVals = (t: ParsedTask): Record<string, string | number | null> => ({
  title: t.title, description: t.description, acceptance: J(t.acceptance), covers: J(t.covers), deps: J(t.deps),
  risk: t.risk, size: t.size, gate: t.gate, manual: t.manual, route: t.route, refs: J(t.refs), owned: J(t.owned),
  subagent: t.subagent ? 1 : 0, parallel: t.parallel ? 1 : 0, scenario: t.scenario,
});

const phaseVals = (p: ParsedPhase): Record<string, string | number | null> => ({
  title: p.title, goal: p.goal, ord: p.ord, wave: p.wave, lane_group: p.laneGroup, deps: J(p.deps), owned: J(p.owned),
  forbidden: J(p.forbidden), commit_msg: p.commit, size: p.size, route: p.route, reviewer: p.reviewer,
  subagents: p.subagents ? 1 : 0, qa: J(p.qa), serves: J(p.serves), hazards: J(p.hazards), carries: J(p.carries), build_order: p.buildOrder,
});

const subVals = (s: { title: string; description: string | null; acceptance: string[]; deps: string[]; owned: string[] }): Record<string, string | number | null> => ({
  title: s.title, description: s.description, acceptance: J(s.acceptance), deps: J(s.deps), owned: J(s.owned),
});

function insertRow(db: Db, table: string, vals: Record<string, string | number | null>): number {
  const cols = Object.keys(vals);
  const r = db.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')}) RETURNING id`).get(...Object.values(vals));
  return Number(r!.id);
}

function updateRow(db: Db, table: string, id: number, vals: Record<string, string | number | null>): void {
  const cols = Object.keys(vals);
  db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`).run(...Object.values(vals), id);
}

/** Section 3.3 at import time: phase deps or a later wave = pending; an own task dep = blocked; else ready. */
function initialStatus(t: ParsedTask, ph: ParsedPhase, minWave: number, phaseCodes: Set<string>): string {
  if (ph.deps.length > 0 || ph.wave > minWave) return 'pending';
  if (t.deps.some((d) => phaseCodes.has(d) || d.includes(':'))) return 'pending';
  if (t.deps.length > 0) return 'blocked';
  return 'ready';
}

function loadItems(db: Db, planId: number, plan: ParsedPlan): void {
  db.prepare('DELETE FROM plan_item WHERE plan_id = ?').run(planId);
  plan.items.forEach((it, i) => {
    db.prepare('INSERT INTO plan_item(plan_id, kind, code, ord, text, data, done) VALUES(?,?,?,?,?,?,?)').run(
      planId, it.kind, it.code, i + 1, it.text, J(it.data), it.done ? 1 : 0,
    );
  });
}

function insertTask(db: Db, planId: number, phaseId: number, t: ParsedTask, status: string, at: number): number {
  return insertRow(db, 'plan_task', { plan_id: planId, phase_id: phaseId, code: t.code, ord: t.ord, origin: 'plan', ...taskVals(t), status, created_at: at, updated_at: at });
}

function insertSubtasks(db: Db, planId: number, taskId: number, t: ParsedTask): void {
  for (const s of t.subtasks) insertRow(db, 'plan_subtask', { plan_id: planId, task_id: taskId, code: s.code, ord: s.ord, ...subVals(s), status: 'pending' });
}

/** First import (and the rebuild of an `imported` plan): phases, tasks, subtasks, items. */
function loadStructure(db: Db, planId: number, plan: ParsedPlan, at: number): void {
  const minWave = Math.min(...plan.phases.map((p) => p.wave));
  const phaseCodes = new Set(plan.phases.map((p) => p.code));
  for (const ph of plan.phases) {
    const phaseId = insertRow(db, 'plan_phase', { plan_id: planId, code: ph.code, ...phaseVals(ph) });
    for (const t of ph.tasks) insertSubtasks(db, planId, insertTask(db, planId, phaseId, t, initialStatus(t, ph, minWave, phaseCodes), at), t);
  }
  loadItems(db, planId, plan);
}

// ---------------------------------------------------------------- re-import

interface Counts {
  added: number;
  changed: number;
  dropped: number;
}

const noteOf = (kind: string, c: Counts): string => `${kind}: +${c.added} tasks, ~${c.changed} changed, -${c.dropped} dropped`;

const same = (row: Row, vals: Record<string, string | number | null>): boolean =>
  Object.entries(vals).every(([k, v]) => String(row[k] ?? null) === String(v ?? null));

/** Rebuild an `imported` plan's structure. Todo links to tasks and phases are re-resolved by code. */
function replaceStructure(db: Db, planId: number, plan: ParsedPlan, at: number): Counts {
  const old = new Map(all(db, 'SELECT * FROM plan_task WHERE plan_id = ? AND dropped_at IS NULL', planId).map((r) => [String(r.code), r]));
  const links = all(db, "SELECT id, link_kind, link_ref FROM todo WHERE link_kind IN ('task','phase')").flatMap((l) => {
    const tbl = l.link_kind === 'task' ? 'plan_task' : 'plan_phase';
    const hit = one(db, `SELECT code FROM ${tbl} WHERE id = ? AND plan_id = ?`, Number(l.link_ref), planId);
    return hit ? [{ todo: l.id as number, kind: String(l.link_kind), code: String(hit.code) }] : [];
  });

  db.prepare('DELETE FROM plan_subtask WHERE plan_id = ?').run(planId);
  db.prepare('DELETE FROM plan_task WHERE plan_id = ?').run(planId);
  db.prepare('DELETE FROM plan_phase WHERE plan_id = ?').run(planId);
  loadStructure(db, planId, plan, at);

  for (const l of links) {
    const tbl = l.kind === 'task' ? 'plan_task' : 'plan_phase';
    const hit = one(db, `SELECT id FROM ${tbl} WHERE plan_id = ? AND code = ?`, planId, l.code);
    if (hit) db.prepare('UPDATE todo SET link_ref = ? WHERE id = ?').run(String(hit.id), l.todo);
    else db.prepare('UPDATE todo SET link_kind = NULL, link_ref = NULL WHERE id = ?').run(l.todo); // a dropped target shows as plain text
  }

  const fresh = new Map(plan.phases.flatMap((p) => p.tasks.map((t) => [t.code, t] as const)));
  let changed = 0;
  for (const [code, t] of fresh) {
    const o = old.get(code);
    if (o && !same(o, taskVals(t))) changed++;
  }
  return { added: [...fresh.keys()].filter((c) => !old.has(c)).length, changed, dropped: [...old.keys()].filter((c) => !fresh.has(c)).length };
}

/** A plan whose rows carry any Orca link or progress must never be rebuilt, only merged. */
function hasProgress(db: Db, planId: number): boolean {
  return !!one(
    db,
    `SELECT 1 AS x FROM plan_task WHERE plan_id = ? AND (orca_task_id IS NOT NULL OR attempts > 0 OR past_task_ids <> '[]'
        OR status NOT IN ('pending','ready','blocked') OR started_at IS NOT NULL) LIMIT 1`,
    planId,
  );
}

/**
 * Merge by `code` under column ownership (§6.4). Structure columns are updated; status, orca_*, attempts,
 * past_task_ids, last_state*, started_at, done_at are never written for an existing task.
 */
function mergeStructure(db: Db, planId: number, plan: ParsedPlan, at: number): Counts {
  const fileTasks = new Map(plan.phases.flatMap((p) => p.tasks.map((t) => [t.code, t] as const)));
  const fileSubs = new Set(plan.phases.flatMap((p) => p.tasks.flatMap((t) => t.subtasks.map((s) => s.code))));

  // (c) Refuse before writing anything if the file drops work that is running.
  const conflicts: string[] = [];
  for (const r of all(db, 'SELECT code, status FROM plan_task WHERE plan_id = ? AND dropped_at IS NULL', planId)) {
    if (!fileTasks.has(String(r.code)) && (r.status === 'working' || r.status === 'waiting')) conflicts.push(`task ${r.code} is ${r.status} but is not in the file`);
  }
  for (const r of all(db, 'SELECT code, status FROM plan_subtask WHERE plan_id = ? AND dropped_at IS NULL', planId)) {
    if (!fileSubs.has(String(r.code)) && (r.status === 'working' || r.status === 'waiting')) conflicts.push(`subtask ${r.code} is ${r.status} but is not in the file`);
  }
  if (conflicts.length) throw new ImportError(`import refused: ${conflicts.join('; ')}`, conflicts);

  const counts: Counts = { added: 0, changed: 0, dropped: 0 };
  const phaseIds = new Map<string, number>();
  const oldPhases = new Map(all(db, 'SELECT * FROM plan_phase WHERE plan_id = ?', planId).map((r) => [String(r.code), r]));
  for (const ph of plan.phases) {
    const o = oldPhases.get(ph.code);
    if (o) {
      updateRow(db, 'plan_phase', Number(o.id), { ...phaseVals(ph), dropped_at: null });
      phaseIds.set(ph.code, Number(o.id));
    } else phaseIds.set(ph.code, insertRow(db, 'plan_phase', { plan_id: planId, code: ph.code, ...phaseVals(ph) }));
  }
  for (const [code, o] of oldPhases) {
    if (!phaseIds.has(code) && o.dropped_at == null) db.prepare('UPDATE plan_phase SET dropped_at = ? WHERE id = ?').run(at, o.id as number);
  }

  const oldTasks = new Map(all(db, 'SELECT * FROM plan_task WHERE plan_id = ?', planId).map((r) => [String(r.code), r]));
  const taskIds = new Map<string, number>();
  for (const ph of plan.phases) {
    for (const t of ph.tasks) {
      const o = oldTasks.get(t.code);
      const vals = taskVals(t);
      const phaseId = phaseIds.get(ph.code)!;
      if (!o) {
        taskIds.set(t.code, insertTask(db, planId, phaseId, t, 'pending', at));
        counts.added++;
        continue;
      }
      const id = Number(o.id);
      taskIds.set(t.code, id);
      const structural = { ...vals, ord: t.ord, phase_id: phaseId };
      const drifted = o.orca_task_id != null && (o.title !== t.title || String(o.description ?? null) !== String(t.description ?? null) || o.deps !== J(t.deps));
      if (!same(o, structural) || o.dropped_at != null || (drifted && !o.spec_drift)) {
        if (!same(o, structural)) counts.changed++;
        updateRow(db, 'plan_task', id, { ...structural, dropped_at: null, updated_at: at, ...(drifted ? { spec_drift: 1 } : {}) });
      }
    }
  }
  for (const [code, o] of oldTasks) {
    if (fileTasks.has(code) || o.dropped_at != null) continue;
    if (o.orca_task_id == null || ['done', 'failed', 'cancelled'].includes(String(o.status))) {
      db.prepare('UPDATE plan_task SET dropped_at = ?, updated_at = ? WHERE id = ?').run(at, at, o.id as number);
      counts.dropped++;
    } // else: it holds an Orca link and has not finished; it is kept, link intact
  }

  const oldSubs = new Map(all(db, 'SELECT * FROM plan_subtask WHERE plan_id = ?', planId).map((r) => [String(r.code), r]));
  for (const ph of plan.phases) {
    for (const t of ph.tasks) {
      for (const s of t.subtasks) {
        const o = oldSubs.get(s.code);
        const vals = { ...subVals(s), ord: s.ord, task_id: taskIds.get(t.code)! };
        if (!o) insertRow(db, 'plan_subtask', { plan_id: planId, code: s.code, ...vals, status: 'pending' });
        else if (!same(o, vals) || o.dropped_at != null) updateRow(db, 'plan_subtask', Number(o.id), { ...vals, dropped_at: null });
      }
    }
  }
  for (const [code, o] of oldSubs) {
    if (!fileSubs.has(code) && o.dropped_at == null) db.prepare('UPDATE plan_subtask SET dropped_at = ? WHERE id = ?').run(at, o.id as number);
  }

  loadItems(db, planId, plan); // (e) items carry no MK state; replaced wholesale
  return counts;
}

// ---------------------------------------------------------------- import

function archiveName(dir: string, name: string, slug: string, at: number): string {
  const arch = join(dir, 'archive');
  mkdirSync(arch, { recursive: true });
  if (!existsSync(join(arch, name))) return name;
  const stamp = new Date(at).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  let cand = `${slug}-${stamp}.md`;
  for (let n = 2; existsSync(join(arch, cand)); n++) cand = `${slug}-${stamp}-${n}.md`;
  return cand;
}

/** Import (or re-import) `inbox/<name>`. Throws ImportError for a non-plan, a finished plan or a refused merge. */
export function importFile(db: Db, t: InboxTarget, name: string, at: number = now()): ImportResult {
  const { folder: inboxDir, prefix } = inboxPlace(t);
  const src = join(inboxDir, name);
  if (!existsSync(src)) throw new ImportError(`${name} is not in ${inboxDir}`);
  scanInbox(db, t, at);
  const rel = `${prefix}/${name}`;
  const file = readPlanFile(src, settingsOf(t));
  const res = file.parsed;
  if (res.fit === 'not_a_plan' || !res.plan) throw new ImportError(`${name} is not a plan: ${res.missing[0] ?? 'unreadable'}`);
  const plan = res.plan;

  let moved: { from: string; to: string } | null = null;
  try {
    return tx(db, () => {
      const inbox = one(db, 'SELECT id FROM inbox_file WHERE repo_id = ? AND path = ?', t.repoId, rel);
      const existing = one(db, 'SELECT * FROM plan WHERE repo_id = ? AND slug = ?', t.repoId, plan.slug);
      let planId: number;
      let version: number;
      let action: ImportResult['action'];
      let note: string;

      if (!existing) {
        planId = insertRow(db, 'plan', {
          slug: plan.slug, repo_id: t.repoId, title: plan.title, status: 'imported', version: 1, file_status: plan.fileStatus,
          integration_branch: plan.integration, pushed: plan.pushed ? 1 : 0, created_at: plan.createdAt ?? at, updated_at: at,
        });
        loadStructure(db, planId, plan, at);
        version = 1;
        action = 'created';
        note = 'initial';
      } else {
        planId = Number(existing.id);
        if (existing.status === 'done' || existing.status === 'archived') throw new ImportError(`plan ${plan.slug} is ${existing.status}; use a new slug`);
        if (currentSha(db, planId, Number(existing.version)) === file.sha) {
          db.prepare("UPDATE inbox_file SET status='imported', plan_id=?, plan_version=?, status_at=? WHERE id=?").run(planId, Number(existing.version), at, inbox!.id as number);
          return { action: 'noop', planId, version: Number(existing.version), note: 'already imported', path: rel } as ImportResult;
        }
        const rebuild = existing.status === 'imported' && !hasProgress(db, planId);
        const counts = rebuild ? replaceStructure(db, planId, plan, at) : mergeStructure(db, planId, plan, at);
        version = Number(existing.version) + 1;
        action = rebuild ? 'replaced' : 'merged';
        note = noteOf(rebuild ? 'replaced' : 'merged', counts);
        db.prepare('UPDATE plan SET title=?, file_status=?, integration_branch=?, pushed=?, version=?, updated_at=? WHERE id=?').run(
          plan.title, plan.fileStatus, plan.integration, plan.pushed ? 1 : 0, version, at, planId,
        );
      }

      db.prepare(
        `INSERT INTO plan_version(plan_id, version, source_sha, source_path, body, fit, missing, imported_at, note) VALUES(?,?,?,?,?,?,?,?,?)`,
      ).run(planId, version, file.sha, rel, file.text, res.fit satisfies Fit, J(res.missing), at, note);
      db.prepare('DELETE FROM plan_version WHERE plan_id = ? AND version <= ?').run(planId, version - 10);

      // Move last: if it fails the transaction rolls back and the plan is as it was.
      const archived = archiveName(inboxDir, name, plan.slug, at);
      const archivedRel = `${prefix}/archive/${archived}`;
      db.prepare("DELETE FROM inbox_file WHERE repo_id = ? AND path = ? AND id <> ? AND status IN ('missing','deleted')").run(t.repoId, archivedRel, inbox!.id as number);
      db.prepare(
        "UPDATE inbox_file SET path=?, name=?, status='imported', plan_id=?, plan_version=?, imported_at=?, status_at=? WHERE id=?",
      ).run(archivedRel, archived, planId, version, at, at, inbox!.id as number);
      renameSync(src, join(inboxDir, 'archive', archived));
      moved = { from: src, to: join(inboxDir, 'archive', archived) };
      return { action, planId, version, note, path: archivedRel };
    });
  } catch (e) {
    // The file moved but the commit failed: put it back so the inbox and the database agree.
    const m = moved as { from: string; to: string } | null;
    if (m && existsSync(m.to) && !existsSync(m.from)) renameSync(m.to, m.from);
    throw e;
  }
}
