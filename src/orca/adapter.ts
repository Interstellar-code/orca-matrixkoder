import { fail, read } from './call.js';
import { execOrca } from './runner.js';
import {
  arr, bool, cap, capOrNull, num, numOrNull, rec, shortBranch, str, strOrNull, strings,
} from './sanitize.js';
import type { Json } from './sanitize.js';
import type {
  AccountListProjection, DispatchFailure, GateInfo, GateListProjection, HostListProjection, InboxMessage, InboxProjection,
  OrcaError, OrcaResult, ProviderQuota, WorkerLiveness, WorkerObservation, WorkerStage, RateWindow, RepoListProjection, RunListProjection, Runner, TaskListProjection,
  TerminalListProjection, WorkerInfo, WorkerListProjection, WorkerShowProjection, WorktreeListProjection,
  WorktreePsProjection,
} from './types.js';

// Read side of the Orca adapter. Each function runs `orca ... --json` through the runner (default:
// the real CLI, 10 s timeout), drops prompt, lastAssistantMessage, toolInput and preview at any
// depth, and returns a small typed projection or a typed error. None of them throw.

const SUBJECT_MAX = 200;
const BODY_MAX = 400;
const OBJECTIVE_MAX = 200;
const RESULT_MAX = 300;
const COMMENT_MAX = 200;

type FlagValues = Record<string, unknown>;

// Builds `base --key=value ... [bare flags] --json`. Each value rides in the SAME argv element as its
// key, so a value that starts with `--` (a body, a spec, a bad id) can never be read as the next flag.
// `undefined` leaves the flag out; null, an empty string, or anything but a string or finite number is
// a bad_args error, and so is a missing flag named in `required`.
function buildReadArgv(
  base: string[], flags: FlagValues, required: string[] = [], bare: string[] = [],
): { ok: true; argv: string[] } | { ok: false; error: OrcaError } {
  const argv = [...base];
  for (const name of required) {
    if (flags[name] === undefined) return fail('bad_args', `${base.join(' ')} needs "${name}"`);
  }
  for (const [name, v] of Object.entries(flags)) {
    if (v === undefined) continue;
    // a required flag is an id: a string only
    const okValue = (typeof v === 'string' && v !== '' && !v.includes('\0')) || (typeof v === 'number' && Number.isFinite(v) && !required.includes(name));
    if (!okValue) return fail('bad_args', `${base.join(' ')}: "${name}" must be a non-empty string or a number`);
    argv.push(`--${name}=${v}`);
  }
  argv.push(...bare, '--json');
  return { ok: true, argv };
}

async function readCmd<T>(
  base: string[], flags: FlagValues, runner: Runner, project: (r: Json) => T, required: string[] = [], bare: string[] = [],
): Promise<OrcaResult<T>> {
  const built = buildReadArgv(base, flags, required, bare);
  if (!built.ok) return built;
  return read(built.argv, runner, project);
}

// A pull is incomplete when Orca cut the list (truncated) or left a host out (hostScope.omittedHostIds, for
// example an SSH host that is down). The sync loop marks nothing gone from an incomplete pull.
function incomplete(r: Json): boolean {
  return bool(r.truncated) || arr(rec(r.hostScope).omittedHostIds).length > 0;
}

// ---- worktrees ----

export function worktreePs(runner: Runner = execOrca, opts: { limit?: number } = {}): Promise<OrcaResult<WorktreePsProjection>> {
  return readCmd(['worktree', 'ps'], { limit: opts.limit }, runner, (r) => ({
    worktrees: arr(r.worktrees).map((w) => {
      const x = rec(w);
      return {
        worktreeId: str(x.worktreeId),
        repoId: str(x.repoId),
        repo: str(x.repo),
        path: str(x.path),
        branch: shortBranch(x.branch),
        displayName: str(x.displayName),
        comment: cap(x.comment, COMMENT_MAX),
        isMainWorktree: bool(x.isMainWorktree),
        isArchived: bool(x.isArchived),
        workspaceStatus: str(x.workspaceStatus),
        status: str(x.status),
        terminalVerdict: str(x.terminalVerdict),
        liveTerminalCount: num(x.liveTerminalCount),
        lastActivityAt: numOrNull(x.lastActivityAt),
        lastOutputAt: numOrNull(x.lastOutputAt),
        parentWorktreeId: strOrNull(x.parentWorktreeId),
        agents: arr(x.agents).map((a) => {
          const g = rec(a);
          return {
            paneKey: str(g.paneKey),
            parentPaneKey: strOrNull(g.parentPaneKey),
            state: str(g.state),
            workingMode: strOrNull(g.workingMode),
            agentType: str(g.agentType),
            taskTitle: capOrNull(g.taskTitle, SUBJECT_MAX),
            displayName: capOrNull(g.displayName, SUBJECT_MAX),
            toolName: strOrNull(g.toolName),
            interrupted: bool(g.interrupted),
            stateStartedAt: numOrNull(g.stateStartedAt),
            updatedAt: numOrNull(g.updatedAt),
          };
        }),
      };
    }),
    totalCount: num(r.totalCount, arr(r.worktrees).length),
    truncated: incomplete(r),
  }));
}

