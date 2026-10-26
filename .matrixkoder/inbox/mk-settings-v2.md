+++ 1 Top block — plan identity [toml]
plan = "mk-settings-v2"
status = "done"
created = 2026-10-25
runs = []
integration = "main"
pushed = false
/+++

+++ 2 Summary
# mk-settings-v2 — Settings tabs that fit MatrixKoder, each setting backed by code that uses it

## Summary
- Phases: 4 — SCHEMA: settings v2 keys, in-memory v1 migration, schema description, one read accessor; USE: backend code that reads every kept setting; SCREENS: six existing Settings screens rewired to saved values (layout kept), Appearance applied app-wide; SHIP: build outputs, version, release commit
- Method: waves · subagents allowed inside a phase
- Lanes: lane A: SCHEMA, then USE; lane B: SCREENS (starts when SCHEMA is merged); SHIP on main by the orchestrator — at most 2 lanes at once
- Delivery: main · pushed: no
- Gates: unit = npm test; types = npx tsc --noEmit; bundle = npm run build
/+++

+++ 3 Goal
## Goal
- Done when:
  - G1 — the Settings area has six tabs: General, Routing & Quota, Work, Safety, Notifications, Appearance; Agents, Alerts, Theme and Shortcuts are gone
  - G2 — every key in `mk-settings.json` is read through `setting()` by code that changes behaviour, proven by tests; no dead keys
  - G3 — every Settings screen shows the saved value after a reload and after an Orca restart, with ranges and options taken from the schema description
  - G4 — an existing v1 file loads without error; every v1 value the user changed and that still has a v2 home is kept
  - G5 — settings Orca owns appear as "Set in Orca: Settings > <pane>" notes, never stored by MK
  - G6 — each task brief MK sends is built from the task spec template for its scenario (investigate, implement, subdispatch, review, fix), from the user's file when one is set, else MK's built-in one
- Why: of 43 v1 rules only `routing.maxLanes` and `general.activeRepo` change behaviour; six of seven screens start from hardcoded state, so saves look lost on reload; the Safety tab promises guards a plugin cannot enforce
- From: the user, 2026-10-25 ("the present settings are not appropriate to the tabs and the options we need for the matrixkoder")
- Sources: `.matrixkoder/inbox/research/settings-inventory.md` and `settings-needs.md` (2026-10-25); `research/orca-settings.md`; `research/mk-data-schema.md`; review of this plan's first draft (25 findings, all folded in)
/+++

+++ 4 Design / context
## Design / context

### What is wrong today
1. 41 of 43 v1 keys are stored or echoed to the panel and read by nothing (consumers only at `src/server/actions.ts:243` and `src/server/snapshot.ts:101`).
2. Six screens start from hardcoded state; `Settings.dc.html` reads `values.mode` while the snapshot nests it under `values.general`.
3. Screen ranges disagree with the schema (lanes 1-8 vs 1-12, spare-Claude 10-60 vs 0-100, brightness 20-100 vs 0-100). About 25 controls bind to nothing; 15 keys have no control.
4. The plugin cannot intercept an agent's tool calls (capabilities `workspace:read`, `terminal:send`, `notifications:show`, `events:subscribe`, `storage`), so `safety.blockDestructiveGit`, `blockDeleteOutsideWorktree` and `scanDiffsForSecrets` cannot be honoured. Jev runs in the orchestrator session, so `routing.useJev` has no consumer.
5. Hardcoded today: the one notification (`src/worker.ts:157-162`, lane done); poll timers 10/60/30 s (`src/server/sync.ts:111-113`); backups 7 and prune ages (`src/store/maintenance.ts:11,49-70`: event_log 5000 rows, decision_log 90 days, lane/worktree 30 days); undo window 10 s (`src/server/index.ts:83`); ask snooze 60 min (`actions.ts:134`).
6. Facts the design relies on: `task.start` always launches with `worktree: 'new-child'` (`actions.ts:254`), so MK never knows a branch up front; `bug.fix` (`src/store/cli.ts`) only creates an Orca task and starts no worker; `plan_task.risk` is an int 1-5 and `plan_task.size` is trivial|standard|complex; `quota` rows are `(provider, win session|weekly|monthly, used_percent)` with provider names `claude, codex, gemini, opencodeGo, antigravity`; `alert_sent` has one text `key`; `lane.last_heartbeat_at` exists; `run.coordinator_handle` and `coordinatorHandle()` (`src/server/orca-call.ts:36`) exist; `todo` has only a `done` flag; the `run` table has no status and nothing writes `check_result`, so "gate failed" and "run done" have no source today, while task state changes are seen at `sync.ts:427` (plan tasks) and `:432` (bugs); no panel screen calls `task.start` today (Plan.dc.html:263 calls only `task.retry`); the dashboard listens on a random port (`http.ts:178`), so browser storage does not survive a restart; `scripts/dev-snapshot-server.mjs:15-23,234` keeps its own copy of the action names; an agent → quota-provider map already exists at `snapshot.ts:550`.

