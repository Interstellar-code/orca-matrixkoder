# MatrixKoder (Orca plugin) settings: what should exist

Read-only research. Nothing in the repo was changed. Everything marked (inferred) was not read from code or docs.

## 0. Evidence the proposal rests on

1. Only 2 of the ~45 current settings keys are read by any server code: `general.activeRepo` (src/server/snapshot.ts:101) and `routing.maxLanes` (src/server/actions.ts:243, blocks `task.start` with `max_lanes`). The snapshot also echoes `values` to the panel (snapshot.ts:554). Everything else (agents.*, routing.useJev/lowConfidence/tiers/spareClaudeBelowPct, all of safety, all of alerts, theme, shortcuts, general.mode/openOnStart) is stored and shown but has no consumer. `usagePollMin` and `stallMinutes` are not wired: sync.ts hardcodes fast 10 s, slow 60 s, files 30 s (sync.ts:103-113).
2. The plugin has no hook into the agent's tool calls. Capabilities are `workspace:read, terminal:send, notifications:show, events:subscribe, storage` (orca-plugin.json). Upstream enforced Safety through a Claude Code `tool.call` hook (upstream hooks/guards.ts: destructive git, force push, `git branch -D`, sqlite writes, plus a project-banned list from yaml). An Orca plugin cannot do that. So the Safety tab as designed promises enforcement MK cannot deliver.
3. Notifications today: one hardcoded `notifications.show` on `agent.status.changed` -> `done` (src/worker.ts:156-161). The DB already has an `alert_sent` table pruned at 30 days (src/store/maintenance.ts:123), so de-duplicated alerts are the intended design.
4. What the plugin does today: reads Orca (repos, worktrees, runs, tasks, workers, gates, inbox, terminals, `account list` quota) every 10/60 s plus Orca events; 25 dashboard actions (`ACTION_NAMES`, src/server/actions.ts:26): approve, rework, answer, undo, ask.snooze, plan.*, task.start/retry/cancel, inbox.*, bug.*, todo.*, settings.save; a 9-action Orca allowlist (src/orca/actions.ts: run-create, task-create, task-update, worker-start, reply, gate-resolve, terminal send, ...); own SQLite for todo/bugs/plans with 7 daily backups, 30/90-day pruning (hardcoded in maintenance.ts).
5. Quota comes from `orca account list` (sync.ts:714), mapped provider-by-provider in snapshot.ts `settingsBlock`. MK does not poll CodexBar any more (upstream `mk-usage.py` did).
6. docs/research and docs/mockups in this repo are empty (read: no design doc exists here). Only README, CHANGELOG, skills/matrixkoder/SKILL.md, orca-plugin.json, panel/screens/Settings*.dc.html exist.

## 1. Upstream (MatrixKoder at /Users/rohits/Development/matrixkoder): what config it had

1. Files: global `~/.matrixkoder/mk-settings.yaml`, per-project yaml (`matrixkoder.yaml` / `project.yaml`), project DB `settings` rows, plugin `userConfig` (herdr/Claude plugin manifest), retired `config.json`. Precedence: project DB override > global yaml > legacy project.yaml > default. One schema + writer: `scripts/mk-config.py` (`SCHEMA` with `level` global/project and `home` yaml/userConfig).
2. Env vars: `MATRIXKODER_DATA` (data dir), `MK_BUS_URL/TOKEN/TOKEN_FILE`, `MK_CONFIG_SCRIPT/TIMEOUT_MS`, `MK_SELFTEST_JOBS`. Bus and self-test vars die with the Python bus/lane scripts. In this repo only `MK_REPO` and `MK_REPORTED_BY` (the `mk` CLI, skills/matrixkoder/SKILL.md) exist.
3. Upstream schema keys that were real (read from `SCHEMA` in mk-config.py) and what happens to them:

