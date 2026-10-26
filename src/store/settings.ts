/**
 * mk-settings.json, schema 2 (settings v2 contracts C1, C3, C9).
 * Rules: reading never writes; the first save creates the file; a bad value is rejected naming its key;
 * unknown keys survive a save; the file is replaced atomically. A schema 1 file is migrated in memory on read
 * (settings-migrate.ts) and replaced by schema 2 on the first save, after a copy to mk-settings.v1.bak.json.
 * Backend code reads values through `setting()` only.
 */
import { copyFileSync, constants, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db.js';
import { migrateV1 } from './settings-migrate.js';
import { checkRoute } from './routes-check.js';

export const SETTINGS_SCHEMA = 2;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Settings = { [k: string]: Json };

export interface SettingsIssue {
  key: string;
  message: string;
}

export class SettingsError extends Error {
  constructor(public issues: SettingsIssue[]) {
    super(issues.map((i) => `${i.key}: ${i.message}`).join('; '));
    this.name = 'SettingsError';
  }
}

export function settingsPath(dir: string = dataDir()): string {
  return join(dir, 'mk-settings.json');
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export const AGENT_IDS = ['claude', 'codex', 'agy', 'opencode', 'omp'] as const;
/** The top-level groups `settings.reset` accepts (C4). */
export const RESET_SECTIONS = ['general', 'data', 'sync', 'agents', 'routing', 'quota', 'lanes', 'bugs', 'plans', 'work', 'safety', 'notify', 'look'] as const;
export const SPEC_SCENARIOS = ['investigate', 'implement', 'subdispatch', 'review', 'fix'] as const;
export const TEMPLATE_HOME_PREFIX = '~/.matrixkoder/templates/';

export interface ModelEntry {
  id: string;
  efforts: string[];
  note: string;
}

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'max'];
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const CODEX_LUNA_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const agy = (id: string, note: string): ModelEntry => ({ id, efforts: [], note });

/**
 * Seed for agents.<id>.models (C9), copied by hand from ~/.claude/skills/jev/reference/models.md (snapshot 2026-10-08).
 * The build never reads ~/.claude. Once a user's file holds a models list it is theirs; later seeds never merge into it.
 */
export const MODEL_SEED: Record<string, ModelEntry[]> = {
  claude: [
    { id: 'haiku', efforts: CLAUDE_EFFORTS, note: 'Cheapest Claude. Lookups, digests, 1-2 file mechanical edits.' },
    { id: 'sonnet', efforts: CLAUDE_EFFORTS, note: 'Balanced Claude. Bounded builds, browser QA, standard reviews.' },
    { id: 'opus', efforts: CLAUDE_EFFORTS, note: 'Strong reasoning for cross-cutting, data-loss and security work.' },
    { id: 'fable', efforts: CLAUDE_EFFORTS, note: 'Most capable Claude, own weekly pool. Final reviews only.' },
  ],
  codex: [
    { id: 'gpt-6-astra', efforts: CODEX_EFFORTS, note: 'OpenAI frontier model. Hardest builds, cross-family final or security reviews.' },
    { id: 'gpt-6.1-sol', efforts: CODEX_EFFORTS, note: 'Latest OpenAI coding workhorse. First-choice builder lane; also a cross-family reviewer.' },
    { id: 'gpt-6-luna', efforts: CODEX_LUNA_EFFORTS, note: 'Fast, cheap OpenAI model. Mechanical edits, digests; not for multi-file phases.' },
  ],
  agy: [
    agy('gemini-3.8-flash-low', 'Latest Gemini Flash. Bulk UI and feature lanes.'),
    agy('gemini-3.8-flash-medium', 'Latest Gemini Flash. Bulk UI and feature lanes.'),
    agy('gemini-3.8-flash-high', 'Latest Gemini Flash, high effort. Standard builds.'),
    agy('gemini-3.1-pro-low', 'Gemini Pro. Complex builds.'),
    agy('gemini-3.1-pro-high', 'Gemini Pro, high effort. Complex builds and cross-family reviews.'),
    agy('gpt-oss-120b-medium', 'Open-weight model. Cheap fallback for trivial work.'),
    agy('claude-opus-5-5-low', 'Claude Opus hosted by AGY. Billing against the Anthropic subscription is unverified.'),
    agy('claude-opus-5-5-medium', 'Claude Opus hosted by AGY. Billing against the Anthropic subscription is unverified.'),
    agy('claude-opus-5-5-high', 'Claude Opus hosted by AGY. Billing against the Anthropic subscription is unverified.'),
    agy('claude-sonnet-5-5-low', 'Claude Sonnet hosted by AGY. Billing against the Anthropic subscription is unverified.'),
    agy('claude-sonnet-5-5-medium', 'Claude Sonnet hosted by AGY. Billing against the Anthropic subscription is unverified.'),
    agy('claude-sonnet-5-5-high', 'Claude Sonnet hosted by AGY. Billing against the Anthropic subscription is unverified.'),
  ],
  opencode: [],
  omp: [],
};

const DEFAULT_ROUTES = ['claude haiku low', 'claude sonnet medium', 'claude opus high'];
const NEVER_RUN_DEFAULT = ['git reset --hard', 'git push --force', 'git clean -fdx', 'rm -rf ~', 'npm publish'];

export function defaultSettings(): Settings {
  const agents: { [k: string]: Json } = {};
  for (const id of AGENT_IDS) agents[id] = { routable: true, models: structuredClone(MODEL_SEED[id]) as unknown as Json, model: '', effort: '' };
  return {
    schema: SETTINGS_SCHEMA,
    general: { activeRepo: null, mode: 'orchestrator', openOnStart: 'last', undoSeconds: 10, snoozeMinutes: 60 },
    data: { backupKeep: 7, goneDays: 30, decisionDays: 90, eventMax: 5000 },
    sync: { fastSeconds: 10, slowSeconds: 60, filesSeconds: 30 },
    agents,
    routing: {
      bySize: { trivial: 'claude haiku low', standard: 'claude sonnet medium', complex: 'claude opus high' },
      maxLanes: 3,
    },
    quota: {
      floor: { claude: { sessionPct: 40, weeklyPct: 30 }, others: { sessionPct: 10, weeklyPct: 15 } },
      onBelowFloor: 'block',
    },
    lanes: { stallMinutes: 15 },
    bugs: { defaultRisk: 3 },
    plans: { inboxDir: '.matrixkoder/inbox', autoImport: false },
    work: { specTemplates: { investigate: '', implement: '', subdispatch: '', review: '', fix: '' } },
    safety: {
      confirmRiskAtLeast: 4,
      protectedBranches: ['main', 'release/*'],
      neverRun: [...NEVER_RUN_DEFAULT],
      askBeforePush: true,
    },
    notify: {
      events: { ask: true, laneDone: true, taskFailed: true, stall: false, quotaLow: false },
      quietHours: { enabled: false, from: '22:00', to: '07:00' },
      wakeOrchestrator: false,
    },
    look: {
      rain: { enabled: true, brightness: 60, speed: 'normal' },
      reduceMotion: 'os',
      textSize: 'M',
      density: 'comfy',
    },
  };
}

type Rule =
  | { t: 'bool' }
  | { t: 'enum'; values: string[] }
  | { t: 'int'; min: number; max: number }
  | { t: 'str'; nullable?: boolean; max?: number }
  | { t: 'strs'; maxItems: number; itemMax: number }
  | { t: 'time' }
  | { t: 'route' }
  | { t: 'relpath'; max: number }
  | { t: 'tpl'; max: number }
  | { t: 'models'; optional: true }
  | { t: 'model' }
  | { t: 'effort' };

const bool: Rule = { t: 'bool' };
const int = (min: number, max: number): Rule => ({ t: 'int', min, max });
const en = (...values: string[]): Rule => ({ t: 'enum', values });
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Dotted path to rule. `*` matches any single agent id. Containers are listed below so their type is checked. */
const RULES: Record<string, Rule> = {
  'general.activeRepo': { t: 'str', nullable: true, max: 200 },
  'general.mode': en('orchestrator', 'solo'),
  'general.openOnStart': en('projects', 'lanes', 'waiting', 'plan', 'last'),
  'general.undoSeconds': int(0, 60),
  'general.snoozeMinutes': int(1, 1440),
  'data.backupKeep': int(1, 30),
  'data.goneDays': int(7, 365),
  'data.decisionDays': int(7, 365),
  'data.eventMax': int(500, 50000),
  'sync.fastSeconds': int(5, 120),
  'sync.slowSeconds': int(30, 900),
  'sync.filesSeconds': int(10, 600),
  'agents.*.routable': bool,
  'agents.*.models': { t: 'models', optional: true },
  'agents.*.model': { t: 'model' },
  'agents.*.effort': { t: 'effort' },
  'routing.bySize.trivial': { t: 'route' },
  'routing.bySize.standard': { t: 'route' },
  'routing.bySize.complex': { t: 'route' },
  'routing.maxLanes': int(1, 12),
  'quota.floor.claude.sessionPct': int(0, 100),
  'quota.floor.claude.weeklyPct': int(0, 100),
  'quota.floor.others.sessionPct': int(0, 100),
  'quota.floor.others.weeklyPct': int(0, 100),
  'quota.onBelowFloor': en('off', 'warn', 'block'),
  'lanes.stallMinutes': int(5, 120),
  'bugs.defaultRisk': int(1, 5),
  'plans.inboxDir': { t: 'relpath', max: 400 },
  'plans.autoImport': bool,
  ...Object.fromEntries(SPEC_SCENARIOS.map((s) => [`work.specTemplates.${s}`, { t: 'tpl', max: 400 } as Rule])),
  'safety.confirmRiskAtLeast': int(1, 6),
  'safety.protectedBranches': { t: 'strs', maxItems: 20, itemMax: 100 },
  'safety.neverRun': { t: 'strs', maxItems: 40, itemMax: 200 },
  'safety.askBeforePush': bool,
  'notify.events.ask': bool,
  'notify.events.laneDone': bool,
  'notify.events.taskFailed': bool,
  'notify.events.stall': bool,
  'notify.events.quotaLow': bool,
  'notify.quietHours.enabled': bool,
  'notify.quietHours.from': { t: 'time' },
  'notify.quietHours.to': { t: 'time' },
  'notify.wakeOrchestrator': bool,
  'look.rain.enabled': bool,
  'look.rain.brightness': int(0, 100),
  'look.rain.speed': en('slow', 'normal', 'fast'),
  'look.reduceMotion': en('os', 'on', 'off'),
  'look.textSize': en('S', 'M', 'L'),
  'look.density': en('compact', 'comfy'),
};

const CONTAINERS = [
  'general', 'data', 'sync', 'agents', 'routing', 'routing.bySize', 'quota', 'quota.floor', 'quota.floor.claude', 'quota.floor.others',
  'lanes', 'bugs', 'plans', 'work', 'work.specTemplates', 'safety', 'notify', 'notify.events', 'notify.quietHours', 'look', 'look.rain',
];

/** Which keys the panel shows as "advisory" or "checked by MK" (C3, C7). */
const ENFORCED: Record<string, 'mk' | 'advisory'> = {
  'safety.confirmRiskAtLeast': 'mk',
  'safety.protectedBranches': 'advisory',
  'safety.neverRun': 'advisory',
  'safety.askBeforePush': 'advisory',
};

const isObj = (v: unknown): v is { [k: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Path segments that would reach Object.prototype; no settings path uses them. */
export const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];

export function getPath(root: Json | undefined, path: string[]): Json | undefined {
  let cur: Json | undefined = root;
  for (const p of path) {
    if (!isObj(cur) || UNSAFE_KEYS.includes(p)) return undefined;
    cur = cur[p];
  }
  return cur;
}

let defaultsCache: Settings | null = null;
/**
 * Read one value by dotted path ("routing.maxLanes"). A path the settings lack falls back to its default, so
 * callers never see undefined for a C1 key. This is the only way backend code reads a setting.
 */
export function setting<T extends Json = Json>(s: Settings, path: string): T {
  const parts = path.split('.');
  const v = getPath(s, parts);
  if (v !== undefined) return v as T;
  defaultsCache ??= defaultSettings();
  return getPath(defaultsCache, parts) as T;
}

/** The rule for a key, or undefined for an unknown key. */
function ruleFor(key: string): Rule | undefined {
  if (Object.hasOwn(RULES, key)) return RULES[key];
  const p = key.split('.');
  if (p[0] === 'agents' && p.length === 3 && Object.hasOwn(RULES, `agents.*.${p[2]}`)) return RULES[`agents.*.${p[2]}`];
  return undefined;
}

function relPathIssue(v: string, what: string): string | null {
  if (v.includes('\0')) return `${what} must not contain a null character`;
  if (v.startsWith('/')) return `${what} must be a relative path`;
  if (v.split(/[\\/]/).includes('..')) return `${what} must not contain ".."`;
  return null;
}

function modelsOf(s: Settings, agentId: string): ModelEntry[] {
  const m = getPath(s, ['agents', agentId, 'models']);
  return Array.isArray(m) ? (m.filter((x) => isObj(x) && typeof x.id === 'string') as unknown as ModelEntry[]) : [];
}

function check(rule: Rule, v: Json | undefined, s: Settings, agentId = ''): string | null {
  switch (rule.t) {
    case 'bool':
      return typeof v === 'boolean' ? null : 'must be true or false';
    case 'enum':
      return typeof v === 'string' && rule.values.includes(v) ? null : `must be one of ${rule.values.map((x) => JSON.stringify(x)).join(', ')}`;
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && v >= rule.min && v <= rule.max ? null : `must be a whole number from ${rule.min} to ${rule.max}`;
    case 'str':
      if (v === null && rule.nullable) return null;
      if (typeof v !== 'string') return rule.nullable ? 'must be a string or null' : 'must be a string';
      return rule.max !== undefined && v.length > rule.max ? `must be at most ${rule.max} characters` : null;
    case 'strs':
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return 'must be a list of strings';
      if (v.length > rule.maxItems) return `must have at most ${rule.maxItems} items`;
      return v.some((x) => (x as string).length > rule.itemMax) ? `each item must be at most ${rule.itemMax} characters` : null;
    case 'time':
      return typeof v === 'string' && TIME.test(v) ? null : 'must be a time like "22:00"';
    case 'route': {
      if (typeof v !== 'string' || v.trim() === '') return 'must be a route like "claude sonnet medium"';
      if (v.length > 120) return 'must be at most 120 characters';
      const words = v.trim().split(/\s+/);
      if (words.length > 3) return 'must be "agent [model [effort]]"';
      // a route the user never changed is not theirs to fix (a trimmed models list can orphan it; task.start still checks it)
      if (DEFAULT_ROUTES.includes(v)) return null;
      // C9, with every agent counted as routable: turning an agent off must never make a save fail
      const agents = getPath(s, ['agents']);
      const routable = isObj(agents) ? Object.fromEntries(Object.entries(agents).map(([id, a]) => [id, isObj(a) ? { ...a, routable: true } : a])) : {};
      const r = checkRoute(v, { ...s, agents: routable });
      return r.ok ? null : r.issue;
    }
    case 'relpath': {
      if (typeof v !== 'string' || v.trim() === '') return 'must be a folder path relative to the repository';
      if (v.length > rule.max) return `must be at most ${rule.max} characters`;
      if (v.startsWith('~')) return 'must be a relative path (no "~")';
      return relPathIssue(v, 'the path');
    }
    case 'tpl': {
      if (typeof v !== 'string') return 'must be a string';
      if (v.length > rule.max) return `must be at most ${rule.max} characters`;
      if (v === '') return null;
      if (v.startsWith('~') && !v.startsWith(TEMPLATE_HOME_PREFIX)) return `must be repo-relative or start with "${TEMPLATE_HOME_PREFIX}"`;
      return relPathIssue(v, 'the path');
    }
    case 'models': {
      if (v === undefined) return null;
      if (!Array.isArray(v)) return 'must be a list of models';
      if (v.length > 12) return 'must have at most 12 models';
      for (const m of v) {
        if (!isObj(m)) return 'each model must be an object {id, efforts, note}';
        if (typeof m.id !== 'string' || m.id === '' || m.id.length > 80) return 'each model id must be 1 to 80 characters';
        if (!Array.isArray(m.efforts) || !m.efforts.every((e) => typeof e === 'string' && (EFFORTS as readonly string[]).includes(e))) {
          return `efforts of "${m.id}" must be a list of ${EFFORTS.join(', ')}`;
        }
        if (m.note !== undefined && (typeof m.note !== 'string' || m.note.length > 200)) return `note of "${m.id}" must be at most 200 characters`;
      }
      return null;
    }
    case 'model': {
      if (typeof v !== 'string') return 'must be a string';
      if (v.length > 80) return 'must be at most 80 characters';
      const list = modelsOf(s, agentId);
      return v === '' || list.length === 0 || list.some((m) => m.id === v) ? null : `must be empty or one of the models listed for ${agentId}`;
    }
    case 'effort': {
      if (typeof v !== 'string' || (v !== '' && !(EFFORTS as readonly string[]).includes(v))) return `must be one of "", ${EFFORTS.map((x) => JSON.stringify(x)).join(', ')}`;
      const model = getPath(s, ['agents', agentId, 'model']);
      const entry = typeof model === 'string' ? modelsOf(s, agentId).find((m) => m.id === model) : undefined;
      if (v !== '' && entry && Array.isArray(entry.efforts) && entry.efforts.length > 0 && !entry.efforts.includes(v)) {
        return `model "${entry.id}" takes ${entry.efforts.map((x) => JSON.stringify(x)).join(', ')} (or empty)`;
      }
      return null;
    }
  }
}

/** Validate a complete settings object. Unknown keys are ignored (kept, not checked). */
export function validateSettings(s: Settings): SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  if (s.schema !== SETTINGS_SCHEMA) issues.push({ key: 'schema', message: `must be ${SETTINGS_SCHEMA}` });
  for (const c of CONTAINERS) {
    if (!isObj(getPath(s, c.split('.')))) issues.push({ key: c, message: 'must be an object' });
  }
  const bad = new Set(issues.map((i) => i.key));
  const agents = getPath(s, ['agents']);
  for (const [path, rule] of Object.entries(RULES)) {
    const parts = path.split('.');
    if (parts.includes('*')) {
      if (!isObj(agents)) continue;
      for (const id of Object.keys(agents)) {
        const key = parts.map((p) => (p === '*' ? id : p)).join('.');
        if (!isObj(agents[id])) {
          if (!bad.has(`agents.${id}`)) issues.push({ key: `agents.${id}`, message: 'must be an object' });
          bad.add(`agents.${id}`);
          continue;
        }
        const msg = check(rule, getPath(s, key.split('.')), s, id);
        if (msg) issues.push({ key, message: msg });
      }
      continue;
    }
    if ([...bad].some((b) => path.startsWith(`${b}.`))) continue;
    const msg = check(rule, getPath(s, parts), s);
    if (msg) issues.push({ key: path, message: msg });
  }
  return issues;
}

export interface Normalized {
  value: Json;
  /** A one-line note when the value was clamped or replaced by the default; null when it passed as is. */
  note: string | null;
}

/**
 * Bring one value to the C1 rule of `key` (used by the v1 migration): numbers are rounded and clamped, lists are cut to
 * their cap and lose unusable items, anything else that fails the rule is replaced by the default. Never throws.
 */
export function normalizeValue(key: string, value: Json | undefined, s: Settings = defaultSettings()): Normalized {
  const rule = ruleFor(key);
  const def = getPath(defaultSettings(), key.split('.'));
  const fallback = (def === undefined ? (rule?.t === 'model' || rule?.t === 'effort' ? '' : null) : def) as Json;
  if (!rule) return { value: value ?? null, note: null };
  const agentId = key.startsWith('agents.') ? key.split('.')[1] : '';
  const used = (why: string): Normalized => ({ value: fallback, note: `${key}: ${why}; the default was used` });
  switch (rule.t) {
    case 'int': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return used('not a number');
      const r = Math.min(rule.max, Math.max(rule.min, Math.round(value)));
      return { value: r, note: r === value ? null : `${key}: ${value} was clamped to ${r} (allowed ${rule.min} to ${rule.max})` };
    }
    case 'strs': {
      if (!Array.isArray(value)) return used('not a list');
      const kept = value.filter((x): x is string => typeof x === 'string' && x.length <= rule.itemMax);
      const cut = kept.slice(0, rule.maxItems);
      return { value: cut, note: cut.length === value.length ? null : `${key}: ${value.length - cut.length} of ${value.length} items were dropped (limit ${rule.maxItems} items of ${rule.itemMax} characters)` };
    }
    default: {
      const msg = check(rule, value, s, agentId);
      return msg ? used(msg) : { value: value as Json, note: null };
    }
  }
}

