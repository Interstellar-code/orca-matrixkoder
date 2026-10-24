# Screen data map: where every dashboard value comes from

Date: 2026-10-24. Read-only research on this machine (Orca 1.4.239, macOS). Nothing in Orca, upstream MatrixKoder, any database or the repo was changed except this file.

Scope (updated by the coordinator mid-task): the plugin does NOT use upstream MatrixKoder's stores. Orca is the source of truth for repos, worktrees, agents, terminals and orchestration. Anything Orca lacks goes to the plugin's own SQLite file `mk-data.db`. Both files live in `~/.matrixkoder/` (`mk-data.db`, `mk-settings.json`; user decision, see `/Users/rohits/Development/orca-matrixkoder/.matrixkoder/README.md`). Upstream `~/.matrixkoder/projects/*/mk-project.db` and `mk-overview.db` work was dropped (one read-only open of the matrixkoder project DB had worked before the change; nothing from it is used here). Upstream scripts are not a write path. Upstream is cited only as design precedent.

Citation forms: `Screen.dc.html CONST` = mock data in `/Users/rohits/Development/orca-matrixkoder/panel/screens/`. `R:bus §n`, `R:cli §n`, `R:api §n`, `R:settings §n` = the research files `orca-orchestration-bus.md`, `orca-cli-reference.md`, `orca-plugin-api.md`, `orca-settings.md` in this folder. `CMD:` = a read-only `--json` command I ran today. "unverified" = not confirmed on this machine.

Legend used in the tables:

1. Sources (read-only unless marked ACTION)
   1.1 `PS` = `orca worktree ps --json` (all worktrees with live `agents[]`)
   1.2 `WT` = `orca worktree list --json`, `RL` = `orca repo list --json`, `PL` = `orca project list --json`
   1.3 `RUNS` = `orca orchestration run-list --json`, `TL` = `task-list --run R --brief --json`, `WL` = `worker-list --run R --json`, `WS` = `worker-show --dispatch D --json`, `GL` = `gate-list --run R --status pending --json`, `INB` = `inbox --limit N --json`
   1.4 `ACC` = `orca account list --json` (contains `rateLimits`), `HOST` = `orca host list --json`
   1.5 `EVT` = plugin events `agent.status.changed`, `worktree.created`, `worktree.removed`
   1.6 `GIT` = `git` run by the worker inside a worktree path (Orca has no CLI for it)
   1.7 `mk-data.<table>.<col>` = proposed table in section 5; `mk-settings.<key>` = key in `~/.matrixkoder/mk-settings.json` (draft in `R:settings §6.4`)
2. Refresh: `EVT` = an event triggers a re-pull; `P3`/`P10`/`P60` = worker poll every 3/10/60 s; `D` = on demand (user action or page open); `UI` = browser only, no data.
3. Status: `available` = a command or table returns it as shown; `derivable` = computed from available data (rule given); `missing` = no source, see section 3.

---

## 1. Ownership decision

