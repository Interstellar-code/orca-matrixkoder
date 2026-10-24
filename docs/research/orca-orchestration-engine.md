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
   - Work items assigned to workers.
   - Fields: `id`, `run_id`, `title`, `status`, `wave`, `dependencies`.
3. **`messages`**:
   - Inter-agent communication bus.
   - Types: `status`, `dispatch`, `worker_done`, `merge_ready`, `escalation`, `handoff`, `decision_gate`, `question`, `heartbeat`.
   - Fields: `id`, `run_id`, `from_handle`, `to_handle`, `subject`, `body`, `type`, `priority`, `thread_id`, `payload`, `read`.
4. **`worker_dispatches`**:
   - Authoritative leases and execution tracking for supervised agent terminals.
   - States: `starting`, `ready`, `failed`, `succeeded`, `exited`.
5. **`decision_gates`**:
   - Blocking review points holding tasks until coordinator or human approval.

---

## 2. CLI Command Surface

The orchestration engine is accessible via the `orca orchestration` CLI:

* `orca orchestration run-create --objective "Refactor auth"`
* `orca orchestration task-create --run <id> --title "Add tests"`
* `orca orchestration worker-start --run <id> --task <id> --worktree <selector>`
* `orca orchestration worker-list --run <id>`
* `orca orchestration check` (check pending messages)
* `orca orchestration send --to <handle> --type <type> --body <text>`
* `orca orchestration gate-create` / `gate-resolve`

---

## 3. MatrixKoder Integration Strategy

Instead of maintaining a separate socket daemon (`mk-bus.py`), MatrixKoder acts as the **visual executive layer** for Orca's orchestration engine:
1. MatrixKoder visualizes the active `run`, `tasks`, and `waves` on the **Plan Tab**.
2. Live worker turns and PTY statuses are mapped to the **Lanes Tab**.
3. Blocking `decision_gate` records automatically light up the **Waiting Tab** for fast human sign-off.
4. Message traffic from `messages` is rendered in real time on the **Events Tab**.