/** Deep merge: objects merge key by key, everything else (arrays included) is replaced. Unknown keys are carried along. */
export function mergeSettings(base: Settings, patch: Settings): Settings {
  const out: Settings = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (UNSAFE_KEYS.includes(k)) continue;
    const cur = out[k];
    out[k] = isObj(cur) && isObj(v) ? mergeSettings(cur, v) : (structuredClone(v) as Json);
  }
  return out;
}

// ---------------------------------------------------------------- description (C3)

export interface SettingDescription {
  type: string;
  default: Json;
  min: number | null;
  max: number | null;
  options: string[] | null;
  owner: 'mk' | 'orca';
  enforced: 'mk' | 'advisory' | null;
  orcaPane?: string;
  label?: string;
}

const ORCA_ROWS: Array<{ key: string; label: string; pane: string }> = [
  { key: 'orca.notifications', label: 'OS notifications and sounds', pane: 'Settings > Notifications' },
  { key: 'orca.theme', label: 'Light and dark theme', pane: 'Settings > Appearance' },
  { key: 'orca.agentInstall', label: 'Agent install and commands', pane: 'Settings > Agents' },
  { key: 'orca.accounts', label: 'Accounts and permissions', pane: 'Settings > Agents' },
  { key: 'orca.keybindings', label: 'Keybindings', pane: 'Settings > Keyboard' },
];

