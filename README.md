# Orca MatrixKoder

**MatrixKoder** is a visual multi-agent orchestration dashboard and lane supervisor plugin for the **Orca IDE** (`orca.dev`).

It connects your lead coordinator agent to parallel worker lanes across Git worktrees (Claude Code, Codex, AGY, OpenCode), rendering a real-time cyberpunk HUD sidebar with live wave progression, verification gates, and human approval inboxes.

![Orca IDE with MatrixKoder Sidebar](.matrixkoder/inbox/assets/matrixkoder_orca_ui_mockup.jpg)

---

## Features

- **Live dashboard in a browser tab:** one command opens it (see [Open the dashboard](#open-the-dashboard)). The sidebar panel is only a small launcher.
- **Matrix HUD look:** HTML/CSS/Canvas styled with Orca theme design tokens and an ambient digital rain animation.
- **Dashboard screens:**
  1. **Overview:** High-level stage progress, active wave meters, and fleet status summary.
  2. **Lanes:** Deep worker inspection with branch details, live diff links, and the 3-Gate Verification Matrix (Build / Test / Review).
  3. **Plan / DAG:** Wave-by-wave hierarchical task tracking with dependency gates.
  4. **Waiting on You:** Single-click approval inbox for blocking agent decisions and security checks.
  5. **Events:** Live streaming audit log of inter-agent bus messages and commits.
  6. **Inbox:** Staged plan importer with automatic template validation.
  7. **Bugs & Todo:** Integrated issue tracking with risk scoring and persistent session checklists.
  8. **Settings:** Orchestrator/Solo mode selection, safety tripwires, and animation controls.
- **Native Orca Engine Integration:** Directly leverages Orca's `orchestration.db` and live events (`agent.status.changed`, `worktree.created`).
- **Lean Architecture:** Completely offloads redundant file browsing and cron polling to Orca's built-in file tree and automations engine.

---

## Installation in Orca

### From GitHub (gets updates)

This repo is also an Orca plugin marketplace (`orca-marketplace.json`), so Orca can install the plugin and check it for updates.

1. Open **Orca Settings** (`Cmd+,`) › **Plugins**, open the marketplace **Sources**, and add `https://github.com/Interstellar-code/orca-matrixkoder.git` with ref `main`.
2. Install **MatrixKoder** from the list and accept its capabilities.
3. After a new release, click **Check for update** on the MatrixKoder card.

Each release moves the `ref` in `orca-marketplace.json` to the new tag (`v0.2.0` for this version).

### From a local build (development)

1. Open **Orca Settings** (`Cmd+,`).
2. Navigate to the **Plugins (EXPERIMENTAL)** tab.
3. Scroll to the **Development** section at the bottom.
4. Run `npm install && npm run build`, then enter the path to the staged `plugin/` folder
   (Orca refuses symlinks, so it cannot install the repo root):
   ```text
   <path-to-your-clone>/orca-matrixkoder/plugin
   ```
5. Click **Add path** and accept the requested capabilities (`workspace:read`, `terminal:send`, `notifications:show`, `events:subscribe`, `storage`).
6. The **MatrixKoder** icon (`layers`) appears in your right sidebar activity bar. Run **MatrixKoder: Open Dashboard** to see the live dashboard.

---

## Open the dashboard

The sidebar icon opens a small launcher panel. The dashboard itself runs in an Orca browser
tab, served by the plugin's worker on `127.0.0.1` (this machine only) with a fresh access token
on every start.

1. Press `Cmd+J`, then run **MatrixKoder: Open Dashboard**, or press `Opt+Cmd+D`
   (`Mod+Alt+D`). `Mod+Alt+M` still toggles the sidebar panel.
2. If the worker's server is not running, the command starts it first, then opens the tab at
   `http://127.0.0.1:<port>/?t=<token>`.
3. If a tab already shows this dashboard, the command brings it to the front instead of opening another.

Do not open `web/index.html` as a plain file: it has no server and no token, so it can only show stale sample data.

## The `mk` command and the agent skill

Agents file bugs and to-dos with the `mk` command, which ships inside the installed plugin
(`bin/mk.mjs`, run with `node`, Node 22.13 or newer). The marketplace install is a clone of this repo, so it contains `bin/`; the staged `plugin/` folder of a local build does not, so `mk` is only available from a marketplace install (or run `node bin/mk.mjs` in your clone). Orca keeps the installed copy under
`~/Library/Application Support/Orca/plugins/interstellar.matrixkoder/<version-folder>/`, and the
file `current` in that folder names the active version folder:

```bash
MK_PLUGIN="$HOME/Library/Application Support/Orca/plugins/interstellar.matrixkoder"
node "$MK_PLUGIN/$(cat "$MK_PLUGIN/current")/bin/mk.mjs" bug add --title "..." --details "..." --risk 3
```

Commands: `mk bug add | list | fix B-n | close B-n | reopen B-n`, `mk todo add | done | list`,
`mk subtask set`, `mk ask note`. `mk bug fix` creates an Orca task for the bug. Data lives in
`~/.matrixkoder/mk-data.db` (see `.matrixkoder/README.md`).

`skills/matrixkoder/SKILL.md` tells an agent when and how to run these. Orca 1.4's plugin manifest
has no field that installs skills (`contributes` allows only panels, commands, events, language
packs, keybindings, VM recipes and agent profiles), so the file ships inside the plugin but your agent
does not load it by itself. To use it, copy or link the `skills/matrixkoder/` folder from the
installed plugin copy into your agent's skills folder (for Claude Code: `~/.claude/skills/`).

---

## Development & Upstream Sync

This repository tracks two reference remotes (both have unrelated histories, so they are fetched, never merged):

1. `upstream`: MatrixKoder itself (`https://github.com/Interstellar-code/matrixkoder.git`), the orchestration logic this plugin follows.
2. `orca`: the official Orca IDE repository (`https://github.com/stablyai/orca.git`), for plugin API changes.

To set them up in a fresh clone:
```bash
git remote add upstream https://github.com/Interstellar-code/matrixkoder.git
git remote add orca https://github.com/stablyai/orca.git
```

To check both for updates:
```bash
npm run sync:orca
```

To build TypeScript worker changes:
```bash
npm run build
```

---

## Project Structure

```text
orca-matrixkoder/
├── orca-plugin.json         # Plugin manifest (ID, capabilities, panels, commands, keybindings, events)
├── orca-marketplace.json    # Lets Orca install the plugin from GitHub and check for updates
├── package.json             # Build scripts & dev dependencies
├── tsconfig.json
├── bin/mk.mjs               # The `mk` CLI for agents
├── src/
│   ├── worker.ts            # Out-of-process Node.js background worker
│   ├── commands/            # One module per worker command (open-dashboard, mk.state, mk.action)
│   ├── orca/                # Orca CLI adapter and action allowlist
│   ├── server/              # Local dashboard server, sync loop, actions
│   └── store/               # mk-data.db, the mk CLI, plan import
├── out/                     # Compiled output (npm run build)
├── panel/
│   ├── screens/*.dc.html    # One file per panel screen, from the design canvas (mock data inside)
│   ├── runtime.js           # Renders the screens; no framework, CSP-safe
│   └── fonts/               # Geist + Geist Mono (OFL), inlined at build
├── web/
│   ├── index.html           # The dashboard the worker serves (npm run build:panel)
│   └── launcher.html        # The sidebar launcher panel
├── skills/
│   └── matrixkoder/         # Agent skill: when and how to run `mk bug add|fix`, `mk todo add`
├── test/
│   ├── launch/              # Open Dashboard command and manifest tests
│   └── manual/e2e.md        # Hand-run end-to-end checklist (T8)
├── scripts/
│   ├── build-panel.mjs      # Builds web/index.html and web/launcher.html from panel/
│   └── sync-orca-upstream.sh# Upstream Orca sync script
└── .matrixkoder/            # MK data folder, same layout as upstream ~/.matrixkoder
    └── inbox/               # Plan .md files waiting to be imported
        ├── research/        # Orca plugin API, CLI, bus and settings research
        └── assets/          # UI mockups and screenshots
```

---

## License

MIT © Interstellar-code
