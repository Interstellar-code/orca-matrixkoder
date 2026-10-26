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
import { setting, SPEC_SCENARIOS, TEMPLATE_HOME_PREFIX } from './settings.js';
export const MAX_TEMPLATE_BYTES = 32 * 1024;
/** Task set plus the bug additions. */
export const SPEC_PLACEHOLDERS = [
    'code', 'title', 'phase', 'risk', 'size', 'attempt', 'description', 'acceptance', 'owned', 'gate', 'manual', 'deps', 'rules', 'repo',
    'bugId', 'file', 'line', 'details',
];
const KNOWN = new Set(SPEC_PLACEHOLDERS);
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const hasRules = (body) => [...body.matchAll(PLACEHOLDER)].some((m) => m[1] === 'rules');
/** First match wins: explicit task scenario, a retry, a bug fix, else implement. A phase's `subagents` plays no part. */
export function pickScenario(o) {
    if (o.explicit && SPEC_SCENARIOS.includes(o.explicit))
        return o.explicit;
    if ((o.attempt ?? 1) > 1 || o.bug)
        return 'fix';
    return 'implement';
}
/** "\n- a\n- b", or '' for no items. */
export const listValue = (items) => (items.length ? `\n${items.map((x) => `- ${x}`).join('\n')}` : '');
/** C7/C8: advisory rules from settings. MK does not filter anything an agent does; this only tells it. */
export function rulesLines(settings) {
    const branches = setting(settings, 'safety.protectedBranches');
    const never = setting(settings, 'safety.neverRun');
    const lines = [];
    if (branches.length)
        lines.push(`- Protected branches (never commit or merge to them): ${branches.join(', ')}`);
    if (never.length)
        lines.push('- Never run these commands:', ...never.map((x) => `  - ${x}`));
    if (setting(settings, 'safety.askBeforePush'))
        lines.push('- Ask before any push');
    if (setting(settings, 'general.mode') === 'solo') {
        lines.push('- Solo mode: work in this checkout; use in-session subagents for parallel parts, not Orca lanes or worktrees');
    }
    return lines.length ? ['Rules from MatrixKoder settings:', ...lines] : [];
}
function resolveTemplatePath(value, env) {
    let root;
    let rel;
    if (value.startsWith(TEMPLATE_HOME_PREFIX)) {
        root = join(env.dir, 'templates');
        rel = value.slice(TEMPLATE_HOME_PREFIX.length);
    }
    else {
        if (!env.repoPath)
            return { issue: 'the repo path is unknown, so a repo-relative template cannot be found' };
        root = env.repoPath;
        rel = value;
    }
    if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..'))
        return { issue: 'the path must be relative and must not contain ".."' };
    const abs = resolve(root, rel);
    const inside = (base, p) => {
        const r = relative(base, p);
        return r !== '' && !r.startsWith('..') && !isAbsolute(r);
    };
    if (!inside(root, abs))
        return { issue: 'the path leaves its root folder' };
    // A symlink inside the root must not lead out of it.
    try {
        if (!inside(realpathSync(root), realpathSync(abs)))
            return { issue: 'the path leaves its root folder through a link' };
    }
    catch {
        /* a missing file is reported by the read below */
    }
    return { abs };
}
const cache = new Map();
function readTemplateFile(abs) {
    try {
        const st = statSync(abs);
        if (!st.isFile())
            return { issue: 'it is not a file' };
        if (st.size > MAX_TEMPLATE_BYTES)
            return { issue: `the file is ${Math.ceil(st.size / 1024)} KB; the limit is 32 KB` };
        const hit = cache.get(abs);
        if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size)
            return { text: hit.text };
        const text = readFileSync(abs, 'utf8');
        cache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, text });
        return { text };
    }
    catch (e) {
        return { issue: e.code === 'ENOENT' ? 'the file does not exist' : 'the file cannot be read' };
    }
}
/** The template body for a scenario, with the status the Work screen shows. Never throws. */
export function loadTemplate(settings, scenario, env) {
    const path = String(setting(settings, `work.specTemplates.${scenario}`) ?? '');
    const builtin = SPEC_BUILTIN[scenario];
    if (!path)
        return { status: { path: '', source: 'builtin', ok: true, issue: null }, body: builtin, warning: null };
    const miss = (issue) => ({
        status: { path, source: 'builtin', ok: false, issue },
        body: builtin,
        warning: `spec template for ${scenario} (${path}) not used: ${issue}; using the built-in template`,
    });
    const r = resolveTemplatePath(path, env);
    if ('issue' in r)
        return miss(r.issue);
    const f = readTemplateFile(r.abs);
    if ('issue' in f)
        return miss(f.issue);
    const unknown = [...new Set([...f.text.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((n) => !KNOWN.has(n)))];
    if (unknown.length)
        return miss(`unknown placeholder ${unknown.map((n) => `{{${n}}}`).join(', ')}`);
    const note = hasRules(f.text) ? null : 'it has no {{rules}}, so the rules section is appended after it';
    return { status: { path, source: 'file', ok: true, issue: note }, body: f.text, warning: null };
}
/** Status of all five scenarios, for the snapshot. */
export function templateStatuses(settings, env) {
    return Object.fromEntries(SPEC_SCENARIOS.map((s) => [s, loadTemplate(settings, s, env).status]));
}
function fill(body, vals) {
    const out = [];
    for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
        let any = false;
        let nonEmpty = false;
        const text = line.replace(PLACEHOLDER, (_m, name) => {
            any = true;
            const v = vals[name] ?? '';
            if (v !== '')
                nonEmpty = true;
            return v;
        });
        if (any && !nonEmpty)
            continue;
        for (const l of text.split('\n'))
            out.push(l.trimEnd());
    }
    // No run of blank lines, none at either end.
    const tidy = [];
    for (const l of out)
        if (!(l === '' && (tidy.length === 0 || tidy[tidy.length - 1] === '')))
            tidy.push(l);
    while (tidy.length && tidy[tidy.length - 1] === '')
        tidy.pop();
    return tidy.join('\n');
}
/** `mk-ref:` line, then the scenario's template filled with `vals` (rules come from `rules`, not `vals`). */
export function renderSpec(o) {
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
