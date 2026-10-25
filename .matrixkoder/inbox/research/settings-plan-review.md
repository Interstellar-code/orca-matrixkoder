# Review of .matrixkoder/inbox/mk-settings-v2.md

Verdict: CHANGES. The block 4 line references are mostly right, but several C1 keys have no real consumer, three USE tasks assume code that does not exist, and the migration can brick `loadSettings`. Read-only review; no repo file was touched.

## Block 4 claim check (item 1)

True:
- `actions.ts:243` reads `routing.maxLanes`.
- `snapshot.ts:101` reads `general.activeRepo`; `snapshot.ts:89` is where the file is loaded and passed to the panel.
- `sync.ts:111-113` has the three hardcoded intervals: 10_000, 60_000, 30_000.
- `maintenance.ts:10-11` has `KEEP_BACKUPS = 7`, and the prune ages are hardcoded.
- Capabilities match `orca-plugin.json`: workspace:read, terminal:send, notifications:show, events:subscribe, storage.
- `ACTION_NAMES` lives at `src/server/actions.ts:26-34`. There is a second, unrelated `ACTION_NAMES` in `src/orca/actions.ts:83`.
- The allowlist in `src/orca/actions.ts` has no `gate-create`. It has `gate-resolve`, `terminal send`, and `worker-start` with `--setup`.
- `alert_sent` exists at `schema-v1.ts:474`.

Off or wrong:
- `worker.ts:156-161`: the `done` check starts at line 157. This is a nit.
- "Only consumer is": true for `src/`. Also note the `mk` CLI child process, which never reads settings today.
- `alert_sent` has one primary key column, `key`, not "event + key". It is `'ask:<id>'`, `'laneDone:<dispatch>'`, `'quiet:<lane_key>:<heartbeat>'`. Nothing writes to it today.
- The quota table (`schema-v1.ts:194`) has `win IN ('session','weekly','monthly')` and `used_percent`. It does not hold "remaining". Provider keys are `claude, codex, gemini, opencodeGo, antigravity`. For codex, `session` is null plus an error. A3 is partly false.
- `lane` has `last_heartbeat_at`, not `last_activity`. C8 names a column that does not exist.
- `actions.ts ~236-241` (route splitting) exists only in `task.start`. `bug.fix` is `this.cli(['bug','fix',...])` and runs `src/store/cli.ts bugFix` in `cli-child`, which only creates an Orca task. It starts no worker and has no route.

## Findings

1. MAJOR. `bugs.fixRoute` and the C7 quota guard "in `bug.fix`" cannot be consumed as written.
   - Evidence: `src/store/cli.ts:235-283` `bugFix` calls `run-create` and `task-create` and then sets status `fixing`. There is no `worker-start`, so no agent, model or effort. USE.1 and USE.4 say `bug.fix` uses `resolveRoute` and `bugs.fixRoute`.
   - Fix: either add an explicit task, "bug.fix starts a worker using `bugs.fixRoute`" with an owner and a test, or drop `bugs.fixRoute` and the `bug.fix` quota guard. Pick the first only if auto-starting a fixer is wanted. It is a new behaviour.

2. MAJOR. `todo.doneStatus` (verify|done) has no backing meaning.
   - Evidence: the `todo` table (`schema-v1.ts:410`) has `done INTEGER` and `done_at` only. There is no verify state.
   - Fix: drop the key, or add a schema change with its own task. A settings plan should not invent a todo state.

