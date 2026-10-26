# Settings v2 — phase SCREENS report (lane B)

Branch: `Interstellar-code/settings-v2-lane-b`.

## SCREENS.1 — tab list, binding helper and General
- `panel/runtime.js`:
  - `SETTINGS_TABS_SPEC` updated to list: `general`, `routing`, `work`, `safety`, `notify`, `look`.
  - Added runtime helper `createBinding(key, comp)` and `DCLogic.prototype.bind(key)`, also exposed as `window.MK_BIND` and `window.bind`:
    - Reads current value from `settings.values` with fallback to `schema.default`.
    - Reads `schema` entry from `settings.schema[key]` (extracting `min`, `max`, `options`, `type`, `default`).
    - Saves changes as a nested patch via `settings.save { patch }` with optimistic update.
    - Provides `step(delta)`, `less()`, `more()`, `cycle()`, `is(val)`, `toggle()`, `change(e)`, `input(e)`.
  - `emptySnapshotFallback()` updated with schema 2 settings block (`values`, `schema`, `migrationNotes`, `lastScreen`, `specTemplates`).
- Screens:
  - Removed `panel/screens/SettingsAgents.dc.html` and `panel/screens/SettingsShortcuts.dc.html`.
  - Renamed `panel/screens/SettingsAlerts.dc.html` -> `panel/screens/SettingsNotify.dc.html` (title `Settings · Notifications`, tab `notify`).
  - Added placeholder `panel/screens/SettingsWork.dc.html` with standard canvas layout and tab `work`.
  - Rewired `panel/screens/Settings.dc.html`:
    - Uses `bind('<key>')` for every control: `general.mode`, `general.activeRepo`, `general.openOnStart`, `general.undoSeconds`, `general.snoozeMinutes`, `data.backupKeep`, `data.goneDays`, `data.decisionDays`, `data.eventMax`, `sync.fastSeconds`, `sync.slowSeconds`, `sync.filesSeconds`.
    - Renders `migrationNotes` when present in snapshot.
    - Added Data section, Sync section, Export button calling `settings.export`, and Reset button calling `settings.reset { section: 'general' }`.
- Dev snapshot server (`scripts/dev-snapshot-server.mjs`):
  - `ACTION_NAMES` gained `settings.reset`, `settings.export`, `ui.remember`, `notify.test`.
  - Handles canned responses for these 4 actions (`notify.test` returns 409 conflict `not_ready`).
  - `emptySnapshot()` updated with schema 2 settings block.
- Fixtures:
  - `test/fixtures/build-snapshot.mjs` updated to include v2 `settings` block with `values` (non-default test values), `schema`, `migrationNotes`, `lastScreen`, `specTemplates`.
  - Rebuilt `test/fixtures/snapshot.json` (27.4 KB, well under 64 KB cap).
- Tests:
  - `test/panel/screens.test.mjs`: screen count changed from 16 to 15 (`ALL_15_SCREENS`, `SettingsNotify`, `SettingsWork`).
  - `test/panel/contract.test.mjs`: screen count assertion `>= 15`.
  - Added `test/panel/settings-screens.test.mjs` (T9): tests `bind('<key>')`, General screen rendering non-default values, migration notes, controls saving nested patches, Export and Reset buttons calling C4 actions, dev server action handling.

## Gate output
```
> npm run build && node --test test/panel/settings-screens.test.mjs test/panel/screens.test.mjs
> tsc && node scripts/build-panel.mjs && node scripts/stage-plugin.mjs

Built web/index.html: 15 screens, 431 KB
Built web/launcher.html: 186.7 KB
Staged plugin at /Users/rohits/orca/workspaces/orca-matrixkoder/settings-v2-lane-b/plugin
✔ no mock data constants remain in panel/screens/*.dc.html (3.272833ms)
▶ Chrome headless integration tests (T7)
  ✔ all 15 screens render from fixture snapshot without console errors (1779.177916ms)
  ✔ all 15 screens render from empty snapshot without console errors (2008.300666ms)
  ✔ a failed fetch shows the stale banner (410.359792ms)
  ✔ clicking one button per screen POSTs the expected action name (2057.73625ms)
✔ Chrome headless integration tests (T7) (8826.930583ms)
▶ Settings screens integration tests (T9)
  ✔ runtime helper bind("<key>") reads value, schema (min/max/options) and saves nested patch (160.533958ms)
  ✔ General screen renders fixture snapshot with non-default values shown (213.222917ms)
  ✔ General screen displays migrationNotes when present (159.627208ms)
  ✔ General screen controls save changes as nested patches (205.01575ms)
  ✔ General screen Reset and Export buttons call C4 actions (158.752417ms)
  ✔ dev-snapshot-server handles settings.reset, settings.export, ui.remember, and notify.test (19.271375ms)
✔ Settings screens integration tests (T9) (3373.3895ms)
ℹ tests 11
ℹ suites 2
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8961.357042
```

