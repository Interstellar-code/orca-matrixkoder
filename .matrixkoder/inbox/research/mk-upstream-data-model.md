# Upstream MatrixKoder data model (inventory for the Orca port)

Scope: read-only inventory of the live data folder `~/.matrixkoder`, the upstream repo `/Users/rohits/Development/matrixkoder`, and the inbox. Nothing was modified. Secrets are redacted.

## Command failures

1. `sqlite3 -readonly ~/.matrixkoder/projects/matrixkoder/mk-project.db .schema` failed on the relative path with `Error: in prepare, unable to open database file (14)`. Attempt 2, the absolute path, failed with the same error.
2. Attempt 3 used the URI form. `sqlite3 -readonly -cmd ".open file:...?mode=ro"` printed nothing. `sqlite3 -readonly -uri ...` failed with `sqlite3: Error: unknown option: -uri`. Three attempts are used up, so this item is stopped. The matrixkoder project DB schema and row counts are NOT in this file.
3. Substitute sample, labelled: the claude-mnemosyne project DB opens fine with the same command. Its schema and counts are used below as the "one project DB" sample. This is the same method on a different project, not a workaround for the failed file.
4. Disclosure: while reading `bus/bus-tokens.json` top-level keys, the key names (603 opaque token-like ids) were printed into the session transcript by mistake. They are NOT in this file. If these ids are live credentials, treat them as exposed.

## 1. Live data folder `~/.matrixkoder`

### 1.1 Tree (depth 3, sizes; lock files listed by name only)

```
~/.matrixkoder/                                  (total ~255 MB)
├── .migrate-v2.json                 2.7 KB     migration marker
├── .retire-v2.json                  219 B      migration marker
├── config.json                      177 B      legacy UI toggles (see 1.2)
├── mk-settings.yaml                 88 B       global settings (see 1.2)
├── mk-overview.db                   100 KB     root store (SQLite)
├── mk-overview.db-shm               32 KB      SQLite WAL sidecar
├── mk-overview.db-wal               0 B        SQLite WAL sidecar
├── usage.json                       6.8 KB     quota ledger (top keys in 1.4)
├── usage.json.lock                  0 B        lock file
├── matrixkoder.yaml.lock            0 B        lock file
├── backups/                         102 MB     1340 files; dated snapshots
│   ├── bus-root-20261016-182805/    bus-lanes/, bus-tokens.json (186 KB)
│   ├── drift-2026-10-22/            bug-hunt/, bug-hunt-backup-...tgz (3.7 MB), MANIFEST.txt
│   ├── migrate-20261016-182756/     matrixkoder/, mk-overview-pre-catalog-seed-20261022.db
│   ├── mk-project-claude-mnemosyne-pre-repair-20261023-124534.db (1.5 MB)
│   ├── pre-repo-home-20261024/      config.json, mk-overview.db (100 KB), mk-settings.yaml, projects/
│   ├── retire-20261016-182823/      manifest.json, mk.db, projects.json, locks/
│   ├── root-cleanup-20261016T092025Z/  manifest.json, mk.db, files/
│   ├── root-pre-l10.9-20261016-111949/ files.tgz, mk.db
│   └── stray-*/                     small leftover JSON / DB copies
├── bus/                             2.0 MB     463 files
│   ├── bus-tokens.json              186 KB     603 entries (contents redacted)
│   ├── bus.json, ring-queue.json    (named in state-schema; not inspected)
│   └── lanes/                       458 files  <sha256(lane)>.json, 240 B each
├── inbox/                           3.1 MB     37 files, 10 dirs (see section 3)
├── locks/                           2 files    lock files only
└── projects/                        148 MB     864 files, 4 project folders
    ├── claude-mnemosyne/            ~2.8 MB DB
    │   ├── mk-project.db            2.7 MB     project store
    │   ├── mk-project.db-shm        32 KB
    │   ├── mk-project.db-wal        0 B
    │   ├── mk-overview.db          36 KB      (present; role not checked)
    │   ├── matrixkoder.yaml         454 B      legacy project settings (see 1.3)
    │   ├── matrixkoder.yaml.bak     130 B
    │   ├── matrixkoder.yaml.lock    0 B
    │   ├── lanes.lock               0 B
    │   ├── mk.db                    0 B        empty legacy store name
    │   ├── plans/
    │   │   ├── archive/
    │   │   ├── mnemosyne-070.md     54.7 KB    plan file
    │   │   ├── mnemosyne-ui.md      85.0 KB
    │   │   ├── mnemosyne-ui-v2.md   119.0 KB
    │   │   ├── mnemosyne-070/       assets/ (design/, research/)
    │   │   └── mnemosyne-ui/
    │   └── runs/
    │       ├── .lock               0 B
    │       ├── mnemosyne-070/   mnemosyne-070b/   mnemosyne-ui/   mnemosyne-ui-v2/
    ├── matrixkoder/                 ~45 MB DB
    │   ├── mk-project.db           45.0 MB    project store (row counts NOT available, see failures)
    │   ├── mk.db                   24 KB      legacy store name, kept alongside
    │   ├── mk.db-shm               32 KB
    │   ├── mk.db-wal               0 B
    │   ├── project.yaml            6.1 KB     project settings
    │   ├── project.yaml.bak        6.2 KB
    │   ├── project.yaml.lock       0 B
    │   ├── .migrate.json           859 B      migration record
    │   ├── legacy/matrixkoder-20261016-182846.tar.gz   8.9 MB  old data dir tarball
    │   ├── archive/
    │   │   ├── plans/
    │   │   ├── todo-94-orphans-20261017T191045Z.db      41.5 MB
    │   │   └── todo-94-pre-delete-20261017T190819Z.db   41.6 MB
    │   ├── bugs/                   (empty in this listing)
    │   ├── plans/                  mk-caveman-lanes/  mk-ponytail-hooks/  plan-done-warn/
    │   └── runs/                   .lock  bugs/  pdw-r1/
    ├── hermes-agent/               ~350 KB DB
    │   ├── mk-project.db           348 KB
    │   ├── mk-project.db-shm       32 KB
    │   ├── mk-project.db-wal       0 B
    │   ├── project.yaml            449 B
    │   ├── .migrate.json           1.1 KB
    │   └── plans/notifications-hermes/
    └── pdceb35c892fc86bb/          no DB; only settings
        ├── project.yaml            470 B
        └── project.yaml.bak        345 B
```

