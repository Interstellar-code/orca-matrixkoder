+++ 1 Top block — plan identity [toml]
plan = "orca-dashboard-wiring"
status = "shipped"
created = 2026-10-24
runs = []
integration = "main"
pushed = false
/+++

+++ 2 Summary
# orca-dashboard-wiring — the MatrixKoder dashboard shows real Orca and MK data, served by the plugin worker

## Summary
- Phases: 6 — SPIKE: prove the worker can do what the plan needs; STORE: mk-data.db, settings file and the mk CLI; ORCA: read Orca and run its actions; SERVE: the local dashboard server; WIRE: screens read live data; LAUNCH: open the dashboard, agent skill, release
- Method: waves · subagents mixed
- Lanes: SPIKE (main checkout, orchestrator); lane A: STORE, SERVE, LAUNCH; lane B: ORCA, WIRE — at most 2 lanes at once, builders claude sonnet medium
- Delivery: main · pushed: no
- Gates: unit = npm test; types = npx tsc --noEmit; bundle = npm run build
/+++

+++ 3 Goal
## Goal
- Done when:
  - G1 — the dashboard, opened in an Orca browser tab, shows the current repo's real projects, lanes, plan, waiting items and events, refreshed within 10 s of a change
  - G2 — dashboard actions (approve, answer, import, fix a bug, todo changes) change Orca or `~/.matrixkoder/mk-data.db`, and the next refresh shows the result
  - G3 — settings changed in the dashboard are saved in `~/.matrixkoder/mk-settings.json` and survive an Orca restart
  - G4 — an agent files a bug with one command, starts its fix as an Orca task, and the Bugs screen shows the task's live state
- Why: the 0.1.1 panel is a faithful design with mock data; the plugin is useful only once it shows and drives the real work
- From: the user, 2026-10-24, after the 0.1.1 release and the research round
- Sources: `.matrixkoder/README.md`; `.matrixkoder/inbox/research/` — `README.md`, `screen-data-map.md`, `orca-plugin-api.md`, `orca-orchestration-bus.md`, `orca-settings.md`, `orca-cli-reference.md`, `mk-data-schema.md`
/+++

+++ 4 Design / context
## Design / context

### What is wrong today
1. Every screen shows constants baked into its script, for example `EVENTS` in `panel/screens/Events.dc.html:182` and `BUGS` in `panel/screens/Bugs.dc.html:182`.
2. The worker only logs events and registers `sweep-lanes`; it serves no data (`src/worker.ts:38-80`).
3. A sidebar panel can call only `workspace.readContext`, `terminal.sendText` and `notifications.show`, so it cannot reach the worker (`orca/main:src/shared/plugins/plugin-host-api.ts:124-144`, same on tag `v1.4.239`). Fix proposed upstream in stablyai/orca PR #25256, not merged.
4. Nothing stores MK-only data (todos, bugs, plan phases), and no settings file exists.
5. The repo has no test runner; `mk-config.py list --json` shows the gates test, typecheck, lint and build all empty.

### Shape of the change
The plugin worker becomes the only data layer. It reads Orca through the `orca ... --json` CLI and the three plugin events, keeps MK-only data in `~/.matrixkoder/mk-data.db` (SQLite, WAL) and settings in `~/.matrixkoder/mk-settings.json`, and serves the existing dashboard screens plus a JSON API on `127.0.0.1` with a per-session token. The dashboard opens in an Orca browser tab; the sidebar panel becomes a launcher. Orca stays the source of truth for projects, repos, worktrees, agents, terminals, runs, tasks, gates and messages; MK never copies their state, it stores only Orca ids. Upstream MatrixKoder stores (`mk-overview.db`, `projects/*/mk-project.db`, `bus/`) are not read or written. When Orca ships panel-to-worker calls (`commands.invoke`), the same worker commands back the sidebar.

File map:
1. `src/store/` → `mk-data.db` open, migrations, typed access; `mk-settings.json` load, defaults, validation (STORE).
2. `bin/mk.mjs` → the `mk` CLI for agents: `mk bug add|list|fix|close`, `mk todo add|done|list`, JSON output (STORE).
3. `src/orca/` → run `orca` with a timeout, parse JSON, project it into small objects; an allowlist of action commands (ORCA).
4. `src/server/` → HTTP server, token and Host checks, `/api/state`, `/api/action`, poll loop and event-driven refresh (SERVE).
5. `src/worker.ts` → start the store and server, register worker commands (SERVE, then LAUNCH).
6. `panel/` and `scripts/build-panel.mjs` → a data layer in the runtime; each screen's mock constants replaced by snapshot fields; a launcher page for the sidebar (WIRE).
7. `orca-plugin.json`, `skills/matrixkoder/` → Open Dashboard command and shortcut; the agent skill for `mk bug` (LAUNCH).

