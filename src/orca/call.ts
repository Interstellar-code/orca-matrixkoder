import { ORCA_TIMEOUT_MS } from './types.js';
import type { OrcaError, OrcaErrorKind, OrcaResult, Runner } from './types.js';
import { stripSensitive } from './sanitize.js';
import type { Json } from './sanitize.js';

export function fail(kind: OrcaErrorKind, message: string, extra: Partial<OrcaError> = {}): { ok: false; error: OrcaError } {
  return { ok: false, error: { kind, message, ...extra } };
}

function isTimeout(e: unknown): boolean {
  const x = e as { code?: unknown; name?: unknown } | null;
  return x?.code === 'ETIMEDOUT' || x?.name === 'TimeoutError';
}

// Runs one orca call and returns the parsed envelope (`{ok, result | error}`) exactly as printed.
// Never throws: a timeout, a start failure and non-JSON output come back as typed errors.
export async function invoke(argv: string[], runner: Runner): Promise<OrcaResult<Json>> {
  let stdout: string;
  try {
    ({ stdout } = await runner(argv, { timeoutMs: ORCA_TIMEOUT_MS }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return isTimeout(e)
      ? fail('timeout', `orca ${argv.join(' ')} timed out after ${ORCA_TIMEOUT_MS} ms`, { argv })
      : fail('exec_failed', message, { argv });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return fail('invalid_json', `orca ${argv.join(' ')} did not print JSON`, { argv });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('invalid_json', `orca ${argv.join(' ')} printed JSON that is not an object`, { argv });
  }
  return { ok: true, value: parsed as Json };
}

// A read: invoke, require {ok:true}, drop conversation text, then project the result.
export async function read<T>(argv: string[], runner: Runner, project: (result: Json) => T): Promise<OrcaResult<T>> {
  const out = await invoke(argv, runner);
  if (!out.ok) return out;
  const env = out.value;
  if (env.ok !== true) {
    const err = (env.error ?? {}) as { code?: unknown; message?: unknown };
    return fail('orca_error', typeof err.message === 'string' ? err.message : 'orca reported a failure', {
      code: typeof err.code === 'string' ? err.code : undefined,
      argv,
    });
  }
  const result = stripSensitive(env.result);
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return fail('bad_shape', `orca ${argv.join(' ')} returned no result object`, { argv });
  }
  try {
    return { ok: true, value: project(result as Json) };
  } catch (e) {
    return fail('bad_shape', e instanceof Error ? e.message : String(e), { argv });
  }
}
