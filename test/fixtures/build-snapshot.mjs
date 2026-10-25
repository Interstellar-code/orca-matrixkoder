// Builds test/fixtures/snapshot.json: a full C6 state snapshot (screen-data-map.md section 4, mk-data-schema.md
// section 5) from the recorded Orca fixtures in test/fixtures/orca/, read through the real adapter.
// Fields Orca does not hold (plan, bugs, todo, inbox plan files, lane model/effort, git counts) are sample
// values, written here in plain sight. Run: `node test/fixtures/build-snapshot.mjs` (after `npx tsc`).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  worktreePs, worktreeList, terminalList, repoList, hostList, accountList, inbox, workerList,
} from '../../out/orca/index.js';

const dir = new URL('./orca/', import.meta.url);
// A runner that answers every call from the recorded fixture for that command.
const FILES = {
  'worktree ps': 'worktree-ps', 'worktree list': 'worktree-list', 'terminal list': 'terminal-list', 'repo list': 'repo-list',
  'host list': 'host-list', 'account list': 'account-list', 'orchestration inbox': 'inbox', 'orchestration worker-list': 'worker-list',
};
const runner = async (argv) => ({ stdout: readFileSync(new URL(`${FILES[argv.slice(0, 2).join(' ')]}.json`, dir), 'utf8') });
const must = (r) => { if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`); return r.value; };

const home = (p) => p.replace(/^\/Users\/[^/]+/, '~');
const ms = (s) => Date.parse(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));

export async function buildSnapshot() {
  const [ps, wl, terms, repos, hosts, acc, bus, workers] = (await Promise.all([
    worktreePs(runner), worktreeList(runner), terminalList(runner), repoList(runner), hostList(runner),
    accountList(runner), inbox(runner), workerList(runner),
  ])).map(must);

  const at = Math.max(...ps.worktrees.map((w) => w.lastActivityAt ?? 0)) + 15_000; // fixed by the recording
  const repo = repos.repos.find((r) => r.displayName === 'orca-matrixkoder');
  const headOf = new Map(wl.worktrees.map((w) => [w.id, w.head.slice(0, 7)]));

  // ---- lanes: one per agent in this repo's worktrees (Orca: worktree ps + terminals + workers) ----
  const SAMPLE = { // model, effort, task, git counts: what the plan and git would say; Orca does not hold these
    'Interstellar-code/lane-orca': { model: 'sonnet 5.5', effort: 'low', task: { id: 'ORCA.1', title: 'Read functions and projections', wave: 2, orcaTaskId: 'task_0orca00001' }, git: { ahead: 3, files: 6, added: 182, removed: 40 } },
    'Interstellar-code/lane-store': { model: 'sonnet 5.5', effort: 'medium', task: { id: 'STORE.1', title: 'Database schema and migrations', wave: 2, orcaTaskId: 'task_0store0001' }, git: { ahead: 2, files: 9, added: 410, removed: 12 } },
  };
  const mine = ps.worktrees.filter((w) => w.repoId === repo.id && !w.isMainWorktree && w.agents.length > 0);
  const lanes = mine.map((w, i) => {
    const a = w.agents[0];
    const s = SAMPLE[w.branch];
    const term = terms.terminals.find((t) => t.worktreeId === w.worktreeId && !t.orphaned);
    const worker = workers.workers.find((x) => x.worktreeId === w.worktreeId);
    const state = a.state === 'done' ? 'done' : a.state === 'blocked' || a.state === 'waiting' ? 'waiting' : 'working';
    return {
      label: `P${i + 1}`, dispatchId: worker?.dispatchId ?? null, paneKey: a.paneKey, worktreeId: w.worktreeId,
      terminalHandle: term?.handle ?? null, agent: a.agentType, model: s.model, effort: s.effort,
      branch: w.branch, head: headOf.get(w.worktreeId) ?? '', path: home(w.path),
      state, phase: state === 'working' ? 'implementing' : state, turns: 4 + i, startedAt: a.stateStartedAt,
      task: s.task, git: s.git,
      // the store lane has checks, the orca lane an empty list
      checks: w.branch.endsWith('lane-store') ? [{ name: 'build', status: 'passed', at: at - 120_000 }, { name: 'test', status: 'running', passed: 41, total: 63 }] : [],
      activity: a.toolName ? [{ at: a.updatedAt ?? at, kind: 'tool', text: a.toolName }] : [],
      askId: null,
    };
  });

  // ---- waiting + events from the bus (Orca: orchestration inbox) ----
  const questions = bus.messages.filter((m) => m.type === 'question').slice(0, 2);
  const QTEXT = ['Rewrite one spec that tested the old stale-engine behaviour?', 'Keep the old migration path for v2 databases?'];
  const open = questions.map((m, i) => ({
    id: m.id, kind: 'question', title: QTEXT[i], body: 'A worker asks before it changes a file outside its list.', rec: '',
    options: m.payload.options ?? [], lane: lanes[i % lanes.length]?.label ?? null, agent: 'claude', task: m.payload.taskId ?? null,
    ageMs: Math.max(0, at - ms(m.createdAt)),
  }));
  const KIND = { worker_done: 'done', question: 'ask', status: 'status' };
  const rows = bus.messages.filter((m) => m.type !== 'heartbeat').sort((a, b) => b.sequence - a.sequence).map((m) => ({
    id: m.sequence, at: ms(m.createdAt), kind: KIND[m.type] ?? m.type,
    text: m.type === 'worker_done' ? `worker done: ${m.payload.outcome ?? 'finished'}` : m.type === 'question' ? 'worker asks a question' : `status: ${m.payload.phase ?? 'update'}`,
    src: m.from.slice(0, 13), payloadRef: m.sequence,
  }));
  const busTop = bus.messages.reduce((a, b) => (b.sequence > a.sequence ? b : a));

  // ---- quota (Orca: account list) ----
  const AGENTS = [['claude', 'claude'], ['codex', 'codex'], ['agy', 'antigravity'], ['opencode', 'opencodeGo']];
  const agents = AGENTS.map(([id, provider]) => {
    const q = acc.rateLimits.find((x) => x.provider === provider);
    const quota = [['5h window', q?.session], ['Weekly', q?.weekly]]
      .filter(([, w]) => w && w.usedPercent !== null)
      .map(([label, w]) => ({ label, leftPct: 100 - w.usedPercent, resetsAt: w.resetsAt }));
    return { id, cli: `/usr/local/bin/${id}`, found: !!q && q.status !== 'unavailable', quota };
  });

  // ---- projects (Orca: repo list, worktree list, host list; plans from the plan below) ----
  const local = hosts.hosts.find((h) => h.id === 'local');
  const live = lanes.filter((l) => l.state !== 'done').length;
  const PLAN = plan();
  const repoRows = repos.repos.map((r) => {
    const wts = wl.worktrees.filter((w) => w.repoId === r.id);
    const isMine = r.id === repo.id;
    return {
      id: r.id, name: r.displayName, path: home(r.path), worktrees: wts.length,
      lastActivityAt: Math.max(0, ...wts.map((w) => w.lastActivityAt ?? 0)) || null,
      plans: isMine ? [{ id: 'orca-dashboard-wiring', stage: 'build', wave: [2, 3], lanes: live, tasks: [PLAN.done, PLAN.total], waiting: open.length, pr: null }] : [],
      idleWorktrees: isMine ? 0 : wts.length,
    };
  });

  const BUGS = bugs();
  const TODO = todo();
  return {
    meta: {
      schema: 1, at, orca: '1.4.239', runtimeOk: true, repoId: repo.id, planId: 'orca-dashboard-wiring', runId: 'run_aa8ea15012d0',
      stale: { ps: 1200, orchestration: 4300, git: 8000, quota: 41000 },
    },
    badges: { lanes: live, waiting: open.length, inbox: 2, bugs: BUGS.rows.filter((b) => ['open', 'fixing', 'waiting'].includes(b.status)).length },
    projects: {
      machine: local?.machineName ?? 'this Mac', active: repoRows.filter((r) => r.plans.length > 0 || r.worktrees > 1).length, total: repoRows.length,
      lanesLive: live, waiting: open.length,
      waitingList: open.map((o) => ({ askId: o.id, title: o.title, repo: repo.displayName, plan: 'orca-dashboard-wiring', lane: o.lane, agent: o.agent, ageMs: o.ageMs })),
      repos: repoRows,
    },
    overview: {
      stage: 'build', stageProgress: { plan: 1, build: Math.round((PLAN.done / PLAN.total) * 100) / 100, verify: 0, merge: 0 },
      wave: [2, 3], lanesLive: live, tasks: [PLAN.done, PLAN.total], needsYou: open.length,
      bus: { id: busTop.id, at: ms(busTop.createdAt) },
      decision: open[0] ? { askId: open[0].id, kind: open[0].kind, title: open[0].title, body: open[0].body, lane: open[0].lane, agent: open[0].agent, ageMs: open[0].ageMs } : null,
      waves: PLAN.waves,
    },
    lanes,
    plan: PLAN.plan,
    waiting: {
      open,
      resolved: [{ title: 'Use the 10 s delay window for approvals?', outcome: 'Approved', src: 'orchestrator · 11:58', canUndo: false, undoUntil: null }],
    },
    events: { cursor: Math.max(...rows.map((r) => r.id)), rows },
    inbox: {
      dir: `${home(repo.path)}/.matrixkoder/inbox`, archived: 1,
      files: [
        { name: 'orca-dashboard-wiring.md', title: 'Wire the dashboard to real Orca data', editedAt: at - 3_600_000, check: 'pass', missing: [], state: 'imported', planId: 'orca-dashboard-wiring' },
        { name: 'rate-limit-v1.md', title: 'Rate limit the public API', editedAt: at - 1_200_000, check: 'partial', missing: ['Gates', 'Risks'], state: 'new', planId: null },
        { name: 'notes-for-later.md', title: 'Notes', editedAt: at - 86_400_000, check: 'not_a_plan', missing: [], state: 'changed', planId: null },
      ],
    },
    bugs: BUGS,
    todo: TODO,
    settings: { values: { schema: 2 }, agents, baseBranch: 'main', version: '0.1.1' },
  };
}

function plan() {
  const T = (id, title, status, meta, after = null, subs = [], attempts = 0) => ({ id, title, status, meta, after, subs, attempts });
  const phases = [
    { id: 'ph1', title: 'Prove the worker and the build', status: 'done', tasks: [
      T('SPIKE.1', 'Worker serves a tab', 'done', 'merged'), T('SPIKE.2', 'npm test and the mk bin entry', 'done', 'merged', 'SPIKE.1') ] },
    { id: 'ph2', title: 'Data layer and Orca adapter', status: 'working', tasks: [
      T('STORE.1', 'Database schema and migrations', 'working', 'P2 claude · turn 5', null, [['STORE.1.1', 'create tables', 'done', ''], ['STORE.1.2', 'two writers at once', 'working', 'now']]),
      T('STORE.4', 'Plan import and re-import keeps links to started tasks and their attempt history across every plan version', 'failed', 'attempt 2 · gate failed', 'STORE.1', [['STORE.4.1', 'parse blocks', 'done', ''], ['STORE.4.2', 'merge by column ownership', 'failed', 'gate failed']], 2),
      T('ORCA.1', 'Read functions and projections', 'working', 'P1 claude · turn 4', null, [['ORCA.1.1', 'read functions', 'done', ''], ['ORCA.1.2', 'drop prompt fields', 'working', 'now']]),
      T('ORCA.2', 'Action allowlist', 'pending', 'no lane yet', 'ORCA.1'),
      T('ORCA.3', 'Sample snapshot for the screens', 'pending', 'no lane yet', 'ORCA.1') ] },
    { id: 'ph3', title: 'Server and screens', status: 'pending', tasks: [
      T('SERVE.1', 'HTTP server with token and Host checks', 'pending', 'waits for phase 2'),
      T('WIRE.1', 'Screens read the snapshot', 'pending', 'waits for phase 2', 'SERVE.1') ] },
  ].map((p) => ({ ...p, done: p.tasks.filter((t) => t.status === 'done').length, total: p.tasks.length }));
  const all = phases.flatMap((p) => p.tasks);
  const done = all.filter((t) => t.status === 'done').length;
  return {
    done, total: all.length,
    plan: { title: 'orca-dashboard-wiring', done, total: all.length, subtasks: all.reduce((n, t) => n + t.subs.length, 0), phases },
    waves: [
      { title: 'Prove the worker and the build', done: 2, total: 2, segments: { done: 2, working: 0, waiting: 0 } },
      { title: 'Data layer and Orca adapter', done: 0, total: 5, segments: { done: 0, working: 2, waiting: 0 } },
      { title: 'Server and screens', done: 0, total: 2, segments: { done: 0, working: 0, waiting: 0 } },
    ],
  };
}

function bugs() {
  const rows = [
    { id: 'B-14', title: 'Token rotation skips the leeway check', where: 'src/auth/token.ts:88', risk: 5, status: 'fixing', lane: 'P1' },
    { id: 'B-13', title: 'Settings save drops unknown keys when the file has a BOM', where: 'src/store/settings.ts:41', risk: 3, status: 'open', lane: null },
    { id: 'B-12', title: 'Lane card shows the wrong branch for a worktree whose branch name is longer than eighty characters because the label is cut in the middle', where: 'panel/Lanes.dc.html:212', risk: 2, status: 'waiting', lane: null },
    { id: 'B-9', title: 'Empty plan imports as one phase', where: 'src/store/import.ts:130', risk: 1, status: 'fixed', lane: null },
  ];
  return { total: rows.length, needWork: rows.filter((b) => b.status !== 'fixed' && b.status !== 'wontfix').length, rows };
}

function todo() {
  const rows = [
    { id: 1, text: 'Check the Orca release notes for commands.invoke', group: 'today', done: false, link: null },
    { id: 2, text: 'Answer the stale-engine question', group: 'today', done: false, link: { kind: 'task', ref: 'ORCA.1', label: 'ORCA.1 · orca-dashboard-wiring' } },
    { id: 3, text: 'Look at B-12 with a long branch name', group: 'soon', done: false, link: { kind: 'bug', ref: 'B-12', label: 'B-12' } },
    { id: 4, text: 'Archive the old plan files', group: 'soon', done: true, link: null },
  ];
  return { open: rows.filter((t) => !t.done).length, done: rows.filter((t) => t.done).length, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snap = await buildSnapshot();
  writeFileSync(new URL('./snapshot.json', import.meta.url), JSON.stringify(snap, null, 2) + '\n');
  console.log('wrote test/fixtures/snapshot.json', JSON.stringify(snap).length, 'bytes');
}
