import { fail, invoke } from './call.js';
import { execOrca } from './runner.js';
const s = (required = false) => ({ kind: 'string', required });
const n = () => ({ kind: 'number' });
const e = (values) => ({ kind: 'string', oneOf: values });
const b = () => ({ kind: 'boolean' });
const j = () => ({ kind: 'json' });
export const ACTIONS = {
    'run-create': {
        argv: ['orchestration', 'run-create'],
        flags: { objective: s(true), from: s(), 'retry-request': s() },
    },
    'task-create': {
        argv: ['orchestration', 'task-create'],
        flags: {
            spec: s(true), 'task-title': s(), 'display-name': s(), deps: j(), parent: s(), run: s(), from: s(), 'retry-request': s(),
        },
    },
    'task-update': {
        argv: ['orchestration', 'task-update'],
        flags: { id: s(true), status: s(true), result: s(), run: s(), from: s(), 'retry-request': s() },
    },
    'worker-start': {
        argv: ['orchestration', 'worker-start'],
        flags: {
            task: s(), spec: s(), on: s(), worktree: s(), agent: s(), terminal: s(), 'task-title': s(), deps: j(), parent: s(),
            model: s(), effort: s(), name: s(), repo: s(), 'base-branch': s(), 'display-name': s(), comment: s(),
            setup: e(['run', 'skip', 'inherit']), 'retry-of': s(), 'timeout-ms': n(), run: s(), from: s(), 'retry-request': s(),
        },
        oneOf: [['task', 'spec'], ['agent', 'terminal']],
    },
    reply: {
        argv: ['orchestration', 'reply'],
        flags: { id: s(true), body: s(true), run: s(), from: s(), 'retry-request': s() },
    },
    'gate-resolve': {
        argv: ['orchestration', 'gate-resolve'],
        flags: { id: s(true), resolution: s(true), from: s(), 'retry-request': s() },
    },
    'terminal send': {
        argv: ['terminal', 'send'],
        flags: {
            terminal: s(true), text: s(true), enter: b(), interrupt: b(), 'wait-submit': n(), 'retry-request': s(),
        },
    },
    'tab create': {
        argv: ['tab', 'create'],
        flags: { url: s(true), worktree: s(), profile: s() },
    },
    'tab switch': {
        argv: ['tab', 'switch'],
        flags: { page: s(true), worktree: s(), focus: b() },
    },
    'repo set-base-ref': {
        argv: ['repo', 'set-base-ref'],
        flags: { repo: s(true), ref: s(true) },
    },
};
export const ACTION_NAMES = Object.keys(ACTIONS);
// Builds the argv for an allowlisted action, or returns the refusal. Pure: starts nothing.
export function buildActionArgv(name, args = {}) {
    const spec = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : undefined;
    if (!spec)
        return fail('not_allowed', `action "${name}" is not on the allowlist`);
    if (args === null || typeof args !== 'object' || Array.isArray(args))
        return fail('bad_args', 'args must be an object');
    const argv = [...spec.argv];
    for (const key of Object.keys(args)) {
        if (!Object.hasOwn(spec.flags, key))
            return fail('bad_args', `action "${name}" has no argument "${key}"`);
    }
    for (const [key, f] of Object.entries(spec.flags)) {
        const v = args[key];
        if (v === undefined || v === false) {
            if (f.required)
                return fail('bad_args', `action "${name}" needs "${key}"`);
            continue;
        }
        switch (f.kind) {
            case 'string':
                if (typeof v !== 'string' || v === '' || v.includes('\0'))
                    return fail('bad_args', `"${key}" must be a non-empty string`);
                if (f.oneOf && !f.oneOf.includes(v))
                    return fail('bad_args', `"${key}" must be one of: ${f.oneOf.join(', ')}`);
                argv.push(`--${key}=${v}`);
                break;
            case 'number':
                if (typeof v !== 'number' || !Number.isFinite(v))
                    return fail('bad_args', `"${key}" must be a number`);
                argv.push(`--${key}=${v}`);
                break;
            case 'boolean':
                if (v !== true)
                    return fail('bad_args', `"${key}" must be true or left out`);
                argv.push(`--${key}`);
                break;
            case 'json':
                // JSON array text (Orca's --deps); an array is encoded here
                if (Array.isArray(v))
                    argv.push(`--${key}=${JSON.stringify(v)}`);
                else if (typeof v === 'string' && v !== '')
                    argv.push(`--${key}=${v}`);
                else
                    return fail('bad_args', `"${key}" must be an array or JSON text`);
                break;
        }
    }
    for (const group of spec.oneOf ?? []) {
        if (!group.some((k) => args[k] !== undefined && args[k] !== false)) {
            return fail('bad_args', `action "${name}" needs one of: ${group.join(', ')}`);
        }
    }
    // belt and braces: the command that empties the agents' inbox can never be built
    if (argv[0] === 'orchestration' && argv[1] === 'check')
        return fail('not_allowed', 'orchestration check is never allowed');
    argv.push('--json');
    return { ok: true, argv };
}
export async function runAction(name, args = {}, runner = execOrca) {
    const built = buildActionArgv(name, args);
    if (!built.ok)
        return { ok: false, error: built.error };
    const out = await invoke(built.argv, runner);
    if (!out.ok)
        return { ok: false, error: out.error };
    const env = out.value;
    if (env.ok !== true) {
        const e = (env.error ?? {});
        return {
            ok: false,
            receipt: env,
            error: {
                kind: 'orca_error',
                message: typeof e.message === 'string' ? e.message : 'orca reported a failure',
                code: typeof e.code === 'string' ? e.code : undefined,
                argv: built.argv,
            },
        };
    }
    return { ok: true, receipt: env };
}
