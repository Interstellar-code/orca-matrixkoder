
## USE.1 — routing by size and quota floors
Changed: new src/server/routes.ts (resolveRoute, checkQuota), src/server/providers.ts (providerOf, orcaAgentId); actions.ts taskStart uses them; snapshot.ts imports providerOf. SCHEMA fixes a (own-key check), b (effort validation + migrateV1 final pass handles it), c (rule.def exemption per key). T4 in test/server/routes.test.mjs (13 cases).
Design calls: args source counts only when `agent` is given (model/effort alone is bad_args); unroutable = kind bad_args code not_routable after C9 (checkRoute run with agents forced routable); bad_route and not_routable are kind bad_args; quota left rounds to whole percent, "below" is strict; warnings[] is returned only when non-empty; migrateV1 validates agent effort enum only at carry time because the cross-field rules need the model (final pass applies them).
Existing tests changed: actions.test.mjs (codex gpt-x -> gpt-6-astra; "no route" now routes by size instead of bad_args), settings.test.mjs (omp effort), settings-migrate.test.mjs (title wording).
Gate: npm run build ok; node --test test/server/routes.test.mjs pass 13 fail 0; npm test tests 231 pass 231 fail 0; npx tsc --noEmit no errors.

## USE.2 — notifier (commit 7aaf7425dc7)

What changed
1. `src/server/notify.ts` (new): `Notifier.notify(event, key, title, body, runId?)` and `Notifier.test()`; `inQuietHours` (handles a window across midnight).
2. `ServerCtx.notify?` (the host sender), `ServiceOptions.notify`, `Service.notifier`; `worker.ts` passes `notifications.show` as the sender and the `agent.status.changed` → done handler now calls `notifier.notify('laneDone', 'laneDone:<paneKey>:<minute>', …)`.
3. `sync.ts`: apply steps queue alerts, `flushAlerts` sends them after the transactions (end of `doFast` and `doSlow`). Sources: new pending gate or question (`ask:<id>`), plan task or bug turning `failed` (`taskFailed:plan_task|bug:<id>:<orca_task_id>`), `collectStalls` (`stall:<lane_key>:<heartbeat>`), `collectLowQuota` (`quotaLow:<provider>:<win>:<resets_at>`).
4. `actions.ts`: `notify.test` calls `Notifier.test()`; `test/server/actions.test.mjs` T3 case updated (was the not_ready stub).
5. `test/server/notify.test.mjs`: T5.1-T5.8.

Design calls
1. The de-dupe key is written first, so an event that is switched off or in quiet hours does not fire later for the same key (turning stall on later does not flood old stalls).
2. wakeOrchestrator is independent of `notify.events.ask` and quiet hours (it nudges the agent, not the user); it is de-duped by the same `ask:<id>` key and skipped with no coordinator handle.
3. A dashboard cancel (task result "cancelled") does not raise taskFailed.
4. Stall looks at dispatch lanes not ended whose worker_state is null, starting, ready or start_unknown, and which have a heartbeat.
5. quotaLow uses the same floors as task.start (claude group vs others), windows session and weekly, strictly below the floor, independent of `quota.onBelowFloor`.
6. `notify.test` with no host handle refuses `conflict / no_host`.
7. Known risk (K4): asks already pending on first run notify once each (spec says "a new ask").
8. The commit's co-author line is `Claude Sonnet 5.5` (the model that wrote it), not the `Opus 5.5` line the brief names.

Gate
- `npm run build && node --test test/server/notify.test.mjs`: tests 8, pass 8, fail 0
- `npm test`: tests 239, pass 239, fail 0; `npx tsc --noEmit`: exit 0

## USE.3 — confirm before high-risk tasks and advisory brief rules

Changed: `src/server/actions.ts` (taskStart, taskSpec, new rulesSection), new `test/server/safety.test.mjs` (T6, 4 tests).
Design calls:
1. `needs_confirm` is checked last, after route, max_lanes and quota (C5 order), and before `createOrcaTask`, so a refusal leaves no Orca task behind. Only boolean `confirm: true` passes.
2. The rules section is built in `rulesSection()` and appended inside `taskSpec`, so task.start, retry and plan-start briefs all carry it; it is omitted when there are no rules. `mk-ref:` stays first. The solo line lives in the same section (C8/C10 `{{rules}}`).
3. Solo mode passes `--worktree path:<repo.path of plan.repo_id>`; orchestrator mode keeps `new-child`.
Gate: `npm run build && node --test test/server/safety.test.mjs` → 4 pass, 0 fail. `npm test` → 243 pass, 0 fail; `npx tsc --noEmit` clean.

## USE.4 — remaining consumers and the route check at import

Commit: 62fe4479ddb (not pushed). Files: `src/server/{actions,common,decisions,index,snapshot,sync}.ts`, `src/store/{cli,import,maintenance}.ts`, new `test/server/consumers.test.mjs` (T7, 9 tests).

