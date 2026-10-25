**[REJECT]**

**Justification**: The second draft fixes most of the first review's MAJOR findings. Those fixes are: no bug.fix route, no todo state, advisory protected branches, `needs_confirm` instead of gates, an in-memory non-throwing migration, an owner for Appearance, and SHIP owning `out/` and `web/`. Five problems remain where a sonnet builder working from one pasted task would have to guess, or would build something that fails its own gate:
1. The T8 dead-key check cannot pass in lane A as written.
2. SCREENS.3 wires a Start button that does not exist.
3. Two notification events have no data source.
4. The migration map leaves out `routing.maxLanes`, the one setting that works today.
5. The SCREENS parallel tasks overlap on files, and the panel test harness they need is in no `owned` list.

Each fix is a few lines of plan text. No issue is a redesign.

**Summary**:
- Clarity: good overall; C1-C7 are precise. Gaps: gateFail/runDone triggers, the meaning of "section" in reset, and which prune rules `data.goneDays` drives.
- Verifiability: T1-T7 and T9-T10 are concrete. T8 is unsound: its static half cannot see dynamic keys, and it depends on lane B files. The needs_confirm panel flow and the `task.start` wiring of routes.ts have no test.
- Completeness: C2 leaves out `routing.maxLanes`. `dev-snapshot-server.mjs` and the real fixture files are unowned. The SCHEMA.3 ServerCtx stub needs `common.ts`/`index.ts`, which SCHEMA does not own.
- Big Picture: fits the goal and the plugin's real APIs. Two exceptions: `task.start` has no panel caller, so the "enforced by MK" confirm is just the caller resending; and `openOnStart: last` in panel storage cannot survive an Orca restart (random port).

## Reference check (all verified against the current files)

- `actions.ts:193` taskSpec ✓; `:243` maxLanes read ✓; `:254` `worktree: 'new-child'` ✓; `:134` snooze 60 ✓. `:236-241`: route splitting is lines 237-241 (236 is the closing `}` of the status check). NIT.
- `snapshot.ts:101` activeRepo ✓ (loaded at :89; the settings block is at :549-570).
- `sync.ts:111-113` the three `every()` timers ✓; `start()` ends with `guard(this.pullAll())` at :114 ✓.
- `maintenance.ts:11` KEEP_BACKUPS ✓, :49 event_log 5000 ✓, :53 decision_log 90 d ✓, :66 lane 30 d ✓, :69 `gone = 30 d` ✓.
- `worker.ts:156-161`: the done branch is lines 157-162. NIT.
- `index.ts:83` `undoMs ?? 10_000` ✓; `index.ts:101` start omits `filesMs` ✓ (USE.4 covers it).
- `orca-call.ts:36` `coordinatorHandle` ✓; `terminal send` through `runAction` exists at :54 ✓.
- Schema tables ✓: `quota(provider, win session|weekly|monthly, used_percent)`; `alert_sent(key)`; `lane.last_heartbeat_at`; `plan_task.risk` int; `todo.done`.
- First-review MAJOR fixes: #1-#9, #11 and #12 are resolved. #10 is partly resolved (see Critical 5). #11 is resolved, but see MAJOR 6.

## Critical improvements

### 1. T8 cannot pass where it runs (USE.4, lane A); its static half is unsound for dynamic keys
- Lane A has no `bind(` anywhere in `panel/`, because SCREENS.1 creates the helper in lane B. The `look.*` keys (6) and `general.openOnStart` are only "panel-read", so T8's literal `bind('<key>')` clause fails at USE.4's `npm test` gate unless lane B merged first. The plan sets no merge order between the lanes.
- Several C1 families are read by computed path in any natural implementation, so a literal `setting(…, '<key>')` can never appear for them:
  - `routing.bySize[plan_task.size]` (C5)
  - `agents.<id>.*` (C5); "wildcard expanded" means the literal `agents.claude.routable` would have to appear in the source
  - `quota.floor.<claude|others>.<win>Pct` (C5/C6)
  - `notify.events.<event>` (C6, `notify(event, …)`)

  That is about 25 keys. A builder will either write contorted literal lookups or weaken the test.
- Fix:
  1. Split T8. The static grep accepts a declared prefix list (`agents.*.`, `routing.bySize.`, `quota.floor.`, `notify.events.`), matched as template-literal prefixes. The Proxy run through T4-T7 must record every concrete key in those families.
  2. Move the panel half (`look.*`, `general.openOnStart`) out of USE.4 into a SCREENS test (T9/T10), or into SHIP.1's `npm test` on main after both merges.
  3. State that USE.4's T8 checks only backend keys.

