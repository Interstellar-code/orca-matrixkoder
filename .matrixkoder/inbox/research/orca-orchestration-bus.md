# Orca orchestration bus: data model, flow, events, MatrixKoder mapping

Researched 2026-10-24. Orca source = git remote `orca/main` at `e30184fa8d38` (call it `S:` below). Installed app = 1.4.239 (`orca status --json` -> `result.runtime.appVersion`). Live DB = `~/Library/Application Support/orca/orchestration.db`, `PRAGMA user_version` = 43, which equals the newest migration `S:src/main/runtime/orchestration/db/schema/migrate-v43.ts`.

Evidence legend: `S:path:line` = `git show orca/main:path`. `CLI:` = command I ran (help or read-only `--json`). `DB:` = `sqlite3 -readonly` on the live file (schema, counts, JSON key names only; no message bodies read). "unverified" = not confirmed.

Important context: the local checkout `HEAD` (aa7e9344) has no `src/main/plugins` or `src/shared/plugins/plugin-*` files (`git diff --stat orca/main HEAD` shows them as pure deletions). The plugin API facts below come from `orca/main`, and the installed 1.4.239 app does load plugins (`~/Library/Application Support/orca/plugins/plugins.lock.json` lists `interstellar.matrixkoder`, local-path `.../orca-matrixkoder/plugin`).

---

## 1. Data model

Store: one SQLite file (WAL). 25 tables (DB: `select name from sqlite_master`). Tables that matter to a dashboard, with live row counts (DB):

| Table | Rows | Role |
|---|---|---|
| runs | 2 | Run = namespace + coordinator inbox (one is the `legacy` placeholder) |
| tasks | 16 | Work items (the DAG) |
| dispatch_contexts | 19 | One attempt of a task (the "lane" identity, heartbeat) |
| worker_dispatches | 19 | Supervised-worker lifecycle for a dispatch |
| worker_terminal_resources | 17 | Terminal ownership/release accounting |
| worker_terminal_archives | 5 | Saved transcript/tail/journal when a worker is released |
| messages | 57 | The message bus |
| deliveries | 25 | FIFO batches handed to a coordinator (ack tracking) |
| question_threads | 2 | Pending/answered `ask` questions |
| decision_gates | 0 | Coordinator-owned DAG decisions |
| attempt_observation_facts | 13 | Worker reports (`facet=worker_report`) |
| mutation_receipts (+ledger, caller_identities) | 186/1/1 | Idempotency receipts for CLI mutations; not useful for UI |
| federated_dispatches, remote_dispatch_attachments, remote_questions, federation_relay_items | 0 | Cross-host worker state (empty here) |
| coordinator_runs | 0 | Retired scheduler (CLI `coordinator-start/stop` are "Retired", CLI: `orca orchestration --help`) |
| legacy_* (4), structured_pointer_operations | 0 | Legacy compat / pointer delivery |

Schema = `DB: .schema`; matches `S:src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts` (runs :5, messages :23, worker_dispatches :144) and `create-graph-tables-sql.ts` (tasks :115, dispatch_contexts :140, decision_gates :188).

### Columns that a UI needs