export function worktreeList(runner: Runner = execOrca): Promise<OrcaResult<WorktreeListProjection>> {
  return readCmd(['worktree', 'list'], {}, runner, (r) => ({
    worktrees: arr(r.worktrees).map((w) => {
      const x = rec(w);
      return {
        id: str(x.id),
        repoId: str(x.repoId),
        path: str(x.path),
        head: str(x.head),
        branch: shortBranch(x.branch),
        displayName: str(x.displayName),
        comment: cap(x.comment, COMMENT_MAX),
        isMainWorktree: bool(x.isMainWorktree),
        isArchived: bool(x.isArchived),
        isPinned: bool(x.isPinned),
        workspaceStatus: str(x.workspaceStatus),
        lastActivityAt: numOrNull(x.lastActivityAt),
        parentWorktreeId: strOrNull(x.parentWorktreeId),
      };
    }),
    totalCount: num(r.totalCount, arr(r.worktrees).length),
    truncated: incomplete(r),
  }));
}

// ---- orchestration ----

export function runList(runner: Runner = execOrca, opts: { limit?: number; cursor?: string } = {}): Promise<OrcaResult<RunListProjection>> {
  return readCmd(
    ['orchestration', 'run-list'], { limit: opts.limit, cursor: opts.cursor },
    runner,
    (r) => ({
      runs: arr(r.runs).map((run) => {
        const x = rec(run);
        return {
          id: str(x.id),
          objective: cap(x.objective, OBJECTIVE_MAX),
          coordinatorHandle: strOrNull(x.coordinator_handle),
          legacy: num(x.legacy) === 1,
          createdAt: str(x.created_at),
          updatedAt: str(x.updated_at),
        };
      }),
      nextCursor: strOrNull(r.nextCursor),
    }),
  );
}

// Without a Run bound to the shell, Orca answers run_required: pass `runId`.
export function taskList(
  runner: Runner = execOrca,
  opts: { runId?: string; status?: string; brief?: boolean } = {},
): Promise<OrcaResult<TaskListProjection>> {
  return readCmd(['orchestration', 'task-list'], { status: opts.status, run: opts.runId }, runner, (r) => {
    const tasks = arr(r.tasks).map((t) => {
      const x = rec(t);
      return {
        id: str(x.id),
        runId: str(x.run_id),
        parentId: strOrNull(x.parent_id),
        title: cap(x.task_title, SUBJECT_MAX),
        displayName: cap(x.display_name, SUBJECT_MAX),
        status: str(x.status),
        deps: parseStringArray(x.deps),
        result: capOrNull(x.result, RESULT_MAX),
        createdAt: str(x.created_at),
        completedAt: strOrNull(x.completed_at),
        createdByHandle: strOrNull(x.created_by_terminal_handle),
      };
    });
    return { runId: str(r.runId), legacyReadOnly: bool(r.legacyReadOnly), count: num(r.count, tasks.length), tasks };
  }, [], opts.brief ? ['--brief'] : []);
}

function projectWorker(x: Json): WorkerInfo {
  const p = rec(x.projection);
  const res = rec(x.resource);
  return {
    dispatchId: str(x.dispatchId),
    taskId: str(x.taskId),
    runId: str(x.runId),
    workerState: str(x.workerState),
    dispatchStatus: str(x.dispatchStatus),
    terminalHandle: strOrNull(x.agentTerminalHandle),
    terminalState: str(x.terminalState),
    worktreeId: strOrNull(res.worktreeId),
    ...projectionBits(p),
  };
}

// stage, liveness and observation are free-form objects in Orca's JSON: keep the keys seen in the
// recorded fixtures and drop the rest, so a new text-bearing key cannot ride through.
function projectStage(x: Json): WorkerStage {
  return { worker: str(x.worker), dispatch: str(x.dispatch), detail: strOrNull(x.detail), activity: strOrNull(x.activity) };
}
function projectLiveness(x: Json): WorkerLiveness {
  return { verdict: str(x.verdict), source: strOrNull(x.source), reason: strOrNull(x.reason), observedAt: numOrNull(x.observedAt) };
}
function projectObservation(x: Json): WorkerObservation {
  // agentWait may carry what the agent is waiting on; only whether it is waiting is kept
  return { status: str(x.status), exactWorker: bool(x.exactWorker), agentWait: x.agentWait !== null && x.agentWait !== undefined };
}