const TYPE_NAME: Record<Rule['t'], string> = {
  bool: 'bool', enum: 'enum', int: 'int', str: 'string', strs: 'list', time: 'time', route: 'route',
  relpath: 'path', tpl: 'path', models: 'models', model: 'string', effort: 'enum',
};

/**
 * One entry per C1 key, keyed by dotted path ("routing.maxLanes", "agents.claude.model"), plus the display-only
 * `owner: "orca"` rows. Agent keys cover the default agents and any agent in `settings`.
 */
export function describeSettings(settings?: Settings): Record<string, SettingDescription> {
  const defaults = defaultSettings();
  const ids = new Set<string>(AGENT_IDS);
  const agents = settings ? getPath(settings, ['agents']) : undefined;
  if (isObj(agents)) for (const id of Object.keys(agents).filter((k) => k.length <= 40).slice(0, 20)) ids.add(id);
  const out: Record<string, SettingDescription> = {};
  for (const [path, rule] of Object.entries(RULES)) {
    const keys = path.includes('*') ? [...ids].map((id) => path.replace('*', id)) : [path];
    for (const key of keys) {
      const def = getPath(defaults, key.split('.'));
      let options: string[] | null = null;
      if (rule.t === 'enum') options = rule.values;
      else if (rule.t === 'effort') options = ['', ...EFFORTS];
      else if (rule.t === 'model') options = modelsOf(defaults, key.split('.')[1]).map((m) => m.id);
      out[key] = {
        type: TYPE_NAME[rule.t],
        default: def === undefined ? (rule.t === 'model' || rule.t === 'effort' ? '' : rule.t === 'models' ? [] : null) : def,
        min: rule.t === 'int' ? rule.min : null,
        max: rule.t === 'int' ? rule.max : rule.t === 'strs' ? rule.maxItems : rule.t === 'str' || rule.t === 'relpath' || rule.t === 'tpl' ? (rule.max ?? null) : rule.t === 'route' ? 120 : rule.t === 'model' ? 80 : rule.t === 'models' ? 12 : null,
        options,
        owner: 'mk',
        enforced: ENFORCED[key] ?? null,
      };
    }
  }
  for (const r of ORCA_ROWS) {
    out[r.key] = { type: 'display', default: null, min: null, max: null, options: null, owner: 'orca', enforced: null, orcaPane: r.pane, label: r.label };
  }
  return out;
}

