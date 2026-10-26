/**
 * Shared shapes for the dashboard server: the context every module receives, the clock, typed errors and a few helpers.
 */
import { homedir } from 'node:os';
import { defaultSettings, loadSettings } from '../store/settings.js';
export const realClock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
        return t;
    },
    clearTimeout: (h) => clearTimeout(h),
};
export const fail = (kind, message, extra = {}) => ({
    ok: false,
    error: { kind, message, ...extra },
});
/** The task result the dashboard writes when it cancels a task (Orca has no cancel); sync reads exactly this back. */
export const CANCELLED_RESULT = 'cancelled';
export const J = (v) => JSON.stringify(v);
export function parseJson(s, fallback) {
    try {
        const v = JSON.parse(String(s));
        return v === null || v === undefined ? fallback : v;
    }
    catch {
        return fallback;
    }
}
/** Orca's ISO strings (and the older "2026-10-25 01:42:50") to epoch ms; null when it does not parse. */
export function isoToMs(v) {
    if (typeof v !== 'string' || v === '')
        return null;
    const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
}
export const cut = (v, max) => {
    const s = typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
    return s.length > max ? s.slice(0, max) : s;
};
/** `/Users/me/code/x` to `~/code/x`. */
export function homeAbbrev(p) {
    const h = homedir();
    return h && p.startsWith(h) ? `~${p.slice(h.length)}` : p;
}
export const num = (v) => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));
export const maybeNum = (v) => (v === null || v === undefined ? null : Number(v));
/** The user's settings, or the defaults when mk-settings.json cannot be read (a bad value must not stop a sync or an import). */
export function readSettings(c) {
    try {
        return loadSettings(c.dir);
    }
    catch (e) {
        c.log(`[settings] mk-settings.json was not used: ${e.message}`);
        return defaultSettings();
    }
}