1. `runs`: `id`, `objective`, `home_database`, `coordinator_handle`, `coordinator_pane_key`, `coordinator_orca_session_id`, `consumer_generation`, `legacy` (0/1), `created_at`, `updated_at`.
2. `tasks`: `id`, `run_id`, `parent_id`, `created_by_terminal_handle`, `task_title`, `display_name`, `spec`, `status`, `deps` (JSON array of task ids, TEXT), `result`, `created_at`, `completed_at`.
3. `dispatch_contexts`: `id`, `run_id`, `task_id`, `assignee_handle`, `assignee_pane_key`, `status`, `failure_count`, `last_failure`, `termination_reason`, `depth`, `retry_of_dispatch_id`, `creator_dispatch_id`, `creator_handle`, `host_scope`, `dispatched_at`, `completed_at`, `last_heartbeat_at`. Also `launch_token_hash`, `capability_hash` (secrets-adjacent hashes; never display).
4. `worker_dispatches`: `dispatch_id`, `state`, `stage`, `worktree_id`, `agent_terminal_handle`, `setup_state`, `effects` (JSON), `residual_resources` (JSON), `start_options` (JSON, includes agent/model/effort and worktree selector), `last_error`, timestamps.
5. `messages`: `id`, `run_id`, `delivery_contract`, `from_handle`, `to_handle`, `subject`, `body`, `type`, `priority`, `thread_id`, `payload` (JSON text), `read`, `sequence` (autoincrement PK, use as event cursor), `created_at`, `delivered_at`, `sender_pane_key`.
6. `question_threads`: `message_id` (PK = the question message id), `run_id`, `dispatch_id`, `asker_handle`, `status`, `answer_message_id`, `answer_body`, `created_at`, `answered_at`, `closed_at`.
7. `decision_gates`: `id`, `run_id`, `task_id`, `question`, `options` (JSON array), `status`, `resolution`, `created_at`, `resolved_at`.
8. `deliveries`: `id`, `run_id`, `mailbox_handle`, `consumer_generation`, `message_ids` (JSON), `status`, `created_at`, `acknowledged_at`.

### Enumerations (DB CHECK constraints, confirmed in `DB: .schema` and source)

| Field | Values |
|---|---|
| messages.type | status, dispatch, worker_done, merge_ready, escalation, handoff, decision_gate, question, heartbeat (`S:...create-core-tables-sql.ts:34`; `CLI: orca orchestration send --help`) |
| messages.priority | normal, high, urgent |
| messages.delivery_contract | legacy_direct, current_delivery, audit_only |
| tasks.status | pending, ready, dispatched, completed, failed, blocked (`S:...create-graph-tables-sql.ts:128`) |
| dispatch_contexts.status | pending, dispatched, completed, failed, circuit_broken |
| worker_dispatches.state | starting, ready, start_unknown, failed, succeeded, stopping, stop_unknown, stopped, abandoned (`S:...create-core-tables-sql.ts:149`) |
| decision_gates.status | pending, resolved, timeout |
| question_threads.status | pending, answered, closed |
| deliveries.status | outstanding, acknowledged, fenced |
| worker_terminal_resources.ownership_state | owned, transferred, user_owned, external, released |
| worker_terminal_resources.release_state | not_requested, retained, requested, releasing, released, unknown |

Live distributions (DB, group by): messages = heartbeat 32, worker_done 13, status 10, question 2. tasks = completed 13, ready 2, blocked 1. dispatch_contexts = completed 13, failed 6. worker_dispatches = succeeded/settled 13, failed 5 (agent_readiness 2, dispatch_input 1, process_exited 2), stopped 1. question_threads = answered 2. No message of type `escalation`, `decision_gate`, `merge_ready`, `handoff` or `dispatch` exists yet, so their payload shapes are unverified from live data.

### Payload JSON keys seen in live data (keys only)

1. heartbeat: `taskId, dispatchId, phase`.
2. question: `taskId, dispatchId, question, options`.
3. worker_done: `taskId, dispatchId, outcome` (+ `filesModified`, `reportPath` when sent).
4. attempt_observation_facts.payload (facet `worker_report`): `outcome, reportId, status`.
5. decision_gate payload (from source, not seen live): `taskId, dispatchId, question, options[]` (`S:src/main/runtime/orchestration/coordinator-decision-gates.ts:13`).

### DAG / dependency fields

