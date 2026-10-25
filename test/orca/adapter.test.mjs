import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  worktreePs, worktreeList, runList, taskList, workerList, workerShow, gateList, inbox, accountList,
  terminalList, repoList, hostList, runAction, buildActionArgv, ACTION_NAMES, stripSensitive,
} from '../../out/orca/index.js';

const fx = (name) => JSON.parse(readFileSync(new URL(`../fixtures/orca/${name}.json`, import.meta.url), 'utf8'));

// A runner that prints `stdout` and remembers every call.
function stub(stdout, { exitCode = 0 } = {}) {
  const calls = [];
  const runner = async (argv, opts) => {
    calls.push({ argv, opts });
    return { stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), exitCode };
  };
  runner.calls = calls;
  return runner;
}

const DROPPED = ['prompt', 'lastAssistantMessage', 'toolInput', 'preview'];
function keysAnywhere(v, found = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => keysAnywhere(x, found));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { found.add(k); keysAnywhere(x, found); }
  return found;
}
function assertNoDropped(value, what) {
  const found = keysAnywhere(value);
  for (const k of DROPPED) assert.ok(!found.has(k), `${what} still has a "${k}" field`);
}

// ---------- T4: every read function, against the recorded fixtures ----------

test('worktreePs: worktrees with agents, short branch names, no conversation text', async () => {
  const raw = fx('worktree-ps');
  const runner = stub(raw);
  const r = await worktreePs(runner);
  assert.equal(r.ok, true);
  assert.deepEqual(runner.calls[0].argv, ['worktree', 'ps', '--json']);
  assert.equal(runner.calls[0].opts.timeoutMs, 10_000);
  const wts = r.value.worktrees;
  assert.equal(wts.length, raw.result.worktrees.length);
  assert.equal(r.value.totalCount, raw.result.totalCount);
  assert.ok(wts.every((w) => !w.branch.startsWith('refs/heads/')));
  const withAgent = wts.find((w) => w.agents.length > 0);
  assert.ok(withAgent, 'the fixture has a worktree with an agent');
  const a = withAgent.agents[0];
  assert.equal(typeof a.paneKey, 'string');
  assert.ok(['working', 'blocked', 'waiting', 'done', 'idle'].includes(a.state));
  assert.ok(['claude', 'codex', 'opencode', 'agy', 'gemini'].includes(a.agentType) || typeof a.agentType === 'string');
  assertNoDropped(r.value, 'worktreePs');
  assert.ok(!JSON.stringify(r.value).includes('[redacted prompt'));
  assert.ok(!JSON.stringify(r.value).includes('[redacted assistant message'));
  // the raw fixture does carry them, so the drop above is real
  assert.ok(keysAnywhere(raw).has('prompt') && keysAnywhere(raw).has('lastAssistantMessage'));
});

test('worktreeList: id, path, head and short branch', async () => {
  const raw = fx('worktree-list');
  const runner = stub(raw);
  const r = await worktreeList(runner);
  assert.equal(r.ok, true);
  assert.deepEqual(runner.calls[0].argv, ['worktree', 'list', '--json']);
  assert.equal(r.value.worktrees.length, raw.result.worktrees.length);
  const w = r.value.worktrees[0];
  assert.equal(w.id, raw.result.worktrees[0].id);
  assert.equal(w.head, raw.result.worktrees[0].head);
  assert.ok(!w.branch.startsWith('refs/heads/'));
});

test('runList: runs with legacy as a boolean', async () => {
  const raw = fx('run-list');
  const runner = stub(raw);
  const r = await runList(runner);
  assert.equal(r.ok, true);
  assert.deepEqual(runner.calls[0].argv, ['orchestration', 'run-list', '--json']);
  assert.equal(r.value.runs.length, raw.result.runs.length);
  const legacy = r.value.runs.find((x) => x.id === 'run_legacy_local');
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.coordinatorHandle, null);
  assert.equal(r.value.runs[0].legacy, false);
  assert.equal(r.value.nextCursor, null);
});