### Tab map (v1 → v2)
1. General → General: active repo, first screen, undo window, snooze default; Data section (backups, prune limits); Sync section (refresh timers); folder and version info, read-only; Reset section and Export buttons.
2. Agents + Routing → Routing & Quota: per agent routable, default model and effort (Orca's installed and account state shown read-only); a route per task size; lanes at once; quota floors and what to do below them.
3. (new) Work: stall minutes, default bug risk, plans inbox folder and auto-import, and Task spec templates (one markdown template path per scenario: investigate, implement, subdispatch, review, fix; C10).
4. Safety → Safety: one enforced rule (confirm before starting a high-risk task) and three advisory rules MK writes into every task brief it sends (protected branches, never-run commands, ask before push). Each row is labelled "enforced by MK" or "advisory: written into briefs".
5. Alerts → Notifications: per-event toggles (ask, lane done, task failed, stall, quota low), quiet hours, wake orchestrator, Test button. OS permission and sounds: "Set in Orca: Settings > Notifications".
6. Theme → Appearance: rain, reduce motion, text size, density, applied to every screen. Light/dark is Orca's.
7. Shortcuts → dropped (keybindings are manifest-static; `footer` has no consumer).

### Contracts
C1 — `mk-settings.json` schema 2: the top-level `schema: 2` plus these keys (ranges inclusive):
```
general.activeRepo          string|null                      null
general.mode                enum orchestrator|solo           orchestrator   (C8)
general.openOnStart         enum projects|lanes|waiting|plan|last   last   ("last" = kv 'panel.lastScreen' on the server)
general.undoSeconds         int 0-60                         10     (0 = no undo window)
general.snoozeMinutes       int 1-1440                       60
data.backupKeep             int 1-30                         7
data.goneDays               int 7-365                        30     (ended lanes, gone worktrees)
data.decisionDays           int 7-365                        90     (decision_log)
data.eventMax               int 500-50000                    5000   (event_log rows)
sync.fastSeconds            int 5-120                        10
sync.slowSeconds            int 30-900                       60     (quota is pulled here)
sync.filesSeconds           int 10-600                       30     (inbox scan)
agents.<id>.routable        bool                             true   ids claude, codex, agy, opencode, omp; unknown ids kept
agents.<id>.models          list<=12 of {id string<=80, efforts list of low|medium|high|xhigh|max|ultra, note string<=200}   seeded per C9
agents.<id>.model           string<=80: "", or an id in agents.<id>.models, or any string when that list is empty   ""     ("" = agent's own default)
agents.<id>.effort          enum ""|low|medium|high|xhigh|max|ultra; when the chosen model's efforts list is non-empty, "" or one of those   ""
routing.bySize.trivial|standard|complex   route text "agent [model [effort]]" <=120, checked by the C9 route check   "claude haiku low" | "claude sonnet medium" | "claude opus high"
routing.maxLanes            int 1-12                         3
quota.floor.claude.sessionPct|weeklyPct   int 0-100          40 | 30   (percent LEFT)
quota.floor.others.sessionPct|weeklyPct   int 0-100          10 | 15
quota.onBelowFloor          enum off|warn|block              block
lanes.stallMinutes          int 5-120                        15
bugs.defaultRisk            int 1-5                          3
plans.inboxDir              string<=400, relative path only (no leading "/" or "~", no "..")   ".matrixkoder/inbox"  (resolved from each repo root; archive stays <inboxDir>/archive)
plans.autoImport            bool                             false
work.specTemplates.investigate|implement|subdispatch|review|fix   string<=400   ""   ("" = MK built-in template; a value starting with "~/.matrixkoder/templates/" resolves under <dataDir()>/templates/ (so MK_DATA_DIR is honoured); any other value is repo-relative; no leading "/", no "..", and the resolved path must stay inside its root; C10)
safety.confirmRiskAtLeast   int 1-6                          4      (6 = never ask)
safety.protectedBranches    list<=20 of string<=100          ["main", "release/*"]   advisory
safety.neverRun             list<=40 of string<=200          v1 defaults             advisory
safety.askBeforePush        bool                             true                    advisory
notify.events.ask|laneDone|taskFailed|stall|quotaLow   bool   true,true,true,false,false
notify.quietHours           {enabled bool, from HH:MM, to HH:MM}   {false, "22:00", "07:00"}
notify.wakeOrchestrator     bool                             false
look.rain.enabled|brightness|speed   bool | int 0-100 | enum slow|normal|fast   true | 60 | normal
look.reduceMotion           enum os|on|off                   os
look.textSize               enum S|M|L                       M
look.density                enum compact|comfy               comfy
```
Unknown keys are kept and not checked (as in v1). `settings.ts` exports `setting(s, 'a.b.c')`, the only way backend code reads a value. Options passed explicitly to `startServer`/`sync.start` by tests (`undoMs`, `fastMs`, `slowMs`, `filesMs`) win over settings. `data.goneDays` drives every prune rule that uses the 30-day cutoff (`maintenance.ts:66` lane, `:69` onward: worktree, run, ask, repo); the pane rule stays 7 days — written by SCHEMA.1, read by every phase

C2 — v1 → v2 migration, pure, in `src/store/settings-migrate.ts`, which also holds the v1 defaults as `V1_DEFAULTS` (moved out of `defaultSettings()`); it runs in memory inside `loadSettings` (which stays read-only; no write on load, so no race with the `mk` CLI). Only v1 values that differ from v1 defaults are carried, each normalised: ints clamped to the v2 range, unknown enum values replaced by the default, lists cut to the v2 cap. Map: `routing.maxLanes` kept; `theme.*` → `look.*` (`reduceMotion` true → on, false → os); `alerts.events.ask|laneDone|stall` → `notify.events.*`; `alerts.events.gateFail` → `notify.events.taskFailed`; `alerts.events.runDone` dropped; `alerts.quietHours` → `notify.quietHours`; `alerts.wakeOrchestrator` → `notify.wakeOrchestrator`; `alerts.stallMinutes` → `lanes.stallMinutes`; `alerts.usagePollMin` → `sync.slowSeconds` (× 60, clamped); `routing.spareClaudeBelowPct` → `quota.floor.claude.weeklyPct`; `routing.tiers.trivial|standard|complex` → `routing.bySize.*`; `routing.askBeforeDestructive` false → `safety.confirmRiskAtLeast` 6; `agents.<id>.model|effort|routable` kept; `safety.protectedBranches|neverRun|askBeforePush` kept; `general.activeRepo|openOnStart|mode` kept (openOnStart lower-cased, then normalised). Dropped: `routing.useJev|lowConfidence|tiers.finalReview`, `safety.blockDestructiveGit|blockDeleteOutsideWorktree|scanDiffsForSecrets`, `alerts.desktop|dashboard.*`, `shortcuts.*`. `loadSettings` never throws on a v1 file: a value that still fails validation falls back to its default and is listed in `migrationNotes[]`, which the snapshot carries. The first `saveSettings` after migration copies the whole v1 file to `mk-settings.v1.bak.json`, then writes v2 atomically — written by SCHEMA.2

C3 — schema description: `describeSettings()` returns per key `{type, default, min, max, options, owner: "mk"|"orca", enforced: "mk"|"advisory"|null, orcaPane?}`. It also lists display-only `owner: "orca"` rows, with panes from `research/orca-settings.md` §5: OS notifications and sounds (Settings > Notifications), light/dark theme (Settings > Appearance), agent install, accounts and permissions (Settings > Agents), keybindings (Settings > Keyboard); pane names not confirmed in the Orca UI are shown as "Set in Orca Settings". The snapshot carries it as `settings.schema` with `values` (nested shape, `values.general.openOnStart`) and `migrationNotes` — written by SCHEMA.1, read by SCREENS

C4 — actions: `settings.save {patch}` (exists; now refuses a dropped v1 key with `bad_args` naming it); `settings.reset {section}` (section = one top-level C1 group: general, data, sync, agents, routing, quota, lanes, bugs, plans, work, safety, notify, look; removes that group from the file so defaults show; never touches mk-data.db); `settings.export` (returns the effective settings JSON); `ui.remember {screen}` (writes kv 'panel.lastScreen', a SCREENS name). `notify.test` is registered by SCHEMA.3 as a stub that refuses with `kind: conflict, code: not_ready` ("notifier not built yet"), so `test/panel/contract.test.mjs` (every `this.action()` name must be in ACTION_NAMES) passes on main whichever lane merges first; USE.2 makes it send one notification through C6. No import action in v2. `scripts/dev-snapshot-server.mjs` gains the same names, answering with canned results — written by SCHEMA.3 (dev server: SCREENS.1), read by SCREENS

C5 — routing and quota in `task.start` (`src/server/routes.ts`). `task.start` checks in this order, stopping at the first refusal: resolve the route, `checkRoute` (`bad_route`, C9), routable, `max_lanes`, quota floor, then `needs_confirm` (C7) last, so a confirmed resend cannot hit an earlier refusal. The route is taken whole from the first source that has one: args (`agent`, `model`, `effort`), then `task.route`, then `phase.route`, then `routing.bySize[plan_task.size]`, then `bySize.standard`; sources are never mixed field by field. A route whose agent has `routable` false is refused naming the setting. Missing model/effort are filled from `agents.<id>` (empty stays empty, so Orca uses the agent default). Quota: one agent → provider map, moved from `snapshot.ts:550` to `src/server/providers.ts` and used by both (claude→claude, codex→codex, agy→antigravity, opencode→opencodeGo, gemini→gemini, omp→none); left = 100 − `used_percent` per window (session, weekly); a null window or no provider skips the check and says so in `warnings[]`; below a floor `warn` adds `warnings[]`, `block` refuses with `kind: conflict, code: quota_floor`. `bug.fix` is not routed (it starts no worker) — written by USE.1

C6 — notifier `src/server/notify.ts`, given a `notify` handle on `ServerCtx` that `worker.ts` fills with `host.call('notifications.show', …)` (tests stub it): `notify(event, key, title, body)` checks `notify.events.<event>`, suppresses all but `ask` in quiet hours, de-dupes on `alert_sent.key`. Sources and keys: ask — sync inserts a new ask, key `ask:<ask id>`; laneDone — `agent.status.changed` to done (replaces the hardcoded call in `worker.ts`), key `laneDone:<paneKey>:<minute>`; taskFailed — `last_state` changes to `failed` at `sync.ts:427` (plan task) or `:432` (bug), key `taskFailed:<plan_task|bug>:<id>:<orca_task_id>`; stall — `lane.last_heartbeat_at` older than `lanes.stallMinutes`, key `stall:<lane_key>:<last_heartbeat_at>`; quotaLow — a pulled window below its floor, key `quotaLow:<provider>:<win>:<resets_at>`. `wakeOrchestrator`: on ask, one line via `terminal send` to `coordinatorHandle()` of the ask's run; skipped when there is none — written by USE.2

C7 — safety: `task.start` for a task with `risk >= safety.confirmRiskAtLeast` refuses with `kind: conflict, code: needs_confirm` unless args carry `confirm: true`. The Plan screen gains a Start button (tasks with no Orca task yet) that shows a confirm dialog on `needs_confirm` and resends. Agents calling `mk.action` can pass `confirm: true` themselves, so the Safety row is labelled "checked by MK; the dashboard asks you, agents must confirm explicitly", not "enforced". Advisory rules: `taskSpec` (`actions.ts:193`) appends a "Rules from MatrixKoder settings" section listing protected branches (never commit or merge to them), never-run commands, and "ask before any push" when `askBeforePush` is on. MK does not filter text it sends — written by USE.3

C8 — solo mode (`general.mode = solo`: work runs in the main checkout, with in-session subagents, as the user works today; up to `routing.maxLanes` workers share that checkout, the limit unchanged): `task.start` passes `--worktree path:<repo root>` to `worker-start` instead of `new-child`, where `<repo root>` is `repo.path` of the plan's `repo_id`; the rules section (`{{rules}}`, C10) adds "Solo mode: work in this checkout; use in-session subagents for parallel parts, not Orca lanes or worktrees". Screens read the mode from `settings.values.general.mode` (present after SCHEMA.1; no new top-level snapshot field), and in solo mode hide: on Lanes, the branch line (`branchHead`, `Lanes.dc.html:105`), the Worktree row (`worktreePath`, `:117`) and "N worktrees" in the summary (`:269`, shown as "N lanes"); on Projects, " · N worktrees" in the sub line (`:212`) and "N idle worktrees" (`:134`); on Plan, nothing (it has no worktree control). Parallel solo lanes share one checkout: the Work screen shows "Solo mode: lanes share this checkout; set Lanes at once to 1 to avoid clashes" when mode is solo and `routing.maxLanes` > 1 (K7). Orchestrator mode behaves as today — written by USE.3 (backend) and SCREENS.4 (screens)

C9 — agent models and the route check. Seed for `agents.<id>.models`: SCHEMA.1 copies the list once, by hand, from `~/.claude/skills/jev/reference/models.md` (snapshot 2026-10-08) into source as a `MODEL_SEED` constant in `settings.ts`; the build never reads `~/.claude`. claude — haiku, sonnet, opus, fable (efforts low|medium|high|max); codex — gpt-6-astra, gpt-6.1-sol (low…ultra), gpt-6-luna (low…max); agy — gemini-3.8-flash-low|medium|high, gemini-3.1-pro-low|high, gpt-oss-120b-medium and the AGY-hosted Claude ids models.md lists (claude-opus-5-5-<lvl>, claude-sonnet-5-5-<lvl>) (effort is part of the id: efforts empty); opencode and omp — empty list (any model accepted until the user adds some). Once a user's file is saved, its models list is theirs; later seeds never merge into it. `checkRoute(text, settings)` in `src/store/routes-check.ts` (used by import and by `task.start`) returns `ok`, or an issue: unknown agent, agent not routable, model not in a non-empty `models` list, effort not in that model's `efforts`, and Orca's launch rules (`.matrixkoder/inbox/research/orca-cli-reference.md:2099`): an effort without a model ("--effort requires --model"), any effort for omp or opencode (unsupported), any effort for a model whose `efforts` list is empty (agy ids carry the effort). Empty route text is ok (= route by size). `task.start` fills model/effort from `agents.<id>` first (C5) and checks the filled route. MK route agent ids map to Orca `--agent` ids in `src/server/providers.ts`: agy → antigravity, claude, codex, opencode and omp as written; the `--agent` argv uses the mapped id (today `actions.ts:238` passes the route text as written). Plan import (`src/store/import.ts`): `InboxTarget` gains optional `settings` (default `defaultSettings()`); after `parsePlan`, `scanInbox` and `importFile` run `checkRoute` on every task `route` and phase `route`/`reviewer`, turn fit `pass` into `partial`, and add `task <code>: route "<text>": <issue>` (or `phase <id>: ...`) to `missing[]`; the callers in `actions.ts` and `sync.ts` pass `loadSettings(ctx.dir)`. A partial plan still imports and shows as Partial in Inbox, but `plan.start` refuses it with `kind: conflict, code: plan_partial` naming the first `missing[]` reason while the plan's current `plan_version.fit` is `partial`. `task.start` runs the same check on the resolved route and refuses with `kind: bad_args, code: bad_route` naming the setting, because settings may change after import. A phase `reviewer` is checked but not used (Q4) — written by SCHEMA.1 (seed, rules, checkRoute), USE.1 (task.start), USE.4 (import and plan.start); read by SCREENS.2

C10 — task spec templates. Scenarios: `investigate` (read-only research or spike; no edits, report findings), `implement` (a build with explicit file/component ownership from `owned`, possibly in parallel with other lanes), `subdispatch` (a lead worker that splits its task and spawns helpers, one writer per file), `review` (code review and verification, no edits, a verdict), `fix` (a targeted bug fix or a retry of a failed attempt; one built-in `fix.md` serves both). Built-in templates: the editable source is `templates/spec/<scenario>.md`; the shipped copy is compiled into code as string constants in `src/store/spec-builtin.ts` (so both the staged `plugin/` install and the marketplace install have them without a `templates/` folder), and a T11 case checks each constant equals its `.md` file. They are used when `work.specTemplates.<scenario>` is "". A template is markdown with placeholders `{{code}} {{title}} {{phase}} {{risk}} {{size}} {{attempt}} {{description}} {{acceptance}} {{owned}} {{gate}} {{manual}} {{deps}} {{rules}} {{repo}}` (lists render as "- " lines; `{{rules}}` is the C7 advisory section plus the C8 solo line); bug briefs add `{{bugId}} {{file}} {{line}} {{details}}`. Known placeholders are the union of the task and bug sets: a known placeholder with no value in this brief renders empty, and a line left empty by it is dropped; only names outside the union are unknown and trigger the fallback. A template without `{{rules}}` still gets the rules: MK appends the rules section after the rendered text and adds a warning. MK always writes the `mk-ref:` line first itself, outside the template, so crash recovery (C4 of orca-dashboard-wiring) never depends on a template. Scenario choice, first match wins: the task's explicit `scenario` (a task's own toml key, else its phase's settings-block `scenario`; at import the phase value is copied into each of its tasks' `plan_task.scenario` unless the task sets its own, and `plan_phase` gets no new column; parsed by `plan-parse.ts`, stored via mk-data.db migration 2; `scenario` joins `taskVals` in `import.ts` so a merge updates it); a retry (attempt > 1) → fix; a bug fix (`mk bug fix`, `bug.fix`) → fix; else implement. A phase's `subagents = true` only means helpers are allowed; it never selects subdispatch, which happens only when a `scenario` says so. `subdispatch.md` says helpers are in-session subagents in solo mode and Orca child workers otherwise (the mode line comes from `{{rules}}`). Migration 2: `src/store/schema-v2.ts` exports `SCHEMA_V2 = "ALTER TABLE plan_task ADD COLUMN scenario TEXT CHECK(scenario IS NULL OR scenario IN ('investigate','implement','subdispatch','review','fix'))"`; `db.ts` MIGRATIONS gets `{version: 2, note: 'plan_task.scenario', sql: SCHEMA_V2}`; `schema-v1.ts` is not edited. Loading and rendering: `src/store/spec-templates.ts` (in `src/store` so both `actions.ts` and `cli.ts` import it) resolves the path per C1, reads at most 32 KB, caches by path and mtime; a missing, unreadable, oversized file, a hand-edited path with "..", or an unknown placeholder falls back to the built-in template and adds a line to the action's `warnings[]`. `mk bug fix` adds template warnings to its JSON output as `warnings[]` and prints them to stderr; the `bug.fix` action passes them through. The snapshot carries `settings.specTemplates = {investigate|implement|subdispatch|review|fix: {path, source: 'builtin'|'file', ok, issue|null}}` for the active repo; SCHEMA.1 adds the field with all five set to `{path: '', source: 'builtin', ok: true, issue: null}` so lane B can bind to it, and USE.5 fills in the real status; `test/fixtures/build-snapshot.mjs` uses this shape. `taskSpec` (`actions.ts:193`) and `fixSpec` (`src/store/cli.ts:219`) both render through it — written by SCHEMA.1 (snapshot placeholder) and USE.5, read by SCREENS.2

