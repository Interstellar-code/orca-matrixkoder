/**
 * Settings schema 1 -> 2 (contract C2). Pure: it takes the parsed v1 file and returns what the file contributes on
 * top of the v2 defaults, plus a note for every value it had to clamp or replace. It writes nothing; `loadSettings`
 * runs it in memory and the first `saveSettings` replaces the file (after copying it to mk-settings.v1.bak.json).
 * Only v1 values that differ from V1_DEFAULTS are carried, so a user who never touched a v1 default gets the v2 one.
 */
import { defaultSettings, EFFORTS, getPath, mergeSettings, normalizeValue, validateSettings, SETTINGS_SCHEMA, UNSAFE_KEYS } from './settings.js';
/** The v1 defaults, moved here from settings.ts. */
export const V1_DEFAULTS = {
    schema: 1,
    general: { mode: 'orchestrator', openOnStart: 'projects', activeRepo: null },
    agents: {
        claude: { routable: true, model: 'sonnet 5.5', effort: 'medium' },
        codex: { routable: true, model: '', effort: 'medium' },
        agy: { routable: true, model: '', effort: 'medium' },
        opencode: { routable: true, model: '', effort: 'medium' },
    },
    routing: {
        useJev: true,
        lowConfidence: 'risk-based',
        askBeforeDestructive: true,
        tiers: {
            trivial: 'claude haiku low',
            standard: 'claude sonnet medium',
            complex: 'claude opus high',
            finalReview: 'claude fable max',
        },
        maxLanes: 3,
        spareClaudeBelowPct: 30,
    },
    safety: {
        blockDestructiveGit: true,
        blockDeleteOutsideWorktree: true,
        askBeforePush: true,
        scanDiffsForSecrets: true,
        protectedBranches: ['main', 'release/*'],
        neverRun: ['git reset --hard', 'git push --force', 'git clean -fdx', 'rm -rf ~', 'npm publish'],
    },
    alerts: {
        events: { ask: true, laneDone: true, gateFail: true, runDone: true, stall: false },
        desktop: true,
        quietHours: { enabled: false, from: '22:00', to: '07:00' },
        wakeOrchestrator: false,
        stallMinutes: 10,
        dashboard: { autoOpen: true, chip: true, toasts: true },
        usagePollMin: 5,
    },
    theme: {
        rain: { enabled: true, brightness: 60, speed: 'normal' },
        reduceMotion: false,
        textSize: 'M',
        density: 'comfy',
    },
    shortcuts: { footer: ['improve'] },
};
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** v1 paths whose values are not carried (C2 "Dropped"); a prefix drops everything below it. */
const DROPPED = [
    'routing.useJev', 'routing.lowConfidence', 'routing.tiers.finalReview',
    'safety.blockDestructiveGit', 'safety.blockDeleteOutsideWorktree', 'safety.scanDiffsForSecrets',
    'alerts.events.runDone', 'alerts.desktop', 'alerts.dashboard', 'shortcuts',
];
/** v1 paths that map to a v2 path with the same value. */
const RENAMED = {
    'routing.maxLanes': 'routing.maxLanes',
    'theme.rain.enabled': 'look.rain.enabled',
    'theme.rain.brightness': 'look.rain.brightness',
    'theme.rain.speed': 'look.rain.speed',
    'theme.textSize': 'look.textSize',
    'theme.density': 'look.density',
    'alerts.events.ask': 'notify.events.ask',
    'alerts.events.laneDone': 'notify.events.laneDone',
    'alerts.events.stall': 'notify.events.stall',
    'alerts.events.gateFail': 'notify.events.taskFailed',
    'alerts.quietHours.enabled': 'notify.quietHours.enabled',
    'alerts.quietHours.from': 'notify.quietHours.from',
    'alerts.quietHours.to': 'notify.quietHours.to',
    'alerts.wakeOrchestrator': 'notify.wakeOrchestrator',
    'alerts.stallMinutes': 'lanes.stallMinutes',
    'routing.tiers.trivial': 'routing.bySize.trivial',
    'routing.tiers.standard': 'routing.bySize.standard',
    'routing.tiers.complex': 'routing.bySize.complex',
    'safety.protectedBranches': 'safety.protectedBranches',
    'safety.neverRun': 'safety.neverRun',
    'safety.askBeforePush': 'safety.askBeforePush',
    'general.activeRepo': 'general.activeRepo',
    'general.mode': 'general.mode',
};
/** v1 container paths: a value that is not an object here is dropped with a note instead of kept as an unknown key. */
const V1_CONTAINERS = [
    'general', 'agents', 'routing', 'routing.tiers', 'safety', 'alerts', 'alerts.events', 'alerts.quietHours', 'alerts.dashboard',
    'theme', 'theme.rain', 'shortcuts',
];
function setPath(root, path, value) {
    const parts = path.split('.');
    if (parts.some((p) => UNSAFE_KEYS.includes(p)))
        return;
    let cur = root;
    for (const p of parts.slice(0, -1)) {
        if (!isObj(cur[p]))
            cur[p] = {};
        cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
}
function delPath(root, path) {
    const parts = path.split('.');
    if (parts.some((p) => UNSAFE_KEYS.includes(p)))
        return false;
    let cur = root;
    for (const p of parts.slice(0, -1)) {
        if (!isObj(cur))
            return false;
        cur = cur[p];
    }
    if (!isObj(cur) || !(parts[parts.length - 1] in cur))
        return false;
    delete cur[parts[parts.length - 1]];
    return true;
}
const dropped = (path) => DROPPED.some((d) => path === d || path.startsWith(`${d}.`));
/** Migrate a parsed schema 1 file. Never throws; a value that cannot be used is replaced by its default and listed in `notes`. */
export function migrateV1(v1) {
    const out = {};
    const notes = [];
    const carry = (from, to, value, transform) => {
        if (same(value, getPath(V1_DEFAULTS, from.split('.'))))
            return;
        let v = value;
        if (transform)
            v = transform(value);
        if (v === undefined) {
            notes.push(`${from}: unusable value ${JSON.stringify(value)?.slice(0, 40)}; the default for ${to} was used`);
            return;
        }
        const n = normalizeValue(to, v);
        if (n.note)
            notes.push(`${from} -> ${n.note}`);
        setPath(out, to, n.value);
    };
    const walk = (value, path) => {
        if (path !== '' && dropped(path))
            return;
        if (Object.hasOwn(RENAMED, path))
            return carry(path, RENAMED[path], value);
        if (path === 'theme.reduceMotion') {
            return carry(path, 'look.reduceMotion', value, (v) => (v === true ? 'on' : v === false ? 'os' : undefined));
        }
        if (path === 'alerts.usagePollMin') {
            return carry(path, 'sync.slowSeconds', value, (v) => (typeof v === 'number' && Number.isFinite(v) ? v * 60 : undefined));
        }
        if (path === 'general.openOnStart') {
            // judged against the v1 default as written ("Projects" differs from "projects"), then lower-cased and normalised
            return carry(path, path, value, (v) => (typeof v === 'string' ? v.toLowerCase() : undefined));
        }
        if (path === 'routing.spareClaudeBelowPct')
            return carry(path, 'quota.floor.claude.weeklyPct', value);
        if (path === 'routing.askBeforeDestructive') {
            if (value === false)
                setPath(out, 'safety.confirmRiskAtLeast', 6);
            else if (value !== true)
                notes.push(`${path}: unusable value; the default for safety.confirmRiskAtLeast was used`);
            return;
        }
        const agent = /^agents\.([^.]+)\.(model|effort|routable)$/.exec(path);
        if (agent) {
            const [, id, field] = agent;
            // v1 defaults for agents missing from V1_DEFAULTS do not exist, so any value is carried
            if (field === 'model' && typeof value === 'string')
                value = value.trim();
            if (field === 'effort') {
                // the cross-field C9 rules (needs a model, omp/opencode, empty efforts) run in the final pass below, once every field is in
                if (same(value, getPath(V1_DEFAULTS, path.split('.'))))
                    return;
                if (typeof value === 'string' && (value === '' || EFFORTS.includes(value)))
                    setPath(out, `agents.${id}.effort`, value);
                else
                    notes.push(`${path}: unusable value ${JSON.stringify(value)?.slice(0, 40)}; the default for agents.${id}.effort was used`);
                return;
            }
            return carry(path, `agents.${id}.${field}`, value);
        }
        if (isObj(value)) {
            for (const [k, v] of Object.entries(value))
                if (!UNSAFE_KEYS.includes(k))
                    walk(v, path === '' ? k : `${path}.${k}`);
            return;
        }
        if (path === '')
            return;
        if (V1_CONTAINERS.includes(path)) {
            notes.push(`${path}: expected a group of settings, found ${JSON.stringify(value)?.slice(0, 40)}; ignored`);
            return;
        }
        if (path === 'schema')
            return;
        setPath(out, path, structuredClone(value)); // an unknown key: kept as is
    };
    walk(v1, '');
    out.schema = SETTINGS_SCHEMA;
    // An agent id v2 does not seed (for example "gemini") must carry all three fields to validate: fill the rest.
    if (isObj(out.agents)) {
        for (const [id, a] of Object.entries(out.agents)) {
            if (isObj(a) && !Object.hasOwn(defaultSettings().agents, id)) {
                out.agents[id] = { routable: true, model: '', effort: '', ...a };
            }
        }
    }
    // Final pass: anything that still fails the v2 rules (for example a model that is not in the seeded list, or an
    // unknown key that collided with a mapped one) falls back to the default.
    const defaults = defaultSettings();
    for (let round = 0; round < 8; round++) {
        const issues = validateSettings(mergeSettings(defaults, out));
        if (issues.length === 0)
            break;
        let changed = false;
        for (const issue of issues) {
            if (issue.key !== 'schema' && delPath(out, issue.key)) {
                notes.push(`${issue.key}: ${issue.message}; the default was used`);
                changed = true;
            }
        }
        if (!changed) {
            notes.push(`could not migrate cleanly (${issues.map((i) => i.key).join(', ')}); defaults were used`);
            for (const k of Object.keys(out))
                if (k !== 'schema')
                    delete out[k];
            break;
        }
    }
    return { settings: out, notes };
}
/** v1-only keys a v2 `settings.save` patch must not carry (C4). Returns the first offending dotted path, or null. */
export function droppedV1Key(patch) {
    const gone = [...DROPPED, 'alerts', 'theme', 'shortcuts', 'routing.tiers', 'routing.spareClaudeBelowPct', 'routing.askBeforeDestructive'];
    const find = (value, path) => {
        if (path !== '' && gone.some((d) => path === d || path.startsWith(`${d}.`)))
            return path;
        if (!isObj(value))
            return null;
        for (const [k, v] of Object.entries(value)) {
            const hit = find(v, path === '' ? k : `${path}.${k}`);
            if (hit)
                return hit;
        }
        return null;
    };
    return find(patch, '');
}