test('taskList: passes --run, parses deps and keeps failed tasks', async () => {
  const raw = fx('task-list-big');
  const runner = stub(raw);
  const r = await taskList(runner, { runId: 'run_aa2cc2982670' });
  assert.equal(r.ok, true);
  assert.deepEqual(runner.calls[0].argv, ['orchestration', 'task-list', '--run=run_aa2cc2982670', '--json']);
  assert.equal(r.value.tasks.length, raw.result.tasks.length);
  assert.equal(r.value.runId, raw.result.runId);
  const failed = r.value.tasks.filter((t) => t.status === 'failed');
  assert.ok(failed.length >= 1, 'a failed task comes through');
  assert.ok(r.value.tasks.every((t) => Array.isArray(t.deps)));
  assert.ok(!('spec' in r.value.tasks[0]), 'task spec text is not carried');
  assert.equal(r.value.tasks[0].id, raw.result.tasks[0].id);
});

test('taskList: no Run bound comes back as an orca_error with its code', async () => {
  const r = await taskList(stub(fx('task-list-run-required'), { exitCode: 1 }));
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'orca_error');
  assert.equal(r.error.code, 'run_required');
});

test('workerList: workers with state, outcome, attention and the worktree', async () => {
  const raw = fx('worker-list');
  const runner = stub(raw);
  const r = await workerList(runner, { limit: 100 });
  assert.equal(r.ok, true);
  assert.deepEqual(runner.calls[0].argv, ['orchestration', 'worker-list', '--limit=100', '--json']);
  assert.equal(r.value.workers.length, raw.result.workers.length);
  const w0 = r.value.workers[0];
  assert.equal(w0.dispatchId, raw.result.workers[0].dispatchId);
  assert.equal(w0.worktreeId, raw.result.workers[0].resource.worktreeId);
  assert.equal(typeof w0.attention.requiresAction, 'boolean');
  assert.ok(Array.isArray(w0.attention.categories));
  assert.ok(r.value.workers.some((w) => w.dispatchStatus === 'failed'));
  assert.equal(r.value.page.total, raw.result.page.total);
  assert.equal(r.value.counts.retained, raw.result.counts.retained);
  assertNoDropped(r.value, 'workerList');
});

test('workerShow: dispatch, worker and a safe lastFailure (no report body)', async () => {
  const runner = stub(fx('worker-show-failed'));
  const r = await workerShow(runner, { dispatchId: 'ctx_110dcf08ae68' });
  assert.equal(r.ok, true);
  assert.deepEqual(runner.calls[0].argv, ['orchestration', 'worker-show', '--dispatch=ctx_110dcf08ae68', '--json']);
  assert.equal(r.value.dispatch.id, 'ctx_110dcf08ae68');
  assert.equal(r.value.dispatch.status, 'failed');
  assert.equal(r.value.dispatch.lastFailure.outcome, 'failed');
  assert.ok(!('body' in r.value.dispatch.lastFailure));
  assert.ok(!JSON.stringify(r.value).includes('[redacted message body'));
  const ok = await workerShow(stub(fx('worker-show')), { dispatchId: 'ctx_f18a42f2381f' });
  assert.equal(ok.value.dispatch.status, 'completed');
  assert.equal(ok.value.dispatch.lastFailure, null);
});

test('gateList: an empty list comes back empty with its run id', async () => {
  const runner = stub(fx('gate-list'));
  const r = await gateList(runner, { runId: 'run_aa8ea15012d0' });
  assert.equal(r.ok, true);
  assert.deepEqual(runner.calls[0].argv, ['orchestration', 'gate-list', '--run=run_aa8ea15012d0', '--json']);
  assert.deepEqual(r.value, { runId: 'run_aa8ea15012d0', count: 0, gates: [] });
});

test('gateList: a pending gate is projected (options parsed, question capped)', async () => {
  const env = { ok: true, result: { runId: 'run_x', count: 1, gates: [{
    id: 'gate_1', run_id: 'run_x', task_id: 'task_1', question: 'q'.repeat(900),
    options: '["approve","rework"]', status: 'pending', resolution: null, created_at: '2026-10-25 01:00:00', resolved_at: null,
  }] } };
  const r = await gateList(stub(env), { runId: 'run_x', status: 'pending' });
  assert.equal(r.ok, true);
  const g = r.value.gates[0];
  assert.deepEqual(g.options, ['approve', 'rework']);
  assert.equal(g.question.length, 400);
  assert.equal(g.status, 'pending');
  assert.equal(g.resolution, null);
});

