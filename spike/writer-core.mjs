// Shared writer: N short-transaction inserts into a WAL db, starting at startAt (epoch ms).
// Used by the throwaway worker (inside Orca's host) and by the node CLI stand-in.
import { DatabaseSync } from 'node:sqlite';
export function writeRows({ db, n, startAt, tag }) {
  const d = new DatabaseSync(db);
  const errors = [];
  let maxWaitMs = 0, ok = 0;
  try {
    d.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=${process.env.SPIKE_SYNC || 'NORMAL'};`);
    d.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, tag TEXT, i INTEGER, ts REAL)');
    const ins = d.prepare('INSERT INTO t (tag,i,ts) VALUES (?,?,?)');
    while (Date.now() < startAt) {}
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      try { ins.run(tag, i, Date.now()); ok++; }
      catch (e) { errors.push(String(e && e.message || e)); }
      const w = performance.now() - t0;
      if (w > maxWaitMs) maxWaitMs = w;
    }
  } finally { d.close(); }
  return { tag, ok, errors: errors.slice(0, 5), errorCount: errors.length, maxWaitMs: +maxWaitMs.toFixed(2) };
}