### Test plan
T1 — schema 2 defaults validate; each key rejects a wrong value naming the key; `setting()` reads nested paths; the `/api/state` settings payload with `schema` stays under 64 KB — unit — `test/store/settings.test.mjs` — SCHEMA.1
T2 — a v1 fixture with every key changed (including maxLanes 5, effort "", "xhigh", openOnStart "Projects", stall 3, a 50-item neverRun list, gateFail false) migrates per C2 without throwing; untouched v1 defaults are not carried; notes list each fallback; load writes nothing; the first save writes the .bak then v2 — unit — `test/store/settings-migrate.test.mjs` — SCHEMA.2
T3 — `settings.reset` (per group, unknown group refused), `settings.export`, `ui.remember` and the dropped-key refusal behave as C4 — integration — `test/server/actions.test.mjs` — SCHEMA.3
T4 — routing table of C5 (args, task, phase, by size, fallback, whole-route precedence, unroutable refused, fill from agents), `checkRoute` cases of C9 (unknown agent, unknown model, wrong effort, effort without model, effort for omp/opencode, effort on an empty-efforts agy model, empty list accepts any model, empty route ok), `task.start` refusing `bad_route` after filling from `agents.<id>`, the stubbed runner seeing `--agent antigravity` for route agent agy, the C5 refusal order (a high-risk task with a bad route gets `bad_route`, not `needs_confirm`), quota cases (warn, block, null window, unknown provider), and one `task.start` call through Actions proving it uses the resolver (stubbed Orca runner sees the resolved agent, model, effort) — unit and integration — `test/server/routes.test.mjs` — USE.1
T5 — notifier: each C6 source fires once with its key, toggle off suppresses, quiet hours keep only ask, the same key twice sends once, stall fires after `stallMinutes` with a fake clock, wake sends one line to the coordinator handle, `notify.test` bypasses toggles — unit — `test/server/notify.test.mjs` — USE.2
T6 — `needs_confirm` at and above the threshold, `confirm: true` passes, threshold 6 never asks; the brief contains the advisory section with the configured values; in solo mode the stubbed runner sees `--worktree path:<repo root>` and the brief has the solo line — integration — `test/server/safety.test.mjs` — USE.3
T7 — remaining consumers: timers use `sync.*` and restart only when a `sync.*` key changed (no extra `pullAll`), explicit test options win; maintenance uses `data.*` on the rules C1 names; undo window and snooze default; inbox dir (relative only), auto-import of fit "pass" files only, snapshot inbox path from the setting; `mk bug add` default risk; a plan fixture with a bad task route and one with a bad phase reviewer each import as `partial` with the C9 reason, and `plan.start` on it refuses `plan_partial` — unit and integration — `test/server/consumers.test.mjs` — USE.4
T8 — dead-key check, run on main after both lanes merge: (a) server half: `setting()` records every path it is asked for; running T4-T7 and T11 with that recorder must cover every C1 key except the panel-read ones; families read by computed path (`agents.*`, `routing.bySize.*`, `quota.floor.*`, `notify.events.*`, `work.specTemplates.*`) count as covered when at least one member of each is read and the code reads the family by a declared prefix; (b) panel half: every `look.*`, `general.openOnStart` and `general.activeRepo` key appears in a literal `bind('<key>')` or a `look.` prefix read in `panel/` — unit — `test/store/no-dead-settings.test.mjs` — SHIP.1
T9 — each Settings screen renders a fixture snapshot with non-default values shown, saves one change as the right nested patch, and its min/max/options equal the fixture's `settings.schema`; Reset and Export work against the dev snapshot server; the Plan Start button handles `needs_confirm`; `test/panel/screens.test.mjs` lists the new screen set — integration (headless) — `test/panel/settings-screens.test.mjs`, `test/panel/screens.test.mjs` — SCREENS.1-3
T11 — spec templates: each `spec-builtin.ts` constant equals its `templates/spec/<scenario>.md`, and a built-in renders with no `templates/` folder present; each scenario's built-in renders every placeholder for a fixture task, and the shared `fix` template renders both a task retry and a bug (known placeholders with no value render empty, their empty lines dropped); a user file is used when set and its edit is picked up (mtime); a `~/.matrixkoder/templates/` path resolves under `MK_DATA_DIR`; a missing file, a hand-edited ".." path, a 40 KB file and an unknown placeholder each fall back with a warning; a user template without `{{rules}}` still gets the rules section appended plus a warning; scenario choice follows the C10 order (explicit task, explicit phase, retry, bug, else implement) and a phase with `subagents = true` and no scenario gets implement; `mk-ref:` stays the first line; `mk bug fix` JSON carries template `warnings[]`; an imported plan with a phase `scenario = "review"` stores it on each task without its own, a bad value makes fit partial, and a re-import merge updates it; a v1 mk-data.db opened by the new code gains `plan_task.scenario` with existing rows NULL — unit and integration — `test/server/spec-templates.test.mjs`, `test/store/db.test.mjs` (the `schema_version` count assertion becomes `SCHEMA_VERSION`), `test/store/import.test.mjs` — USE.5
T10 — Appearance: a snapshot with `look.rain.enabled` false and `textSize` L renders Main and two other screens with rain off and large text; `openOnStart: last` opens the screen named by the snapshot's `settings.lastScreen` (from kv) and screen changes call `ui.remember`; a snapshot with `settings.values.general.mode` solo renders Lanes, Projects and Plan without the C8 worktree-only columns and controls, and orchestrator mode shows them — integration (headless) — `test/panel/look.test.mjs` — SCREENS.4

