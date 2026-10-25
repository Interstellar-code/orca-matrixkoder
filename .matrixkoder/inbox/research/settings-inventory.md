# Settings inventory: orca-matrixkoder (read-only research)

Scope: current state of the settings schema, the 7 Settings screens, and the code that reads each key.
Generated 2026-10-25. No repo files were edited.

Method: codegraph explore (settings.ts, actions.ts, snapshot.ts), direct reads of the screen files, grep of src/, panel/, web/, plugin/, bin/, scripts/, test/.
Caveat: `web/index.html` and `plugin/web/index.html` are bundled copies that embed the screens (`MK_SCREENS[...]`). `plugin/out/` is compiled JS. Those copies were grepped too; they are not independent sources. I did not verify which build step produces them.

## 1. Schema: `src/store/settings.ts`

File: mk-settings.json in the data dir (`settingsPath`, settings.ts:29). Schema version `SETTINGS_SCHEMA = 1`.

### 1.1 Keys, defaults and rules (43 RULES entries; 3 are agent wildcards)

| Key | Default | Rule |
|---|---|---|
| general.mode | orchestrator | enum orchestrator, solo |
| general.openOnStart | projects | str, max 40 |
| general.activeRepo | null | str or null, max 200 |
| agents.*.routable (claude, codex, agy, opencode) | true | bool |
| agents.*.model | claude: sonnet 5.5; others '' | str, max 80 |
| agents.*.effort | medium | enum '', low, medium, high, xhigh, max |
| routing.useJev | true | bool |
| routing.lowConfidence | risk-based | enum risk-based, lower, higher |
| routing.askBeforeDestructive | true | bool |
| routing.tiers.trivial | claude haiku low | str, max 80 |
| routing.tiers.standard | claude sonnet medium | str, max 80 |
| routing.tiers.complex | claude opus high | str, max 80 |
| routing.tiers.finalReview | claude fable max | str, max 80 |
| routing.maxLanes | 3 | int 1 to 12 |
| routing.spareClaudeBelowPct | 30 | int 0 to 100 |
| safety.blockDestructiveGit | true | bool |
| safety.blockDeleteOutsideWorktree | true | bool |
| safety.askBeforePush | true | bool |
| safety.scanDiffsForSecrets | true | bool |
| safety.protectedBranches | ['main', 'release/*'] | strs, max 50 items |
| safety.neverRun | 5 commands | strs, max 100 items |
| alerts.events.ask | true | bool |
| alerts.events.laneDone | true | bool |
| alerts.events.gateFail | true | bool |
| alerts.events.runDone | true | bool |
| alerts.events.stall | false | bool |
| alerts.desktop | true | bool |
| alerts.quietHours.enabled | false | bool |
| alerts.quietHours.from | '22:00' | time HH:MM |
| alerts.quietHours.to | '07:00' | time HH:MM |
| alerts.wakeOrchestrator | false | bool |
| alerts.stallMinutes | 10 | int 1 to 1440 |
| alerts.dashboard.autoOpen | true | bool |
| alerts.dashboard.chip | true | bool |
| alerts.dashboard.toasts | true | bool |
| alerts.usagePollMin | 5 | int 1 to 120 |
| theme.rain.enabled | true | bool |
| theme.rain.brightness | 60 | int 0 to 100 |
| theme.rain.speed | normal | enum slow, normal, fast |
| theme.reduceMotion | false | bool |
| theme.textSize | M | enum S, M, L |
| theme.density | comfy | enum compact, comfy |
| shortcuts.footer | ['improve'] | strs, max 4 items |

Not in RULES: `schema` (must equal 1, checked separately in `validateSettings`).

### 1.2 Containers (`CONTAINERS`, settings.ts:141)

general, agents, routing, routing.tiers, safety, alerts, alerts.events, alerts.quietHours, alerts.dashboard, theme, theme.rain, shortcuts. Each must be an object, or validation fails.

### 1.3 Load, save, merge