### Contracts
C1 — `mk-data.db` schema v1, defined in `.matrixkoder/inbox/research/mk-data-schema.md` §2: tables `schema_version, counter, kv, sync_state, repo, worktree, pane, run, lane, lane_activity, ask, quota, agent_cli, plan, plan_version, plan_phase, plan_task, plan_subtask, plan_item, inbox_file, bug, todo, check_result, event_log, decision_log, alert_sent` and views `v_orca_task_owner, v_phase, v_plan_counts`. Each column is an Orca id, cached Orca state (written only by the sync loop), or MK-owned. Plan tasks use the same light-link columns as bugs (`orca_run_id`, `orca_task_id`, `attempts`, `past_task_ids`, `last_state`, `last_state_at`); there is no `task_link` table — written by STORE, read by SERVE and WIRE
C2 — the `bug` table: `id` ('B-n' from `counter('bug')`, unique across repos), `repo_id`, `title`, `details` (full write-up, no .md files), `file`, `line`, `risk` 1-5, `status` open|fixing|waiting|fixed|wontfix, `reported_by`, `orca_run_id`, `orca_task_id`, `attempts`, `past_task_ids` (JSON array), `last_state`, `last_state_at`, `created_at`, `updated_at`, `fixed_at`. Status follows `last_state`: ready or dispatched = fixing, a pending ask = waiting, completed = fixed, failed = open with attempts shown. `mk bug fix` creates the Orca task in the repo's bug run (`repo.bug_run_id`, created on first use); a retry moves the current task id into `past_task_ids` — written by STORE, read by SERVE, WIRE and LAUNCH
C3 — `mk-settings.json` schema v1: keys per Settings tab from `orca-settings.md` §5, minus keys Orca owns (agents, notifications, theme mode, OS keybindings), with defaults and validation; unknown keys kept — written by STORE, read by SERVE and WIRE
C4 — the `mk` CLI: subcommands above, `--json` output, exit 0 on success, opens `mk-data.db` with WAL and a 5 s busy timeout; `mk bug fix B-n` calls `orca orchestration task-create` with the bug's details as the spec; also `mk subtask set <code> <status> [--note]` and `mk ask note <ask-id> --text` (the only writer of `ask.recommendation`). Every Orca mutation passes `--retry-request` and starts the spec with an `mk-ref:` line, so a crash between the Orca call and the row update never leaves an orphan or a duplicate — written by STORE, read by LAUNCH
C5 — the Orca adapter: read functions (`worktreePs`, `runList`, `taskList`, `workerList`, `workerShow`, `gateList`, `inbox`, `accountList`) returning projections that never carry prompts or assistant text; the reads `terminalList`, `repoList`, `worktreeList`, `hostList` too; an action allowlist (`run-create`, `task-create`, `task-update`, `worker-start`, `reply`, `gate-resolve`, `terminal send`, `tab create`, `repo set-base-ref`) — `orchestration check` is never allowed — written by ORCA, read by SERVE
C6 — the state snapshot, built only from `mk-data.db` (never from a live Orca call): `meta` (with `stale` per source from `sync_state`), `badges`, and one key per screen with the fields in `mk-data-schema.md` §5, including the Failed task state and attempts. `GET /api/state?screen=<name>` sends that screen in full and counts for the rest, so every response stays under 64 KB (§7) — written by SERVE, read by WIRE
C7 — the HTTP API: `GET /api/state?screen=`, `GET /api/events?before=`, `GET /api/event/<id>`, `POST /api/action {name, args}`; token in a header, Host must be `127.0.0.1:<port>` — written by SERVE, read by WIRE
C8 — worker commands `mk.state`, `mk.action` registered with Orca, returning the same data as C6/C7, so the sidebar can use them once Orca supports `commands.invoke` — written by SERVE, read by LAUNCH

### Test plan
T1 — schema creates every C1 table, index and view; migrates from empty and from v1; two writers at once (CLI and worker) both succeed; a plan import and a sync upsert run together without overwriting each other's columns; `v_orca_task_owner` returns current and past ids; deleting a plan cascades — unit — `test/store/db.test.mjs` — written by STORE.1
T10 — plan import and re-import map blocks to rows as `mk-data-schema.md` §6 says, using `orca-dashboard-wiring.md` itself as the fixture (it has nested subtasks); a re-import keeps `orca_task_id`, `attempts`, `past_task_ids` and status of started tasks — unit — `test/store/import.test.mjs` — written by STORE.4
T11 — sync maps recorded Orca JSON to cache rows, never writes a prompt field, and marks an object gone only after a complete pull — unit — `test/server/sync.test.mjs` — written by SERVE.3
T2 — settings load defaults, reject bad values, keep unknown keys, round-trip to disk — unit — `test/store/settings.test.mjs` — written by STORE.2
T3 — `mk bug add/fix/close` and `mk todo` change the rows as C2/C4 say; `fix` builds the right `task-create` call (orca stubbed) — unit — `test/store/cli.test.mjs` — written by STORE.3
T4 — projections from recorded Orca JSON fixtures drop prompts and assistant text and keep the fields C6 needs; `check` is refused — unit — `test/orca/adapter.test.mjs` — written by ORCA.1
T5 — the server rejects a missing token, a wrong token and a foreign Host header; `/api/state` stays under 64 KB with fixture data — integration — `test/server/server.test.mjs` — written by SERVE.1
T6 — every `/api/action` name maps to the right adapter or store call — integration — `test/server/actions.test.mjs` — written by SERVE.2
T7 — every screen renders from a fixture snapshot with no mock constant left, and from an empty snapshot without errors — integration (headless Chrome) — `test/panel/screens.test.mjs` — written by WIRE.1
T9 — the worker serves 127.0.0.1, an Orca tab loads it, and the worker is still answering after 10 idle minutes — manual — `.matrixkoder/inbox/research/spike-report.md` — written by SPIKE.1
T8 — end to end on the live machine: open the dashboard tab, see real lanes, approve a test gate on a throwaway run, add and fix a bug — manual — checklist in `test/manual/e2e.md` — written by LAUNCH.3

