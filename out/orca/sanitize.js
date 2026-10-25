// Drops conversation text from Orca JSON, and small helpers for reading untyped JSON safely.
// Fields that carry what a person or an agent said. They never leave the adapter.
export const SENSITIVE_KEYS = new Set([
    'prompt',
    'lastAssistantMessage',
    'toolInput',
    'preview',
]);
// Returns a copy of `value` with every sensitive key removed at any depth.
export function stripSensitive(value) {
    if (Array.isArray(value))
        return value.map(stripSensitive);
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (!SENSITIVE_KEYS.has(k))
                out[k] = stripSensitive(v);
        }
        return out;
    }
    return value;
}
export function rec(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
export function arr(v) {
    return Array.isArray(v) ? v : [];
}
export function str(v, fallback = '') {
    return typeof v === 'string' ? v : fallback;
}
export function strOrNull(v) {
    return typeof v === 'string' ? v : null;
}
export function num(v, fallback = 0) {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
export function numOrNull(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
export function bool(v) {
    return v === true;
}
export function cap(v, max) {
    const s = str(v);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
export function capOrNull(v, max) {
    return typeof v === 'string' ? cap(v, max) : null;
}
export function strings(v) {
    return arr(v).filter((x) => typeof x === 'string');
}
// `refs/heads/main` -> `main`
export function shortBranch(v) {
    return str(v).replace(/^refs\/heads\//, '');
}
