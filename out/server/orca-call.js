/**
 * Runs an allowlisted Orca action for the server. Adds the A6 fallback: if Orca says the call needs a bound
 * terminal (the worker has none), the same command is typed into the run's coordinator terminal with the
 * allowlisted `terminal send` action instead. Everything still goes through the adapter's allowlist.
 */
import { ACTIONS, buildActionArgv, runAction } from '../orca/index.js';
import { one } from '../store/db.js';
import { fail } from './common.js';
const TERMINAL_CODES = new Set(['terminal_required', 'no_terminal', 'no_bound_terminal', 'terminal_not_bound', 'caller_required', 'not_in_terminal']);
/** True when Orca's refusal means "this command must run from a terminal". */
export function needsTerminal(e) {
    if (e.kind !== 'orca_error')
        return false;
    if (e.code && TERMINAL_CODES.has(e.code))
        return true;
    return /bound terminal|no terminal|terminal handle|not (running )?in an? (orca )?terminal/i.test(e.message);
}
const shellQuote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
export function coordinatorHandle(c, runId) {
    if (!runId)
        return null;
    const r = one(c.db, 'SELECT coordinator_handle FROM run WHERE id = ?', runId);
    return r?.coordinator_handle ? String(r.coordinator_handle) : null;
}
export async function callOrca(c, name, args, runId) {
    const first = await runAction(name, args, c.runner);
    if (first.ok || !needsTerminal(first.error))
        return first;
    const handle = coordinatorHandle(c, runId ?? (typeof args.run === 'string' ? args.run : undefined));
    const built = buildActionArgv(name, args);
    if (!handle || !built.ok)
        return first;
    const text = `orca ${built.argv.map(shellQuote).join(' ')}`;
    c.log(`[orca] ${name} needs a bound terminal; sending it through coordinator ${handle}`);
    const sent = await runAction('terminal send', { terminal: handle, text, enter: true }, c.runner);
    if (!sent.ok)
        return first;
    return { ok: true, receipt: { ...sent.receipt, viaCoordinatorTerminal: handle } };
}
/** An Orca failure as an error a screen can show. */
export function orcaFailure(what, r) {
    return fail('orca_failed', `${what}: ${r.error.message}`, { code: r.error.code ?? r.error.kind });
}
/** Pull an id out of an Orca receipt, whichever of the known shapes it has. */
export function receiptId(receipt, kind) {
    const r = (receipt.result ?? receipt);
    const inner = r[kind];
    const id = (inner && typeof inner === 'object' ? inner.id : undefined) ?? r[`${kind}Id`] ?? r[`${kind}_id`] ?? r.id;
    return typeof id === 'string' && id !== '' ? id : null;
}
/** Turn a stored argv back into an allowlisted action, or null if it is not one of the two decision commands. */
export function decisionActionFromArgv(argv) {
    if (!Array.isArray(argv) || argv.some((t) => typeof t !== 'string'))
        return null;
    const tokens = argv;
    const name = ['gate-resolve', 'reply'].find((n) => ACTIONS[n].argv[0] === tokens[0] && ACTIONS[n].argv[1] === tokens[1]);
    if (!name)
        return null;
    const args = {};
    for (const t of tokens.slice(2)) {
        if (t === '--json')
            continue;
        const m = /^--([a-z-]+)=([\s\S]*)$/.exec(t);
        if (!m)
            return null;
        args[m[1]] = m[2];
    }
    return { name, args };
}