test('inbox: messages keep type, sequence and a small payload; the bus is read with --limit', async () => {
  const raw = fx('inbox');
  const runner = stub(raw);
  const r = await inbox(runner, { limit: 100 });
  assert.equal(r.ok, true);
  assert.deepEqual(runner.calls[0].argv, ['orchestration', 'inbox', '--limit=100', '--json']);
  assert.equal(r.value.messages.length, raw.result.messages.length);
  const types = new Set(r.value.messages.map((m) => m.type));
  for (const t of ['question', 'worker_done', 'heartbeat', 'status']) assert.ok(types.has(t), `has a ${t} message`);
  const q = r.value.messages.find((m) => m.type === 'question');
  assert.equal(typeof q.payload.taskId, 'string');
  assert.ok(Array.isArray(q.payload.options) || q.payload.options === undefined);
  assert.equal(typeof q.sequence, 'number');
  const hb = r.value.messages.find((m) => m.type === 'heartbeat');
  assert.equal(typeof hb.payload.phase, 'string');
});

test('inbox: payload fields outside the allowed few are dropped', async () => {
  const env = { ok: true, result: { count: 1, messages: [{
    id: 'm1', run_id: 'r', type: 'worker_done', priority: 'normal', from_handle: 'a', to_handle: 'b', subject: 's', body: 'b',
    payload: JSON.stringify({ taskId: 't', outcome: 'succeeded', filesModified: ['x'], report: 'long text' }),
    read: 0, sequence: 7, created_at: 'c',
  }] } };
  const r = await inbox(stub(env));
  assert.deepEqual(r.value.messages[0].payload, { taskId: 't', outcome: 'succeeded' });
});

test('accountList: counts, quota windows, and no emails', async () => {
  const raw = fx('account-list');
  const r = await accountList(stub(raw));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.agents.map((a) => a.agent), ['claude', 'codex', 'opencode', 'devin'].filter((k) => k in raw.result));
  const claude = r.value.rateLimits.find((q) => q.provider === 'claude');
  assert.equal(claude.session.usedPercent, raw.result.rateLimits.claude.session.usedPercent);
  assert.equal(claude.weekly.windowMinutes, raw.result.rateLimits.claude.weekly.windowMinutes);
  const withError = r.value.rateLimits.find((q) => q.error);
  assert.ok(withError, 'a provider with an error is kept');
  assert.equal(withError.session, null);
  assert.ok(!JSON.stringify(r.value).includes('@'));
  // the raw rateLimits also holds flags and targets; only provider objects are quota rows
  assert.ok(Object.keys(raw.result.rateLimits).some((k) => typeof raw.result.rateLimits[k] !== 'object' || raw.result.rateLimits[k] === null));
  for (const q of r.value.rateLimits) assert.equal(typeof q.provider, 'string');
  assert.ok(!r.value.rateLimits.some((q) => /Configured$|Target$|^inactive/.test(q.provider)));
});

test('terminalList: handles, worktrees and titles, no preview', async () => {
  const raw = fx('terminal-list');
  const r = await terminalList(stub(raw));
  assert.equal(r.ok, true);
  assert.equal(r.value.terminals.length, raw.result.terminals.length);
  assert.equal(r.value.terminals[0].handle, raw.result.terminals[0].handle);
  assert.equal(r.value.totalCount, raw.result.totalCount);
  assertNoDropped(r.value, 'terminalList');
  assert.ok(keysAnywhere(raw).has('preview'));
});

test('repoList and hostList', async () => {
  const repos = fx('repo-list');
  const r = await repoList(stub(repos));
  assert.equal(r.ok, true);
  assert.equal(r.value.repos.length, repos.result.repos.length);
  assert.equal(r.value.repos[0].displayName, repos.result.repos[0].displayName);
  assert.ok(!('hookSettings' in r.value.repos[0]));
  const hosts = fx('host-list');
  const h = await hostList(stub(hosts));
  assert.equal(h.ok, true);
  assert.equal(h.value.hosts.length, hosts.result.hosts.length);
  assert.equal(h.value.hosts[0].selector, hosts.result.hosts[0].selector);
});