### 2. SCREENS.3 "the task Start button handles needs_confirm": no such button exists
- Evidence: no panel screen calls `task.start`. The only task action in the panel is `action('task.retry')` at `panel/screens/Plan.dc.html:263`, and `taskRetry` (`actions.ts:263-272`) only re-creates the Orca task; it never calls `taskStart`. `task.start` is reached only through the `mk.action` worker command (`src/commands/mk-action.ts`), meaning the orchestrator agent.
- Effect: the "enforced by MK" confirm (C7) means whoever calls `mk.action` gets `needs_confirm` and can resend `confirm: true` with no human involved. The Safety tab label "enforced by MK" overstates this.
- Fix: pick one and write it into C7 and SCREENS.3.
  1. Add a Start button to `Plan.dc.html`. Name the file, give it one owner (see Critical 5), and add a T9/T10 case through the dev server returning `needs_confirm`.
  2. Drop the panel acceptance. Change C7 to say that `needs_confirm` goes back to the caller, the orchestrator must ask the user before resending, and the label reads "MK refuses until confirmed".

### 3. `notify.events.gateFail` and `runDone` have no source to "sync diff" (C6)
- Evidence: nothing in `src/` inserts into `check_result`; it is only read (`snapshot.ts:298,302,363`) and pruned (`maintenance.ts:103-111`). Sync handles only bus `heartbeat` and `question` messages (`sync.ts:554,566`); everything else becomes an event row. The `run` table has no status column (`schema-v1.ts` `CREATE TABLE run`). The v1 UI label for runDone was "plan finishes" (`settings-inventory.md:144`).
- Effect: both keys pass T8's Proxy check, because the toggle is read, yet they never fire. That breaks G2's "changes behaviour". A builder must also invent the trigger and the de-dupe key.
- Fix: define each trigger and key, or drop them.
  1. gateFail: a bus `status` message whose payload reports a failed check. This needs a new parse into `check_result`, with an owner (sync.ts, USE.2). De-dupe key `gateFail:<check_result.source>`.
  2. runDone: the plan's derived status (`v_plan_status`) changing to `done` between two syncs, with key `runDone:<plan.id>`. Rename it `planDone` to match the screen.
  3. If either needs more than that, drop it from C1 for v2 and move it to Q4's "later" list.

### 4. C2's map leaves out `routing.maxLanes`, the one setting that works today
- Evidence: C2 lists every other v1 key as mapped, kept, or dropped. `routing.maxLanes` (v1 rule `int 1-12`, read at `actions.ts:243`) appears in neither list. A builder following the map literally will not carry a user's changed lane limit, which contradicts G4 and K1.
- Fix: add "`routing.maxLanes` kept" to the C2 map and a T2 case (v1 `maxLanes: 7` → v2 7). While there, say what happens to unknown top-level keys in a v1 file. "Unknown keys are kept" conflicts with "only values that differ from v1 defaults are carried", since unknown keys have no default.

### 5. SCREENS ownership: the parallel tasks overlap, and the test harness is unowned
- SCREENS.2, .3 and .4 run in parallel and the build order says "each owns separate screen files; only SCREENS.1 edits runtime.js". That is false:
  1. SCREENS.4 edits `runtime.js` ("applies look.* … on the root") and "every screen's rain and text size". Every screen calls `window.MK_RAIN(<n>)` (16 call sites) and carries its own CSS, including the `Settings*.dc.html` files that SCREENS.2/.3 are rewriting.
  2. SCREENS.3's Start button (if kept) lives in `Plan.dc.html`, which SCREENS.4 also touches.
- `scripts/dev-snapshot-server.mjs` has its own `ACTION_NAMES` copy (lines 15-23) and answers `unknown_action` for anything else (:234-236). The T9 cases for the Reset, Export and Test buttons (`settings.reset`, `settings.export`, `notify.test`) will fail until it is updated, and no lane owns it.
- SCREENS owns `test/fixtures/snapshot/`, which does not exist. The real files are `test/fixtures/snapshot.json` and `test/fixtures/build-snapshot.mjs`, and the latter hardcodes `settings: { values: { schema: 2 }, … }` at :137. T9 needs `settings.schema` and non-default values there.
- Fix:
  1. Make SCREENS.4 run after SCREENS.2 and .3, or confine it to `runtime.js` (rain read centrally in `makeRain`, text size and density as CSS variables) with the per-screen edits listed by file.
  2. Add `scripts/dev-snapshot-server.mjs`, `test/fixtures/snapshot.json` and `test/fixtures/build-snapshot.mjs` to SCREENS `owned`.
  3. State that the dev server mirrors the C4 action names and can return `needs_confirm`.

## Further findings