// ---------------------------------------------------------------- file

function readFile(dir: string): Settings | null {
  const p = settingsPath(dir);
  if (!existsSync(p)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`${p} is not valid JSON: ${(e as Error).message}`);
  }
  if (!isObj(parsed)) throw new Error(`${p} must hold a JSON object`);
  return parsed;
}

interface FileState {
  /** What the file contributes on top of the defaults, already migrated when the file was schema 1. */
  overlay: Settings;
  notes: string[];
  fromV1: boolean;
  exists: boolean;
}

function fileState(dir: string): FileState {
  const raw = readFile(dir);
  if (raw === null) return { overlay: {}, notes: [], fromV1: false, exists: false };
  if (raw.schema === 1) {
    const m = migrateV1(raw);
    return { overlay: m.settings, notes: m.notes, fromV1: true, exists: true };
  }
  return { overlay: raw, notes: [], fromV1: false, exists: true };
}

/** Defaults overlaid with the file, plus the notes a schema 1 migration left. Never writes. A bad value in a schema 2 file throws a SettingsError naming the key. */
export function loadSettingsDetailed(dir: string = dataDir()): { settings: Settings; migrationNotes: string[] } {
  const st = fileState(dir);
  const merged = mergeSettings(defaultSettings(), st.overlay);
  const issues = validateSettings(merged);
  if (issues.length) throw new SettingsError(issues);
  return { settings: merged, migrationNotes: st.notes };
}