- `defaultSettings()` (settings.ts:33): the defaults above.
- `mergeSettings` (settings.ts:210): deep merge for objects. Arrays and scalars are replaced. Unknown keys are kept.
- `loadSettings(dir)` (settings.ts:233): defaults, then the file (`readFile`), then validate. Throws SettingsError on a bad value. Never writes. A bad JSON file throws a plain Error.
- `saveSettings(patch, dir)` (settings.ts:244): merges the patch onto defaults plus the file, validates, `mkdir`, writes a tmp file, then renames it atomically. Throws SettingsError and writes nothing on a bad value.
- Consumers call `loadSettings` in 2 places: `snapshot.ts:89` (falls back to `{}` on error) and `actions.ts:243`.

### 1.4 Test: `test/store/settings.test.mjs`

82 lines, 6 tests. They cover defaults with no file, the first save creating the file, a round trip, bad values rejected by key with nothing written, unknown keys surviving a save, a hand-edited bad file reported on load, and agents added with arrays replacing. It imports from `../../out/store/settings.js`, so a build is needed first.

## 2. Screens and the Settings tab

Tab list: `SETTINGS_TABS_SPEC` in `panel/runtime.js`, around line 202. There are 7 tabs: general (Settings.dc.html, label "General"), agents, routing, safety, alerts, look (label "Theme"), shortcuts.

Save path, verified:
1. Each control calls `this.action('settings.save', { patch })`. The `action` helper is `panel/runtime.js:100`, which calls `window.MK.action`.
2. `runtime.js:331` POSTs `{name, args}` to `${apiBase}/api/action` with the `x-mk-token` header.
3. The server dispatches `settings.save` (`actions.ts:126`) to `settingsSave` (`actions.ts:485`), which calls `saveSettings` (`settings.ts:244`).
4. A bad value returns `bad_args` with issue details. `runtime.js` shows a toast.

State model, verified: the screens keep local `this.state` and update it on click. Six of the seven screens initialise that state with hardcoded literals and never read the saved settings. A reload shows the defaults, not the saved values. Only Settings.dc.html and SettingsAgents read `getData('settings')`, and both have path or shape problems (section 4).

### 2.1 Settings.dc.html (General)

| Control | Label | Type | Binds to | Notes |
|---|---|---|---|---|
| Mode segmented | Mode | 2-button segment | general.mode (write) | Initial state reads `values.mode`, which is the wrong path, so it always starts on Orchestrator. |
| Change | Open on start | button | general.openOnStart (write) | Always writes 'projects'. There is no picker. Display reads `values.openOnStart`, which is the wrong path, so it always shows 'Projects'. |
| Change | Default base branch | button, disabled | none | Static. Shows `baseBranch` from the snapshot (repo base_ref). |
| (static) | Repo | text | none | From `projects` data. |
| (static) | MK data folder | text | none | Hardcoded '~/.matrixkoder'. Snapshot has `dataDir`, unused. |
| (static) | Plan inbox | text | none | Computed from repo path. |
| Export, Import | Settings file | buttons, disabled | none | Not wired. |
| Check for updates | About | button, disabled | none | Not wired. |
| Reset | Reset all settings | button, disabled | none | Not wired. No key. |
| Search input | (search) | text input | none | No handler. |

### 2.2 SettingsAgents.dc.html

| Control | Label | Type | Binds to | Notes |
|---|---|---|---|---|
| Toggle per agent (4) | Use Claude Code, Codex, AGY, OpenCode | switch | agents.<id>.routable (write) | Initial state is `a.found` from the snapshot, not the saved `routable`. |
| Change | Default model | button, disabled | none (agents.*.model read-only) | Shows `a.model` from the snapshot, which has no model field. Falls back to hardcoded text. |
| (none) | Effort | n/a | none | No control for agents.*.effort. |
| Detect again | (header) | button, disabled | none | Not wired. |
| Quota meters | 5h window, Weekly, etc. | meters | none | From snapshot `agents[].quota` (quota table), not settings. |

### 2.3 SettingsRouting.dc.html