### MAJOR
6. `general.openOnStart: last` cannot survive an Orca restart as specified. The dashboard is served from `http://127.0.0.1:<port>`, and the port is random on every start (`http.ts:178` `listen(opts.port ?? 0, …)`; `runtime.js:231` builds `apiBase` from it). The browser stores localStorage per origin, so the stored "last screen" is lost on each restart: the case G3 and SHIP.1's live check cover, and the default value. Fix: store the last screen server-side, either in `kv` via a small action (for example `ui.lastScreen`, owned by SCHEMA.3) or passed in the state query. Or document that "last" lasts only for a session and make `projects` the default.

### MINOR
7. SCHEMA.3's "ServerCtx notify stub" needs `src/server/common.ts` (ServerCtx, :40-51) and `src/server/index.ts` (ctx built at :78-86), which only USE owns. Lane A is sequential, so this is safe, but add both files to SCHEMA `owned` so a builder does not stop.
8. The SCHEMA build order "SCHEMA.1, then SCHEMA.2 and SCHEMA.3" reads as parallel, but both change `settings.ts`. SCHEMA.3's `settings.reset` writes the file and must handle a v1 file on disk, using SCHEMA.2's backup-then-write path. Make SCHEMA.3 depend on SCHEMA.2.
9. The v1 defaults that C2 compares against: SCHEMA.1 replaces `defaultSettings()` with v2, so SCHEMA.2 has no in-code source for them. Say "SCHEMA.1 moves the current `defaultSettings()` body into `settings-migrate.ts` as `V1_DEFAULTS`".
10. `settings.reset {section}`: "section" is undefined. It could mean a top-level C1 group (`data`, `sync`) or a tab (General = general + data + sync). Give the list of allowed values.
11. `data.goneDays` "(ended lanes, gone worktrees)": the shared `gone` constant (`maintenance.ts:69`) also prunes `run`, `ask` and `repo`, and `alert_sent` and others have separate 30-day literals. Say exactly which rules the key drives. `prune(db, at)` also takes no dir, so name the signature change.
12. `plans.inboxDir`: the inbox path is hardcoded in `sync.ts:814`, `import.ts` (`root(t)`, the `inbox/archive` relative paths stored in `inbox_file.path`) and `snapshot.ts:567` (display, SCHEMA-owned). The plan does not say:
    1. whether an absolute path is allowed
    2. where the archive goes
    3. what happens to existing `inbox_file` rows when the folder changes
    4. which fit `autoImport` imports (`pass` only?)
13. Test-injected options vs settings: tests pass `undoMs` (`test/server/actions.test.mjs:64`), `fastMs` and `slowMs` (`server.test.mjs:649`). State that an explicit `ServiceOptions` value wins over `general.undoSeconds`/`sync.*`, or the existing suites change timing.
14. C5 precedence: today each field falls back on its own (args.agent, else route[0]; args.model, else route[1]). C5 says "an explicit route … wins" as a whole. Say whether `args.agent` alone keeps `task.route`'s model. T4 is unit-only; nothing proves `task.start` calls routes.ts. Add one `task.start` case to T4 or T6.
15. C3 `owner: "orca"` and `orcaPane`: every C1 key is MK-owned, so `describeSettings()` per C1 key never emits an Orca row. List the Orca-owned rows (notifications enable/sound, theme, agent enable) and their panes, or say the screens hardcode them.
16. `snapshot.ts:550` already has an agent → provider map (it includes `gemini`). C5 adds a second one. Name one shared map so they cannot drift.

### NIT
17. Line refs: `actions.ts:236-241` → 237-241; `worker.ts:156-161` → 157-162.
18. SCHEMA.1 says "exactly the C1 keys". Add "plus `schema: 2`".
19. Route-text validation for `routing.bySize.*`: say whether the agent word must be a known id (affects T2's fallback cases).

## Simulations

- SCHEMA.2: buildable. The builder copies the v1 defaults (finding 9), diffs per leaf, maps per C2, clamps and normalises, and collects notes. It would silently drop `routing.maxLanes` (Critical 4). The `readFile` JSON-parse throw (`settings.ts:224-226`) is outside "v1 file" scope; acceptable.
- USE.1: buildable. `taskStart` at `actions.ts:231-261` has clear seams: route at 237-241, the lane check at 243-245, the args at 254-256. `quota` rows exist and `settingsBlock` shows `leftPct` already computed the same way. Open points: field precedence (finding 14), and that `warnings[]` reach only `mk.action` callers.
- SCREENS.4: not buildable in parallel as written. It touches `runtime.js` and all 16 `MK_RAIN` call sites (Critical 5), and the "last" screen storage is lost on restart (MAJOR 6).

## Tools

`mcp__codegraph__codegraph_explore` was used once (for actions.ts); everything else was read with shell reads and greps. No tool failed. No repo file was edited.
