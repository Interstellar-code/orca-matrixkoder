# Changelog

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