// ---------- drop of prompt, lastAssistantMessage, toolInput, preview at depth ----------

test('stripSensitive removes the four fields at any depth, in objects and arrays', () => {
  const input = {
    a: 1, prompt: 'P', nested: { lastAssistantMessage: 'L', ok: 'keep', deeper: [{ toolInput: { cmd: 'rm' }, keep: 2, x: { preview: 'V' } }] },
    list: [{ preview: 'V2', name: 'n' }, 'str', 3, null],
  };
  const out = stripSensitive(input);
  assert.deepEqual(out, { a: 1, nested: { ok: 'keep', deeper: [{ keep: 2, x: {} }] }, list: [{ name: 'n' }, 'str', 3, null] });
  assert.ok('prompt' in input, 'the input is not changed');
});

test('a result with sensitive fields buried in every projection comes back without them', async () => {
  const secret = 'SECRET-TEXT';
  const bury = (o) => ({ ...o, prompt: secret, lastAssistantMessage: secret, toolInput: { command: secret }, preview: secret,
    extra: { deep: [{ prompt: secret, preview: secret }] } });
  const cases = [
    [worktreePs, { worktrees: [bury({ worktreeId: 'w', agents: [bury({ paneKey: 'p', state: 'working', agentType: 'claude' })] })] }],
    [terminalList, { terminals: [bury({ handle: 'term_1' })] }],
    [workerList, { workers: [bury({ dispatchId: 'd', projection: bury({ stage: bury({}), liveness: bury({}), attention: bury({ categories: [] }) }), resource: bury({}) })] }],
    [workerShow, { dispatch: bury({ id: 'd' }), worker: bury({}), projection: bury({}), terminal: bury({}), observation: bury({ status: 'live', agentWait: bury({}) }) }],
    [worktreeList, { worktrees: [bury({ id: 'w' })] }],
    [repoList, { repos: [bury({ id: 'r' })] }],
    [accountList, bury({ claude: bury({ accounts: [bury({})] }), rateLimits: { claude: bury({ session: bury({ usedPercent: 3 }) }) } })],
  ];
  for (const [fn, result] of cases) {
    const r = await fn(stub({ ok: true, result }), fn === workerShow ? { dispatchId: 'd' } : undefined);
    assert.equal(r.ok, true, `${fn.name} ok`);
    const out = JSON.stringify(r.value);
    assert.ok(!out.includes(secret), `${fn.name} leaked text`);
    assertNoDropped(r.value, fn.name);
  }
});

// ---------- failures come back typed, never thrown ----------

test('a timeout comes back as a timeout error', async () => {
  const runner = async () => { throw Object.assign(new Error('slow'), { code: 'ETIMEDOUT' }); };
  const r = await worktreePs(runner);
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'timeout');
  assert.match(r.error.message, /10000 ms/);
});

test('output that is not JSON comes back as invalid_json', async () => {
  for (const out of ['Orca is not running', '', '[1,2]', 'null']) {
    const r = await runList(stub(out));
    assert.equal(r.ok, false, JSON.stringify(out));
    assert.equal(r.error.kind, 'invalid_json');
  }
});

test('a process that cannot start comes back as exec_failed', async () => {
  const runner = async () => { throw Object.assign(new Error('spawn orca ENOENT'), { code: 'ENOENT' }); };
  const r = await hostList(runner);
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'exec_failed');
  assert.match(r.error.message, /ENOENT/);
});

test('an {ok:true} reply without a result object is bad_shape', async () => {
  const r = await repoList(stub({ ok: true }));
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'bad_shape');
});

// ---------- ORCA.2: the action allowlist ----------

const RECEIPT = { id: 'abc', ok: true, result: { id: 'thing_1', note: 'receipt kept as is', nested: { prompt: 'Orca said this' } }, _meta: { runtimeId: 'rt' } };

