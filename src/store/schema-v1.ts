// Generated from .matrixkoder/inbox/research/mk-data-schema.md §2.1 to §2.7 (schema v1).
// Column tags: [O] Orca id, [C]/[G] cached state written only by the sync loop, [M] MK-owned, [D] derived, [S] sync bookkeeping.
// Edit the research file and regenerate rather than hand-editing the DDL.
export const SCHEMA_V1 = `
CREATE TABLE schema_version(
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  note       TEXT
);

CREATE TABLE counter(                       -- [M] id sequences: 'bug' -> B-n
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE kv(                            -- [S] cursors and small facts
  key        TEXT PRIMARY KEY,              -- 'inbox.sequence', 'orca.version', 'host.machine_name', 'git.cursor:<worktree_id>'
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sync_state(                    -- [S] one row per source; feeds meta.stale and the stale banner
  source        TEXT PRIMARY KEY,           -- 'ps','terminals','repos','runs','tasks:<run>','workers:<run>','gates:<run>','inbox','quota','git','agent_cli','files'
  last_try_at   INTEGER,
  last_ok_at    INTEGER,
  last_error    TEXT,                       -- exact error text, no secrets
  last_error_at INTEGER,
  duration_ms   INTEGER,
  items         INTEGER
);

CREATE TABLE repo(
  id            TEXT PRIMARY KEY,           -- [O] orca repo list: repos[].id
  path          TEXT NOT NULL,              -- [C] repos[].path
  display_name  TEXT NOT NULL,              -- [C] repos[].displayName
  kind          TEXT,                       -- [C] repos[].kind
  badge_color   TEXT,                       -- [C] repos[].badgeColor
  remote_key    TEXT,                       -- [C] repos[].gitRemoteIdentity.canonicalKey (never remoteUrl: may carry credentials)
  added_at      INTEGER,                    -- [C] repos[].addedAt
  base_ref      TEXT,                       -- [G] git symbolic-ref refs/remotes/origin/HEAD, else 'main' guess
  base_ref_at   INTEGER,                    -- [G]
  bug_run_id    TEXT,                       -- [M] [O] Orca run used for bug-fix tasks of this repo (created on first \`mk bug fix\`)
  first_seen_at INTEGER NOT NULL,           -- [S]
  last_seen_at  INTEGER NOT NULL,           -- [S]
  gone_at       INTEGER                     -- [S] set when Orca no longer lists the repo
);
CREATE INDEX repo_path ON repo(path);

CREATE TABLE worktree(
  id                  TEXT PRIMARY KEY,     -- [O] worktree ps worktreeId == worktree list id
  repo_id             TEXT NOT NULL,        -- [O] repoId
  host_id             TEXT,                 -- [C] hostId
  path                TEXT NOT NULL,        -- [C] path
  branch              TEXT,                 -- [C] ps branch ("refs/heads/" stripped)
  head                TEXT,                 -- [C] worktree list head (short sha taken at read time)
  display_name        TEXT,                 -- [C] displayName
  is_main             INTEGER NOT NULL DEFAULT 0,  -- [C] isMainWorktree
  is_archived         INTEGER NOT NULL DEFAULT 0,  -- [C] isArchived
  parent_worktree_id  TEXT,                 -- [O] parentWorktreeId
  workspace_status    TEXT,                 -- [C] workspaceStatus (seen: in-progress)
  status              TEXT,                 -- [C] ps status (seen: active, working; docs also list inactive)
  live_terminal_count INTEGER NOT NULL DEFAULT 0,  -- [C] liveTerminalCount
  unverifiable_terminal_count INTEGER NOT NULL DEFAULT 0, -- [C]
  terminal_verdict    TEXT,                 -- [C] terminalVerdict (seen: live)
  last_activity_at    INTEGER,              -- [C] lastActivityAt
  last_output_at      INTEGER,              -- [C] lastOutputAt
  linked_pr           TEXT,                 -- [C] raw linkedPR as JSON text; shape unverified (null on all 8 worktrees today)
  git_base_ref        TEXT,                 -- [G] ref used for the numbers below
  git_ahead           INTEGER,              -- [G] git rev-list --count BASE..HEAD
  git_files           INTEGER,              -- [G] git diff --shortstat BASE...HEAD plus working tree
  git_added           INTEGER,              -- [G]
  git_removed         INTEGER,              -- [G]
  git_dirty           INTEGER,              -- [G]
  git_at              INTEGER,              -- [G] when the git numbers were taken
  git_error           TEXT,                 -- [G]
  first_seen_at       INTEGER NOT NULL,     -- [S]
  last_seen_at        INTEGER NOT NULL,     -- [S]
  gone_at             INTEGER               -- [S]
);
CREATE INDEX worktree_repo ON worktree(repo_id, gone_at);

CREATE TABLE pane(                           -- one row per terminal pane; agent columns are NULL for a plain shell
  pane_key          TEXT PRIMARY KEY,       -- [O] agents[].paneKey == terminal recordedPaneKey == tabId:leafId
  worktree_id       TEXT NOT NULL,          -- [O] terminal worktreeId / worktree ps parent
  repo_id           TEXT,                   -- [D] copied from worktree for cheap counts
  terminal_handle   TEXT,                   -- [O] terminals[].handle (NULL if the pane has agent state but no terminal row)
  tab_id            TEXT,                   -- [C] terminals[].tabId
  leaf_id           TEXT,                   -- [C] terminals[].leafId
  title             TEXT,                   -- [C] terminals[].title, cut to 120
  connected         INTEGER,                -- [C] terminals[].connected
  writable          INTEGER,                -- [C] terminals[].writable
  last_output_at    INTEGER,                -- [C] terminals[].lastOutputAt
  agent_type        TEXT,                   -- [C] agents[].agentType (claude, codex, omp, ...)
  agent_state       TEXT CHECK(agent_state IS NULL OR agent_state IN ('working','blocked','waiting','done')), -- [C] agents[].state
  agent_state_since INTEGER,                -- [C] agents[].stateStartedAt
  agent_updated_at  INTEGER,                -- [C] agents[].updatedAt
  parent_pane_key   TEXT,                   -- [C] agents[].parentPaneKey (sub-agent)
  tool_name         TEXT,                   -- [C] agents[].toolName (name only)
  task_title        TEXT,                   -- [C] agents[].taskTitle (null in all 3 live rows), cut to 120
  interrupted       INTEGER,                -- [C] agents[].interrupted
  turns             INTEGER NOT NULL DEFAULT 0, -- [M] +1 on each done->working transition seen by MK ("since MK started watching")
  first_seen_at     INTEGER NOT NULL,       -- [S]
  last_seen_at      INTEGER NOT NULL,       -- [S]
  gone_at           INTEGER                 -- [S]
);
-- NEVER stored from Orca: agents[].prompt, lastAssistantMessage, toolInput, preview, subagents[], subagentObservation, programStatus, terminals[].preview, ptyId, incarnationId.
CREATE INDEX pane_worktree ON pane(worktree_id, gone_at);
CREATE INDEX pane_handle ON pane(terminal_handle);

CREATE TABLE run(                            -- cache of Orca runs, so the sync loop knows what to pull and non-MK runs can be shown
  id                 TEXT PRIMARY KEY,      -- [O] run-list runs[].id
  objective          TEXT,                  -- [C] objective, cut to 200
  coordinator_handle TEXT,                  -- [C] coordinator_handle
  legacy             INTEGER NOT NULL DEFAULT 0, -- [C] legacy (the run_legacy_local placeholder is skipped)
  created_at         INTEGER,               -- [C] created_at (ISO -> ms)
  updated_at         INTEGER,               -- [C] updated_at
  repo_id            TEXT,                  -- [D] repo of the first lane seen for this run, or plan.repo_id / repo.bug_run_id owner
  first_seen_at      INTEGER NOT NULL,      -- [S]
  last_seen_at       INTEGER NOT NULL,      -- [S]
  gone_at            INTEGER                -- [S]
);

CREATE TABLE lane(                           -- Q1: a lane is a worker dispatch when a run exists, else a worktree with a live agent
  id                  INTEGER PRIMARY KEY,
  lane_key            TEXT NOT NULL UNIQUE, -- 'dsp:<dispatch_id>' or 'wt:<worktree_id>'
  kind                TEXT NOT NULL CHECK(kind IN ('dispatch','worktree')),
  repo_id             TEXT NOT NULL,        -- [O]
  label               TEXT NOT NULL,        -- [M] 'P1': phase lane_group (or phase code) for plan tasks, else 'L<n>' per repo
  run_id              TEXT,                 -- [O] kind=dispatch
  dispatch_id         TEXT,                 -- [O] worker-list workers[].dispatchId
  orca_task_id        TEXT,                 -- [O] workers[].taskId
  worktree_id         TEXT,                 -- [O] workers[].resource.worktreeId, or the worktree for kind=worktree
  pane_key            TEXT,                 -- [O] joined from terminal handle (workers[].agentTerminalHandle) to pane
  terminal_handle     TEXT,                 -- [O] workers[].agentTerminalHandle
  worker_state        TEXT,                 -- [C] workers[].workerState (starting,ready,start_unknown,failed,succeeded,stopping,stop_unknown,stopped,abandoned)
  dispatch_status     TEXT,                 -- [C] workers[].dispatchStatus (pending,dispatched,completed,failed,circuit_broken)
  stage_activity      TEXT,                 -- [C] workers[].projection.stage.activity (working,blocked,waiting,done,unknown)
  liveness            TEXT,                 -- [C] workers[].projection.liveness.verdict (live,unverifiable,exited)
  attention           TEXT,                 -- [C] projection.attention.categories joined by ','
  requires_action     INTEGER,              -- [C] projection.attention.requiresAction
  outcome             TEXT,                 -- [C] projection.outcome
  agent               TEXT,                 -- [C] worker-show worker.startOptions.launch.effective.agent (read once, immutable)
  model               TEXT,                 -- [C] ...effective.model
  effort              TEXT,                 -- [C] ...effective.effort
  phase               TEXT,                 -- [C] latest heartbeat payload.phase (implementing, verifying, ...)
  started_at          INTEGER,              -- [C] worker-show dispatch.dispatchedAt
  last_heartbeat_at   INTEGER,              -- [C] worker-show dispatch.lastHeartbeatAt
  ended_at            INTEGER,              -- [D] when the lane left working/waiting/blocked for good
  state               TEXT NOT NULL CHECK(state IN ('working','waiting','blocked','done','failed','stopped')), -- [D] rule in section 3.6
  state_at            INTEGER,              -- [D]
  first_seen_at       INTEGER NOT NULL,     -- [S]
  last_seen_at        INTEGER NOT NULL,     -- [S]
  CHECK((kind='dispatch' AND dispatch_id IS NOT NULL) OR (kind='worktree' AND worktree_id IS NOT NULL))
);
CREATE UNIQUE INDEX lane_dispatch ON lane(dispatch_id) WHERE dispatch_id IS NOT NULL;
CREATE UNIQUE INDEX lane_worktree_live ON lane(worktree_id) WHERE kind='worktree' AND ended_at IS NULL;
CREATE UNIQUE INDEX lane_label_live ON lane(repo_id, label) WHERE ended_at IS NULL;
CREATE INDEX lane_task ON lane(orca_task_id);
CREATE INDEX lane_state ON lane(repo_id, state, ended_at);

CREATE TABLE lane_activity(                  -- short per-lane feed for the Lanes "Activity" lines
  id       INTEGER PRIMARY KEY,
  lane_id  INTEGER NOT NULL REFERENCES lane(id) ON DELETE CASCADE,
  at       INTEGER NOT NULL,
  kind     TEXT NOT NULL CHECK(kind IN ('state','tool','check','commit','note')),
  text     TEXT NOT NULL                   -- <= 120 chars; tool NAME only, never toolInput, prompt or assistant text
);
CREATE INDEX lane_activity_lane ON lane_activity(lane_id, at DESC);

CREATE TABLE ask(                            -- Waiting: Orca gates and worker questions, cached, plus MK notes
  id             TEXT PRIMARY KEY,          -- [O] gate id (gate-list gates[].id) or question message id (inbox messages[].id)
  kind           TEXT NOT NULL CHECK(kind IN ('gate','question')),
  run_id         TEXT NOT NULL,             -- [O]
  orca_task_id   TEXT,                      -- [O] gate task_id / payload.taskId
  dispatch_id    TEXT,                      -- [O] payload.dispatchId (questions)
  thread_id      TEXT,                      -- [O] message thread_id (answer detection)
  title          TEXT NOT NULL,             -- [C] first line of gate.question / payload.question, cut to 160
  body           TEXT NOT NULL DEFAULT '',  -- [C] rest of that string, cut to 1500
  options        TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(options)), -- [C] gate options / payload.options
  orca_status    TEXT NOT NULL CHECK(orca_status IN ('pending','resolved','timeout','answered','closed')), -- [C] gate: pending|resolved|timeout; question: pending|answered (thread rule)
  resolution     TEXT,                      -- [C] gate.resolution (cut to 300); question: text of the reply message if seen
  asked_at       INTEGER NOT NULL,          -- [C] created_at (ISO -> ms)
  resolved_at    INTEGER,                   -- [C] gate.resolved_at / reply message created_at
  recommendation TEXT,                      -- [M] "Jev: approve ..." line, set only through a plugin/CLI command; NULL hides the line
  rec_source     TEXT,                      -- [M]
  snoozed_until  INTEGER,                   -- [M] "Ask me later"
  first_seen_at  INTEGER NOT NULL,          -- [S]
  last_seen_at   INTEGER NOT NULL,          -- [S]
  gone_at        INTEGER                    -- [S]
);
CREATE INDEX ask_open ON ask(orca_status, asked_at DESC);
CREATE INDEX ask_task ON ask(orca_task_id);

CREATE TABLE quota(                          -- Settings > Agents and Routing "spare Claude below N%"
  provider       TEXT NOT NULL,             -- [C] key under account list result.rateLimits (claude, codex, gemini, opencodeGo, antigravity, ...)
  win            TEXT NOT NULL CHECK(win IN ('session','weekly','monthly')), -- [C] session = 5h window
  used_percent   REAL,                      -- [C] rateLimits.<p>.<win>.usedPercent
  window_minutes INTEGER,                   -- [C] .windowMinutes
  resets_at      INTEGER,                   -- [C] .resetsAt
  updated_at     INTEGER,                   -- [C] rateLimits.<p>.updatedAt
  error          TEXT,                      -- [C] rateLimits.<p>.error (session null + error text for codex today)
  status         TEXT,                      -- [C] rateLimits.<p>.status
  PRIMARY KEY(provider, win)
);

CREATE TABLE agent_cli(                      -- Settings > Agents "on PATH" probe (no Orca command exists)
  agent_id   TEXT PRIMARY KEY,              -- 'claude','codex','agy','opencode','omp','gemini',...
  found      INTEGER NOT NULL,              -- [G] command -v
  cli_path   TEXT,                          -- [G]
  version    TEXT,                          -- [G]
  error      TEXT,                          -- [G]
  checked_at INTEGER NOT NULL               -- [G]
);

CREATE TABLE plan(
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL,             -- [M] block 1 \`plan = "..."\`
  repo_id         TEXT NOT NULL,             -- [O] repo the file was found in
  title           TEXT NOT NULL,             -- [M] block 2 heading \`# <id> — <title>\`
  status          TEXT NOT NULL CHECK(status IN ('imported','running','parked','done','archived')),
                                             -- imported = loaded, no run; running = Orca run exists; parked = MK stops starting tasks;
                                             -- done = all live tasks done and merged/accepted; archived = hidden
  version         INTEGER NOT NULL DEFAULT 1,-- [M] current plan_version.version
  file_status     TEXT,                      -- [M] block 1 \`status\` as written in the file (draft|approved|running|done|parked); informational
  integration_branch TEXT,                   -- [M] block 1 \`integration\`
  pushed          INTEGER NOT NULL DEFAULT 0,-- [M] block 1 \`pushed\`
  plan_branch     TEXT,                      -- [M] branch the plan's lanes merge into, if the orchestrator sets one
  pr_number       INTEGER,                   -- [G] from worktree.linked_pr or gh (unverified)
  pr_url          TEXT,                      -- [G]
  pr_state        TEXT CHECK(pr_state IS NULL OR pr_state IN ('open','ready','merged','closed')), -- [G] unverified (needs gh)
  orca_run_id     TEXT,                      -- [O] set at Start (run-create); one run per plan
  past_run_ids    TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(past_run_ids)), -- [M] a restart moves orca_run_id here
  run_last_state  TEXT,                      -- [C] 'listed' | 'missing' from run-list
  started_at      INTEGER,                   -- [M]
  merged_at       INTEGER,                   -- [M] set by user action or by the orchestrator through the CLI
  done_at         INTEGER,                   -- [M]
  created_at      INTEGER NOT NULL,          -- [M]
  updated_at      INTEGER NOT NULL,          -- [M]
  UNIQUE(repo_id, slug)
);
CREATE INDEX plan_repo ON plan(repo_id, status);
CREATE UNIQUE INDEX plan_run ON plan(orca_run_id) WHERE orca_run_id IS NOT NULL;

CREATE TABLE plan_version(                   -- the file text as imported; the only home of blocks no screen shows (facts, shape, notes)
  plan_id     INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  source_sha  TEXT NOT NULL,                 -- sha256 of the file bytes
  source_path TEXT NOT NULL,                 -- repo-relative path it had when imported
  body        TEXT NOT NULL,                 -- full file text (plans are ~30 KB)
  fit         TEXT NOT NULL CHECK(fit IN ('pass','partial')),
  missing     TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(missing)),
  imported_at INTEGER NOT NULL,
  note        TEXT,                          -- 'initial' | 'merged: +2 tasks, ~3 changed, -1 dropped'
  PRIMARY KEY(plan_id, version)
);

CREATE TABLE plan_phase(                     -- block 5.n text + 5.n.0 settings. A "wave" is not a table: GROUP BY wave
  id           INTEGER PRIMARY KEY,
  plan_id      INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,                -- 'STORE' (settings \`id\`)
  ord          INTEGER NOT NULL,             -- block order (5.1, 5.2, ...)
  title        TEXT NOT NULL,
  goal         TEXT,                         -- text block "Goal:" line
  wave         INTEGER NOT NULL DEFAULT 1,   -- \`wave\` (same wave = parallel)
  lane_group   TEXT NOT NULL DEFAULT '',     -- \`lane_group\` ('' = own lane); lane label source
  deps         TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(deps)),      -- phase codes (or <run>:<task>)
  owned        TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(owned)),
  forbidden    TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(forbidden)),
  commit_msg   TEXT,                         -- \`commit\`
  size         TEXT CHECK(size IS NULL OR size IN ('trivial','standard','complex')),
  route        TEXT NOT NULL DEFAULT '',     -- '' = Jev decides, else "<agent> <model> [<effort>]"
  reviewer     TEXT NOT NULL DEFAULT '',
  subagents    INTEGER NOT NULL DEFAULT 1,
  qa           TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(qa)),
  serves       TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(serves)),    -- goal ids from the text block
  hazards      TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(hazards)),   -- risk ids
  carries      TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(carries)),   -- C/T/A/R ids
  build_order  TEXT,
  dropped_at   INTEGER,                      -- set when a re-import no longer contains the phase
  UNIQUE(plan_id, code)
);
CREATE INDEX plan_phase_ord ON plan_phase(plan_id, wave, ord);

CREATE TABLE plan_task(                      -- plan structure (MK) + light link to ONE current Orca task (same pattern as bug)
  id             INTEGER PRIMARY KEY,
  plan_id        INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  phase_id       INTEGER NOT NULL REFERENCES plan_phase(id),
  code           TEXT NOT NULL,              -- 'SPIKE.1' / 'T6'
  ord            INTEGER NOT NULL,
  origin         TEXT NOT NULL DEFAULT 'plan' CHECK(origin IN ('plan','todo')), -- 'todo' = created by "Make task"
  title          TEXT NOT NULL,
  description    TEXT,
  acceptance     TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(acceptance)),
  covers         TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(covers)),
  deps           TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(deps)),      -- task/phase codes; MK evaluates them, they are NOT sent to Orca (see 3.3)
  risk           INTEGER NOT NULL DEFAULT 1 CHECK(risk BETWEEN 1 AND 5),
  size           TEXT CHECK(size IS NULL OR size IN ('trivial','standard','complex')),
  gate           TEXT,
  manual         TEXT,
  route          TEXT NOT NULL DEFAULT '',
  refs           TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(refs)),
  owned          TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(owned)),
  subagent       INTEGER NOT NULL DEFAULT 0,
  parallel       INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK(status IN ('pending','ready','working','waiting','blocked','done','failed','cancelled')), -- [D] mapping in 3.3
  -- light link to Orca (same columns and meaning as bug)
  orca_run_id    TEXT,                       -- [O] the run the task was created in (== plan.orca_run_id at that time)
  orca_task_id   TEXT,                       -- [O] CURRENT Orca task; NULL until the task is started
  attempts       INTEGER NOT NULL DEFAULT 0, -- [M] number of Orca tasks ever created for this row
  past_task_ids  TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(past_task_ids)), -- [M] earlier Orca task ids; a retry moves the current id here
  last_state     TEXT,                       -- [C] Orca task status: pending|ready|dispatched|completed|failed|blocked|missing
  last_state_at  INTEGER,                    -- [C] when last_state last changed (sync time)
  started_at     INTEGER,                    -- [M] first task-create
  done_at        INTEGER,                    -- [D] when status became done
  spec_drift     INTEGER NOT NULL DEFAULT 0, -- [M] 1 = the plan text changed after the Orca task was created
  dropped_at     INTEGER,                    -- re-import no longer contains the task
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE(plan_id, code)
);
CREATE INDEX plan_task_phase ON plan_task(phase_id, ord);
CREATE INDEX plan_task_orca ON plan_task(orca_task_id) WHERE orca_task_id IS NOT NULL;
CREATE INDEX plan_task_status ON plan_task(plan_id, status) WHERE dropped_at IS NULL;

CREATE TABLE plan_subtask(                   -- MK-only: Orca has no subtask status (BUS §1, SDM §3 item 6)
  id           INTEGER PRIMARY KEY,
  plan_id      INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  task_id      INTEGER NOT NULL REFERENCES plan_task(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,                -- 'T6.3' / 'WIRE.2.1'
  ord          INTEGER NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  acceptance   TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(acceptance)),
  deps         TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(deps)),
  owned        TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(owned)),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','working','waiting','blocked','done')),
  note         TEXT NOT NULL DEFAULT '',     -- "now", "decide", "← T6.4" (decide/dep notes are derived at read; this holds manual notes)
  updated_at   INTEGER,
  dropped_at   INTEGER,
  UNIQUE(plan_id, code)
);
CREATE INDEX plan_subtask_task ON plan_subtask(task_id, ord);

CREATE TABLE plan_item(                      -- goals, contracts, tests, assumptions, rollout, settings, gates, risks, questions, log lines, meta
  id        INTEGER PRIMARY KEY,
  plan_id   INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL CHECK(kind IN ('goal','contract','test','assumption','rollout','setting','gate','risk','question','log','meta')),
  code      TEXT,                            -- 'G1','C2','T3','A1','R1','S2','K4','Q5', gate name; NULL for log lines
  ord       INTEGER NOT NULL,
  text      TEXT NOT NULL,
  data      TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),
              -- gate:     {"proves":["G1"],"command":"npm test","timeout":600,"extra":true}
              -- risk:     {"level":4,"guard":"...","ref":"SERVE.1"}
              -- question: {"blocks":"WIRE.2","pick":"..."}
              -- test:     {"level":"unit","file":"test/x.mjs","written_by":"STORE.1"}
              -- log:      {"date":"2026-10-24","kind":"decision","who":"user"}
  done      INTEGER NOT NULL DEFAULT 0,      -- question ticked \`[x]\` (set by re-import only in v1)
  UNIQUE(plan_id, kind, code, ord)
);
CREATE INDEX plan_item_kind ON plan_item(plan_id, kind, ord);

CREATE TABLE inbox_file(                     -- one row per plan .md seen in <repo>/.matrixkoder/inbox/ (top level) or inbox/archive/
  id            INTEGER PRIMARY KEY,
  repo_id       TEXT NOT NULL,               -- [O]
  path          TEXT NOT NULL,               -- repo-relative CURRENT location: 'inbox/x.md' | 'inbox/archive/x.md' | 'inbox/.deleted/x-<time>/x.md'
  name          TEXT NOT NULL,               -- file name
  slug          TEXT,                        -- block 1 \`plan\`; NULL when unparsable
  title         TEXT,                        -- block 2 heading, else first \`# \` heading
  sha           TEXT NOT NULL,               -- sha256 of file bytes
  size          INTEGER NOT NULL,
  mtime         INTEGER NOT NULL,
  fit           TEXT NOT NULL CHECK(fit IN ('pass','partial','not_a_plan')),
  missing       TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(missing)),  -- ["Block 6 Gates","phase STORE: owned"]
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK(status IN ('new','changed','imported','archived','deleted','missing')),
  plan_id       INTEGER REFERENCES plan(id) ON DELETE SET NULL,         -- plan this file produced or would update
  plan_version  INTEGER,                     -- version created by this file (status imported)
  first_seen_at INTEGER NOT NULL,
  status_at     INTEGER NOT NULL,
  imported_at   INTEGER,
  UNIQUE(repo_id, path)
);
CREATE INDEX inbox_file_repo ON inbox_file(repo_id, status);
CREATE INDEX inbox_file_sha ON inbox_file(repo_id, sha);

CREATE TABLE bug(                            -- decision 3, columns exactly as decided, plus one marked addition
  id            TEXT PRIMARY KEY,            -- [M] 'B-n' from counter('bug'); unique across repos
  repo_id       TEXT NOT NULL,               -- [O]
  title         TEXT NOT NULL,               -- [M]
  details       TEXT NOT NULL DEFAULT '',    -- [M] full write-up (no .md files)
  file          TEXT,                        -- [M]
  line          INTEGER,                     -- [M]
  risk          INTEGER NOT NULL DEFAULT 3 CHECK(risk BETWEEN 1 AND 5),  -- [M]
  status        TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','fixing','waiting','fixed','wontfix')), -- [D] fixing/waiting/fixed follow the Orca task; open/wontfix are user-set
  reported_by   TEXT NOT NULL DEFAULT 'user',-- [M] 'user' | agent name | lane label
  orca_run_id   TEXT,                        -- [O] repo.bug_run_id at the time of the fix
  orca_task_id  TEXT,                        -- [O] CURRENT Orca task
  attempts      INTEGER NOT NULL DEFAULT 0,  -- [M] Orca tasks ever created for this bug
  past_task_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(past_task_ids)), -- [M] retry moves the current id here
  last_state    TEXT,                        -- [C] Orca task status: pending|ready|dispatched|completed|failed|blocked|missing
  last_state_at INTEGER,                     -- [C] ADDITION to the decided list (same field the task row has); drop it if the list must stay exact
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  fixed_at      INTEGER
);
CREATE INDEX bug_repo ON bug(repo_id, status);
CREATE INDEX bug_orca ON bug(orca_task_id) WHERE orca_task_id IS NOT NULL;

CREATE TABLE todo(
  id         INTEGER PRIMARY KEY,
  repo_id    TEXT NOT NULL,                  -- [O]
  text       TEXT NOT NULL,
  grp        TEXT NOT NULL DEFAULT 'today' CHECK(grp IN ('today','soon','later')),
  done       INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0,
  link_kind  TEXT CHECK(link_kind IS NULL OR link_kind IN ('task','phase','bug')),
  link_ref   TEXT,                           -- task: plan_task.id | phase: plan_phase.id | bug: bug.id (as text); a dropped target shows as plain text
  created_at INTEGER NOT NULL,
  done_at    INTEGER,
  CHECK((link_kind IS NULL) = (link_ref IS NULL))
);
CREATE INDEX todo_repo ON todo(repo_id, done, grp, sort);

CREATE TABLE check_result(                   -- build/test/review results; Orca has none. Q3: agents report with \`orca orchestration send --type status\`
  id            INTEGER PRIMARY KEY,
  orca_task_id  TEXT,                        -- [O] payload.taskId (maps to plan_task or bug through v_orca_task_owner)
  dispatch_id   TEXT,                        -- [O] payload.dispatchId
  name          TEXT NOT NULL,               -- build | test | review | other (payload.check)
  status        TEXT NOT NULL CHECK(status IN ('pending','running','passed','failed','asks','skipped')),
  passed        INTEGER,
  total         INTEGER,
  detail        TEXT,                        -- <= 200 chars
  source        TEXT NOT NULL UNIQUE,        -- 'msg:<message id>' (idempotent re-poll)
  at            INTEGER NOT NULL
);
CREATE INDEX check_task ON check_result(orca_task_id, name, at DESC);

CREATE TABLE event_log(                      -- Events screen; Orca keeps no plugin-event history and inbox has no cursor
  id        INTEGER PRIMARY KEY,
  at        INTEGER NOT NULL,
  kind      TEXT NOT NULL CHECK(kind IN ('lane','gate','ask','commit','bus')),
  repo_id   TEXT,
  text      TEXT NOT NULL,
  src       TEXT,                            -- "P1 claude · T6"
  ref       TEXT,                            -- 'msg:<id>' | 'pane:<key>:<since>' | 'sha:<x>' | 'ask:<id>'
  payload   TEXT CHECK(payload IS NULL OR json_valid(payload))  -- redacted, <= 2 KB; heartbeats are never stored
);
CREATE UNIQUE INDEX event_ref ON event_log(kind, ref) WHERE ref IS NOT NULL;
CREATE INDEX event_at ON event_log(at DESC);
CREATE INDEX event_repo ON event_log(repo_id, at DESC);

CREATE TABLE decision_log(                   -- Waiting actions: the 10 s undo window (Q2), recovery after a worker restart, "resolved" history
  id          INTEGER PRIMARY KEY,
  repo_id     TEXT,
  run_id      TEXT,
  ask_id      TEXT,                          -- ask.id
  kind        TEXT NOT NULL CHECK(kind IN ('gate','question')),
  title       TEXT NOT NULL,
  action      TEXT NOT NULL CHECK(action IN ('approve','rework','answer')),
  answer      TEXT,                          -- option label or rework text (cut to 500)
  actor       TEXT NOT NULL DEFAULT 'user',
  status      TEXT NOT NULL CHECK(status IN ('pending','sent','undone','failed','expired')),
  command     TEXT NOT NULL CHECK(json_valid(command)),  -- argv JSON array of the single orca call to run at commit_at
  request_id  TEXT NOT NULL,                 -- passed as --retry-request so a replay is idempotent
  commit_at   INTEGER,
  sent_at     INTEGER,
  error       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX decision_pending ON decision_log(status, commit_at);
CREATE INDEX decision_ask ON decision_log(ask_id);

CREATE TABLE alert_sent(                     -- notification de-duplication
  key TEXT PRIMARY KEY,                      -- 'ask:<id>','laneDone:<dispatch>','quiet:<lane_key>:<heartbeat>'
  at  INTEGER NOT NULL
);

-- Which MK row owns an Orca task id (current or past). Replaces the draft task_link table.
CREATE VIEW v_orca_task_owner AS
  SELECT orca_task_id AS orca_task_id, 'plan_task' AS owner_kind, CAST(id AS TEXT) AS owner_id, 1 AS is_current
    FROM plan_task WHERE orca_task_id IS NOT NULL
  UNION ALL
  SELECT j.value, 'plan_task', CAST(t.id AS TEXT), 0 FROM plan_task t, json_each(t.past_task_ids) j
  UNION ALL
  SELECT orca_task_id, 'bug', id, 1 FROM bug WHERE orca_task_id IS NOT NULL
  UNION ALL
  SELECT j.value, 'bug', b.id, 0 FROM bug b, json_each(b.past_task_ids) j;

-- Phase roll-up: done / working / waiting / failed / ready / pending
CREATE VIEW v_phase AS
  SELECT p.id AS phase_id, p.plan_id, p.code, p.title, p.wave, p.ord,
         COUNT(t.id) AS total,
         SUM(t.status='done') AS done,
         CASE
           WHEN COUNT(t.id)=0 THEN 'pending'
           WHEN SUM(t.status='done')=COUNT(t.id) THEN 'done'
           WHEN SUM(t.status='working')>0 THEN 'working'
           WHEN SUM(t.status='waiting')>0 THEN 'waiting'
           WHEN SUM(t.status IN ('failed','cancelled'))>0 THEN 'failed'
           WHEN SUM(t.status='ready')>0 THEN 'ready'
           ELSE 'pending' END AS status
    FROM plan_phase p LEFT JOIN plan_task t ON t.phase_id=p.id AND t.dropped_at IS NULL
   WHERE p.dropped_at IS NULL
   GROUP BY p.id;

-- Per-plan counts for Projects cards, Overview and Plan summary
CREATE VIEW v_plan_counts AS
  SELECT pl.id AS plan_id, pl.repo_id, pl.status,
         (SELECT COUNT(*) FROM plan_phase WHERE plan_id=pl.id AND dropped_at IS NULL) AS phases,
         (SELECT COUNT(DISTINCT wave) FROM plan_phase WHERE plan_id=pl.id AND dropped_at IS NULL) AS waves,
         (SELECT COUNT(*) FROM plan_task WHERE plan_id=pl.id AND dropped_at IS NULL) AS tasks,
         (SELECT COUNT(*) FROM plan_task WHERE plan_id=pl.id AND dropped_at IS NULL AND status='done') AS tasks_done,
         (SELECT COUNT(*) FROM plan_subtask WHERE plan_id=pl.id AND dropped_at IS NULL) AS subtasks,
         (SELECT COUNT(*) FROM plan_subtask WHERE plan_id=pl.id AND dropped_at IS NULL AND status='done') AS subtasks_done
    FROM plan pl;
`;
