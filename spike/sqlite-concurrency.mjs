// Run with Orca's runtime:  ELECTRON_RUN_AS_NODE=1 /Applications/Orca.app/Contents/MacOS/Orca spike/sqlite-concurrency.mjs
// Starts the REAL Orca plugin host (worker side) and a CLI stand-in at the same instant, both inserting N rows.
import { startHost } from './host-harness.mjs';
import { execFile } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, 'tmp'); mkdirSync(tmp, { recursive: true });
const N = +(process.env.SPIKE_N || 500), RUNS = 3;
const cliKinds = {
  'node:sqlite (system node)': (db, startAt) => ['node', [join(here, 'sqlite-cli-writer.mjs'), db, N, startAt]],
  'python sqlite3': (db, startAt) => ['python3', [join(here, 'sqlite-cli-writer.py'), db, N, startAt]],
};
const sh = (cmd, args) => new Promise((res) => execFile(cmd, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }, (e, so, se) => res({ e, so, se })));
const h = startHost(); await h.ready;
for (const [kind, mk] of Object.entries(cliKinds)) {
  for (let run = 1; run <= RUNS; run++) {
    const db = join(tmp, 'conc.db');
    for (const f of [db, db + '-wal', db + '-shm']) rmSync(f, { force: true });
    // create schema once, up front, so both writers hit an existing WAL db
    const d0 = new DatabaseSync(db); d0.exec('PRAGMA journal_mode=WAL; CREATE TABLE t (id INTEGER PRIMARY KEY, tag TEXT, i INTEGER, ts REAL)'); d0.close();
    const startAt = Date.now() + 1500;
    const [cmd, args] = mk(db, startAt);
    const cliP = sh(cmd, args.map(String));
    const wrkP = h.invoke('write-rows', { db, n: N, startAt, tag: 'worker', core: pathToFileURL(join(here, 'writer-core.mjs')).href });
    const [cli, wrk] = await Promise.all([cliP, wrkP]);
    const d = new DatabaseSync(db);
    const total = d.prepare('SELECT count(*) c FROM t').get().c;
    const byTag = d.prepare('SELECT tag, count(*) c FROM t GROUP BY tag').all().map((r) => `${r.tag}=${r.c}`).join(' ');
    const ov = d.prepare('SELECT tag, min(ts) a, max(ts) b FROM t GROUP BY tag').all(); const lo = Math.max(...ov.map((r) => r.a)), hi = Math.min(...ov.map((r) => r.b)); const overlapMs = +(hi - lo).toFixed(1);
    const integrity = d.prepare('PRAGMA integrity_check').get().integrity_check;
    d.close();
    const c = cli.e ? { error: String(cli.e) + cli.se } : JSON.parse(cli.so);
    console.log(JSON.stringify({ cli: kind, run, rows: total, overlapMs, expected: 2 * N, byTag, integrity, worker: wrk.value ?? wrk, cliResult: c }));
  }
}
await h.stop();
