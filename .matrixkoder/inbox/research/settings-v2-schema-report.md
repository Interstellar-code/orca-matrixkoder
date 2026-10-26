# Settings v2 — phase SCHEMA report (lane A)

Branch: `Interstellar-code/settings-v2-lane-a`. Commits (`git log --oneline main..HEAD`):

1. `593dbde6b33` feat(settings): SCHEMA.1 schema 2 rules, defaults, description and accessor
2. `b8100e0f361` feat(settings): SCHEMA.2 v1 to v2 migration
3. `135481fc17d` feat(settings): SCHEMA.3 settings actions

Phase gates: `npm test` → tests 211, pass 211, fail 0. `npx tsc --noEmit` → exit 0, no output.
Task gates (`npm run build && node --test …`): settings.test.mjs 13/13, settings-migrate.test.mjs 10/10, actions.test.mjs 37/37.

## SCHEMA.1
- `src/store/settings.ts`: schema 2 defaults and rules for every C1 key, `MODEL_SEED` (hand-copied from jev `models.md`; agy list is exactly 12), `setting()`, `describeSettings()` (keyed by dotted path, plus 5 `owner: "orca"` display rows), `normalizeValue()`, `loadSettingsDetailed()`, `resetSettings()`, `RESET_SECTIONS`.
- `src/store/routes-check.ts`: `checkRoute(text | {agent, model, effort}, settings)` with the C9 rules.
- `src/server/snapshot.ts`: settings block carries `values`, `schema`, `migrationNotes`, `specTemplates` (five C10 placeholders), `lastScreen`; `setting()` replaces the direct read.
- `src/server/actions.ts:243` reads `routing.maxLanes` through `setting()`.
- Tests: `test/store/settings.test.mjs` (T1, incl. 64 KB payload check, every key rejects a wrong value, checkRoute cases).

## SCHEMA.2
- `src/store/settings-migrate.ts`: `V1_DEFAULTS`, `migrateV1()` (pure; only values differing from V1_DEFAULTS; clamp/normalise; notes), `droppedV1Key()`.
- `loadSettings` migrates in memory and never writes; `saveSettings`/`resetSettings` copy the v1 file to `mk-settings.v1.bak.json` (timestamped name if one exists) then write v2 atomically.
- Tests: `test/store/settings-migrate.test.mjs` (T2) with fixtures in `test/fixtures/settings/` (all-changed, bad-values, minimal).

## SCHEMA.3
- `ACTION_NAMES` now 29: `settings.reset`, `settings.export`, `ui.remember`, `notify.test` (stub: `conflict` / `not_ready` / "notifier not built yet") added; `settings.save` refuses a dropped v1 key with `bad_args` naming it.
- `ui.remember` accepts a name from `SCREENS` in `snapshot.ts` and writes kv `panel.lastScreen`.
- Tests: `test/server/actions.test.mjs` (T3), ACTION_NAMES count 25 → 29 and list updated; the old settings.save test now uses `look`/`notify` keys.

## Deviations (with reasons)
1. `lastScreen` is `settings.lastScreen`, not a top-level snapshot key. Reason: `test/server/server.test.mjs` pins the top-level key list. Coordinator approved option A in an `ask`; lane B reads `settings.lastScreen`.
2. Edited `test/server/server.test.mjs` (not an owned file), R2.3 only: the huge-`neverRun` file now says `schema: 2`. Reason: a schema 1 file now migrates (items over the cap are dropped), so it no longer proves "an invalid file falls back to values {}". Coordinator approved.
3. `loadSettings` still returns `Settings`; the notes come from the new `loadSettingsDetailed()` (returns `{settings, migrationNotes}`). Reason: avoids changing every caller's type.
4. SCHEMA.1's commit already contains `settings-migrate.ts` (settings.ts imports it, so it cannot compile without it); SCHEMA.2's commit adds its tests, fixtures and the agent-field fill-in. SCHEMA.1's commit has only the `setting()` hunk of `actions.ts`.
5. `routing.bySize.*` validation checks "known agent id" only (per the SCHEMA.1 acceptance line); model/effort rules run through `checkRoute` at `task.start` (USE.1), so turning an agent off (`routable: false`) cannot make a save fail on the default routes.
6. Migration notes also list clamps (not only fallbacks), e.g. stall 3 → 5.
7. Orca pane names in `describeSettings()` are taken from C3's text; they are not confirmed in the Orca UI.
8. `npm ci` was needed once in this worktree (no `node_modules`; it populates only the ignored folder) so `tsc` could find `@types/node`.

## State
`git status --short`: only `out/` and `web/` modified/untracked by the build (not staged). The plan file and `panel/` are untouched.

## Fix round (2026-10-26)

1. Efforts C9 refuses (settings-migrate.ts, final pass): effort is dropped, with a `agents.<id>.effort` note, for omp/opencode, for models with no efforts (agy), and when the migrated model is "". Test: `fix 1` in settings-migrate.test.mjs; the T2 all-changed case now expects agy effort "". Probe: `model-effort` and `agent-effort-nomodel` clean; every migrated agent passes checkRoute.
2. Route check on tiers and bySize: the `route` rule now calls `checkRoute` with every agent forced routable (a default route string is exempt so a trimmed models list cannot block a save). Migration tiers go through it via normalizeValue: a failure falls back to the C1 default with a `routing.tiers.*` note. Test: `fix 2`. Probe: `tier-bad` falls back with notes; `bySize-validate` returns `routing.bySize.standard`.
3. Inherited keys: `Object.hasOwn` for RENAMED, RULES and the seeded-agent lookup. Test: `fix 3` (toString, constructor, hasOwnProperty, valueOf). Probe: no throw.
4. Prototype paths: `UNSAFE_KEYS` skipped in walk, setPath, delPath, getPath and mergeSettings. Test: `fix 4` (v1 and v2 files). Probe: `proto` prints clean; p2 `pollution: undefined`.
5. 64 KB guard: describeSettings gives no rows to ids over 40 chars (filtered before the 20-id cap); snapshot cuts each migration note to 200 chars and the last guard drops `agents.*` schema rows before emptying `values`. Tests: settings.test.mjs (25 ids of 1000 chars) and actions.test.mjs (20 ids, big notes, `/api/state` < 64 KB). Probe: `describe-size` 19898 bytes with 25 agents.

Gates: targeted suites 66/66, `npm test` 217/217, `npx tsc --noEmit` clean. The size test lives in actions.test.mjs and settings.test.mjs (server.test.mjs is not SCHEMA's).