### Assumptions and dependencies
A1 — the plugin worker can load `node:sqlite` (Node 24.22 inside Orca) — if not, STORE uses a bundled SQLite build or the `sqlite3` CLI
A2 — the worker can find and run `orca` (its PATH is Orca's allowlist) — if not, SPIKE finds the binary path and the adapter uses it
A3 — an Orca browser tab can load `http://127.0.0.1:<port>` from the worker — if not, the plan is re-planned (dashboard approach changes)
A4 — the worker stays alive while the dashboard is open (it is idle-reaped after 5 min) — if not, the server runs as a small user process the worker starts and watches
A5 — Orca CLI JSON shapes stay as recorded on 1.4.239 — if not, the fixtures and projections are updated
A6 — action commands (`reply`, `gate-resolve`, `task-create`) work from the worker with no bound terminal — if not, those actions are sent through a coordinator terminal with `terminal send`
A7 — `orca ... --json` reads return complete lists at the sizes in use (`task-list`, `worker-list` paging unverified) — if not, sync pages them or caps the run size
A8 — Orca keeps the first line of a task spec, so the `mk-ref:` tag survives — if not, only `--retry-request` guards against duplicates

### Rollout and undo
R1 — ships by merging each phase to local `main`; undo = revert the phase's merge; `mk-data.db` is new, deleting it loses only MK data, Orca data is untouched — LAUNCH.3
R2 — README (data folders, dashboard usage), CHANGELOG 0.2.0 entry, `.matrixkoder/README.md` kept in step — LAUNCH.3

### Settings and limits
S1 — most lanes at once — 3 — `mk-config.py list --json` (`repo.lanes.slots`) — 2026-10-24
S2 — integration branch — main — `mk-config.py list --json` — 2026-10-24
S3 — project gates — none defined (test, typecheck, lint, build empty); this plan uses `extra` gates — `mk-config.py list --json` — 2026-10-24
S4 — Claude limits — 5 h 9% used, week 56% used, resets 2026-10-27 — `~/.matrixkoder/usage.json` — 2026-10-24
S5 — Codex limits — not readable (ChatGPT login needed); AGY week 79% used — `~/.matrixkoder/usage.json` — 2026-10-24
S6 — Orca — 1.4.239 installed; source checked at tag `v1.4.239` and `orca/main` — `orca --version`, `git` — 2026-10-24

### Out of scope
1. The sidebar showing the full dashboard (waits for Orca `commands.invoke`; C8 makes it a small later change).
2. Remote hosts (`--environment`): v1 is local only and says so.
3. Reading or migrating upstream MatrixKoder stores.
/+++

+++ 5 Phases
## Phases
/+++

+++ 5.1 SPIKE — prove the worker can do what the plan needs
### SPIKE — prove the worker can do what the plan needs
- Goal: a written report shows, on Orca 1.4.239, whether the worker can load `node:sqlite`, run `orca`, serve 127.0.0.1 to an Orca tab, survive 10 idle minutes, and run actions unbound; and `npm test` runs.
- Serves: G1, G2, G3, G4
- Needs first: nothing
- Build order: SPIKE.1 then SPIKE.2; read `orca-plugin-api.md` §4 and `screen-data-map.md` §6 first.
- Hazards: K1, K2
- Carries: A2, A3, A4, A5, T9
/+++

+++ 5.1.0 SPIKE settings [toml]
id = "SPIKE"
title = "prove the worker can do what the plan needs"
wave = 1
owned = ["spike/", "test/fixtures/orca/", "package.json", ".matrixkoder/inbox/research/spike-report.md"]
commit = "chore(spike): prove worker sqlite, orca exec, local server and lifetime"
deps = []
size = "standard"
subagents = false
/+++

+++ 5.1.1 SPIKE.1 — live proofs and the spike report [toml]
id = "SPIKE.1"
title = "live proofs and the spike report"
description = "A throwaway worker under spike/ runs each unknown from screen-data-map.md §6 on the live machine and writes the outcome, with evidence, to spike-report.md. It also records real Orca JSON outputs as fixtures for later tests. Each failed proof names its fallback from block 4."
covers = ["A2", "A3", "A4", "A5", "T9"]
acceptance = [
  "spike-report.md has a pass/fail line with evidence for: node:sqlite load, orca on PATH, 127.0.0.1 page in an Orca tab, 10 idle minutes alive, reply/gate-resolve/task-create unbound on a throwaway run",
  "test/fixtures/orca/ holds recorded JSON for worktree ps, run-list, task-list, worker-list, worker-show, gate-list, inbox and account list, with ids and text redacted",
  "every failed proof names the fallback the later phases use",
]
risk = 3
manual = "the orchestrator reads spike-report.md and confirms each line has evidence; the user approves any fallback before STORE starts"
/+++

+++ 5.1.2 SPIKE.2 — test runner [toml]
id = "SPIKE.2"
title = "test runner"
covers = []
acceptance = [
  "`npm test` runs node --test over test/**/*.test.mjs and passes with one smoke test",
  "package.json already has everything later phases need: `bin.mk = bin/mk.mjs` and the test script, so no later phase edits package.json",
]
risk = 1
/+++

+++ 5.2 STORE — mk-data.db, settings file and the mk CLI
### STORE — mk-data.db, settings file and the mk CLI
- Goal: `~/.matrixkoder/mk-data.db` and `mk-settings.json` are created and validated by `src/store/`, and agents can run `mk bug` and `mk todo`.
- Serves: G2, G3, G4
- Needs first: SPIKE, for the sqlite result (A1).
- Build order: STORE.1, then STORE.2, STORE.3 and STORE.4; read `screen-data-map.md` §5 and `orca-settings.md` §5 first.
- Hazards: K3
- Carries: C1, C2, C3, C4, T1, T2, T3, T10, A1
/+++

+++ 5.2.0 STORE settings [toml]
id = "STORE"
title = "mk-data.db, settings file and the mk CLI"
wave = 2
owned = ["src/store/", "bin/", "test/store/"]
commit = "feat(store): mk-data.db, mk-settings.json and the mk CLI"
deps = ["SPIKE"]
size = "complex"
route = "claude sonnet medium"
reviewer = "claude opus"
subagents = true
/+++

+++ 5.2.1 STORE.1 — mk-data.db schema and access [toml]
id = "STORE.1"
title = "mk-data.db schema and access"
covers = ["C1", "C2", "T1", "A1"]
acceptance = [
  "opening the store creates ~/.matrixkoder/mk-data.db with every table, index, view and CHECK in mk-data-schema.md §2; the PRAGMAs (WAL, busy timeout 5 s, foreign keys) apply on every open",
  "a daily backup (VACUUM INTO) and the prune job of mk-data-schema.md §7 run without blocking writers",
  "a schema_version row drives migrations; re-opening is a no-op",
  "T1 passes, including two concurrent writers",
]
risk = 3
gate = "node --test test/store/db.test.mjs"
/+++

+++ 5.2.2 STORE.2 — settings file [toml]
id = "STORE.2"
title = "settings file"
covers = ["C3", "T2"]
acceptance = [
  "missing mk-settings.json is created with defaults on first save, not on read",
  "bad values are rejected with the key named; unknown keys survive a save",
  "T2 passes",
]
risk = 3
gate = "node --test test/store/settings.test.mjs"
deps = ["STORE.1"]
subagent = true
owned = ["src/store/settings.ts", "test/store/settings.test.mjs"]
/+++

+++ 5.2.3 STORE.3 — the mk CLI [toml]
id = "STORE.3"
title = "the mk CLI"
covers = ["C4", "T3"]
acceptance = [
  "`mk bug add --title --details --file --line --risk` prints the new bug as JSON",
  "`mk bug fix B-n` creates the Orca task from the bug's details, stores its ids, bumps attempts and moves the old task id into past_task_ids",
  "`mk todo add|done|list` work; T3 passes with orca stubbed",
]
risk = 3
gate = "node --test test/store/cli.test.mjs"
deps = ["STORE.1"]
subagent = true
owned = ["bin/", "test/store/cli.test.mjs"]
/+++

+++ 5.2.4 STORE.4 — plan import into the database [toml]
id = "STORE.4"
title = "plan import into the database"
description = "Reads a plan .md in <repo>/.matrixkoder/inbox/, sets its inbox_file status and fit (pass, partial, not_a_plan) per mk-data-schema.md §6.2, and on import loads plan, plan_version, plan_phase, plan_task, plan_subtask and plan_item rows, then moves the file to inbox/archive/. Re-import merges by column ownership (§6.4) so started tasks keep their Orca links."
covers = ["T10"]
acceptance = [
  "importing orca-dashboard-wiring.md creates its 6 phases, every task and the nested WIRE.2 subtasks with deps, waves, lanes, risk and gates",
  "a changed file shows as changed in the inbox; re-import adds a plan_version and never clears orca_task_id, attempts, past_task_ids or status",
  "T10 passes",
]
risk = 4
gate = "node --test test/store/import.test.mjs"
deps = ["STORE.1"]
/+++

+++ 5.3 ORCA — read Orca and run its actions
### ORCA — read Orca and run its actions
- Goal: `src/orca/` returns small projections of Orca state from the CLI and runs only allowlisted actions.
- Serves: G1, G2
- Needs first: SPIKE, for the PATH result and the fixtures.
- Build order: ORCA.1 then ORCA.2; read `orca-cli-reference.md` and `orca-orchestration-bus.md` §2 first.
- Hazards: K4, K5
- Carries: C5, C6, T4, A5
/+++

+++ 5.3.0 ORCA settings [toml]
id = "ORCA"
title = "read Orca and run its actions"
wave = 2
owned = ["src/orca/", "test/orca/", "test/fixtures/snapshot.json"]
commit = "feat(orca): Orca CLI adapter with projections and an action allowlist"
deps = ["SPIKE"]
size = "standard"
route = "claude sonnet medium"
reviewer = "claude sonnet"
subagents = false
/+++

+++ 5.3.1 ORCA.1 — read functions and projections [toml]
id = "ORCA.1"
title = "read functions and projections"
covers = ["C5", "T4", "A5"]
acceptance = [
  "each C5 read function runs orca with --json and a 10 s timeout and returns a typed projection",
  "no projection carries prompt, lastAssistantMessage, toolInput or preview fields",
  "T4 passes against the SPIKE fixtures",
]
risk = 3
gate = "node --test test/orca/adapter.test.mjs"
/+++

+++ 5.3.2 ORCA.2 — action allowlist [toml]
id = "ORCA.2"
title = "action allowlist"
covers = []
acceptance = [
  "only the C5 action names can run; any other name, including `orchestration check`, is refused with an error",
  "each action returns Orca's receipt JSON unchanged",
]
risk = 4
gate = "node --test test/orca/adapter.test.mjs"
deps = ["ORCA.1"]
/+++

+++ 5.3.3 ORCA.3 — sample snapshot for the screens [toml]
id = "ORCA.3"
title = "sample snapshot for the screens"
description = "Writes test/fixtures/snapshot.json, a full C6 state snapshot built from the recorded SPIKE fixtures, so WIRE can build every screen before SERVE exists. The orchestrator checks it against screen-data-map.md section 4 before WIRE starts."
covers = ["C6"]
acceptance = [
  "test/fixtures/snapshot.json has every C6 key with realistic values from the recorded Orca data, under 64 KB",
  "it includes at least one empty list, one failed task and one long name, so screens meet real edge cases",
]
risk = 2
deps = ["ORCA.1"]
/+++

+++ 5.4 SERVE — the local dashboard server
### SERVE — the local dashboard server
- Goal: the worker serves the dashboard and the C6/C7 API on 127.0.0.1 with a token, refreshed by a poll loop and by Orca events.
- Serves: G1, G2, G3
- Needs first: STORE and ORCA, for the store and adapter it calls.
- Build order: SERVE.1, SERVE.2, SERVE.3; read `screen-data-map.md` §4 first.
- Hazards: K1, K2, K4
- Carries: C6, C7, C8, T5, T6, T11, A6
/+++

+++ 5.4.0 SERVE settings [toml]
id = "SERVE"
title = "the local dashboard server"
wave = 3
owned = ["src/server/", "src/worker.ts", "test/server/"]
commit = "feat(server): local dashboard server, state snapshot and actions"
deps = ["STORE", "ORCA"]
size = "complex"
route = "claude sonnet medium"
reviewer = "claude opus"
subagents = false
/+++

+++ 5.4.1 SERVE.1 — server, auth and the state snapshot [toml]
id = "SERVE.1"
title = "server, auth and the state snapshot"
covers = ["C6", "C7", "T5"]
acceptance = [
  "the server binds 127.0.0.1 on a random port with a fresh token per start",
  "requests without the token or with a foreign Host header get 403",
  "GET /api/state returns the C6 snapshot under 64 KB; events page through /api/events",
  "T5 passes",
]
risk = 4
gate = "node --test test/server/server.test.mjs"
/+++

+++ 5.4.2 SERVE.2 — actions [toml]
id = "SERVE.2"
title = "actions"
covers = ["T6", "A6"]
acceptance = [
  "POST /api/action handles approve, rework, answer, ask.snooze; plan.start, plan.park, plan.resume, plan.markMerged; task.start, task.retry, task.cancel; inbox import, reimport, archive, restore, delete; bug add, fix, close, reopen; todo add, done, makeTask; settings save",
  "each action calls Orca first when it changes Orca state, then updates the row; Approve and Answer wait in decision_log for the 10 s Undo window",
  "each action returns ok or an error the screen can show; T6 passes",
]
risk = 4
gate = "node --test test/server/actions.test.mjs"
deps = ["SERVE.1"]
/+++

+++ 5.4.3 SERVE.3 — refresh loop and worker commands [toml]
id = "SERVE.3"
title = "refresh loop and worker commands"
covers = ["C8", "T11"]
acceptance = [
  "the sync loop pulls per the cadence of mk-data-schema.md §4 (worktree ps, terminals, runs, tasks, workers, gates, inbox every 10 s; repos, quota, hosts every 60 s; git for tracked worktrees every 10 s) and at once on agent.status.changed, worktree.created and worktree.removed",
  "it writes only cached columns, converts ISO times to ms, and marks an object gone only after a complete pull",
  "on start it replays decision_log: pending rows whose commit_at passed within 10 minutes run, older ones become expired; T11 passes",
  "event_log is filled from inbox using the message sequence as cursor, heartbeats skipped",
  "worker commands mk.state and mk.action return the same data as the HTTP API",
  "src/worker.ts registers every module in out/commands/ at start, so LAUNCH adds commands without editing src/worker.ts",
]
risk = 3
gate = "node --test test/server/"
deps = ["SERVE.1"]
/+++

+++ 5.5 WIRE — screens read live data
### WIRE — screens read live data
- Goal: every screen renders from the snapshot, with no mock constants left, and its buttons call /api/action.
- Serves: G1, G2, G3, G4
- Needs first: ORCA, for the sample snapshot (ORCA.3); its live check WIRE.4 also waits for SERVE.
- Build order: WIRE.1 (data layer, against scripts/dev-snapshot-server.mjs serving the sample snapshot), then the screens in WIRE.2, then WIRE.3, then WIRE.4 once SERVE is merged; read `screen-data-map.md` §2 and §3 first.
- Hazards: K6
- Carries: T7
/+++

+++ 5.5.0 WIRE settings [toml]
id = "WIRE"
title = "screens read live data"
wave = 3
owned = ["panel/", "scripts/build-panel.mjs", "scripts/dev-snapshot-server.mjs", "web/", "test/panel/"]
commit = "feat(panel): screens render live data from the worker"
deps = ["ORCA"]
size = "complex"
route = "claude sonnet medium"
reviewer = "claude sonnet"
subagents = true
qa = ["dashboard-live"]
/+++

+++ 5.5.1 WIRE.1 — data layer in the runtime [toml]
id = "WIRE.1"
title = "data layer in the runtime"
covers = ["T7"]
acceptance = [
  "the runtime fetches /api/state with the token every 5 s and hands each screen its slice; screens keep local UI state across refreshes",
  "a failed fetch shows a stale banner, never a blank screen",
  "the build emits the dashboard page served by the worker and a launcher page for the sidebar",
]
risk = 3
gate = "node --test test/panel/screens.test.mjs"
/+++

+++ 5.5.2 WIRE.2 — screens on live data [toml]
id = "WIRE.2"
title = "screens on live data"
description = "Each screen's mock constants are replaced by snapshot fields per screen-data-map.md §2, in this order: Overview, Lanes, Waiting; Plan, Events; Projects, Inbox; Bugs, Todo; Settings. Fields the map marks missing follow the answers to Q1-Q6 and §3; design fixes from §3 item 16 (badge definitions) and item 9 (Failed state) are applied."
covers = []
acceptance = [
  "no screen script contains a mock data constant",
  "every button listed in screen-data-map.md §2 calls its action or is removed per §3",
  "T7 passes for all 16 screens",
]
risk = 3
gate = "node --test test/panel/screens.test.mjs"
deps = ["WIRE.1"]
/+++

+++ 5.5.2.1 WIRE.2.1 — Overview, Lanes, Waiting [toml]
id = "WIRE.2.1"
title = "Overview, Lanes, Waiting"
acceptance = ["the three screens render from the sample snapshot and their buttons send the right /api/action calls"]
subagent = false
owned = ["panel/screens/Main.dc.html", "panel/screens/Lanes.dc.html", "panel/screens/Waiting.dc.html"]
/+++

+++ 5.5.2.2 WIRE.2.2 — Plan, Events, Projects, Inbox [toml]
id = "WIRE.2.2"
title = "Plan, Events, Projects, Inbox"
acceptance = ["the four screens render from the snapshot; Inbox lists <repo>/.matrixkoder/inbox/*.md and Import/Archive work"]
owned = ["panel/screens/Plan.dc.html", "panel/screens/Events.dc.html", "panel/screens/Projects.dc.html", "panel/screens/Inbox.dc.html"]
/+++

+++ 5.5.2.3 WIRE.2.3 — Bugs, Todo, Settings [toml]
id = "WIRE.2.3"
title = "Bugs, Todo, Settings"
acceptance = ["Bugs shows live Orca task state per bug; Todo edits persist; all 7 Settings tabs save to mk-settings.json"]
owned = ["panel/screens/Bugs.dc.html", "panel/screens/Todo.dc.html", "panel/screens/Settings.dc.html", "panel/screens/SettingsAgents.dc.html", "panel/screens/SettingsRouting.dc.html", "panel/screens/SettingsSafety.dc.html", "panel/screens/SettingsAlerts.dc.html", "panel/screens/SettingsLook.dc.html", "panel/screens/SettingsShortcuts.dc.html"]
/+++

+++ 5.5.3 WIRE.3 — sidebar launcher [toml]
id = "WIRE.3"
title = "sidebar launcher"
covers = []
acceptance = ["the sidebar panel shows a short static status and how to open the dashboard (command and shortcut)"]
risk = 2
deps = ["WIRE.1"]
/+++

+++ 5.5.4 WIRE.4 — live check against the real server [toml]
id = "WIRE.4"
title = "live check against the real server"
covers = []
acceptance = [
  "every screen renders from the real /api/state of the merged SERVE worker",
  "approve, answer, import, bug fix and todo actions work against a throwaway Orca run",
]
risk = 3
manual = "the orchestrator opens the dashboard tab and runs each action on a throwaway run"
deps = ["WIRE.2", "SERVE"]
/+++

+++ 5.6 LAUNCH — open the dashboard, agent skill, release
### LAUNCH — open the dashboard, agent skill, release
- Goal: one command or shortcut opens the dashboard tab, agents can file bugs through the skill, and 0.2.0 is tagged with docs.
- Serves: G1, G4
- Needs first: SERVE, for the server URL and worker commands.
- Build order: LAUNCH.1 and LAUNCH.2, then LAUNCH.3.
- Hazards: none
- Carries: T8, R1, R2
/+++

+++ 5.6.0 LAUNCH settings [toml]
id = "LAUNCH"
title = "open the dashboard, agent skill, release"
wave = 4
owned = ["orca-plugin.json", "src/commands/", "skills/", "README.md", "CHANGELOG.md", "test/manual/", ".matrixkoder/README.md"]
commit = "feat(launch): open dashboard command, bug skill, 0.2.0"
deps = ["SERVE"]
size = "standard"
route = "claude sonnet medium"
reviewer = "claude sonnet"
subagents = false
/+++

+++ 5.6.1 LAUNCH.1 — Open Dashboard command [toml]
id = "LAUNCH.1"
title = "Open Dashboard command"
covers = []
acceptance = [
  "`MatrixKoder: Open Dashboard` and its shortcut open the dashboard in an Orca browser tab with the session token, reusing an open tab",
  "if the server is down the command restarts it first",
]
risk = 2
/+++

+++ 5.6.2 LAUNCH.2 — agent skill for bugs and todos [toml]
id = "LAUNCH.2"
title = "agent skill for bugs and todos"
covers = []
acceptance = ["skills/matrixkoder tells agents when and how to run `mk bug add` and `mk bug fix`, with the path to the shipped CLI"]
risk = 2
/+++

+++ 5.6.3 LAUNCH.3 — end-to-end check, docs and release [toml]
id = "LAUNCH.3"
title = "end-to-end check, docs and release"
covers = ["T8", "R1", "R2"]
acceptance = [
  "the T8 checklist passes on the live machine and the result is recorded in test/manual/e2e.md",
  "README, CHANGELOG 0.2.0 and .matrixkoder/README.md describe the shipped behaviour; version is 0.2.0 everywhere",
]
risk = 3
manual = "the user runs test/manual/e2e.md in Orca and confirms each step"
deps = ["LAUNCH.1", "LAUNCH.2"]
/+++

+++ 6 Gates
## Gates
- unit — proves G2, G3, G4 — every unit and integration test passes
- types — proves G1, G2 — the worker, store, adapter and server type-check
- bundle — proves G1 — the plugin builds and stages with the dashboard and launcher pages
/+++

+++ 6.0 Gate settings [toml]
use = []
timeout = 600

[extra]
unit = "npm test"
types = "npx tsc --noEmit"
bundle = "npm run build"
/+++

+++ 7 Risks
## Risks
- K1 — Orca reaps the idle worker after 5 minutes, killing the server, poll loop and undo timer — level 4 — guard: T9 lifetime proof, with the separate-process fallback (A4) if it fails — SERVE.1
- K7 — a spike proof is read wrongly and later phases build on a false result — level 3 — guard: T9 evidence per line, reviewed before STORE — SPIKE.1
- K8 — a settings save or CLI write corrupts a user file or row — level 3 — guard: T2 and T3 — STORE.2, STORE.3
- K9 — an action or refresh fires the wrong Orca command or misses events — level 4 — guard: T6 — SERVE.2
- K12 — the refresh loop misses an Orca event or re-reads the mailbox from the start — level 3 — guard: T6 refresh and cursor cases — SERVE.3
- K13 — a partial worktree ps or terminal list pull (truncated, omitted hosts, CLI error) marks live lanes gone — level 3 — guard: complete-pull rule tested in T11 with a truncated fixture — SERVE.3
- K14 — re-importing a running plan overwrites links or status of started tasks — level 4 — guard: T10 column-ownership merge — STORE.4
- K15 — a crash between the Orca call and the row update leaves an orphan Orca task or a duplicate retry — level 3 — guard: --retry-request ids and the mk-ref adoption rule, tested in T3 and T6 — STORE.3
- K16 — a pending Undo is lost when Orca reaps the idle worker — level 3 — guard: decision_log replay on start, tested in T11 — SERVE.3
- K17 — a snapshot exceeds 64 KB on a busy repo — level 2 — guard: per-screen snapshot and T5 with the largest fixture — SERVE.1
- K10 — the dashboard page loses the token or shows stale data as live — level 3 — guard: T7 stale-banner case — WIRE.1
- K11 — the release ships with a broken live path — level 3 — guard: T8 end-to-end checklist — LAUNCH.3
- K2 — another local process reads the dashboard or calls actions — level 4 — guard: T5 token and Host checks, loopback bind — SERVE.1
- K3 — the CLI and the worker write mk-data.db at once and one fails — level 3 — guard: T1 concurrent-writer test, WAL and busy timeout — STORE.1
- K4 — the dashboard consumes the agents' mailbox (`orchestration check`) or runs an unintended action — level 4 — guard: T4 allowlist test refuses `check` — ORCA.2
- K5 — prompts or assistant text leak into mk-data.db or the API — level 3 — guard: T4 projection test — ORCA.1
- K6 — a screen breaks on real data the mock never had (empty lists, long names, failed tasks) — level 3 — guard: T7 empty and fixture snapshots — WIRE.2
/+++

+++ 8 Open questions
## Open questions
- [x] Q1 — what is a "lane": an Orca worker dispatch, a worktree with an agent, or both? — blocks: WIRE.2 — pick: a worker dispatch when a run exists, else a worktree with a live agent
- [x] Q2 — keep Undo on Approve and Answer? Orca resolutions are final, so Undo needs a 10 s delay before the command runs — blocks: SERVE.2 — pick: yes, 10 s delay window for gates and answers; instant Undo for local actions
- [x] Q3 — who reports build and test results for the lane chips ("41 of 63 passing")? — blocks: WIRE.2 — pick: lane agents send `orca orchestration send --type status` with the result; the worker reads it
- [x] Q4 — what does Ask Jev do in v1? — blocks: WIRE.2 — pick: hide it until a Jev call path is decided; keep Improve
- [x] Q5 — Safety and Routing settings that nothing enforces: keep or drop? — blocks: WIRE.2 — pick: keep, labelled "advisory, read by the orchestrator"
- [x] Q6 — can bugs carry screenshots? — blocks: none — pick: no attachments in v1
- [x] Q7 — Follow Orca theme: a browser tab gets no Orca tokens — blocks: WIRE.2 — pick: drop it, keep the Matrix palette
- [x] Q8 — release number — blocks: LAUNCH.3 — pick: 0.2.0
- [x] Q9 — keep `bug.last_state_at` (when the cached Orca state was last seen)? — blocks: none — pick: yes, it drives the stale label
- [x] Q10 — inbox fit rules: not_a_plan = no top block or no phase and task; partial = a required block or link missing; pass = everything present (mk-data-schema.md §6.2) — blocks: STORE.4 — pick: as proposed
- [x] Q11 — bug ids global (`B-n` across all repos) or per repo? — blocks: STORE.1 — pick: global, since the primary key is `id` alone
/+++

+++ 9 Log
## Log
- 2026-10-24 — drafted — wire the 0.1.1 dashboard to real data through the plugin worker — user
- 2026-10-24 — decision — dashboard runs in an Orca browser tab served by the worker until Orca merges panel-to-worker calls (stablyai/orca #25256) — user
- 2026-10-24 — decision — Orca is the source of truth; upstream MK stores are not used; MK-only data in ~/.matrixkoder/mk-data.db, settings in ~/.matrixkoder/mk-settings.json — user
- 2026-10-24 — decision — bugs live only in the bug table (no .md files), one table with fix fields, created by agents through the mk CLI — user
- 2026-10-24 — answer — Q1 to Q8 accepted as picked: lane = dispatch else worktree with agent; Undo with 10 s delay; agents report checks via send --type status; Ask Jev hidden; Safety/Routing advisory; no bug attachments; Follow Orca theme dropped; release 0.2.0 — user
- 2026-10-24 — decision — 2 lanes plus the main checkout; builders claude sonnet medium; reviews opus for STORE and SERVE, sonnet otherwise; WIRE moves to wave 3 against a sample snapshot (ORCA.3) with a live check WIRE.4; SPIKE owns package.json edits; LAUNCH adds commands as modules loaded by src/worker.ts — user
- 2026-10-24 — decision — plans in this repo no longer need to pass upstream mk-plan.py check — user
- 2026-10-24 — parked — SPIKE paused: A1 passed, A2/A3 passed in the harness; live-app proofs (A2-A4, A6) need the throwaway plugin loaded on the Mac, not over a remote connection — user
- 2026-10-24 — amended — mk-data.db schema v1 from mk-data-schema.md: panes, inbox files, plans with phases, light-link tasks like bugs; dashboard reads only the db, a sync loop fills it; new STORE.4 import, T10, T11, K13-K17, A7, A8, Q9-Q11 — user
- 2026-10-24 — answer — Q9 keep bug.last_state_at; Q10 inbox fit rules as proposed; Q11 bug ids global across repos — user
- 2026-10-25 — done — SPIKE live proofs: A2, A3, A4 (with 60 s keep-alive) and events PASS in the real app; A6 stays with ORCA T6; lessons: worker runs from Orca's plugin copy so use absolute paths, code changes need remove and re-add, worker starts on command or event only — user
- 2026-10-25 — done — SPIKE.2 npm test runner and mk bin entry (d53f708ddec); A5, A7, A8 have no recorded pass/fail line — orchestrator
- 2026-10-25 — done — STORE: mk-data.db, mk-settings.json and the mk CLI (4a9c8376cf9; merged de9004f2766, 2278ff2f7ca) — orchestrator
- 2026-10-25 — done — ORCA: CLI adapter and action allowlist (8b03cac5a8e, 37401409e18); the allowlist is now 10 actions (tab switch added in 0.2.0) — orchestrator
- 2026-10-25 — done — SERVE: local dashboard server, snapshot and actions (297cca6bf7a, review round 2 bbc9d1ef136); released in v0.1.2 — orchestrator
- 2026-10-25 — done — WIRE.1 to WIRE.3: screens render live data (d627cc7d704, 6605860131d); WIRE.4 live check not recorded — orchestrator
- 2026-10-25 — done — LAUNCH.1, LAUNCH.2: Open Dashboard command, bug skill, release 0.2.0 (0d3ccc1ba61); LAUNCH.3 T8 checklist test/manual/e2e.md not run — orchestrator
- 2026-10-26 — superseded — WIRE.2.3's 7 Settings screens were replaced by the 6 settings tabs of mk-settings-v2 (release 0.3.0) — orchestrator
- 2026-10-26 — amended — status shipped: every task has code on main; done waits for the live checks WIRE.4 and LAUNCH.3 (T8), which give G1 and G2 their evidence — orchestrator
/+++