### Assumptions and dependencies
A1 — the live machine may have no `mk-settings.json` yet — migration treats a missing file as defaults and does not read upstream `mk-settings.yaml`
A2 — the worker can call `notifications.show` while the panel is closed (it does today in `worker.ts`)
A3 — `quota` rows are refreshed by `pullSlow` — if a provider's row is missing, C5 skips its check with a warning
A4 — build outputs `out/` and `web/` are tracked in git — lanes do not stage them; SHIP rebuilds and commits them once after both lanes merge
/+++

+++ 5 Phases
## Phases
/+++

+++ 5.1 SCHEMA — settings v2 keys, migration, description and accessor
### SCHEMA — settings v2 keys, migration, description and accessor
- Goal: `src/store/settings.ts` validates C1, migrates v1 in memory per C2, describes itself per C3, exports `setting()`, and the C4 actions exist.
- Serves: G2, G4, G5
- Needs first: nothing
- Build order: SCHEMA.1, then SCHEMA.2 and SCHEMA.3. Do not stage `out/` or `web/`.
- Hazards: K1, K3
- Carries: C1, C2, C3, C4, C9, T1, T2, T3, A1
/+++

+++ 5.1.0 SCHEMA settings [toml]
id = "SCHEMA"
title = "settings v2 keys, migration, description and accessor"
wave = 1
owned = ["src/store/settings.ts", "src/store/settings-migrate.ts", "src/store/routes-check.ts", "src/server/snapshot.ts", "src/server/actions.ts", "test/store/settings.test.mjs", "test/store/settings-migrate.test.mjs", "test/server/actions.test.mjs", "test/fixtures/settings/"]
# lane A runs SCHEMA then USE in one worktree, so USE editing actions.ts and snapshot.ts after SCHEMA is safe; lane B (SCREENS) touches no src/ file
commit = "feat(settings): schema 2 with in-memory v1 migration, schema description and settings actions"
deps = []
size = "standard"
route = "claude sonnet medium"
reviewer = "claude opus high"
subagents = true
/+++

