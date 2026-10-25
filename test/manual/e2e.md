# End-to-end check (T8) — MatrixKoder 0.2.0

A manual checklist you run in Orca on your own machine. The automated tests stub `orca`; only
this list proves the real thing. Fill the empty `Result:` line under each step with `pass`
or `fail` plus what you saw. Use a throwaway repo and a throwaway orchestration run for
steps 4 and 5; the steps change real Orca state.

Before you start: MatrixKoder 0.2.0 is installed in Orca (Settings › Plugins), its capabilities
are accepted, and the plugin is enabled. Optionally use a temporary data folder: start Orca
with `MK_DATA_DIR=/tmp/mk-e2e` so `~/.matrixkoder/mk-data.db` is untouched.

Tester: ______________  Date: ______________  Orca version: ______________

---

## 1. Sidebar launcher

Action: click the MatrixKoder icon (`layers`) in the right sidebar.

Expected: a small panel titled "MatrixKoder" with "Open the dashboard", the line "Press ⌘J, then
choose MatrixKoder: Open Dashboard", the shortcuts ⌥⌘D (Open Dashboard) and ⌥⌘M (toggle this
panel), and the footer "This panel is only a launcher. It shows no live data." There is no
"Data may be stale" banner and no lane or run data.

Result:

## 2. Open Dashboard from the command palette

Action: press ⌘J, type `Open Dashboard`, run **MatrixKoder: Open Dashboard**.

Expected: a new Orca browser tab opens and loads the MatrixKoder dashboard from
`http://127.0.0.1:<port>/?t=…`. The page renders (Matrix rain, tabs on the left) and shows no
"connection to local worker lost" banner. The first run may take a few seconds while the worker starts.

Result:

## 3. Reuse the tab, and the shortcut

Action: switch to another tab, then press ⌥⌘D (or run the command again).

Expected: the existing dashboard tab comes to the front. No second dashboard tab opens. Close
the dashboard tab and press ⌥⌘D again: a new tab opens.

Result:

## 4. See real lanes

Action: in the dashboard open **Lanes** (and **Projects** / **Overview**). Compare with Orca's
own worktree list.

Expected: the repos and worktrees you have open in Orca appear, with their real branch names and
agent states. Create a new worktree in Orca; within about 10 seconds it appears on **Lanes**
without reloading the tab. Nothing from the old mock data (fake lane names) is left.

Result:

## 5. Approve a test gate on a throwaway run

Setup (in a terminal in the throwaway repo):

```bash
orca orchestration run-create --objective "MK e2e throwaway" --json
orca orchestration task-create --spec "e2e throwaway task" --json          # note the task id
orca orchestration gate-create --task <task_id> --question "e2e test gate" --options '["approved","rejected"]' --json
```

Action: open **Waiting** in the dashboard, find the test gate, click **Approve**. Within the
10-second undo window you may click **Undo**; this time let it run out.

Expected: the gate is listed with the run's objective; after the undo window Orca shows the gate
as resolved (`orca orchestration gate-list --json` shows it approved). The Waiting screen no
longer lists it.

Result:

## 6. Add and fix a bug

Action 1 (in a terminal inside the throwaway repo):

```bash
MK_PLUGIN="$HOME/Library/Application Support/Orca/plugins/interstellar.matrixkoder"
node "$MK_PLUGIN/$(cat "$MK_PLUGIN/current")/bin/mk.mjs" bug add \
  --title "e2e test bug" --details "created by test/manual/e2e.md" --risk 2
```

Expected 1: JSON for the new bug with an id such as `B-1` and status `open`. Within about 10
seconds it appears on the dashboard's **Bugs** screen (no reload).

Action 2: in the dashboard, click **Fix** on that bug (or run `node "$MK" bug fix B-1`).

Expected 2: the bug's status changes to `fixing`, and `orca orchestration task-list --json`
shows a new task whose spec starts with `mk-ref: bug:B-1#1`. (Do not run Fix a second time: each
run is a new attempt with its own task.)

Result:

## 7. Agent skill

Action: start an agent in the throwaway repo and ask it "log a bug: the README has a typo".

Expected: the agent finds `bin/mk.mjs` from the path in `skills/matrixkoder/SKILL.md` and runs
`mk bug add`; the bug shows up on **Bugs**. (If your agent does not pick up plugin skill files
automatically, copy `skills/matrixkoder/` into its skills folder first; Orca 1.4 has no
manifest field that installs skills.)

Result:

## 8. Clean up

Action: mark the throwaway tasks done (`orca orchestration task-update --id <task_id> --status completed --json`;
Orca 1.4 has no command that deletes a run), close the dashboard tab, delete the `MK_DATA_DIR` folder
if you used one.

Expected: nothing left running that you did not start.

Result:

---

Overall: pass / fail ______________   Notes: ______________________________