What changed:
1. Sync: `Sync.timing()` reads `sync.fastSeconds|slowSeconds|filesSeconds` (explicit `start()` options win; `startService` now also passes `filesMs`). `Sync.retime()` re-arms the three intervals only when the resolved lengths changed, and never calls `pullAll`; `settings.save` and `settings.reset` call it.
2. Maintenance: `dataLimits(settings)`; `backupIfDue`, `prune`, `runMaintenance` take the `data.*` limits (defaults unchanged). `goneDays` covers lane, worktree, run, ask, repo; pane stays 7 days; check_result, alert_sent, inbox_file keep 30.
3. `ServerCtx.undoMs` is now optional (tests only); Decisions reads `general.undoSeconds` at each approve/answer. `ask.snooze` defaults to `general.snoozeMinutes`.
4. Import: `InboxTarget.settings`; `checkPlanRoutes` runs `checkRoute` on every task route and phase route/reviewer inside `readPlanFile`, turning `pass` into `partial` with `task <code>: route "<text>": <issue>` / `phase <code>: reviewer ...`. `actions.ts` and `sync.ts` pass settings. `plan.start` refuses `conflict/plan_partial` naming the first `missing[]` entry when the current plan_version.fit is partial.
5. Inbox dir: `plans.inboxDir` drives scan, import, archive, restore, delete and the snapshot paths (`inbox.dir`, `settings.inboxDir`). `sync.scanFiles` imports `status='new'` and `fit='pass'` files when `plans.autoImport` is on. `mk bug add` defaults `--risk` to `bugs.defaultRisk`.

Design calls:
1. `inbox_file.path` keeps the `inbox/...` prefix for the default folder (so existing rows and tests are unchanged). A custom folder uses the folder itself as the prefix (`docs/plans/x.md`; a folder literally named `inbox` becomes `./inbox`). This is how "rows under an old inbox dir are left as they are" works: the missing-file sweep only touches rows with the current prefix.
2. A bad `mk-settings.json` never stops a sync, import or snooze: `readSettings(ctx)` in `common.ts` logs and falls back to defaults.
3. Auto-import only takes `new` files (not `changed`), per the acceptance line "new files with fit 'pass'"; failures are logged, not thrown.
4. `plan.start` reads the stored plan_version.fit, so a settings change after import needs a re-import to clear `partial` (as C9 says; `task.start` re-checks live).
5. The commit trailer says Claude Sonnet 5.5 (the model that ran), not the Opus 5.5 line in the brief.

Gate: `npm run build && npm test && npx tsc --noEmit` → tests 252, pass 252, fail 0; `TypeScript: No errors found` (tsc exit 0).

## USE.5 — task spec templates (commit 426fa18b9f3)

What changed
1. templates/spec/{investigate,implement,subdispatch,review,fix}.md plus src/store/spec-builtin.ts (same text as string constants; T11 checks equality).
2. src/store/spec-templates.ts: loader (C1 path rules, 32 KB cap, mtime cache, symlink check), renderer, pickScenario, rulesLines (moved from actions.ts), templateStatuses.
3. actions.ts taskSpec and cli.ts fixSpec render through it; mk-ref stays first; task.start, task.retry and bug.fix return template warnings[]; `mk bug fix` also prints `warning: ...` on stderr.
4. plan-parse reads scenario on phases and tasks (phase value copied to tasks that set none; bad value goes to missing[]); schema-v2.ts + MIGRATIONS entry 2; import.ts taskVals carries scenario.
5. snapshot settings.specTemplates is the real per-scenario status.
6. Tests: new test/server/spec-templates.test.mjs (T11); additions in db, import, cli and actions tests; db.test count tied to SCHEMA_VERSION.

Design calls
1. A line is dropped when every placeholder on it rendered empty. List values render as "\n- a\n- b", so `Acceptance:{{acceptance}}` vanishes when there are no items.
2. For bugs `{{code}}` is "bug B-1" (so the shared fix.md prints "Fix bug B-1: ..." as cli.test checks), `{{file}}` is "path:line" and `{{line}}` the bare number.
3. Old "Files you own: a, b" is now a "- " list under "Files you own:" (C10: lists render as "- " lines).
4. Bug briefs now also carry the {{rules}} section (the fix template is shared).
5. The cliInline stderr collector in actions.ts now adds a newline per message so a warning line cannot glue to a later error line.
6. A user template without {{rules}} reports ok:true with an issue note in the snapshot status (and appends rules + warns when rendering).

Gate: `npm run build && npm test && npx tsc --noEmit` — exit 0; tests 270, pass 270, fail 0.

## USE fix round

1. notify/collectStalls/collectLowQuota use tolerant readSettings; notify reads settings before the alert_sent insert. Test: notify.test.mjs T5.9. Probe p1 1c: key consumed, sent 1 (defaults used).
2. import.ts inFolder(): exact folder plus its archive/, not a string prefix. Test: consumers.test.mjs "T7 inbox: an inbox folder nested under the default prefix...". Probe p2: inbox/plans/x.md stays `new` after the default scan.
3. routes-check.ts refuses a model/effort starting with `-` or holding whitespace. Test: routes.test.mjs C9 guard. Probe p1 2f: refused as bad_route.
4. routes.ts and sync.ts collectLowQuota compare unrounded left; message rounds. Test: routes.test.mjs 60.4 vs 40 floor.
All four new tests failed on the pre-fix source (checked on a copy of HEAD) and pass now.
Gate: `npm run build && npm test && npx tsc --noEmit` exit 0; tests 274, pass 274, fail 0.
