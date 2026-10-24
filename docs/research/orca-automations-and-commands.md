# Orca Automations & Command Surface Reference

Orca provides a background scheduler (Automations) and a comprehensive command surface for controlling projects, worktrees, terminals, agents, and headless browser sessions.

---

## 1. Orca Automations Engine (`orca automations`)

Automations in Orca allow scheduling unattended agent workflows (e.g. daily PR reviews, CI triaging, recurring dependency sweeps) with native worktree isolation and token cost optimization.

### Key Capabilities

1. **Scheduling Triggers (`--trigger` / `--schedule`):**
   - Presets: `hourly`, `daily`, `weekdays`, `weekly`.
   - Standard 5-field cron syntax: e.g. `"0 9 * * 1-5"`.
   - RFC 5545 recurrence rules (RRULE).
   - Timezone-aware scheduling (`--timezone <tz>`).

2. **Pre-Checks (`--precheck <command>`):**
   - **Token Cost Saver:** Runs a fast, local shell command before summoning an expensive LLM.
   - If the precheck command exits with code `0`, the agent runs.
   - If it exits non-zero, Orca skips the run without consuming tokens.
   - Example: `--precheck "gh pr list --json number -q .[0].number"` (only runs if open PRs exist).

3. **Workspace Isolation (`--workspace-mode`):**
   - `new-per-run`: Spawns a clean, disposable Git worktree from a base branch (`--base-branch <ref>`) for each automation run, keeping main branches pristine.
   - `existing`: Runs inside a dedicated ongoing workspace (`--workspace <selector>`).

4. **Multi-Host & Environment Routing:**
   - Runs locally or targets remote environments via SSH (`--host ssh:<target-id>`) or disposable container runtimes (`--host runtime:<env-id>`).

5. **Agent Configuration (`--extra-agent-args`):**
   - Pass model overrides and effort parameters:
     `--extra-agent-args="--model opus --effort high --add-dir docs"`

### Automation Commands

- `orca automations list`: List all active scheduled automations.
- `orca automations create`: Register a new automation.
- `orca automations run <id>`: Force-trigger an immediate run.
- `orca automations runs <id>`: Inspect execution history, logs, and outputs.
- `orca automations edit`: Modify schedules, prompts, or prechecks.
- `orca automations remove`: Delete an automation and its history.

---

## 2. Global Orca Command Catalog

Orca's CLI provides programmatic control over the entire development environment:

### Worktrees & Projects
- `orca project list` / `setup-clone`: Manage registered projects and host setups.
- `orca worktree create --name <name> --agent <agent>`: Spawn a new isolated worktree and start an agent.
- `orca worktree list` / `ps`: Show status, comments, and resource usage across active worktrees.
- `orca worktree set --comment "..."`: Attach metadata or status comments to a worktree.

### Terminals & PTY Control
- `orca terminal list --json`: Enumerate live terminal handles across workspaces.
- `orca terminal create --worktree <id> --command <cmd>`: Create a terminal session.
- `orca terminal send --terminal <id> --text "..." --enter`: Type text into an active PTY.
- `orca terminal read --terminal <id>`: Read bounded terminal output.
- `orca terminal wait --terminal <id> --for exit`: Block until a process exits or reaches idle state.

### Headless & Visual Browser
- `orca tab create --url <url>`: Open a browser tab inside Orca.
- `orca snapshot`: Generate an accessibility DOM tree with interactive element references (`@e1`, `@e2`).
- `orca click --element <ref>` / `fill --element <ref> --value "..."`: Drive browser interactions.
- `orca screenshot --format png`: Capture high-resolution viewport screenshots.

### Multi-Agent Orchestration
- `orca orchestration run-create`: Bind a coordination session.
- `orca orchestration task-create` / `task-list --ready`: Manage the DAG task queue.
- `orca orchestration worker-start` / `worker-stop`: Supervise agent processes.
- `orca orchestration send` / `check --wait` / `reply` / `ask`: Zero-disk-file inter-agent messaging.
