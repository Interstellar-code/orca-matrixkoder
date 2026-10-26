/**
 * Plan file parser and validator (mk-data-schema.md §6.1 and §6.2).
 * A plan is numbered blocks: `+++ 5.2.1 STORE.1 — title [toml]` ... `/+++`. [toml] blocks hold settings,
 * the others Markdown. This module turns the text into a ParsedPlan and a fit (pass | partial | not_a_plan).
 * It reads nothing from disk and writes nothing.
 */
import { SPEC_SCENARIOS } from './settings.js';
// ---------------------------------------------------------------- TOML (the subset plans use)
/** Strings, integers, floats, booleans, bare dates, (multi-line) arrays, `[table]` headers, `#` comments. */
export function parseToml(src) {
    let i = 0;
    const n = src.length;
    const out = {};
    let cur = out;
    const lineAt = (p) => src.slice(0, p).split('\n').length;
    const fail = (msg) => {
        throw new Error(`line ${lineAt(i)}: ${msg}`);
    };
    const skipSpace = () => {
        while (i < n && (src[i] === ' ' || src[i] === '\t' || src[i] === '\r'))
            i++;
    };
    const skipComment = () => {
        if (src[i] === '#')
            while (i < n && src[i] !== '\n')
                i++;
    };
    const skipAny = () => {
        for (;;) {
            skipSpace();
            if (src[i] === '#')
                skipComment();
            else if (src[i] === '\n')
                i++;
            else
                return;
        }
    };
    const readString = () => {
        const q = src[i++];
        let s = '';
        for (;;) {
            if (i >= n || src[i] === '\n')
                fail('string is not closed');
            const c = src[i++];
            if (c === q)
                return s;
            if (q === "'" || c !== '\\') {
                s += c;
                continue;
            }
            const e = src[i++];
            const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\' };
            if (e in simple)
                s += simple[e];
            else if (e === 'u' || e === 'U') {
                const len = e === 'u' ? 4 : 8;
                const hex = src.slice(i, i + len);
                if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len)
                    fail('bad \\u escape');
                s += String.fromCodePoint(parseInt(hex, 16));
                i += len;
            }
            else
                fail(`unknown escape \\${e}`);
        }
    };
    const readValue = () => {
        const c = src[i];
        if (c === '"' || c === "'") {
            if (src.startsWith(c.repeat(3), i))
                fail('multi-line strings are not supported');
            return readString();
        }
        if (c === '[') {
            i++;
            const arr = [];
            for (;;) {
                skipAny();
                if (src[i] === ']') {
                    i++;
                    return arr;
                }
                if (i >= n)
                    fail('array is not closed');
                arr.push(readValue());
                skipAny();
                if (src[i] === ',')
                    i++;
                else if (src[i] !== ']')
                    fail('expected , or ] in array');
            }
        }
        if (c === '{')
            return fail('inline tables are not supported');
        const m = /^[^\s,\]#]+/.exec(src.slice(i));
        if (!m)
            return fail('missing value');
        const tok = m[0];
        i += tok.length;
        if (tok === 'true')
            return true;
        if (tok === 'false')
            return false;
        if (/^[+-]?\d[\d_]*$/.test(tok))
            return parseInt(tok.replace(/_/g, ''), 10);
        if (/^[+-]?\d[\d_]*\.\d+([eE][+-]?\d+)?$/.test(tok))
            return parseFloat(tok.replace(/_/g, ''));
        if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(tok))
            return tok;
        return fail(`cannot read value "${tok}"`);
    };
    while (i < n) {
        skipAny();
        if (i >= n)
            break;
        if (src[i] === '[') {
            if (src[i + 1] === '[')
                fail('arrays of tables are not supported');
            const end = src.indexOf(']', i);
            if (end < 0 || src.slice(i, end).includes('\n'))
                fail('table header is not closed');
            const name = src.slice(i + 1, end).trim();
            if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(name))
                fail(`bad table name "${name}"`);
            cur = out;
            for (const part of name.split('.')) {
                const next = cur[part] ?? (cur[part] = {});
                if (typeof next !== 'object' || Array.isArray(next))
                    fail(`"${name}" is not a table`);
                cur = next;
            }
            i = end + 1;
        }
        else {
            let key;
            if (src[i] === '"' || src[i] === "'")
                key = readString();
            else {
                const m = /^[A-Za-z0-9_-]+/.exec(src.slice(i));
                if (!m)
                    return fail(`cannot read a key at "${src.slice(i, i + 12).split('\n')[0]}"`);
                key = m[0];
                i += key.length;
            }
            skipSpace();
            if (src[i] !== '=')
                fail(`expected = after ${key}`);
            i++;
            skipSpace();
            cur[key] = readValue();
        }
        skipSpace();
        skipComment();
        if (i < n && src[i] !== '\n')
            fail('unexpected text after the value');
    }
    return out;
}
export function scanBlocks(text) {
    const blocks = [];
    const problems = [];
    const lines = text.split(/\r?\n/);
    let open = null;
    lines.forEach((ln, idx) => {
        const h = /^\+\+\+ (\d+(?:\.\d+)*)(?: (.*))?$/.exec(ln);
        if (h) {
            if (open)
                problems.push(`block ${h[1]} opens inside block ${open.num} (line ${idx + 1})`);
            let name = (h[2] ?? '').trim();
            const toml = / ?\[toml\]$/.test(name);
            if (toml)
                name = name.replace(/ ?\[toml\]$/, '');
            open = { num: h[1], name, toml, body: '', line: idx + 1, buf: [] };
            return;
        }
        if (/^\/\+\+\+\s*$/.test(ln)) {
            if (open) {
                const { buf, ...b } = open;
                blocks.push({ ...b, body: buf.join('\n') });
                open = null;
            }
            return;
        }
        if (open)
            open.buf.push(ln);
    });
    if (open)
        problems.push(`block ${open.num} is never closed`);
    return { blocks, problems };
}
const MAX_BYTES = 1024 * 1024;
const SLUG = /^[a-z0-9-]+$/;
const SIZES = ['trivial', 'standard', 'complex'];
const REQUIRED_BLOCKS = [
    ['2', 'Summary'], ['3', 'Goal'], ['6', 'Gates'], ['7', 'Risks'], ['8', 'Open questions'], ['9', 'Log'],
];
const strs = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : v === undefined ? [] : null;
const idsIn = (s) => (/^\s*(none|nothing|-)\b/i.test(s) ? [] : [...new Set(s.match(/\b[A-Z][A-Z0-9]*\d*(?:\.\d+)*\b/g) ?? [])]);
const bulletOf = (body, label) => {
    const m = new RegExp(`^- ${label}:\\s*(.*)$`, 'mi').exec(body);
    return m ? m[1].trim() : null;
};
/** Text after the `# id — ` prefix of the summary heading; else the first `# ` heading. */
function planTitle(summary, all) {
    for (const src of [summary, all]) {
        if (!src)
            continue;
        const m = /^# (.+)$/m.exec(src);
        if (m) {
            const h = m[1].trim();
            const k = h.indexOf(' — ');
            return k > 0 ? h.slice(k + 3).trim() : h;
        }
    }
    return null;
}
const dateMs = (v) => {
    if (typeof v !== 'string')
        return null;
    const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v);
    return Number.isNaN(t) ? null : t;
};
export function parsePlan(text) {
    const bad = (reason) => ({ fit: 'not_a_plan', missing: [reason], slug: null, title: null, plan: null });
    if (Buffer.byteLength(text) > MAX_BYTES)
        return bad('file is over 1 MB');
    const { blocks, problems } = scanBlocks(text);
    if (problems.length)
        return bad(problems[0]);
    const byNum = new Map();
    const missing = [];
    const scenarioOf = (v, label) => {
        if (v === undefined)
            return null;
        if (typeof v === 'string' && SPEC_SCENARIOS.includes(v))
            return v;
        missing.push(`${label}: scenario must be one of ${SPEC_SCENARIOS.join(', ')}`);
        return null;
    };
    for (const b of blocks) {
        if (byNum.has(b.num))
            missing.push(`duplicate block ${b.num}`);
        else
            byNum.set(b.num, b);
    }
    // Block 1: the plan's identity. Without it there is no plan.
    const top = byNum.get('1');
    if (!top)
        return bad('no block 1 (top block)');
    let topToml;
    try {
        topToml = parseToml(top.body);
    }
    catch (e) {
        return bad(`block 1 is not valid TOML: ${e.message}`);
    }
    const slug = topToml.plan;
    if (typeof slug !== 'string' || slug === '')
        return bad('block 1 has no plan key');
    if (!SLUG.test(slug))
        return bad(`plan "${slug}" must be lowercase letters, digits and dashes`);
    const title = planTitle(byNum.get('2')?.body, text) ?? slug;
    for (const [num, name] of REQUIRED_BLOCKS)
        if (!byNum.has(num))
            missing.push(`Block ${num} ${name}`);
    // Phases and tasks, grouped by the block numbers 5.n / 5.n.0 / 5.n.m / 5.n.m.k.
    const phaseNums = new Set();
    for (const b of blocks) {
        const m = /^5\.(\d+)(?:\.|$)/.exec(b.num);
        if (m)
            phaseNums.add(Number(m[1]));
    }
    const tomlOf = (b, label) => {
        try {
            return parseToml(b.body);
        }
        catch (e) {
            missing.push(`${label}: ${e.message}`);
            return null;
        }
    };
    const phases = [];
    for (const n of [...phaseNums].sort((a, b) => a - b)) {
        const textBlock = byNum.get(`5.${n}`);
        const settingsBlock = byNum.get(`5.${n}.0`);
        const label = `phase 5.${n}`;
        const s = settingsBlock ? (tomlOf(settingsBlock, label) ?? {}) : {};
        if (!settingsBlock)
            missing.push(`${label}: settings block 5.${n}.0`);
        const code = typeof s.id === 'string' && s.id ? s.id : `5.${n}`;
        const L = `phase ${code}`;
        const heading = textBlock ? /^### (.+)$/m.exec(textBlock.body)?.[1] : undefined;
        const phTitle = typeof s.title === 'string' && s.title ? s.title : (heading?.split(' — ').slice(1).join(' — ') ?? '');
        for (const k of ['id', 'title', 'wave', 'owned', 'commit'])
            if (s[k] === undefined)
                missing.push(`${L}: ${k}`);
        const wave = typeof s.wave === 'number' && Number.isInteger(s.wave) && s.wave >= 1 ? s.wave : 1;
        if (s.wave !== undefined && wave !== s.wave)
            missing.push(`${L}: wave must be a whole number from 1`);
        const list = (k) => {
            const v = strs(s[k]);
            if (v === null)
                missing.push(`${L}: ${k} must be a list of strings`);
            return v ?? [];
        };
        const size = typeof s.size === 'string' && SIZES.includes(s.size) ? s.size : null;
        if (s.size !== undefined && size === null)
            missing.push(`${L}: size must be trivial, standard or complex`);
        const phScenario = scenarioOf(s.scenario, L);
        const body = textBlock?.body ?? '';
        const tasks = [];
        const taskNums = [...byNum.keys()]
            .map((k) => new RegExp(`^5\\.${n}\\.(\\d+)$`).exec(k))
            .filter((m) => !!m && m[1] !== '0')
            .map((m) => Number(m[1]))
            .sort((a, b) => a - b);
        for (const m of taskNums) {
            const tb = byNum.get(`5.${n}.${m}`);
            const TL = `task 5.${n}.${m}`;
            const t = tomlOf(tb, TL);
            if (!t)
                continue;
            if (typeof t.id !== 'string' || !t.id)
                missing.push(`${TL}: id`);
            if (typeof t.title !== 'string' || !t.title)
                missing.push(`${TL}: title`);
            if (typeof t.id !== 'string' || !t.id)
                continue;
            const tl = (k) => {
                const v = strs(t[k]);
                if (v === null)
                    missing.push(`task ${t.id}: ${k} must be a list of strings`);
                return v ?? [];
            };
            const risk = typeof t.risk === 'number' && Number.isInteger(t.risk) && t.risk >= 1 && t.risk <= 5 ? t.risk : 1;
            if (t.risk !== undefined && risk !== t.risk)
                missing.push(`task ${t.id}: risk must be a whole number from 1 to 5`);
            const tsize = typeof t.size === 'string' && SIZES.includes(t.size) ? t.size : null;
            if (t.size !== undefined && tsize === null)
                missing.push(`task ${t.id}: size must be trivial, standard or complex`);
            const taskScenario = scenarioOf(t.scenario, `task ${t.id}`) ?? phScenario;
            const subtasks = [];
            const subNums = [...byNum.keys()]
                .map((k) => new RegExp(`^5\\.${n}\\.${m}\\.(\\d+)$`).exec(k))
                .filter((x) => !!x)
                .map((x) => Number(x[1]))
                .sort((a, b) => a - b);
            for (const k of subNums) {
                const sb = byNum.get(`5.${n}.${m}.${k}`);
                const st = tomlOf(sb, `subtask 5.${n}.${m}.${k}`);
                if (!st)
                    continue;
                if (typeof st.id !== 'string' || !st.id)
                    missing.push(`subtask 5.${n}.${m}.${k}: id`);
                if (typeof st.title !== 'string' || !st.title)
                    missing.push(`subtask 5.${n}.${m}.${k}: title`);
                if (typeof st.id !== 'string' || !st.id)
                    continue;
                const sl = (key) => strs(st[key]) ?? [];
                subtasks.push({
                    code: st.id, ord: k, parentBlock: `5.${n}.${m}`, title: String(st.title ?? ''),
                    description: typeof st.description === 'string' ? st.description : null,
                    acceptance: sl('acceptance'), deps: sl('deps'), owned: sl('owned'),
                });
            }
            tasks.push({
                code: t.id, ord: m, title: String(t.title ?? ''),
                description: typeof t.description === 'string' ? t.description : null,
                acceptance: tl('acceptance'), covers: tl('covers'), deps: tl('deps'), owned: tl('owned'), refs: tl('refs'),
                risk, size: tsize,
                gate: typeof t.gate === 'string' ? t.gate : null,
                manual: typeof t.manual === 'string' ? t.manual : null,
                route: typeof t.route === 'string' ? t.route : '',
                subagent: t.subagent === true, parallel: t.parallel === true, scenario: taskScenario,
                subtasks,
            });
        }
        phases.push({
            code, ord: n, title: phTitle, goal: bulletOf(body, 'Goal'),
            wave, laneGroup: typeof s.lane_group === 'string' ? s.lane_group : '',
            deps: list('deps'), owned: list('owned'), forbidden: list('forbidden'), qa: list('qa'),
            commit: typeof s.commit === 'string' ? s.commit : null,
            size, route: typeof s.route === 'string' ? s.route : '',
            reviewer: typeof s.reviewer === 'string' ? s.reviewer : '',
            subagents: s.subagents === undefined ? true : s.subagents === true, scenario: phScenario,
            serves: idsIn(bulletOf(body, 'Serves') ?? ''), hazards: idsIn(bulletOf(body, 'Hazards') ?? ''),
            carries: idsIn(bulletOf(body, 'Carries') ?? ''), buildOrder: bulletOf(body, 'Build order'),
            tasks,
        });
    }
    if (phases.length === 0 && ![...byNum.keys()].some((k) => /^5\.\d+\.[1-9]/.test(k))) {
        return bad('no phase or task blocks');
    }
    const items = parseItems(byNum, missing);
    // Cross-references.
    const goalIds = new Set(items.filter((i) => i.kind === 'goal').map((i) => i.code));
    const block4 = new Set(items.filter((i) => ['contract', 'test', 'assumption', 'rollout', 'setting'].includes(i.kind)).map((i) => i.code));
    const phaseCodes = new Set();
    const taskCodes = new Set();
    const allCodes = new Set();
    // A duplicate id is reported and only its first holder is kept: codes are unique per plan in the database.
    const claim = (code, set) => {
        if (allCodes.has(code)) {
            missing.push(`duplicate id ${code}`);
            return false;
        }
        allCodes.add(code);
        set.add(code);
        return true;
    };
    for (let pi = phases.length - 1; pi >= 0; pi--)
        if (phases.slice(0, pi).some((o) => o.code === phases[pi].code)) {
            missing.push(`duplicate id ${phases[pi].code}`);
            phases.splice(pi, 1);
        }
    for (const ph of phases) {
        claim(ph.code, phaseCodes);
        ph.tasks = ph.tasks.filter((t) => claim(t.code, taskCodes));
        for (const t of ph.tasks)
            t.subtasks = t.subtasks.filter((s) => claim(s.code, taskCodes));
    }
    const known = (d) => d.includes(':') || allCodes.has(d);
    for (const ph of phases) {
        for (const d of ph.deps)
            if (!d.includes(':') && !phaseCodes.has(d))
                missing.push(`phase ${ph.code}: deps names unknown phase ${d}`);
        for (const g of ph.serves)
            if (goalIds.size && !goalIds.has(g))
                missing.push(`phase ${ph.code}: Serves names unknown goal ${g}`);
        for (const t of ph.tasks) {
            for (const d of t.deps)
                if (!known(d))
                    missing.push(`task ${t.code}: deps names unknown id ${d}`);
            for (const c of t.covers)
                if (!block4.has(c))
                    missing.push(`task ${t.code}: covers names unknown id ${c}`);
            for (const s of t.subtasks)
                for (const d of s.deps)
                    if (!known(d))
                        missing.push(`subtask ${s.code}: deps names unknown id ${d}`);
        }
    }
    const fileStatus = typeof topToml.status === 'string' ? topToml.status : null;
    const plan = {
        slug, title, fileStatus,
        integration: typeof topToml.integration === 'string' ? topToml.integration : null,
        pushed: topToml.pushed === true,
        createdAt: dateMs(topToml.created),
        phases, items,
    };
    const uniq = [...new Set(missing)];
    return { fit: uniq.length ? 'partial' : 'pass', missing: uniq, slug, title, plan };
}
// ---------------------------------------------------------------- items (blocks 3, 4, 6, 7, 8, 9)
const bullets = (body) => (body ?? '').split('\n').filter((l) => /^\s*- /.test(l)).map((l) => l.replace(/^\s*- /, '').trim());
function parseItems(byNum, missing) {
    const items = [];
    const push = (kind, code, text, data = {}, done = false) => {
        items.push({ kind, code, text, data, done });
    };
    // 3 Goal: "- Done when:" then indented "- G1 — ..." lines; then Why / From / Sources.
    for (const l of (byNum.get('3')?.body ?? '').split('\n')) {
        const g = /^\s+- (G\d+) — (.*)$/.exec(l);
        if (g)
            push('goal', g[1], g[2].trim());
        const m = /^- (Why|From|Sources):\s*(.*)$/.exec(l);
        if (m)
            push('meta', m[1].toLowerCase(), m[2].trim());
    }
    // 4 Design / context: C contracts, T tests, A assumptions, R rollout, S settings.
    const kinds = { C: 'contract', T: 'test', A: 'assumption', R: 'rollout', S: 'setting' };
    for (const l of (byNum.get('4')?.body ?? '').split('\n')) {
        const m = /^([CTARS]\d+) — (.*)$/.exec(l);
        if (!m)
            continue;
        const kind = kinds[m[1][0]];
        const data = {};
        if (kind === 'test') {
            const parts = m[2].split(' — ').map((p) => p.trim());
            const wb = /^written by (.+)$/.exec(parts[parts.length - 1] ?? '');
            if (wb) {
                data.written_by = wb[1];
                const fileMatch = /`([^`]+)`/.exec(parts[parts.length - 2] ?? '');
                if (fileMatch)
                    data.file = fileMatch[1];
                if (parts.length >= 4)
                    data.level = parts[parts.length - 3];
            }
        }
        push(kind, m[1], m[2].trim(), data);
    }
    // 6 Gates: "- name — proves G1, G2 — what" plus 6.0 settings (use, timeout, [extra]).
    const gateToml = byNum.get('6.0') ? safeToml(byNum.get('6.0'), '6.0 gate settings', missing) : {};
    const extra = (typeof gateToml.extra === 'object' && !Array.isArray(gateToml.extra) ? gateToml.extra : {});
    const timeout = typeof gateToml.timeout === 'number' ? gateToml.timeout : 600;
    for (const l of bullets(byNum.get('6')?.body)) {
        const parts = l.split(' — ').map((p) => p.trim());
        const name = parts[0];
        const proves = (parts.find((p) => p.startsWith('proves ')) ?? '').replace(/^proves /, '').split(/[,\s]+/).filter(Boolean);
        const isExtra = typeof extra[name] === 'string';
        push('gate', name, parts.slice(2).join(' — ') || name, { proves, command: isExtra ? extra[name] : name, timeout, extra: isExtra });
    }
    // 7 Risks: "- K1 — what — level 4 — guard: ... — ref"
    for (const l of bullets(byNum.get('7')?.body)) {
        const parts = l.split(' — ').map((p) => p.trim());
        const id = /^(K\d+)$/.exec(parts[0]);
        if (!id)
            continue;
        const lv = parts.findIndex((p) => /^level \d$/.test(p));
        const level = lv > 0 ? Number(parts[lv].slice(6)) : null;
        const end = lv > 0 ? lv : parts.length;
        push('risk', id[1], parts.slice(1, end).join(' — '), {
            level, guard: lv > 0 ? (parts[lv + 1] ?? '').replace(/^guard:\s*/, '') : '', ref: lv > 0 ? parts.slice(lv + 2).join(' — ') : '',
        });
    }
    // 8 Open questions: "- [x] Q1 — question — blocks: X — pick: Y"
    for (const l of bullets(byNum.get('8')?.body)) {
        const m = /^\[( |x|X)\] (Q\d+) — (.*)$/.exec(l);
        if (!m)
            continue;
        const parts = m[3].split(' — ').map((p) => p.trim());
        const bi = parts.findIndex((p) => p.startsWith('blocks:'));
        const pi = parts.findIndex((p, i) => i > bi && p.startsWith('pick:'));
        const qEnd = bi > 0 ? bi : pi > 0 ? pi : parts.length;
        push('question', m[2], parts.slice(0, qEnd).join(' — '), {
            blocks: bi >= 0 ? parts[bi].replace(/^blocks:\s*/, '') : '',
            pick: pi >= 0 ? parts.slice(pi).join(' — ').replace(/^pick:\s*/, '') : '',
        }, m[1] !== ' ');
    }
    // 9 Log: "- 2026-10-24 — kind — text — who"
    for (const l of bullets(byNum.get('9')?.body)) {
        const parts = l.split(' — ').map((p) => p.trim());
        if (parts.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0]))
            continue;
        const who = parts.length >= 4 ? parts[parts.length - 1] : '';
        push('log', null, parts.slice(2, parts.length >= 4 ? -1 : undefined).join(' — '), { date: parts[0], kind: parts[1], who });
    }
    return items;
}
function safeToml(b, label, missing) {
    try {
        return parseToml(b.body);
    }
    catch (e) {
        missing.push(`${label}: ${e.message}`);
        return {};
    }
}
