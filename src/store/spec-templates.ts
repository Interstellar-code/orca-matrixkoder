/**
 * C10: task spec templates. A brief sent to an agent is rendered from a scenario's template: the user's file when
 * `work.specTemplates.<scenario>` names a usable one, else the built-in compiled into `spec-builtin.ts`.
 *
 * Rendering rules:
 *  - `{{name}}` placeholders; the known set is the union of the task and bug sets. A known placeholder with no
 *    value renders empty, and a line whose placeholders all rendered empty is dropped. A name outside the union
 *    makes the whole user template fall back to the built-in, with a warning.
 *  - A list value is "\n- a\n- b" (leading newline), so `Acceptance:{{acceptance}}` prints the label and the items
 *    and, with no items, is dropped whole.
 *  - `{{rules}}` carries the C7 advisory section and the C8 solo line. A template without it still gets the rules,
 *    appended after the rendered text, with a warning.
 *  - The `mk-ref:` line is written here, first, outside the template, so crash recovery never depends on one.
 * Every fallback is returned in `warnings[]`, and `templateStatus` reports the same facts for the Work screen.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { SPEC_BUILTIN } from './spec-builtin.js';
import { setting, SPEC_SCENARIOS, TEMPLATE_HOME_PREFIX, type Settings } from './settings.js';

export type SpecScenario = (typeof SPEC_SCENARIOS)[number];

export const MAX_TEMPLATE_BYTES = 32 * 1024;

/** Task set plus the bug additions. */
export const SPEC_PLACEHOLDERS = [
  'code', 'title', 'phase', 'risk', 'size', 'attempt', 'description', 'acceptance', 'owned', 'gate', 'manual', 'deps', 'rules', 'repo',
  'bugId', 'file', 'line', 'details',
] as const;
const KNOWN = new Set<string>(SPEC_PLACEHOLDERS);
export type SpecVals = Partial<Record<(typeof SPEC_PLACEHOLDERS)[number], string>>;

export interface TemplateStatus {
  path: string;
  source: 'builtin' | 'file';
  ok: boolean;
  issue: string | null;
}

export interface TemplateEnv {
  /** MK data dir: `~/.matrixkoder/templates/...` resolves under it. */
  dir: string;
  /** The repo a repo-relative template path resolves under; '' when unknown. */
  repoPath: string;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const hasRules = (body: string): boolean => [...body.matchAll(PLACEHOLDER)].some((m) => m[1] === 'rules');

/** First match wins: explicit task scenario, a retry, a bug fix, else implement. A phase's `subagents` plays no part. */
export function pickScenario(o: { explicit?: string | null; attempt?: number; bug?: boolean }): SpecScenario {
  if (o.explicit && (SPEC_SCENARIOS as readonly string[]).includes(o.explicit)) return o.explicit as SpecScenario;
  if ((o.attempt ?? 1) > 1 || o.bug) return 'fix';
  return 'implement';
}

/** "\n- a\n- b", or '' for no items. */
export const listValue = (items: readonly string[]): string => (items.length ? `\n${items.map((x) => `- ${x}`).join('\n')}` : '');

/** C7/C8: advisory rules from settings. MK does not filter anything an agent does; this only tells it. */
export function rulesLines(settings: Settings): string[] {
  const branches = setting<string[]>(settings, 'safety.protectedBranches');
  const never = setting<string[]>(settings, 'safety.neverRun');
  const lines: string[] = [];
  if (branches.length) lines.push(`- Protected branches (never commit or merge to them): ${branches.join(', ')}`);
  if (never.length) lines.push('- Never run these commands:', ...never.map((x) => `  - ${x}`));
  if (setting<boolean>(settings, 'safety.askBeforePush')) lines.push('- Ask before any push');
  if (setting<string>(settings, 'general.mode') === 'solo') {
    lines.push('- Solo mode: work in this checkout; use in-session subagents for parallel parts, not Orca lanes or worktrees');
  }
  return lines.length ? ['Rules from MatrixKoder settings:', ...lines] : [];
}

type Resolved = { abs: string } | { issue: string };

function resolveTemplatePath(value: string, env: TemplateEnv): Resolved {
  let root: string;
  let rel: string;
  if (value.startsWith(TEMPLATE_HOME_PREFIX)) {
    root = join(env.dir, 'templates');
    rel = value.slice(TEMPLATE_HOME_PREFIX.length);
  } else {
    if (!env.repoPath) return { issue: 'the repo path is unknown, so a repo-relative template cannot be found' };
    root = env.repoPath;
    rel = value;
  }
  if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return { issue: 'the path must be relative and must not contain ".."' };
  const abs = resolve(root, rel);
  const inside = (base: string, p: string): boolean => {
    const r = relative(base, p);
    return r !== '' && !r.startsWith('..') && !isAbsolute(r);
  };
  if (!inside(root, abs)) return { issue: 'the path leaves its root folder' };
  // A symlink inside the root must not lead out of it.
  try {
    if (!inside(realpathSync(root), realpathSync(abs))) return { issue: 'the path leaves its root folder through a link' };
  } catch {
    /* a missing file is reported by the read below */
  }
  return { abs };
}

const cache = new Map<string, { mtimeMs: number; size: number; text: string }>();

function readTemplateFile(abs: string): { text: string } | { issue: string } {
  try {
    const st = statSync(abs);
    if (!st.isFile()) return { issue: 'it is not a file' };
    if (st.size > MAX_TEMPLATE_BYTES) return { issue: `the file is ${Math.ceil(st.size / 1024)} KB; the limit is 32 KB` };
    const hit = cache.get(abs);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return { text: hit.text };
    const text = readFileSync(abs, 'utf8');
    cache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, text });
    return { text };
  } catch (e) {
    return { issue: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'the file does not exist' : 'the file cannot be read' };
  }
}

