# Orca CLI reference

Captured 2026-10-24 from `orca` 1.4.239 (`/Applications/Orca.app/Contents/Resources/bin/orca`, a wrapper for `out/cli/index.js`). Covers 230 command pages and 19 group pages. Every command was read from its own `--help`, and the sections below record the one-line purpose and flags for each.

## How this was built

1. Ran `orca --version` (1.4.239) and `orca --help`, then `--help` for every group and every subcommand. Total 249 command paths.
2. The CLI resolves `--help` before dispatch (`out/cli/index.js` lines 64-75), so help never reaches the Orca runtime.
3. Ran `orca skills get orca-cli --full` and `orca skills get orchestration` (read-only, Markdown printed).
4. Ran these `--json` list commands, all read-only: `project list`, `repo list`, `worktree list`, `worktree ps`, `host list`, `tab list`, `terminal list`, `automations list`. There is no `automation list`; the real name is `automations list`.
5. No command that creates, sends, launches, opens, switches, closes, removes, sets or navigates was run.

## Capture log

1. First capture pass: 150 of 204 pages came back as `Unknown command`. Cause was my own shell loop, not Orca: the shell is zsh, which does not split `$p` into words, so `orca "reference list" --help` was sent as one argument. Fixed with `${=p}`; all 204 then returned help (exit 0).
2. Group help listed 45 subcommands my first list had missed (`host name`, `environment status` and six more, `orchestration request-show`, 35 `linear` pages, 7 `emulator` pages). Captured them too: 249 pages total, all exit 0.
3. No other failures. No Orca command failed.

## Global conventions

1. Most commands need a running runtime. If Orca is not open, run `orca open` (or `orca serve` for headless). Remote runtimes take `--environment <selector>` or `--pairing-code <code>`, or the env vars `ORCA_ENVIRONMENT` / `ORCA_PAIRING_CODE`. Never paste a pairing code into a file or chat.
2. `--json` gives machine-readable output on every data command. Every JSON reply has the envelope `{"id", "ok", "result", "_meta": {"runtimeId"}}`.
3. `--help` prints usage and exits 0 on every path. It is not listed as a flag below.
4. Selectors name a repo, worktree or host. Repo: `id:<id>`, `name:<name>`, `path:<path>`. Worktree: `identity:<identity>`, `id:<repoId>::<path>`, `name:<displayName>`, `branch:<branch>`, `issue:<number>`, `path:<path>`, or `active` / `current`. Host: `--host local` or a host id from `orca host list`.
5. Terminal handles (`term_<uuid>`) come from `orca terminal list --json` and are used for repeated live terminal operations.
6. The `ORCA` placeholder in the skill guides means the `orca` executable. Dev builds use `orca-dev`.

## Skill guide additions (not in --help)

### orca-cli guide (`orca skills get orca-cli --full`)

1. Prefer `--json` for agent calls. If the CLI is missing, say so; do not read source code first.
2. Full handoff (give work to another agent or worktree, then stop the original agent): use `orca worktree create --name <task> --no-parent --agent <id> --prompt "<brief>" --json`. Done when `result.launch.prompt.outcome` is `journaled` or `handed-to-terminal`. Do not use `orchestration task-create`, `dispatch --inject` or `check --wait` for handoffs.
3. `worktree create --agent` starts a new checkout; `agent launch --worktree <sel>` starts an agent in an existing one. Both accept `--model`, `--effort`, `--surface chat|terminal`, and `--retry-launch <operationId>` to re-issue a lost reply safely.
4. `terminal send` returns a receipt. `accepted: true` means input was accepted, not that a turn started. Use `--wait-submit <seconds>` to observe the turn start. Never resend on silence; after an ambiguous failure, repeat the exact command with `--retry-request <id>`.
5. Use `terminal read` before `terminal send` unless the next input is obvious. For long output, page with `nextCursor` while `limited` is true.
6. Use `terminal wait --for tui-idle --timeout-ms <ms>` for agent CLIs (always pass a timeout).
7. `terminal close --worktree <sel> --all` stops every terminal in that worktree and removes its tabs. Use workspace Sleep to pause instead of close when the agents should resume later. `terminal stop` is legacy.
8. `terminal switch --environment <name>` moves the desktop app on this machine to a paired server's terminal.

### orchestration guide (`orca skills get orchestration`)

1. This is the coordinator loop for supervised workers: one Run per objective, then tasks, dispatches, and a mailbox. Canonical start: `orca status --json`, `orca orchestration run-create --objective "<text>" --json`, then `orca orchestration worker-start --spec "<task>" --worktree current --agent <id> --json` per worker, then `orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms <ms> --json`.
2. If `worker-start` exits non-zero, do not relaunch. Read `failedStage` and `residualResources` from the receipt and follow the recovery reference.
3. Stop, abandon or retry a worker only on positive proof of exit. Any other observation, including silence, is a checkpoint and the state is reported as `unverifiable`.
4. Use `task-create` plus `worker-start --task <id>` only for planned fan-out with dependencies. Keep chains shallow (three or four steps).
5. A consuming `check` names its caller with `--terminal <handle>`, not `--from`.

## Read-only JSON shapes

Captured from this machine on 2026-10-24. Values are trimmed to one example item. Paths, UUIDs and the machine name are placeholders. Each `[]` is a list of that item shape; a second item has the same fields.

### `orca project list --json` (4 items)

```json
{"ok": true, "result": {"projects": [{
  "id": "github:<owner>/<repo>", "displayName": "<repo>", "badgeColor": "#737373",
  "repoIcon": {"type": "image", "src": "<url>", "source": "github", "label": "<owner>/<repo>"},
  "kind": "git",
  "providerIdentity": {"provider": "github", "owner": "<owner>", "repo": "<repo>"},
  "gitRemoteIdentity": {"canonicalKey": "github.com/<owner>/<repo>", "remoteName": "origin", "remoteUrl": "<url>"},
  "sourceRepoIds": ["<uuid>"], "createdAt": 1792462996211, "updatedAt": 1792462996211}]}}
```

### `orca repo list --json` (4 items)

```json
{"ok": true, "result": {"repos": [{
  "id": "<uuid>", "path": "/Users/<user>/...", "displayName": "<repo>", "badgeColor": "#737373",
  "addedAt": 1792462996211, "kind": "git", "externalWorktreeVisibilityLegacy": false,
  "gitUsername": "<owner>", "repoIcon": {"type": "image", "src": "<url>", "source": "github", "label": "<owner>/<repo>"},
  "upstream": null,
  "gitRemoteIdentity": {"canonicalKey": "...", "remoteName": "origin", "remoteUrl": "<url>"},
  "projectHostSetupMethod": "imported-existing-folder",
  "hookSettings": {"mode": "auto", "setupRunPolicy": "run-by-default", "setupAgentStartupPolicy": "start-immediately", "scripts": {"setup": "", "archive": ""}},
  "externalWorktreeVisibility": "hide"}]}}
```

### `orca worktree list --json` (8 items, `totalCount`, `truncated`)

```json
{"ok": true, "result": {"worktrees": [{
  "id": "<repoId>::/Users/<user>/...", "identity": {"key": "...", "executionHostId": "local", "instanceId": "<uuid>"},
  "instanceId": "<uuid>", "repoId": "<uuid>", "projectId": "github:<owner>/<repo>", "hostId": "local",
  "projectHostSetupId": "<uuid>", "path": "/Users/<user>/...", "head": "<sha>", "branch": "refs/heads/main",
  "isBare": false, "isMainWorktree": true, "displayName": "main", "displayNameMode": "automatic", "comment": "",
  "linkedIssue": null, "linkedPR": null, "linkedLinearIssue": null, "linkedGitLabMR": null, "linkedGitLabIssue": null,
  "linkedBitbucketPR": null, "linkedAzureDevOpsPR": null, "linkedGiteaPR": null, "linkedWorkItem": null,
  "isArchived": false, "isUnread": false, "isPinned": false, "sortOrder": 1792867169423, "lastActivityAt": 1792828378880,
  "workspaceStatus": "in-progress", "parentWorktreeId": null, "childWorktreeIds": [], "lineage": null,
  "git": {"path": "/Users/<user>/...", "head": "<sha>", "branch": "refs/heads/main", "isBare": false, "isMainWorktree": true},
  "linkedItems": []}],
  "hostScope": {"hostIds": ["local"], "omittedHostIds": []}, "totalCount": 8, "truncated": false}}
```

### `orca worktree ps --json` (8 items, the orchestration summary)

```json
{"ok": true, "result": {"worktrees": [{
  "workspaceKind": "git", "worktreeId": "<repoId>::/Users/<user>/...", "repoId": "<uuid>", "hostId": "local",
  "terminalPlatform": "darwin", "repo": "<repo>", "path": "/Users/<user>/...", "branch": "refs/heads/main",
  "isArchived": false, "isMainWorktree": true, "hasHostSidebarActivity": true, "defaultBranch": true,
  "worktreeInstanceId": "<uuid>", "parentWorktreeId": null, "childWorktreeIds": [], "displayName": "main",
  "workspaceStatus": "in-progress", "sortOrder": 1792867175423, "lastActivityAt": 1792867160085,
  "linkedIssue": null, "linkedPR": null, "linkedLinearIssue": null, "linkedGitLabMR": null, "linkedGitLabIssue": null,
  "linkedItems": [], "comment": "", "isPinned": false, "isActive": true, "unread": false,
  "liveTerminalCount": 1, "hasAttachedPty": true, "unverifiableTerminalCount": 0, "lastOutputAt": 1792867387839,
  "preview": "<terminal tail, may hold user content>", "status": "working", "terminalVerdict": "live",
  "agents": [{"paneKey": "<id>", "parentPaneKey": null, "state": "working", "agentType": "claude",
    "prompt": "<text>", "taskTitle": "<text>", "displayName": "<text>", "lastAssistantMessage": "<text>",
    "toolName": "<name>", "toolInput": {}, "interrupted": false,
    "mainAgent": {"state": "working", "stateStartedAt": 1792867000000}, "stateStartedAt": 1792867000000,
    "updatedAt": 1792867160085,
    "subagents": [{"id": "<id>", "state": "done", "startedAt": 1792867000000, "agentType": "<type>", "description": "<text>"}],
    "programStatus": {"state": "<state>", "message": "<text>", "observedAt": 1792867160085},
    "subagentObservation": {}}]}],
  "hostScope": {"hostIds": ["local"], "omittedHostIds": []}, "totalCount": 8}}
```

Observed values: `status` is `active`, `inactive` or `working`; `terminalVerdict` is `live` or `none`; `agents[].state` is `working` or `done`; `agents[].agentType` is `claude` or `omp`.

### `orca host list --json` (13 items)

```json
{"ok": true, "result": {"hosts": [{
  "kind": "local", "name": "this machine", "id": "local", "selector": "--host local",
  "machineName": "<machine name>", "platform": "darwin"}]}}
```

### `orca tab list --json` (1 item, browser tabs)

```json
{"ok": true, "result": {"tabs": [{
  "browserPageId": "<uuid>", "index": 0, "url": "file:///Users/<user>/...", "title": "<title>",
  "active": true, "loadError": null, "certificateFailure": null,
  "worktreeId": "<repoId>::/Users/<user>/...", "profileId": "default", "profileLabel": "Default"}]}}
```

### `orca terminal list --json` (7 items, `totalCount`, `truncated`, `hostScope`, `topologyRevisions`)

```json
{"ok": true, "result": {"terminals": [{
  "handle": "term_<uuid>", "ptyId": "<uuid>::/Users/<user>/...", "incarnationId": "<uuid>", "orphaned": false,
  "worktreeId": "<repoId>::/Users/<user>/...", "worktreePath": "/Users/<user>/...", "branch": "refs/heads/<name>",
  "tabId": "<uuid>", "leafId": "<uuid>", "title": "<title>", "connected": true, "writable": true,
  "lastOutputAt": 1792867388550, "preview": "<terminal tail, may hold user content>",
  "executionHostId": "local", "agentIdentity": "claude"}],
  "hostScope": {"hostIds": ["local"], "omittedHostIds": []}, "topologyRevisions": {"<repoId>::<path>": 6},
  "totalCount": 7, "truncated": false}}
```

`agentIdentity` is `claude` or `null`.

### `orca automations list --json` (empty here)

```json
{"ok": true, "result": {"automations": [], "items": [], "orphanCount": 0}}
```

Each `automations` item was not captured because the list was empty. `orca automations show --help` gives its selector.


## Startup, discovery and diagnostics

### `orca open`

Purpose: Launch Orca and wait for the runtime to be reachable