Note: `runs/` contents below depth 3 were not inspected. `projects.json` is not in the live root (it appears only under `backups/`).

### 1.2 Small config files (full contents)

`config.json` (legacy UI toggles, read once by `migrate-settings`):

```json
{
  "schema": 1,
  "dashboard": {
    "auto_open": true,
    "chip": true,
    "toasts": true
  },
  "usage": {
    "poll_min": 5
  },
  "updated": "2026-10-08T22:53:57.588Z"
}
```

`mk-settings.yaml` (global settings layer, mode 600):

```yaml
dashboard.auto_open: true
dashboard.chip: true
dashboard.toasts: true
usage.poll_min: 5
```

### 1.3 One project settings file: `projects/claude-mnemosyne/matrixkoder.yaml` (full)

```yaml
helpers: { herdr: ok, jev: ok, context_mode: ok, codebase_memory: missing, canary: ok, probed_at: "2026-10-23T10:10:26.633074Z" }
session:
  fresh_session: new
  subagents: true
  subagent_model: ""
  stall_min: 15
  max_wait_min: 30
  reviewer_split: right
  todo_done_status: verify
  selftest_jobs_total: 3
  reuse_reviewer: true
picks:
routing_preferences:
  reviewer: claude sonnet medium
  visual_reviewer: claude haiku
lanes:
  default_agent: omp
```

This is the legacy yaml. Its `settings` table in the project DB holds 0 rows, so the values are still read from the yaml layer, not migrated into the DB.

### 1.4 Redacted top-level keys

1. `usage.json`: top keys `agents` (dict, 5 agents) and `updated_at` (timestamp). No values are reproduced.
2. `bus/bus-tokens.json`: a dict of 603 entries. Keys are opaque token-like ids and are NOT reproduced. Values are dicts; their field names were not inspected.

## 2. SQLite schemas

### 2.1 Root store `~/.matrixkoder/mk-overview.db` (full `.schema`)