Verdict: the hypothesis "MK owns plans, tasks and gates; Orca supplies live agent, terminal and worktree state" is NOT supported as stated. The evidence supports a different split: Orca owns everything that executes (runs, tasks, dispatches, decision gates, questions, messages, lanes), and MK owns only the plan structure that Orca cannot express, plus the lists Orca has no concept of. (The coordinator's scope change points the same way.)

### 1.1 Which Orca entity covers each concept

| Concept | Orca entity | Covers | Gap, goes to `mk-data.db` |
|---|---|---|---|
| Project | `repo` (path, name) and `project` (`github:owner/repo`) | list, path, remote | Orca has 3 projects but 4 repos here (CMD: `PL` vs `RL`): the `orca-matrixkoder` repo has no project. Use repo as the unit. |
| Lane | worktree + terminal + worker dispatch | branch, path, agent state, live terminal, model/effort (only via `WS`) | lane label `P1`, MK's plan-task link, turn counter, activity log |
| Plan | none (a Run is a namespace with an `objective`) | run id, objective, created time | whole plan: id, title, source file, status, phases, subtasks |
| Phase / wave | none (`R:bus §5` correction 10: no Phase entity) | nothing | phases and their order |
| Task | `tasks` (pending, ready, dispatched, completed, failed, blocked) with `deps`, `parent_id` | status, title, spec, deps | MK task id (`T6`), phase, planned route, subtasks. Live data: 0 of 16 tasks use `deps` or `parent_id` (R:bus §1); retries are new tasks ("PARSE fix r2/r3/r4", "(restart)" in CMD: `TL`), so one MK task maps to several Orca tasks. |
| Subtask | `parent_id` could hold it, but each Orca task is a dispatchable unit | nothing useful | checklist items (`T6.3`) |
| Decision gate | `decision_gates` via `gate-list`/`gate-resolve` | question, options, status, resolution | recommendation text, undo window |
| Worker question | `question` message + thread via `inbox`, `reply` | question, options | same |
| Message bus | `messages` via `inbox` | type, payload, sequence, time | history older than the `inbox` window |
| Test/build checks ("Build ✓", "Test 41/63") | none (Orca gates are decisions, not test results) | nothing | check results |
| Quota | `account list` → `rateLimits` | used %, window, reset time | none |
| Todo, Bug, inbox import record, shortcut slots | none | nothing | all of it |

### 1.2 Evidence for and against

1. For Orca owning execution: the orchestration engine is live here (1 real run, 16 tasks, 19 worker dispatches, 57 messages; CMD: `RUNS`, `TL`, `WL`, `INB`) and the coordinator loop (`check`, `reply`, `gate-resolve`) already acts on those rows. A copy of tasks or gates in MK would drift, and an answer written only to MK would never reach a worker blocked in `ask` (R:bus §1 "Decision gates", item 4).
2. Against Orca owning plans: no phase, wave or subtask exists in the schema (R:bus §5 correction 10). Task status has no "waiting on you" and no "working" (`dispatched` only); `blocked` is produced only by gates (R:bus §1 enumerations).
3. Against MK owning gates: a gate needs the coordinator to see it; `gate-create` is refused while a worker is alive for the task (R:bus §1 gates item 1). The mock "gate" card (worker waiting on an approval) therefore maps to a worker `ask` question in most real cases, and to a real Orca gate only between tasks.
4. What breaks if Orca owns plans: the Plan screen loses phases, waves and the 25 subtasks; the Overview "Wave 2 of 3" and progress segments have no source.
5. What breaks if MK owns tasks: lane state, `worker_done` settlement and dependency promotion (pending → ready when deps complete, R:bus §1 DAG item 3) run in Orca and would have to be duplicated.
6. Known Orca limits to design around: failed dependencies never promote a dependent task (inferred, R:bus §1 item 4); no orchestration events reach plugins (only 3 events, R:bus §3); `inbox` has no cursor (CMD: flags `--limit --terminal --full` only) and returns newest first; replies are final, so Undo needs MK's own delay (section 3).

### 1.3 Where the plugin's own data lives (decided by the user)

1. `~/.matrixkoder/mk-data.db` (SQLite, plugin worker is the only writer) and `~/.matrixkoder/mk-settings.json`. Layout is documented in `/Users/rohits/Development/orca-matrixkoder/.matrixkoder/README.md`. The plugin never touches upstream's files that share the folder (`mk-overview.db`, `projects/`, `bus/`, `inbox/`, `usage.json`).
2. Plan files live in the repo, not the home folder: `<repo>/.matrixkoder/inbox/<plan-id>.md` (top level `.md` files only), imported plans move to `inbox/archive/`, deletes copy to `inbox/.deleted/` (git-ignored). The upstream home inbox `~/.matrixkoder/inbox` is not used.
3. SQLite engine: `node:sqlite` is present in Orca's own Node runtime (CMD: `ELECTRON_RUN_AS_NODE=1 /Applications/Orca.app/Contents/MacOS/Orca -e ...` printed Node 24.22.0, Electron 43.8.1, `node:sqlite` exports `DatabaseSync`). Whether the forked plugin worker sees the same runtime is unverified (Phase 0).

---

## 2. Per screen maps

Common to all 8 main screens (not repeated below): header title `MatrixKoder` and gear icon are static. The tab bar and its badges come from `BADGES`/`TABS` in every screen. Badge rules (the mock disagrees with itself, see section 3):

| Field | Source | Refresh | Status |
|---|---|---|---|
| Tab "Lanes" badge (3) | count of lanes in the selected plan with a live dispatch or agent in working/blocked/waiting (`PS` + `WL`) | EVT, P3 | derivable |
| Tab "Waiting" badge (1 or 2) | count of pending asks (section "Waiting" below) | P10 | derivable |
| Tab "Inbox" badge (2) | `mk-data.inbox_file` rows with `state='new'` | D, file watch | derivable |
| Tab "Bugs" badge (4) | `mk-data.bug` where `status in (open,fixing,waiting)` (the Bugs screen header says 5 need work; mock shows 4) | D | derivable |
| Footer "Improve ⌃I" | prompt copilot already in the plugin (commit f56c8c2); sends text with `terminal.sendText` or `orca terminal send --terminal H --text T --enter` | D | available |
| Footer "Ask Jev ⌃J" + chips ("Verify P1's claims") | not in Orca; Jev is an external judgment service | D | missing (see section 3, item 12) |
| Footer slots ("+ shortcut") | `mk-settings.shortcuts.footer` | UI | available |
| Matrix rain, density, text size | `mk-settings.theme.*` | UI | available |

### 2.1 Projects (`Projects.dc.html`, constants `BADGES`, sort toggle; cards in the template lines ~120-190)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| "All Orca projects · this Mac" | `HOST` → `result.hosts[0].machineName` (or static "this Mac") | P60 | available |
| "2 /3 projects active" | denominator = `RL` count; numerator = repos with a running plan (`mk-data.plan.status='running'`) or any agent working/blocked/waiting in `PS` | P10 | derivable |
| "5 lanes live" | sum over repos of live lanes (rule in tab badge row above) | P3 | derivable |
| "2 waiting on you" | sum of pending asks across all runs | P10 | derivable |
| Waiting list: title ("Security review: 2 public routes exposed") | `GL` → `gates[].question`, or question message `payload.question` (`INB`) | P10 | available |
| Waiting list: "acme-api · auth-v2-refactor · P2 codex · 2m" | repo = `PS.repo` via dispatch → `WL.resource.worktreeId`; plan = `mk-data.plan.title` via `mk-data.task_link`; lane = `mk-data.lane.label`; agent = `WS` → `worker.startOptions.launch.effective.agent`; age = gate/message `created_at` | P10 | derivable |
| "3 in Orca" | `RL` count | P60 | available |
| Sort toggle (recent activity / name) | recent activity = max `PS.lastActivityAt` per `repoId`; name = `RL.displayName` | UI | available |
| Card: "acme-api" | `RL.displayName` | P60 | available |
| Card: "~/code/acme-api · 4 worktrees" | `RL.path` (abbreviate `~`), worktree count = `PS` rows with that `repoId` | P60 / P3 | available |
| Card: "1 plan running" / "2 plans" | `mk-data.plan` counts by `repo_id` and status | D | derivable |
| Plan row: name ("auth-v2-refactor") | `mk-data.plan.title` | D | available |
| Plan row: "Build · wave 2/3" | stage (Plan/Build/Verify/Merge, rule in Overview) + phase index of the first non-done phase / phase count | P10 | derivable |
| Plan row: "2 lanes" | live lanes of that plan | P3 | derivable |
| Plan row: "2/6 tasks" | Orca tasks `completed` mapped through `mk-data.task_link` / `mk-data.plan_task` count | P10 | derivable |
| Plan row: "1 waiting on you" | pending asks whose task maps to the plan | P10 | derivable |
| Plan row: "PR #12 ready to merge" | PR number = `PS.linkedPR` (number only, set with `orca worktree set --pr`); "ready to merge" state has no source | P60 | missing (state); number available |
| Card: "No plan running · 2 idle worktrees · 3h ago" | idle = `PS.status='inactive'`; "3h ago" = max `lastActivityAt` | P60 | derivable |

| Action | Command / script | Status |
|---|---|---|
| Refresh projects | worker re-runs `RL`, `PL`, `PS` | available |
| Open (card or ask) | in-page navigation, carries repo/plan id | available |
| Start a plan | navigate to Inbox; import there | available |
| Settings gear | in-page navigation | available |

### 2.2 Overview (`Main.dc.html`, constants `TABS`, state `approved`/`jev`; text in template lines 82-232)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Header "auth-v2-refactor" + chevron (plan switcher) | `mk-data.plan` list for the selected repo | D | available |
| Status pill "Building" | derived stage (below) | P10 | derivable |
| "Wave 2 of 3" | `mk-data.plan_phase` order index of the first phase with open tasks / phase count | P10 | derivable |
| "bus m-42 · 4s ago" | `INB` newest message: `id` (shorten `msg_…`), `created_at` | P10 | available |
| Stage bars Plan / Build / Verify / Merge (Build 60%) | Plan = plan imported; Build = completed Orca tasks / plan tasks; Verify = share of tasks with all `mk-data.check_result` passed; Merge = plan branch merged (`GIT branch --merged`) or `mk-data.plan.status='merged'` | P10 | derivable (rule is a proposal; PR state missing) |
| "3 lanes live" | rule in tab badge row | P3 | derivable |
| "7/12 tasks done" | `TL` status `completed` through `mk-data.task_link`; 12 = `mk-data.plan_task` count | P10 | derivable |
| "1 needs you" | pending asks count | P10 | derivable |
| Decision card title ("Security review: 2 public routes exposed") | top pending ask: `GL.gates[].question` or `INB` question `payload.question` | P10 | available |
| Decision card body with `/admin/export` code spans | the same string; split title and body on the first line break; code spans = backtick text. Orca keeps one string per ask, so the orchestrator must follow the convention "Title\n\nBody" | P10 | derivable (convention needed) |
| Meta "P2 · codex · 2m" | lane label + agent + age (see Projects waiting list) | P10 | derivable |
| "Decision sent" banner "Approved. P2 resumed with the fix plan." | UI text after the action returns `ok`; "resumed" = next `WL` poll shows the dispatch working or the task `ready`/`dispatched` | D | derivable |
| Lane card: label `P1`, "Claude · opus high" | label = `mk-data.lane.label`; agent/model/effort = `WS` → `worker.startOptions.launch.effective{agent,model,effort}` (cache per dispatch, it never changes). Lanes not started by a Orca worker (plain agent panes) have only `PS.agents[].agentType`, no model | P60 (cache) | available for supervised workers; missing model for plain panes |
| Lane card: "fix/jwt-rotation · c8f421a" | `PS.branch` (strip `refs/heads/`), short `head` from `WT.head` | P3 | available |
| Lane card: "Working · turn 4" | state = `PS.agents[].state` (working/done/blocked/waiting) or `WL.projection.stage.activity`; "turn N" has no source | EVT | state available; turn count missing |
| Lane card: task line ("Update token expiry logic and Redis TTL") | `PS.agents[].taskTitle` or `TL.task_title` via `WL.taskId` | P10 | available |
| Lane chips "Build ✓ / Test running / Review" | `mk-data.check_result` | EVT | missing (no Orca source; section 3 item 3) |
| P3 card "docs/api-specs · waiting for wave 3", "Idle" | planned branch from `mk-data.plan_task.planned_branch`; Idle = Orca task `pending`/`ready` with no dispatch | P10 | derivable |
| "3 worktrees" | count of lanes shown | P3 | derivable |
| Plan waves: "W1 · DB schema and migrations 4/4", "3 waves · 12 tasks" | `mk-data.plan_phase.title`; counts from `mk-data.plan_task` + `TL` | P10 | derivable |
| Wave bar segments (done/working/waiting colours) | counts by mapped status | P10 | derivable |
| Ask Jev panel text, placeholder "Is P2's fix plan safe to approve?" | static copy | UI | n/a |

Orca task status → mock status (used by Overview, Lanes, Plan): `completed`→Done; `dispatched`→Working, or Waiting on you when the task has a pending ask or `WL.projection.attention.requiresAction` with category input/approval/guidance; `blocked`→Blocked; `pending` with an unmet dep→Blocked ("after T6"); `pending` otherwise→Pending; `ready`→Ready; `failed`→no mock status (add "Failed", section 3 item 9).

| Action | Command / script | Status |
|---|---|---|
| Sweep lanes now (header icon, `sweep-lanes` command) | plugin command in the worker: force a full re-pull and stall check | available (command exists in the manifest) |
| Approve (gate) | `orca orchestration gate-resolve --id GATE --resolution "approved" --json` | available (identity of caller unverified) |
| Approve (worker question) | `orca orchestration reply --id MSG --body "approve" --run RUN --json` | available |
| Request rework | gate: `gate-resolve --id GATE --resolution "rework: TEXT"`; question: `reply --id MSG --body "rework: TEXT"` | available |
| Details | navigate to Waiting | available |
| Undo | no Orca undo; only possible inside an MK delay window before the command is sent (section 3 item 5) | missing |
| Open P1 terminal | `orca terminal switch --terminal H` (handle from `WL.agentTerminalHandle` or `orca terminal list`) | available |
| Open P1 diff | `orca file open-changed --mode diff --worktree path:PATH` | available |
| Improve / Ask Jev / shortcut slots | see common table | see above |
| All lanes / Open plan links | navigation | available |

### 2.3 Lanes (`Lanes.dc.html`, constants `FILTERS`, `BADGES`; detail text lines ~110-170)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Header "auth-v2-refactor" | selected plan | D | available |
| "3 worktrees · 1 waiting on you" | lane count; pending asks in this plan | P3 / P10 | derivable |
| Filter chips "All 3 / Working 1 / Waiting 1 / Idle 1" | counts by lane state | P3 | derivable |
| Card header P1 "Claude · opus 5.5 · high" | as Overview lane card (`WS` launch.effective) | P60 | available / missing model for plain panes |
| "fix/jwt-rotation · c8f421a", "Working · turn 4" | as Overview | EVT | available / turn missing |
| "Task T6 · wave 2" + title | `mk-data.plan_task.id`, phase wave index, title | P10 | derivable |
| Worktree "~/code/acme-api-wt/p1" | `PS.path` | P3 | available |
| Commits "3 ahead of main" | `GIT rev-list --count BASE..HEAD` in the worktree; BASE = repo default base ref | P10 | derivable (no CLI) |
| Started "14m ago" | `WS` → `dispatch.dispatchedAt`, or `TL.created_at` | P60 | available |
| Changes "6 files · +182 −40" | `GIT diff --shortstat BASE...HEAD` plus working tree | P10 | derivable (no CLI) |
| Gate row Build "Passed 2m ago", Test "Running 41 / 63", Review "Not started · after test" | `mk-data.check_result` | EVT | missing |
| Activity: "12:41 edit src/auth/token.ts", "12:42 run npm test -- auth", "12:43 41/63 passing" | latest tool = `PS.agents[].toolName` + `toolInput`; history only if the worker records each change into `mk-data.lane_activity`; test line from `check_result`. Heartbeat `payload.phase` ("implementing", "verifying") from `INB` is a safe summary | P3 | derivable (history only after first poll) |
| P2 "Waiting on you", "Review: Asks you", ask title + Decide | pending ask for that dispatch (`INB` question with `payload.dispatchId`; gate by `task_id`) | P10 | derivable |
| P3 "no commits yet", "Idle", "Starts when wave 2 merges." | no dispatch; Orca task `pending`; text from `mk-data.plan_task` dependency (phase order) | P10 | derivable |

| Action | Command / script | Status |
|---|---|---|
| Add lane | `orca orchestration worker-start --spec "TEXT" --worktree new-child --agent A [--model M --effort E] --run RUN --json`, or without a run `orca worktree create --name N --repo path:P --agent A --prompt "..." --no-parent --json` | available |
| Expand / filter | UI | available |
| Terminal | `orca terminal switch --terminal H` | available |
| Diff | `orca file open-changed --mode diff --worktree SEL` | available |
| Pause | no pause in the CLI. Closest: `orca terminal send --terminal H --text $'\x1b'` (Escape interrupts a running Claude turn, unverified for other agents) or `worker-stop` (ends the worker) | missing |
| Hand off | `orca worktree create --name N --no-parent --agent A --prompt "BRIEF" --json` (documented full handoff, R:cli §28 item 2) | available |
| Wake | `orca terminal send --terminal H --text "continue" --enter --wait-submit 5 --json` | available |
| Decide | navigate to Waiting | available |
| Start now | `orca orchestration worker-start --task TASK_ID --worktree new-child --agent A --json` | available |
| Remove lane | `orca orchestration worker-release --dispatch D` then `orca worktree rm --worktree SEL` (destructive: ask first) | available |

### 2.4 Plan (`Plan.dc.html`, constants `ST`, `PLAN` lines 200-228)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Summary "3 phases · 7/12 tasks done · 25 subtasks" | counts over `mk-data.plan_phase`, `plan_task`, `plan_subtask`; done = mapped Orca status | P10 | derivable |
| Segment bar and "7 of 12 tasks done" | per phase weight = task count; colour by status | P10 | derivable |
| Phase row: "Phase 1", title, pill, "4/4", colour swatch | `mk-data.plan_phase.ord/title`; status = roll-up of its tasks; count = done/total | P10 | derivable |
| Task row: `T6`, title, meta ("P1 claude · turn 4", "P1 claude · merged", "no lane yet", "unassigned", "P3 agy · waits for phase 2") | id/title from `mk-data.plan_task`; lane + agent from the dispatch; "merged" = branch merged into base (`GIT`); "no lane yet"/"unassigned" = no dispatch and no planned route; "waits for phase 2" = phase order | P10 | derivable (merged state needs git) |
| Task pill (Done/Working/Waiting on you/Blocked · after T6/Pending/Ready) | status mapping above; "after T6" = `plan_task.depends` | P10 | derivable |
| Task count "3/4" | done subtasks / subtasks | D | available |
| Subtask rows (`T6.3` "clock-skew leeway", state dot, note "now" / "decide" / "← T6.4") | `mk-data.plan_subtask` (title, status, note). Notes "decide" and "← T6.4" are derived from asks and dependencies | D / P10 | available (state set by whoever owns the subtask; see section 3 item 6) |
| Expand all / Collapse | UI | UI | available |

No other action buttons exist on this screen. Plan edits are not in the mock.

### 2.5 Waiting (`Waiting.dc.html`, constants `KIND`, `ASKS` line 196, `RESOLVED` line 200)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| "1 blocking · 1 question" | gates pending (blocking) + questions pending | P10 | derivable |
| Card kind "Decision gate" | `GL.gates[]` (id, task_id, question, options JSON, status, created_at) | P10 | available |
| Card kind "Question" | `INB` messages `type='question'` with no later message sharing its `thread_id` (a reply appears as a `status` message with the same `thread_id`; CMD: 2 questions, 2 replies seen). Payload `{taskId, dispatchId, question, options}` | P10 | derivable (answered state is not a CLI field; thread rule verified on 2 live threads) |
| Source line "P2 · codex · T7 · 2m" | lane label, agent, plan task id (`mk-data.task_link`), age | P10 | derivable |
| Title / body | one Orca string split by convention (see Overview) | P10 | derivable |
| "Jev: approve. The fix plan covers both routes..." (`rec`) | no Orca field | D | missing (`mk-data.waiting_note`) |
| Question options ("Move to Redis", "Keep in-memory", "Ask me later") | `payload.options[]`; the "Ask me later" snooze is MK-only | P10 | available / snooze missing in Orca |
| Resolved today: `RESOLVED` rows ("Approve the wave 2 plan", outcome, "orchestrator · 11:58") | gate resolutions: `gate-list --status resolved` (`resolution`, `resolved_at`); question answers: `status` messages in the thread; plus `mk-data.decision_log` for actions taken in this dashboard | P10 | available for gates/questions |
| Resolved: "Route T6 to claude opus high / Accepted Jev pick / Jev · 11:41" | routing decisions are not in Orca | D | missing (drop or log into `mk-data.decision_log`) |
| "just now" rows after answering | `mk-data.decision_log.at` | D | available |
| "Nothing needs you. Lanes are running on their own." | empty state | UI | n/a |

| Action | Command / script | Status |
|---|---|---|
| Approve (gate) | `gate-resolve --id GATE --resolution "approved"` | available |
| Request rework (gate) | `gate-resolve --id GATE --resolution "rework: TEXT"` | available |
| Details | expand card | UI |
| Option button (question) | `reply --id MSG --body "OPTION LABEL" --run RUN` | available |
| Undo | not possible in Orca once sent (`gate-resolve` sets `resolved`, `reply` sets the thread `answered`) | missing (needs MK delay) |

### 2.6 Events (`Events.dc.html`, constants `KIND`, `EVENTS` line 182, `FILTERS` line 192)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| "Live" / "Paused · 3 new" / Pause button | client buffer of new events | UI | available |
| Pinned card "P2 asks: approve the security fix plan · pinned · decision gate · 2m" + Decide | top pending ask | P10 | derivable |
| Row time `12:43:10` | event time (message `created_at` UTC → local) | P10 | available |
| Kind Lane ("Turn 4 started", src "P1 claude · agent.status.changed", payload `{paneKey, state}`) | `EVT agent.status.changed`; Orca keeps no history, so the worker must write it to `mk-data.event_log` as it arrives | EVT | available (from first run of the worker) |
| Kind Gate ("Test gate running, 41 of 63 passing"; payload `{gate, lane, passed, total}`) | `mk-data.check_result` changes | EVT | missing (same gap as lane chips) |
| Kind Ask ("P2 asked for a decision", payload `{kind, task, options, recommended}`) | new pending gate or question; `recommended` from `mk-data.waiting_note` | P10 | derivable |
| Kind Commit ("c8f421a fix(auth): ...", payload `{sha, files, insertions, deletions}`) | `GIT log --since` per lane worktree, polled | P10 | derivable (no CLI) |
| Kind Bus ("Brief sent to P3", src "orchestrator → P3 · m-42", payload `{id,to,type}`) | `INB` messages other than `heartbeat`; from/to = `from_handle`/`to_handle`; type = `type` | P10 | available |
| Row payload JSON (expand) | original message `payload` column, or the event body; redact prompt and tool text | D | available |
| Filter chips All/Lanes/Gates/Asks/Commits/Bus | client filter on `event_log.kind` | UI | available |
| "No events of this kind yet." | empty state | UI | n/a |

No action buttons except Pause/Resume and the Decide link. Paging: the dashboard needs the latest ~50 rows and an "older" fetch; Orca cannot page `inbox`, so history lives in `mk-data.event_log` (cursor on message `sequence`).

### 2.7 Inbox (`Inbox.dc.html`, constant `FILES` line 179)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Header "acme-api · plans not started yet" | selected repo + count of its plans in `running` | D | derivable |
| "3 plan files · ~/.matrixkoder/inbox" | scan of the selected repo's `<RL.path>/.matrixkoder/inbox/*.md` (top level only, per `.matrixkoder/README.md`); the mock path text must change from the home folder to the repo folder | file watch, D | available |
| File name `rate-limit-v1.md`, "edited 20m ago" | file name and mtime | file watch | available |
| Title "Rate limiting for public routes" | first `# ` heading of the file | file watch | derivable |
| Check pill "Template pass" / "Partial" | worker-side validation against the MK plan template (9 numbered blocks, per upstream template as precedent) | file watch | derivable (validator must be written; upstream `mk-plan.py` is not reused) |
| "Missing sections: QA plan, Rollback" | validator output | file watch | derivable |
| "Imported as plan · Open" | `mk-data.inbox_file.state='imported'` + `plan_id` | D | available |
| "1 file archived in inbox/archive · Restore" | files under `inbox/archive/` | file watch | available |
| "Drop a plan .md here ... start one from the MK plan template" | template text must ship inside the plugin | UI | missing asset (bundle `plan-template.md`) |

| Action | Command / script | Status |
|---|---|---|
| Rescan inbox folder | worker rescans the folder | available |
| New plan / Drop a plan | browser upload to a worker endpoint that writes `inbox/<name>.md` | available (tab can POST to 127.0.0.1) |
| Import | worker parses the file and inserts `plan`, `plan_phase`, `plan_task`, `plan_subtask` rows; moves the file to `inbox/archive/`; no Orca call yet (the Orca run is created at "start", section 3 item 7) | available |
| Archive | move file to `inbox/archive/` | available |
| Restore | move back (refuse if target exists) | available |
| Delete | copy to `inbox/.deleted/<name>-<time>/`, verify, remove (upstream pattern as precedent) | available |
| Open | navigate to Plan | available |

### 2.8 Bugs (`Bugs.dc.html`, constants `STATUS` line 176, `BUGS` line 182)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Header "acme-api · whole repo, all plans" | selected repo | D | available |
| "7 in this repo · 5 need work" | `mk-data.bug` counts | D | available |
| Filter chips with counts | by `status` | D | available |
| Row: `B-14`, title, `src/auth/token.ts:88`, risk 5 of 5, status, lane `P1` | `mk-data.bug` (id, title, file, line, risk, status, lane label via `dispatch_id`) | D | missing in Orca; stored in `mk-data.bug` |
| Status "Fixing" / "Waiting on you" updates by itself | derived from the linked dispatch: working → fixing; pending ask → waiting; task completed with success → fixed | P10 | derivable |
| Input "Describe a bug, add file:line if you know it" | parse `file:line` from text | UI | derivable |

| Action | Command / script | Status |
|---|---|---|
| Add | insert into `mk-data.bug` | available |
| Refresh bugs | re-read table | available |
| Fix | `orca orchestration worker-start --spec "Fix B-xx: TITLE (FILE:LINE)" --worktree new-child --agent A --run RUN --json`; store `dispatch_id` and set `status='fixing'` | available |

### 2.9 Todo (`Todo.dc.html`, constants `GROUPS`, `START` line 179)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Header "acme-api · your checklist" | selected repo | D | available |
| "5 open · 2 done", filter counts | `mk-data.todo` counts | D | available |
| Groups Today / Soon / Later, rows, done state | `mk-data.todo` (text, grp, done) | D | missing in Orca; stored in `mk-data.todo` |
| Link chip "T7 · auth-v2-refactor", "B-12", "phase 2" | `mk-data.todo.link_kind` + `link_ref` → plan task, bug or phase; href = Plan / Bugs screen | D | available |
| Toast "Added “…” as a task in phase 2" | UI text after Make task | D | available |

| Action | Command / script | Status |
|---|---|---|
| Add (button or Enter) | insert row | available |
| Check / uncheck | update `done`, `done_at` | available |
| Delete | delete row | available |
| Make task | insert `mk-data.plan_task` in the current phase; if the plan has a run, also `orca orchestration task-create --spec TEXT --task-title TEXT --deps JSON --run RUN --json`; remove the todo | available |
| Open plan | navigate | available |

### 2.10 Settings: General (`Settings.dc.html`)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Search settings | client filter | UI | n/a |
| Mode Orchestrator / Solo | `mk-settings.general.mode` | D | available |
| Repo "acme-api" (Orca project this panel follows) | `RL` for the list; choice saved in `mk-settings.general.activeRepo` | D | available |
| Default base branch "main" + Change | read: `repo show` has no base-ref field (CMD: keys listed, none is a ref); use `GIT symbolic-ref refs/remotes/origin/HEAD`; set: `orca repo set-base-ref --repo path:P --ref R` | D | read derivable, set available |
| Open on start "Projects" + Change | `mk-settings.general.openOnStart` | D | available |
| MK data folder "~/.matrixkoder" + Change | fixed by decision: `~/.matrixkoder/mk-data.db` and `mk-settings.json`; show as read-only text (a Change button would have to move both files) | D | available (drop Change) |
| Plan inbox "~/.matrixkoder/inbox" + Change | the inbox is per repo: `<repo>/.matrixkoder/inbox` (repo path from `RL.path`); show it read-only per selected repo | D | derivable (mock text and Change button change) |
| Settings file Export / Import | worker endpoint streams or replaces `mk-settings.json` (validate schema, keep a `.bak`) | D | available |
| About "MatrixKoder for Orca 0.1.1" | plugin manifest `version` (`plugin/orca-plugin.json`, read at build) | D | available |
| "Follows MatrixKoder upstream v0.7.5" | no longer true after the scope change | n/a | drop from design |
| Check for updates | Orca updates plugins in its own Settings > Plugins (R:settings §4); no CLI | D | missing (drop or link to Orca) |
| Reset all settings | delete keys in `mk-settings.json`; keep `mk-data.db` | D | available |

### 2.11 Settings: Agents (`SettingsAgents.dc.html`, constant `AGENTS` line 130)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Agent list (Claude Code, Codex, AGY, OpenCode) | static catalogue in the plugin; this machine also has `omp` (seen in `PS`: agentType `omp`) so the list should be open-ended | P60 | derivable |
| "claude · v2 on PATH" / "opencode · not found" | worker runs `command -v CLI` and `CLI --version`. This machine: claude, codex, opencode, omp, agy found; gemini not (CMD: `which`) | D | derivable (no Orca CLI; PATH of the worker is Orca's, unverified to match the shell) |
| State pill Ready / Missing | from detection | D | derivable |
| Toggle "Use Claude Code" | `mk-settings.agents.<id>.routable` (Orca's own enable list `disabledTuiAgents` is not readable by CLI) | D | available |
| Default model "opus 5.5 · high" + Change | `mk-settings.agents.<id>.model` / `.effort` | D | available |
| Quota "5h window 62% left", "Weekly 48% left" | `ACC` → `result.rateLimits.<provider>.session.usedPercent` and `.weekly.usedPercent`; left = 100 − used; window label from `windowMinutes` (300 = 5h); `resetsAt`, `updatedAt` available. Provider keys seen: claude, codex, gemini, opencodeGo, kimi, antigravity, minimax, grok, cursor, zcode. Mapping AGY → `antigravity` and OpenCode → `opencodeGo` is inferred | P60 | available for claude and antigravity here; `session: null` with `error` for codex and others |
| "Not reported by this CLI" | `session`/`weekly` null | P60 | derivable |
| "Not found on PATH. Install it, then press Detect again." | detection result | D | derivable |

Action: Detect again = re-run the PATH probe (no Orca command). Toggle and Change write `mk-settings.json`.

### 2.12 Settings: Routing (`SettingsRouting.dc.html`, constant `TIERS` line 132)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Route with Jev (switch), "When Jev is unsure: risk based", "Fallback when Jev is down" | `mk-settings.routing.useJev`, `.lowConfidence` | D | available (stored only; nothing in Orca reads it, see section 3 item 10) |
| Ask before destructive tasks | `mk-settings.routing.askBeforeDestructive` | D | available (advisory) |
| Tier table Trivial/Standard/Complex/Final review + Edit | `mk-settings.routing.tiers.*` | D | available |
| Lanes at once (3, − / +) | `mk-settings.routing.maxLanes` (1-8) | D | available (the plugin enforces it when it calls `worker-start`) |
| Spare Claude below 30% | `mk-settings.routing.spareClaudeBelowPct`; compare with `100 − ACC.rateLimits.claude.session.usedPercent` | P60 | available |
| Final reviews: "required" | static | n/a | n/a |

### 2.13 Settings: Safety (`SettingsSafety.dc.html`, constants `GUARDS` line 138, `CMDS` line 144)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Four guard switches (destructive git, deletes outside worktree, ask before push, scan diffs for secrets) | `mk-settings.safety.*` | D | available as stored values; enforcement missing |
| Protected branches (`main`, `release/*`) add/remove | `mk-settings.safety.protectedBranches` | D | available as stored value |
| Never run list (5 commands) + Add a command | `mk-settings.safety.neverRun` | D | available as stored value |
| "Ask before git push ... waits for you in Waiting" | would need a push hook creating a gate; none exists | n/a | missing (section 3 item 10) |

### 2.14 Settings: Alerts (`SettingsAlerts.dc.html`, constant `DEFS` line 133)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Five event switches (ask, lane done, gate fails, plan finishes, lane quiet) | `mk-settings.alerts.events.*` | D | available |
| Triggers | ask = new pending ask; lane done = `agent.status.changed` state `done` or `worker_done`; gate fails = `check_result` failed; plan finishes = all tasks completed; quiet 10 min = `PS.lastOutputAt` or `WS.dispatch.lastHeartbeatAt` older than `mk-settings.alerts.stallMinutes` | EVT, P10 | derivable |
| Desktop notification, Sound | desktop = `notifications.show` (host call, capability already declared); sound is Orca's own setting (`notifications.customSoundId`), not readable | D | desktop available; sound missing |
| Quiet hours 22:00-07:00 | `mk-settings.alerts.quietHours`; worker applies it before calling `notifications.show` | D | available |
| Wake the orchestrator on events | worker sends text to the coordinator terminal: `RUNS.runs[].coordinator_handle` → `orca terminal send --terminal H --text "..." --enter` | EVT | available |
| Send a test notification | `notifications.show` | D | available |

### 2.15 Settings: Theme (`SettingsLook.dc.html`)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Show rain, Brightness 60%, Speed, Reduce motion, Text size, Density | `mk-settings.theme.*` | UI | available |
| Follow Orca theme + swatches (ground, card, done, live, you, error) | the dashboard runs in an Orca browser tab, not in the plugin panel, so Orca's 20 CSS tokens are NOT injected (R:settings §3 applies to panels only). Orca's `theme` value lives in `profile-state.db`, which must not be read. Use `prefers-color-scheme` for light/dark | UI | missing (drop "Follow Orca theme" or reduce it to light/dark) |

### 2.16 Settings: Shortcuts (`SettingsShortcuts.dc.html`, constants `ALL` line 134, `MAX` line 143)

| Field (as shown) | Source | Refresh | Status |
|---|---|---|---|
| Footer slots "x/4", order, remove | `mk-settings.shortcuts.footer` (max 4) | D | available |
| Library (Improve, Ask Jev, Sweep lanes, Run next phase, Re-verify all, Open PR, New todo) with key hints | static list in the plugin; key hints are in-page key handlers | UI | available |
| Command targets: Sweep lanes = plugin command; Run next phase = `worker-start --task` for the next ready tasks; Re-verify all = rerun checks in lanes; Open PR = `gh pr view --web` or `orca tab create --url PR_URL`; New todo = insert todo | see command column of the relevant screen | D | available / PR url derivable from `PS.linkedPR` plus remote URL |
| "+ Custom: MK command or Orca automation" | `orca automations list --json` (list is empty here), run with `orca automations run` | D | available |
| Footer preview | UI | UI | n/a |

---

## 3. Missing data

Numbered; each says what the mock shows and what to do.

1. Lane model/effort for plain agent panes (Overview, Lanes). `PS` has `agentType` only; model/effort exist only for supervised workers (`WS` → `startOptions.launch.effective`, CMD: `omp` / `manifest/auto` / effort null). Recommendation: show agent only for plain panes; for workers cache `WS` per dispatch in `mk-data.lane`.
2. "turn 4" counter. No Orca source. Compute: count `done → working` transitions per `paneKey` from `agent.status.changed`, stored in `mk-data.lane.turns`. Only correct from the time the worker runs; label "since MK started watching" or drop from design.
3. Build/Test/Review chips, "41 / 63 passing", Gates events. Orca has none (its gates are decisions). Recommendation: MK must store `check_result`. Writer options, pick one in Phase 0: (a) lane agents report with `orca orchestration send --type status --payload '{"check":"test","passed":41,"total":63}'` and the worker reads it from `INB` (zero extra process); (b) the worker runs the repo's test command in the worktree (needs a per-repo command in settings, heavy). Recommend (a).
4. Commits ahead, files/lines changed, commit events, PR "ready to merge", merged state. No Orca CLI; compute with `git` (and `gh` for PR state, unverified installed). Cache per worktree; poll every 10 s only for lanes shown.
5. Undo on Approve/Answer. Orca resolutions are final. Recommendation: MK delay window: on click, write `mk-data.decision_log` with `status='pending'`, `commit_at = now+10 s`, show the banner with Undo; the worker runs the Orca command at `commit_at` unless undone. Cost: a 10 s lag and the worker must stay alive (see risk 1). Alternative: drop Undo for gates and keep it only for local actions (todos, archive).
6. Subtask state (Plan). Orca does not track it. Writer options: (a) the orchestrator updates `mk-data.plan_subtask` through a plugin command; (b) subtasks become real Orca child tasks (`task-create --parent`), then status is free but every subtask is a dispatchable task. Recommend (a) for v1 plus auto-complete a task's subtasks when the Orca task completes.
7. Plan/phase/wave structure and the plan↔run link. Orca has only Run → Task. MK must store plans in `mk-data` and create the Run when the plan is started (`run-create --objective`), then `task-create` per plan task with `--deps` from phase order. Failed deps never promote (inferred), so the worker must handle failure by creating a retry task (as the live run does: "fix r2").
8. Stage pill (Plan/Build/Verify/Merge) and "Wave 2 of 3". Compute (rules in 2.2). Merge stage needs git/PR data (item 4).
9. Task status "Failed". Mock palette has no Failed state, Orca has `failed`; 6 of 19 dispatches failed in the live run. Add a Failed pill and a retry action (design change).
10. Safety and Routing settings are not enforced by anyone. Orca has no command guard or protected-branch rule; the Jev routing flag is read by nobody. Recommendation: label as "advisory, read by the orchestrator" or drop the unenforceable ones (never-run list, secret scan, push approval) from v1.
11. Recommendations ("Jev: approve...") and resolved routing decisions. No Orca field. Store in `mk-data.waiting_note` / `decision_log` when the orchestrator provides them through a plugin command; otherwise hide the line.
12. Ask Jev panel and chips. Jev is an external service; the worker has no capability for it and storing a key needs the `secrets` capability (not declared). Recommendation: keep the button only if a Jev call path is decided; otherwise drop.
13. Follow Orca theme and swatches (browser tab has no Orca tokens). Drop or reduce to light/dark.
14. Quota for agents other than claude/antigravity. `rateLimits.codex.session` is null with an error on this machine. Show "Not reported" (already in the mock).
15. Inbox template for "start one from the MK plan template". Ship `plan-template.md` with the plugin.
16. Mock inconsistencies to fix in the design: Waiting badge is 2 on Projects and 1 elsewhere; Bugs badge 4 vs "5 need work"; "Wave 2 of 3" vs Plan "Phase 2"; Agents shows "opus 5.5 · high" but Overview shows "opus high"; Overview "7/12 tasks" vs Plan "2 working/waiting" counts. Decide one definition per number (section 2 badge rules).
17. Heartbeats and event noise. 32 of 57 live messages are heartbeats. Filter them from Events; use their `payload.phase` ("implementing", "investigating", "reviewing", "verifying") as the lane subtitle.
18. "Follows MatrixKoder upstream v0.7.5", "Check for updates". Drop or relabel (item in 2.10).

---

## 4. State snapshot draft

One object returned by the worker (`GET /api/state?repo=ID&plan=ID`). It is a projection: raw CLI output is far larger than 64 KB (CMD today: `TL --brief` 37 KB for 16 tasks, `WL` 48 KB for 19 workers, `INB` 76 KB for 57 messages, `PS` 15 KB for 8 worktrees), so the worker trims fields and caps lists. Target at the caps below is about 40-55 KB; if a screen exceeds the budget, that screen is served by `GET /api/state/<screen>` instead.

```jsonc
{
  "meta": {
    "schema": 1, "at": 1792867400000, "orca": "1.4.239", "runtimeOk": true,
    "repoId": "<uuid>", "planId": "auth-v2-refactor", "runId": "run_…",
    "stale": { "ps": 1200, "orchestration": 4300, "git": 8000, "quota": 41000 }   // ms since last pull per source
  },
  "badges": { "lanes": 3, "waiting": 1, "inbox": 2, "bugs": 4 },
  "projects": {                           // cap 30 repos
    "machine": "this Mac", "active": 2, "total": 3, "lanesLive": 5, "waiting": 2,
    "waitingList": [ { "askId": "g_…", "title": "…", "repo": "acme-api", "plan": "auth-v2-refactor", "lane": "P2", "agent": "codex", "ageMs": 120000 } ],
    "repos": [ { "id": "<uuid>", "name": "acme-api", "path": "~/code/acme-api", "worktrees": 4, "lastActivityAt": 1792867160085,
                 "plans": [ { "id": "auth-v2-refactor", "stage": "build", "wave": [2,3], "lanes": 3, "tasks": [7,12], "waiting": 1, "pr": 12 } ],
                 "idleWorktrees": 0 } ]
  },
  "overview": {
    "stage": "build", "stageProgress": { "plan": 1, "build": 0.6, "verify": 0, "merge": 0 },
    "wave": [2, 3], "lanesLive": 3, "tasks": [7, 12], "needsYou": 1,
    "bus": { "id": "msg_…", "at": 1792867396000 },
    "decision": { "askId": "g_…", "kind": "gate", "title": "…", "body": "…", "lane": "P2", "agent": "codex", "ageMs": 120000 },
    "waves": [ { "title": "DB schema and migrations", "done": 4, "total": 4, "segments": { "done": 4, "working": 0, "waiting": 0 } } ]
  },
  "lanes": [                              // cap 12
    { "label": "P1", "dispatchId": "ctx_…", "paneKey": "…", "worktreeId": "…", "terminalHandle": "term_…",
      "agent": "claude", "model": "opus 5.5", "effort": "high",
      "branch": "fix/jwt-rotation", "head": "c8f421a", "path": "~/code/acme-api-wt/p1",
      "state": "working", "phase": "implementing", "turns": 4, "startedAt": 1792866500000,
      "task": { "id": "T6", "title": "…", "wave": 2, "orcaTaskId": "task_…" },
      "git": { "ahead": 3, "files": 6, "added": 182, "removed": 40 },
      "checks": [ { "name": "build", "status": "passed", "at": 1792867280000 }, { "name": "test", "status": "running", "passed": 41, "total": 63 } ],
      "activity": [ { "at": 1792867260000, "kind": "edit", "text": "edit src/auth/token.ts" } ],      // last 5
      "askId": null }
  ],
  "plan": {                               // one plan; cap 40 tasks, 120 subtasks
    "title": "auth-v2-refactor", "done": 7, "total": 12, "subtasks": 25,
    "phases": [ { "id": "ph2", "title": "Middleware and token handling", "status": "working", "done": 3, "total": 5,
      "tasks": [ { "id": "T6", "title": "…", "status": "working", "meta": "P1 claude · turn 4", "after": null,
        "subs": [ ["T6.1","expiry config","done",""], ["T6.3","clock-skew leeway","working","now"] ] } ] } ]
  },
  "waiting": {
    "open": [ { "id": "g_…", "kind": "gate", "title": "…", "body": "…", "rec": "", "options": [], "lane": "P2", "agent": "codex", "task": "T7", "ageMs": 120000 } ],
    "resolved": [ { "title": "…", "outcome": "Approved", "src": "orchestrator · 11:58", "canUndo": false, "undoUntil": null } ]   // cap 20
  },
  "events": {                             // newest 50; older via /api/events?before=<id>
    "cursor": 4812,
    "rows": [ { "id": 4812, "at": 1792867390000, "kind": "gate", "text": "…", "src": "P1 claude · T6", "payloadRef": 4812 } ]   // payload via /api/event/<id>
  },
  "inbox": {
    "dir": "<repo>/.matrixkoder/inbox", "archived": 1,
    "files": [ { "name": "rate-limit-v1.md", "title": "…", "editedAt": 1792866200000, "check": "pass", "missing": [], "state": "new", "planId": null } ]    // cap 50
  },
  "bugs": { "total": 7, "needWork": 5, "rows": [ { "id": "B-14", "title": "…", "where": "src/auth/token.ts:88", "risk": 5, "status": "fixing", "lane": "P1" } ] },   // cap 100
  "todo": { "open": 5, "done": 2, "rows": [ { "id": 1, "text": "…", "group": "today", "done": false, "link": { "kind": "task", "ref": "T7", "label": "T7 · auth-v2-refactor" } } ] },   // cap 100
  "settings": {                           // whole mk-settings.json (about 3 KB) + live read-only values
    "values": { "schema": 2 },
    "agents": [ { "id": "claude", "cli": "/…/claude", "found": true, "quota": [ { "label": "5h window", "leftPct": 62, "resetsAt": 1792880000000 } ] } ],
    "baseBranch": "main", "version": "0.1.1"
  }
}
```

Sizing and paging notes:

1. Never forward `PS.agents[].prompt`, `lastAssistantMessage`, `toolInput`, `preview` (they carry conversation text, R:bus §2 item 10). The snapshot carries only `toolName`-derived activity text built by the worker, cut to 120 characters.
2. Events: 50 rows at about 220 bytes is 11 KB; payload JSON is fetched on expand. Persist every row in `mk-data.event_log` with the Orca message `sequence` as the cursor; poll `inbox --limit 100` every 10 s; heartbeats are not stored as rows (only the latest `phase` per dispatch is kept in `lane`).
3. Todo and bugs: 100 rows each is about 15 KB; beyond the cap, page with `?offset`.
4. Poll cost (CMD today, sequential): `PS` 148 ms, `RUNS` 131 ms, `TL` 134 ms, `WL` 188 ms, `GL` 166 ms, `INB` 129 ms, `WS` about 130 ms each. A full orchestration pull for one run is about 0.75 s when run in parallel. Cache `WS` per dispatch (immutable). Pull `ACC` once a minute.
5. Multi-repo: only the selected repo's run is pulled in full; other repos feed only the counts on Projects (from `PS` and `mk-data`).

---

## 5. `mk-data.db` draft schema

File: `~/.matrixkoder/mk-data.db`, mode 0600, WAL, opened only by the plugin worker (single writer; `node:sqlite`). `PRAGMA user_version` holds the schema number. Timestamps are integer milliseconds since epoch (matches Orca event payloads). Orca ids are stored as text and never as foreign keys to Orca.

```sql
-- Plans: structure Orca cannot express (section 1)
CREATE TABLE plan(
  id TEXT PRIMARY KEY,                -- slug from the plan file or header
  repo_id TEXT NOT NULL,              -- Orca repo uuid
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('imported','running','verifying','merged','done','archived')),
  source_path TEXT, source_sha TEXT,
  base_branch TEXT, plan_branch TEXT, pr_number INTEGER, pr_url TEXT,
  run_id TEXT,                        -- Orca run id, set at start
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX plan_repo ON plan(repo_id, status);

CREATE TABLE plan_phase(
  plan_id TEXT NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  id TEXT NOT NULL,                   -- 'ph2'
  ord INTEGER NOT NULL, title TEXT NOT NULL,
  PRIMARY KEY(plan_id, id)
);

CREATE TABLE plan_task(
  plan_id TEXT NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  id TEXT NOT NULL,                   -- 'T6'
  phase_id TEXT NOT NULL, ord INTEGER NOT NULL,
  title TEXT NOT NULL, spec TEXT,
  depends TEXT NOT NULL DEFAULT '[]', -- JSON array of plan task ids
  planned_agent TEXT, planned_model TEXT, planned_effort TEXT, planned_branch TEXT,
  PRIMARY KEY(plan_id, id)
);

CREATE TABLE plan_subtask(
  plan_id TEXT NOT NULL, task_id TEXT NOT NULL,
  id TEXT NOT NULL,                   -- 'T6.3'
  ord INTEGER NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','working','waiting','blocked','done')),
  note TEXT NOT NULL DEFAULT '', updated_at INTEGER,
  PRIMARY KEY(plan_id, id)
);

-- One MK task maps to several Orca tasks (retries/fix rounds, seen live)
CREATE TABLE task_link(
  orca_task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL, plan_id TEXT NOT NULL, plan_task_id TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL DEFAULT 'build' CHECK(kind IN ('build','fix','restart','review')),
  created_at INTEGER NOT NULL
);
CREATE INDEX task_link_plan ON task_link(plan_id, plan_task_id);

-- Lanes: MK label and caches Orca does not keep
CREATE TABLE lane(
  dispatch_id TEXT PRIMARY KEY,       -- Orca dispatch id (ctx_…)
  run_id TEXT, plan_id TEXT, plan_task_id TEXT,
  label TEXT NOT NULL,                -- 'P1'
  worktree_id TEXT, pane_key TEXT, terminal_handle TEXT,
  agent TEXT, model TEXT, effort TEXT,        -- cached from worker-show
  phase TEXT,                         -- latest heartbeat phase
  turns INTEGER NOT NULL DEFAULT 0, first_seen_at INTEGER NOT NULL, last_state TEXT, last_state_at INTEGER
);
CREATE INDEX lane_plan ON lane(plan_id);
CREATE UNIQUE INDEX lane_label ON lane(run_id, label);

CREATE TABLE lane_activity(
  id INTEGER PRIMARY KEY, dispatch_id TEXT NOT NULL, at INTEGER NOT NULL,
  kind TEXT NOT NULL,                 -- edit | run | commit | note
  text TEXT NOT NULL                  -- already trimmed, no prompt text
);
CREATE INDEX lane_activity_d ON lane_activity(dispatch_id, at DESC);

-- Test/build checks (not Orca decision gates)
CREATE TABLE check_result(
  id INTEGER PRIMARY KEY, plan_id TEXT, plan_task_id TEXT, dispatch_id TEXT,
  name TEXT NOT NULL,                 -- build | test | review | custom
  status TEXT NOT NULL CHECK(status IN ('pending','running','passed','failed','asks','skipped')),
  passed INTEGER, total INTEGER, detail TEXT,
  source TEXT NOT NULL,               -- 'message:<id>' or 'command'
  at INTEGER NOT NULL
);
CREATE INDEX check_task ON check_result(plan_id, plan_task_id, name, at DESC);

-- Waiting: notes, undo window and history
CREATE TABLE waiting_note(
  ask_id TEXT PRIMARY KEY,            -- gate id or question message id
  kind TEXT NOT NULL CHECK(kind IN ('gate','question')),
  recommendation TEXT, source TEXT, snoozed_until INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE decision_log(
  id INTEGER PRIMARY KEY, ask_id TEXT, kind TEXT NOT NULL,   -- gate | question | route
  title TEXT NOT NULL, action TEXT NOT NULL,                 -- approve | rework | answer
  answer TEXT, actor TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL CHECK(status IN ('pending','sent','undone','failed')),
  commit_at INTEGER,                  -- when the Orca command will run (undo window)
  sent_at INTEGER, error TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX decision_pending ON decision_log(status, commit_at);

-- Events history (Orca keeps none for plugin events, and inbox has no cursor)
CREATE TABLE event_log(
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('lane','gate','ask','commit','bus')),
  text TEXT NOT NULL, src TEXT, ref TEXT,                    -- ref: 'msg:<sequence>' | 'pane:<key>' | 'sha:<x>'
  payload TEXT                        -- JSON, redacted
);
CREATE UNIQUE INDEX event_ref ON event_log(kind, ref) WHERE ref IS NOT NULL;
CREATE INDEX event_at ON event_log(at DESC);
CREATE TABLE cursor(key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- 'inbox.sequence', 'git.<worktree>'

-- User lists
CREATE TABLE bug(
  id TEXT PRIMARY KEY,                -- 'B-14'
  repo_id TEXT NOT NULL, plan_id TEXT,
  title TEXT NOT NULL, file TEXT, line INTEGER,
  risk INTEGER NOT NULL DEFAULT 3 CHECK(risk BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','fixing','waiting','fixed','wontfix')),
  dispatch_id TEXT, orca_task_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX bug_repo ON bug(repo_id, status);
CREATE TABLE todo(
  id INTEGER PRIMARY KEY, repo_id TEXT NOT NULL,
  text TEXT NOT NULL, grp TEXT NOT NULL DEFAULT 'today' CHECK(grp IN ('today','soon','later')),
  done INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0,
  link_kind TEXT CHECK(link_kind IN ('task','phase','bug')), link_ref TEXT,
  created_at INTEGER NOT NULL, done_at INTEGER
);
CREATE INDEX todo_repo ON todo(repo_id, done, grp);

-- Inbox import records (the files themselves stay on disk)
CREATE TABLE inbox_file(
  path TEXT PRIMARY KEY, title TEXT, sha TEXT, mtime INTEGER,
  fit TEXT CHECK(fit IN ('pass','partial','not_a_plan')), missing TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'new' CHECK(state IN ('new','imported','archived','deleted')),
  plan_id TEXT, imported_at INTEGER
);

-- Notification de-duplication
CREATE TABLE alert_sent(key TEXT PRIMARY KEY, at INTEGER NOT NULL);   -- 'ask:<id>', 'laneDone:<dispatch>'
```

Settings stay out of the DB (`mk-settings.json`). Retention: `event_log` 5,000 rows, `lane_activity` 50 rows per dispatch, `alert_sent` 30 days. Tables with live Orca references (`lane`, `task_link`) are rebuilt from Orca on startup when rows are missing; user lists (`bug`, `todo`, `plan*`, `decision_log`) are the only irreplaceable data and should be copied to `mk-data.db.bak` daily.

---

## 6. Risks and unknowns for a Phase 0 proof on the live machine

1. Worker lifetime. The worker is idle-reaped after 5 minutes, has a 30 s command timeout and at most 5 concurrent workers (R:api §4.1). A long-lived HTTP server, the 10 s poll loop and the Undo timer may all be killed. Test: start a server in the worker, leave it idle 10 minutes, see if it survives. Fallback: run the server as a separate user process started by the plugin.
2. Can the worker serve HTTP on 127.0.0.1 and will an Orca browser tab load it? (`orca tab create --url http://127.0.0.1:PORT/?t=TOKEN`; tab needs a worktree context.) Bind to loopback only, random port, per-session token, check `Host` header (DNS rebinding). Unverified.
3. `node:sqlite` inside the forked worker. Verified only in Orca's own binary (Node 24.22.0, Electron 43.8.1). Check the worker loads it without flags and the experimental warning does not go to stderr as an error.
4. Spawning `orca` from the worker. Worker `PATH` is Orca's allowlisted value (R:api §4.1); `orca` and agent CLIs may not be found (here they live under `~/Library/PhpWebStudy/env/...`, `~/.local/bin`). Test `command -v orca claude codex` from the worker.
5. Caller identity for mutations. `reply`, `gate-resolve`, `task-create`, `worker-start` from a process with no bound terminal: not run here. Mutations record caller identities and receipts (R:bus §1 table). Test on a throwaway run: does `reply --id M --body X --run R` work unbound, and who does the receiving agent see as sender?
6. Gate versus question usage. Confirm with the orchestrator skill which one the mock "Decision gate" should be (section 1.2 item 3), and the text convention for approve/rework resolutions. `gate-list` shape is from research (0 gates exist live).
7. Answered question detection. The thread rule (a later message with the same `thread_id` means answered) was seen on 2 threads; confirm on an escalation and on a timed-out ask.
8. Pane/dispatch/worktree joins. `assignee_pane_key` (`<id>:<id>`) vs `PS.agents[].paneKey`, and `WL.resource.worktreeId` vs `PS.worktreeId` (R:bus §3 item 4 says "unverified"). Needed for lane cards.
9. `inbox` window. Newest first, no cursor, 76 KB at 200 limit; heartbeats dominate. Test message rate during 5 busy lanes to size `--limit` and the poll interval so no sequence gap appears.
10. `account list` quota. Confirm `usedPercent` matches what Orca shows for claude, that calling it every 60 s is cheap (does it hit the network?), and the AGY and OpenCode provider key mapping.
11. Event coverage. `agent.status.changed` is not sent for restored panes and the worker starts lazily (R:bus §3 item 2, R:api §4.4); the P3 poll of `PS` must be the source of truth, events only speed it up.
12. Git and gh availability for ahead/diff/merged/PR state in each worktree; cost with 10+ worktrees; worktrees on remote hosts (`--environment`) are out of reach of local git.
13. Remote hosts. `RL`/`PS`/`WL` are host-scoped (`hostScope`, `--include-remote`); the first version should say "local only" and show a notice when `omittedHostIds` is non-empty.
14. Data volume and privacy. `PS` rows carry prompts and assistant text; `mk-data.db` and the HTTP API must never persist or serve them (snapshot rules above).
15. Orca version drift. Research reads source 1.4.214 for settings and e30184fa8d38 for the bus; installed is 1.4.239. Re-run the shape probes at the start of Phase 0 and pin them as fixtures.
16. Template validator. The numbered-block plan template and its check are the one part of upstream behaviour the Inbox screen depends on and that must be re-implemented; decide the block list and the `partial` rule before building Import.
17. Dashboard definition of "lane". Decide whether a lane is a worker dispatch, a worktree with an agent, or both (this changes every count on Projects, Overview and Lanes).

---

## Commands run and failures

All read-only: `orca status`, `orca project list`, `orca repo list`, `orca repo show --repo path:…`, `orca worktree ps`, `orca worktree show --worktree path:…`, `orca worktree current`, `orca orchestration run-list`, `run-current`, `task-list --run R --brief`, `worker-list --run R`, `worker-show --dispatch D` (2 calls), `gate-list --run R`, `inbox --limit 20` and `--limit 200`, `orca account list`, `orca terminal list`, `orca agent-context` (size and keys only), `--help` of several commands, `which claude codex opencode omp agy gemini`, `ELECTRON_RUN_AS_NODE=1 /Applications/Orca.app/Contents/MacOS/Orca -e …` (prints versions only). Session JSON was processed in a sandbox and only keys, counts and short titles were read; no tokens or message bodies were copied here.

Failures:

1. One probe script crashed with a Python `TypeError` (my own indexing of an `orca terminal list` result that came back without `terminals`); the rest of that script had already printed. I did not retry it: terminal handles are also in `WL.agentTerminalHandle`, and the `terminal list` shape is documented in R:cli §139 (not re-confirmed today; unverified).
2. Tool output in this session was often auto-compressed by a hook (repeated lines collapsed). Facts used here were taken from sandbox-printed values or from files read directly, not from collapsed output.
3. Upstream mk-project.db: not needed after the scope change; no failure to report for this file.