```text
orca open [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

Example: `orca open`

### `orca serve`

Purpose: Start an Orca runtime server without opening a desktop window

```text
orca serve [--port <port>] [--pairing-address <host>] [--mobile-pairing] [--no-pairing] [--grant-desktop-control] [--project-root <path>] [--recipe-json] [--supervise] [--force] [--reclaim-stale-lock [--data-root <dir>] [--yes]] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--port`
5. `--pairing-address`
6. `--mobile-pairing`
7. `--no-pairing`
8. `--grant-desktop-control`
9. `--project-root`
10. `--recipe-json`
11. `--supervise`
12. `--force`: Force worktree removal when supported; does not force branch deletion
13. `--reclaim-stale-lock`
14. `--data-root`
15. `--yes`
16. `--page <id>`: Stable browser page id from `orca tab list --json`
17. `--pairing-address`: changes only the client-advertised address; use a reachable LAN, Tailscale, SSH-forward, or reverse-proxy endpoint.
18. `--reclaim-stale-lock`: starts nothing. When a start refuses because this profile's lock may belong to an Orca on another machine sharing this home (for example after a reboot, on a network home), it checks that the lock was written on a host with this name in an earlier boot, is at least 2 minutes old, and that nothing answers on this machine at its holder's endpoints. Those checks cannot rule out another machine with the same host name, so it then only prints what it found (exit 2); add --yes, once you are sure no other machine sharing this home runs Orca for this profile, to clear it (exit 0). It exits 1 when a check fails and 4 when there is no lock. --data-root names the data root the refusal printed. --json prints the status (none, eligible, refused or reclaimed). Linux only.
19. `--supervise`: is for service managers (launchd, systemd). Orca serve then restarts the server itself with growing delays instead of exiting when it stops, waits while an update replaces the app, and waits while another Orca serves this profile. After 6 failures in 15 minutes it gives up and exits with code 0 so the manager stops too, and later supervised runs refuse until a new build is installed or --force is passed. Not available on Windows yet.

Example: `orca serve`

### `orca status`

Purpose: Show app/runtime/graph readiness

```text
orca status [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

Example: `orca status`

### `orca agent-context`

Purpose: Print the machine-readable command schema for agents

```text
orca agent-context [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

Example: `orca agent-context --json`

### `orca search`

Purpose: Search the full text of agent sessions indexed on the selected Orca host

```text
orca search <query> [--scope conversation|all] [--fresh] [--limit <n>] [--cursor <c>] [--agent <id>] [--path <p>] [--since <iso>] [--sort relevance|newest] [--debug] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--query <text>`: Search text; also accepted as the positional argument
5. `--scope <corpus>`: conversation (user and assistant turns) or all (default)
6. `--fresh`: Wait up to 5s for the host to reconcile its index first
7. `--limit <n>`: Hits per page (default 20, maximum 100)
8. `--cursor <cursor>`: Opaque cursor printed by the previous page of this search
9. `--agent <id>`: Restrict to one agent; repeat for several
10. `--path <path>`: Restrict to an execution-host path; repeat for several
11. `--since <iso>`: Only sessions updated at or after this ISO 8601 timestamp
12. `--sort <order>`: relevance (default) or newest
13. `--debug`: Include the planner route the host used
14. `--index-status`: Report the index instead of searching
15. `--scope`: conversation searches user and assistant turns only; --scope all (the default) also searches commands and tool output.
16. `--fresh`: waits up to five seconds for the host to reconcile its index before searching, then searches anyway.
17. `--agent`: and --path may be repeated. --path is a literal execution-host path and is not expanded or resolved against the current directory.
18. `--since`: takes an ISO 8601 timestamp with an offset, for example 2026-08-01T00:00:00Z.
19. `--limit`: is per page (default 20, maximum 100). Pass the printed cursor back with --cursor to read the next page.
20. `--json`: prints the runtime response envelope with the search contract answer under `result`.

Example: `orca search "strict mode violation getByRole"`

### `orca diagnostics` (group)

Usage: `orca diagnostics <command> [options]`. Subcommands: `memory`.

### `orca diagnostics memory`

Purpose: Collect a memory snapshot for Orca and managed terminals

```text
orca diagnostics memory [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

Example: `orca diagnostics memory --json`


## References, accounts and skills

### `orca reference` (group)

Usage: `orca reference <command> [options]`. Subcommands: `list`, `add`, `remove`, `find`.

### `orca reference list`

Purpose: List the reviews and issues attached to a workspace

```text
orca reference list --worktree <selector> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca reference add`

Purpose: Attach reviews or issues to a workspace

```text
orca reference add <url-or-jira-key>... --worktree <selector> [--reference-site <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--url <url-or-jira-key>`: Full review/issue URL or Jira key; use positionals or repeated --url
6. `--reference-site <id>`: Jira site for bare keys; see orca jira connection

Example: `orca reference add https://github.com/acme/api/pull/5123 https://linear.app/acme/issue/STA-1234 --worktree name:api`

### `orca reference remove`

Purpose: Detach reviews or issues from a workspace

```text
orca reference remove [<url>...] [--key <key>...] --worktree <selector> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--url <url>`: Full review or issue URL; pass all URLs positionally or all as repeated --url
6. `--key <key>`: Opaque key from reference list; repeat for several

### `orca reference find`

Purpose: Find workspaces and agents associated with a review or issue

```text
orca reference find <url-or-issue-key> [--worktree <selector>|--repo <selector>] [--include-archived] [--limit <n>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--query <url-or-key>`: Full URL or native issue key such as STA-1234
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--repo <selector>`: Filter by workspace repository membership
7. `--include-archived`: Include archived workspaces
8. `--limit <n>`: Maximum matching workspaces (default 50)

Example: `orca reference find STA-1234 --json`

### `orca account` (group)

Usage: `orca account <command> [options]`. Subcommands: `add`, `list`, `select`, `rm`.

### `orca account add`

Purpose: Add a managed agent account by signing in on this Orca host

```text
orca account add [--agent claude|codex|opencode|devin] [--label <name>] [--integration <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--agent <id>`: Account provider: claude, codex, opencode, or devin (default claude)
5. `--label`
6. `--integration`
7. `--agent`: defaults to claude. Requires the Orca runtime to be running on this machine.

Example: `orca account add`

### `orca account list`

Purpose: List managed agent accounts on this Orca host

```text
orca account list [--agent opencode|devin] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--agent <id>`: Account provider: opencode or devin

Example: `orca account list`

### `orca account select`

Purpose: Select an OpenCode or Devin profile for new agent launches

```text
orca account select --agent opencode|devin --account <id|system> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--agent <id>`: Account provider: opencode or devin
5. `--account`

### `orca account rm`

Purpose: Remove a managed OpenCode or Devin profile and its private data

```text
orca account rm --agent opencode|devin --account <id> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--agent <id>`: Account provider: opencode or devin
5. `--account`

### `orca skills` (group)

Usage: `orca skills <command> [options]`. Subcommands: `installed`, `share`, `list`, `get`, `install`, `update`.

### `orca skills installed`

Purpose: List installed skill selectors

```text
orca skills installed [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

### `orca skills share`

Purpose: Publish explicitly selected installed skills behind one unlisted link

```text
orca skills share --skill <selector> [--skill <selector> ...] --bundle-name <name> [--release-notes <text>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--skill <name>`: Bundled skill to act on; repeat for several
5. `--bundle-name`
6. `--release-notes`

Example: `orca skills share --skill frontend --bundle-name "Frontend Skills"`

### `orca skills list`

Purpose: List version-matched skill guides bundled with this Orca CLI

```text
orca skills list [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

### `orca skills get`

Purpose: Print a version-matched skill guide as Markdown

```text
orca skills get <topic> [--full | --reference <name>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--topic`
5. `--full`: Print the full guide with bundled references
6. `--reference <name>`: Print one bundled reference by name
7. `--references`: List the bundled reference names for a topic

Example: `orca skills get orca-cli`

### `orca skills install`

Purpose: Install bundled Orca skills on this machine

```text
orca skills install [--skill <name>]... [--all] [--agent <name>[,<name>]] [--local] [--force] [--dry-run] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--skill <name>`: Bundled skill to act on; repeat for several
5. `--all`
6. `--agent <names>`: Comma-separated install targets; default is detected agents
7. `--local`: Target the current project instead of the global install
8. `--force`: Force worktree removal when supported; does not force branch deletion
9. `--dry-run`

Example: `orca skills install --skill orca-cli --skill orchestration`

### `orca skills update`

Purpose: Update Orca skills to the version this Orca build ships

```text
orca skills update [--skill <name>]... [--all] [--agent <name>[,<name>]] [--local] [--force] [--dry-run] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--skill <name>`: Bundled skill to act on; repeat for several
5. `--all`
6. `--agent <id>`: Launch a known TUI agent in the first terminal
7. `--local`: Target the current project instead of the global install
8. `--force`: Force worktree removal when supported; does not force branch deletion
9. `--dry-run`

Example: `orca skills update --all`


## Hosts, environments and recipes

### `orca host` (group)

Usage: `orca host <command> [options]`. Subcommands: `name`, `list`.

### `orca host list`

Purpose: List every machine this Orca host can target, and how to name each one

```text
orca host list [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--page <id>`: Stable browser page id from `orca tab list --json`
5. `--environment`: and --pairing-code are rejected rather than ignored: paired servers come from this machine’s pairing store, so a routed answer would describe two machines at once.

Example: `orca host list`

### `orca environment` (group)

Usage: `orca environment <command> [options]`. Subcommands: `add`, `list`, `show`, `rm`, `status`, `update`, `rollback`, `recover`, `stop`, `forget`, `cancel-stop`.

### `orca environment add`

Purpose: Save a remote Orca runtime environment from a pairing code

```text
orca environment add --name <name> --pairing-code <code> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--name <name>`: Name for the new worktree or automation
5. `--page <id>`: Stable browser page id from `orca tab list --json`

Example: `orca environment add --name work-laptop --pairing-code orca://pair?code=...`

### `orca environment list`

Purpose: List saved Orca runtime environments

```text
orca environment list [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca environment show`

Purpose: Show one saved Orca runtime environment

```text
orca environment show --environment <selector> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca environment rm`

Purpose: Remove one saved Orca runtime environment

```text
orca environment rm --environment <selector> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca vm` (group)

Usage: `orca vm <command> [options]`. Subcommands: .

### `orca vm recipe`

Purpose: doctor             Validate a per-workspace environment recipe without provisioning by default

```text
orca vm recipe <command> [options]
```

Flags: none beyond `--help`.

### `orca vm recipe doctor`

Purpose: Validate a per-workspace environment recipe without provisioning by default

```text
orca vm recipe doctor <recipe-id> [--repo-path <path>] [--provision|--connect] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--recipe-id`
5. `--repo-path`
6. `--provision`
7. `--connect`
8. `--page <id>`: Stable browser page id from `orca tab list --json`

Example: `orca vm recipe doctor cloud-sandbox`

### `orca host name`

Purpose: Show or set the name this Orca runtime reports to connected clients

```text
orca host name [--name <name>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--name <name>`: Name for the new worktree or automation
5. `--page <id>`: Stable browser page id from `orca tab list --json`

Example: `orca host name`

### `orca environment status`

Purpose: Show a managed Orca server’s active version, terminals and pending work

```text
orca environment status --environment <selector> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--page <id>`: Stable browser page id from `orca tab list --json`
5. `--environment`: names a managed Orca server this machine deployed over SSH (see `orca environment list`); it is a selector here, not a routing flag.

Example: `orca environment status --environment build-box`

### `orca environment update`

Purpose: Update a managed Orca server to this build’s version

```text
orca environment update --environment <selector> [--force] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--force`: Restart over running terminals instead of deferring the update
5. `--page <id>`: Stable browser page id from `orca tab list --json`
6. `--environment`: names a managed Orca server this machine deployed over SSH (see `orca environment list`); it is a selector here, not a routing flag.

Example: `orca environment update --environment build-box`

### `orca environment rollback`

Purpose: Roll a managed Orca server back to its previous version

```text
orca environment rollback --environment <selector> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--page <id>`: Stable browser page id from `orca tab list --json`
5. `--environment`: names a managed Orca server this machine deployed over SSH (see `orca environment list`); it is a selector here, not a routing flag.

### `orca environment recover`

Purpose: Finish or undo a managed Orca server’s interrupted update, rollback or stop

```text
orca environment recover --environment <selector> [--accept-changed-state --yes] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--accept-changed-state`: Restore the prelaunch snapshot over state a rejected build changed
5. `--yes`: Confirm discarding what the rejected build changed
6. `--page <id>`: Stable browser page id from `orca tab list --json`
7. `--environment`: names a managed Orca server this machine deployed over SSH (see `orca environment list`); it is a selector here, not a routing flag.

Example: `orca environment recover --environment build-box`

### `orca environment stop`

Purpose: Stop a managed Orca server and unlink it from this machine (decommission)

```text
orca environment stop --environment <selector> --yes [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--yes`: Confirm stopping the server and unlinking it from this machine
5. `--page <id>`: Stable browser page id from `orca tab list --json`
6. `--environment`: names a managed Orca server this machine deployed over SSH (see `orca environment list`); it is a selector here, not a routing flag.

Example: `orca environment stop --environment build-box --yes`

### `orca environment forget`

Purpose: Unlink a managed Orca server whose SSH host is gone, without stopping it

```text
orca environment forget --environment <selector> --yes [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--yes`
5. `--page <id>`: Stable browser page id from `orca tab list --json`
6. `--environment`: names a managed Orca server this machine deployed over SSH (see `orca environment list`); it is a selector here, not a routing flag.

Example: `orca environment forget --environment build-box --yes`

### `orca environment cancel-stop`

Purpose: Withdraw a managed Orca server stop that orcad has not acted on yet

```text
orca environment cancel-stop --environment <selector> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--page <id>`: Stable browser page id from `orca tab list --json`
5. `--environment`: names a managed Orca server this machine deployed over SSH (see `orca environment list`); it is a selector here, not a routing flag.


## Projects, repos and automations

### `orca automations` (group)

Usage: `orca automations <command> [options]`. Subcommands: `list`, `show`, `create`, `edit`, `remove`, `run`, `runs`.

### `orca automations list`

Purpose: List scheduled Orca automations

```text
orca automations list [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

Example: `orca automations list`

### `orca automations show`

Purpose: Show one Orca automation

```text
orca automations show <id> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--id <id>`: Identifier for a target item or permission

Example: `orca automations show 2f9e...`

### `orca automations create`

Purpose: Create a scheduled Orca automation

```text
orca automations create --name <name> --trigger <preset|cron|rrule> --prompt <text> --provider <agent> [--precheck <command>] [--repo <selector>|--workspace <selector>|--project <id-or-name> [--host <host>]|--project-host-setup <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--name <name>`: Name for the new worktree or automation
5. `--prompt <text>`: Prompt text for agent-backed commands
6. `--provider <agent>`: Agent id such as codex, claude, or gemini
7. `--precheck`
8. `--precheck-timeout`
9. `--repo <selector>`: Repo selector such as id:<id>, name:<name>, or path:<path>
10. `--workspace <selector>`: Existing worktree selector for automation runs
11. `--project`
12. `--host`
13. `--project-host-setup`
14. `--source-context <json|null>`: Explicit TaskSourceContext for automation task/provider data
15. `--workspace-mode <mode>`: existing or new-per-run
16. `--base-branch <ref>`: Base branch/ref to create the worktree from
17. `--trigger <schedule>`: Automation schedule preset, cron, or RRULE
18. `--schedule <schedule>`: Alias for --trigger
19. `--time <HH:MM>`: Time used with daily/weekdays/weekly presets
20. `--day <0-6>`: Day used with weekly preset, Sunday=0
21. `--timezone <tz>`: IANA timezone for the automation
22. `--enabled`: Enable the automation
23. `--disabled`: Disable the automation
24. `--missed-run-grace-minutes <n>`: Missed-run grace window
25. `--reuse-session`: Reuse the previous live session for existing-workspace runs
26. `--fresh-session`: Disable session reuse for future runs
27. `--host`: takes local, ssh:<target-id>, runtime:<environment-id>, or the bare host name `orca host list` prints for any of them.

Example: `orca automations create --name "Daily review" --trigger daily --prompt "Review open changes" --provider codex`

### `orca automations edit`

Purpose: Edit an Orca automation

```text
orca automations edit <id> [--name <name>] [--trigger <preset|cron|rrule>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--id <id>`: Identifier for a target item or permission
5. `--name <name>`: Name for the new worktree or automation
6. `--prompt <text>`: Prompt text for agent-backed commands
7. `--provider <agent>`: Agent id such as codex, claude, or gemini
8. `--precheck`
9. `--precheck-timeout`
10. `--repo <selector>`: Repo selector such as id:<id>, name:<name>, or path:<path>
11. `--workspace <selector>`: Existing worktree selector for automation runs
12. `--project`
13. `--host`
14. `--project-host-setup`
15. `--source-context <json|null>`: Explicit TaskSourceContext for automation task/provider data
16. `--workspace-mode <mode>`: existing or new-per-run
17. `--base-branch <ref>`: Base branch/ref to create the worktree from
18. `--trigger <schedule>`: Automation schedule preset, cron, or RRULE
19. `--schedule <schedule>`: Alias for --trigger
20. `--time <HH:MM>`: Time used with daily/weekdays/weekly presets
21. `--day <0-6>`: Day used with weekly preset, Sunday=0
22. `--timezone <tz>`: IANA timezone for the automation
23. `--enabled`: Enable the automation
24. `--disabled`: Disable the automation
25. `--missed-run-grace-minutes <n>`: Missed-run grace window
26. `--reuse-session`: Reuse the previous live session for existing-workspace runs
27. `--fresh-session`: Disable session reuse for future runs

Example: `orca automations edit 2f9e... --disabled`

### `orca automations remove`

Purpose: Remove an Orca automation and its run history

```text
orca automations remove <id> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--id <id>`: Identifier for a target item or permission

Example: `orca automations remove 2f9e...`

### `orca automations run`

Purpose: Run an Orca automation now

```text
orca automations run <id> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--id <id>`: Identifier for a target item or permission

Example: `orca automations run 497bafa9-5a97-4f85-9e48-2b211b8f31fa`

### `orca automations runs`

Purpose: List automation run history

```text
orca automations runs [--id <automation-id>] [--limit <n>] [--cursor <cursor>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--id <id>`: Identifier for a target item or permission
5. `--limit <n>`: Maximum number of rows to return
6. `--cursor <n>`: Line cursor from a previous read (returns only new output)

Example: `orca automations runs`

### `orca project` (group)

Usage: `orca project <command> [options]`. Subcommands: `list`, `setups`, `setup-clone`, `setup-create`, `setup-update`, `setup-delete`.

### `orca project list`

Purpose: List durable projects known to Orca

```text
orca project list [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

Example: `orca project list`

### `orca project setups`

Purpose: List project host setups

```text
orca project setups [--project <id>] [--host <host>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--project`
5. `--host`
6. `--host`: runtime:<environment-id> runs the command on that paired Orca server instead of filtering this runtime; unknown environment ids are rejected rather than answered with an empty list.

Example: `orca project setups`

### `orca project setup-existing-folder`

Purpose: Make a project available on a host by importing an existing folder

```text
orca project setup-existing-folder --project <id> --host <host> --path <path> [--kind git|folder] [--display-name <name>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--project`
5. `--host`
6. `--path <path>`: Path argument for the command
7. `--kind`
8. `--display-name <name>`: Override the Orca display name
9. `--host`: takes local, ssh:<target-id>, runtime:<environment-id>, or the bare host name `orca host list` prints for any of them.

Example: `orca project setup-existing-folder --project github:stablyai/orca --host local --path ~/orca`

### `orca project setup-clone`

Purpose: Make a project available on a host by cloning a repository

```text
orca project setup-clone --project <id> --host <host> --url <clone-url> --destination <path> [--display-name <name>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--project`
5. `--host`
6. `--url <url>`: URL to navigate to
7. `--destination`
8. `--display-name <name>`: Override the Orca display name
9. `--host`: takes local, ssh:<target-id>, runtime:<environment-id>, or the bare host name `orca host list` prints for any of them.

Example: `orca project setup-clone --project github:stablyai/orca --host local --url https://github.com/stablyai/orca.git --destination ~/src`

### `orca project setup-create`

Purpose: Create independent project host setup metadata

```text
orca project setup-create --project <id> --host <host> [--setup-id <id>] [--path <path>] [--kind git|folder] [--display-name <name>] [--worktree-base-path <path>] [--git-username <name>] [--state ready|not-set-up|setting-up|error|unsupported] [--method imported-existing-folder|cloned|provisioned] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--project`
5. `--host`
6. `--setup-id`
7. `--path <path>`: Path argument for the command
8. `--kind`
9. `--display-name <name>`: Override the Orca display name
10. `--worktree-base-path`
11. `--git-username`
12. `--state`
13. `--method`
14. `--host`: takes local, ssh:<target-id>, runtime:<environment-id>, or the bare host name `orca host list` prints for any of them.

Example: `orca project setup-create --project github:stablyai/orca --host runtime:03ef704c-b180-4b10-998d-e28fbd5de9a3 --state setting-up --method provisioned --json`

### `orca project setup-update`

Purpose: Update project host setup metadata

```text
orca project setup-update --setup <setup-id> [--host <host>] [--display-name <name>] [--path <path>] [--worktree-base-path <path>] [--git-username <name>] [--kind git|folder] [--state ready|not-set-up|setting-up|error|unsupported] [--method legacy-repo|imported-existing-folder|cloned|provisioned] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--setup run|skip|inherit`: Setup policy for repo-defined setup hooks
5. `--host`
6. `--display-name <name>`: Override the Orca display name
7. `--path <path>`: Path argument for the command
8. `--worktree-base-path`
9. `--git-username`
10. `--kind`
11. `--state`
12. `--method`
13. `--host`: picks the setup when the project is set up on more than one host under the same setup id.

Example: `orca project setup-update --setup github:stablyai/orca::gpu --display-name "GPU VM"`

### `orca project setup-delete`

Purpose: Remove a project host setup

```text
orca project setup-delete --setup <setup-id> [--host <host>] [--force] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--setup run|skip|inherit`: Setup policy for repo-defined setup hooks
5. `--host`
6. `--force`: Force worktree removal when supported; does not force branch deletion

Example: `orca project setup-delete --setup github:stablyai/orca::gpu --json`

### `orca repo` (group)

Usage: `orca repo <command> [options]`. Subcommands: `list`, `add`, `show`, `set`, `set-base-ref`, `search-refs`.

### `orca repo list`

Purpose: List repos registered in Orca

```text
orca repo list [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

### `orca repo add`

Purpose: Add a project to Orca by filesystem path

```text
orca repo add --path <path> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--path <path>`: Path argument for the command

### `orca repo show`

Purpose: Show one registered repo

```text
orca repo show --repo <selector> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--repo <selector>`: Repo selector such as id:<id>, name:<name>, or path:<path>

### `orca repo set`

Purpose: Set whether non-Orca worktrees are shown for a repo

```text
orca repo set --repo <selector> --external-worktree-visibility show|hide|inherit [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--repo <selector>`: Repo selector such as id:<id>, name:<name>, or path:<path>
5. `--external-worktree-visibility show|hide|inherit`: Override or inherit non-Orca worktree visibility

Example: `orca repo set --repo path:/path/to/repo --external-worktree-visibility show --json`

### `orca repo set-base-ref`

Purpose: Set the repo's default base ref for future worktrees

```text
orca repo set-base-ref --repo <selector> --ref <ref> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--repo <selector>`: Repo selector such as id:<id>, name:<name>, or path:<path>
5. `--ref <ref>`: Base ref to persist for the repo

### `orca repo search-refs`

Purpose: Search branch/tag refs within a repo

```text
orca repo search-refs --repo <selector> --query <text> [--limit <n>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--repo <selector>`: Repo selector such as id:<id>, name:<name>, or path:<path>
5. `--query <text>`: Search text for matching refs
6. `--limit <n>`: Maximum number of rows to return


## Worktrees and agents

### `orca worktree` (group)

Usage: `orca worktree <command> [options]`. Subcommands: `list`, `show`, `current`, `create`, `set`, `rm`, `ps`.

### `orca worktree list`

Purpose: List Orca-managed worktrees

```text
orca worktree list [--repo <selector>] [--limit <n>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--repo <selector>`: Repo selector such as id:<id>, name:<name>, or path:<path>
5. `--limit <n>`: Maximum number of rows to return

### `orca worktree show`

Purpose: Show one worktree

```text
orca worktree show --worktree <selector> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca worktree current`

Purpose: Show the Orca-managed worktree for the current directory

```text
orca worktree current [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

Example: `orca worktree current`

### `orca worktree create`

Purpose: Create a new Orca-managed worktree

```text
orca worktree create --name <name> [--repo <selector>|--project <id-or-name> [--host <host>]|--project-host-setup <id>] [--agent <id>] [--prompt <text>] [--model <id>] [--effort <level>] [--surface chat|terminal] [--setup run|skip|inherit] [--base-branch <ref>] [--reference <url-or-jira-key>...] [--reference-site <id>] [--issue <number>] [--pr <number>] [--linear-issue <identifier-or-url>] [--gitlab-issue <number-or-url>] [--gitlab-mr <number-or-url>] [--comment <text>] [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--retry-launch <operationId>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--repo <selector>`: Repo selector such as id:<id>, name:<name>, or path:<path>
5. `--project`
6. `--host`
7. `--project-host-setup`
8. `--name <name>`: Name for the new worktree or automation
9. `--agent <id>`: Launch a known TUI agent in the first terminal
10. `--prompt <text>`: Prompt text for agent-backed commands
11. `--model <id>`: Provider model id for a new agent launch
12. `--effort <level>`: Reasoning effort for the selected model
13. `--surface chat|terminal`: Start the agent as a chat or in a terminal, instead of your setting
14. `--retry-launch`
15. `--base-branch <ref>`: Base branch/ref to create the worktree from
16. `--reference <url-or-jira-key>`: Attach an issue/review URL or Jira key; repeat for several
17. `--reference-site <id>`: Jira site for bare keys; see orca jira connection
18. `--issue <number|null>`: Linked GitHub issue number
19. `--pr <number>`: Linked GitHub pull request number
20. `--linear-issue <id|url|null>`: Linked Linear issue identifier or URL; null clears on set
21. `--gitlab-issue <number|url>`: Linked GitLab issue in the source project
22. `--gitlab-mr <number|url>`: Linked GitLab merge request in the source project
23. `--comment <text>`: Comment stored in Orca metadata
24. `--setup run|skip|inherit`: Setup policy for repo-defined setup hooks
25. `--parent-worktree <selector>`: Parent selector such as identity:<identity>, active/current, id:<repo-id>::<path>, branch:<branch>, issue:<number>, path:<path>, folder:<id>, or worktree:<worktreeId>
26. `--no-parent`: Force no parent lineage for unrelated work
27. `--run-hooks`
28. `--activate`: Reveal the new worktree in the Orca app
29. `--host`: is only needed when the project is set up on more than one host; with a single setup Orca uses it. When it is ambiguous the error names every host the project is set up on.
30. `--host`: takes local, ssh:<target-id>, runtime:<environment-id>, or the bare host name `orca host list` prints for any of them.
31. `--no-parent`: only affects Orca lineage; omit --base-branch to use the repo default base, or pass the default base ref explicitly for independent top-level work.

Example: `orca worktree create --name agent-task --agent codex --prompt "hi" --json`

### `orca worktree set`

Purpose: Update Orca metadata for a worktree

```text
orca worktree set --worktree <selector> [--display-name <name>] [--issue <number|null>] [--pr <number|null>] [--linear-issue <identifier-or-url|null>] [--gitlab-issue <number-or-url|null>] [--gitlab-mr <number-or-url|null>] [--comment <text>] [--workspace-status <id>] [--unread|--read] [--parent-worktree <selector>|--no-parent] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--display-name <name>`: Override the Orca display name
6. `--issue <number|null>`: Linked GitHub issue number
7. `--pr <number|null>`: Linked GitHub pull request number; null clears on set
8. `--linear-issue <id|url|null>`: Linked Linear issue identifier or URL; null clears on set
9. `--gitlab-issue <number|url|null>`: Linked GitLab issue number or URL; null clears on set
10. `--gitlab-mr <number|url|null>`: Linked GitLab merge request number or URL; null clears on set
11. `--comment <text>`: Comment stored in Orca metadata
12. `--workspace-status <id>`: Board status id (defaults: todo, in-progress, in-review, completed)
13. `--unread`: Mark the workspace unread in the sidebar
14. `--read`: Mark the workspace read, clearing the unread dot
15. `--parent-worktree <selector>`: Parent worktree selector such as identity:<identity>, id:<repo-id>::<path>, branch:<branch>, issue:<number>, path:<path>, or active/current
16. `--no-parent`: Force no parent lineage for unrelated work

Example: `orca worktree set --worktree active --linear-issue STA-335 --json`

### `orca worktree rm`

Purpose: Remove a worktree from Orca and git

```text
orca worktree rm --worktree <selector> [--force] [--run-hooks] [--allow-failed-archive-hook] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--force`: Force worktree removal when supported; does not force branch deletion
6. `--run-hooks`
7. `--allow-failed-archive-hook`

### `orca worktree ps`

Purpose: Show a compact orchestration summary across worktrees

```text
orca worktree ps [--limit <n>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--limit <n>`: Maximum number of rows to return

### `orca agent` (group)

Usage: `orca agent <command> [options]`. Subcommands: `launch`.

### `orca agent launch`

Purpose: Start an agent in an existing workspace, as a chat or a terminal

```text
orca agent launch --agent <id> [--worktree <selector>] [--prompt <text>] [--model <id>] [--effort <level>] [--surface chat|terminal] [--focus] [--retry-launch <operationId>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--agent <id>`: Launch a known TUI agent in the first terminal
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--prompt <text>`: Prompt text for agent-backed commands
7. `--model <id>`: Provider model id for a new agent launch
8. `--effort <level>`: Reasoning effort for the selected model
9. `--surface chat|terminal`: Start the agent as a chat or in a terminal, instead of your setting
10. `--focus`: Reveal the created terminal session in Orca
11. `--retry-launch`
12. `--page <id>`: Stable browser page id from `orca tab list --json`
13. `--surface chat|terminal`: picks for this launch instead of your setting. --surface terminal always runs the agent CLI; --surface chat is refused when Orca can establish before starting anything that this agent cannot open as a chat there. If support cannot be checked, the launch can fall back to a terminal. If chat becomes unavailable after creating a workspace, Orca keeps the workspace, setup and default tabs, then opens a terminal; the receipt explains the fallback.
14. `--worktree`: defaults to the native folder workspace or worktree containing the current directory. For a new checkout with its agent, use `orca worktree create --agent`.
15. `--model`: takes a provider model id and --effort a reasoning effort for that model; --effort requires --model. They apply to either surface.

Example: `orca agent launch --agent codex --json`


## Files

### `orca file` (group)

Usage: `orca file <command> [options]`. Subcommands: `open`, `diff`, `open-changed`.

### `orca file open`

Purpose: Open a file as a tab in its worktree without changing your view; --focus brings you to it

```text
orca file open <path> [--line <n> [--column <n>]] [--worktree <selector>] [--focus] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--path <path>`: Path argument for the command
5. `--line <n>`: Cursor line (1-based)
6. `--column <n>`: Cursor column (1-based; requires --line)
7. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
8. `--focus`: Bring the user to the file (switches Orca's window to its worktree)
9. `--line`: and --column use 1-based positions; --column requires --line. Without --focus, the position is applied when you select the file. Markdown opens in source view for positioning. Older hosts open the file without positioning.

Example: `orca file open src/App.tsx`

### `orca file diff`

Purpose: Open a file diff as a tab in its worktree without changing your view; --focus brings you to it

```text
orca file diff <path> [--staged] [--worktree <selector>] [--focus] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--path <path>`: Path argument for the command
5. `--staged`: Open staged source-control changes
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--focus`: Bring the user to the file (switches Orca's window to its worktree)

Example: `orca file diff src/App.tsx`

### `orca file open-changed`

Purpose: Open all git-changed files as tabs without changing your view; --focus brings you to them

```text
orca file open-changed [--mode edit|diff|both] [--worktree <selector>] [--focus] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--mode <mode>`: Mode such as edit, diff, or both
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--focus`: Bring the user to the file (switches Orca's window to its worktree)

Example: `orca file open-changed`


## Terminals

### `orca terminal` (group)

Usage: `orca terminal <command> [options]`. Subcommands: `list`, `show`, `read`, `send`, `wait`, `create`, `switch`, `close`, `rename`, `set-pane-title`, `split`.

### `orca terminal list`

Purpose: List live Orca-managed terminals

```text
orca terminal list [--worktree <selector>] [--limit <n>] [--include-visual-layouts] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--limit <n>`: Maximum number of rows to return
6. `--include-visual-layouts`: Include tab and pane topology in JSON output

### `orca terminal show`

Purpose: Show terminal metadata and preview

```text
orca terminal show [--terminal <handle>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--terminal <handle>`: Runtime-issued terminal handle

### `orca terminal read`

Purpose: Read bounded terminal output

```text
orca terminal read [--terminal <handle>] [--cursor <n>] [--limit <n>] [--screen] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--terminal <handle>`: Runtime-issued terminal handle
5. `--cursor <n>`: Line cursor from a previous read (returns only new output)
6. `--limit <n>`: Maximum number of rows to return
7. `--screen`
8. `--screen`: and --cursor are mutually exclusive: a screen read is the current frame and has no history to page.

Example: `orca terminal read --json`

### `orca terminal send`

Purpose: Send input to a live terminal

```text
orca terminal send [--terminal <handle>] [--text <text>] [--enter] [--interrupt] [--wait-submit <seconds>] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--terminal <handle>`: Runtime-issued terminal handle
5. `--text <text>`: Text payload to send or type
6. `--enter`: Append Enter after sending text
7. `--interrupt`: Send as an interrupt-style input when supported
8. `--wait-submit`
9. `--retry-request`
10. `--wait-submit`: only observes the accepted prompt for the requested duration; timeout returns the queued/input-accepted receipt and never resends.

### `orca terminal wait`

Purpose: Wait for a terminal condition

```text
orca terminal wait [--terminal <handle>] --for exit|tui-idle [--timeout-ms <ms>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--terminal <handle>`: Runtime-issued terminal handle
5. `--for exit|tui-idle`: Wait condition to satisfy
6. `--timeout-ms <ms>`: Maximum wait time before timing out

### `orca terminal create`

Purpose: Create a terminal session in the current worktree

```text
orca terminal create [--worktree <selector>] [--title <name>] [--command <text>] [--shell <shell>] [--focus] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--command <text>`: Command to run in the terminal on startup
6. `--shell <shell>`: Windows shell the terminal itself runs as
7. `--title <text>`: Custom title for the terminal tab (omit to reset)
8. `--focus`: Reveal the created terminal session in Orca
9. `--shell`: picks the shell the terminal IS on a Windows host (cmd.exe, powershell.exe, pwsh.exe, wsl.exe, bash.exe, git-bash); --command is typed into whatever shell the host started, so `--command cmd.exe` leaves a cmd running INSIDE the default shell and exiting it drops back to that shell.

Example: `orca terminal create --json`

### `orca terminal rename`

Purpose: Set or clear the title of a terminal tab

```text
orca terminal rename [--terminal <handle>] [--title <text>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--terminal <handle>`: Runtime-issued terminal handle
5. `--title <text>`: Custom title for the terminal tab (omit to reset)

Example: `orca terminal rename --terminal term_abc123 --title "RUNNER"`

### `orca terminal set-pane-title`

Purpose: Set or clear the title of one terminal pane

```text
orca terminal set-pane-title [--terminal <handle>] --title <text> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--terminal <handle>`: Runtime-issued terminal handle
5. `--title <text>`: Custom title for one pane (pass "" to reset)

Example: `orca terminal set-pane-title --terminal term_abc123 --title "RUNNER"`

### `orca terminal split`

Purpose: Split an existing terminal pane

```text
orca terminal split [--terminal <handle>] [--direction horizontal|vertical] [--command <text>] [--retry-split <leafId>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--terminal <handle>`: Runtime-issued terminal handle
5. `--direction <dir>`: Direction: up|down|left|right for scroll, horizontal|vertical for split
6. `--command <text>`: Command to run in the terminal on startup
7. `--retry-split`

Example: `orca terminal split --terminal term_abc123 --direction horizontal --json`

### `orca terminal switch`

Purpose: Switch to a terminal tab in the UI

```text
orca terminal switch [--terminal <handle>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--terminal <handle>`: Runtime-issued terminal handle

Example: `orca terminal switch --terminal term_abc123`

### `orca terminal focus`

Purpose: Switch to a terminal tab in the UI

```text
orca terminal switch [--terminal <handle>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--terminal <handle>`: Runtime-issued terminal handle

Example: `orca terminal switch --terminal term_abc123`

### `orca terminal close`

Purpose: Close one terminal, its whole tab, or every terminal in a workspace

```text
orca terminal close ([--terminal <handle>] [--tab] | --worktree <selector> --all) [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--terminal <handle>`: Runtime-issued terminal handle
5. `--tab`: Close the whole tab and wait for durable persistence
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--all`

Example: `orca terminal close --terminal term_abc123`


## Orchestration

### `orca orchestration` (group)

Usage: `orca orchestration <command> [options]`. Subcommands: `run-create`, `run-use`, `run-current`, `run-list`, `run-show`, `send`, `check`, `reply`, `inbox`, `task-create`, `task-list`, `task-update`, `worker-start`, `worker-show`, `worker-read`, `worker-stop`, `worker-abandon`, `worker-release`, `worker-retain`, `worker-list`, `dispatch`, `request-show`, `dispatch-show`, `ask`, `coordinator-start`, `coordinator-stop`, `gate-create`, `gate-resolve`, `gate-list`, `reset`.

### `orca orchestration run-create`

Purpose: Create and bind a lightweight orchestration Run

```text
orca orchestration run-create --objective <text> [--from <handle>] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--objective`
5. `--from`
6. `--retry-request`
7. `--retry-request`: is only for exact recovery after an unknown mutation result.

### `orca orchestration run-use`

Purpose: Bind this coordinator to an existing Run

```text
orca orchestration run-use --id <run_id> [--from <handle>] [--takeover-legacy] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--id <id>`: Identifier for a target item or permission
5. `--from`
6. `--takeover-legacy`
7. `--retry-request`
8. `--takeover-legacy`: must run in the live coordinator agent terminal it binds; it preserves existing worker assignments.

### `orca orchestration run-current`

Purpose: Show the Run bound to this coordinator

```text
orca orchestration run-current [--from <handle>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--from`

### `orca orchestration run-list`

Purpose: List lightweight orchestration Runs

```text
orca orchestration run-list [--limit <n>] [--cursor <cursor>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--limit <n>`: Maximum number of rows to return
5. `--cursor <n>`: Line cursor from a previous read (returns only new output)

### `orca orchestration run-show`

Purpose: Show one lightweight orchestration Run

```text
orca orchestration run-show --id <run_id> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--id <id>`: Identifier for a target item or permission

### `orca orchestration send`

Purpose: Send an inter-agent message

```text
orca orchestration send --subject <text> [--to <run:id|dispatch:id|legacy_handle>] [--run <run_id>] [--from <handle>] [--body <text>] [--type <type>] [--priority <level>] [--thread-id <id>] [--payload <json>] [--task-id <id>] [--dispatch-id <id>] [--outcome <succeeded|failed>] [--files-modified <csv>] [--report-path <path>] [--phase <text>] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--to`
5. `--run`
6. `--from`
7. `--subject`
8. `--body`
9. `--type`
10. `--priority`
11. `--thread-id`
12. `--payload`
13. `--task-id <id>`: Task id to include in orchestration payload JSON
14. `--dispatch-id <id>`: Dispatch id to include in orchestration payload JSON
15. `--dispatch-capability`
16. `--retry-request`
17. `--outcome`
18. `--files-modified <csv>`: Comma-separated files for orchestration payload JSON
19. `--report-path <path>`: Report path to include in orchestration payload JSON
20. `--phase <text>`: Worker phase to include in orchestration payload JSON

### `orca orchestration check`

Purpose: default: return the bound Run's oldest unacknowledged FIFO batch.

```text
orca orchestration check [--terminal <handle>] [--run <run_id>] [--ack <delivery_id>] [--unread | --peek | --all] [--types <type,...>] [--format] [--wait] [--timeout-ms <n>] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--terminal <handle>`: Runtime-issued terminal handle
5. `--run`
6. `--ack`
7. `--unread`
8. `--peek`
9. `--all`
10. `--types`
11. `--format <png|jpeg>`: Screenshot image format
12. `--wait`
13. `--timeout-ms <ms>`: Maximum wait time before timing out
14. `--retry-request`
15. `--types`: is the wake condition for --wait; a returned Delivery is always the whole FIFO batch, so it is never filtered by type. Without --wait it has no effect on consuming checks. Only --peek and --all filter their rows.
16. `--format`: renders the returned rows as local text only; it never writes to another terminal.

### `orca orchestration ask`

Purpose: Ask the coordinator a question and block until answered

```text
orca orchestration ask (--question <text> | --resume <message_id>) [--to <run:id>] [--run <run_id>] [--options <csv>] [--timeout-ms <n>] [--from <handle>] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--to`
5. `--run`
6. `--question`
7. `--resume`
8. `--dispatch-capability`
9. `--options`
10. `--timeout-ms <ms>`: Maximum wait time before timing out
11. `--from`
12. `--retry-request`
13. `--timeout-ms`: accepts 1 to 1800000 ms per wait (default 600000 = 10 minutes, max 30 minutes); larger values are rejected. Timeout leaves the question pending; resume with the original message ID.

### `orca orchestration reply`

Purpose: Reply to a message

```text
orca orchestration reply --id <msg_id> --body <text> [--run <run_id>] [--from <handle>] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--id <id>`: Identifier for a target item or permission
5. `--body`
6. `--run`
7. `--from`
8. `--retry-request`

### `orca orchestration inbox`

Purpose: Show messages across (or for) recipients

```text
orca orchestration inbox [--limit <n>] [--terminal <handle>] [--full] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--limit <n>`: Maximum number of rows to return
5. `--terminal <handle>`: Runtime-issued terminal handle
6. `--full`: Include all supported V1 issue context within caps

### `orca orchestration task-create`

Purpose: Create an orchestration task

```text
orca orchestration task-create --spec <text> [--task-title <text>] [--display-name <text>] [--deps <json_array>] [--parent <task_id>] [--run <run_id>] [--from <handle>] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--spec`
5. `--task-title <text>`: Concise title for the orchestration task
6. `--display-name <text>`: UI label shown for dispatched worker rows
7. `--deps`
8. `--parent`
9. `--run`
10. `--from`
11. `--retry-request`

### `orca orchestration task-list`

Purpose: List orchestration tasks

```text
orca orchestration task-list [--status <status>] [--ready] [--brief] [--run <run_id>] [--from <handle>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--status`
5. `--ready`
6. `--brief`
7. `--run`
8. `--from`
9. `--brief`: collapses whitespace and caps each spec at 160 characters.

### `orca orchestration task-update`

Purpose: Update a task status

```text
orca orchestration task-update --id <task_id> --status <status> [--result <text>] [--run <run_id>] [--from <handle>] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--id <id>`: Identifier for a target item or permission
5. `--status`
6. `--result`
7. `--run`
8. `--from`
9. `--retry-request`

### `orca orchestration dispatch`

Purpose: Dispatch a task to a terminal

```text
orca orchestration dispatch --task <task_id> --to <handle> [--from <handle>] [--run <run_id>] [--inject] [--dry-run] [--return-preamble] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--task`
5. `--to`
6. `--from`
7. `--run`
8. `--inject`
9. `--dry-run`
10. `--return-preamble`
11. `--retry-request`

### `orca orchestration dispatch-show`

Purpose: Show dispatch context for a task

```text
orca orchestration dispatch-show --task <task_id> [--preamble] [--from <handle>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--task`
5. `--preamble`
6. `--from`

### `orca orchestration worker-start`

Purpose: Start one supervised worker on the Run home or a connected Orca server

```text
orca orchestration worker-start (--task <task_id> | --spec <text>) [--on <saved-environment>] [--worktree <current|selector|new-child|new-top-level>] (--agent <agent> | --terminal <handle>) [--task-title <text>] [--deps <json_array>] [--parent <task_id>] [--model <id>] [--effort <level>] [--name <name>] [--repo <selector>] [--base-branch <ref>] [--display-name <text>] [--comment <text>] [--setup <run|skip|inherit>] [--retry-of <dispatch_id>] [--timeout-ms <n>] [--run <run_id>] [--from <handle>] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--task`
5. `--spec`
6. `--task-title <text>`: Concise title for an orchestration task
7. `--deps`
8. `--parent`
9. `--on`
10. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
11. `--name <name>`: Name for the new worktree or automation
12. `--repo <selector>`: Repo selector such as id:<id>, name:<name>, or path:<path>
13. `--base-branch <ref>`: Base branch/ref to create the worktree from
14. `--display-name <name>`: Override the Orca display name
15. `--comment <text>`: Comment stored in Orca metadata
16. `--setup run|skip|inherit`: Setup policy for repo-defined setup hooks
17. `--agent <id>`: Launch a known TUI agent in the first terminal
18. `--model <id>`: Provider model id for a new agent launch
19. `--effort <level>`: Reasoning effort for the selected model
20. `--terminal <handle>`: Runtime-issued terminal handle
21. `--retry-of`
22. `--timeout-ms <ms>`: Maximum wait time before timing out
23. `--run`
24. `--from`
25. `--retry-request`
26. `--agent`: takes an Orca agent id enabled on the worker server, such as claude, codex, cursor, antigravity, muse, zcode, opencode, or opencode2.
27. `--model`: supports Claude, Codex, Cursor, Antigravity, and Muse opaque provider model ids; --effort requires --model. OMP accepts --model only; --effort is unsupported. Neither can combine with --terminal. OpenCode model selection requires an existing worktree, a verified execution-host CLI, and an available model; effort is unsupported. Other agents, including zcode, launch with the model from their own config.
28. `--on`: selects only the worker server; the Run and this command remain on the current Orca server.
29. `--retry-of`: needs --task naming the failed Task (--spec creates a new one) and does not inherit placement; repeat the intended --on/worktree and --agent/terminal choices.

### `orca orchestration worker-show`

Purpose: Inspect one supervised worker Dispatch

```text
orca orchestration worker-show --dispatch <dispatch_id> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--dispatch`

### `orca orchestration worker-read`

Purpose: Read bounded output from one supervised worker

```text
orca orchestration worker-read --dispatch <dispatch_id> [--source <auto|transcript|terminal>] [--cursor <cursor>] [--limit <n>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--dispatch`
5. `--source`
6. `--cursor <cursor>`: Opaque cursor returned by a previous worker-read page
7. `--limit <n>`: Maximum number of rows to return

### `orca orchestration worker-stop`

Purpose: Fence one Dispatch and stop its supervised agent terminal

```text
orca orchestration worker-stop --dispatch <dispatch_id> [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--dispatch`
5. `--retry-request`

### `orca orchestration worker-abandon`

Purpose: Fence a worker without claiming its process stopped

```text
orca orchestration worker-abandon --dispatch <dispatch_id> [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--dispatch`
5. `--retry-request`

### `orca orchestration worker-release`

Purpose: Release the terminal of one settled supervised worker

```text
orca orchestration worker-release --dispatch <dispatch_id> [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--dispatch`
5. `--retry-request`

### `orca orchestration worker-retain`

Purpose: Keep one supervised worker terminal live for debugging

```text
orca orchestration worker-retain --dispatch <dispatch_id> [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--dispatch`
5. `--retry-request`

### `orca orchestration worker-list`

Purpose: List supervised worker terminal resource accounting

```text
orca orchestration worker-list [--run <run_id>] [--terminal-state <active|reclaimable|retained|release_pending|release_unknown|released>] [--include-remote] [--cursor <cursor>] [--limit <1-100>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--run`
5. `--terminal-state <state>`: Terminal accounting filter: active, reclaimable, retained, release_pending, release_unknown, or released
6. `--include-remote`: Include connected-server worker observations
7. `--cursor <cursor>`: Opaque page cursor copied from page.nextCursor
8. `--limit <n>`: Maximum number of rows to return

### `orca orchestration coordinator-start`

Purpose: Retired: load the current orchestration skill

```text
orca orchestration coordinator-start --spec <text> [--from <handle>] [--poll-interval-ms <n>] [--max-concurrent <n>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--spec`
5. `--from`
6. `--poll-interval-ms`
7. `--max-concurrent`
8. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca orchestration coordinator-stop`

Purpose: Retired: load the current orchestration skill

```text
orca orchestration coordinator-stop [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

### `orca orchestration gate-create`

Purpose: Create a decision gate blocking a task

```text
orca orchestration gate-create --task <task_id> --question <text> [--options <json_array>] [--from <handle>] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--task`
5. `--question`
6. `--options`
7. `--from`
8. `--retry-request`

### `orca orchestration gate-resolve`

Purpose: Resolve a pending decision gate

```text
orca orchestration gate-resolve --id <gate_id> --resolution <text> [--from <handle>] [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--id <id>`: Identifier for a target item or permission
5. `--resolution`
6. `--from`
7. `--retry-request`

### `orca orchestration gate-list`

Purpose: List decision gates

```text
orca orchestration gate-list [--task <task_id>] [--status <status>] [--run <run_id>] [--from <handle>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--task`
5. `--status`
6. `--run`
7. `--from`
8. `--run`: inspects a named Run without binding; otherwise gates are scoped to the caller.

### `orca orchestration reset`

Purpose: Reset one explicit orchestration state scope

```text
orca orchestration reset (--all | --tasks | --messages) [--retry-request <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--all`
5. `--tasks`
6. `--messages`
7. `--retry-request`

### `orca orchestration request-show`

Purpose: Ask whether one orchestration mutation request already took effect

```text
orca orchestration request-show --request <request_id> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--request`


## Computer use

### `orca computer` (group)

Usage: `orca computer <command> [options]`. Subcommands: `capabilities`, `list-apps`, `permissions`, `list-windows`, `get-app-state`, `click`, `scroll`, `drag`, `type-text`, `press-key`, `hotkey`, `paste-text`, `set-value`.

### `orca computer capabilities`

Purpose: Show computer-use provider capabilities

```text
orca computer capabilities [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

### `orca computer permissions`

Purpose: Open computer-use permission setup

```text
orca computer permissions [--id <accessibility|screenshots>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--id <id>`: Identifier for a target item or permission

### `orca computer list-apps`

Purpose: List running apps available to computer-use

```text
orca computer list-apps [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

### `orca computer list-windows`

Purpose: List windows for an app available to computer-use

```text
orca computer list-windows --app <name|bundle|pid:N> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--app <app>`: App name, bundle ID, or pid:N

### `orca computer get-app-state`

Purpose: Capture a compact accessibility snapshot of an app

```text
orca computer get-app-state --app <name|bundle|pid:N> [--window-id <id> | --window-index <n>] [--worktree <selector> | --session <id>] [--restore-window] [--no-screenshot] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--session <id>`: Snapshot namespace for a related computer-use workflow
6. `--app <app>`: App name, bundle ID, or pid:N
7. `--window-id <id>`: Target a window id from list-windows
8. `--window-index <n>`: Target a window index from list-windows
9. `--restore-window`: Bring the target app/window forward before the operation
10. `--no-screenshot`: Skip screenshot capture after the operation
11. `--window-id <id>`: Target a window id from list-windows
12. `--window-index <n>`: Target a window index from list-windows
13. `--restore-window`: Bring the target app/window forward before the operation

### `orca computer click`

Purpose: Click an app element or window coordinate, optionally with modifiers

```text
orca computer click --app <app> (--element-index <n> | --x <x> --y <y>) [--window-id <id> | --window-index <n>] [--click-count <n>] [--mouse-button <left|right|middle>] [--modifiers <modifier-chord>] [--restore-window] [--no-screenshot] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--session <id>`: Snapshot namespace for a related computer-use workflow
6. `--app <app>`: App name, bundle ID, or pid:N
7. `--window-id <id>`: Target a window id from list-windows
8. `--window-index <n>`: Target a window index from list-windows
9. `--restore-window`: Bring the target app/window forward before the operation
10. `--no-screenshot`: Skip screenshot capture after the operation
11. `--element-index <n>`: Element index from get-app-state
12. `--x`
13. `--y`
14. `--click-count`
15. `--mouse-button <btn>`: Mouse button: left, right, or middle
16. `--modifiers <chord>`: Modifier keys held only for this click

### `orca computer perform-secondary-action`

Purpose: Perform an advertised secondary accessibility action

```text
orca computer perform-secondary-action --app <app> --element-index <n> --action <name> [--window-id <id> | --window-index <n>] [--restore-window] [--no-screenshot] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--session <id>`: Snapshot namespace for a related computer-use workflow
6. `--app <app>`: App name, bundle ID, or pid:N
7. `--window-id <id>`: Target a window id from list-windows
8. `--window-index <n>`: Target a window index from list-windows
9. `--restore-window`: Bring the target app/window forward before the operation
10. `--no-screenshot`: Skip screenshot capture after the operation
11. `--element-index <n>`: Element index from get-app-state
12. `--action <name>`: Secondary accessibility action name

### `orca computer scroll`

Purpose: Scroll an app element or window coordinate

```text
orca computer scroll --app <app> (--element-index <n> | --x <x> --y <y>) --direction <up|down|left|right> [--window-id <id> | --window-index <n>] [--pages <n>] [--restore-window] [--no-screenshot] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--session <id>`: Snapshot namespace for a related computer-use workflow
6. `--app <app>`: App name, bundle ID, or pid:N
7. `--window-id <id>`: Target a window id from list-windows
8. `--window-index <n>`: Target a window index from list-windows
9. `--restore-window`: Bring the target app/window forward before the operation
10. `--no-screenshot`: Skip screenshot capture after the operation
11. `--element-index <n>`: Element index from get-app-state
12. `--x`
13. `--y`
14. `--direction <dir>`: Direction: up|down|left|right for scroll, horizontal|vertical for split
15. `--pages <n>`: Number of scroll pages

### `orca computer drag`

Purpose: Drag between app elements or window coordinates

```text
orca computer drag --app <app> (--from-element-index <n> --to-element-index <n> | --from-x <x> --from-y <y> --to-x <x> --to-y <y>) [--window-id <id> | --window-index <n>] [--restore-window] [--no-screenshot] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--session <id>`: Snapshot namespace for a related computer-use workflow
6. `--app <app>`: App name, bundle ID, or pid:N
7. `--window-id <id>`: Target a window id from list-windows
8. `--window-index <n>`: Target a window index from list-windows
9. `--restore-window`: Bring the target app/window forward before the operation
10. `--no-screenshot`: Skip screenshot capture after the operation
11. `--from-element-index <n>`: Source element index from get-app-state
12. `--to-element-index <n>`: Destination element index from get-app-state
13. `--from-x <x>`: Source window-local x coordinate
14. `--from-y <y>`: Source window-local y coordinate
15. `--to-x <x>`: Destination window-local x coordinate
16. `--to-y <y>`: Destination window-local y coordinate

### `orca computer type-text`

Purpose: Type literal text at the current app focus

```text
orca computer type-text --app <app> (--text <text> | --text-stdin) [--window-id <id> | --window-index <n>] [--restore-window] [--no-screenshot] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--session <id>`: Snapshot namespace for a related computer-use workflow
6. `--app <app>`: App name, bundle ID, or pid:N
7. `--window-id <id>`: Target a window id from list-windows
8. `--window-index <n>`: Target a window index from list-windows
9. `--restore-window`: Bring the target app/window forward before the operation
10. `--no-screenshot`: Skip screenshot capture after the operation
11. `--text <text>`: Text payload to send or type
12. `--text-stdin`: Read text payload from stdin

### `orca computer press-key`

Purpose: Press a single key such as Return or Escape

```text
orca computer press-key --app <app> --key <key> [--window-id <id> | --window-index <n>] [--restore-window] [--no-screenshot] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--session <id>`: Snapshot namespace for a related computer-use workflow
6. `--app <app>`: App name, bundle ID, or pid:N
7. `--window-id <id>`: Target a window id from list-windows
8. `--window-index <n>`: Target a window index from list-windows
9. `--restore-window`: Bring the target app/window forward before the operation
10. `--no-screenshot`: Skip screenshot capture after the operation
11. `--key <key>`: Single key, e.g. Return, Escape, Tab, Left, or PageUp

### `orca computer hotkey`

Purpose: Press a platform-aware key combination

```text
orca computer hotkey --app <app> --key <key-combo> [--window-id <id> | --window-index <n>] [--restore-window] [--no-screenshot] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--session <id>`: Snapshot namespace for a related computer-use workflow
6. `--app <app>`: App name, bundle ID, or pid:N
7. `--window-id <id>`: Target a window id from list-windows
8. `--window-index <n>`: Target a window index from list-windows
9. `--restore-window`: Bring the target app/window forward before the operation
10. `--no-screenshot`: Skip screenshot capture after the operation
11. `--key <key-combo>`: Modifier chord with one key, e.g. CmdOrCtrl+A

### `orca computer paste-text`

Purpose: Paste exact text at the current app focus

```text
orca computer paste-text --app <app> (--text <text> | --text-stdin) [--window-id <id> | --window-index <n>] [--restore-window] [--no-screenshot] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--session <id>`: Snapshot namespace for a related computer-use workflow
6. `--app <app>`: App name, bundle ID, or pid:N
7. `--window-id <id>`: Target a window id from list-windows
8. `--window-index <n>`: Target a window index from list-windows
9. `--restore-window`: Bring the target app/window forward before the operation
10. `--no-screenshot`: Skip screenshot capture after the operation
11. `--text <text>`: Text payload to send or type
12. `--text-stdin`: Read text payload from stdin

### `orca computer set-value`

Purpose: Set the value of a settable app element

```text
orca computer set-value --app <app> --element-index <n> (--value <text> | --value-stdin) [--window-id <id> | --window-index <n>] [--restore-window] [--no-screenshot] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--session <id>`: Snapshot namespace for a related computer-use workflow
6. `--app <app>`: App name, bundle ID, or pid:N
7. `--window-id <id>`: Target a window id from list-windows
8. `--window-index <n>`: Target a window index from list-windows
9. `--restore-window`: Bring the target app/window forward before the operation
10. `--no-screenshot`: Skip screenshot capture after the operation
11. `--element-index <n>`: Element index from get-app-state
12. `--value <text>`: Value to fill or select
13. `--value-stdin`: Read set-value payload from stdin


## Linear

### `orca linear` (group)

Usage: `orca linear <command> [options]`. Subcommands: `save-issue`, `list-issues`, `issue`, `search`, `list`, `attach`, `create`.

### `orca linear save-issue`

Purpose: Create or update a Linear issue

```text
orca linear save-issue [<id>] [--current] [--team <key|id>] [--title <title>] [--description <text> | --body-file <path|->] [--state <state>] [--assignee me|<user>|null] [--priority none|low|medium|high|urgent] [--estimate <number>|null] [--due-date <yyyy-mm-dd>|null] [--label <label>...] [--project <project>|null] [--parent-id <issue>|null] [--write-id <uuid>] [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--team`
6. `--title <text>`: Custom title for the terminal tab (omit to reset)
7. `--description`
8. `--body <text>`: Linear comment or issue body
9. `--body-file <path|->`: Read Linear body from a file or stdin
10. `--state`
11. `--assignee`
12. `--priority`
13. `--estimate`
14. `--due-date`
15. `--label`
16. `--project`
17. `--parent-id`
18. `--write-id <uuid>`: Retry id from linear_write_unconfirmed
19. `--workspace <id>`: Connected Linear workspace id
20. `--id <id>`: Identifier for a target item or permission

Example: `orca linear save-issue --team ENG --title "Fix auth" --priority high --json`

### `orca linear list-issues`

Purpose: List Linear issues with MCP-compatible filters

```text
orca linear list-issues [--team <team>] [--cycle <cycle>] [--label <label>] [--limit <n>] [--query <text>] [--state <state>] [--cursor <cursor>] [--order-by createdAt|updatedAt] [--project <project>] [--release <release>] [--assignee <user|me|null>] [--delegate <user|me|null>] [--parent-id <issue|null>] [--priority <0-4>] [--created-at <datetime|duration>] [--updated-at <datetime|duration>] [--include-archived] [--workspace <id>|all] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--team`
5. `--cycle`
6. `--label`
7. `--limit <n>`: Max issues to return; omit to return every match
8. `--query <text>`: Search text for matching refs
9. `--state`
10. `--cursor <cursor>`: Opaque cursor from a previous list-issues page; issued cursors bind the workspace, raw Linear cursors need --workspace
11. `--order-by`
12. `--project`
13. `--release`
14. `--assignee`
15. `--delegate`
16. `--parent-id`
17. `--priority <0-4>`: 0=none, 1=urgent, 2=high, 3=medium, 4=low
18. `--created-at`
19. `--updated-at`
20. `--include-archived`
21. `--workspace <id|all>`: Connected Linear workspace id, or all
22. `--priority`: is 0=none, 1=urgent, 2=high, 3=medium, 4=low. JSON includes priorityLabel on each issue.

Example: `orca linear list-issues --team ENG --state started --assignee me --json`

### `orca linear relation add`

Purpose: Add a Linear issue relation

```text
orca linear relation add [<id>] [--current] --related <issue> --type blocks|blocked-by|related|duplicate-of [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--related`
6. `--type`
7. `--workspace <id>`: Connected Linear workspace id
8. `--id <id>`: Identifier for a target item or permission

Example: `orca linear relation add ENG-1 --related ENG-2 --type blocks --json`

### `orca linear relation remove`

Purpose: Remove a Linear issue relation

```text
orca linear relation remove [<id>] [--current] --related <issue> --type blocks|blocked-by|related|duplicate-of [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--related`
6. `--type`
7. `--workspace <id>`: Connected Linear workspace id
8. `--id <id>`: Identifier for a target item or permission

Example: `orca linear relation remove ENG-1 --related ENG-2 --type related --json`

### `orca linear issue`

Purpose: Read Linear issue context for agents

```text
orca linear issue [<id>] [--current] [--comments] [--children] [--depth <n>] [--attachments] [--relations] [--activity] [--full] [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--comments`: Include threaded Linear comments
6. `--children`: Include recursive child issues
7. `--depth <n>`: Child issue depth for --children/--full
8. `--attachments`: Include attachment metadata and URLs
9. `--relations`: Include blocking, related, and duplicate links
10. `--activity`: Include issue field-change history
11. `--full`: Include all supported V1 issue context within caps
12. `--workspace <id>`: Connected Linear workspace id
13. `--id <id>`: Linear issue key, id, or URL

Example: `orca linear issue ENG-123`

### `orca linear search`

Purpose: Search connected Linear workspaces

```text
orca linear search <query> [--limit <n>] [--workspace <id>|all] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--limit <n>`: Maximum number of rows to return
5. `--workspace <id|all>`: Connected Linear workspace id, or all
6. `--query <text>`: Text to search across Linear issues

Example: `orca linear search "auth bug"`

### `orca linear team list`

Purpose: List connected Linear teams

```text
orca linear team list [--workspace <id>|all] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--workspace <id>`: Connected Linear workspace id

Example: `orca linear team list --workspace all --json`

### `orca linear team members`

Purpose: List Linear team members

```text
orca linear team members --team <key|id> [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--team`
5. `--workspace <id>`: Connected Linear workspace id

Example: `orca linear team members --team ENG --json`

### `orca linear team states`

Purpose: List Linear team workflow states

```text
orca linear team states --team <key|id> [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--team`
5. `--workspace <id>`: Connected Linear workspace id

Example: `orca linear team states --team ENG --json`

### `orca linear team labels`

Purpose: List Linear team labels

```text
orca linear team labels --team <key|id> [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--team`
5. `--workspace <id>`: Connected Linear workspace id

Example: `orca linear team labels --team ENG --json`

### `orca linear project list`

Purpose: List connected Linear projects

```text
orca linear project list [--query <text>] [--limit <n>] [--workspace <id>|all] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--query <text>`: Search text for matching refs
5. `--limit <n>`: Maximum number of rows to return
6. `--workspace <id>`: Connected Linear workspace id

Example: `orca linear project list --query launch --json`

### `orca linear list`

Purpose: List Linear issues for task triage

```text
orca linear list [--filter assigned|created|all|completed|open] [--team <key|id>] [--limit <n>] [--workspace <id>|all] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--filter`
5. `--team`
6. `--limit <n>`: Maximum number of rows to return
7. `--workspace <id>`: Connected Linear workspace id

Example: `orca linear list --filter assigned --limit 10 --json`

### `orca linear status set`

Purpose: Set a Linear issue status

```text
orca linear status set [<id>] [--current] --to <state> [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--to <state>`: Exact Linear workflow state name
6. `--workspace <id>`: Connected Linear workspace id
7. `--id <id>`: Identifier for a target item or permission

Example: `orca linear status set ENG-123 --to "In Review"`

### `orca linear assignee set`

Purpose: Assign a Linear issue

```text
orca linear assignee set [<id>] [--current] (--me | --to-id <userId>) [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--me`
6. `--to-id`
7. `--workspace <id>`: Connected Linear workspace id
8. `--id <id>`: Identifier for a target item or permission

Example: `orca linear assignee set --current --me --json`

### `orca linear assignee clear`

Purpose: Clear a Linear issue assignee

```text
orca linear assignee clear [<id>] [--current] [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--workspace <id>`: Connected Linear workspace id
6. `--id <id>`: Identifier for a target item or permission

Example: `orca linear assignee clear ENG-123 --json`

### `orca linear priority set`

Purpose: Set a Linear issue priority

```text
orca linear priority set [<id>] [--current] --to none|low|medium|high|urgent [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--to <state>`: Exact Linear workflow state name
6. `--workspace <id>`: Connected Linear workspace id
7. `--id <id>`: Identifier for a target item or permission

Example: `orca linear priority set --current --to high --json`

### `orca linear priority clear`

Purpose: Clear a Linear issue priority

```text
orca linear priority clear [<id>] [--current] [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--workspace <id>`: Connected Linear workspace id
6. `--id <id>`: Identifier for a target item or permission

Example: `orca linear priority clear ENG-123 --json`

### `orca linear estimate set`

Purpose: Set a Linear issue estimate

```text
orca linear estimate set [<id>] [--current] --to <number> [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--to <state>`: Exact Linear workflow state name
6. `--workspace <id>`: Connected Linear workspace id
7. `--id <id>`: Identifier for a target item or permission

Example: `orca linear estimate set --current --to 3 --json`

### `orca linear estimate clear`

Purpose: Clear a Linear issue estimate

```text
orca linear estimate clear [<id>] [--current] [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--workspace <id>`: Connected Linear workspace id
6. `--id <id>`: Identifier for a target item or permission

Example: `orca linear estimate clear ENG-123 --json`

### `orca linear due-date set`

Purpose: Set a Linear issue due date

```text
orca linear due-date set [<id>] [--current] --to <yyyy-mm-dd> [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--to <state>`: Exact Linear workflow state name
6. `--workspace <id>`: Connected Linear workspace id
7. `--id <id>`: Identifier for a target item or permission

Example: `orca linear due-date set --current --to 2026-06-30 --json`

### `orca linear due-date clear`

Purpose: Clear a Linear issue due date

```text
orca linear due-date clear [<id>] [--current] [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--workspace <id>`: Connected Linear workspace id
6. `--id <id>`: Identifier for a target item or permission

Example: `orca linear due-date clear ENG-123 --json`

### `orca linear label add`

Purpose: Add labels to a Linear issue

```text
orca linear label add [<id>] [--current] --label <labelId-or-exact-name>... [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--label`
6. `--workspace <id>`: Connected Linear workspace id
7. `--id <id>`: Identifier for a target item or permission

Example: `orca linear label add --current --label Bug --json`

### `orca linear label remove`

Purpose: Remove labels from a Linear issue

```text
orca linear label remove [<id>] [--current] --label <labelId-or-exact-name>... [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--label`
6. `--workspace <id>`: Connected Linear workspace id
7. `--id <id>`: Identifier for a target item or permission

Example: `orca linear label remove --current --label Bug --json`

### `orca linear label set`

Purpose: Replace labels on a Linear issue

```text
orca linear label set [<id>] [--current] --label <labelId-or-exact-name>... [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--label`
6. `--workspace <id>`: Connected Linear workspace id
7. `--id <id>`: Identifier for a target item or permission

Example: `orca linear label set ENG-123 --label Bug --json`

### `orca linear comment add`

Purpose: Add a comment to a Linear issue

```text
orca linear comment add [<id>] [--current] (--body <text> | --body-file <path|->) [--reply-to <commentId>] [--write-id <uuid>] [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--body <text>`: Linear comment or issue body
6. `--body-file <path|->`: Read Linear body from a file or stdin
7. `--reply-to <id>`: Comment id to reply to
8. `--write-id <uuid>`: Retry id from linear_write_unconfirmed
9. `--workspace <id>`: Connected Linear workspace id
10. `--id <id>`: Identifier for a target item or permission

Example: `orca linear comment add ENG-123 --body "Implementation is ready for review."`

### `orca linear comment edit`

Purpose: Replace the body of a Linear comment

```text
orca linear comment edit <commentId> (--body <text> | --body-file <path|->) [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--body <text>`: Linear comment or issue body
5. `--body-file <path|->`: Read Linear body from a file or stdin
6. `--workspace <id>`: Connected Linear workspace id
7. `--id <commentId>`: Linear comment id (a UUID)

Example: `orca linear comment edit <commentId> --body "Updated: ready for review."`

### `orca linear comment delete`

Purpose: Delete a Linear comment

```text
orca linear comment delete <commentId> [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--workspace <id>`: Connected Linear workspace id
5. `--id <commentId>`: Linear comment id (a UUID)

Example: `orca linear comment delete <commentId> --json`

### `orca linear attach`

Purpose: Attach a link to a Linear issue

```text
orca linear attach [<id>] [--current] --url <url> [--title <title>] [--write-id <uuid>] [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--current`: Use the current Orca worktree linked Linear issue
5. `--url <url>`: Absolute http(s) link to attach
6. `--title <text>`: Attachment title
7. `--write-id <uuid>`: Retry id from linear_write_unconfirmed
8. `--workspace <id>`: Connected Linear workspace id
9. `--id <id>`: Identifier for a target item or permission

Example: `orca linear attach ENG-123 --url https://example.com/review/123 --title "PR/MR link"`

### `orca linear create`

Purpose: Create a Linear issue

```text
orca linear create --title <title> [--body <text> | --body-file <path|->] [--team <key|id>] [--project <projectId-or-exact-name>] [--state <stateId|exact-name>] [--assignee me|<userId>] [--priority none|low|medium|high|urgent] [--estimate <number>] [--due-date <yyyy-mm-dd>] [--label <labelId-or-exact-name>]... [--parent <id> | --parent-current] [--write-id <uuid>] [--workspace <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--title <text>`: New Linear issue title
5. `--body <text>`: Linear comment or issue body
6. `--body-file <path|->`: Read Linear body from a file or stdin
7. `--team <key>`: Linear team key
8. `--project`
9. `--state`
10. `--assignee`
11. `--priority`
12. `--estimate`
13. `--due-date`
14. `--label`
15. `--parent <id>`: Parent Linear issue key, id, or URL
16. `--parent-current`: Use the current linked issue as parent
17. `--write-id <uuid>`: Retry id from linear_write_unconfirmed
18. `--workspace <id>`: Connected Linear workspace id

Example: `orca linear create --title "Investigate flaky login" --team ENG --project "Launch"`


## Mobile emulator

### `orca emulator` (group)

Usage: `orca emulator <command> [options]`. Subcommands: `list`, `devices`, `attach`, `tap`, `type`, `gesture`, `button`, `rotate`, `exec`, `kill`, `shutdown`, `install`, `launch`, `permissions`, `ax`, `logcat`.

### `orca emulator list`

Purpose: List available/running emulators (Orca-managed + raw serve-sim)

```text
orca emulator list [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca emulator attach`

Purpose: Attach/start helper for a device and make it active for the worktree

```text
orca emulator attach [device] [--worktree <selector>] [--focus] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--focus`: Reveal the created terminal session in Orca
6. `--device`

### `orca emulator tap`

Purpose: Tap at normalized 0..1 coords (preferred for single taps)

```text
orca emulator tap <x> <y> [--device <id>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--device`
5. `--emulator`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--x`
8. `--y`

### `orca emulator type`

Purpose: Type text (US ASCII only)

```text
orca emulator type <text> [--device <id>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--text <text>`: Text payload to send or type
5. `--device`
6. `--emulator`
7. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca emulator gesture`

Purpose: Send a multi-point gesture sequence

```text
orca emulator gesture '<json>' [--device <id>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--points`
5. `--device`
6. `--emulator`
7. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca emulator button`

Purpose: Hardware button (home, side_button, etc.)

```text
orca emulator button <name> [--device <id>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--device`
5. `--emulator`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--name <name>`: Name for the new worktree or automation

### `orca emulator rotate`

Purpose: Rotate device

```text
orca emulator rotate <orientation> [--device <id>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--device`
5. `--emulator`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--orientation`

### `orca emulator exec`

Purpose: Raw passthrough (e.g. orca emulator exec --command "tap 0.5 0.7" or "ca-debug blended on")

```text
orca emulator exec --command <cmd> [--device <id>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--command <text>`: Command to run in the terminal on startup
5. `--device`
6. `--emulator`
7. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca emulator kill`

Purpose: Stop helper for device

```text
orca emulator kill [--device <id>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--device`
5. `--emulator`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca emulator devices`

Purpose: List all emulator devices/AVDs across iOS and Android

```text
orca emulator devices [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca emulator shutdown`

Purpose: Stop helper and shut down the simulator device

```text
orca emulator shutdown [--device <id>] [--emulator <id>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--device`
5. `--emulator`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca emulator install`

Purpose: Install an APK onto the target Android device

```text
orca emulator install <apkPath> [--reinstall] [--device <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--device`
5. `--emulator`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--path <path>`: Path argument for the command
8. `--reinstall`

### `orca emulator launch`

Purpose: Launch an Android app by package (and optional activity)

```text
orca emulator launch <package> [--activity <name>] [--device <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--device`
5. `--emulator`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--package`
8. `--activity`: Include issue field-change history

### `orca emulator permissions`

Purpose: Grant/revoke an Android runtime permission, or reset all runtime grants

```text
orca emulator permissions <grant|revoke> <package> <permission> [--device <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--device`
5. `--emulator`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--op`
8. `--package`
9. `--permission`

### `orca emulator ax`

Purpose: Dump the accessibility tree (Android uiautomator; iOS serve-sim AX, frames 0..1)

```text
orca emulator ax [--device <id>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--device`
5. `--emulator`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca emulator logcat`

Purpose: Capture a one-shot logcat dump from the Android device

```text
orca emulator logcat [--lines <n>] [--device <id>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--device`
5. `--emulator`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--lines`


## Browser automation

### `orca tab` (group)

Usage: `orca tab <command> [options]`. Subcommands: `list`, `show`, `current`, `switch`, `create`, `close`.

### `orca tab create`

Purpose: Create a new browser tab in the current worktree

```text
orca tab create [--url <url>] [--worktree <selector>] [--profile <id>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--url <url>`: URL to navigate to
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--profile <id>`: Browser profile id

### `orca tab list`

Purpose: List open browser tabs

```text
orca tab list [--worktree <selector|all>] [--show-profile] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--show-profile`: Include tab profile in text output

### `orca tab show`

Purpose: Show one browser tab by page id

```text
orca tab show --page <id> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--page <id>`: Stable browser page id from `orca tab list --json`
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca tab current`

Purpose: Show the current browser tab

```text
orca tab current [--worktree <selector|all>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current

### `orca tab profile`

Purpose: list               List browser session profiles available to browser tabs

```text
orca tab profile <command> [options]
```

Flags: none beyond `--help`.

### `orca tab profile list`

Purpose: List browser session profiles available to browser tabs

```text
orca tab profile list [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them

### `orca tab profile create`

Purpose: Create a browser session profile for browser tabs

```text
orca tab profile create --label <name> [--scope <isolated|imported>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--label`
5. `--scope`

### `orca tab profile delete`

Purpose: Delete a browser session profile used by browser tabs

```text
orca tab profile delete --profile <id> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--profile <id>`: Browser profile id

### `orca tab profile set`

Purpose: Switch a browser tab to a different browser profile

```text
orca tab profile set (--page <id> | --worktree <selector>) --profile <id> [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--profile <id>`: Browser profile id
5. `--page <id>`: Stable browser page id from `orca tab list --json`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca tab profile show`

Purpose: Show the browser profile bound to a tab

```text
orca tab profile show --page <id> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--page <id>`: Stable browser page id from `orca tab list --json`
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca tab profile use-default`

Purpose: Switch a browser tab back to the default browser profile

```text
orca tab profile use-default --page <id> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--page <id>`: Stable browser page id from `orca tab list --json`
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca tab profile clone`

Purpose: Clone a browser tab into a different browser profile

```text
orca tab profile clone --profile <id> [--page <id>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--profile <id>`: Browser profile id
5. `--page <id>`: Stable browser page id from `orca tab list --json`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca tab switch`

Purpose: Switch the active browser tab

```text
orca tab switch (--index <n> | --page <id>) [--worktree <selector>] [--focus] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--index <n>`: Tab index to switch to
5. `--page <id>`: Stable browser page id from `orca tab list --json`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--focus`: Reveal the created terminal session in Orca
8. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca tab close`

Purpose: Close a browser tab

```text
orca tab close [--index <n>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--index <n>`: Tab index to switch to
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca snapshot`

Purpose: Capture an accessibility snapshot of the active browser tab

```text
orca snapshot [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca goto`

Purpose: Navigate the active browser tab to a URL

```text
orca goto --url <url> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--url <url>`: URL to navigate to
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca click`

Purpose: Click a browser element by ref

```text
orca click --element <ref> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--element <ref>`: Element ref from snapshot (e.g. e3)
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca fill`

Purpose: Clear and fill a browser input by ref

```text
orca fill --element <ref> --value <text> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--element <ref>`: Element ref from snapshot (e.g. e3)
5. `--value <text>`: Value to fill or select
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca type`

Purpose: Type text at the current browser focus

```text
orca type --input <text> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--input <text>`: Text to type at current focus
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca select`

Purpose: Select a dropdown option by ref

```text
orca select --element <ref> --value <value> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--element <ref>`: Element ref from snapshot (e.g. e3)
5. `--value <text>`: Value to fill or select
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca hover`

Purpose: Hover over a browser element by ref

```text
orca hover --element <ref> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--element <ref>`: Element ref from snapshot (e.g. e3)
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca keypress`

Purpose: Press a key (Enter, Tab, Escape, ArrowDown, etc.)

```text
orca keypress --key <name> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--key <key>`: Key argument for this command
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca scroll`

Purpose: Scroll the browser viewport

```text
orca scroll --direction <up|down> [--amount <pixels>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--direction <dir>`: Direction: up|down|left|right for scroll, horizontal|vertical for split
5. `--amount <pixels>`: Scroll distance in pixels
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca back`

Purpose: Navigate back in browser history

```text
orca back [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca reload`

Purpose: Reload the active browser tab

```text
orca reload [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca screenshot`

Purpose: Capture a viewport screenshot of the active browser tab

```text
orca screenshot [--format <png|jpeg>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--format <png|jpeg>`: Screenshot image format
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca eval`

Purpose: Evaluate JavaScript in the browser page context

```text
orca eval --expression <js> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--expression <js>`: JavaScript expression to evaluate
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca wait`

Purpose: Wait for element, text, URL, load state, JS condition, or timeout

```text
orca wait [--selector <sel>] [--timeout <ms>] [--text <text>] [--url <pattern>] [--load <state>] [--fn <js>] [--state <hidden|visible>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--selector`
5. `--timeout`
6. `--text <text>`: Text payload to send or type
7. `--url <url>`: URL to navigate to
8. `--load`
9. `--fn`
10. `--state`
11. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
12. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca check`

Purpose: Check a checkbox/radio by ref

```text
orca check --element <ref> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--element <ref>`: Element ref from snapshot (e.g. e3)
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca uncheck`

Purpose: Uncheck a checkbox/radio by ref

```text
orca uncheck --element <ref> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--element <ref>`: Element ref from snapshot (e.g. e3)
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca focus`

Purpose: Focus a browser element by ref

```text
orca focus --element <ref> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--element <ref>`: Element ref from snapshot (e.g. e3)
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca clear`

Purpose: Clear an input element by ref

```text
orca clear --element <ref> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--element <ref>`: Element ref from snapshot (e.g. e3)
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca drag`

Purpose: Drag from one element to another

```text
orca drag --from <ref> --to <ref> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--from`
5. `--to`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca upload`

Purpose: Upload files to a file input element

```text
orca upload --element <ref> --files <path,...> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--element <ref>`: Element ref from snapshot (e.g. e3)
5. `--files`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca dblclick`

Purpose: Double-click element by ref

```text
orca dblclick --element <ref> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--element <ref>`: Element ref from snapshot (e.g. e3)
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca forward`

Purpose: Navigate forward in browser history

```text
orca forward [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca scrollintoview`

Purpose: Scroll element into view

```text
orca scrollintoview --element <ref> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--element <ref>`: Element ref from snapshot (e.g. e3)
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca get`

Purpose: Get element property (text, html, value, url, title, count, box)

```text
orca get --what <property> [--element <ref>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--what`
5. `--element <ref>`: Element ref from snapshot (e.g. e3)
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca is`

Purpose: Check element state (visible, enabled, checked)

```text
orca is --what <state> --element <ref> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--what`
5. `--element <ref>`: Element ref from snapshot (e.g. e3)
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca inserttext`

Purpose: Insert text without key events

```text
orca inserttext --text <text> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--text <text>`: Text payload to send or type
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca find`

Purpose: Find element by semantic locator and perform action

```text
orca find --locator <type> --value <text> --action <action> [--text <text>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--locator`
5. `--value <text>`: Value to fill or select
6. `--action <name>`: Secondary accessibility action name
7. `--text <text>`: Text payload to send or type
8. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
9. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca download`

Purpose: Download a file by clicking a selector

```text
orca download --selector <ref> --path <path> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--selector`
5. `--path <path>`: Path argument for the command
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca highlight`

Purpose: Highlight an element by selector

```text
orca highlight --selector <ref> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--selector`
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca exec`

Purpose: Run any agent-browser command against the active browser tab

```text
orca exec --command "<agent-browser command>" [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--command <text>`: Command to run in the terminal on startup
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca set device`

Purpose: Emulate a device

```text
orca set device --name <device> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--name <name>`: Name for the new worktree or automation
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca set offline`

Purpose: Toggle offline mode

```text
orca set offline [--state <on|off>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--state`
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca set headers`

Purpose: Set extra HTTP headers

```text
orca set headers --headers <json> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--headers`
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca set credentials`

Purpose: Set HTTP auth credentials

```text
orca set credentials --user <user> --pass <pass> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--user`
5. `--pass`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca set media`

Purpose: Set color scheme and reduced motion preferences

```text
orca set media [--color-scheme <dark|light>] [--reduced-motion <reduce|no-preference>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--color-scheme`
5. `--reduced-motion`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca mouse move`

Purpose: Move mouse to x,y coordinates

```text
orca mouse move --x <n> --y <n> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--x`
5. `--y`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca mouse down`

Purpose: Press mouse button

```text
orca mouse down [--button <left|right|middle>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--button`
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca mouse up`

Purpose: Release mouse button

```text
orca mouse up [--button <left|right|middle>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--button`
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca mouse wheel`

Purpose: Scroll wheel

```text
orca mouse wheel --dy <n> [--dx <n>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--dy`
5. `--dx`
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca clipboard read`

Purpose: Read clipboard contents

```text
orca clipboard read [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca clipboard write`

Purpose: Write text to clipboard

```text
orca clipboard write --text <text> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--text <text>`: Text payload to send or type
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca dialog accept`

Purpose: Accept a browser dialog

```text
orca dialog accept [--text <text>] [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--text <text>`: Text payload to send or type
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca dialog dismiss`

Purpose: Dismiss a browser dialog

```text
orca dialog dismiss [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca storage local get`

Purpose: Get a localStorage value by key

```text
orca storage local get --key <key> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--key <key>`: Key argument for this command
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca storage local set`

Purpose: Set a localStorage value

```text
orca storage local set --key <key> --value <value> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--key <key>`: Key argument for this command
5. `--value <text>`: Value to fill or select
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca storage local clear`

Purpose: Clear all localStorage

```text
orca storage local clear [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca storage session get`

Purpose: Get a sessionStorage value by key

```text
orca storage session get --key <key> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--key <key>`: Key argument for this command
5. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
6. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca storage session set`

Purpose: Set a sessionStorage value

```text
orca storage session set --key <key> --value <value> [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--key <key>`: Key argument for this command
5. `--value <text>`: Value to fill or select
6. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
7. `--page <id>`: Stable browser page id from `orca tab list --json`

### `orca storage session clear`

Purpose: Clear all sessionStorage

```text
orca storage session clear [--worktree <selector>] [--json]
```

Flags:

1. `--json`: Emit machine-readable JSON
2. `--pairing-code <code>`: Run against a remote Orca server using an orca://pair?... code
3. `--environment <selector>`: Run against a saved paired Orca server (id or name); terminal handles belong to the server that issued them
4. `--worktree <selector>`: Worktree selector such as identity:<identity>, id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
5. `--page <id>`: Stable browser page id from `orca tab list --json`


## Commands MatrixKoder will likely need

Read-only data commands (safe to run; all take `--json`):

1. Runtime readiness: `orca status --json`.
2. Projects and repos: `orca project list --json`, `orca repo list --json`, `orca repo show --repo <selector> --json`.
3. Lanes (worktrees): `orca worktree list [--repo <selector>] [--limit <n>] --json`, `orca worktree show --worktree <selector> --json`, `orca worktree current --json`.
4. Agent status across lanes: `orca worktree ps [--limit <n>] --json`. Read `status`, `terminalVerdict`, and `agents[].state` (`working` or `done`).
5. Terminals: `orca terminal list [--worktree <selector>] [--limit <n>] --json`, `orca terminal show [--terminal <handle>] --json`, `orca terminal read [--terminal <handle>] [--cursor <n>] [--limit <n>] --json`.
6. Hosts: `orca host list --json`.
7. Orchestration state, not run here: `orca orchestration run-list --json`, `orca orchestration inbox --json`, `orca orchestration task-list --json`.

Action commands (change state; confirm the target first):

1. New lane with an agent (creates a checkout): `orca worktree create --name <name> [--repo <selector>|--project <id-or-name> [--host <host>]] --agent <id> --prompt "<brief>" [--model <id>] [--effort <level>] [--surface chat|terminal] --no-parent --json`.
2. Start an agent in an existing lane: `orca agent launch --agent <id> [--worktree <selector>] [--prompt "<text>"] [--model <id>] [--effort <level>] [--surface chat|terminal] --json`.
3. New terminal in a lane: `orca terminal create [--worktree <selector>] [--title <name>] [--command "<text>"] --json`.
4. Send input to a terminal: `orca terminal send [--terminal <handle>] --text "<text>" --enter --json`. Add `--wait-submit <seconds>` to observe the turn start. Never resend on silence. After an ambiguous failure, repeat with `--retry-request <id>`.
5. Wait for an agent CLI to settle: `orca terminal wait --terminal <handle> --for tui-idle --timeout-ms <ms> --json`. Always pass a timeout.
6. Destructive, ask first: `orca worktree rm --worktree <selector> [--force] [--run-hooks] --json`, `orca terminal close [--terminal <handle>] [--tab]` or `orca terminal close --worktree <selector> --all --json`.

Syntax above is copied from each command's `--help` and checked against it. Replace `<...>` with real values and drop `[...]` parts you do not need.