Suite: `npm test && npx tsc --noEmit` → pass 223/223, fail 0, typecheck clean.

## SCREENS.4 — Appearance applied app-wide and first screen
- `panel/runtime.js`:
  - `makeRain(seed)` reads `settings.values.look` (`rain.enabled`, `rain.brightness`, `rain.speed`, `reduceMotion`); returns `[]` when rain is disabled or motion is reduced; scales opacity with brightness and animation duration with speed.
  - Added `applyLook()`: applies CSS zoom (S: 0.9, M: 1, L: 1.15) to every mounted screen host and root `--mk-zoom`, root text-size classes (`text-size-s/m/l`), and root density classes (`density-compact/comfy`, `compact/comfy`); re-renders active screen instances.
  - `createBinding`: calls `applyLook()` immediately on optimistic update when a `look.*` key changes.
  - `mount(name)`: initializes host zoom to `currentZoom`.
  - Navigation & first screen: `resolveStartScreen()` picks first screen via `general.openOnStart`, falling back to `settings.lastScreen` (or 'projects' if empty) when `openOnStart` is 'last'; `go(name)` calls `action('ui.remember', { screen })` whenever screen changes.
- `panel/screens/SettingsLook.dc.html`:
  - Updated title to `Settings · Appearance`.
  - Binds all `look.*` keys using `this.bind('<key>')`: `look.rain.enabled`, `look.rain.brightness`, `look.rain.speed`, `look.reduceMotion`, `look.textSize`, `look.density`.
  - Shows Orca display-only row: "Set in Orca: Settings > Appearance" for Light and dark theme under Colours.
  - Added Reset button calling `settings.reset { section: 'look' }`.
- `panel/screens/Lanes.dc.html`:
  - Reads `settings.values.general.mode`.
  - In solo mode: hides the branch line (`branchHead`), hides the Worktree row (`worktreePath`), and shows "N lanes" instead of "N worktrees" in summary.
- `panel/screens/Projects.dc.html`:
  - Reads `settings.values.general.mode`.
  - In solo mode: hides " · N worktrees" in the sub line and hides "N idle worktrees" (showing "No plan running").
- `scripts/dev-snapshot-server.mjs`:
  - Added `setSnapshot()` support for dynamic test fixture injection.
- Tests (`test/panel/look.test.mjs`, T10):
  - Appearance screen binding of all `look.*` keys, patch saves, and reset call.
  - Appearance applied app-wide across screens (rain enabled/disabled, text size L/S zoom scaling).
  - Solo mode vs orchestrator mode worktree hiding and label checks on Lanes and Projects, clean Plan rendering.
  - `openOnStart` picking the first screen (including 'last' with `settings.lastScreen`) and screen changes calling `ui.remember`.

## Gate output
```
> npm run build && node --test test/panel/look.test.mjs
> tsc && node scripts/build-panel.mjs && node scripts/stage-plugin.mjs

Built web/index.html: 15 screens, 437 KB
Built web/launcher.html: 186.7 KB
Staged plugin at /Users/rohits/orca/workspaces/orca-matrixkoder/settings-v2-lane-b/plugin
▶ Appearance and look integration tests (T10)
  ✔ Appearance screen binds look.*, saves nested patches, and Reset calls settings.reset (864.241458ms)
  ✔ Appearance applied app-wide: rain off and textSize L scales Main and other screens (1863.065708ms)
  ✔ Solo mode hides worktree columns and controls on Lanes and Projects, Plan renders cleanly (1678.027ms)
  ✔ openOnStart picks the first screen and last opens settings.lastScreen, screen changes call ui.remember (2255.040042ms)
✔ Appearance and look integration tests (T10) (10067.6415ms)
ℹ tests 4
ℹ suites 1
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10366.121417
```

Suite: `npm test && npx tsc --noEmit` → pass 227/227, fail 0, typecheck clean.