function projectionBits(p: Json) {
  const attention = rec(p.attention);
  return {
    outcome: strOrNull(p.outcome),
    stage: projectStage(rec(p.stage)),
    liveness: projectLiveness(rec(p.liveness)),
    attention: { categories: strings(attention.categories), requiresAction: bool(attention.requiresAction) },
    nextActionKind: strOrNull(rec(p.nextAction).kind),
  };
}

export function workerList(
  runner: Runner = execOrca,
  opts: { runId?: string; limit?: number; cursor?: string; terminalState?: string } = {},
): Promise<OrcaResult<WorkerListProjection>> {
  const flags = { run: opts.runId, 'terminal-state': opts.terminalState, cursor: opts.cursor, limit: opts.limit };
  return readCmd(['orchestration', 'worker-list'], flags, runner, (r) => {
    const page = rec(r.page);
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(rec(r.counts))) counts[k] = num(v);
    return {
      workers: arr(r.workers).map((w) => projectWorker(rec(w))),
      counts,
      page: {
        limit: num(page.limit),
        total: num(page.total),
        hasMore: bool(page.hasMore),
        nextCursor: strOrNull(page.nextCursor),
      },
    };
  });
}

export function workerShow(runner: Runner = execOrca, opts?: { dispatchId?: unknown } | null): Promise<OrcaResult<WorkerShowProjection>> {
  // no opts, a missing, null or empty dispatch id: a typed bad_args error, the runner is not called
  const dispatch = opts && typeof opts === 'object' ? opts.dispatchId : undefined;
  return readCmd(['orchestration', 'worker-show'], { dispatch }, runner, (r) => {
    const d = rec(r.dispatch);
    const w = rec(r.worker);
    const t = rec(r.terminal);
    return {
      dispatch: {
        id: str(d.id),
        runId: str(d.runId),
        taskId: str(d.taskId),
        status: str(d.status),
        failureCount: num(d.failureCount),
        lastFailure: projectFailure(d.lastFailure),
        terminationReason: strOrNull(d.terminationReason),
        retryOfDispatchId: strOrNull(d.retryOfDispatchId),
        assigneeHandle: strOrNull(d.assigneeHandle),
        dispatchedAt: strOrNull(d.dispatchedAt),
        completedAt: strOrNull(d.completedAt),
        lastHeartbeatAt: strOrNull(d.lastHeartbeatAt),
      },
      worker: {
        state: str(w.state),
        stage: str(w.stage),
        worktreeId: strOrNull(w.worktreeId),
        agentTerminalHandle: strOrNull(w.agentTerminalHandle),
      },
      projection: projectionBits(rec(r.projection)),
      terminal: {
        handle: strOrNull(t.handle),
        connected: bool(t.connected),
        orphaned: bool(t.orphaned),
        title: cap(t.title, SUBJECT_MAX),
      },
      observation: projectObservation(rec(r.observation)),
    };
  }, ['dispatch']);
}

export function gateList(
  runner: Runner = execOrca,
  opts: { runId?: string; taskId?: string; status?: string } = {},
): Promise<OrcaResult<GateListProjection>> {
  return readCmd(['orchestration', 'gate-list'], { task: opts.taskId, status: opts.status, run: opts.runId }, runner, (r) => {
    const gates: GateInfo[] = arr(r.gates).map((g) => {
      const x = rec(g);
      return {
        id: str(x.id),
        runId: str(x.run_id),
        taskId: str(x.task_id),
        question: cap(x.question, BODY_MAX),
        options: parseStringArray(x.options),
        status: str(x.status),
        resolution: capOrNull(x.resolution, RESULT_MAX),
        createdAt: str(x.created_at),
        resolvedAt: strOrNull(x.resolved_at),
      };
    });
    return { runId: str(r.runId), count: num(r.count, gates.length), gates };
  });
}

export function inbox(runner: Runner = execOrca, opts: { limit?: number } = {}): Promise<OrcaResult<InboxProjection>> {
  return readCmd(['orchestration', 'inbox'], { limit: opts.limit }, runner, (r) => {
    const messages: InboxMessage[] = arr(r.messages).map((m) => {
      const x = rec(m);
      const p = parsePayload(x.payload);
      return {
        id: str(x.id),
        runId: str(x.run_id),
        type: str(x.type),
        priority: str(x.priority),
        from: str(x.from_handle),
        to: str(x.to_handle),
        subject: cap(x.subject, SUBJECT_MAX),
        body: cap(x.body, BODY_MAX),
        sequence: num(x.sequence),
        read: num(x.read) === 1 || x.read === true,
        createdAt: str(x.created_at),
        threadId: strOrNull(x.thread_id),
        payload: {
          ...(typeof p.taskId === 'string' ? { taskId: p.taskId } : {}),
          ...(typeof p.dispatchId === 'string' ? { dispatchId: p.dispatchId } : {}),
          ...(typeof p.phase === 'string' ? { phase: cap(p.phase, SUBJECT_MAX) } : {}),
          ...(typeof p.outcome === 'string' ? { outcome: p.outcome } : {}),
          ...(typeof p.question === 'string' ? { question: cap(p.question, BODY_MAX) } : {}),
          ...(Array.isArray(p.options) ? { options: strings(p.options) } : {}),
        },
      };
    });
    return { messages, count: num(r.count, messages.length) };
  });
}

