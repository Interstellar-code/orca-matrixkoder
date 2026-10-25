/**
 * Runs an allowlisted Orca action for the server. Adds the A6 fallback: if Orca says the call needs a bound
 * terminal (the worker has none), the same command is typed into the run's coordinator terminal with the
 * allowlisted `terminal send` action instead. Everything still goes through the adapter's allowlist.
 * The fallback is for the two decision commands only (gate-resolve, reply), and only when no value holds a control
 * character: the text is typed into a live prompt, where Ctrl-C or a paste-end byte would end the quote.
 */
import { ACTIONS, buildActionArgv, runAction } from '../orca/index.js';
import type { ActionArgs, ActionResult, OrcaError } from '../orca/index.js';
import type { Json } from '../orca/sanitize.js';
import { one } from '../store/db.js';
import { fail, type ActionOutcome, type ServerCtx } from './common.js';

const TERMINAL_CODES = new Set(['terminal_required', 'no_terminal', 'no_bound_terminal', 'terminal_not_bound', 'caller_required', 'not_in_terminal']);

/** True when Orca's refusal means "this command must run from a terminal". */
export function needsTerminal(e: OrcaError): boolean {
  if (e.kind !== 'orca_error') return false;
  if (e.code && TERMINAL_CODES.has(e.code)) return true;
  return /bound terminal|no terminal|terminal handle|not (running )?in an? (orca )?terminal/i.test(e.message);
}

/** Only decisions may take the fallback: their reply carries no id the server needs, and a retry-request makes a repeat safe (review 2, findings 1 and 4). */
const FALLBACK_ACTIONS = new Set(['gate-resolve', 'reply']);
const FALLBACK_MAX_CHARS = 2000;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** True when every argv token is plain enough to type into a terminal: no control byte (Ctrl-C, ESC, newline, CR, NUL...) and not huge. */
export function safeToType(argv: readonly string[]): boolean {
  return argv.every((t) => t.length <= FALLBACK_MAX_CHARS && !CONTROL_CHARS.test(t));
}

const shellQuote = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export function coordinatorHandle(c: ServerCtx, runId: string | undefined): string | null {
  if (!runId) return null;
  const r = one(c.db, 'SELECT coordinator_handle FROM run WHERE id = ?', runId);
  return r?.coordinator_handle ? String(r.coordinator_handle) : null;
}

export async function callOrca(c: ServerCtx, name: string, args: ActionArgs, runId?: string): Promise<ActionResult> {
  const first = await runAction(name, args, c.runner);
  if (first.ok || !needsTerminal(first.error) || !FALLBACK_ACTIONS.has(name)) return first;
  const handle = coordinatorHandle(c, runId ?? (typeof args.run === 'string' ? args.run : undefined));
  const built = buildActionArgv(name, args);
  if (!handle || !built.ok) return first;
  if (!safeToType(built.argv)) {
    c.log(`[orca] ${name} needs a bound terminal, but its text has control characters or is too long to type safely; not sending it`);
    return first;
  }
  const text = `orca ${built.argv.map(shellQuote).join(' ')}`;
  c.log(`[orca] ${name} needs a bound terminal; sending it through coordinator ${handle}`);
  const sent = await runAction('terminal send', { terminal: handle, text, enter: true }, c.runner);
  if (!sent.ok) return first;
  return { ok: true, receipt: { ...(sent.receipt as Json), viaCoordinatorTerminal: handle } };
}

/** An Orca failure as an error a screen can show. */
export function orcaFailure(what: string, r: Extract<ActionResult, { ok: false }>): ActionOutcome {
  return fail('orca_failed', `${what}: ${r.error.message}`, { code: r.error.code ?? r.error.kind });
}

/** Pull an id out of an Orca receipt, whichever of the known shapes it has. */
export function receiptId(receipt: Json, kind: 'run' | 'task'): string | null {
  const r = (receipt.result ?? receipt) as Json;
  const inner = r[kind] as Json | undefined;
  const id = (inner && typeof inner === 'object' ? inner.id : undefined) ?? r[`${kind}Id`] ?? r[`${kind}_id`] ?? r.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** Turn a stored argv back into an allowlisted action, or null if it is not one of the two decision commands. */
export function decisionActionFromArgv(argv: unknown): { name: 'gate-resolve' | 'reply'; args: ActionArgs } | null {
  if (!Array.isArray(argv) || argv.some((t) => typeof t !== 'string')) return null;
  const tokens = argv as string[];
  const name = (['gate-resolve', 'reply'] as const).find((n) => ACTIONS[n].argv[0] === tokens[0] && ACTIONS[n].argv[1] === tokens[1]);
  if (!name) return null;
  const args: ActionArgs = {};
  for (const t of tokens.slice(2)) {
    if (t === '--json') continue;
    const m = /^--([a-z-]+)=([\s\S]*)$/.exec(t);
    if (!m) return null;
    args[m[1]] = m[2];
  }
  return { name, args };
}