| Control | Label | Type | Binds to | Notes |
|---|---|---|---|---|
| Switch | Route with Jev | switch | routing.useJev (write) | Initial state hardcoded true. |
| (static) | When Jev is unsure | text | none (routing.lowConfidence) | Static 'risk based'. No control. |
| Switch | Ask before destructive tasks | switch | routing.askBeforeDestructive (write) | Initial state hardcoded true. |
| (static) | Fallback tier rows (4) | text rows, Edit disabled | none (routing.tiers.*) | Hardcoded labels. Format 'claude haiku · low' differs from the stored string. |
| −, + stepper | Lanes at once | stepper | routing.maxLanes (write) | Clamped 1 to 8. Schema allows 1 to 12. Initial 3, hardcoded. |
| Range slider | Spare Claude below | range input, 10 to 60 step 5 | routing.spareClaudeBelowPct (write) | Schema allows 0 to 100. Initial 30, hardcoded. |
| (static) | Final reviews | text | none | Static 'required'. |

### 2.4 SettingsSafety.dc.html

| Control | Label | Type | Binds to | Notes |
|---|---|---|---|---|
| Switch | Block destructive git | switch | safety.blockDestructiveGit (write) | Initial hardcoded true. |
| Switch | Block deletes outside the worktree | switch | safety.blockDeleteOutsideWorktree (write) | Initial hardcoded true. |
| Switch | Ask before git push | switch | safety.askBeforePush (write) | Initial hardcoded true. |
| Switch | Scan diffs for secrets | switch | safety.scanDiffsForSecrets (write) | Initial hardcoded true. |
| Chips with remove (x) | Protected branches | chips | safety.protectedBranches (write, whole list) | Initial hardcoded ['main', 'release/*']. |
| Text input and Add | Protected branches | input and button | safety.protectedBranches (write) | Adds a branch or pattern. |
| (static list) | Never run | list of 5 commands | none (safety.neverRun) | Hardcoded in screen state. The list cannot be edited. The "+ Add a command" button is disabled. |

### 2.5 SettingsAlerts.dc.html

| Control | Label | Type | Binds to | Notes |
|---|---|---|---|---|
| Switch (5) | Notify me when: a lane is waiting, lane finishes, gate fails, plan finishes, lane goes quiet | switch | alerts.events.ask, laneDone, gateFail, runDone, stall (write) | Initial state hardcoded. The stall description says "10 minutes" as static text. |
| Switch | Desktop notification | switch | alerts.desktop (write) | Initial hardcoded true. |
| Switch | Play a sound | switch | none | No schema key. Local state only. |
| Switch | Quiet hours | switch | alerts.quietHours.enabled (write) | Initial hardcoded true. Default is false. |
| Time inputs From, To | Quiet hours | text inputs, shown when on | none (quietHours.from, quietHours.to) | Static values '22:00' and '07:00'. No handler. |
| Switch | Wake the orchestrator on events | switch | alerts.wakeOrchestrator (write) | Initial hardcoded false. |
| Send a test notification | (footer) | button, disabled | none | Not wired. |
| (none) | Dashboard and usage poll | n/a | none | No control for alerts.dashboard.*, alerts.stallMinutes, alerts.usagePollMin. |

### 2.6 SettingsLook.dc.html (tab id `look`, key `theme`)

| Control | Label | Type | Binds to | Notes |
|---|---|---|---|---|
| Switch | Show rain | switch | theme.rain.enabled (write) | Initial hardcoded true. Also hidden when reduce motion is on. |
| Range slider 20 to 100 step 10 | Brightness | range | theme.rain.brightness (write) | Initial 60. Schema allows 0 to 100. Drives local opacity too. |
| Segment Slow, Normal, Fast | Speed | segment | theme.rain.speed (write) | Initial 'normal'. |
| Switch | Reduce motion | switch | theme.reduceMotion (write) | Initial false. |
| Switch | Follow Orca theme | switch | none | No schema key. Not saved. |
| (static) | Colours legend (6 swatches) | swatches | none | Static. |
| Segment S, M, L | Text size | segment | theme.textSize (write) | Initial 'M'. |
| Segment Compact, Comfortable | Density | segment | theme.density (write) | Initial 'comfy'. |

### 2.7 SettingsShortcuts.dc.html (key `shortcuts.footer`)

| Control | Label | Type | Binds to | Notes |
|---|---|---|---|---|
| Up, down, remove buttons (per slot) | Footer slots | list actions | shortcuts.footer (write, whole array) | Initial hardcoded ['improve', 'jev']. Schema default is ['improve']. |
| Add (per library item) | Add from library | button | shortcuts.footer (write) | Library labels and keys are hardcoded in the screen. |
| + Custom | Add from library | button, disabled | none | Not wired. |
| (preview) | Footer preview | static render | none | Built from screen state, not from the footer. |

