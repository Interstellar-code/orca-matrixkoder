# Orca Multi-Agent Orchestration Engine

Orca contains an internal coordination kernel designed for supervising multiple concurrent CLI agents (Codex, Claude, AGY, OpenCode) across Git worktrees.

---

## 1. Storage Backend (`orchestration.db`)

All multi-agent state is stored in SQLite at:
`~/Library/Application Support/orca/orchestration.db` (macOS)

### Key Database Tables

1. **`runs`**:
   - Represents a durable orchestration namespace and coordinator inbox.
   - Fields: `id`, `objective`, `coordinator_handle`, `coordinator_orca_session_id`, `created_at`.
2. **`tasks`**:
   - Work items assigned to workers, structured as a Directed Acyclic Graph (DAG).
   - Fields: `id`, `run_id`, `parent_id`, `task_title`, `display_name`, `spec`, `status`, `deps`, `result`.
   - Native support for subtasks (`parent_id`) and dependency arrays (`deps`).
3. **`messages`**:
   - In-memory & SQLite inter-agent message bus (Zero disk files created).
   - Types: `status`, `dispatch`, `worker_done`, `merge_ready`, `escalation`, `handoff`, `decision_gate`, `question`, `heartbeat`.
   - Fields: `id`, `run_id`, `from_handle`, `to_handle`, `subject`, `body`, `type`, `priority`, `thread_id`, `payload`, `read`.
4. **`worker_dispatches`**:
   - Authoritative leases and execution tracking for supervised agent terminals.
   - States: `starting`, `ready`, `failed`, `succeeded`, `exited`.
5. **`decision_gates`**:
   - Blocking review points holding tasks until coordinator or human approval.

---

## 2. The Task Hierarchy & Dependency System (DAG)

Orca natively couples its task engine with a Directed Acyclic Graph (DAG) dependency solver:

```
PROJECT (e.g. github:interstellar-code/matrixkoder)
└── RUN / INITIATIVE (run-create --objective "Feature")
    └── PHASE / WAVE (Parent Task or Dependency Wave)
        ├── TASK (task-create --task-title "..." --deps '["prev_task"]')
        │   ├── SUBTASK (task-create --parent <task_id>)
        │   └── SUBTASK (task-create --parent <task_id>)
        └── TASK (task-create --deps '["task_1"]')
```

### Dependency Evaluation (`--deps` & `--ready`)
- When creating a task, dependencies are declared as a JSON array of task IDs:
  ```bash
  orca orchestration task-create --run <run_id> --task-title "Auth Guard" --spec "..." --deps '["task_db_schema"]'
  ```
- **Automatic Readiness Calculation:**
  Tasks start in `status: pending`. As upstream tasks complete (`status: completed`), Orca automatically evaluates the DAG and promotes downstream dependent tasks to `status: ready`.
- The coordinator agent queries:
  ```bash
  orca orchestration task-list --ready --json
  ```
  to retrieve only the tasks that have satisfied all dependencies and are immediately dispatchable.

---

## 3. The Zero-Disk-File Messaging Bus

Unlike file-based message queues that require lock files, cursor files, or temporary transfer directories on disk, Orca's bus operates purely over SQLite/RAM:

1. **Structured JSON Payloads:**
   - Senders pass JSON strings directly via `--payload`:
     ```bash
     orca orchestration send --to "dispatch:disp_123" --type "dispatch" --payload '{"files": ["auth.py"]}'
     ```
2. **Targeted Mailboxes:**
   - Addressed via `run:<id>`, `dispatch:<id>`, or broadcast groups (`@all`, `@idle`, `@codex`, `@worktree:<id>`).
3. **Blocking Waits Without CPU Spin:**
   - Receivers call `orca orchestration check --wait --json`. Orca streams keepalive pings and yields execution until a message arrives.
4. **Blocking Decisions (`ask` / `reply`):**
   - Workers pause their turn by calling `orca orchestration ask --question "..."`.
   - The coordinator (or human in MatrixKoder) calls `orca orchestration reply --id <msg_id> --body "..."` to resume the lane.

---

## 4. Scratchpad vs. Tasks vs. Bug Tracking

- **Orca Floating Workspace & Scratchpad:**
  An ephemeral floating canvas for markdown notes, scratch terminals, and quick browser tabs. Agents can freely read and write markdown notes here without creating Git commits.
- **Formal Tasks:**
  Formal work items tracked in the DAG (`orchestration.db`).
- **Bug Tracking Strategy:**
  Bugs are managed as an ongoing/ephemeral project in Orca. When a bug requires engineering effort, it is promoted from an informal note or issue directly into a formal orchestration task wave.
