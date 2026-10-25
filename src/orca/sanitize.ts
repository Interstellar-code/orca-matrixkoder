// Drops conversation text from Orca JSON, and small helpers for reading untyped JSON safely.

// Fields that carry what a person or an agent said. They never leave the adapter.
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'prompt',
  'lastAssistantMessage',
  'toolInput',
  'preview',
]);

// Returns a copy of `value` with every sensitive key removed at any depth.
export function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!SENSITIVE_KEYS.has(k)) out[k] = stripSensitive(v);
    }
    return out;
  }
  return value;
}

export type Json = Record<string, unknown>;

export function rec(v: unknown): Json {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
}
export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
export function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
export function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
export function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
export function bool(v: unknown): boolean {
  return v === true;
}
export function cap(v: unknown, max: number): string {
  const s = str(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
export function capOrNull(v: unknown, max: number): string | null {
  return typeof v === 'string' ? cap(v, max) : null;
}
export function strings(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === 'string');
}
// `refs/heads/main` -> `main`
export function shortBranch(v: unknown): string {
  return str(v).replace(/^refs\/heads\//, '');
}