## SCREENS.2 — Routing & Quota and Work
- `panel/screens/SettingsRouting.dc.html`:
  - Rewired to Settings · Routing & Quota with tab `routing`.
  - Limits & Quota Policy: binds `routing.maxLanes` (with `Fewer lanes` / `More lanes` buttons), `quota.onBelowFloor` (`off`/`warn`/`block`), and floors for Claude (`quota.floor.claude.sessionPct`, `quota.floor.claude.weeklyPct`) and others (`quota.floor.others.sessionPct`, `quota.floor.others.weeklyPct`).
  - Routes by task size: binds `routing.bySize.trivial`, `routing.bySize.standard`, and `routing.bySize.complex`. Provides agent, model, and effort pickers populated from `agents.<id>.models`, falling back to free text inputs for agents with empty models.
  - Agents & Quota: lists all configured agents (`claude`, `codex`, `agy`, `opencode`, `omp`). Displays installed status (`Ready` / `Missing`), CLI path, live quota read-only next to floor indicators, and binds `agents.<id>.routable`, `agents.<id>.model`, and `agents.<id>.effort`.
  - Models management: lists configured models with efforts and notes; supports inline and programmatic add, edit, and remove operations saving `{ agents: { [id]: { models } } }`.
- `panel/screens/SettingsWork.dc.html`:
  - Work Flow card: binds `lanes.stallMinutes` (stepper), `bugs.defaultRisk` (stepper), `plans.inboxDir` (text input), and `plans.autoImport` (toggle switch).
  - C8 shared-checkout hint: displays `"Solo mode: lanes share this checkout; set Lanes at once to 1 to avoid clashes"` when `mode === 'solo' && maxLanes > 1`.
  - Task spec templates section: displays one row per scenario (`investigate`, `implement`, `subdispatch`, `review`, `fix`) with one-line purpose, path input bound to `work.specTemplates.<scenario>`, and status indicator (`built-in`, `file ok`, or issue).
- `test/panel/settings-screens.test.mjs`:
  - Appended T9 integration tests covering `SettingsRouting` and `SettingsWork` rendering, bound values, patch saves, model add/edit/remove, C8 solo hint display, and spec template path saving.

## Gate output
```
> npm run build && node --test test/panel/settings-screens.test.mjs
> tsc && node scripts/build-panel.mjs && node scripts/stage-plugin.mjs

Built web/index.html: 15 screens, 475 KB
Built web/launcher.html: 186.7 KB
Staged plugin at /Users/rohits/orca/workspaces/orca-matrixkoder/settings-v2-lane-b/plugin
▶ Settings screens integration tests (T9)
  ✔ runtime helper bind("<key>") reads value, schema (min/max/options) and saves nested patch (159.761709ms)
  ✔ General screen renders fixture snapshot with non-default values shown (206.617583ms)
  ✔ General screen displays migrationNotes when present (152.361666ms)
  ✔ General screen controls save changes as nested patches (153.034084ms)
  ✔ General screen Reset and Export buttons call C4 actions (157.245458ms)
  ✔ dev-snapshot-server handles settings.reset, settings.export, ui.remember, and notify.test (11.649167ms)
  ✔ Routing & Quota screen renders fixture snapshot values and binds settings (247.012583ms)
  ✔ Routing & Quota models management: lists models, adds, edits, and removes models per agent (462.763916ms)
  ✔ Work screen renders fixture snapshot and binds work settings (275.841292ms)
  ✔ Work screen displays C8 shared-checkout hint in solo mode when maxLanes > 1 (658.033958ms)
  ✔ Work screen Task spec templates section renders all 5 scenarios with purpose, path binding, and status (305.182875ms)
  ✔ Safety screen renders fixture snapshot values, labels rows from schema, and binds safety.* (244.229791ms)
  ✔ Notifications screen renders fixture snapshot values, binds notify.*, has Test button, and shows Orca notes (298.191916ms)
  ✔ Plan screen Start button calls task.start, handles needs_confirm, shows confirm dialog, and resends with confirm: true (569.548875ms)
✔ Settings screens integration tests (T9) (6268.645125ms)
ℹ tests 14
ℹ suites 1
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6400.214167
```

Suite: `npm test && npx tsc --noEmit` → pass 235/235, fail 0, typecheck clean.

## SCREENS.3 — Safety and Notifications
- `panel/screens/SettingsSafety.dc.html`:
  - Rewired to Settings · Safety with tab `safety`.
  - Binds all `safety.*` keys using `this.bind('<key>')`:
    - `safety.confirmRiskAtLeast`: stepper with range 1-6 (displays `6 (never ask)` at threshold 6). Labelled with C7 wording: `"checked by MK; the dashboard asks you, agents must confirm explicitly"`.
    - `safety.askBeforePush`: toggle switch. Labelled: `"advisory: written into briefs"`.
    - `safety.protectedBranches`: editable chip list with remove buttons, plus text input and Add button. Labelled: `"advisory: written into briefs"`.
    - `safety.neverRun`: editable command list with remove buttons, plus text input and Add button. Labelled: `"advisory: written into briefs"`.
  - Added Reset button calling `settings.reset { section: 'safety' }`.
