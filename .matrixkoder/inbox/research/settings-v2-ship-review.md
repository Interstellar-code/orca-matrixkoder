APPROVE

### Findings
None. All 4 review checks pass cleanly with no findings.

### Review Details

#### 1. Dead-Key Check (T8) Verification
- **Implementation**: `test/store/no-dead-settings.test.mjs` verifies C1 settings keys against readers.
  - **T8a (Server)**: Uses a node loader hook intercepting `out/store/settings.js` to record all `setting()` paths queried during execution of `routes`, `notify`, `safety`, `consumers`, and `spec-templates` suites.
  - **Key Partitioning**: 69 leaf paths in C1 (`defaultSettings()` excluding root `schema` version integer). 8 panel keys (`look.*`, `general.openOnStart`, `general.activeRepo`) are partitioned to T8b; 24 non-family server keys require direct hits in `setting.log`; 37 family keys (`agents.<id>.routable`, `agents.<id>.models`, `agents.<id>.model`, `agents.<id>.effort`, `routing.bySize.*`, `quota.floor.*`, `notify.events.*`, `work.specTemplates.*`) require both a logged member hit and an explicit backtick prefix read (`` `<prefix>${ ``) in `src/`.
  - **T8b (Panel)**: Verifies all 8 panel keys are bound via literal `bind('<key>')` or `look.` hierarchy walks in `panel/`.
  - **Skips & Allow Lists**: Verified no allow list or hidden ignore list exists. Only root `schema` is excluded.
  - **Mutation Experiments**: In an isolated throwaway sandbox under scratchpad:
    1. Simulating an unread non-family key (`general.undoSeconds`) failed T8a with `dead settings (no reader): general.undoSeconds`.
    2. Deleting family reads (`agents.<id>.routable`) failed T8a with `agents.<id>.routable: no member was read`.
    3. Removing prefix declaration string (`` `routing.bySize.${ ``) in `src/` failed T8a with `routing.bySize.*: no computed read by prefix "routing.bySize.${" in src/`.
    4. Removing panel bind (`look.rain.brightness`) failed T8b with `panel keys with no reader: look.rain.brightness`.
    5. Replacing a `setting()` call in `out/server/actions.js` with a constant broke the underlying test suite (`safety.test.mjs`), triggering T8a's requirement that suites pass under the recorder.

#### 2. SHIP.1 Route Accessors & Plan Start Fix
- `src/server/routes.ts` and `src/store/routes-check.ts` read `agents.*` properties via `setting()` instead of direct property access on `settings.agents`. Behavior is unchanged: route resolver and validation pass all 15 unit tests in `routes.test.mjs`.
- `panel/screens/Plan.dc.html` line 294 updates `canStart` to require `t.status !== 'failed'`.
- `test/panel/settings-screens.test.mjs` lines 1188–1219 explicitly tests that a failed task without an Orca task renders Retry, not Start.

#### 3. SHIP.2 Release Hygiene & Artifact Accuracy
- `CHANGELOG.md` 0.3.0 is accurate against implementation:
  - Six Settings tabs, schema 2 migration with in-memory fallback and backup copy on first save.
  - Quota floors and routing by size.
  - Refusal codes (`bad_route`, `quota_floor`, `needs_confirm`, `plan_partial`) correctly specified.
  - Safety rows explicitly documented as advisory.
  - Solo mode, spec templates, and app-wide appearance covered.
- `test/manual/settings-v2.md` contains 11 concrete, runnable test cases with explicit actions and expected results covering all plan live checks (reload/restart persistence, v1 migration and backup, high-risk confirmation, test notifications, solo checkout execution for risk K7, bad route partial state).
- Clean build: `npm run build` rebuilt `out/` and `web/` cleanly. `git status --short` remains clean after build.
- No stray or untracked files committed (no scratch, reports, or node_modules).

#### 4. Manifest & Version Consistency
- `orca-plugin.json` is valid JSON; capabilities and commands are identical to v0.2.1, with only `version` updated to `0.3.0`.
- Package versions are consistent at `0.3.0`: `package.json`, `package-lock.json`, and `orca-plugin.json`.
- `orca-marketplace.json` references `ref: "v0.3.0"`.
- No git tag exists for `v0.3.0`.

### What Was Run vs Read
- **Run**:
  - `npm test`: 295/295 tests passed across 4 suites.
  - `npx tsc --noEmit`: 0 errors.
  - `npm run build`: verified clean build and clean git working tree.
  - `node --test test/store/no-dead-settings.test.mjs`: both T8a and T8b passed.
  - `node --test test/server/routes.test.mjs`: all 15 route tests passed.
  - Scratchpad throwaway mutation tests: verified T8a and T8b failure modes across 5 mutation scenarios.
  - Node JSON comparison scripts: verified exact equivalence of `orca-plugin.json` schema/fields, C1 key leaves, and manifest versions.
- **Read**:
  - Commits `50715308572` and `0a9ac07210b` diffs and commit messages.
  - `.matrixkoder/inbox/mk-settings-v2.md` (T8, block 5.4, risk K7, log).
  - `.matrixkoder/inbox/research/settings-v2-ship-report.md`.
  - `CHANGELOG.md` and `test/manual/settings-v2.md`.
  - Source files: `src/server/routes.ts`, `src/store/routes-check.ts`, `panel/screens/Plan.dc.html`, `test/panel/settings-screens.test.mjs`, `test/store/no-dead-settings.test.mjs`.
