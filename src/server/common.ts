/**
 * Shared shapes for the dashboard server: the context every module receives, the clock, typed errors and a few helpers.
 */
import { homedir } from 'node:os';
import type { Db } from '../store/db.js';
import type { OrcaRunner } from '../store/cli.js';
import type { Runner } from '../orca/index.js';

/** Injected so tests can move time and fire timers by hand. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

/** Runs git (in `cwd`) and returns trimmed stdout, or null when git fails. */
export type GitRunner = (cwd: string, args: string[]) => Promise<string | null>;

export interface CliProbe {
  found: boolean;
  path?: string;
  version?: string;
  error?: string;
}
export type CliProber = (command: string) => Promise<CliProbe>;

export interface ServerCtx {
  db: Db;
  /** Data folder: mk-data.db and mk-settings.json live here. */
  dir: string;
  /** The Orca adapter's runner (async). Tests stub it and read the argv it was given. */
  runner: Runner;
  /** The mk CLI's Orca runner (sync). Bug fix and run creation for bugs go through it. */
  cliOrca: OrcaRunner;
  clock: Clock;
  /** Length of the Undo window for Approve and Answer. */
  undoMs: number;
  /** Called after a write the sync loop should hear about (a decision was sent, a plan started). */
  requestSync: () => void;
  log: (message: string) => void;
}

/** What a screen can show: `kind` is stable, `message` is plain words. */
export type ErrorKind =
  | 'unknown_action' // the action name is not one the server knows
  | 'bad_args' // a missing or wrong argument
  | 'not_found' // the row the action names is not there
  | 'conflict' // the row is in a state that does not allow this
  | 'orca_failed' // Orca refused or could not be reached
  | 'store_failed' // the database or a file operation failed
  | 'unauthorized'
  | 'too_large';

export interface ActionError {
  kind: ErrorKind;
  message: string;
  /** Orca's own error code or kind, when Orca failed. */
  code?: string;
  details?: unknown;
}
export type ActionOutcome = { ok: true; [k: string]: unknown } | { ok: false; error: ActionError };

export const fail = (kind: ErrorKind, message: string, extra: Partial<ActionError> = {}): { ok: false; error: ActionError } => ({
  ok: false,
  error: { kind, message, ...extra },
});

/** The task result the dashboard writes when it cancels a task (Orca has no cancel); sync reads exactly this back. */
export const CANCELLED_RESULT = 'cancelled';

export const J = (v: unknown): string => JSON.stringify(v);

export function parseJson<T>(s: unknown, fallback: T): T {
  try {
    const v = JSON.parse(String(s));
    return v === null || v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

/** Orca's ISO strings (and the older "2026-10-25 01:42:50") to epoch ms; null when it does not parse. */
export function isoToMs(v: unknown): number | null {
  if (typeof v !== 'string' || v === '') return null;
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export const cut = (v: unknown, max: number): string => {
  const s = typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
  return s.length > max ? s.slice(0, max) : s;
};

/** `/Users/me/code/x` to `~/code/x`. */
export function homeAbbrev(p: string): string {
  const h = homedir();
  return h && p.startsWith(h) ? `~${p.slice(h.length)}` : p;
}

export const num = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));
export const maybeNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