- `panel/screens/SettingsNotify.dc.html`:
  - Rewired to Settings · Notifications with tab `notify`.
  - Binds all `notify.*` keys using `this.bind('<key>')`:
    - Event toggles under "Notify me when": `notify.events.ask`, `notify.events.laneDone`, `notify.events.taskFailed`, `notify.events.stall`, `notify.events.quotaLow`.
    - Quiet hours section: toggle for `notify.quietHours.enabled`, with From/To time inputs bound to `notify.quietHours.from` and `notify.quietHours.to`.
    - While you are away: toggle bound to `notify.wakeOrchestrator`.
  - Test button calling `this.action('notify.test')` to test notifications.
  - Orca-owned display rows: rendered dynamically from schema `owner === 'orca'` rows as `"Set in Orca: Settings > Notifications"` notes for `"OS notifications and sounds"`.
  - Added Reset button calling `settings.reset { section: 'notify' }`.
- `panel/screens/Plan.dc.html`:
  - Tasks with no Orca task yet (`!t.orcaTaskId && !t.orca_task_id && t.status !== 'done'`) gain a Start button (`Start task`).
  - Calls `task.start`. On response error with `code === 'needs_confirm'`, opens a modal confirmation dialog explaining high-risk task confirmation.
  - Clicking "Confirm & Start" resends `task.start` with `{ taskId, confirm: true }`.
  - Closing or cancelling dismisses the dialog.
- `scripts/dev-snapshot-server.mjs`:
  - Added handling for `task.start`: returns 409 conflict with `{ kind: 'conflict', code: 'needs_confirm' }` when `args.confirm` is not true, matching the real server's refusal shape.
- `panel/runtime.js`:
  - Exposed `host.component = inst;` on screen host elements (approved by coordinator).
- `test/panel/settings-screens.test.mjs`:
  - Added T9 integration tests for:
    - Safety screen rendering, C7 and advisory schema labels, bound values, risk stepper, push toggle, branch removal, command removal, and reset call.
    - Notifications screen rendering, event toggles, quiet hours toggle, wake orchestrator toggle, Test notification button calling `notify.test`, Orca notes, and reset call.
    - Plan screen Start button calling `task.start`, receiving `needs_confirm`, displaying modal confirm dialog, and confirming with `confirm: true`.

## Gate output
```
> npm run build && node --test test/panel/settings-screens.test.mjs
> tsc && node scripts/build-panel.mjs && node scripts/stage-plugin.mjs

Built web/index.html: 15 screens, 475 KB
Built web/launcher.html: 186.7 KB
Staged plugin at /Users/rohits/orca/workspaces/orca-matrixkoder/settings-v2-lane-b/plugin
▶ Settings screens integration tests (T9)
  ✔ runtime helper bind("<key>") reads value, schema (min/max/options) and saves nested patch (167.467083ms)
  ✔ General screen renders fixture snapshot with non-default values shown (249.919417ms)
  ✔ General screen displays migrationNotes when present (152.194667ms)
  ✔ General screen controls save changes as nested patches (159.655125ms)
  ✔ General screen Reset and Export buttons call C4 actions (155.54375ms)
  ✔ dev-snapshot-server handles settings.reset, settings.export, ui.remember, and notify.test (8.939917ms)
  ✔ Routing & Quota screen renders fixture snapshot values and binds settings (226.992417ms)
  ✔ Routing & Quota models management: lists models, adds, edits, and removes models per agent (521.219416ms)
  ✔ Work screen renders fixture snapshot and binds work settings (259.91325ms)
  ✔ Work screen displays C8 shared-checkout hint in solo mode when maxLanes > 1 (682.76ms)
  ✔ Work screen Task spec templates section renders all 5 scenarios with purpose, path binding, and status (308.553334ms)
  ✔ Safety screen renders fixture snapshot values, labels rows from schema, and binds safety.* (289.797292ms)
  ✔ Notifications screen renders fixture snapshot values, binds notify.*, has Test button, and shows Orca notes (260.40525ms)
  ✔ Plan screen Start button calls task.start, handles needs_confirm, shows confirm dialog, and resends with confirm: true (576.941542ms)
✔ Settings screens integration tests (T9) (7686.823708ms)
ℹ tests 14
ℹ suites 1
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7954.1925
```

Suite: `npm test && npx tsc --noEmit` → pass 235/235, fail 0, typecheck clean.