| Upstream key | Orca plugin verdict |
|---|---|
| `repo.lanes.slots` / `reuse` / `copy` | Slots are Orca worktrees now. Drop `reuse` and `slots`; `copy` (files a fresh worktree needs) is an Orca setup hook, link only |
| `repo.integration_branch`, `qa.integration_target` | Orca owns base ref (`orca repo set-base-ref`); MK keeps only "merge target for the final PR" as plan metadata (nice-to-have) |
| `autonomy_contract.builder_skip_permissions` | Survives: decides whether MK launches builders with `--dangerously-skip-permissions` (inferred: `worker-start` has no such flag; this would be an `agent` launch argument). Must verify before building |
| `routing_preferences.policy` (claude-sparing / balanced / quality) | Survives, as the single "routing policy" |
| `routing_preferences.builder_order`, `max_build_lanes` | Survive (`max_build_lanes` is today's `maxLanes`) |
| `routing_preferences.reserve_floor.{claude,others}.{five_hour,weekly}_left_pct` | Survives: this is the user's "spare Claude" rule. Today collapsed to one `spareClaudeBelowPct` |
| `routing_preferences.reviewer`, `visual_reviewer` | Survive: review policy |
| `usage.source`, `usage.providers` | Drop: Orca `account list` is the source |
| `session.fresh_session`, `subagents`, `subagent_model`, `reuse_reviewer`, `reviewer_split`, `todo_done_status` | Survive in part (see Lanes and Work tabs) |
| `session.stall_min` (15), `max_wait_min` (30) | Survive: stall detection and the wait cap on a lane |
| `bus.*` | Drop: Orca messaging replaces the bus |
| `session.selftest_jobs_total`, wizard, tabs visibility | Drop |
| `lanes.default_agent` | Survives as default builder route |

## 2. Orca already owns these (do not duplicate; link only)

Read from `orca --help`, `orca agent launch --help`, `orca worktree create --help`, `orca repo set-base-ref --help`. Orca's own Settings UI (notifications, theme, Chat-UI toggle, keybindings) was NOT inspected, so those rows are inferred.

1. Agents installed/known, accounts and which account is active: `orca account add|list|select|rm`. MK must not own login, key or account choice. MK may only read quota windows.
2. Model ids and effort levels: passed per launch (`--agent --model --effort`); `--effort` needs `--model`. Orca owns the list of valid ids; MK owns only which route to pick.
3. Chat vs terminal launch surface: `agent launch --surface chat|terminal` falls back to "your setting" in Orca (Orca-owned). MK may pass `--surface` per route (nice-to-have).
4. Worktree creation, base ref (`repo set-base-ref`, `worktree create --base-branch`), setup hooks (`--setup run|skip|inherit`), parent lineage, linked issues/PRs. MK passes `--setup` only if the user wants a per-lane override.
5. Projects/repos registry, "show non-Orca worktrees" (`repo set`).
6. Automations (scheduled runs): `orca automations ...`. Not MK.
7. OS notification permission, sounds, app theme (dark/light), keybinding rebinding (inferred, Orca Settings > keyboard). MK's `orca-plugin.json` declares `Mod+Alt+M` and `Mod+Alt+D`; they are manifest-static.
8. Orchestration runs, tasks, workers, gates, messages: all Orca. MK only reads and calls the allowlisted actions.

## 3. The user's rules (CLAUDE.md) that MK is meant to automate, and the setting each implies

1. Jev routing: classify (size trivial/standard/complex/final-review x risk read_only/reversible/destructive), decide route+model+effort. Fallback when Jev is down: trivial = haiku low, standard = sonnet medium, complex/data-loss/security = opus high, final review = fable max. Implies: tier->route table (exists as `routing.tiers`), a route catalog with notes (the dated models.md), and "use Jev" as a policy for the orchestrator (not callable from MK: Jev is an MCP tool in the orchestrator session).
2. Low-confidence rule: read-only/scripted jobs go one tier LOWER, builds/data-loss/security go one tier UP. Exists as `routing.lowConfidence: 'risk-based'`. Implies a 3-value choice.
3. Destructive risk: ask the user first, every time. Implies `askBeforeDestructive` (exists) which MK can honour by creating an Orca gate before `task.start` of a task whose risk is destructive.
4. Hard rules: fable only for final review; data-loss/security review needs opus or higher. Implies per-tier `minTier` guard on reviews.
5. Separate review: author never self-approves; a different subagent or `/code-review`. Implies `review.required`, `review.route`.
6. Builds handed to another agent run in an Orca worktree/terminal, never on main. Implies `lanes.worktreeAlways` (always true, could be a locked row), `lanes.surface=terminal`.
7. Clear a lane agent session at each phase boundary or fix round. Upstream `fresh_session`. Implies `lanes.freshSession` (new/same) and the command per agent (`/clear` for Claude, `/new` for omp).
8. Quota: "spare Claude" uses the real 5h/weekly % left. Implies per-agent floors (upstream reserve_floor).
9. Wait with Orca's own waits, not hand-rolled loops; show model+effort per subagent. Not a setting; a display rule for the Lanes screen.
10. Small tasks stay inline: no lane, no worktree. Implies nothing in MK settings, but a `lanes.autoInlineBelow` is NOT proposed (decision lives in the orchestrator).

## 4. Proposed information architecture

Seven tabs (same count as today, different content). Owner column: MK = stored in `mk-settings.json`; Orca = shown read-only or a deep link, never stored by MK. Priority: M must-have, N nice-to-have, D drop.

### Tab map

| Current tab | Verdict | Reason |
|---|---|---|
| General | Keep, slim, add Data | `mode`/`openOnStart` have no consumer; add data/backup info the user actually needs |
| Agents | Merge into Routing | Agent on/off + default model is part of the route catalog; accounts are Orca-owned |
| Routing | Keep, rename "Routing & Quota", rebuild | The core of the user's workflow; add route catalog, review policy, quota floors |
| (new) Lanes | Add | Supervision of running lanes: the thing MK exists for; currently only `maxLanes` is wired |
| (new) Work items | Add | Bugs, todo, plans/inbox are the features Orca lacks and MK owns; no settings today |
| Safety | Keep, shrink and re-aim | Only what MK can enforce (its own actions, gates, text it sends); drop the rest |
| Alerts | Rename "Notifications", shrink | One real event source exists; drop what Orca owns |
| Theme | Rename "Appearance", shrink | Dashboard-only look; app theme is Orca's |
| Shortcuts | Drop | Keybindings are manifest-static and Orca-owned; `footer: ['improve']` has no consumer |

### Tab 1: General

| Key | Type | Default | Consumer | Owner | Pri |
|---|---|---|---|---|---|
| `general.activeRepo` | string\|null | null | snapshot.ts:101 (scopes the dashboard). Better as UI state, not a setting | MK (value) / Orca (repo list) | M |
| `general.openOnStart` | enum: projects, lanes, waiting, last | last | panel/runtime.js (first screen). Not wired | MK | N |
| `general.mode` (orchestrator/solo) | enum | orchestrator | None found. Upstream "solo" meant no lanes. Inferred meaning | MK | D unless solo mode is defined |
| `data.backupKeep` | int 1-30 | 7 | maintenance.ts:11 (hardcoded `KEEP_BACKUPS`) | MK | N |
| `data.pruneLanesDays` | int | 30 | maintenance.ts:66 (hardcoded) | MK | N |
| `data.pruneEventsDays` | int | 90 | maintenance.ts:53 (hardcoded; which table is inferred) | MK | N |
| data dir path, db size, schema, plugin version, Orca version | read-only | | snapshot meta | Orca/MK status | M (display only) |
| `sync.fastSeconds` / `slowSeconds` | int | 10 / 60 | sync.ts:103-113 (hardcoded). Advanced section | MK | N |
| `usagePollMin` | int | 5 | none; replace by `sync.slowSeconds` | | D |
| Buttons: Export settings JSON, Reset to defaults, Open data folder | action | | `settings.save` + new reset | MK | N |

### Tab 2: Routing & Quota (absorbs Agents)

Section A, agents (MK picks among what Orca has):

| Key | Type | Default | Consumer | Owner | Pri |
|---|---|---|---|---|---|
| `agents.<id>.routable` | bool | true | route resolver (does not exist yet; `task.start` reads route text from the plan, actions.ts:243-250) | MK | M |
| `agents.<id>.defaultModel` / `defaultEffort` | string/enum | claude: sonnet/medium | `worker-start --model --effort` when the plan route omits them (actions.ts:~242) | MK | M |
| agent installed/CLI path/version, account in use, accounts list | read-only | | `agent_cli` table; `orca account list` | Orca (link) | M display |
| `agents.<id>.surface` chat/terminal/orca-default | enum | orca-default | `agent launch --surface` | MK | N |
| Add/remove account, login, API keys | | | | Orca | link only |

Section B, route catalog (new). Mirrors the user's dated `models.md`; a route is the unit Jev picks.

| Key | Type | Default | Consumer | Owner | Pri |
|---|---|---|---|---|---|
| `routing.catalog[]` = `{id, agent, model, effort, note, enabled}` | list | the CLAUDE.md routes: claude haiku low, sonnet medium, opus high, fable max, codex gpt-6.1-sol high, agy gemini-3.8-flash-high, etc. | Route picker in the task.start dialog; export block for Jev `candidates` | MK | M |
| `routing.policy` | enum claude-sparing / balanced / quality | claude-sparing | route resolver / suggestion order | MK | M |
| `routing.builderOrder` | string[] | [codex, agy, opencode, claude] | order of suggestions per phase | MK | N |

Section C, tier fallback (replaces `routing.tiers`; keep values but make them route ids):

| Key | Type | Default | Consumer | Owner | Pri |
|---|---|---|---|---|---|
| `routing.tiers.trivial/standard/complex/finalReview` | route id | haiku low / sonnet medium / opus high / fable max | fallback when a plan phase says `tier:standard` instead of a route (new resolver) | MK | M |
| `routing.lowConfidence` | enum risk-based / lower / higher | risk-based | resolver: read-only lowers one tier, build/data-loss/security raises one | MK | M (documented rule, today unused) |
| `routing.useJev` | bool | true | Cannot be consumed by MK (Jev lives in the orchestrator session). Use only as text emitted into skills/briefs | MK | D as a toggle; keep as read-only note "Jev is the orchestrator's job" |
| `routing.maxLanes` | int 1-6 | 3 | actions.ts:243 (wired) | MK | M |

Section D, quota guard (replaces `spareClaudeBelowPct`):

| Key | Type | Default | Consumer | Owner | Pri |
|---|---|---|---|---|---|
| `quota.floor.claude.fiveHourPct` | int | 40 | `task.start` refuses/warns when `quota` row for provider claude shows less left (upstream default 40) | MK | M |
| `quota.floor.claude.weeklyPct` | int | 30 | same | MK | M |
| `quota.floor.others.fiveHourPct` / `weeklyPct` | int | 10 / 15 | same | MK | N |
| `quota.onBelowFloor` | enum warn / block / reroute | warn | action result in `task.start` | MK | M |
| `quota.windows` labels, reset times | read-only | | `quota` table (Orca `account list`) | Orca | M display |

Section E, review policy (new):

| Key | Type | Default | Consumer | Owner | Pri |
|---|---|---|---|---|---|
| `review.required` | bool | true | `approve` action requires a recorded separate review route before marking done | MK | M |
| `review.route` | route id | sonnet medium (CLAUDE.md fallback) | proposed reviewer on task finish | MK | M |
| `review.riskRoute` | route id | opus high | used when task risk is data-loss/security | MK | M |
| `review.finalRoute` | route id | fable max | final review of a plan | MK | M |
| `review.visualRoute` | route id | haiku | UI review | MK | N |
| `review.differentFamily` | bool | false | warn when reviewer = builder family | MK | N |

### Tab 3: Lanes (new; supervision)

| Key | Type | Default | Consumer | Owner | Pri |
|---|---|---|---|---|---|
| `lanes.stallMinutes` | int 5-60 | 15 (upstream; today 10, unwired) | sync.ts derives `stalled` from lane.last_activity; feeds Notifications | MK | M |
| `lanes.maxWaitMinutes` | int | 30 | cap before a waiting worker is flagged/cancelled | MK | N |
| `lanes.freshSession` | enum new / same | new | text sent via `terminal send` at phase boundary (`/clear`, `/new`) | MK | M |
| `lanes.clearCommand.<agent>` | string | claude `/clear`, omp `/new`, codex `/new` (inferred for codex) | `terminal send` | MK | N |
| `lanes.reuseReviewer` | bool | true | review session reuse | MK | N |
| `lanes.defaultAgent` | agent id | claude (upstream: omp) | `task.start` when no route | MK | M |
| `lanes.setupPolicy` | enum run / skip / inherit | inherit | `worker-start --setup` (already in the allowlist flags) | MK (Orca default underneath) | N |
| `lanes.subagents` / `subagentModel` | bool / route | true / orchestrator default | text in worker prompts | MK | D (CLAUDE.md says builders use their own default; not an MK knob) |
| `lanes.builderSkipPermissions` | bool | true | builder launch args (inferred; not verified that `worker-start` can pass it) | MK | N, verify first |
| base branch, worktree names, parent lineage | | | | Orca | link only |
| Surface: worktree-only ("never on main") | locked row | true | `task.start` refuses a lane on a protected branch | MK | M (enforced) |

### Tab 4: Work items (new; features Orca lacks)

| Key | Type | Default | Consumer | Owner | Pri |
|---|---|---|---|---|---|
| `bugs.fixRoute` | route id | sonnet medium | `mk bug fix` -> `task-create` + `worker-start` | MK | M |
| `bugs.defaultRisk` | int 1-5 | 3 | `mk bug add --risk` default | MK | N |
| `bugs.autoStartFix` | bool | false | start a lane when a bug is filed | MK | N (risky; default off) |
| `todo.doneStatus` | enum verify / done | verify | `todo.done`, `todo.makeTask` (upstream `todo_done_status`) | MK | M |
| `plans.inboxDir` | string | `<repo>/.matrixkoder/inbox` | import.ts `scanInbox` | MK | M |
| `plans.scanSeconds` | int | 30 | sync.ts filesMs | MK | N |
| `plans.autoImport` | bool | false | `inbox.import` on new file | MK | N |
| `plans.defaultRoute` | route id | per phase | `plan.start` | MK | N |
| `plans.parkOnGateFail` | bool | false | `plan.park` automation | MK | D (speculative) |
| `mk` CLI reporter name, repo detection | env | | `MK_REPORTED_BY`, `MK_REPO` | MK (env) | display only |

### Tab 5: Safety (shrunk and honest)

MK cannot intercept an agent's tool calls. Keep only rules MK can enforce on what MK itself does, or can hand to the agent as text. Each row should say "enforced by MK" or "advisory: written into briefs and the skill".

| Key | Type | Default | Consumer | Owner | Pri |
|---|---|---|---|---|---|
| `safety.askBeforeDestructive` | bool | true | `task.start` for risk=destructive creates a gate first; routing.askBeforeDestructive moves here | MK (enforced) | M |
| `safety.askBeforeMerge` | bool | true | `plan.markMerged`, `approve` confirm | MK (enforced) | M |
| `safety.askBeforePush` | bool | true | advisory text in briefs (MK never pushes) | MK (advisory) | N |
| `safety.protectedBranches` | string[] | [main, release/*] | `task.start` refuses to run a lane whose worktree branch matches (needs worktree branch from Orca snapshot) | MK (enforced) | M |
| `safety.neverRun` | string[] | existing defaults | (a) refuse text MK sends via `terminal send`; (b) written into worker briefs/skill. Not a sandbox | MK (advisory + own-sends) | N |
| `safety.blockDestructiveGit`, `blockDeleteOutsideWorktree`, `scanDiffsForSecrets` | bool | true | No consumer and no way to enforce. Fold into `neverRun` text or drop | | D |
| Orca action allowlist (never `orchestration check`) | locked info | | src/orca/actions.ts | MK code | display only |

### Tab 6: Notifications (was Alerts)

| Key | Type | Default | Consumer | Owner | Pri |
|---|---|---|---|---|---|
| `notify.events.ask` / `laneDone` / `gateFail` / `runDone` / `stall` / `quotaLow` | bool each | ask, laneDone, gateFail, runDone on; stall, quotaLow off | worker.ts event handler (today fixed to laneDone only) + sync diff; de-dupe in `alert_sent` | MK | M |
| `notify.quietHours` `{enabled, from, to}` | obj | off, 22:00-07:00 | suppress all but `ask` | MK | N |
| `notify.wakeOrchestrator` | bool | false | on `ask`, `terminal send` to the coordinator terminal (upstream `mk-wake.py`). Matches the user's "orchestrator waits" workflow | MK | N |
| `notify.wakeTerminal` | terminal selector | auto | target of the wake message | MK | N |
| `notify.quotaLowPct` | int | = quota floor | threshold for `quotaLow` | MK | N |
| `desktop` (OS toast on/off) | bool | | OS permission and sounds are Orca's; MK just calls `notifications.show` | Orca | D (link) |
| `dashboard.autoOpen/chip/toasts` | bool | | in-panel only; move `toasts`/`chip` to Appearance if wanted | MK | D |

### Tab 7: Appearance (was Theme)

| Key | Type | Default | Consumer | Owner | Pri |
|---|---|---|---|---|---|
| `look.rain.enabled` / `brightness` / `speed` | bool/int/enum | true / 60 / normal | panel CSS (inferred: nothing in runtime.js reads settings today) | MK | N |
| `look.reduceMotion` | bool | follow OS | disables rain/animation | MK | M (accessibility) |
| `look.textSize` | S/M/L | M | panel CSS | MK | N |
| `look.density` | compact/comfy | comfy | panel CSS | MK | N |
| App light/dark theme | | | Orca | Orca | link only |

## 5. Biggest changes (summary)

1. Merge Agents into Routing; rebuild Routing around a route catalog, tier fallback, review policy and 4 quota floors (the user's actual Jev/quota rules).
2. Add Lanes tab (stall minutes, fresh session at phase boundary, default agent, protected branch refusal) and Work items tab (bug fix route, todo done status, inbox dir).
3. Safety shrinks to rules MK can enforce (gate before destructive, before merge, protected branches); the git/secret scanners are dropped because the plugin has no tool-call hook.
4. Alerts becomes Notifications with per-event toggles actually wired (only laneDone fires today); OS toast/sounds are Orca's.
5. Drop Shortcuts, `general.mode`, `routing.useJev` (as a toggle), `usagePollMin`, `dashboard.*`, `desktop`.

## 6. Things inferred or unverified

1. Orca's own Settings (notifications, theme, keybindings, Chat UI) not inspected; Orca-owned rows for those are inferred from `agent launch --help` ("your setting") and general knowledge.
2. Whether `worker-start` can launch a builder with permissions skipped is unverified (`builderSkipPermissions`).
3. Codex `/new` clear command, `general.mode` meaning, which table the 90-day prune applies to (maintenance.ts:53), and that no panel code reads `theme.*` (I found no hit in runtime.js, but the `.dc.html` screens were not read in full) are inferred.
4. Upstream defaults (stall 15, floors 40/30/10/15, wait 30) are read from upstream mk-config.py; whether they match the current user preference is not confirmed. Current repo defaults differ (stall 10, spare 30).
5. The resolver for `tier:` routes and the quota-floor check do not exist yet; every "consumer" marked new needs code.