```sql
CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
CREATE TABLE projects(
  slug TEXT PRIMARY KEY, name TEXT, repo TEXT, data_dir TEXT, mode TEXT, created TEXT, last_activity TEXT, db_path TEXT);
CREATE TABLE agents(
  id TEXT PRIMARY KEY, kind TEXT, cli TEXT, provider_plans_json TEXT, capabilities_json TEXT,
  status TEXT, notes TEXT, updated TEXT);
CREATE TABLE catalog_user(
  agent TEXT, model TEXT, field TEXT, PRIMARY KEY(agent, model, field));
CREATE TABLE models(
  agent TEXT, id TEXT, provider TEXT, display TEXT, context_tokens INTEGER,
  effort_levels_json TEXT, benchmarks_json TEXT, cost_json TEXT, quota_pool TEXT,
  status TEXT, notes TEXT, updated TEXT, capabilities_json TEXT, user_json TEXT,
  PRIMARY KEY(agent, id));
CREATE TABLE plan_summary(
      project TEXT, plan TEXT, title TEXT, status TEXT, counts_json TEXT, live_run TEXT, updated TEXT,
      PRIMARY KEY(project, plan));
CREATE TABLE todos(
  project TEXT NOT NULL, id INTEGER NOT NULL, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
  created TEXT, PRIMARY KEY(project, id));
```

Row counts: schema_version 3, projects 15, agents 6, catalog_user 1, models 218, plan_summary 20, todos 22.

### 2.2 Project store, sample `projects/claude-mnemosyne/mk-project.db`

Substitute sample (see failures). Table list and index list:

```
tables: acks, artifacts, change_log, event_src, events, evidence, lane_slots,
        plan_items, plan_versions, plans, reconcile_due, risk_reasons, runs,
        schema_version, settings, tasks, waits, watch_cursors
indexes: art_run_src (artifacts), ev_task (events), evidence_run_task (evidence),
         risk_reasons_run_task (risk_reasons)
```

Clean definitions captured:

```sql
CREATE TABLE plans(
id TEXT PRIMARY KEY, version INTEGER, title TEXT, header_json TEXT, body_md TEXT,
approved_at TEXT, archived_path TEXT, status TEXT, created TEXT, design TEXT,
integration TEXT);
CREATE TABLE runs(
id TEXT PRIMARY KEY, plan TEXT, plan_version INTEGER, branch TEXT, status TEXT, stage TEXT,
next TEXT, started TEXT, ended TEXT, extra_json TEXT);
CREATE TABLE tasks(
run TEXT, id TEXT, parent TEXT, type TEXT, title TEXT, acceptance TEXT, owned TEXT, deps TEXT,
parallel INTEGER, route_json TEXT, status TEXT, prev_status TEXT, file_status TEXT, lane TEXT, slot TEXT, branch TEXT, pane TEXT,
round INTEGER, verdict TEXT, updated TEXT, extra_json TEXT, PRIMARY KEY(run, id));
CREATE TABLE events(
id INTEGER PRIMARY KEY, run TEXT, task TEXT, t TEXT, chan TEXT, kind TEXT, from_id TEXT,
to_id TEXT, reply_to TEXT, text TEXT, artifact_id INTEGER, meta_json TEXT);
CREATE INDEX ev_task ON events(run, task, id);
CREATE TABLE artifacts(
id INTEGER PRIMARY KEY, run TEXT, task TEXT, round INTEGER, kind TEXT, rev INTEGER, text TEXT, created TEXT, src TEXT);
CREATE INDEX art_run_src ON artifacts(run, src);
CREATE TABLE acks(run TEXT, msg TEXT, lane TEXT, level INTEGER, t TEXT, PRIMARY KEY(run, msg, lane));
CREATE TABLE lane_slots(
slot TEXT PRIMARY KEY, lane_path TEXT, state TEXT, run TEXT, task TEXT,
workspace TEXT, workspace_id TEXT, branch TEXT, lock_hash TEXT, updated TEXT);
CREATE TABLE waits(id INTEGER PRIMARY KEY, run TEXT, question TEXT, opened TEXT, cleared TEXT);
CREATE TABLE change_log(change_no INTEGER PRIMARY KEY, run TEXT, task TEXT, t TEXT);
CREATE TABLE evidence(
id INTEGER PRIMARY KEY, run TEXT, task TEXT, line TEXT, gate TEXT, result TEXT,
tree_sha TEXT, by TEXT, ref TEXT, output_tail TEXT, output_sha256 TEXT, created TEXT);
CREATE TABLE risk_reasons(id INTEGER PRIMARY KEY, run TEXT, task TEXT, kind TEXT, points INTEGER, source TEXT, ...);  -- trailing columns unreadable in capture
CREATE TABLE reconcile_due(id INTEGER PRIMARY KEY, run TEXT, scope TEXT, created TEXT, done TEXT);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT, updated TEXT);
CREATE TABLE watch_cursors(key TEXT PRIMARY KEY, seq INTEGER NOT NULL, started TEXT, updated TEXT);
CREATE TABLE event_src(run TEXT, src TEXT, PRIMARY KEY(run, src));
CREATE TABLE plan_items(
plan TEXT, version INTEGER, id TEXT, parent TEXT, type TEXT, title TEXT, acceptance TEXT,
owned TEXT, deps TEXT, parallel INTEGER, route_json TEXT, extra_json TEXT, ord INTEGER,
PRIMARY KEY(plan, version, id));
CREATE TABLE plan_versions(
plan TEXT, version INTEGER, sha TEXT, created TEXT, approved_at TEXT,
PRIMARY KEY(plan, version));
```