+++ 5.1.1 SCHEMA.1 — schema 2 rules, defaults, description and accessor [toml]
id = "SCHEMA.1"
title = "schema 2 rules, defaults, description and accessor"
covers = ["C1", "C3", "C9", "T1"]
acceptance = [
  "defaultSettings() returns schema: 2 plus exactly the C1 keys with C1 defaults, and SETTINGS_SCHEMA is 2; the v1 defaults move to settings-migrate.ts as V1_DEFAULTS",
  "validateSettings checks every C1 rule (including bySize agents being known agent ids and inboxDir being relative) and names the key in each issue",
  "agents.<id>.models is seeded from a MODEL_SEED constant per C9 (no build step reads ~/.claude) and src/store/routes-check.ts exports checkRoute with the C9 rules; the C1 model/effort rules follow each agent's models list",
  "the snapshot carries settings.specTemplates with all five scenarios set to the C10 built-in placeholder, so lane B can bind to it before USE.5",
  "setting(s, path) is exported and is how actions.ts:243 and snapshot.ts:101 now read their values",
  "describeSettings() covers every C1 key with owner and enforced as C3 says; the snapshot settings block carries values (nested), schema and migrationNotes",
  "T1 passes, including the 64 KB size check",
]
risk = 2
gate = "npm run build && node --test test/store/settings.test.mjs"
/+++

+++ 5.1.2 SCHEMA.2 — v1 to v2 migration [toml]
id = "SCHEMA.2"
title = "v1 to v2 migration"
covers = ["C2", "T2", "A1"]
acceptance = [
  "src/store/settings-migrate.ts maps a schema 1 object to schema 2 per C2: only values that differ from V1_DEFAULTS, clamped and normalised, routing.maxLanes kept, dropped keys removed",
  "loadSettings runs it in memory, never writes, never throws on a v1 file, and returns migrationNotes for each fallback",
  "the first saveSettings after a migration copies the v1 file to mk-settings.v1.bak.json, then writes v2 atomically",
  "T2 passes",
]
risk = 3
gate = "npm run build && node --test test/store/settings-migrate.test.mjs"
deps = ["SCHEMA.1"]
/+++

+++ 5.1.3 SCHEMA.3 — settings actions [toml]
id = "SCHEMA.3"
title = "settings actions"
covers = ["C4", "T3"]
acceptance = [
  "ACTION_NAMES gains settings.reset, settings.export and ui.remember with the C4 behaviour; the snapshot carries settings.lastScreen (inside the settings block, no new top-level key) from kv 'panel.lastScreen'",
  "settings.save refuses a dropped v1 key with bad_args naming it",
  "notify.test is in ACTION_NAMES as a stub refusing with code not_ready (C4); USE.2 replaces it",
  "T3 passes",
]
risk = 2
gate = "npm run build && node --test test/server/actions.test.mjs"
deps = ["SCHEMA.2"]
/+++

+++ 5.2 USE — backend code that reads every kept setting
### USE — backend code that reads every kept setting
- Goal: every C1 key not owned by the panel changes behaviour through C5-C7 or a direct `setting()` read (T8 proves it on main in SHIP.1).
- Serves: G2, G6
- Needs first: SCHEMA
- Build order: USE.1, then USE.2, then USE.3, then USE.4, then USE.5. Tasks run in sequence because USE.1-USE.3 all touch `actions.ts` and `sync.ts`. Do not stage `out/` or `web/`.
- Hazards: K2, K4, K5, K6, K7
- Carries: C5, C6, C7, C8, C9, C10, T4, T5, T6, T7, T11, A2, A3
/+++

+++ 5.2.0 USE settings [toml]
id = "USE"
title = "backend code that reads every kept setting"
wave = 2
owned = ["src/server/actions.ts", "src/server/snapshot.ts", "src/store/spec-templates.ts", "src/store/spec-builtin.ts", "templates/spec/", "src/store/plan-parse.ts", "src/store/db.ts", "src/store/schema-v2.ts", "test/server/spec-templates.test.mjs", "test/fixtures/templates/", "test/store/db.test.mjs", "test/store/cli.test.mjs", "test/store/import.test.mjs", "test/server/actions.test.mjs", "src/server/routes.ts", "src/server/providers.ts", "src/server/notify.ts", "src/server/sync.ts", "src/server/common.ts", "src/server/index.ts", "src/server/decisions.ts", "src/store/maintenance.ts", "src/store/import.ts", "src/store/cli.ts", "src/worker.ts", "test/server/routes.test.mjs", "test/server/notify.test.mjs", "test/server/safety.test.mjs", "test/server/consumers.test.mjs"]
commit = "feat(server): routing by size, quota floors, notifier and safety confirm read the v2 settings"
deps = ["SCHEMA"]
size = "complex"
route = "claude sonnet medium"
reviewer = "claude opus high"
subagents = true
/+++

+++ 5.2.1 USE.1 — routing by size and quota floors [toml]
id = "USE.1"
title = "routing by size and quota floors"
covers = ["C5", "C9", "T4", "A3"]
acceptance = [
  "src/server/routes.ts implements C5; task.start uses it instead of splitting route text inline (actions.ts:237-241); the agent → provider map moves to src/server/providers.ts and snapshot.ts:550 imports it",
  "quota floors apply in task.start per C5; warn returns warnings[], block refuses with code quota_floor, off skips",
  "task.start runs checkRoute on the resolved route and refuses with code bad_route per C9",
  "maxLanes behaves as today",
  "T4 passes",
]
risk = 3
gate = "npm run build && node --test test/server/routes.test.mjs"
/+++

+++ 5.2.2 USE.2 — notifier [toml]
id = "USE.2"
title = "notifier"
covers = ["C6", "T5", "A2"]
acceptance = [
  "ServerCtx gains a notify handle filled by worker.ts (tests stub it); src/server/notify.ts implements C6; the hardcoded notifications.show in worker.ts:157-162 goes through notify('laneDone', ...)",
  "sync raises ask, taskFailed, stall and quotaLow through notify with the C6 keys",
  "wakeOrchestrator sends one line to the run's coordinator handle via the existing terminal send path",
  "notify.test (a SCHEMA.3 stub until now) goes through notify, bypassing toggles and quiet hours",
  "T5 passes with a fake clock",
]
risk = 2
gate = "npm run build && node --test test/server/notify.test.mjs"
deps = ["USE.1"]
/+++