interface Loaded {
  status: TemplateStatus;
  body: string;
  /** One line when a configured file was not used; the built-in stands in. */
  warning: string | null;
}

/** The template body for a scenario, with the status the Work screen shows. Never throws. */
export function loadTemplate(settings: Settings, scenario: SpecScenario, env: TemplateEnv): Loaded {
  const path = String(setting<string>(settings, `work.specTemplates.${scenario}`) ?? '');
  const builtin = SPEC_BUILTIN[scenario];
  if (!path) return { status: { path: '', source: 'builtin', ok: true, issue: null }, body: builtin, warning: null };
  const miss = (issue: string): Loaded => ({
    status: { path, source: 'builtin', ok: false, issue },
    body: builtin,
    warning: `spec template for ${scenario} (${path}) not used: ${issue}; using the built-in template`,
  });
  const r = resolveTemplatePath(path, env);
  if ('issue' in r) return miss(r.issue);
  const f = readTemplateFile(r.abs);
  if ('issue' in f) return miss(f.issue);
  const unknown = [...new Set([...f.text.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((n) => !KNOWN.has(n)))];
  if (unknown.length) return miss(`unknown placeholder ${unknown.map((n) => `{{${n}}}`).join(', ')}`);
  const note = hasRules(f.text) ? null : 'it has no {{rules}}, so the rules section is appended after it';
  return { status: { path, source: 'file', ok: true, issue: note }, body: f.text, warning: null };
}

/** Status of all five scenarios, for the snapshot. */
export function templateStatuses(settings: Settings, env: TemplateEnv): Record<SpecScenario, TemplateStatus> {
  return Object.fromEntries(SPEC_SCENARIOS.map((s) => [s, loadTemplate(settings, s, env).status])) as Record<SpecScenario, TemplateStatus>;
}

function fill(body: string, vals: SpecVals): string {
  const out: string[] = [];
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    let any = false;
    let nonEmpty = false;
    const text = line.replace(PLACEHOLDER, (_m, name: string) => {
      any = true;
      const v = vals[name as keyof SpecVals] ?? '';
      if (v !== '') nonEmpty = true;
      return v;
    });
    if (any && !nonEmpty) continue;
    for (const l of text.split('\n')) out.push(l.trimEnd());
  }
  // No run of blank lines, none at either end.
  const tidy: string[] = [];
  for (const l of out) if (!(l === '' && (tidy.length === 0 || tidy[tidy.length - 1] === ''))) tidy.push(l);
  while (tidy.length && tidy[tidy.length - 1] === '') tidy.pop();
  return tidy.join('\n');
}

export interface RenderedSpec {
  text: string;
  warnings: string[];
  scenario: SpecScenario;
}

/** `mk-ref:` line, then the scenario's template filled with `vals` (rules come from `rules`, not `vals`). */
export function renderSpec(o: { ref: string; scenario: SpecScenario; vals: SpecVals; rules: string[]; settings: Settings; env: TemplateEnv }): RenderedSpec {
  const loaded = loadTemplate(o.settings, o.scenario, o.env);
  const warnings = loaded.warning ? [loaded.warning] : [];
  const rules = o.rules.join('\n');
  let text = fill(loaded.body, { ...o.vals, rules });
  if (rules && !hasRules(loaded.body)) {
    text = `${text}\n\n${rules}`;
    warnings.push(`spec template for ${o.scenario} (${loaded.status.path}) has no {{rules}}; the rules section was appended`);
  }
  return { text: `${o.ref}\n\n${text}`, warnings, scenario: o.scenario };
}
