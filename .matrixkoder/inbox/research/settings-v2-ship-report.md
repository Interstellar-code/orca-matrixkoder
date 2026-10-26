# SHIP.1 report: dead-key check (T8)

## T8 coverage (key or family -> reader)
Server half (recorded through `setting()` while test/server routes, notify, safety, consumers, spec-templates ran):
- general.mode -> actions.ts (task.start), spec-templates.ts
- general.undoSeconds -> decisions.ts; general.snoozeMinutes -> actions.ts
- general.activeRepo -> snapshot.ts (also panel bind)
- data.backupKeep|goneDays|decisionDays|eventMax -> maintenance.ts
- sync.fastSeconds|slowSeconds|filesSeconds -> sync.ts
- agents.<id>.routable|model|effort -> routes.ts (resolveRoute); agents.<id>.models|routable -> routes-check.ts (family prefix `agents.${`)
- routing.bySize.* -> routes.ts (prefix `routing.bySize.${`); routing.maxLanes -> actions.ts
- quota.floor.* -> routes.ts, sync.ts (prefix `quota.floor.${`); quota.onBelowFloor -> routes.ts
- lanes.stallMinutes -> sync.ts; bugs.defaultRisk -> cli.ts; plans.inboxDir -> import.ts, snapshot.ts; plans.autoImport -> sync.ts
- work.specTemplates.* -> spec-templates.ts (prefix `work.specTemplates.${`)
- safety.confirmRiskAtLeast -> actions.ts; safety.protectedBranches|neverRun|askBeforePush -> spec-templates.ts
- notify.events.* -> notify.ts (prefix `notify.events.${`); notify.quietHours.enabled|from|to, notify.wakeOrchestrator -> notify.ts
Panel half (literal bind('<key>') in panel/): look.rain.enabled|brightness|speed, look.reduceMotion, look.textSize, look.density (SettingsLook), general.openOnStart (Settings, runtime.js), general.activeRepo (Settings, SettingsSafety, SettingsNotify).

## Dead keys
The recorder found the whole agents.<id>.routable|model|effort|models family unread through `setting()`: routes.ts and routes-check.ts read `settings.agents[...]` directly. Not dead in behaviour, but outside the one sanctioned accessor. Fixed in the owning files: src/server/routes.ts (model and effort defaults, routable check) and src/store/routes-check.ts (routable, models) now read via `setting()`. No key removed from C1; no allow list.

## Other changes
Plan Start hidden on failed tasks (`canStart = ... && t.status !== 'failed'`), new case in test/panel/settings-screens.test.mjs (failed tasks without an Orca task show Retry, no Start). The panel test needs `npm run build` first (it loads web/).

## Gates
- `npm run build && node --test test/store/no-dead-settings.test.mjs`: 2 pass, 0 fail
- `npm test`: tests 295, pass 295, fail 0
- `npx tsc --noEmit`: exit 0

# SHIP.2 report: rebuild, v0.3.0, CHANGELOG, manual checklist

Commit: `0a9ac07210b chore(release): v0.3.0 settings v2` on main (one commit, no tag, no push).

## Stale or unrelated out/ and web/ files
None. Before staging, `git status --short out web` listed 13 modified and 8 new `out/` files plus `web/index.html`; each `out/*.js` has a `src/*.ts` counterpart (new: server/notify, providers, routes; store/routes-check, schema-v2, settings-migrate, spec-builtin, spec-templates). `web/launcher.html` did not change. `plugin/` is git-ignored.

## Gate tails
- `npm test`: tests 295, suites 4, pass 295, fail 0, cancelled 0, skipped 0
- `npx tsc --noEmit`: exit 0
- `npm run build`: orca-matrixkoder@0.3.0, "Built web/index.html: 15 screens", "Built web/launcher.html", "Staged plugin at .../plugin"
- After the final build and commit, `git status --short` shows only the untracked ship report (no out/ or web/ changes).

## Notes
- Task step 1 (commit out/web once) and step 6 (one commit) were combined into the single commit.
- CHANGELOG notifier events use the real keys: ask, laneDone, taskFailed, stall, quotaLow. Migration 2 adds `plan_task.scenario`.
- Manual checklist: test/manual/settings-v2.md (11 checks).