1. `tasks.deps` = JSON array of task ids; every dep must be in the same run (`S:src/main/runtime/orchestration/db/tasks/task-store.ts:38-43`).
2. `tasks.parent_id` = subtask link, same-run check (`task-store.ts:32-37`). `dispatch_contexts.depth` = worker nesting depth (1 = root coordinator's worker); `creator_dispatch_id` links nested workers.
3. On create: `status = 'ready'` if all deps are `completed` (or none), else `'pending'` (`task-store.ts:59-66`).
4. On `completed`: `promoteReadyTasks` flips pending tasks whose deps are all completed to `ready` (`task-store.ts:211-236`, called from `task-status-transition.ts:108-110`). Nothing promotes on `failed`: a task whose dep failed stays `pending` (inferred from the code, untested).
5. DAG-finished test (`all tasks completed|failed`) is in `S:src/main/runtime/orchestration/coordinator-dag-convergence.ts:15`.
6. Live data: 16 tasks, `deps != '[]'` count = 0, `parent_id` set count = 0. Nobody has used the DAG fields yet in this DB (DB query), so the dep/parent JSON is source-confirmed but not live-confirmed.
7. Terminal task states complete/fail are blocked while a supervised worker is still alive (`task-status-transition.ts:56-62`).

### Decision gates

1. `gate-create --task` inserts a `pending` gate, completes the active dispatch, and sets the task `blocked` (`S:.../decision-gates/decision-gate-store.ts:74-87`). Refused with `task_not_startable` if a supervised worker for that task is still active (`:57-73`), so a gate is a coordinator-side DAG decision, not a worker pause.
2. `gate-resolve` sets `resolved` + `resolution`, then moves the task to `ready` (`:100-121`). `timeoutGate` sets `timeout` (`:132-142`).
3. The coordinator loop never auto-resolves gates; "humans do" (`S:coordinator-decision-gates.ts:53`).
4. A worker blocked on a question uses `ask`, not a gate: "Do not create a gate merely to answer a worker's `ask`" (`S:skill-guides/orchestration/references/messaging-and-gates.md`; identical text in `CLI: orca skills get orchestration --reference references/messaging-and-gates.md` family).

---

## 2. How messages and tasks flow

### Writers and readers

| Actor | Writes | Reads |
|---|---|---|
| Coordinator (an agent or human running `orca orchestration ...`) | `run-create`, `task-create`, `worker-start`, `send`, `reply`, `gate-*`, `task-update` | `check` (consuming), `inbox`, `task-list`, `worker-list/show/read`, `gate-list` |
| Dispatched worker | `send --type heartbeat/worker_done/status`, `ask`, `check --terminal <handle>` | its dispatch mailbox |
| Orca runtime (main process) | `worker_dispatches`, `worker_terminal_resources`, `attempt_observation_facts`, `deliveries`, task/dispatch settlement, wake/nudge | everything |

Source of truth for the CLI surface: `CLI: orca orchestration --help` (24 subcommands) and `S:src/cli/specs/orchestration.ts`. The CLI is a thin client of runtime RPC methods `orchestration.*` (44 names, e.g. `orchestration.taskList`, `orchestration.workerList`, `orchestration.inbox`, `orchestration.gateList`, `orchestration.runList`; `git grep "name: 'orchestration\." orca/main -- src/main/runtime/rpc`).

### Flow of one supervised task

1. `run-create --objective` -> `runs` row; coordinator terminal bound (`CLI: orchestration run-create --help`).
2. `worker-start --spec/--task` -> `tasks` row (if `--spec`), `dispatch_contexts` row, `worker_dispatches` row (`starting` -> `ready`), a terminal/chat, and `worker_terminal_resources` row; injects the task preamble.
3. Worker `send --type heartbeat --phase ...` -> `messages` heartbeat (updates `dispatch_contexts.last_heartbeat_at`).
4. Worker `ask --question` -> `messages` type `question` + `question_threads(pending)`; blocks up to 10 min default, max 30 (`CLI: orchestration ask --help`). Coordinator `reply --id <message_id>` -> `question_threads(answered)` with `answer_body` (`S:.../questions/question-threads.ts:76`).
5. Worker `send --type worker_done --outcome succeeded|failed` -> `messages` worker_done; runtime settles task + dispatch + worker automatically (`S:.../dispatch-context/worker-report-settlement.ts:60`), writes an `attempt_observation_facts` `worker_report`, and on success promotes dependents. Do not follow with `task-update --status completed` (`CLI: orca skills get orchestration`).
6. Coordinator `check [--wait --types worker_done,escalation,question]` -> gets the oldest FIFO `deliveries` batch (up to 50), then `check --ack <delivery_id>`. `--peek`/`--all` are read-only; plain `check` consumes (marks read) so a dashboard must never call it.
7. Coordinator `worker-release` / `worker-retain` -> `worker_terminal_resources.release_state`, optional `worker_terminal_archives`.

Addressing: `run:<id>`, `dispatch:<id>`, or groups `@all @idle @claude @codex @opencode @gemini @droid @grok @cursor @worktree:<id>` (`CLI: orchestration send --help`; `S:skill-guides/orchestration/references/messaging-and-gates.md`). A trigger on `messages` rewrites `to_handle` to `run:<run_id>` for coordinator mail (DB `.schema`, trigger on `messages` insert). Live: all 13 worker_done, 32 heartbeat and 2 question messages are addressed to `run:...`.

### CLI JSON shapes (read-only calls I ran; all wrap `{id, ok, result, _meta:{runtimeId}}`; errors are `{ok:false, error:{code,message,data}}`)

1. `orca orchestration run-list --json` -> `result.runs[] {id, objective, coordinator_handle, consumer_generation, legacy, created_at, updated_at}`, `result.nextCursor`. Does not need a bound run. `run-show --id` -> `result.run`. `run-current` -> `result.run` (null if the caller is unbound).
2. `task-list --run <id> [--brief] [--status s] [--ready] --json` -> `result {runId, legacyReadOnly, tasks[], count}`; each task = the full tasks row + `spec_truncated` with `--brief` (spec capped to 160 chars). Without `--run` and without a bound terminal: `No Run is bound. Use orchestration run-create or run-use first.` (I hit this, then added `--run`).
3. `gate-list --run <id> [--status pending] --json` -> `result {runId, gates[], count}` (same `--run` requirement).
4. `worker-list [--run <id>] [--terminal-state s] [--include-remote] [--limit 1-100] [--cursor c] --json` -> `result.workers[]` each `{dispatchId, taskId, runId, workerState, dispatchStatus, agentTerminalHandle, terminalState, resource{...ownershipState, releaseState, worktreeId, terminalHandle, archive{source,status}}, projection{...}}` plus `counts`, `page{limit,total,hasMore,nextCursor}`, `scope{source[,run]}`, `warnings[]`. Unscoped and unbound = every run (`CLI: worker-list --help`, `scope.source` = flag|bound|all).
5. `worker-list` `projection` (this is the best single lane object): `role, parent, provider, host{kind,id}, workspace{id,kind}, stage{worker,dispatch,detail,activity}, outcome, liveness{verdict,source[,reason]}, evidence{durable,liveStatus,lastObservedAt}, resource{state}, nextAction{kind,argv[]}, attention{categories[],requiresAction}`. Enums: `liveness.verdict` live|unverifiable|exited, `stage.activity` working|blocked|waiting|done|unknown (`S:src/shared/orchestration-fleet-projection.ts:105`), `attention.categories` guidance|input|approval|failure|interruption|stale|unverifiable|root_completion (`S:src/shared/orchestration-fleet-attention.ts:1-10`); `requiresAction` is true for guidance/input/approval/failure/interruption/unverifiable (`:33-40`). Live values seen: `liveness` exited/unverifiable, `activity` always `unknown` (all workers were finished), `nextAction.kind` none|release.
6. `worker-show --dispatch <id> --json` -> `{dispatch{...camelCase, includes hostScope, lastHeartbeatAt}, worker{state,stage,worktreeId,startOptions{agent,launch.requested/effective{agent,model,effort}},effects,residualResources,lastError}, projection, terminal, observation{status,exactWorker[,agentWait]}, terminalResource}`. `observation.agentWait` names a worker parked on a prompt only a human can answer (evidence hook|prompt-text|title); `null` = looked, none; absent = never looked (`CLI: worker-show --help`). Not present in my live sample (no live worker).
7. `inbox [--limit n] [--terminal h] [--full] --json` -> `result {messages[] = full messages rows, count}`. Source default limit is 20 (`S:.../messages/message-inbox.ts:226` `getInbox(limit = 20)`); it is read-only (no `read` flip).
8. `dispatch-show --task <id> --json` -> `result.dispatch` = dispatch_contexts row, snake_case (includes `launch_token_hash`; do not render).
9. `request-show --request <id>` = read-only idempotency probe; irrelevant to UI.
10. `orca worktree ps [--limit n] --json` -> `result {worktrees[], hostScope{hostIds,omittedHostIds}, totalCount, truncated}`; each worktree: `worktreeId, repo, path, branch, displayName, workspaceStatus, status (active|inactive|working...), liveTerminalCount, unverifiableTerminalCount, lastOutputAt, terminalVerdict, parentWorktreeId, childWorktreeIds, linkedIssue/linkedPR (+Linear/GitLab), agents[] {paneKey, parentPaneKey, state, agentType, prompt, toolName, toolInput, interrupted, lastAssistantMessage, mainAgent{state,stateStartedAt}, stateStartedAt, updatedAt, programStatus}`. Agent `state` enum = working|blocked|waiting|done (`S:src/shared/agent-status-types.ts:51`). Live agent states seen: working, done (7 worktrees, 3 with an agent). Note `prompt`/`toolInput`/`lastAssistantMessage` carry conversation text: treat as sensitive.

Mutating verbs (send, reply, gate-resolve, task-update, worker-*) were not run.

---

## 3. Events, host.call and capabilities

### What a plugin can subscribe to

Closed set of three events (`S:src/shared/plugins/plugin-manifest.ts:63-67` `PLUGIN_EVENT_NAMES`; payload schemas `S:src/shared/plugins/plugin-events.ts`):

| Event | Payload |
|---|---|
| `worktree.created` | `{worktreeId, path, branch}` |
| `worktree.removed` | `{worktreeId, path}` |
| `agent.status.changed` | `{worktreeId|null, paneKey, state (working/blocked/waiting/done), receivedAt, mainAgent?{state, outcome?, stateStartedAt}}` (`plugin-events.ts:28-48`) |

1. There is no orchestration event: no run/task/message/gate/worker event exists in the set. Orchestration state is not pushed to plugins at all.
2. `agent.status.changed` is not emitted for rows restored from a previous session (`S:src/main/plugins/plugin-agent-status-event.ts:16-18`).
3. Events need capability `events:subscribe` plus a `contributes.events` entry (hello-orca sample: `S:examples/plugins/hello-orca/orca-plugin.json`). The installed MatrixKoder manifest already declares all three events and `workspace:read`, `terminal:send`, `notifications:show`, `events:subscribe`, `storage` (`plugin/orca-plugin.json`).
4. The `paneKey` in the event matches `dispatch_contexts.assignee_pane_key` (and `worktree ps agents[].paneKey`) in shape; I did not verify the join end to end (unverified, join on the part after the colon: the DB has indexes on `substr(assignee_pane_key, instr(...,':')+1)`).

### host.call surface (Host API v0, `S:src/shared/plugins/plugin-host-api.ts:122-253`)

| Method | Capability | Panel can call? |
|---|---|---|
| workspace.readContext | workspace:read | yes (returns focused worktree branch, displayName, up to 50 terminal ids) |
| terminal.sendText | terminal:send | yes (explicit terminalId, max 4096 chars) |
| notifications.show | notifications:show | yes |
| storage.get/set/delete/keys | storage | no (worker only); 256 KB/value, 5 MB total, 1024 keys |
| secrets.get/set/delete | secrets | no |
| settings.get/set | settings:own | no |
| events.subscribe | events:subscribe | no |

1. No `orchestration.*` method exists in the host API. File header: "The raw runtime-RPC registry is never exposed" (`plugin-host-api.ts:6-10`). So `host.call` cannot list runs, tasks, messages, gates or workers, and cannot reply to a question or resolve a gate.
2. Capability list is closed: workspace:read, terminal:send, notifications:show, storage, secrets, events:subscribe, settings:own. `process:exec` and `net:fetch` are mentioned as "arrive in later phases" and do not exist yet (`S:src/shared/plugins/plugin-capabilities.ts:10-23`).
3. The only write path to an agent from a plugin is `terminal.sendText` (typing into a terminal). To "answer" a worker `ask` from the panel, the plugin would have to type `orca orchestration reply --id <id> --body ...` into a coordinator terminal; this works in principle with `terminal:send` but is unverified and brittle.
4. The worker is a separate forked Node process with a scrubbed env allowlist (`S:src/main/plugins/plugin-host-process.ts:1`, `plugin-worker-env.ts`). I found no source that blocks `node:fs`, `node:child_process` or `node:sqlite` inside it. Whether a worker may read `orchestration.db` or spawn `orca ... --json` is therefore unverified, and it sits outside the capability/consent model (no capability would be shown to the user). The sandboxed panel iframe can do neither; it only has the three panel actions above (`PLUGIN_PANEL_ACTIONS`, `plugin-host-api.ts:263`). The current MK worker bundle uses only `workspace.readContext` and `notifications.show` (grep of `plugin/out/worker.js`).
5. Reading the DB directly is also fragile: schema is at version 43 with frequent migrations, no stability promise; WAL file must be opened read-only; and table contents include prompts, handles and transcripts (`worker_terminal_archives.content`).

Practical read paths for MK today:

1. In-plugin, supported: `agent.status.changed` + `workspace.readContext` (per-pane live state, no task/run knowledge).
2. Out-of-plugin, supported: the MK orchestrator (the coordinator session) runs the `--json` CLI verbs above and writes a snapshot that MK owns (file or plugin storage via a command).
3. Out-of-plugin, supported: a local service/script (not the plugin worker) polling `orca orchestration ... --json` and `orca worktree ps --json`.
4. Direct DB read: possible for a script (`sqlite3 -readonly`), not recommended; unverified for the plugin worker.

---

## 4. Mapping: MatrixKoder panel screens to Orca data

"Real" = an Orca source exists. Reach = what can get it into the plugin (see section 3).

| Screen | Orca source | Fields | Reach / gap |
|---|---|---|---|
| Projects | `orca worktree ps --json` (repo, worktrees, linkedIssue/PR); `runs` (one per initiative) | `repo, path, branch, displayName, workspaceStatus` ; run `objective` | Orca has no "project" entity above Run (see corrections). MK keeps its own project list; worktree/repo grouping can come from `worktree ps`. Plugin: only `worktree.created/removed` events and `workspace.readContext`. |
| Overview | Counts derived from `runs`, `tasks.status`, `worker-list counts`, `worktree ps totalCount` | task status histogram, active/failed workers | Derived, no single Orca summary object except `worker-list.counts`. Needs CLI/DB; not reachable from host.call. |
| Lanes | `worker-list --run <id> --json` (`projection`, `terminalState`, `resource`, `agentTerminalHandle`), `worker-show` (`startOptions.launch`, `lastHeartbeatAt`), `worktree ps agents[]`, event `agent.status.changed` | lane = dispatch; state = `workerState`/`stage.activity`; model/effort = `worker.startOptions.launch.effective`; worktree = `worker.worktreeId`; heartbeat = `dispatch.lastHeartbeatAt` | Best-covered screen. Live pane state reachable in-plugin via the event; dispatch/task context needs CLI/DB. |
| Plan | `task-list --run <id> --json`: `task_title/display_name/spec/status/deps/parent_id/result/completed_at`; `dispatch_contexts` for attempts/retries | DAG edges = `deps`, subtasks = `parent_id`, wave = convention only | Source exists, but only if the plan was created as Orca tasks. MK plan files (`plan.md`) are not in Orca; the live run used `worker-start --spec` with no deps/parent (DB: 0/16). MK must map its plan tasks to Orca task ids itself. |
| Waiting | (a) pending `question_threads` / `messages type=question` (`payload {taskId,dispatchId,question,options}`); (b) `gate-list --status pending`; (c) `worker-show observation.agentWait` and `projection.attention.categories` in guidance/input/approval; (d) `worktree ps agents[].state` = blocked/waiting; (e) tasks with status `blocked` | question text, options, asker handle, dispatch/task id, created_at | Real source for "waiting decisions". Answering = `reply --id` (question) or `gate-resolve --id` (gate); needs CLI. Plugin could only observe (d) via event. Escalation type exists but has no live sample. |
| Events | `messages` ordered by `sequence` (types worker_done, escalation, question, status, heartbeat, merge_ready, handoff, decision_gate); `deliveries`; `attempt_observation_facts`; plugin events (3 kinds) | `sequence` is a monotonic cursor, `created_at`, `type`, `subject`, `priority`, `payload` | `inbox --json` is the read-only feed (default 20; set `--limit`). Do not use `check` (consuming). Heartbeats are 56% of rows, filter them. No push channel: poll. |
| Bugs | No source. Closest: `worktree ps linkedIssue/linkedPR/linkedLinearIssue/linkedGitLabIssue`; failed dispatches (`worker_dispatches.last_error`, `dispatch_contexts.last_failure`, `termination_reason`) | n/a | "No source, MK must keep its own". Failure rows can be linked in as evidence. |
| Todo | No source. `tasks` are supervised work items, not a personal todo list; `tasks.status = ready/pending` is "waiting to run", not "to do" | n/a | "No source, MK must keep its own" (plugin `storage` capability, 5 MB cap, fits). |

---

## 5. Corrections to earlier note (`.matrixkoder/inbox/research/orca-orchestration-engine.md`)

| # | Earlier claim | Verdict | Evidence |
|---|---|---|---|
| 1 | DB at `~/Library/Application Support/orca/orchestration.db` | Confirmed | file exists, with `-wal`/`-shm` (`find`) |
| 2 | `runs` fields: id, objective, coordinator_handle, coordinator_orca_session_id, created_at | Correct but incomplete | Also `home_database, coordinator_pane_key, consumer_generation, legacy, updated_at` (DB `.schema`). `run_legacy_local` is a placeholder row (`legacy=1`) |
| 3 | Task statuses implied pending/ready/completed | Incomplete | Six: pending, ready, dispatched, completed, failed, blocked (`create-graph-tables-sql.ts:128`). `blocked` only comes from decision gates (`decision-gate-store.ts:82-87`) |
| 4 | Auto-promotion pending -> ready when deps complete; `task-list --ready` | Confirmed | `task-store.ts:211-236`, `listTasks` ready filter `:138`; `CLI: task-list --help` has `--ready`. Caveat: needs `--run` when unbound; failed deps never promote (inferred) |
| 5 | `worker_dispatches` states: starting, ready, failed, succeeded, `exited` | Wrong | There is no `exited` state. Real set has 9: adds start_unknown, stopping, stop_unknown, stopped, abandoned (`create-core-tables-sql.ts:149`). `exited` exists only as a `liveness.verdict` in the worker-list projection |
| 6 | "In-memory & SQLite message bus (zero disk files)" | Partly wrong / unverified | Messages are rows in the SQLite `messages` table (confirmed, 57 live). "In-memory" is unverified. Disk files do exist (db, wal, shm; transcripts archived in `worker_terminal_archives`) |
| 7 | Message types list | Confirmed | `create-core-tables-sql.ts:34` |
| 8 | Message fields id, run_id, from/to, subject, body, type, priority, thread_id, payload, read | Confirmed, incomplete | Also `sequence` (the autoincrement cursor), `delivery_contract`, `delivered_at`, `sender_pane_key`, `pointer_*` |
| 9 | Decision gates hold tasks until coordinator or human approval | Confirmed, with a limit | Gate creation is refused while a supervised worker is active for the task (`decision-gate-store.ts:57-73`); the coordinator never auto-resolves (`coordinator-decision-gates.ts:53`). Worker questions use `ask`/`reply`, not gates |
| 10 | Hierarchy "PROJECT -> RUN -> PHASE/WAVE -> TASK -> SUBTASK" | Overstated | Orca has only Run -> Task, with `parent_id` (subtask) and `deps` (ordering). No Project entity and no Phase/Wave entity in the schema. Those are MK conventions |
| 11 | `ask` / `reply` flow, human can reply | Confirmed | `CLI: ask --help`, `reply` in `orchestration --help`; `question_threads` (2 answered live) |
| 12 | `check --wait --json` blocks with keepalive | Confirmed | `CLI: check --help` (15 s `_keepalive` to stderr). Missing detail: `check` consumes; use `--peek`/`--all` or `inbox` for read-only |
| 13 | Group addresses `@all @idle @codex @worktree:<id>` | Confirmed | `CLI: send --help` (more groups exist: @claude, @opencode, @gemini, @droid, @grok, @cursor) |
| 14 | "Scratchpad / floating workspace" and "bugs become orchestration tasks" | Unverified | `floating-workspace/` exists in app data, but I traced no source tying it to orchestration. No bug-tracking in the orchestration schema |
| 15 | Federation: `orca serve`, `environment add`, `worker-start --on`, `--worktree new-top-level`, `host list` | Confirmed | `CLI: orca serve --help`, `orca environment --help`, `orca host list --help`, `worker-start --help` (also: remote `current`/`new-child` are invalid). No federated rows locally (all federation tables 0) so behaviour is untested here |
| 16 | `orchestration.federation.v1` capability string | Confirmed | `orca status --json` -> `runtime.capabilities` lists `orchestration.federation.v1` and 8 more `orchestration.*` capabilities |
| 17 | (missing) | Gap | The note never mentions plugin limits: events are only worktree.created/removed + agent.status.changed, no orchestration events, no orchestration host.call (section 3). Also missing: `dispatch_contexts`, `deliveries`, `question_threads`, `worker_terminal_resources` |

---

## Commands I ran and failures

All read-only: `orca orchestration {--help, run-list, run-show, run-current, task-list, worker-list, worker-show, gate-list, inbox, dispatch-show} --json`, `orca worktree ps --json`, `orca status --json`, `orca skills get orchestration` (identical to `S:skill-guides/orchestration.md`), `sqlite3 -readonly` schema/counts/group-bys, `git ls-tree/grep/show orca/main`.

1. Shape probe attempt 1 and 2: my own shell quoting passed a multi-word string as one argument, giving `Unknown command: orchestration run-list`. Fixed by word-splitting (attempt 3 worked). Not a tool defect.
2. `task-list` and `gate-list` without `--run`: `No Run is bound. Use orchestration run-create or run-use first. No effects were applied.` Fixed with `--run <id>` (works from an unbound caller).
3. `orca plugin --help`: `Unknown command: plugin` (there is no plugin CLI; expected, not a blocker).
4. Output of several shell commands was auto-compressed by a hook; I wrote results to scratch files and read them whole, so no facts above rely on a compressed view.

Not done, because it would change state or exceed scope: any send/reply/ask/gate/task/worker mutation; reading message bodies; testing whether the plugin worker can exec `orca` or open the DB (unverified).