+++ 5.2.3 USE.3 — confirm before high-risk tasks and advisory brief rules [toml]
id = "USE.3"
title = "confirm before high-risk tasks and advisory brief rules"
covers = ["C7", "C8", "T6"]
acceptance = [
  "task.start refuses with code needs_confirm when plan_task.risk >= safety.confirmRiskAtLeast and args lack confirm: true",
  "taskSpec (actions.ts:193) appends the advisory rules section from safety.protectedBranches, safety.neverRun and safety.askBeforePush",
  "solo mode per C8: task.start uses --worktree path:<repo root> and the brief carries the solo line",
  "T6 passes",
]
risk = 3
gate = "npm run build && node --test test/server/safety.test.mjs"
deps = ["USE.2"]
/+++

+++ 5.2.4 USE.4 — remaining consumers and the route check at import [toml]
id = "USE.4"
title = "remaining consumers and the route check at import"
covers = ["C9", "T7"]
acceptance = [
  "sync timers read sync.fastSeconds, sync.slowSeconds and sync.filesSeconds and restart only when a sync key changed, passing filesMs and without an extra pullAll",
  "maintenance reads data.backupKeep, data.goneDays (the rules C1 names), data.decisionDays and data.eventMax",
  "decisions read general.undoSeconds; ask.snooze defaults to general.snoozeMinutes; explicit test options still win",
  "InboxTarget takes settings and plan import checks every task route and phase route/reviewer with checkRoute per C9; a failing route makes fit partial with the reason; the actions.ts and sync.ts callers pass loadSettings(ctx.dir)",
  "plan.start refuses a plan whose current fit is partial with code plan_partial naming the first missing[] reason (C9)",
  "the inbox scan and the snapshot inbox path (snapshot.ts:567) read plans.inboxDir; new files with fit 'pass' are imported when plans.autoImport is on; rows for files under an old inbox dir are left as they are; mk bug add defaults --risk to bugs.defaultRisk",
  "T7 passes",
]
risk = 3
gate = "npm test && npx tsc --noEmit"
deps = ["USE.3"]
/+++

+++ 5.2.5 USE.5 — task spec templates [toml]
id = "USE.5"
title = "task spec templates"
covers = ["C10", "T11"]
acceptance = [
  "templates/spec/ holds investigate.md, implement.md, subdispatch.md, review.md and fix.md; together they render the same facts today's taskSpec and fixSpec send, plus the scenario's instructions (investigate and review: no edits; implement: stay inside owned files; subdispatch: split the task, spawn helpers per C10, one writer per file; fix: reproduce, fix, prove with a failing-then-passing test); fix.md keeps the lines test/store/cli.test.mjs:94-99 checks, and test/server/actions.test.mjs:545-555 still passes or is updated to the template text",
  "src/store/spec-builtin.ts holds each built-in as a string constant equal to its .md file; src/store/spec-templates.ts implements C10 loading, rendering, placeholder union, rules append, fallback and warnings; taskSpec (actions.ts:193) and fixSpec (cli.ts:219) render through it and keep mk-ref as the first line; mk bug fix and bug.fix pass template warnings through",
  "plan-parse reads an optional scenario on tasks and phases (one of the five, else a missing[] reason); src/store/schema-v2.ts and db.ts MIGRATIONS add migration 2 per C10 (schema-v1.ts untouched); import copies a phase scenario to its tasks and stores it, and scenario joins taskVals",
  "the snapshot's settings.specTemplates carries the real per-scenario status of C10",
  "T11 passes and T4-T7 still pass",
]
risk = 3
gate = "npm run build && npm test && npx tsc --noEmit"
deps = ["USE.4"]
/+++

+++ 5.3 SCREENS — six Settings screens rewired to saved values, Appearance applied
### SCREENS — six Settings screens rewired to saved values, Appearance applied
- Method: rewire, not redesign. Keep each existing canvas screen's layout, controls, gauges and styling (`panel/screens/Settings*.dc.html`); only replace hardcoded state with bound values and wire saves. Merge Agents into Routing & Quota by moving its existing agent rows; rename Alerts → Notifications and Look stays as Appearance; delete Shortcuts. Files: `SettingsAgents.dc.html` and `SettingsShortcuts.dc.html` deleted; `SettingsAlerts.dc.html` renamed `SettingsNotify.dc.html`; `SettingsLook.dc.html` keeps its file, label "Appearance"; new `SettingsWork.dc.html`; 16 screens become 15, so `test/panel/screens.test.mjs` (`ALL_16_SCREENS`, `files.length, 16`) and `test/panel/contract.test.mjs:28` (`>= 16`) change to 15. Text size: screens use px font sizes (`Lanes.dc.html:19-31`), so `look.textSize` sets CSS `zoom` on the screen host (S 0.9, M 1, L 1.15) and `look.density` is a root class, both applied by `runtime.js`. New UI only where an acceptance line names a control the current screen lacks: the Work screen (copy an existing screen's layout), the per-agent models table, General's Data and Sync sections and migration notes, the quota floor and `onBelowFloor` rows, the per-size route pickers, and the Plan Start button and confirm dialog. Each copies the markup and styling of the nearest existing control on the same screen. Snapshot keys lane B reads are fixed by SCHEMA: `settings.values.*` (including `general.mode`), `settings.schema`, `settings.migrationNotes`, `settings.specTemplates`, `settings.lastScreen`.
- Goal: each tab in block 4 renders saved values from the snapshot, takes ranges from `settings.schema`, saves through `settings.save`, shows Orca-owned rows as notes; Appearance and first screen apply to the whole dashboard.
- Serves: G1, G3, G5, G6
- Needs first: SCHEMA (snapshot shape and actions); not USE
- Build order: SCREENS.1, then SCREENS.4 (it edits runtime.js and the rain code in every screen), then SCREENS.2 and SCREENS.3 in parallel (SCREENS.2 owns SettingsRouting and the new SettingsWork; SCREENS.3 owns SettingsSafety, the Notifications screen and Plan.dc.html). Do not stage `out/` or `web/`.
- Hazards: K7
- Carries: T9, T10
/+++

+++ 5.3.0 SCREENS settings [toml]
id = "SCREENS"
title = "six Settings screens rewired to saved values, Appearance applied"
wave = 2
owned = ["panel/screens/", "panel/runtime.js", "scripts/build-panel.mjs", "scripts/dev-snapshot-server.mjs", "test/panel/", "test/fixtures/snapshot.json", "test/fixtures/build-snapshot.mjs"]
commit = "feat(panel): settings v2 tabs rewired to saved values, appearance applied app-wide"
deps = ["SCHEMA"]
size = "standard"
route = "agy gemini-3.8-flash-medium"
reviewer = "agy gemini-3.8-flash-medium"
subagents = true
/+++

+++ 5.3.1 SCREENS.1 — tab list, binding helper and General [toml]
id = "SCREENS.1"
title = "tab list, binding helper and General"
covers = ["T9"]
acceptance = [
  "SETTINGS_TABS_SPEC lists general, routing, work, safety, notify, look; SettingsAgents, SettingsAlerts and SettingsShortcuts are removed or renamed and nothing links to them; test/panel/screens.test.mjs and its fixture list the new set",
  "a runtime helper bind('<key>') reads the value and the schema entry from the snapshot, sets min/max/options from it, and saves one key as a nested patch",
  "the General screen uses bind for every control, shows migrationNotes when present, and its Reset and Export buttons call the C4 actions",
  "scripts/dev-snapshot-server.mjs knows settings.reset, settings.export, ui.remember and notify.test; the fixture snapshot (test/fixtures/build-snapshot.mjs, snapshot.json) carries the v2 settings block with schema",
]
risk = 2
gate = "npm run build && node --test test/panel/settings-screens.test.mjs test/panel/screens.test.mjs"
/+++

