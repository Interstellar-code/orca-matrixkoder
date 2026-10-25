# SPIKE report

## A1 — node:sqlite in the worker

Result: PASS. `node:sqlite` (`DatabaseSync`) loads inside Orca 1.4.239's own plugin-host runtime with no flag and no warning, and two processes writing a WAL database at once lost no rows and hit no `SQLITE_BUSY`. Tested 2026-10-24.

What was and was not the real thing:

1. Real: Orca's own binary (`/Applications/Orca.app/Contents/MacOS/Orca` with `ELECTRON_RUN_AS_NODE=1`, `execArgv: []`, advanced serialization, allowlisted env), running Orca's real `plugin-host-entry.js` (extracted from `app.asar`, `out/main/plugin-host-entry.js` plus its three chunks) and a throwaway worker loaded the same way Orca loads `main` (`import(pathToFileURL(...))`).
2. Not done: loading the throwaway plugin into the live Orca app (see "Needs Rohit"). So "inside the real worker runtime" means the same binary, host code and fork options, driven by a harness, not a worker forked by the running Orca UI. A harness stand-in.

### Versions seen (inside the forked worker)

1. node 24.22.0, electron 43.8.1, chrome 150.0.7871.250, v8 15.0.245.31-electron.0
2. sqlite 3.53.4 (`process.versions.sqlite`, and `select sqlite_version()` agreed)
3. `process.execArgv` is `[]`, so no `--experimental-sqlite`; `process` `warning` events captured: none; worker stderr empty
4. For comparison: system `node` v24.13.0 (used as the node CLI stand-in), Python 3 `sqlite3` library 3.53.2 (`~/Library/PhpWebStudy/env/python/bin/python3`)

### Load test