Row counts: schema_version 7, plans 3, runs 4, tasks 184, events 814, artifacts 65, acks 30, lane_slots 3, waits 0, change_log 913, evidence 91, risk_reasons 0, reconcile_due 6, settings 0, watch_cursors 2, event_src 469, plan_items 142, plan_versions 3.

Note: `risk_reasons` has no `.schema` line captured for its trailing columns, so treat its exact columns as unverified.

## 3. Inbox `~/.matrixkoder/inbox`

### 3.1 Listing (37 files, 10 dirs; ext: .md 25, .html 5, .png 4, .tsv 1, .json 1)

```
inbox/
├── plan-done-warn.md                  flat plan (standard form)
├── bugs-tab/                          folder plan
│   ├── plan.md   contract.md   REPORT.md
│   └── research/                      research-A..E .md, liverun-py.md, liverun-ts.md
├── improve-history-db/                folder plan: plan.md, context.md, r1-db.md, r2-hook.md, r3-ui-tests.md
├── mk-fixes-r1/                       plan.md, mk-improvements-verified-2026-10-21.tsv
├── mnemosyne-ui-v2/
│   ├── design/                        *.dc.html, canvas.json, *.png, three-bloom-orbit.js
│   └── research/                      db-audit.md, embeddings.md, engine-features.md, llm-config.md, plan-review.md
├── plan-archive/                      plan.md
├── status-model-r1/                   plan.md
└── todo-tab-r1/                       plan.md
```

There is no `inbox/archive/` and no `inbox/.deleted/` in the live home yet. Both are created on first archive or delete.

### 3.2 Plan folder structure (`bugs-tab/`)

Files: `plan.md`, `contract.md`, `REPORT.md`, `research/` (7 .md files).

Headings in `bugs-tab/plan.md`:

1. `# bugs-tab — Bugs tracker per repo, on existing task machinery, own tab` (title)
2. `## Summary`
3. `## Goal`
4. `## Design / context`
5. `## Phases` with `### BRUN permanent bugs run project and mk-bug CLI`, `### DRAFT — bug drafts in project's bugs folder`, `### UI Bugs tab`, `### LANE — send bug lane`
6. `## Risks`
7. `## Live-run check (2026-10-23)`
8. `## Open questions`
9. `## Log`

### 3.3 Flat plan file (`plan-done-warn.md`)

Headings: `# plan-done-warn — closing run missing plan's runs list reported`, `## Summary`, `## Goal`, `## Design / context` (with `### What wrong today`, `### Shape change`, `### Contracts`, `### Out scope`), `## Phases` (one `### PDW — ...`), `## Risks`, `## Open questions`, `## Log`.

## 4. Upstream code and docs (read-only, `/Users/rohits/Development/matrixkoder`)

### 4.1 `docs/state-schema.md`

Sections: Locations; the folder tree (C2); Who writes what; The project DB (run fields, task object); Schema 6 (evidence, risk_reasons, reconcile_due); Events table; `lanes.json` (slot registry); Lock file `<home>/locks/<resource>.lock`; Usage ledger additions; Usage ledger pools.

Key facts:

