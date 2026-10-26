# Changelog

## 0.3.0 - 2026-10-26

Settings v2: every setting now changes what MatrixKoder does, and the screens show the saved values.

- Six Settings tabs: General, Routing & Quota, Work, Safety, Notifications, Appearance. The Agents, Alerts, Theme and Shortcuts tabs are gone. Settings Orca owns (OS notifications and sounds, light/dark theme, agent install and accounts, keybindings) appear as "Set in Orca: Settings > <pane>" notes and are never stored by MatrixKoder.
- Settings schema 2. An existing v1 `~/.matrixkoder/mk-settings.json` is migrated in memory on load (every changed value that still has a v2 home is kept; the General tab lists what was dropped or clamped). The file is not touched until the first save, which first copies the v1 file to `mk-settings.v1.bak.json`.
- Every key is read through one accessor by code that changes behaviour; a test fails on any dead key. Screens start from the saved values, so they survive a reload and an Orca restart. Ranges and options come from the schema.
- Routing by size and quota floors: `routing.bySize.*` picks the agent, model and effort for small, medium and large tasks; `quota.floor.*` with `quota.onBelowFloor` stops a task from starting on an agent whose quota is below its floor.
- Agent models list per agent (Orca launch rules: no effort without a model, none for omp or opencode) and a route check on every save and task start. Refusals: `bad_route`, `quota_floor`, `needs_confirm`, `plan_partial`.
- Notifier: events (agent asks, lane done, task failed, lane stalled, quota low) with per-event toggles, quiet hours, an optional wake of the orchestrator and a Test notification button.
- Safety: `task.start` for a task at or above the chosen risk level refuses with `needs_confirm` until confirmed; the dashboard asks you, an agent calling `mk.action` must pass `confirm: true`. Advisory rows (protected branches, never-run commands, ask before push) are only written into every task brief as rules; MatrixKoder cannot enforce them. Each row says which it is.
- Solo mode (`general.mode = solo`): work runs in the main checkout with in-session subagents, not Orca worktrees. Lanes and Projects hide worktree details, and the Work screen warns that parallel lanes share one checkout.
- Task spec templates per scenario (investigate, implement, subdispatch, review, fix): built-in templates, or your own file per scenario, fill in the brief MatrixKoder sends. Migration 2 of `mk-data.db` adds `plan_task.scenario`, so each task keeps its scenario.
- Appearance is applied app-wide: Matrix rain on/off, brightness and speed, reduced motion, text size and density.
- A plan with an invalid route shows as Partial and cannot start (`plan_partial`). Plan has a Start button for tasks with no Orca task yet; failed tasks show Retry instead.
- Manual live checks in `test/manual/settings-v2.md`.
- Version 0.3.0 in `package.json`, `package-lock.json`, `orca-plugin.json` and `orca-marketplace.json` (`ref` `v0.3.0`).

## 0.2.1 - 2026-10-25

Fix: the plugin no longer stops right after it starts.

- `mk.state` and `mk.action` are now declared in `orca-plugin.json`. Orca stops a plugin whose worker registers a command the manifest does not declare (`registered undeclared command mk.action`), so 0.2.0 was restarted and stopped in a loop.
- The worker now skips, and logs, any command module the manifest does not declare, so a missing declaration can no longer take the plugin down. A test checks every worker command against the manifest.

## 0.2.0 - 2026-10-25

One command opens the live dashboard in an Orca browser tab, and agents get a skill for filing bugs.

- Command `MatrixKoder: Open Dashboard` (`Mod+Alt+D`, global). It starts the dashboard server if it is not running, opens `http://127.0.0.1:<port>/?t=<token>` in an Orca browser tab, and brings an already open dashboard tab to the front instead of opening a second one.
- The sidebar panel is now a small launcher (`web/launcher.html`) that points to the command and shows no data. It no longer loads the dashboard as a plain file, which had no server port or token and could only show "Data may be stale".
- Worker commands start the dashboard service on demand: if it failed to start at activation, the next command starts it (one start at a time) instead of failing with "not running".
- Orca adapter: allowlisted action `tab switch` (page id, optional worktree, `--focus`) and a typed `tabList` read that returns page ids and bare addresses only (no token). The allowlist is now 10 actions.
- Agent skill `skills/matrixkoder/SKILL.md`: when to run `mk bug add`, `mk bug fix` and `mk todo add`, and how to find the shipped `bin/mk.mjs` inside the installed plugin. Orca 1.4 has no manifest field for skills, so the file ships with the plugin and is copied into the agent's skills folder by hand (see README).
- Docs: README (marketplace install and updates, Open Dashboard, `mk` CLI and skill), `.matrixkoder/README.md`, and a hand-run end-to-end checklist in `test/manual/e2e.md`.
- Version 0.2.0 in `package.json`, `package-lock.json`, `orca-plugin.json` and `orca-marketplace.json` (`ref` `v0.2.0`).

## 0.1.2 - 2026-10-25

The dashboard now runs on live data from Orca and the plugin's own database.

- Own database `~/.matrixkoder/mk-data.db` (SQLite, WAL) for bugs, todos, plans, cached Orca state and history, with daily backups and pruning. Settings in `~/.matrixkoder/mk-settings.json`.
- `mk` command for agents: `mk bug add|fix|close|reopen`, `mk todo add|done|list`, `mk subtask set`, `mk ask note`. `mk bug fix` starts the fix as an Orca task.
- Plan import from `<repo>/.matrixkoder/inbox/*.md`; re-import keeps Orca task links.
- Orca adapter: typed reads of worktrees, runs, tasks, workers, gates, inbox, terminals, repos and quota, with prompts stripped; a 9-action allowlist that can never call `orchestration check`.
- Local dashboard server on 127.0.0.1 with a per-start token: `/api/state`, `/api/events`, `/api/action` (25 actions with a 10 s Undo for approve and answer), a 10 s / 60 s sync loop, Orca event triggers and a keep-alive.
- All 16 screens render from live state every 5 s, keep their local UI state, show a stale banner when the server is unreachable, and show refused actions instead of hiding them.
- Worker commands `mk.state` and `mk.action`.

## 0.1.1 - 2026-10-24

Redesigned panel, rebuilt from the design canvas with mock data.

- 16 screens: Projects, Overview, Lanes, Plan (phase → task → subtask tree), Waiting, Events, Inbox, Bugs, Todo, and Settings with 7 sub-tabs.
- New Waiting screen for decision gates and agent questions.
- Footer shortcuts: Improve and Ask Jev; Matrix rain behind every screen.
- Geist and Geist Mono inlined, so fonts load under the panel CSP.
- Screens live in `panel/screens/`; `npm run build:panel` generates `web/index.html`.
- `upstream` remote now points at MatrixKoder; `npm run sync:orca` checks both remotes.

## 0.1.0 - 2026-10-24

First installable version.

- Orca plugin manifest with the MatrixKoder sidebar panel (8-tab Matrix HUD, static sample data).
- Worker that logs agent and worktree events, notifies when an agent finishes, and registers `sweep-lanes`.
- `npm run build` compiles the worker to ESM and stages a clean `plugin/` folder to install.
- Research notes on Orca's plugin API, orchestration engine and automations.