Commands (from `spike/`; the harness must itself run under Orca's binary, because system node cannot read Orca-binary advanced-serialization messages: `Unable to deserialize cloned data due to invalid or unsupported version`):

```
cd ~/Development/orca-matrixkoder/spike
ELECTRON_RUN_AS_NODE=1 /Applications/Orca.app/Contents/MacOS/Orca a1-probe.mjs
```

Output (trimmed to the load-bearing lines):

```
host ready msg: {"type":"ready","commands":["probe","write-rows"]}
commandResult ok: true
... "sqlite_version":"3.53.4","journal_mode":{"journal_mode":"wal"},"busy_timeout":{"timeout":5000},
    "readback":[{"id":1,"v":"hello-from-worker"}],"ok":true,"warnings":[]
host stdout: "" stderr: ""
```

Also: `ELECTRON_RUN_AS_NODE=1 Orca -e 'require("node:sqlite")'` works directly.

### Concurrency test

One process is the real plugin host (worker side); the other stands in for `mk bug add` (unknown what `mk` will be, so both flavours: system node `node:sqlite`, and Python `sqlite3`). Both open the same temp DB (`spike/tmp/conc.db`, never `~/.matrixkoder/mk-data.db`, which does not exist and was not created), `journal_mode=WAL`, `busy_timeout=5000`, each does N inserts in separate autocommit transactions, both spin until the same epoch-ms start time. Expected rows = 2N. `overlapMs` = time both were writing.

```
cd ~/Development/orca-matrixkoder/spike
ELECTRON_RUN_AS_NODE=1 /Applications/Orca.app/Contents/MacOS/Orca sqlite-concurrency.mjs                    # N=500, synchronous=NORMAL
SPIKE_SYNC=FULL ELECTRON_RUN_AS_NODE=1 /Applications/Orca.app/Contents/MacOS/Orca sqlite-concurrency.mjs    # N=500, synchronous=FULL
SPIKE_N=20000 ELECTRON_RUN_AS_NODE=1 /Applications/Orca.app/Contents/MacOS/Orca sqlite-concurrency.mjs      # stress
```

N=500 per side, synchronous=NORMAL (the requested test; raw lines in `spike/tmp/concurrency-output.txt`):

```
CLI stand-in        run  rows       overlap  worker err/max-wait  CLI err/max-wait  integrity
node:sqlite          1   1000/1000  9 ms     0 / 1.49 ms          0 / 10.02 ms      ok
node:sqlite          2   1000/1000  3 ms     0 / 0.21 ms          0 / 4.61 ms       ok
node:sqlite          3   1000/1000  3 ms     0 / 0.18 ms          0 / 4.59 ms       ok
python sqlite3       1   1000/1000  2.9 ms   0 / 0.38 ms          0 / 4.84 ms       ok
python sqlite3       2   1000/1000  6.9 ms   0 / 0.54 ms          0 / 9.58 ms       ok
python sqlite3       3   1000/1000  3.9 ms   0 / 1.52 ms          0 / 11.5 ms       ok
```

The 500-row runs finish in a few milliseconds, so the real overlap was short (3 to 9 ms). Two more runs, same shape, to make the overlap meaningful:

1. synchronous=FULL (SQLite default), N=500, 6 runs: all 1000/1000, 0 errors, overlap 4 to 26 ms, worst single-insert wait 27.46 ms (`spike/tmp/concurrency-output-full.txt`).
2. Stress N=20000 per side (40000 rows), synchronous=NORMAL, 6 runs: all 40000/40000, 0 errors, overlap 131 to 352 ms, worst single-insert wait 175.37 ms, all `integrity_check` ok (`spike/tmp/concurrency-output-stress.txt`).

Totals: 18 runs, 0 `SQLITE_BUSY`, 0 lost rows, every wait far under the 5000 ms busy timeout.

### What this does not prove

1. Long write transactions: every transaction here is one insert. A writer that holds a transaction open for seconds would make the other wait up to `busy_timeout`; STORE should keep writes short (or `BEGIN IMMEDIATE`).
2. A worker forked by the running Orca UI (not done, see below), and the 5-minute idle reap, which is A4/T9, not A1.
3. `mk`'s real implementation (not yet built).

### Needs Rohit (live-Orca check, optional for A1)

I did not install anything into the live Orca: loading a plugin means a manual step and would touch the installed `matrixkoder` plugin. To prove it inside the app itself: copy `spike/plugin/` as a second plugin folder with a manifest declaring command `probe` and `main: out/worker.mjs` (not written; the harness does not need one), enable it in Orca, run `probe` with `{db, out}` args and read the `out` file. If A1 must be proven that way before STORE.1, say so and I will write that manifest.

### Fallback (not needed)

A1 fallback was a bundled SQLite build or the `sqlite3` CLI. Not needed: the Orca runtime exposes `node:sqlite` (SQLite 3.53.4) without flags.

### Files

`spike/host-harness.mjs`, `spike/a1-probe.mjs`, `spike/writer-core.mjs`, `spike/sqlite-concurrency.mjs`, `spike/sqlite-cli-writer.mjs`, `spike/sqlite-cli-writer.py`, `spike/plugin/out/worker.mjs` (throwaway worker), `spike/tmp/` (extracted Orca host code in `spike/tmp/asar/`, temp DBs, run outputs, `summ.py`). `spike/tmp/` is not git-ignored; do not commit `spike/tmp/asar/` (Orca's own code).

## Live-app results (2026-10-25, done)

Run in the real Orca 1.4.239 app on the Mac, plugin `interstellar.matrixkoder-spike` loaded from `spike/live-plugin`.

1. A1 node:sqlite — PASS (harness, above).
2. A2 orca on PATH — PASS in the live worker: `orca` 1.4.239 found, `orca status --json` ok, plus `claude`, `codex`, `sqlite3`, `git`, `gh`.
3. A3 127.0.0.1 server — PASS in the live app: `orca tab create --url http://127.0.0.1:52153/?t=…` loaded the page in an Orca tab (Chromium user agent), its token fetch to `/api/ping` returned 200, and a request with no token (`/favicon.ico`) got 403.
4. A4 worker lifetime — PASS with keep-alive: worker pid 81846 ran 605 s (past the 5 min idle reap) with a `workspace.readContext` call every 60 s; it stopped only when the plugin was removed and re-added (logged `deactivate`). With keep-alive off (06:01:12 to 06:08:35 UTC, 7 min 23 s) worker pid 41647 also stayed alive, but 51 `agent.status.changed` events arrived in that time, so event delivery probably counts as activity (inferred, not read in the source). Decision: keep the 60 s keep-alive in the real worker, since a quiet Orca sends no events.
5. Events — PASS: `agent.status.changed` reaches the worker (many per minute while agents work).
6. Commands — PASS: plugin commands run from the `Cmd+J` palette ("MK Spike: Stop keep-alive" logged `keepalive-off`).
7. A6 actions with no bound terminal — not tested here; carried by ORCA (T6) as planned.

### Lessons for the build

1. Orca runs a copy of a local-path plugin from `~/Library/Application Support/Orca/plugins/<publisher.id>/<contentHash>/`. Paths relative to the worker file land there, not in the repo. The real worker must write only to absolute paths (`~/.matrixkoder/`).
2. Turning a plugin off and on does not reload changed code; remove and re-add it. Plan a dev-loop cost for every worker change.
3. The worker starts only when one of its commands runs or a subscribed event arrives, not when the plugin is enabled.
4. Plugin commands live in the `Cmd+J` palette, not `Cmd+Shift+P`.

To clean up: remove "MatrixKoder Spike (throwaway)" in Orca Settings > Plugins.