1. Data-dir order: `--data` arg, then `$MATRIXKODER_DATA`, then the repo's `projects.data_dir` row in the root store, then the repo folder.
2. Home: `$MK_HOME` or `$MATRIXKODER_HOME` or `~/.matrixkoder`. If both env names are set they must agree.
3. Writers: `mk-state.py` owns project-DB run/task/event tables and lane locks; `mk-plan.py` owns `plans` and task rows and the plan folder; `mk-lane.py` owns `lane_slots`; `mk-bus.py` owns `<home>/bus/`; `lane-watch.py` and `lane-health.py` own events and the quota mark in `usage.json`; `mkdb.py` owns root `plan_summary` and every project-table write.
4. Two DB kinds only: root store and one per project store. No per-plan DB and no bus DB.
5. Store names: new homes use `mk-overview.db` and `mk-project.db`. An existing home may keep `mk.db`. The lookup never renames.

### 4.2 Folder tree (from `docs/state-schema.md`)

```
~/.matrixkoder/
├── mk-overview.db                root store
├── usage.json
├── bus/                          bus.json, bus-tokens.json, lanes/<sha256(lane)>.json, ring-queue.json
└── projects/<slug>/
    ├── mk-project.db             project store
    ├── project.yaml              (today's matrixkoder.yaml)
    ├── legacy/                   read-only tarball of the old data dir
    └── plans/<plan-id>/
        ├── plan.md
        ├── assets/              mockups, design files
        ├── archive/             plan-v1.md, plan-v2.md ...
        └── runs/<run-id>/
            ├── bus.jsonl
            └── <task-id>/        brief-rN.md, report-rN.md, review-rN.md
```

### 4.3 `scripts/mkpaths.py` (the one path module)

It defines these path functions and names:

1. Home and repo: `home()`, `main_worktree()`, `repo_top()`, `data_dir()`.
2. Stores: `root_db()`, `project_db()`, `db_path_of()`, `_resolve_db()`, `db_in()`, `root_db_in()`, `project_db_in()`, `legacy_db_in()`, `new_db_in()`, `db_files_in()`.
3. Project folder: `project_dir()`, `project_yaml_in()`, `legacy_yaml()`, `legacy_lanes()`, `legacy_cursors()`, `project_data_dir()`, `project_slug_of()`, `migrated_slug()`.
4. Runs and tasks: `run_doc_in()`, `task_doc_in()`, `events_doc_in()`, `board_doc_in()`, `legacy_run_dir()`.
5. Settings and inbox: `mk_settings()` (the `<home>/mk-settings.yaml` path), `inbox_dir()`, `projects_json()`.
6. Names (constants): `ROOT_DB_NAME`, `PROJECT_DB_NAME`, `LEGACY_DB_NAME` (`mk.db`), `PROJECTS_JSON`, `USAGE_LEDGER`, `MK_SETTINGS_NAME`, `LEGACY_YAML_NAME`, `PROJECT_YAML_NAME`, `RUN_DOC_NAME` (run.json), `TASK_DOC_NAME` (task.json), `EVENTS_DOC_NAME` (events.jsonl), `BOARD_DOC_NAME` (board.md), `LANES_NAME`, `CURSORS_NAME` (watch-cursors.json), `INBOX_DIR` (`inbox`), `LANE_BUS_FILE` (`.matrixkoder-bus.json`), `BUGS_DIR` (`bugs`), `BUGS_ARCHIVE_DIR` (`archive`), `BUGS_RUN` (`bugs`), `SLUG_RE` (`^[a-z0-9][a-z0-9-]{0,40}$`).

### 4.4 `skills/matrixkoder/templates/plan.md` (section headings)

1. Line 2-4: header comment (plan identity, check and status comments).
2. Line 14: `# <plan id> — <one line: what this plan delivers>`
3. `## Summary` with `### Legend — the only values each line may hold`
4. `## Goal`
5. `## Design / context` with `### What is wrong today`, `### Shape of the change`, `### Contracts`, `### Test plan`, `### Assumptions and dependencies`, `### Rollout and undo`, `### Settings and limits`, `### Out of scope`
6. `## Phases` with `### Legend — task risk and what it requires`, `### Legend — phase and task settings`, `### P1 — <phase title>`, `### RUN — A run reads the store only`
7. `## Gates` with `### Legend — gate names for \`use\``
8. `## Risks`
9. `## Open questions`
10. `## Log`

Numbered blocks counted by the inbox (`BLOCKS` in `mk-inbox.py`): 1 Top block, 2 Summary, 3 Goal, 4 Design / context, 5 Phases, 6 Gates, 7 Risks, 8 Open questions, 9 Log. Block 10 (Notes) is the template's how-to and is deleted when a plan is written.

