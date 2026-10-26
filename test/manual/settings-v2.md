# Settings v2 live check — MatrixKoder 0.3.0

A manual checklist you run in Orca on your own machine. The automated tests stub `orca` and use
temporary settings files; only this list proves settings v2 against your real Orca and your real
`~/.matrixkoder/mk-settings.json`. Fill the empty `Result:` line under each step with `pass` or
`fail` plus what you saw. Steps 5 to 8 start real Orca tasks: use a throwaway repo and plan.

Before you start: MatrixKoder 0.3.0 is installed and enabled in Orca (Settings › Plugins) and the
dashboard opens (⌥⌘D). Keep a copy of your settings file first:

```bash
cp ~/.matrixkoder/mk-settings.json ~/mk-settings.before-0.3.0.json
```

Tester: ______________  Date: ______________  Orca version: ______________

---

## 1. The six tabs

Action: open **Settings** in the dashboard.

Expected: six tabs: General, Routing & Quota, Work, Safety, Notifications, Appearance. There is
no Agents, Alerts, Theme or Shortcuts tab. Settings that Orca owns (OS notifications and sounds,
light/dark theme, keybindings, agent install and accounts) show as "Set in Orca: Settings > <pane>"
notes with no control.

Result:

## 2. The live v1 file migrates (G4)

Setup: your real `~/.matrixkoder/mk-settings.json` is still schema 1 (`"schema": 1`). If you have
already saved settings in 0.3.0 it is schema 2; then use the copy from the start of this list
(`cp ~/mk-settings.before-0.3.0.json ~/.matrixkoder/mk-settings.json` after quitting Orca) and
delete any `mk-settings.v1.bak*.json` next to it.

Action 1: restart Orca, open **Settings › General**.

Expected 1: the values you had changed in v1 (for example lanes at once, active repo, data
retention) show on their v2 controls. A list of migration notes says which v1 values were dropped,
clamped or moved. `ls ~/.matrixkoder` shows no `mk-settings.v1.bak.json` yet, and the file on disk
is still `"schema": 1` (loading never writes).

Action 2: change any one value (for example Snooze minutes) and save.

Expected 2: `~/.matrixkoder/mk-settings.v1.bak.json` now exists and is byte-identical to your
copy; `mk-settings.json` is now `"schema": 2`. A second save does not create another backup
(unless a timestamped name is needed because one existed).

Result:

## 3. One value per tab survives a reload and an Orca restart (G3)

Action: set one non-default value on each tab and save, for example:

1. General: Snooze minutes
2. Routing & Quota: Lanes at once
3. Work: a task spec template path for one scenario
4. Safety: confirm-before-start risk level
5. Notifications: turn one event off
6. Appearance: Matrix rain brightness

Then reload the dashboard tab, and after that quit and restart Orca and open the dashboard again.

Expected: each of the six values is shown on its screen after the reload and again after the
restart (not the default). Nothing reverts.

Result:

## 4. Appearance applies app-wide

Action: on **Appearance** turn Matrix rain off, change text size, density and reduced motion.

Expected: the change shows at once on every other screen (Lanes, Plan, Waiting), not only on the
Appearance screen, and is kept after a reload.

Result:

## 5. A high-risk task asks to confirm (C7)

Setup: in a throwaway plan, a task with risk 4 or higher that has no Orca task yet. On
**Safety** set "Confirm before starting a task at risk" to 4.

Action: open **Plan**, click **Start** on that task.

Expected: a confirm dialog appears first; the task does not start until you confirm. Cancel it:
nothing starts. Set the level to 6 and click Start on the same task: it starts without a dialog.
(Agents calling `mk.action` must pass `confirm: true` themselves; the dashboard asks you.)

Result:

## 6. Safety rows say what they are

Action: look at the four rows on **Safety**.

Expected: the risk level is labelled as checked by MatrixKoder. Protected branches, Never run
commands and Ask before push are each labelled "advisory: written into briefs". Start a task and
open its brief (Orca task spec): it ends with a "Rules from MatrixKoder settings" section listing
your branches, commands and the push rule. Nothing blocks an agent that ignores it.

Result:

## 7. Test notification arrives

Action: on **Notifications** click **Test notification**.

Expected: an Orca notification from MatrixKoder appears. Turn on quiet hours so that the current
time is inside the window and click it again: it is suppressed (or marked as quiet) as the screen
says. Turn quiet hours back off.

Result:

## 8. Solo mode starts a task in the main checkout (K7)

Setup: **General › Mode** = solo. **Routing & Quota › Lanes at once** = 2 for action 1, then 1.

Action 1: with Lanes at once = 2, open **Work**.

Expected 1: the hint "Solo mode: lanes share this checkout; set Lanes at once to 1 to avoid
clashes" is shown. Set it back to 1.

Action 2: in the throwaway plan start a task (Plan › Start).

Expected 2: the task starts and `orca worktree list --json` shows no new worktree for it; the
worker terminal's working directory is the repo's main checkout (`pwd` in it equals the repo
path), and its brief contains "Solo mode: work in this checkout; use in-session subagents for
parallel parts, not Orca lanes or worktrees". If Orca refuses `--worktree path:<main checkout>`,
note the exact error here: this is risk K7.

Action 3: **Lanes** and **Projects**.

Expected 3: no branch line, no Worktree row and no "N worktrees" text; the summary says "N lanes".

Result:

## 9. A plan with a bad route shows Partial and cannot start

Setup: on **Routing & Quota** note the agent used for large tasks. On the agent's models list
remove the model that route uses (or turn the agent off as routable), save.

Action: open **Plan** for a plan with a task of that size.

Expected: the plan shows as Partial; the affected task names the bad route, and its Start button
is refused (`plan_partial`, `bad_route` or `quota_floor` as shown on screen) instead of
starting. Restore the model; the plan returns to normal and Start works.

Result:

## 10. Task spec template per scenario (G6)

Action: on **Work** set a template file for `review` (a short markdown file with
`{{rules}}`), then start a review task.

Expected: the brief the agent receives is built from your file; clearing the field goes back to the
built-in review template. `sqlite3 ~/.matrixkoder/mk-data.db "select max(version) from schema_version"`
prints 2.

Result:

## 11. Clean up

Action: mark throwaway tasks done, put your own settings back
(`cp ~/mk-settings.before-0.3.0.json ~/.matrixkoder/mk-settings.json` while Orca is quit, if you
want the v1 file again) and set Mode and Lanes at once back to what you use.

Expected: nothing left running that you did not start.

Result:

---

Overall: pass / fail ______________   Notes: ______________________________