const ALLOWED = [
  ['run-create', { objective: 'ship it', 'retry-request': 'rr1' }, ['orchestration', 'run-create', '--objective=ship it', '--retry-request=rr1', '--json']],
  ['task-create', { spec: 'mk-ref: B-1\nfix it', 'task-title': 'Fix', deps: ['task_a'], run: 'run_1', 'retry-request': 'rr2' },
    ['orchestration', 'task-create', '--spec=mk-ref: B-1\nfix it', '--task-title=Fix', '--deps=["task_a"]', '--run=run_1', '--retry-request=rr2', '--json']],
  ['task-update', { id: 'task_1', status: 'completed', result: 'done' }, ['orchestration', 'task-update', '--id=task_1', '--status=completed', '--result=done', '--json']],
  ['worker-start', { task: 'task_1', agent: 'claude', model: 'sonnet', effort: 'low', worktree: 'new-child', 'timeout-ms': 60000 },
    ['orchestration', 'worker-start', '--task=task_1', '--worktree=new-child', '--agent=claude', '--model=sonnet', '--effort=low', '--timeout-ms=60000', '--json']],
  ['reply', { id: 'msg_1', body: 'yes, go', run: 'run_1' }, ['orchestration', 'reply', '--id=msg_1', '--body=yes, go', '--run=run_1', '--json']],
  ['gate-resolve', { id: 'gate_1', resolution: 'approved', 'retry-request': 'rr3' }, ['orchestration', 'gate-resolve', '--id=gate_1', '--resolution=approved', '--retry-request=rr3', '--json']],
  ['terminal send', { terminal: 'term_1', text: 'hello', enter: true }, ['terminal', 'send', '--terminal=term_1', '--text=hello', '--enter', '--json']],
  ['tab create', { url: 'http://127.0.0.1:5173/', worktree: 'active' }, ['tab', 'create', '--url=http://127.0.0.1:5173/', '--worktree=active', '--json']],
  ['repo set-base-ref', { repo: 'id:r1', ref: 'main' }, ['repo', 'set-base-ref', '--repo=id:r1', '--ref=main', '--json']],
];

test('the allowlist is exactly the nine C5 actions', () => {
  assert.deepEqual([...ACTION_NAMES].sort(), ['gate-resolve', 'reply', 'repo set-base-ref', 'run-create', 'tab create', 'task-create', 'task-update', 'terminal send', 'worker-start']);
  assert.equal(ALLOWED.length, 9);
});

for (const [name, args, argv] of ALLOWED) {
  test(`action "${name}" builds its argv and returns Orca's receipt unchanged`, async () => {
    const runner = stub(RECEIPT);
    const r = await runAction(name, args, runner);
    assert.equal(r.ok, true);
    assert.equal(runner.calls.length, 1);
    assert.deepEqual(runner.calls[0].argv, argv);
    assert.equal(runner.calls[0].opts.timeoutMs, 10_000);
    assert.deepEqual(r.receipt, RECEIPT);
    assert.deepEqual(buildActionArgv(name, args), { ok: true, argv });
  });
}

test('refused names never start a process', async () => {
  const names = [
    'orchestration check', 'check', 'orchestration-check', 'orchestration check --unread', '',
    'worktree rm', 'terminal close', 'task-delete', 'unknown',
    'reply; rm -rf /', 'reply && orca orchestration check', 'terminal send --enter', 'reply ', ' reply', 'REPLY', 'tab create\n',
    '__proto__', 'constructor', 'toString', 'hasOwnProperty',
  ];
  for (const name of names) {
    const runner = stub(RECEIPT);
    const r = await runAction(name, { id: 'x', body: 'y' }, runner);
    assert.equal(r.ok, false, JSON.stringify(name));
    assert.equal(r.error.kind, 'not_allowed', JSON.stringify(name));
    assert.equal(runner.calls.length, 0, `runner was called for ${JSON.stringify(name)}`);
  }
  assert.match((await runAction('orchestration check', {}, stub(RECEIPT))).error.message, /not on the allowlist/);
});

