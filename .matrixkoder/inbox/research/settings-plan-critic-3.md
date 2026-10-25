# Settings v2 plan: parallel Critic review (2026-10-25)

Reviewer: Opus Critic (opus, medium effort, read-only), brief `~/.codex/prompts/critic.md`. It ran at the same time as the review in `settings-plan-critic-2.md`, against the plan before that round was folded in.
Scope: C8 solo mode, C9 agent models and route check, C10 task spec templates (with mk-data.db migration 2), the SCREENS "rewire, not redesign" method line.

Verdict: REJECT, 11 findings. Six overlap `settings-plan-critic-2.md` and were already folded in by that round. The other five were folded in afterwards; block 9 (Log) records it.

## Already covered by the round in settings-plan-critic-2.md

| Id | Finding | Covered as |
|---|---|---|
| F1 | T4 tests USE.4's import check | import case moved to T7 |
| F2 | subdispatch fires on default `subagents` | subdispatch only by explicit scenario |
| F3 | built-in templates not staged | compiled into `src/store/spec-builtin.ts` |
| F4 | db/actions tests break, not owned | 4 test files owned by USE |
| F6 | "cannot be started" has no code | `plan.start` refuses `plan_partial` |
| F9, F10 | C10 path/placeholder rules, MODEL_SEED | placeholder union, rules append, MODEL_SEED |

## Folded in by this round

1. F5: C9 now checks Orca's launch rules (`orca-cli-reference.md:2099`): effort needs a model, no effort for omp or opencode, no effort for models with an empty `efforts` list. `task.start` checks the route after filling it from `agents.<id>`. Route agent `agy` maps to Orca `--agent antigravity` in `providers.ts`. T4 covers it.
2. F7: solo mode lanes share one checkout. The Work screen shows a hint when mode is solo and maxLanes > 1. New risk K7, with a live check in `test/manual/settings-v2.md`.
3. F8: C8 hides only controls that exist. Lanes: the branch line, the Worktree row and "N worktrees" (`Lanes.dc.html:105,117,269`). Projects: the worktree count and idle worktrees (`Projects.dc.html:134,212`). Plan has none, and Lanes has no new-lane control.
4. F11: SCREENS names the file renames and deletes. The screen count goes from 16 to 15 in `screens.test.mjs` and `contract.test.mjs:28`. Text size uses CSS `zoom` on the screen host, since the screens use px font sizes.
5. F11.4: `notify.test` is a SCHEMA.3 stub that refuses with `not_ready`, so `contract.test.mjs` passes on main whichever lane merges first. USE.2 makes it real.

## Verified by the reviewer as fine

The `--worktree path:<path>` selector is documented. Migration number 2 matches `MIGRATIONS` (`db.ts:23`). `test/store/import.test.mjs` exists. The C8-C10 line refs check out. Lanes A and B share no file.
