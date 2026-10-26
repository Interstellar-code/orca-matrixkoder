# Handoff: settings v2 (orca-matrixkoder)

Written 2026-10-25 at the end of the planning session. Paste the prompt at the bottom into a new session started in `/Users/rohits/Development/orca-matrixkoder`.

## State

1. Plan: `.matrixkoder/inbox/mk-settings-v2.md` (plan id `mk-settings-v2`, status draft). It passes the repo's parser: `node -e "import('./out/store/plan-parse.js').then(p=>console.log(p.parsePlan(require('fs').readFileSync('.matrixkoder/inbox/mk-settings-v2.md','utf8')).fit))"` prints `pass`.
2. Not committed. Untracked files: the plan, this handoff, and `.matrixkoder/inbox/research/settings-inventory.md`, `settings-needs.md`, `settings-plan-review.md` (Sonnet review, 25 findings), `settings-plan-critic.md` (Opus Critic, REJECT, 19 findings). All findings are folded into the plan; block 9 Log records each round.
3. All 6 open questions are answered (block 8): drop unenforceable safety guards, `useJev` and low-confidence; keep `general.mode` with solo = main checkout + subagents + lane UI hidden (C8); upstream quota floors with `block`; route catalog later; one global settings file; release 0.3.0.
4. Second Opus Critic pass done (REJECT, 21 findings, all folded in; `research/settings-plan-critic-2.md`). It covered these parts, added after the first pass: solo mode (C8), agent models list and route check (C9), the SCREENS "rewire, not redesign" method line, and task spec templates per scenario (C10: `work.specTemplates.investigate|implement|subdispatch|review|fix`, built-ins in `templates/spec/`, new task USE.5, test T11, Work screen section, goal G6, mk-data.db migration 2 adding `plan_task.scenario`).
5. Main is clean at `46429174148` apart from the untracked files above. Orca v1.4.240 does not include the panel-to-worker fix (stablyai/orca PR #25256 still open), so the dashboard stays in an Orca browser tab.

## Plan shape

1. SCHEMA (lane A): schema 2 keys (C1), in-memory v1 migration (C2), schema description (C3), settings actions (C4), agent models seed and `checkRoute` (C9).
2. USE (lane A, after SCHEMA): routing by size and quota floors (C5), notifier (C6), confirm before high-risk tasks and advisory brief rules (C7), solo mode backend (C8), remaining consumers, route check in import and task.start, then USE.5 task spec templates (C10).
3. SCREENS (lane B, after SCHEMA merges): rewire the existing canvas screens; SCREENS.1 tab list + bind helper + General, then SCREENS.4 Appearance app-wide, then SCREENS.2 and SCREENS.3 in parallel.
4. SHIP (main): dead-key test T8 on the merged tree, rebuild `out/` and `web/`, version 0.3.0 (package.json, orca-plugin.json, orca-marketplace.json `plugins[0].source.ref`), CHANGELOG.
5. Builders: claude sonnet medium, except SCREENS (lane B) on agy gemini-3.8-flash-medium (routes are written in the plan; use them, no Jev routing for them). Reviewers: claude opus high for SCHEMA and USE, agy gemini-3.8-flash-medium for SCREENS and SHIP; the Critic gate is claude opus medium.

## Next steps, in order

1. Second Opus Critic pass on the plan (read-only; brief from `~/.codex/prompts/critic.md`), focused on C8, C9, C10 and the SCREENS method line. Fold fixes in; re-run the parser.
2. Show the user the verdict; on their go, commit the plan and research files (`docs(plan): settings v2 ...`).
3. Execute per the plan through Orca (orchestration skill): lane A worktree for SCHEMA then USE; lane B for SCREENS after SCHEMA merges; SHIP on main. Lanes never stage `out/` or `web/`.

## Rules to carry

1. Plans live in `.matrixkoder/inbox/`, not `docs/plans/`; they no longer need upstream `mk-plan.py check`.
2. Each release bumps `orca-marketplace.json` `plugins[0].source.ref` to the new tag.
3. Orca is the source of truth; MK-only data in `~/.matrixkoder/mk-data.db`, settings in `~/.matrixkoder/mk-settings.json`.

## Prompt for the new session

```
Implement the settings v2 plan in orca-matrixkoder (/Users/rohits/Development/orca-matrixkoder).
Read .matrixkoder/inbox/mk-settings-v2-handoff.md first, then the plan .matrixkoder/inbox/mk-settings-v2.md.

1. Gate: run a second Opus Critic review of the plan (read-only subagent, brief from ~/.codex/prompts/critic.md), focused on the unreviewed parts: C8 solo mode, C9 agent models and route check, C10 task spec templates (incl. mk-data.db migration 2), and the SCREENS rewire method. Fold its fixes in, re-run the plan parser (must print pass), and show me the verdict. Stop and wait for my go.
2. On my go: commit the plan, handoff and research files on main (docs(plan): settings v2 ...).
3. Execute through Orca (load the orchestration skill): lane A worktree runs SCHEMA then USE (USE.1 to USE.5 in order); lane B worktree runs SCREENS once SCHEMA is merged (SCREENS.1, then SCREENS.4, then SCREENS.2 and SCREENS.3); SHIP on main after both merge. Use the routes and reviewers written in the plan exactly (builders claude sonnet medium; reviewers claude opus high for SCHEMA and USE, agy gemini-3.8-flash-medium for SCREENS and SHIP; Critic claude opus medium); no Jev routing for them and no extra agents. Each task's gate must pass before its phase is reviewed; a separate reviewer approves each phase before merge. Lanes never stage out/ or web/.
4. Report status after each phase merge; stop and ask before SHIP's version bump and before any push.
```
