import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A fresh MK_DATA_DIR for one test. Tests never touch the real ~/.matrixkoder. */
export function tmpDataDir(label = 'store') {
  return mkdtempSync(join(tmpdir(), `mk-${label}-`));
}

export const TABLES = [
  'schema_version', 'counter', 'kv', 'sync_state', 'repo', 'worktree', 'pane', 'run', 'lane', 'lane_activity',
  'ask', 'quota', 'agent_cli', 'plan', 'plan_version', 'plan_phase', 'plan_task', 'plan_subtask', 'plan_item',
  'inbox_file', 'bug', 'todo', 'check_result', 'event_log', 'decision_log', 'alert_sent',
];
export const VIEWS = ['v_orca_task_owner', 'v_phase', 'v_plan_counts'];
export const INDEXES = [
  'repo_path', 'worktree_repo', 'pane_worktree', 'pane_handle', 'lane_dispatch', 'lane_worktree_live',
  'lane_label_live', 'lane_task', 'lane_state', 'lane_activity_lane', 'ask_open', 'ask_task', 'plan_repo',
  'plan_run', 'plan_phase_ord', 'plan_task_phase', 'plan_task_orca', 'plan_task_status', 'plan_subtask_task',
  'plan_item_kind', 'inbox_file_repo', 'inbox_file_sha', 'bug_repo', 'bug_orca', 'todo_repo', 'check_task',
  'event_ref', 'event_at', 'event_repo', 'decision_pending', 'decision_ask',
];