### 4.5 `scripts/mk-inbox.py` (inbox import and validation)

Commands: `list --json`, `import <id>`, `archive <id>`, `restore <id>`, `delete <id> [--archived]`.

1. The standard is one flat `inbox/<topic>.md` per plan. A folder holding `plan.md` is also accepted.
2. A plan's id is the `plan = "..."` value in its header. A file with no header falls back to its file name without `.md`.
3. Validation: `list` runs `mk-plan.py check --classify` on each file. The fit classes are `template`, `partial` and `not_a_plan`. Block-format files are counted `n of 9 blocks found` with the missing names. Old-format files are counted `n of 7 sections found`. Any missing block makes the fit `partial`, never `template`. A file with no `phase or task headings` is `not_a_plan`.
4. Import runs three reported steps: 1 parse the template, 2 write the project, 3 write the tasks. A flat `<topic>.md` then moves to `inbox/archive/`. A plan folder moves itself. Import refuses if `inbox/archive/<name>` already exists.
5. `archive` moves `inbox/` to `inbox/archive/`. `restore` moves back. Both refuse when the target exists.
6. `delete` copies the entry to `inbox/.deleted/<id>-<timestamp>/`, verifies the copy, then removes the original. It refuses symlinks and paths outside the inbox.
7. Every action is written as an event on the project store's inbox channel (`found`, `checked`, `import-step`, `imported`, `import-failed`, `archived`, `restored`, `deleted`).

### 4.6 Every settings key read from `mk-settings.yaml` or `config.json`

Grep: `grep -rn "mk-settings\|config.json" scripts skills docs` gave 76 hits. Readers and writers:

1. `scripts/mk-config.py`: layered reader (project DB `settings` row > `<home>/mk-settings.yaml` > `project.yaml` > default), `set` and `unset` with `--global`, `migrate-settings`. Holds the SCHEMA table.
2. `scripts/mk-migrate.py`: carries `config.json` into `mk-settings.yaml`, removes the dead yaml copies, and can retire `config.json`.
3. `scripts/mkpaths.py`: `mk_settings()` returns the path.
4. `scripts/mkdb.py` (line ~2508): keeps `config.json` during root cleanup.
5. Docs: `skills/matrixkoder/SKILL.md`, `docs/howto.md`, `skills/matrixkoder/templates/matrixkoder.yaml`.

Keys that go to `mk-settings.yaml` (global) or the retired `config.json`:

1. `dashboard.auto_open`, `dashboard.chip`, `dashboard.toasts` (retired UI toggles, from `config.json`).
2. `usage.poll_min` (retired; migrate removes the dead yaml copy).
3. `lanes.default_agent` (global, `text`, default `omp`).

Other keys defined in the SCHEMA (30 rows in `scripts/mk-config.py`), with their scope:

1. `repo.lanes.slots` (project, num, default 3), `repo.lanes.reuse` (project, bool), `repo.lanes.copy` (project, list)
2. `repo.integration_branch` (project, text, default `main`)
3. `qa.integration_target` (project, seg, default `local-main`)
4. `autonomy_contract.builder_skip_permissions` (project, bool, default true)
5. `routing_preferences.policy` (routing, seg, default `claude-sparing`), `.builder_order` (routing, list), `.max_build_lanes` (routing, num, 3)
6. `routing_preferences.reserve_floor.claude.five_hour_left_pct` (num, 40), `.claude.weekly_left_pct` (num, 30), `.others.five_hour_left_pct` (num, 10), `.others.weekly_left_pct` (num, 15)
7. `routing_preferences.reviewer` (select, default `claude sonnet medium`), `routing_preferences.visual_reviewer` (select, default `claude haiku`)
8. `usage.source` (agents, seg, default `codexbar`), `usage.providers`
9. `session.fresh_session`, `session.subagents`, `session.subagent_model`, `session.stall_min` (default 15), `session.max_wait_min` (default 30), `session.reviewer_split`, `session.todo_done_status`, `session.selftest_jobs_total`, `session.reuse_reviewer`
10. `bus.enabled`, `bus.owner_timeout_min` (default 30), `bus.ask_timeout_s` (default 600)
11. `lanes.default_agent` (see item 3 above)

Dead yaml keys (removed by migrate, never hand-edited): `dashboard:` block and `usage.poll_min`.

