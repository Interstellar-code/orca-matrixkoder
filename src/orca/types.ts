// Shared shapes for the Orca adapter: the runner, typed errors and the projections.

export const ORCA_TIMEOUT_MS = 10_000;

// Runs `orca <argv>` and hands back what it printed. Tests inject a stub.
export interface RunnerOutput {
  stdout: string;
  stderr?: string;
  exitCode?: number;
}
export interface RunnerOptions {
  timeoutMs: number;
}
export type Runner = (argv: string[], opts: RunnerOptions) => Promise<RunnerOutput>;

export type OrcaErrorKind =
  | 'timeout' // the call ran past the timeout
  | 'exec_failed' // the process could not start (orca missing, no permission)
  | 'invalid_json' // stdout was not a JSON object
  | 'orca_error' // Orca answered {ok:false}
  | 'bad_shape' // Orca answered {ok:true} but the result did not look right
  | 'not_allowed' // an action name or argument outside the allowlist
  | 'bad_args'; // an allowed action with missing or unknown arguments

export interface OrcaError {
  kind: OrcaErrorKind;
  message: string;
  code?: string; // Orca's own error code, for orca_error
  argv?: string[];
}
export type OrcaResult<T> = { ok: true; value: T } | { ok: false; error: OrcaError };

// ---- projections (small, typed, never carrying conversation text) ----

export interface PsAgent {
  paneKey: string;
  parentPaneKey: string | null;
  state: string;
  workingMode: string | null;
  agentType: string;
  taskTitle: string | null;
  displayName: string | null;
  toolName: string | null;
  interrupted: boolean;
  stateStartedAt: number | null;
  updatedAt: number | null;
}
export interface PsWorktree {
  worktreeId: string;
  repoId: string;
  repo: string;
  path: string;
  branch: string;
  displayName: string;
  comment: string;
  isMainWorktree: boolean;
  isArchived: boolean;
  workspaceStatus: string;
  status: string;
  terminalVerdict: string;
  liveTerminalCount: number;
  lastActivityAt: number | null;
  lastOutputAt: number | null;
  parentWorktreeId: string | null;
  agents: PsAgent[];
}
export interface WorktreePsProjection {
  worktrees: PsWorktree[];
  totalCount: number;
  truncated: boolean;
}

export interface WorktreeInfo {
  id: string;
  repoId: string;
  path: string;
  head: string;
  branch: string;
  displayName: string;
  comment: string;
  isMainWorktree: boolean;
  isArchived: boolean;
  isPinned: boolean;
  workspaceStatus: string;
  lastActivityAt: number | null;
  parentWorktreeId: string | null;
}
export interface WorktreeListProjection {
  worktrees: WorktreeInfo[];
  totalCount: number;
  truncated: boolean;
}

export interface RunInfo {
  id: string;
  objective: string;
  coordinatorHandle: string | null;
  legacy: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface RunListProjection {
  runs: RunInfo[];
  nextCursor: string | null;
}

export interface TaskInfo {
  id: string;
  runId: string;
  parentId: string | null;
  title: string;
  displayName: string;
  status: string;
  deps: string[];
  result: string | null;
  createdAt: string;
  completedAt: string | null;
  createdByHandle: string | null;
}
export interface TaskListProjection {
  runId: string;
  legacyReadOnly: boolean;
  count: number;
  tasks: TaskInfo[];
}

export interface WorkerStage {
  worker: string;
  dispatch: string;
  detail: string | null;
  activity: string | null;
}
export interface WorkerLiveness {
  verdict: string;
  source: string | null;
  reason: string | null;
  observedAt: number | null;
}
export interface WorkerObservation {
  status: string;
  exactWorker: boolean;
  agentWait: boolean;
}

export interface WorkerInfo {
  dispatchId: string;
  taskId: string;
  runId: string;
  workerState: string;
  dispatchStatus: string;
  terminalHandle: string | null;
  terminalState: string;
  worktreeId: string | null;
  outcome: string | null;
  stage: WorkerStage;
  liveness: WorkerLiveness;
  attention: { categories: string[]; requiresAction: boolean };
  nextActionKind: string | null;
}
export interface WorkerListProjection {
  workers: WorkerInfo[];
  counts: Record<string, number>;
  page: { limit: number; total: number; hasMore: boolean; nextCursor: string | null };
}

export interface DispatchFailure {
  provenance: string | null;
  outcome: string | null;
  subject: string | null;
  messageId: string | null;
  completedAt: string | null;
}

export interface WorkerShowProjection {
  dispatch: {
    id: string;
    runId: string;
    taskId: string;
    status: string;
    failureCount: number;
    lastFailure: DispatchFailure | null;
    terminationReason: string | null;
    retryOfDispatchId: string | null;
    assigneeHandle: string | null;
    dispatchedAt: string | null;
    completedAt: string | null;
    lastHeartbeatAt: string | null;
  };
  worker: {
    state: string;
    stage: string;
    worktreeId: string | null;
    agentTerminalHandle: string | null;
  };
  projection: Omit<WorkerInfo, 'dispatchId' | 'taskId' | 'runId' | 'workerState' | 'dispatchStatus' | 'terminalHandle' | 'terminalState' | 'worktreeId'>;
  terminal: { handle: string | null; connected: boolean; orphaned: boolean; title: string };
  observation: WorkerObservation;
}

export interface GateInfo {
  id: string;
  runId: string;
  taskId: string;
  question: string;
  options: string[];
  status: string;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
export interface GateListProjection {
  runId: string;
  count: number;
  gates: GateInfo[];
}

export interface InboxMessage {
  id: string;
  runId: string;
  type: string;
  priority: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  sequence: number;
  read: boolean;
  createdAt: string;
  /** The conversation this message belongs to (a question's own id; a reply carries the question's id). Null when Orca sent none. */
  threadId: string | null;
  payload: {
    taskId?: string;
    dispatchId?: string;
    phase?: string;
    outcome?: string;
    question?: string;
    options?: string[];
  };
}
export interface InboxProjection {
  messages: InboxMessage[];
  count: number;
}

export interface RateWindow {
  usedPercent: number | null;
  windowMinutes: number | null;
  resetsAt: number | null;
}
export interface ProviderQuota {
  provider: string;
  status: string;
  error: string | null;
  updatedAt: number | null;
  session: RateWindow | null;
  weekly: RateWindow | null;
  monthly: RateWindow | null;
}
export interface AgentAccounts {
  agent: string;
  accounts: number;
  activeAccountId: string | null;
}
export interface AccountListProjection {
  agents: AgentAccounts[];
  rateLimits: ProviderQuota[];
}

export interface TerminalInfo {
  handle: string;
  worktreeId: string;
  worktreePath: string;
  branch: string;
  title: string;
  connected: boolean;
  writable: boolean;
  orphaned: boolean;
  lastOutputAt: number | null;
  agentIdentity: string | null;
}
export interface TerminalListProjection {
  terminals: TerminalInfo[];
  totalCount: number;
  truncated: boolean;
}

/** An open Orca browser tab: its page id and its address without the query and fragment (a dashboard URL carries a token). */
export interface BrowserTab {
  browserPageId: string;
  url: string;
}
export interface TabListProjection {
  tabs: BrowserTab[];
}

export interface RepoInfo {
  id: string;
  path: string;
  displayName: string;
  kind: string;
  addedAt: number | null;
  remote: string | null;
}
export interface RepoListProjection {
  repos: RepoInfo[];
}

export interface HostInfo {
  id: string;
  name: string;
  kind: string;
  selector: string;
  machineName: string;
  platform: string;
}
export interface HostListProjection {
  hosts: HostInfo[];
}