+++ 5.3.2 SCREENS.2 — Routing & Quota and Work [toml]
id = "SCREENS.2"
title = "Routing & Quota and Work"
covers = ["T9"]
acceptance = [
  "each agent row lists its models (add, edit, remove, efforts per model); default model and each size route are chosen from pickers built from agents.<id>.models, with free text only for agents whose list is empty",
  "Routing & Quota binds agents.*, routing.bySize.*, routing.maxLanes and quota.*, and shows each agent's installed and account state and live quota read-only next to its floors",
  "the new Work screen binds lanes.stallMinutes, bugs.defaultRisk, plans.inboxDir and plans.autoImport, and shows the C8 shared-checkout hint when mode is solo and routing.maxLanes > 1",
  "the Work screen has a Task spec templates section: one row per scenario with its one-line purpose, a path field bound to work.specTemplates.<scenario> (empty = built-in), and the status from the snapshot (built-in, file ok, or the issue)",
  "T9 cases for both screens pass",
]
risk = 2
gate = "npm run build && node --test test/panel/settings-screens.test.mjs"
deps = ["SCREENS.4"]
/+++

+++ 5.3.3 SCREENS.3 — Safety and Notifications [toml]
id = "SCREENS.3"
title = "Safety and Notifications"
covers = ["T9"]
acceptance = [
  "Safety binds safety.*, each row labelled from the schema (the C7 wording for confirmRiskAtLeast, 'advisory: written into briefs' for the rest), lists editable",
  "Notifications binds notify.*, has a Test button calling notify.test, and shows the Orca-owned rows from the schema as 'Set in Orca' notes",
  "Plan.dc.html gains a Start button on tasks with no Orca task yet; it calls task.start and, on needs_confirm, shows a confirm dialog that resends with confirm: true",
  "T9 cases for both screens and the Start button pass",
]
risk = 2
gate = "npm run build && node --test test/panel/settings-screens.test.mjs"
deps = ["SCREENS.4"]
/+++

+++ 5.3.4 SCREENS.4 — Appearance applied app-wide and first screen [toml]
id = "SCREENS.4"
title = "Appearance applied app-wide and first screen"
covers = ["T10"]
acceptance = [
  "the Appearance screen binds look.*",
  "runtime.js applies look.* on load and on change as classes or CSS variables on the root, and every screen's rain and text size follow them instead of their own constants",
  "when settings.values.general.mode is solo, the Lanes, Projects and Plan screens hide the worktree-only columns and controls C8 names",
  "general.openOnStart picks the first screen; 'last' opens the snapshot's settings.lastScreen (projects when empty), and each screen change calls ui.remember",
  "T10 passes",
]
risk = 2
gate = "npm run build && node --test test/panel/look.test.mjs"
deps = ["SCREENS.1"]
/+++

+++ 5.4 SHIP — dead-key check, build outputs, version and release commit
### SHIP — dead-key check, build outputs, version and release commit
- Goal: on main after both lanes merge, the dead-key check T8 passes, one rebuild commits `out/` and `web/`, every gate passes, and the version is bumped.
- Serves: G1, G2, G3, G4, G5, G6
- Needs first: USE, SCREENS
- Build order: SHIP.1, then SHIP.2. The live check on the user's machine is the user's step, not a task.
- Hazards: K1, K7
- Carries: T8, A4
/+++

+++ 5.4.0 SHIP settings [toml]
id = "SHIP"
title = "dead-key check, build outputs, version and release commit"
wave = 3
owned = ["test/store/no-dead-settings.test.mjs", "out/", "web/", "CHANGELOG.md", "package.json", "orca-plugin.json", "orca-marketplace.json", "test/manual/settings-v2.md"]
commit = "chore(release): v0.3.0 settings v2"
deps = ["USE", "SCREENS"]
size = "standard"
route = "claude sonnet medium"
reviewer = "agy gemini-3.8-flash-medium"
subagents = false
/+++

+++ 5.4.1 SHIP.1 — dead-key check [toml]
id = "SHIP.1"
title = "dead-key check"
covers = ["T8"]
acceptance = [
  "test/store/no-dead-settings.test.mjs implements T8 (a) and (b) on the merged tree",
  "any key it finds dead is fixed in its owning file or removed from C1 with a note in the plan log, never added to an allow list",
  "T8 passes",
]
risk = 2
gate = "npm run build && node --test test/store/no-dead-settings.test.mjs"
/+++

+++ 5.4.2 SHIP.2 — rebuild, version and checklist [toml]
id = "SHIP.2"
title = "rebuild, version and checklist"
covers = ["A4"]
deps = ["SHIP.1"]
acceptance = [
  "npm run build on main after both merges; out/ and web/ committed once",
  "version 0.3.0 in package.json and orca-plugin.json; orca-marketplace.json plugins[0].source.ref = v0.3.0; CHANGELOG entry",
  "test/manual/settings-v2.md lists the user's live checks: one value per tab survives reload and Orca restart; the live v1 file migrates; a high-risk task asks to confirm; in solo mode a task starts in the main checkout (K7); Test notification arrives",
]
risk = 2
gate = "npm test && npx tsc --noEmit && npm run build"
/+++

+++ 6 Gates
## Gates
- unit — proves G2, G3, G4, G6 — every unit and integration test passes, including the dead-key check T8 once SHIP.1 adds it
- types — proves G2 — store, server and worker type-check
- bundle — proves G1, G3 — the plugin builds with the rewired Settings screens
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
- K1 — the migration loses or mangles a value the user changed — level 3 — guard: only non-default values carried, normalised not rejected, whole v1 file backed up on first save, T2 — SCHEMA.2
- K2 — a guard blocks real work (quota block, confirm threshold) — level 3 — guard: refusals name the setting to change, T4 and T6 — USE.1, USE.3
- K3 — the snapshot grows past 64 KB with settings.schema — level 2 — guard: T1 size check — SCHEMA.1
- K4 — notifications spam or go silent after the hardcoded call is replaced — level 2 — guard: alert_sent de-dupe and T5 — USE.2
- K5 — a user's spec template silently degrades briefs (missing built-ins in an install, dropped rules, a fallback nobody sees) — level 3 — guard: built-ins compiled into code, rules appended when `{{rules}}` is absent, every fallback in `warnings[]` and the Work screen status, T11 — USE.5
- K6 — mk-data.db migration 2 fails or half-applies on a live v1 database — level 3 — guard: one `ALTER TABLE ADD COLUMN` inside the existing BEGIN IMMEDIATE migrate loop, nullable column, v1-database case in T11 and the `db.test.mjs` count tied to `SCHEMA_VERSION` — USE.5
- K7 — solo-mode lanes clash in one checkout, or Orca refuses `--worktree path:<main checkout>` — level 3 — guard: Work screen hint when mode is solo and maxLanes > 1 (C8); `test/manual/settings-v2.md` has a live check that a solo task starts in the main checkout — USE.3, SCREENS.2, SHIP.2
/+++

