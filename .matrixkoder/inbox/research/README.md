# Research index

Homework for wiring the MatrixKoder panel to real data and designing its settings.
Collected 2026-10-24 against Orca 1.4.239 (installed) and Orca source `orca/main`.

## Files

| File | What it covers |
|------|----------------|
| `orca-plugin-api.md` | Manifest, capabilities, panel sandbox and bridge, worker `host.call` methods, storage, dev reload |
| `orca-orchestration-bus.md` | `orchestration.db` tables, messages, tasks, gates, CLI JSON shapes, screen-to-source map |
| `orca-settings.md` | Where Orca keeps settings, theme tokens, plugin data folder, draft `mk-settings.json` keys |
| `orca-cli-reference.md` | Every `orca` command (1.4.239) with flags; JSON shapes of the read-only list commands |
| `mk-upstream-data-model.md` | Upstream `~/.matrixkoder` layout, SQLite schemas, inbox rules, settings keys |

Older notes, kept for history (each new file lists what they got wrong):
`orca-plugin-architecture.md`, `orca-orchestration-engine.md`, `orca-automations-and-commands.md`,
`claude-code-to-orca-migration.md`, `local-first-architecture-and-matrix-theme.md`, `matrixkoder_orca_mockup.md`.

## Key findings

1. The panel can call only three host actions: `workspace.readContext`, `terminal.sendText`,
   `notifications.show`. Checked in `src/shared/plugins/plugin-host-api.ts` on both the
   `v1.4.239` tag and `orca/main` (fetched 2026-10-24): unchanged.
2. There is no panel-to-worker channel. Events, storage, settings and file access are worker-only,
   so the worker cannot push live data into the panel on stock Orca.
3. The worker is unsandboxed Node with `HOME` set: it can read `~/.matrixkoder`, open
   `orchestration.db` read-only, and run `orca ... --json`. Unverified on a live run.
4. Plugins cannot add a section to Orca's Settings; MK keeps its 7 Settings tabs in its panel.
5. Settings recommendation: a JSON file, `~/.matrixkoder/mk-settings.json`; a db is not needed
   for settings. Orca plugin storage (`plugins-data/interstellar.matrixkoder/`) is an optional mirror.
6. Orca data covers Lanes, Waiting, Events and (when tasks are Orca tasks) Plan. Projects, Bugs
   and Todo have no Orca source; MK keeps its own (upstream `mk-overview.db` / `mk-project.db`).
7. Never call `orca orchestration check` from the dashboard: it consumes the mailbox. Use `inbox --json`.

## Open decisions

1. How live data reaches the panel, given finding 2.
2. Whether project settings stay in upstream's yaml (`project.yaml`) or move into the db `settings` table.
3. Whether MK data lives only in `~/.matrixkoder` (upstream) or also repo-local `.matrixkoder/`
   (the worker is not told the repo path, so repo-local is harder to find).