3. MAJOR. `safety.protectedBranches` can never fire.
   - Evidence: `taskStart` always passes `worktree: 'new-child'` (`actions.ts:254`) and no `base-branch`. The branch is created by Orca after the call, so MK has no "target worktree branch" to match.
   - Fix: check against `--base-branch` (and pass the plan's base branch), or label the key advisory. Otherwise it is a new dead guard.

4. MAJOR. C9 "task with risk `destructive`" has no definition.
   - Evidence: `plan_task.risk` is an INTEGER 1-5 (`schema-v1.ts:296`); `grep destructive src` finds nothing.
   - Fix: define the trigger (for example risk >= 4), or key it to `size`.
   - Related: the gate path (`gate-create`) does exist in Orca (`orca orchestration gate-create --task --question [--options] [--from]`), so A2 is answerable now. But the plan never says who restarts the task after the gate is resolved. A gate created by MK appears as an ask, and `approve` resolves it, but nothing re-calls `task.start`. It may also need a bound terminal, and the `callOrca` fallback covers only `gate-resolve` and `reply` (`orca-call.ts:27`).
   - Fix: choose `needs_confirm` now and drop the gate branch and its allowlist change. That removes A2 and shrinks risk-4 USE.3.

5. MAJOR. "Confirm before merge" is aimed at the wrong actions.
   - Evidence: `approve` is `decisions.create(askId,'approve')`, which answers an agent's gate or ask (`actions.ts:102`), not a merge. `plan.markMerged` (`actions.ts:171`) only updates MK's own columns. It runs no git. Requiring `confirm:true` on `approve` would block every routine ask approval.
   - Fix: apply it to `plan.markMerged` only, and say the label "confirm before merge" means "confirm marking merged". Alternatively drop the key.

6. MAJOR. Routing keys with no real input or consumer. This breaks G2 and the T8 promise.
   - `routing.lowConfidence`, and the `confidence` input of `resolveRoute`: nothing in MK produces a confidence value. Jev runs in the orchestrator, as the plan itself says in "What is wrong" item 6.
   - `routing.policy`: no rule in C6 uses it.
   - `review.route`, `review.riskRoute`, `review.finalRoute`: C6 says "review proposals", but no task builds them.
   - `routing.tiers`: used only when route text is `tier:<name>`, which no plan emits. Plans carry explicit `route = "claude sonnet medium"` and a separate `size` (trivial|standard|complex), which `plan_task.size` stores.
   - `lanes.maxWaitMinutes`: no USE task reads it.
   - Fix: keep the tiers, but map `plan_task.size` to a tier when `route` is empty. Delete `lowConfidence`, `policy` and `review.*`, or move them to a "later" list. Name a reader for `maxWaitMinutes` or remove it. Without these changes, T8 will either fail or be satisfied only through the display-only exemption list.

7. MAJOR. `lanes.freshSession` and `lanes.clearCommand.*` have no consumer in MK's model.
   - Evidence: MK never reuses a terminal. `worker-start` is called with `--worktree new-child --agent` (`actions.ts:254`), which creates a fresh agent terminal each time. No code anywhere knows a "phase boundary" (grep for `phase boundary`, `/clear`, `clearCommand` returns nothing in `src`). A finished worker's terminal may already be released.
   - Fix: say what the trigger is. For example, plan_phase becomes complete in sync and the lane is still live. Then say what happens if no live terminal exists. Or drop both keys. The honest option is drop: a fresh session is already the default.

8. MAJOR. Migration can make `loadSettings` throw and brick the panel.
   - v1 values that fail the v2 validators and are never clamped or normalized in C3:
     - `agents.*.effort` accepted `''` and `'xhigh'` in v1 (`settings.ts:101`). v2 is low|medium|high|max.
     - `general.openOnStart` was a free string (max 40). The Settings screen's own fallback literal is `'Projects'`. v2 is a lowercase enum.
     - `alerts.stallMinutes` was 1-1440; v2 `lanes.stallMinutes` is 5-120.
     - `safety.protectedBranches` was max 50 items and `neverRun` max 100; v2 is 20 and 40.
     - `routing.tiers.*` text that matches no catalog id: the plan says "added as a new catalog entry" but the catalog is capped at 24.
   - Also, `saveSettings` writes the whole merged object, so any v1 file that was ever saved contains every default. The migration cannot tell "user changed" from "default", which freezes v1 defaults over v2 defaults (for example `agents.claude.model "sonnet 5.5"`).
   - Fix: add a normalization table to C3 (clamp ints, lower-case enums, map unknown to the default, truncate lists, report each change in the .bak file). Add a T2 case for each.

9. MAJOR. `loadSettings` is documented as never writing, and C3 makes it write.
   - Evidence: `settings.ts:5-6` "reading never writes"; `snapshot.ts:89` calls it on every refresh; the `mk` CLI child and the server are separate processes.
   - Risk: two processes can race on the first migration, and any existing "reading never writes" test breaks.
   - Fix: migrate in memory on read and keep the file as v1 until the first `settings.save` (v1 stays on disk, which also makes rollback safe), or move the write into one explicit startup step in the server with a lock/`rename` guard.

10. MAJOR. USE owns too little and SCREENS/SCHEMA own files that clash with tracked build output.
    - USE.4 edits `src/store/cli.ts` (`bugs.defaultRisk` at `cli.ts:182`, `todo done`), and `src/store/cli.ts` is in no `owned` list.
    - `out/` (28 tracked files, including `out/server/*`) and `web/index.html` (tracked; contains the inlined `MK_SCREENS`, including the Agents/Shortcuts templates at lines 915 and 1237) are rebuilt by every `npm run build` gate. The previous plan owned `web/` and `test/panel/`; this one omits both. Two lanes that both rebuild `out/` will conflict on merge.
    - `test/panel/screens.test.mjs` asserts all 16 screens including `SettingsAgents` and `SettingsShortcuts` (lines 35-40, 314-319); it is not owned. Once lane B removes the screens, `npm test` at SHIP fails and SHIP owns no code.
    - Fix: add `src/store/cli.ts` to USE; add `web/` and `test/panel/screens.test.mjs` (and `test/fixtures/build-snapshot.mjs`) to SCREENS; state that `out/` is committed only by the lane that merges last or by SHIP.

11. MAJOR. Appearance (`look.*`) and `general.openOnStart` have no implementing owner.
    - Rain lives in each screen and in `Main.dc.html` (`MK_RAIN`); density and text size need CSS across all screens. SCREENS owns only `Settings*.dc.html` and `panel/runtime.js`. `general.openOnStart` default changes to `last`, which needs the last tab stored somewhere (kv or localStorage). USE.4 lists it as an allowed panel reader, but no task makes the panel read it.
    - Fix: put the global application of `look.*` and `openOnStart` into `runtime.js` (a body class and CSS variables), and own it in SCREENS.3. Add an `openOnStart` task.

12. MAJOR. `data.pruneLanesDays` and `data.pruneEventsDays` do not match the prune code.
    - Evidence: lanes are pruned at 30 days, but so are worktree, run, ask, repo, check_result and alert_sent. `event_log` is pruned by count (5000), not age (`maintenance.ts:49`). The 90-day rule is `decision_log` (line 53). Pane is 7 days.
    - Fix: name exactly which rules each key drives. Rename `pruneEventsDays` if it controls `decision_log`, or add an age rule for `event_log`.

13. MINOR. The notifier cannot call `notifications.show` today.
    - Evidence: `ServerCtx` (`common.ts:48-61`) holds db, dir, runner, cliOrca, clock, undoMs, requestSync and log. `host.call('notifications.show')` exists only in `worker.ts:158`. A4 "the worker can call it" is true, but `src/server/notify.ts` has no handle to it.
    - Fix: say that USE.2 adds a `show(title, body)` function to `ServerCtx`, wired from `worker.ts` through the keeper. Also add `src/server/common.ts` and `src/server/index.ts` as touched files. They are already under `src/server/`.

14. MINOR. Quota guard semantics are unspecified.
    - Evidence: the table stores `used_percent`, the floors are "percent left"; provider keys are `opencodeGo` and `antigravity`, MK agent ids are `opencode` and `agy`; `others` is not a provider.
    - Fix: state the rule `left = 100 - used_percent`, give the agent-to-provider map, and say what happens when a window is null (A3 only half covers this).

15. MINOR. `alerts.usagePollMin` is dropped, but it maps onto a kept concept.
    - Evidence: quota is pulled in `pullSlow` (`sync.ts:714`, 60 s). `usagePollMin` 1-120 min is the same cadence as `sync.slowSeconds` 30-900 s. Dropping it loses a user value that still exists, which contradicts G4.
    - Fix: map to `sync.slowSeconds = clamp(usagePollMin*60, 30, 900)`.

16. MINOR. `safety.askBeforePush` handling is muddled and the "written into briefs" label has no implementation.
    - Evidence: C3 lists it under mappings ("kept as advisory text in `safety.neverRun`-adjacent brief text (dropped as a key)"), but it is not in the Dropped list, so it is not copied to the .bak file and the value is lost. C1 has no key or text field to hold it. Briefs are built in `taskSpec` (`actions.ts:193`); no USE task adds safety text there.
    - Fix: either add a USE task that appends the advisory lines (protected branches, never-run, no push without asking) to `taskSpec`, or drop the "advisory: written into briefs" label and the `askBeforePush` text. List `askBeforePush` in the Dropped keys.

17. MINOR. The `terminal send` / `neverRun` guard has almost no effect and some risk.
    - Evidence: MK's only `terminal send` calls are the `gate-resolve`/`reply` fallback (`orca-call.ts:54`) and the new wake notice. The `reply` text is a user answer; a user typing "yes, npm publish" in an answer would be refused. The check is placed in `src/orca/actions.ts`, which is a pure argv builder with no settings access.
    - Fix: put the check in `callOrca`/the server layer, apply it only to the wake notice, and say the Safety tab shows `neverRun` as "advisory" unless the briefs task (finding 16) is done. Or drop it from v2.

18. MINOR. T8's grep approach is unsound.
    - Evidence: code reads keys as `settings.sync?.fastSeconds`, destructured, or dynamically (`notify.events[event]`, `agents[id].routable`). Leaf names such as `enabled`, `model`, `effort`, `routable`, `speed` match unrelated code; comments and strings also match. Event names like `laneDone` appear as call arguments, so they pass trivially. The dotted path never appears in source.
    - Fix: route every backend read through one accessor `setting('sync.fastSeconds')`, and have T8 grep the literal dotted-path arguments of that accessor in `src/`, outside `settings.ts`. Add a runtime check: wrap the loaded settings in a Proxy in T4-T7 and assert each non-display-only key was read.

19. MINOR. Restarting timers after `settings.save` re-runs a full pull.
    - Evidence: `Sync.start()` calls `stop()`, recreates the intervals, then `guard(this.pullAll())` (`sync.ts:114`). Every save of any key would trigger a full pull. `index.ts:101` also omits `filesMs`.
    - Fix: add `Sync.setIntervals()` (or a `start({ immediate:false })`), call it only when a `sync.*` or `plans.scanSeconds` key changed, and pass `filesMs`.

20. MINOR. Conflict with the earlier pick Q5.
    - Evidence: `orca-dashboard-wiring.md:565` Q5 is closed `[x]` with pick "keep, labelled advisory". The new plan reverses it in its own Q1 (still open `[ ]`) and builds on the reversal.
    - Fix: get the user's explicit yes on Q1 before dispatch. Mark Q1 as "overrides Q5 of the earlier plan" and change `blocks: SCHEMA.1` to also include SCREENS. The user's "stick to plan, no deviations" rule makes this matter.

21. MINOR. Over-scope for the stated goal.
    - The goal is tabs that fit MK and a backend that consumes each setting. The following add subsystems that nothing asked for: a 24-entry editable route catalog with add/edit/enable, `routing.policy`, `lowConfidence`, three `review.*` routes with Claude-family hard validation (that is the user's private Jev rule, not an MK concept), `settings.export`/`import`/`reset`, quiet hours, `lanes.setupPolicy`, `lanes.defaultAgent`. C2 also says model ids are copied from `~/.claude/skills/jev/reference/models.md`, a private file, into a public marketplace plugin.
    - Fix: for v2 keep the catalog read-only seeded (or a plain list of routes), keep the tier keys, and cut the items above. Put them in a follow-up plan. Do not read a private path at build time; hardcode and date the seed list.

22. MINOR. Acceptance criteria that are vague or untestable.
    - SCHEMA.1 "describeSettings() returns C4 entries for every key": no checker is named for `enforced` or `owner` correctness. Say how a test knows which keys are `enforced: mk`.
    - SCREENS.2 "no hardcoded state or range remains": T9 as written does not name how that is asserted. Specify a lint-style check (no numeric `min`/`max` attributes in the new screens).
    - USE.4 "restart their timers after settings.save": T7 is described as "reads its key"; add a case that saves a new `sync.fastSeconds` and sees a new interval via a fake clock.
    - SHIP.1 "checklist run on the live machine with results recorded" cannot be run by an agent; it belongs under "What's yours" for the user, and `route = "orchestrator"` should note that.

23. NIT. `lane` ownership overlap: `src/server/` (USE) contains `actions.ts` and `snapshot.ts` (SCHEMA). They are in the same lane A, so the order is safe, but `test/store/` (SCHEMA) contains `no-dead-settings.test.mjs` (USE) and `test/server/` (USE) contains `actions.test.mjs` (SCHEMA). Listing exact files in both avoids a reviewer flagging it. SCHEMA also owns two research `.md` files, which are inputs, not outputs.

24. NIT. The v1 `agents` default had 4 agents; C1 adds `omp` and says "unknown ids kept". Say whether the Routing screen lists `omp` when Orca reports no installed `omp` (snapshot agents list).

25. NIT. Possible missing setting: `undoMs` (Undo window for Approve/Answer, 10 s, `index.ts:83`) and the ask snooze default (60 min, `actions.ts:134`) are hardcoded and are natural Work-items/General settings. Mention only; not required.

## Feasibility summary (item 2)

- C9 gate creation: `orca orchestration gate-create` exists (`--task`, `--question`, `--options`, `--from`). Feasible to add to the allowlist, but the lifecycle after resolution is undefined (finding 4). Recommend `needs_confirm`.
- C8 `wakeOrchestrator`: feasible. `run.coordinator_handle` is stored (`schema-v1.ts:113`, `sync.ts:388`) and `coordinatorHandle(c, runId)` already exists (`orca-call.ts:36`). Pick the run from `ask.run_id`. The handle can be null; log and skip.
- `lanes.freshSession`: not feasible as specified (finding 7).
- USE.4 timer restart: feasible via `Sync.start()` (it begins with `stop()`), with the side effect in finding 19.
- Stall notification: feasible with `lane.last_heartbeat_at`; the existing `alert_sent` key shape `'quiet:<lane_key>:<heartbeat>'` fits.

## Order and lanes (item 4)

- Dependencies are sound: SCHEMA, then USE (lane A); SCREENS needs only SCHEMA. File overlap between lane A (`src/`, `test/server`, `test/store`) and lane B (`panel/`, `scripts/`, `test/panel`) is nil, except for the unowned shared files in finding 10 (`out/`, `web/index.html`, `test/panel/screens.test.mjs`).
- USE.3 depends on USE.1 (route), and USE.4 on USE.1-3: fine. USE.1 and USE.2 in parallel inside one lane both edit `src/server/actions.ts` (`task.start`) and `sync.ts`/`worker.ts`; run them sequentially or name the files per task.

## Tools

`codegraph explore` was run once (it returned 71 symbols for `resolveRoute taskStart`; none of them exist yet, which is expected) and everything else was read with shell reads and `orca orchestration --help`. No tool failed. No repo file was edited.