/** Defaults overlaid with the file (a schema 1 file is migrated in memory). Never writes. */
export function loadSettings(dir: string = dataDir()): Settings {
  return loadSettingsDetailed(dir).settings;
}

/** Write `next` atomically. When the file on disk is schema 1 it is copied to mk-settings.v1.bak.json first. */
function writeSettings(dir: string, next: Settings, backupV1: boolean): void {
  mkdirSync(dir, { recursive: true });
  const p = settingsPath(dir);
  if (backupV1) {
    try {
      copyFileSync(p, join(dir, 'mk-settings.v1.bak.json'), constants.COPYFILE_EXCL);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      copyFileSync(p, join(dir, `mk-settings.v1.bak-${Date.now()}.json`));
    }
  }
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, p);
}

/**
 * Merge `patch` onto the current settings, validate the result, and replace the file atomically.
 * The file is created on the first save. Throws SettingsError (nothing written) on a bad value.
 */
export function saveSettings(patch: Settings, dir: string = dataDir()): Settings {
  const st = fileState(dir);
  const merged = mergeSettings(mergeSettings(defaultSettings(), st.overlay), patch);
  const issues = validateSettings(merged);
  if (issues.length) throw new SettingsError(issues);
  writeSettings(dir, merged, st.fromV1);
  return merged;
}

/**
 * Remove one top-level group from the file so its defaults show again (C4). Nothing else changes and mk-data.db is
 * never touched. With no file there is nothing to remove and nothing is written. Throws SettingsError for an unknown section.
 */
export function resetSettings(section: string, dir: string = dataDir()): Settings {
  if (!(RESET_SECTIONS as readonly string[]).includes(section)) {
    throw new SettingsError([{ key: 'section', message: `must be one of ${RESET_SECTIONS.join(', ')}` }]);
  }
  const st = fileState(dir);
  if (!st.exists) return defaultSettings();
  const next: Settings = { ...st.overlay, schema: SETTINGS_SCHEMA };
  delete next[section];
  const merged = mergeSettings(defaultSettings(), next);
  const issues = validateSettings(merged);
  if (issues.length) throw new SettingsError(issues);
  writeSettings(dir, next, st.fromV1);
  return merged;
}