// ---- accounts, terminals, repos, hosts ----

const AGENT_KEYS = ['claude', 'codex', 'opencode', 'devin'];

function rateWindow(v: unknown): RateWindow | null {
  if (v === null || typeof v !== 'object') return null;
  const x = rec(v);
  return { usedPercent: numOrNull(x.usedPercent), windowMinutes: numOrNull(x.windowMinutes), resetsAt: numOrNull(x.resetsAt) };
}

// Account emails and workspace labels are not carried: only counts, the active id and quota windows.
export function accountList(runner: Runner = execOrca): Promise<OrcaResult<AccountListProjection>> {
  return readCmd(['account', 'list'], {}, runner, (r) => ({
    agents: AGENT_KEYS.filter((k) => k in r).map((k) => {
      const x = rec(r[k]);
      return { agent: k, accounts: arr(x.accounts).length, activeAccountId: strOrNull(x.activeAccountId) };
    }),
    // rateLimits also holds flags and targets (minimaxCookieConfigured, claudeTarget, ...): keep provider objects only
    rateLimits: Object.entries(rec(r.rateLimits)).filter(([, v]) => typeof rec(v).provider === 'string').map(([provider, v]): ProviderQuota => {
      const x = rec(v);
      return {
        provider,
        status: str(x.status),
        error: capOrNull(x.error, COMMENT_MAX),
        updatedAt: numOrNull(x.updatedAt),
        session: rateWindow(x.session),
        weekly: rateWindow(x.weekly),
        monthly: rateWindow(x.monthly),
      };
    }),
  }));
}

export function terminalList(runner: Runner = execOrca): Promise<OrcaResult<TerminalListProjection>> {
  return readCmd(['terminal', 'list'], {}, runner, (r) => ({
    terminals: arr(r.terminals).map((t) => {
      const x = rec(t);
      return {
        handle: str(x.handle),
        worktreeId: str(x.worktreeId),
        worktreePath: str(x.worktreePath),
        branch: shortBranch(x.branch),
        title: cap(x.title, SUBJECT_MAX),
        connected: bool(x.connected),
        writable: bool(x.writable),
        orphaned: bool(x.orphaned),
        lastOutputAt: numOrNull(x.lastOutputAt),
        agentIdentity: strOrNull(x.agentIdentity),
      };
    }),
    totalCount: num(r.totalCount, arr(r.terminals).length),
    truncated: incomplete(r),
  }));
}

export function repoList(runner: Runner = execOrca): Promise<OrcaResult<RepoListProjection>> {
  return readCmd(['repo', 'list'], {}, runner, (r) => ({
    repos: arr(r.repos).map((p) => {
      const x = rec(p);
      return {
        id: str(x.id),
        path: str(x.path),
        displayName: str(x.displayName),
        kind: str(x.kind),
        addedAt: numOrNull(x.addedAt),
        remote: strOrNull(rec(x.gitRemoteIdentity).canonicalKey),
      };
    }),
  }));
}

export function hostList(runner: Runner = execOrca): Promise<OrcaResult<HostListProjection>> {
  return readCmd(['host', 'list'], {}, runner, (r) => ({
    hosts: arr(r.hosts).map((h) => {
      const x = rec(h);
      return {
        id: str(x.id),
        name: str(x.name),
        kind: str(x.kind),
        selector: str(x.selector),
        machineName: str(x.machineName),
        platform: str(x.platform),
      };
    }),
  }));
}

// ---- helpers ----

// Orca stores some arrays as JSON text (task deps, gate options).
function parseStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return strings(v);
  if (typeof v !== 'string' || v === '') return [];
  try {
    return strings(JSON.parse(v));
  } catch {
    return [];
  }
}

// A failed dispatch records its report as JSON text with the report body; keep only the safe parts.
function projectFailure(v: unknown): DispatchFailure | null {
  const x = typeof v === 'string' ? parsePayload(v) : rec(v);
  if (Object.keys(x).length === 0) return null;
  return {
    provenance: strOrNull(x.provenance),
    outcome: strOrNull(x.outcome),
    subject: capOrNull(x.subject, SUBJECT_MAX),
    messageId: strOrNull(x.messageId),
    completedAt: strOrNull(x.completedAt),
  };
}

function parsePayload(v: unknown): Json {
  if (typeof v !== 'string' || v === '') return rec(v);
  try {
    return rec(JSON.parse(v));
  } catch {
    return {};
  }
}
