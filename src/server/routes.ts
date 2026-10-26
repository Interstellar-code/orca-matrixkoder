/**
 * Routing and quota for `task.start` (contract C5). Pure functions: the caller reads the settings and the quota rows.
 *
 * Order in task.start, stopping at the first refusal: resolve the route, checkRoute (bad_route), routable,
 * max_lanes, quota floor, needs_confirm (C7, USE.3). The route is taken whole from the first source that has one
 * (args, task, phase, routing.bySize[size], bySize.standard); sources are never mixed field by field.
 */
import { all, type Db } from '../store/db.js';
import { checkRoute, parseRoute } from '../store/routes-check.js';
import { setting, type Json, type Settings } from '../store/settings.js';
import type { ActionError } from './common.js';
import { providerOf } from './providers.js';

export interface Route {
  agent: string;
  model: string;
  effort: string;
}
export type RouteSource = 'args' | 'task' | 'phase' | 'size' | 'standard';
export interface RouteInput {
  args: { agent?: string; model?: string; effort?: string };
  task?: string | null;
  phase?: string | null;
  size?: string | null;
}
export type Resolved = { ok: true; route: Route; source: RouteSource } | { ok: false; error: ActionError };

const isObj = (v: unknown): v is { [k: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);
const SIZES = ['trivial', 'standard', 'complex'];

/** The route settings, with every agent counted as routable: "not routable" has its own refusal after this one. */
const asRoutable = (s: Settings): Settings => {
  const agents = isObj(s.agents) ? s.agents : {};
  return { ...s, agents: Object.fromEntries(Object.entries(agents).map(([id, a]) => [id, isObj(a) ? { ...a, routable: true } : a])) };
};

const bad = (kind: ActionError['kind'], message: string, code?: string): { ok: false; error: ActionError } => ({
  ok: false,
  error: code ? { kind, message, code } : { kind, message },
});

/** Steps 1 and 2 of C5: pick the route, fill model and effort from agents.<id>, check it (C9), check it is routable. */
export function resolveRoute(settings: Settings, input: RouteInput): Resolved {
  const { args } = input;
  let text: string;
  let source: RouteSource;
  if (args.agent) {
    text = [args.agent, args.model ?? '', args.effort ?? ''].join(' ');
    source = 'args';
  } else if (args.model || args.effort) {
    return bad('bad_args', 'a model or effort needs an agent; pass "agent" too');
  } else if (input.task?.trim()) {
    text = input.task;
    source = 'task';
  } else if (input.phase?.trim()) {
    text = input.phase;
    source = 'phase';
  } else {
    const size = input.size && SIZES.includes(input.size) ? input.size : null;
    text = setting<string>(settings, `routing.bySize.${size ?? 'standard'}`);
    source = size ? 'size' : 'standard';
  }
  const parsed = source === 'args' ? { agent: args.agent as string, model: args.model, effort: args.effort, extra: [] as string[] } : parseRoute(text);
  const dflt = (k: 'model' | 'effort'): string => {
    const v = setting<string>(settings, `agents.${parsed.agent}.${k}`);
    return typeof v === 'string' ? v : '';
  };
  const route: Route = { agent: parsed.agent, model: parsed.model || dflt('model'), effort: parsed.effort || dflt('effort') };
  const from = { args: 'the request', task: 'the task route', phase: 'the phase route', size: 'Settings > Routing', standard: 'Settings > Routing' }[source];
  const named = (why: string): string => `route "${[route.agent, route.model, route.effort].filter(Boolean).join(' ')}" (from ${from}) cannot start: ${why}`;
  if (parsed.extra.length) return bad('bad_args', named(`a route is "agent [model [effort]]"`), 'bad_route');
  const r = checkRoute(route, asRoutable(settings));
  if (!r.ok) return bad('bad_args', named(`${r.issue}; fix it under Settings > Routing & Quota`), 'bad_route');
  if (setting<boolean>(settings, `agents.${route.agent}.routable`) === false) {
    return bad('bad_args', named(`agent "${route.agent}" is turned off (agents.${route.agent}.routable)`), 'not_routable');
  }
  return { ok: true, route, source };
}

export type QuotaVerdict = { refuse: ActionError | null; warnings: string[] };

/** Step 4 of C5: the quota floor for the route's agent. `onBelowFloor` off skips the check, warn adds warnings, block refuses. */
export function checkQuota(db: Db, settings: Settings, agent: string): QuotaVerdict {
  const mode = setting<string>(settings, 'quota.onBelowFloor');
  if (mode === 'off') return { refuse: null, warnings: [] };
  const provider = providerOf(agent);
  if (!provider) return { refuse: null, warnings: [`quota not checked: Orca reports no quota for ${agent}`] };
  const group = agent === 'claude' ? 'claude' : 'others';
  const rows = all(db, 'SELECT win, used_percent FROM quota WHERE provider = ?', provider);
  const warnings: string[] = [];
  const low: string[] = [];
  for (const [win, key] of [['session', 'sessionPct'], ['weekly', 'weeklyPct']] as const) {
    const row = rows.find((r) => r.win === win);
    if (!row || row.used_percent === null || row.used_percent === undefined) {
      warnings.push(`quota not checked: no ${win} reading for ${agent} yet`);
      continue;
    }
    const left = Math.max(0, 100 - Number(row.used_percent)); // compared unrounded; only the message rounds
    const floor = setting<number>(settings, `quota.floor.${group}.${key}`);
    if (left < floor) low.push(`${agent} ${win} quota is at ${Math.round(left)}% left, below the ${floor}% floor (quota.floor.${group}.${key})`);
  }
  if (low.length === 0) return { refuse: null, warnings };
  if (mode === 'block') {
    return { refuse: { kind: 'conflict', code: 'quota_floor', message: `${low.join('; ')}; lower the floor or set "When below a floor" to warn in Settings` }, warnings };
  }
  return { refuse: null, warnings: [...warnings, ...low] };
}
