/**
 * Route check (contract C9): is "agent [model [effort]]" something Orca can launch, given the user's settings?
 * Used by plan import and by `task.start`. Pure; it reads only the settings object it is given.
 */
import { setting } from './settings.js';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
/** Orca's `--effort` is not supported for these agents (orca-cli-reference.md:2099). */
const NO_EFFORT_AGENTS = ['omp', 'opencode'];
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Split route text into parts; extra words beyond three are returned as `extra`. */
export function parseRoute(text) {
    const w = text.trim().split(/\s+/).filter(Boolean);
    return { agent: w[0] ?? '', model: w[1], effort: w[2], extra: w.slice(3) };
}
export function checkRoute(route, settings) {
    const parts = typeof route === 'string' ? parseRoute(route) : { ...route, extra: [] };
    if (typeof route === 'string' && route.trim() === '')
        return { ok: true }; // empty = route by size
    const bad = (issue) => ({ ok: false, issue });
    const { agent } = parts;
    const model = parts.model ?? '';
    const effort = parts.effort ?? '';
    if (parts.extra.length)
        return bad(`too many words; a route is "agent [model [effort]]"`);
    for (const [what, v] of [['model', model], ['effort', effort]]) {
        if (v.startsWith('-') || /\s/.test(v))
            return bad(`${what} "${v}" is not allowed (it must not start with "-" or contain spaces)`);
    }
    const agents = isObj(settings.agents) ? settings.agents : {};
    const cfg = Object.hasOwn(agents, agent) ? agents[agent] : undefined; // own keys only: "__proto__" is not an agent
    if (!agent || !isObj(cfg))
        return bad(`unknown agent "${agent}"`);
    if (setting(settings, `agents.${agent}.routable`) === false)
        return bad(`agent "${agent}" is not routable (turn it on under Settings > Routing & Quota)`);
    const models = setting(settings, `agents.${agent}.models`);
    const list = (Array.isArray(models) ? models : []).filter((m) => isObj(m) && typeof m.id === 'string');
    const entry = model ? list.find((m) => m.id === model) : undefined;
    if (model && list.length > 0 && !entry)
        return bad(`model "${model}" is not in the ${agent} model list`);
    if (effort) {
        if (!EFFORTS.includes(effort))
            return bad(`effort "${effort}" is not one of ${EFFORTS.join(', ')}`);
        if (!model)
            return bad(`effort "${effort}" needs a model (--effort requires --model)`);
        if (NO_EFFORT_AGENTS.includes(agent))
            return bad(`${agent} does not support an effort`);
        if (entry) {
            const allowed = Array.isArray(entry.efforts) ? entry.efforts.filter((e) => typeof e === 'string') : [];
            if (allowed.length === 0)
                return bad(`model "${model}" takes no effort (the effort is part of its id)`);
            if (!allowed.includes(effort))
                return bad(`effort "${effort}" is not available for model "${model}" (allowed: ${allowed.join(', ')})`);
        }
    }
    return { ok: true };
}
