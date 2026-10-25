# MatrixKoder data folders

The MatrixKoder plugin for Orca uses two folders. Orca stays the source of truth for
projects, repos, worktrees (lanes), agents, terminals and orchestration runs, tasks, gates
and messages. These folders hold only what Orca does not have.

1. `<repo>/.matrixkoder/` lives in this repo and is committed: plans and their research.
2. `~/.matrixkoder/` lives in your home folder, stays on this machine, and is never committed:
   the plugin's database and settings.

The plugin does not read or write upstream MatrixKoder's stores (`mk-overview.db`,
`projects/*/mk-project.db`, `bus/`, `usage.json`), even though they share `~/.matrixkoder/`.

## Repo folder: `.matrixkoder/`

```text
.matrixkoder/
├── README.md                 this file
└── inbox/                    plan .md files waiting to be imported
    ├── <plan-id>.md          a plan, written from the upstream MK plan template
    ├── archive/              plans already imported (kept for history)
    ├── research/             research behind the plans
    │   ├── README.md         index of the research files and key findings
    │   ├── orca-*.md         Orca plugin API, CLI, orchestration bus, settings
    │   ├── screen-data-map.md   every dashboard field → its real source
    │   ├── mk-data-schema.md    mk-data.db tables, sync rules, screen → table map
    │   └── ...               older notes, kept for history
    └── assets/               mockups and screenshots
```

1. Plans are named `<plan-id>.md`, using lowercase letters, digits and dashes, for example
   `orca-dashboard-wiring.md`.
2. The Inbox screen lists the `.md` files at the top of `inbox/`. Folders inside it are not
   plans.
3. Importing a plan moves its file to `inbox/archive/` and records the import in `mk-data.db`.
4. `research/` and `assets/` are shared by all plans in this repo. Upstream MK keeps them
   inside each plan's own folder instead.
5. `.gitignore` keeps machine-local files out of git even if one lands here by mistake:
   `*.db*`, `*.lock`, `runs/`, `legacy/`, `bus/`, `backups/`, `usage.json` and `inbox/.deleted/`.

## Home folder: `~/.matrixkoder/`

```text
~/.matrixkoder/
├── mk-data.db                plugin database (SQLite): data Orca does not have
├── mk-settings.json          plugin settings, edited from the Settings tabs
│
│   shared with upstream MatrixKoder, not touched by the plugin:
├── mk-overview.db, projects/, bus/, inbox/, backups/, locks/
├── config.json, mk-settings.yaml, usage.json
```

1. `mk-data.db` holds what Orca lacks (plans with phases, tasks and subtasks, inbox files, bugs,
   todos, check results, decisions) plus a cached copy of Orca state (repos, worktrees, panes,
   runs, lanes, asks). The dashboard reads only this file; a sync loop in the worker fills the
   cached part from Orca. Tasks and bugs link to Orca tasks by id only. The full schema is in
   `inbox/research/mk-data-schema.md`.
2. `mk-settings.json` holds the keys behind the 7 Settings tabs. Settings Orca already owns
   (agents, notifications, theme mode, OS keybindings) are not copied. The Settings screen
   links to Orca for those. Draft keys are in `inbox/research/orca-settings.md`.
3. Only two programs write `mk-data.db`: the plugin worker (sync loop and dashboard actions)
   and the `mk` CLI that agents run (`mk bug add`, `mk todo`). Both use WAL mode with a 5 s
   busy timeout. Only the worker writes `mk-settings.json`.

## Where each kind of data lives

| Data | Lives in | Written by |
|------|----------|------------|
| Projects, worktrees, agents | Orca | Orca, `orca` CLI |
| Runs, tasks, gates, messages | Orca `orchestration.db` | `orca orchestration` CLI |
| Todos, bugs, plan detail | `~/.matrixkoder/mk-data.db` | plugin worker |
| Settings | `~/.matrixkoder/mk-settings.json` | plugin worker |
| Plans and research | `<repo>/.matrixkoder/inbox/` | you, agents |

## How the plugin uses these folders (0.2.0)

1. The sidebar panel is only a launcher. **MatrixKoder: Open Dashboard** (`Mod+Alt+D`, or `Cmd+J`
   and the command name) opens the live dashboard in an Orca browser tab. The worker serves it on
   `127.0.0.1` with a per-start token and reads `mk-data.db` for it; the command starts that server
   first if it is down and reuses an open dashboard tab.
2. Agents write bugs and to-dos with the `mk` CLI (`bin/mk.mjs` in the installed plugin copy,
   `~/Library/Application Support/Orca/plugins/interstellar.matrixkoder/<current>/`). The skill
   `skills/matrixkoder/SKILL.md` tells them when and how. `mk bug fix` asks Orca to create a task.
3. `MK_DATA_DIR` overrides `~/.matrixkoder/` for the worker and the CLI (used by the tests and by
   `test/manual/e2e.md`).
4. Undo: `mk-data.db` is new in 0.1.2. Deleting it loses only MatrixKoder's own data (bugs, todos,
   plans, history); Orca's data is untouched. To go back to an older plugin version, pin the
   marketplace `ref` to the earlier tag and use **Check for update**.
