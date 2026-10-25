# Settings v2 plan: second Critic review (2026-10-25)

Reviewer: Opus Critic (opus, medium effort, read-only), brief `~/.codex/prompts/critic.md`.
Scope: the parts added after the first two reviews: C8 solo mode, C9 agent models and route check, C10 task spec templates (with mk-data.db migration 2), and the SCREENS "rewire, not redesign" method line.

Verdict: REJECT, 21 findings (10 major, 11 minor). All are folded into `mk-settings-v2.md`; block 9 (Log) records the round.

## Simulations the reviewer ran against the code

1. Migration 2: `migrate()` (`src/store/db.ts:62-72`) applies v2 to a v1 database correctly; a nullable `ADD COLUMN` with a CHECK is valid. It breaks `test/store/db.test.mjs:102` (expects one `schema_version` row).
2. USE.5: `fixSpec` is at `src/store/cli.ts:219`. `scripts/stage-plugin.mjs` copies only `orca-plugin.json, out, web, skills`, so `templates/` would not ship in the local `plugin/` install.
3. C9: `parsePlan` sets `fit` with no settings (`plan-parse.ts:473`); `scanInbox`/`importFile` take no settings; `importFile` refuses only `not_a_plan` (`import.ts:353`); `planStart` never reads `fit` (`actions.ts:148-162`).

## Findings and how each was folded in

| Id | Sev | Finding | Folded in as |
|---|---|---|---|
| F1 | major | built-in templates not staged | compiled into `src/store/spec-builtin.ts`, T11 checks they match the .md files |
| F2 | major | migration 2 breaks db.test; gate skips it | SCHEMA_V2 SQL named; 4 test files owned by USE; USE.5 gate = full suite |
| F3 | major | subdispatch fires on default `subagents` | subdispatch only by explicit scenario |
| F4 | major | "cannot be started" has no code | `plan.start` refuses `plan_partial` (USE.4, T7) |
| F5 | major | T4 needs USE.4's import check | import case moved to T7; USE.4 covers C9 |
| F6 | minor | no settings path into import | `InboxTarget.settings`; callers pass `loadSettings` |
| F7 | major | lane B reads undefined snapshot keys | `general.mode` from values; `settings.specTemplates` placeholder in SCHEMA.1 |
| F8 | major | "new UI only for Work" contradicts tasks | new-UI list matches acceptance lines |
| F9 | major | T8 recorder skips T11 | T8 runs T4-T7 and T11 |
| F10 | major | shared fix placeholders unclear | placeholder union; empty renders and drops line |
| F11 | major | no `{{rules}}` drops rules | MK appends rules plus a warning |
| F12 | minor | G6 not served or gated; order | Serves and unit gate updated; G5 before G6 |
| F13 | minor | USE Carries and USE.4 covers wrong | Carries adds C8, C9; USE.4 retitled |
| F14 | minor | phase scenario has no column | copied into each task at import |
| F15 | minor | template path rules; MK_DATA_DIR | C1 path rules; resolves under dataDir() |
| F16 | minor | fixSpec line; renderer location | cli.ts:219; renderer in `src/store`; warnings out |
| F17 | minor | C1 model rule vs empty list | C1 model/effort rules follow models list |
| F18 | minor | seed "at build time"; AGY Claude ids | MODEL_SEED constant; AGY Claude ids included |
| F19 | minor | solo "one lane"; no T10 case | wording fixed; columns named; T10 solo case |
| F20 | minor | task.start refusal order | order fixed in C5, `needs_confirm` last |
| F21 | minor | subdispatch helpers vs solo | in-session subagents in solo mode |

## Choices the orchestrator made where the reviewer offered options

1. F1: compile built-ins into code, rather than adding `templates` to the stage script, so the marketplace install and the local install behave the same.
2. F4: block `plan.start` on a partial plan, keeping the plan's stated intent, rather than rewording C9.
3. F5: move the import test to T7 (USE.4), rather than moving the import check into USE.1.
4. F11: append the rules when a template lacks `{{rules}}`, so the Safety tab's "advisory: written into briefs" stays true.
5. F18: include the AGY-hosted Claude ids from models.md in the agy seed.