test('bad arguments are refused before any process starts', async () => {
  const cases = [
    ['reply', { id: 'msg_1' }, /needs "body"/],
    ['reply', { id: 'msg_1', body: 'x', unknown: 'y' }, /no argument "unknown"/],
    ['reply', { id: 'msg_1', body: 'x', ['--json; rm']: 'y' }, /no argument/],
    ['reply', { id: 5, body: 'x' }, /non-empty string/],
    ['gate-resolve', { id: 'g', resolution: '' }, /non-empty string|needs/],
    ['worker-start', { agent: 'claude' }, /one of: task, spec/],
    ['worker-start', { task: 't' }, /one of: agent, terminal/],
    ['terminal send', { terminal: 't', text: 'x', enter: 'yes' }, /true or left out/],
    ['task-update', { id: 't', status: 'a\0b' }, /non-empty string/],
    ['repo set-base-ref', { repo: 'r' }, /needs "ref"/],
  ];
  for (const [name, args, re] of cases) {
    const runner = stub(RECEIPT);
    const r = await runAction(name, args, runner);
    assert.equal(r.ok, false, `${name} ${JSON.stringify(args)}`);
    assert.equal(r.error.kind, 'bad_args');
    assert.match(r.error.message, re);
    assert.equal(runner.calls.length, 0);
  }
});

test('an Orca-side failure keeps the receipt and the error code', async () => {
  const env = { id: 'e', ok: false, error: { code: 'task_not_startable', message: 'task is active' } };
  const r = await runAction('task-update', { id: 't', status: 'ready' }, stub(env, { exitCode: 1 }));
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'orca_error');
  assert.equal(r.error.code, 'task_not_startable');
  assert.deepEqual(r.receipt, env);
});

test('an action that times out or prints non-JSON returns a typed error', async () => {
  const slow = async () => { throw Object.assign(new Error('x'), { code: 'ETIMEDOUT' }); };
  assert.equal((await runAction('reply', { id: 'm', body: 'b' }, slow)).error.kind, 'timeout');
  assert.equal((await runAction('reply', { id: 'm', body: 'b' }, stub('not json'))).error.kind, 'invalid_json');
});

// ---------- fix round 2 ----------

test('finding 1: a value that starts with -- stays inside its own --key=value element', () => {
  const r = buildActionArgv('reply', { id: 'x', body: '--json' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.argv, ['orchestration', 'reply', '--id=x', '--body=--json', '--json']);
  assert.equal(r.argv.filter((a) => a === '--json').length, 1, 'only the trailing --json is a bare flag');
  const steer = buildActionArgv('reply', { id: '--run', body: '--json' });
  assert.deepEqual(steer.argv, ['orchestration', 'reply', '--id=--run', '--body=--json', '--json']);
  const dep = buildActionArgv('task-create', { spec: '--spec', deps: ['--x'] });
  assert.deepEqual(dep.argv, ['orchestration', 'task-create', '--spec=--spec', '--deps=["--x"]', '--json']);
});

test('finding 1: no flag name is ever a separate element before its value, for every action', () => {
  for (const [name, args] of ALLOWED.map(([n, a]) => [n, a])) {
    const { argv } = buildActionArgv(name, args);
    const bare = argv.slice(argv.indexOf(argv.find((a) => a.startsWith('--'))));
    for (const a of bare) assert.ok(a === '--json' || a === '--enter' || a.includes('='), `${name}: "${a}" is a bare value-less element`);
  }
});

test('finding 2: reads pass values as --key=value too', async () => {
  const runner = stub(fx('task-list'));
  await taskList(runner, { runId: '--status', status: '--json' });
  assert.deepEqual(runner.calls[0].argv, ['orchestration', 'task-list', '--status=--json', '--run=--status', '--json']);
  const w = stub(fx('worker-list'));
  await workerList(w, { runId: 'run_1', terminalState: 'active', cursor: 'c', limit: 5 });
  assert.deepEqual(w.calls[0].argv, ['orchestration', 'worker-list', '--run=run_1', '--terminal-state=active', '--cursor=c', '--limit=5', '--json']);
  const b = stub(fx('task-list'));
  await taskList(b, { runId: 'run_1', brief: true });
  assert.deepEqual(b.calls[0].argv, ['orchestration', 'task-list', '--run=run_1', '--brief', '--json']);
});

test('finding 2: a missing, null or empty required id is a bad_args error and the runner is not called', async () => {
  for (const opts of [{}, { dispatchId: undefined }, { dispatchId: null }, { dispatchId: '' }, { dispatchId: 5 }, { dispatchId: {} }, null, undefined]) {
    const runner = stub(fx('worker-show'));
    const r = await workerShow(runner, opts);
    assert.equal(r.ok, false, JSON.stringify(opts));
    assert.equal(r.error.kind, 'bad_args', JSON.stringify(opts));
    assert.equal(runner.calls.length, 0);
  }
  // a bad optional value is refused the same way
  for (const bad of [null, '', NaN, Infinity, {}, []]) {
    const runner = stub(fx('task-list'));
    const r = await taskList(runner, { runId: bad });
    assert.equal(r.ok, false);
    assert.equal(r.error.kind, 'bad_args');
    assert.equal(runner.calls.length, 0);
  }
});

test('finding 3: workerShow with no arguments at all returns a typed error and never throws', async () => {
  const r = await workerShow();
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'bad_args');
  assert.match(r.error.message, /dispatch/);
  assert.equal((await workerShow(undefined, undefined)).error.kind, 'bad_args');
});