## 3. Consumers: does any code read each key?

Method: grep for each leaf name over src, panel, web, plugin, bin, scripts, excluding the schema and the screens. Writers in screens do not count. Bundled copies were checked too.

Behaviour readers are only these:
- `routing.maxLanes`: consumed at `src/server/actions.ts:243`. The lane start refuses when the live lane count reaches the limit (message says to raise "Lanes at once").
- `general.activeRepo`: consumed at `src/server/snapshot.ts:101`. No UI writes it.

Echo only: `snapshot.ts:554` passes the whole settings tree to the panel as `settings.values`. The panel reads `general.mode`, `general.openOnStart` (wrong path, section 4), and `theme`/`alerts`/etc. are not read. Echo is not behaviour.

Per key:

| Key (group) | Status | Evidence |
|---|---|---|
| general.mode | dead | Only the screen reads it, from the wrong path (`values.mode`). No backend reader. |
| general.openOnStart | dead | Only the screen, wrong path (`values.openOnStart`). |
| general.activeRepo | consumed | snapshot.ts:101. No UI writer. |
| agents.*.routable | dead | Only the screen's toggle writes it. No router reads it. Snapshot `agents` comes from the `agent_cli` table, not settings. |
| agents.*.model | dead | No reader. The screen shows a hardcoded or snapshot value, not this key. |
| agents.*.effort | dead | No reader and no screen control. |
| routing.useJev | dead | Written by screen only (`web/index.html:3110` and the plugin copy). |
| routing.lowConfidence | dead | No screen control, no reader. |
| routing.askBeforeDestructive | dead | Written by screen only. |
| routing.tiers.trivial, standard, complex, finalReview | dead | No reader. Routing screen shows hardcoded tiers. Tiers are not from settings. |
| routing.maxLanes | consumed | actions.ts:243. Also written by the screen (`web/index.html:3128`). |
| routing.spareClaudeBelowPct | dead | Written by screen only. No reader in src. |
| safety.blockDestructiveGit | dead | No enforcement code found. |
| safety.blockDeleteOutsideWorktree | dead | No enforcement code found. |
| safety.askBeforePush | dead | No enforcement code found. |
| safety.scanDiffsForSecrets | dead | No enforcement code found. |
| safety.protectedBranches | dead | Grep found no reader. |
| safety.neverRun | dead | Grep found no reader. No screen control. |
| alerts.events.ask | dead | No reader. |
| alerts.events.laneDone | dead | No reader. |
| alerts.events.gateFail | dead | No reader. |
| alerts.events.runDone | dead | No reader. |
| alerts.events.stall | dead | No reader. |
| alerts.desktop | dead | No reader. |
| alerts.quietHours.enabled | dead | No reader. |
| alerts.quietHours.from | dead | No screen control, no reader. |
| alerts.quietHours.to | dead | No screen control, no reader. |
| alerts.wakeOrchestrator | dead | No reader. |
| alerts.stallMinutes | dead | No reader. No stall logic in src reads it. |
| alerts.dashboard.autoOpen | dead | No reader. No control. |
| alerts.dashboard.chip | dead | No reader. No control. |
| alerts.dashboard.toasts | dead | No reader. No control. |
| alerts.usagePollMin | dead | No reader. `sync.ts:111-113` uses hardcoded 10 s, 60 s and 30 s intervals. |
| theme.rain.enabled | dead | Written by screen only. Panel does not read it. |
| theme.rain.brightness | dead | Written by screen only. |
| theme.rain.speed | dead | Written by screen only. |
| theme.reduceMotion | dead | Written by screen only (`plugin/web/index.html:3036`). |
| theme.textSize | dead | Written by screen only. |
| theme.density | dead | Written by screen only. |
| shortcuts.footer | dead | Screen writes it. The footer in `web/index.html` is static HTML. Nothing reads the setting. |
| schema | (validation only) | settings.ts validate. |

Totals: 43 RULES entries. 2 consumed (routing.maxLanes, general.activeRepo). 41 dead. Dead means stored, or echoed to the panel, and never changes behaviour.

