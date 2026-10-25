/**
 * mk-data.db: the plugin's own SQLite database (everything Orca does not keep).
 * Schema v1 is defined in .matrixkoder/inbox/research/mk-data-schema.md §2 and lives in schema-v1.ts.
 * Two writers share the file (the worker's sync loop and the mk CLI), so every connection runs the same
 * PRAGMAs and every write transaction starts with BEGIN IMMEDIATE.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_V1 } from './schema-v1.js';
/** Ordered list; add a new entry (never edit an old one) to change the schema. */
export const MIGRATIONS = [{ version: 1, note: 'schema v1', sql: SCHEMA_V1 }];
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
/** `$MK_DATA_DIR`, else `~/.matrixkoder`. */
export function dataDir(env = process.env) {
    return env.MK_DATA_DIR && env.MK_DATA_DIR.length > 0 ? env.MK_DATA_DIR : join(homedir(), '.matrixkoder');
}
export function dbPath(dir = dataDir()) {
    return join(dir, 'mk-data.db');
}
export const now = () => Date.now();
function currentVersion(db) {
    const t = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='schema_version'").get();
    if (!t)
        return 0;
    const r = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get();
    return Number(r?.v ?? 0);
}
/** Run `fn` inside BEGIN IMMEDIATE ... COMMIT; roll back and rethrow on error. */
export function tx(db, fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const out = fn();
        db.exec('COMMIT');
        return out;
    }
    catch (e) {
        try {
            db.exec('ROLLBACK');
        }
        catch {
            /* the original error matters more */
        }
        throw e;
    }
}
function migrate(db) {
    if (currentVersion(db) >= SCHEMA_VERSION)
        return;
    for (const m of MIGRATIONS) {
        // Re-read the version inside the write lock: a second process may have migrated while this one waited.
        tx(db, () => {
            if (currentVersion(db) >= m.version)
                return;
            db.exec(m.sql);
            db.prepare('INSERT INTO schema_version(version, applied_at, note) VALUES(?,?,?)').run(m.version, now(), m.note);
        });
    }
}
/**
 * Open (and create or migrate) `<dir>/mk-data.db`. PRAGMAs apply on every open.
 * Order matters: busy_timeout first, so the WAL switch and the first migration wait for another process.
 */
export function openDb(dir = dataDir()) {
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(dbPath(dir));
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    return db;
}
/** Next value of a named sequence; atomic in one statement. */
export function nextCounter(db, name) {
    const r = db
        .prepare('INSERT INTO counter(name, value) VALUES(?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value')
        .get(name);
    return Number(r?.value);
}
/** `B-n`, global across repos (Q11). */
export function nextBugId(db) {
    return `B-${nextCounter(db, 'bug')}`;
}
export function all(db, sql, ...params) {
    return db.prepare(sql).all(...params);
}
export function one(db, sql, ...params) {
    return db.prepare(sql).get(...params);
}