+++ 8 Open questions
## Open questions
- [x] Q1 — drop unenforceable Safety guards, routing.useJev and the low-confidence rule? (reverses the 2026-10-24 "keep as advisory" pick) — blocks: SCHEMA.1 — pick: drop; protected branches, never-run and ask-before-push stay as advisory brief text
- [x] Q2 — general.mode — blocks: SCHEMA.1, USE.3, SCREENS.4 — pick: keep, with solo defined as C8 (tasks start in the main checkout, brief says use subagents, lane-only UI hidden; lane limit unchanged)
- [x] Q3 — quota floors — blocks: SCHEMA.1 — pick: upstream values (Claude 40% session, 30% weekly; others 10% and 15%), default action block
- [x] Q4 — route catalog, review routes and final-review tier — blocks: none — pick: later, when MK proposes reviewers
- [x] Q5 — project-level overrides — blocks: none — pick: one global file only
- [x] Q6 — release number — blocks: SHIP.2 — pick: 0.3.0
/+++

+++ 9 Log
## Log
- 2026-10-25 — drafted — settings v2 from a Haiku inventory and a Sonnet needs study of the current settings — user
- 2026-10-25 — amended — first-draft review (Sonnet, 25 findings): cut keys with no consumer (route catalog, policy, low confidence, review routes, fresh session, todo done status, bug fix route, protected-branch refusal, merge confirm); migration made in-memory and non-throwing; safety reduced to a risk-threshold confirm plus advisory brief rules; Lanes and Work items merged into Work; Appearance applied app-wide; build outputs owned by SHIP — orchestrator
- 2026-10-25 — amended — Opus Critic review (REJECT, 19 findings): dead-key check moved to SHIP.1 on main with prefix families; gateFail/runDone replaced by taskFailed with defined keys; Plan gets a Start button and the confirm row is labelled honestly; maxLanes kept in the migration; SCREENS.4 runs before SCREENS.2/.3; dev snapshot server and real fixture paths owned; last screen kept in server kv; notify.test moved to USE.2; reset groups, prune scope, inbox rules, route precedence, shared provider map, Orca-owned rows and line refs made explicit — orchestrator
- 2026-10-25 — answer — Q1 drop; Q2 keep mode, solo = main checkout with subagents, lane UI hidden; Q3 upstream floors with block; Q4 later; Q5 global only; Q6 0.3.0 — user
- 2026-10-25 — decision — agents get a models list (C9) seeded from models.md; plan import and task.start check routes against it — user
- 2026-10-25 — decision — SCREENS rewires the existing canvas screens (layout and styling kept); new UI only for Work and the models table — user
- 2026-10-25 — amended — task spec templates per scenario (C10, USE.5, T11, Work screen section, G6) — user
- 2026-10-25 — decision — all phase reviewers `claude sonnet medium`; the second Critic pass runs on opus medium — user
- 2026-10-25 — amended — second Opus Critic review of C8, C9, C10 and the SCREENS method (REJECT, 21 findings): built-in templates compiled into `src/store/spec-builtin.ts`; migration 2 SQL named, `db.test`/`cli.test`/`import.test`/`actions.test` owned by USE and USE.5's gate runs the full suite; subdispatch only by explicit scenario; `plan.start` refuses `plan_partial`; import route check and its test moved to USE.4/T7 with a settings path into import; lane B snapshot keys fixed by SCHEMA (`general.mode`, `settings.specTemplates` placeholder); SCREENS new-UI list matches its acceptance lines; T8 runs T11; placeholder union, rules append, phase scenario copied to tasks, template path rules, renderer in `src/store`, C1 model/effort rules, MODEL_SEED constant, solo columns named and tested, `task.start` refusal order; G6 served and gated; K5, K6 added — orchestrator
- 2026-10-25 — amended — gaps from a parallel Opus Critic run (REJECT, 11 findings, 6 overlapping the round above): C9 adds Orca's launch rules (effort needs a model, no effort for omp/opencode or empty-efforts models) and the agy → antigravity `--agent` map; C8 solo hides only controls that exist (Plan has none, Lanes has no new-lane control) plus a shared-checkout hint and K7; SCREENS gets exact file renames, the 16 → 15 screen count in screens.test and contract.test, and CSS zoom for text size; `notify.test` stub in SCHEMA.3 so main stays green whichever lane merges first — orchestrator
- 2026-10-25 — decision — SCHEMA and USE reviewers `claude opus high` (data-loss risk in the migration); SCREENS and SHIP stay `claude sonnet medium` — user
- 2026-10-25 — decision — lane B (SCREENS) builder route `agy gemini-3.8-flash-medium` (Antigravity, Gemini 3.8 Flash, effort in the model id); its reviewer stays `claude sonnet medium` — user
- 2026-10-25 — decision — lastScreen lives at `settings.lastScreen`, not a top-level snapshot key, so `test/server/server.test.mjs` KEYS stays; SCHEMA may edit that file's R2.3 case only (now writes an invalid schema:2 file) — orchestrator, on the lane A builder's question
- 2026-10-26 — decision — SCREENS and SHIP reviewers `agy gemini-3.8-flash-medium`; SCHEMA and USE stay `claude opus high` — user
- 2026-10-26 — review — SCHEMA (Opus high): APPROVE with 5 findings, all fixed in a SCHEMA fix round before merge: (1) migration drops agent efforts the C9 check refuses (omp, opencode, agents whose models all have empty efforts, effort with model ""), with a note; (2) carried v1 tiers and saved `routing.bySize.*` run `checkRoute` with routable forced true, a failing migrated tier falls back to its default with a note (C1 wins over the SCHEMA.1 "known agent ids" line); (3) `Object.hasOwn` for RENAMED lookups so no v1 file throws; (4) `__proto__`, `constructor`, `prototype` path segments skipped; (5) describe caps agent ids, notes cut to 200 chars, the 64 KB guard also drops `schema` agent rows — orchestrator
- 2026-10-26 — review — SCHEMA re-review of the fix round (Opus high): APPROVE, 3 minor findings carried into USE.1 (checkRoute own-key check for `__proto__`; settings validation refuses agent efforts the C9 launch rules refuse; the default bySize exemption only for that size's own default); default-route exemption confirmed safe; p1 probe throws were a missing argument, not a bug. SCHEMA merged to main — orchestrator
- 2026-10-26 — review — USE (Opus high): CHANGES NEEDED, 1 medium (throwing settings reads in notify and the sync collectors could lose a notification, roll back quota rows and stop git refresh) and 3 low (inbox prefix overlap, route args starting with "-", rounded quota floor), fixed in 8cb3c8c43c9; a laneDone dropped while the service is down is left as a design note. Re-review (Opus high): APPROVE. USE merged to main (15528ee8aef), main gates 274/274 and tsc clean — orchestrator
- 2026-10-26 — review — SCREENS (agy gemini-3.8-flash-medium): APPROVE, 2 low findings: a failed task with no Orca task shows both Start and Retry (fixed in SHIP.1: Start hidden on failed tasks), and optional chaining at SettingsRouting.dc.html:471 (kept; the panel runs in Orca's Chromium). SCREENS merged to main (810ce18e222), main gates 292/292 and tsc clean — orchestrator
- 2026-10-26 — review — SHIP (agy gemini-3.8-flash-medium): APPROVE, no findings; T8 mutation runs confirm it fails on an unread key, a missing family read and a missing prefix. SHIP.1 50715308572 (dead-key check, agents.* read through setting(), Start hidden on failed tasks); SHIP.2 0a9ac07210b (out/ and web/ rebuilt, version 0.3.0, CHANGELOG, test/manual/settings-v2.md). Main 295/295, tsc clean. Not tagged, not pushed: both wait for the user — orchestrator
/+++
