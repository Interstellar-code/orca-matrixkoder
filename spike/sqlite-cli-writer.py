# Stand-in for `mk bug add` (python flavour): python3 sqlite-cli-writer.py <db> <n> <startAt>
import sqlite3, sys, time, json
db, n, start_at = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
errors, ok, mx = [], 0, 0.0
c = sqlite3.connect(db, timeout=5.0, isolation_level=None)
c.execute('PRAGMA journal_mode=WAL'); c.execute('PRAGMA busy_timeout=5000'); import os; c.execute('PRAGMA synchronous=' + os.environ.get('SPIKE_SYNC', 'NORMAL'))
c.execute('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, tag TEXT, i INTEGER, ts REAL)')
while time.time() * 1000 < start_at: pass
for i in range(n):
    t0 = time.perf_counter()
    try:
        c.execute('INSERT INTO t (tag,i,ts) VALUES (?,?,?)', ('cli-py', i, time.time() * 1000)); ok += 1
    except Exception as e: errors.append(str(e))
    mx = max(mx, (time.perf_counter() - t0) * 1000)
c.close()
print(json.dumps({'tag': 'cli-py', 'ok': ok, 'errors': errors[:5], 'errorCount': len(errors), 'maxWaitMs': round(mx, 2)}))