Extra behaviour the settings do not control:
- `src/worker.ts:158` shows the "Lane Verified" notification on every `done` event. It ignores alerts.desktop and alerts.events.laneDone.
- No enforcement code for the four safety guards, protected branches or never-run commands was found in src. Grep for `push --force`, `reset --hard`, `clean -fdx`, `rm -rf`, `npm publish` and protectedBranch found nothing outside settings.ts.

## 4. Gaps

### 4.1 Count of unbound controls

Unbound means a control with no key, or static text, or a disabled button.

- Settings.dc.html: 9 (search, base branch Change, repo, data folder, inbox, Export, Import, Check updates, Reset).
- SettingsAgents: 3 (Detect again, Default model Change, Effort has no control).
- SettingsRouting: 3 static (lowConfidence, Final reviews, tier rows with Edit disabled).
- SettingsSafety: 2 (Never-run list static, "+ Add a command" disabled).
- SettingsAlerts: 4 (Sound, quiet From and To, Send a test notification).
- SettingsLook: 2 (Follow Orca theme, colours legend).
- SettingsShortcuts: 2 (+ Custom disabled, preview is screen state).

Total: about 25 unbound or static controls.

### 4.2 Keys with no screen control (no UI at all)

general.activeRepo; agents.*.effort; agents.*.model (read-only); routing.lowConfidence; routing.tiers.* (4); safety.neverRun; alerts.quietHours.from and to; alerts.stallMinutes; alerts.dashboard.* (3); alerts.usagePollMin. That is 15 keys. Plus the screen-only keys with no schema entry (sound, Follow Orca theme).

### 4.3 Top gaps

1. Hydration: six of seven screens never read saved settings. Routing, Safety, Alerts, Look and Shortcuts start from hardcoded literals. Reloading shows defaults. Settings.dc.html and SettingsAgents also do not hydrate correctly (see 4.4 and 4.5).
2. Path mismatch: the screens read `s.values.mode` and `s.values.openOnStart`. The snapshot nests them under `values.general`. The Mode and Open-on-start displays therefore always show defaults.
3. Nothing is enforced: 41 of 43 keys have no behaviour reader. The safety guards, alert events and theme do nothing server-side. Only maxLanes is enforced.
4. Range mismatches: Lanes at once is clamped 1 to 8 in the screen (schema 1 to 12). Spare Claude is 10 to 60 in the screen (schema 0 to 100). Brightness is 20 to 100 in the screen (schema 0 to 100).
5. Agents toggle ignores the saved `routable`, using `a.found` as its initial state. Default `agents.*.model` is never shown.
6. Shortcuts initial slots ['improve', 'jev'] differ from the default ['improve'].
7. Tab id `look` vs key `theme`. Tab label "Theme" vs the key name. This is a naming mismatch, not a bug.
8. Stored-only keys shown as static text: the stall description says "10 minutes" while alerts.stallMinutes exists and is unused.
9. Route format: the screen tier labels use '·' ('claude haiku · low'), and the stored default is 'claude haiku low'. Tier strings are free text and never parsed.
10. Sound and Follow Orca theme toggles have no schema key and are not saved.
11. Reset all settings, Export and Import are disabled. No key or action exists for them.
12. Snapshot: if the snapshot exceeds the limit, `values` is emptied (`snapshot.ts:52-53`). The panel then reads no settings.
13. Bundled copies: `web/index.html` and `plugin/web/index.html` embed the screens. Edits to `panel/screens/*.dc.html` may need a rebuild to take effect. I did not check the build script.

### 4.4 Settings.dc.html detail

It reads `s.baseBranch` and `s.version` (both exist in the snapshot). It reads `s.values.mode` and `s.values.openOnStart` (wrong path).

### 4.5 SettingsAgents detail

It reads `s.agents`, an array from the snapshot (`snapshot.ts`, `settingsBlock`), which is correct. It ignores `settings.agents.*` entirely. Its `model` comes from `a.model`, which the snapshot does not send.

## Counts summary

- Schema keys (RULES entries): 43, including 3 agent wildcards.
- Consumed by behaviour: 2. Dead: 41.
- Screens: 7. Unbound or static controls: about 25 (section 4.1, counted by hand from the screen reads, not by script). Bound controls were not counted.
- Tests: 6 in test/store/settings.test.mjs.
