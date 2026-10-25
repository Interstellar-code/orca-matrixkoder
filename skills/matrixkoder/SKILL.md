---
name: matrixkoder
description: >-
  File bugs and to-dos into the MatrixKoder dashboard from an agent session, and start a fix
  for a logged bug as an Orca task. Use when you find a real bug you are not fixing right now
  (`mk bug add`), when the user asks you to fix a logged bug such as B-12 (`mk bug fix`), or
  when you or the user want a to-do kept for later (`mk todo add`). Runs the `mk` CLI shipped
  inside the MatrixKoder Orca plugin.
---

# MatrixKoder: bugs and to-dos

MatrixKoder is an Orca plugin with a dashboard. Bugs and to-dos live in its own database
(`~/.matrixkoder/mk-data.db`) and show up on the dashboard's Bugs and Todo screens. You write
to that database with the `mk` command. Orca stays the source of truth for lanes, runs and
tasks; `mk` never edits those directly, it only asks Orca to create a task when a bug is sent
to be fixed.

## Find the `mk` command

The CLI is `bin/mk.mjs` inside the installed plugin copy. Orca keeps one folder per installed
version under `interstellar.matrixkoder/`, and the file `current` next to them holds the name
of the active folder. Resolve it each session (macOS path shown; do not hard-code the repo
checkout):

```bash
MK_PLUGIN="$HOME/Library/Application Support/Orca/plugins/interstellar.matrixkoder"
MK="$MK_PLUGIN/$(cat "$MK_PLUGIN/current")/bin/mk.mjs"
node "$MK" bug list
```

Every command below is `node "$MK" ...`. It needs Node 22.13 or newer (it uses `node:sqlite`).
If `$MK_PLUGIN` does not exist, the plugin is not installed: tell the user, do not look for
another copy. Output is JSON on stdout. A failure is exit code 1 (2 for a usage mistake) with
one line on stderr.

Inside a git repo the command works out which repo you mean from the current folder (the
main checkout and all its worktrees count as one repo). Outside a repo, or to file against
another one, pass `--repo <repo-id-or-path>` or set `MK_REPO`. (`MK_REPORTED_BY` only sets the reporter name.)

## When to file a bug (`mk bug add`)

File a bug when you find something that is wrong in the code, you have evidence for it, and
fixing it is outside what you were asked to do right now. Do not file a bug for a mistake
you can fix in the file you are already editing, for style opinions, or for a guess you have
not checked.

```bash
node "$MK" bug add --title "Token refresh loops on 401" \
  --details "refreshToken() retries without a limit when the server answers 401. Repro: ..." \
  --file src/auth/refresh.ts --line 88 --risk 4
```

1. `--title` is required: one line, what is wrong.
2. `--details` says how you know (what you ran or read), so someone else can act without asking.
3. `--file` and `--line` point at the code. Leave them out if the bug has no single place.
4. `--risk` is 1 to 5 (5 = data loss, security or a crash); the default is 3.
5. `--reported-by` names you; it defaults to `agent`.
6. The command prints the new row, including its id such as `B-12`. Mention that id to the user.

## When to start a fix (`mk bug fix`)

Run `mk bug fix B-12` only when the user (or the plan you are working from) says to fix that
bug. It creates an Orca task in the repo's bug run, with the bug's title, file, line and
details as the spec, and sets the bug's status to `fixing`. It does not fix anything by
itself: a worker has to pick the task up. Each run counts as a new attempt and creates a new
task (the earlier task id is kept in the bug's `past_task_ids`), so run it once per bug, and
again only when the user wants a retry. A bug that is already `fixed` or `wontfix` is refused;
run `mk bug reopen B-12` first.

```bash
node "$MK" bug list --status open
node "$MK" bug fix B-12
```

Other bug commands: `mk bug close B-12` (will not fix) and `mk bug reopen B-12`.

## To-dos (`mk todo add`)

Use a to-do for follow-up work that is not a bug: something the user asked you to remember,
or a next step you cannot do in this session.

```bash
node "$MK" todo add "Rotate the staging API key" --group soon
node "$MK" todo list
node "$MK" todo done 7
```

`--group` is `today` (default), `soon` or `later`.

## Rules

1. Never edit `~/.matrixkoder/mk-data.db` with SQL or another tool. Only `mk` and the
   dashboard write it.
2. Never run `orca orchestration check` to look for replies; the dashboard owns the inbox.
3. Do not file duplicates: run `mk bug list --status open` first (add `--repo` outside the repo; without it the list covers every repo) and skip a bug that is already there.
4. Put no secrets, tokens or customer data in a title or in details.
5. The dashboard itself opens from the Orca command palette (Cmd+J, then "MatrixKoder: Open
   Dashboard"). That is for the user; you do not need it to use `mk`.