## 5. Layout to mirror in `orca-matrixkoder/.matrixkoder/`

Based only on what upstream uses. Items marked "not upstream" are choices the Orca repo already makes, not upstream rules.

### 5.1 Proposed tree

```
orca-matrixkoder/.matrixkoder/
├── inbox/                              SHAREABLE: plan files waiting for import (upstream: <home>/inbox/)
│   ├── <topic>.md                      flat plan, the standard form
│   ├── <plan-id>/                      folder form (accepted by upstream)
│   │   ├── plan.md
│   │   ├── assets/                     upstream plan-folder name for mockups and design files
│   │   └── research/                   used by live upstream folders; not in the template (not upstream rule)
│   ├── archive/                        SHAREABLE: plans already imported (upstream inbox/archive/)
│   ├── .deleted/                       LOCAL: copies made by delete (upstream inbox/.deleted/)
│   ├── research/                       not upstream: this repo's current loose research folder
│   └── assets/                         not upstream: this repo's current loose assets folder
├── projects/<slug>/                    LOCAL by default (upstream keeps all of this under the home)
│   ├── mk-project.db                   LOCAL: project store
│   ├── project.yaml                    LOCAL unless the team wants shared per-project settings
│   ├── plans/<plan-id>/                plan.md and assets/ SHAREABLE; archive/ and runs/ LOCAL
│   │   ├── plan.md
│   │   ├── assets/
│   │   ├── archive/                    plan-v1.md, plan-v2.md
│   │   └── runs/<run-id>/              LOCAL: bus.jsonl, <task-id>/brief, report, review
│   ├── bugs/                           drafts: LOCAL; bugs/archive/ LOCAL
│   └── legacy/                         LOCAL: tarball of an old data dir
└── (home-level, upstream ~/.matrixkoder)
    ├── mk-overview.db                  LOCAL
    ├── mk-settings.yaml                LOCAL (global prefs, no secrets; may share if wanted)
    ├── usage.json                      LOCAL: quota ledger
    ├── bus/                            LOCAL, NEVER COMMIT: bus-tokens.json holds tokens
    ├── locks/                          LOCAL
    └── backups/                        LOCAL
```

### 5.2 Local (not for git) versus shareable

Local, must not be committed:
1. Every `*.db`, `*.db-wal`, `*.db-shm` file (root and project stores, and any `mk.db`).
2. Every `*.lock` file and `locks/`, `runs/.lock`, `lanes.lock`.
3. `bus/` (token files and lane tokens).
4. `usage.json` and `usage.json.lock`.
5. `runs/` (bus messages, briefs, reports, reviews) and `archive/*.db` run copies.
6. `legacy/` tarballs, `backups/`, `inbox/.deleted/`, `*.bak`, `.migrate*.json`.
7. `watch-cursors.json`.

Shareable (candidates to commit):
1. `inbox/*.md` and `inbox/<plan-id>/plan.md` (the plans themselves).
2. `inbox/archive/` plans after import, if the team wants the history.
3. `plans/<plan-id>/plan.md` and `plans/<plan-id>/assets/` (design files, research notes).
4. `project.yaml` only if the team wants shared project settings (optional).

Suggested `.gitignore` for the Orca repo: ignore `.matrixkoder/**/*.db*`, `.matrixkoder/**/*.lock`, `.matrixkoder/**/runs/`, `.matrixkoder/**/archive/*.db`, `.matrixkoder/bus/`, `.matrixkoder/usage.json`, `.matrixkoder/inbox/.deleted/`, `.matrixkoder/**/legacy/`, `.matrixkoder/backups/`. Current check: `git check-ignore` on a path under `.matrixkoder/inbox/research/` returned not ignored, and `.gitignore` has no matrixkoder lines.

### 5.3 Parts upstream does not define (decide before porting)

1. `inbox/research/` and `inbox/assets/` at the inbox root: not upstream. Upstream keeps research and assets inside each plan folder.
2. Upstream reads `mk-settings.yaml` and `project.yaml` as plain files; the project settings currently live in yaml, not the DB (the `settings` table has 0 rows in the sample project). Decide whether the port reads the yaml layer, migrates it, or both.
3. Upstream's `mk.db` legacy names and `*.bak` files are migration leftovers. The port does not need to reproduce them.
4. The matrixkoder project store could not be read (see failures), so its real row counts and schema are unverified.
