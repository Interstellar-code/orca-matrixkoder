/**
 * mk-settings.json, schema v1 (contract C3).
 * Keys per Settings tab from orca-settings.md §5/§6.4, minus what Orca owns (agent enable/command override,
 * notification master switch and sound, theme colour mode, OS keybindings) and minus "Follow Orca theme" (Q7).
 * Rules: reading never writes; the first save creates the file; a bad value is rejected naming its key;
 * unknown keys survive a save; the file is replaced atomically.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db.js';
export const SETTINGS_SCHEMA = 1;
export class SettingsError extends Error {
    issues;
    constructor(issues) {
        super(issues.map((i) => `${i.key}: ${i.message}`).join('; '));
        this.issues = issues;
        this.name = 'SettingsError';
    }
}
export function settingsPath(dir = dataDir()) {
    return join(dir, 'mk-settings.json');
}
export function defaultSettings() {
    return {
        schema: SETTINGS_SCHEMA,
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
}
const bool = { t: 'bool' };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Dotted path to rule. `*` matches any single key (agent ids). Containers are listed so their type is checked. */
const RULES = {
    'general.mode': { t: 'enum', values: ['orchestrator', 'solo'] },
    'general.openOnStart': { t: 'str', max: 40 },
    'general.activeRepo': { t: 'str', nullable: true, max: 200 },
    'agents.*.routable': bool,
    'agents.*.model': { t: 'str', max: 80 },
    'agents.*.effort': { t: 'enum', values: ['', 'low', 'medium', 'high', 'xhigh', 'max'] },
    'routing.useJev': bool,
    'routing.lowConfidence': { t: 'enum', values: ['risk-based', 'lower', 'higher'] },
    'routing.askBeforeDestructive': bool,
    'routing.tiers.trivial': { t: 'str', max: 80 },
    'routing.tiers.standard': { t: 'str', max: 80 },
    'routing.tiers.complex': { t: 'str', max: 80 },
    'routing.tiers.finalReview': { t: 'str', max: 80 },
    'routing.maxLanes': { t: 'int', min: 1, max: 12 },
    'routing.spareClaudeBelowPct': { t: 'int', min: 0, max: 100 },
    'safety.blockDestructiveGit': bool,
    'safety.blockDeleteOutsideWorktree': bool,
    'safety.askBeforePush': bool,
    'safety.scanDiffsForSecrets': bool,
    'safety.protectedBranches': { t: 'strs', maxItems: 50 },
    'safety.neverRun': { t: 'strs', maxItems: 100 },
    'alerts.events.ask': bool,
    'alerts.events.laneDone': bool,
    'alerts.events.gateFail': bool,
    'alerts.events.runDone': bool,
    'alerts.events.stall': bool,
    'alerts.desktop': bool,
    'alerts.quietHours.enabled': bool,
    'alerts.quietHours.from': { t: 'time' },
    'alerts.quietHours.to': { t: 'time' },
    'alerts.wakeOrchestrator': bool,
    'alerts.stallMinutes': { t: 'int', min: 1, max: 1440 },
    'alerts.dashboard.autoOpen': bool,
    'alerts.dashboard.chip': bool,
    'alerts.dashboard.toasts': bool,
    'alerts.usagePollMin': { t: 'int', min: 1, max: 120 },
    'theme.rain.enabled': bool,
    'theme.rain.brightness': { t: 'int', min: 0, max: 100 },
    'theme.rain.speed': { t: 'enum', values: ['slow', 'normal', 'fast'] },
    'theme.reduceMotion': bool,
    'theme.textSize': { t: 'enum', values: ['S', 'M', 'L'] },
    'theme.density': { t: 'enum', values: ['compact', 'comfy'] },
    'shortcuts.footer': { t: 'strs', maxItems: 4 },
};
const CONTAINERS = [
    'general', 'agents', 'routing', 'routing.tiers', 'safety', 'alerts', 'alerts.events', 'alerts.quietHours',
    'alerts.dashboard', 'theme', 'theme.rain', 'shortcuts',
];
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
function getPath(root, path) {
    let cur = root;
    for (const p of path) {
        if (!isObj(cur))
            return undefined;
        cur = cur[p];
    }
    return cur;
}
function check(rule, v) {
    switch (rule.t) {
        case 'bool':
            return typeof v === 'boolean' ? null : 'must be true or false';
        case 'enum':
            return typeof v === 'string' && rule.values.includes(v) ? null : `must be one of ${rule.values.map((x) => JSON.stringify(x)).join(', ')}`;
        case 'int':
            return typeof v === 'number' && Number.isInteger(v) && v >= rule.min && v <= rule.max ? null : `must be a whole number from ${rule.min} to ${rule.max}`;
        case 'str':
            if (v === null && rule.nullable)
                return null;
            if (typeof v !== 'string')
                return rule.nullable ? 'must be a string or null' : 'must be a string';
            return rule.max !== undefined && v.length > rule.max ? `must be at most ${rule.max} characters` : null;
        case 'strs':
            if (!Array.isArray(v) || !v.every((x) => typeof x === 'string'))
                return 'must be a list of strings';
            return v.length > rule.maxItems ? `must have at most ${rule.maxItems} items` : null;
        case 'time':
            return typeof v === 'string' && TIME.test(v) ? null : 'must be a time like "22:00"';
    }
}
/** Validate a complete settings object. Unknown keys are ignored (kept, not checked). */
export function validateSettings(s) {
    const issues = [];
    if (s.schema !== SETTINGS_SCHEMA)
        issues.push({ key: 'schema', message: `must be ${SETTINGS_SCHEMA}` });
    for (const c of CONTAINERS) {
        if (!isObj(getPath(s, c.split('.'))))
            issues.push({ key: c, message: 'must be an object' });
    }
    const bad = new Set(issues.map((i) => i.key));
    const agents = getPath(s, ['agents']);
    for (const [path, rule] of Object.entries(RULES)) {
        const parts = path.split('.');
        if (parts.includes('*')) {
            if (!isObj(agents))
                continue;
            for (const id of Object.keys(agents)) {
                const key = parts.map((p) => (p === '*' ? id : p)).join('.');
                if (!isObj(agents[id])) {
                    if (!bad.has(`agents.${id}`))
                        issues.push({ key: `agents.${id}`, message: 'must be an object' });
                    bad.add(`agents.${id}`);
                    continue;
                }
                const msg = check(rule, getPath(s, key.split('.')));
                if (msg)
                    issues.push({ key, message: msg });
            }
            continue;
        }
        if ([...bad].some((b) => path.startsWith(`${b}.`)))
            continue;
        const msg = check(rule, getPath(s, parts));
        if (msg)
            issues.push({ key: path, message: msg });
    }
    return issues;
}
/** Deep merge: objects merge key by key, everything else (arrays included) is replaced. Unknown keys are carried along. */
export function mergeSettings(base, patch) {
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) {
        const cur = out[k];
        out[k] = isObj(cur) && isObj(v) ? mergeSettings(cur, v) : structuredClone(v);
    }
    return out;
}
function readFile(dir) {
    const p = settingsPath(dir);
    if (!existsSync(p))
        return null;
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(p, 'utf8'));
    }
    catch (e) {
        throw new Error(`${p} is not valid JSON: ${e.message}`);
    }
    if (!isObj(parsed))
        throw new Error(`${p} must hold a JSON object`);
    return parsed;
}
/** Defaults overlaid with the file. Never writes. A bad value in the file throws a SettingsError naming the key. */
export function loadSettings(dir = dataDir()) {
    const merged = mergeSettings(defaultSettings(), readFile(dir) ?? {});
    const issues = validateSettings(merged);
    if (issues.length)
        throw new SettingsError(issues);
    return merged;
}
/**
 * Merge `patch` onto the current settings, validate the result, and replace the file atomically.
 * The file is created on the first save. Throws SettingsError (nothing written) on a bad value.
 */
export function saveSettings(patch, dir = dataDir()) {
    const merged = mergeSettings(mergeSettings(defaultSettings(), readFile(dir) ?? {}), patch);
    const issues = validateSettings(merged);
    if (issues.length)
        throw new SettingsError(issues);
    mkdirSync(dir, { recursive: true });
    const p = settingsPath(dir);
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`);
    renameSync(tmp, p);
    return merged;
}