test('finding 4: stage, liveness and observation keep known keys only', async () => {
  const env = { ok: true, result: {
    dispatch: { id: 'd' }, worker: {}, terminal: {},
    projection: { outcome: 'failed', stage: { worker: 'failed', dispatch: 'failed', detail: 'settled', activity: 'unknown', note: 'SECRET-STAGE' },
      liveness: { verdict: 'exited', source: 'resource_release', reason: 'stale_status', observedAt: 5, text: 'SECRET-LIVE' }, attention: { categories: [], requiresAction: false }, nextAction: { kind: 'none' } },
    observation: { status: 'live', exactWorker: true, agentWait: { question: 'SECRET-WAIT' }, tail: 'SECRET-OBS' },
  } };
  const r = await workerShow(stub(env), { dispatchId: 'd' });
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r.value).includes('SECRET'));
  assert.deepEqual(r.value.projection.stage, { worker: 'failed', dispatch: 'failed', detail: 'settled', activity: 'unknown' });
  assert.deepEqual(r.value.projection.liveness, { verdict: 'exited', source: 'resource_release', reason: 'stale_status', observedAt: 5 });
  assert.deepEqual(r.value.observation, { status: 'live', exactWorker: true, agentWait: true });
  const list = await workerList(stub({ ok: true, result: { workers: [{ dispatchId: 'd', projection: env.result.projection }], counts: {}, page: {} } }));
  assert.ok(!JSON.stringify(list.value).includes('SECRET'));
});

test('finding 4: the recorded fixtures project to the same known keys', async () => {
  const r = await workerList(stub(fx('worker-list')));
  for (const w of r.value.workers) {
    assert.deepEqual(Object.keys(w.stage), ['worker', 'dispatch', 'detail', 'activity']);
    assert.deepEqual(Object.keys(w.liveness), ['verdict', 'source', 'reason', 'observedAt']);
  }
  const s = await workerShow(stub(fx('worker-show')), { dispatchId: 'ctx_f18a42f2381f' });
  assert.deepEqual(s.value.observation, { status: 'exited', exactWorker: true, agentWait: false });
});

test('finding 5: terminal send needs terminal and text, tab create needs url, --setup is restricted', () => {
  assert.equal(buildActionArgv('terminal send', { text: 'x' }).error.kind, 'bad_args');
  assert.match(buildActionArgv('terminal send', { terminal: 't' }).error.message, /needs "text"/);
  assert.match(buildActionArgv('tab create', {}).error.message, /needs "url"/);
  const base = { task: 't', agent: 'claude' };
  assert.match(buildActionArgv('worker-start', { ...base, setup: 'bogus' }).error.message, /one of: run, skip, inherit/);
  for (const ok of ['run', 'skip', 'inherit']) {
    assert.ok(buildActionArgv('worker-start', { ...base, setup: ok }).argv.includes(`--setup=${ok}`));
  }
});
