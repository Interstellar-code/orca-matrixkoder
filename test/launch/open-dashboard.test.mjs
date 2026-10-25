import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDashboard, commandId } from '../../out/commands/open-dashboard.js';
import { tabList, buildActionArgv } from '../../out/orca/index.js';
import { createServiceKeeper, registerCommandModules } from '../../out/worker.js';

const SERVICE = { port: 4242, url: 'http://127.0.0.1:4242/?t=tok-secret-123' };

// A stub `orca`: answers `tab list` with `tabs`, records every call, and fails the commands named in `fail`.
function stubOrca({ tabs = [], fail = [] } = {}) {
  const calls = [];
  const runner = async (argv) => {
    calls.push(argv);
    const name = argv.slice(0, 2).join(' ');
    if (fail.includes(name)) return { stdout: JSON.stringify({ ok: false, error: { code: 'boom', message: `${name} refused` } }), exitCode: 1 };
    if (name === 'tab list') return { stdout: JSON.stringify({ ok: true, result: { tabs } }) };
    return { stdout: JSON.stringify({ ok: true, result: { browserPageId: 'new' } }) };
  };
  runner.calls = calls;
  return runner;
}
const tab = (id, url) => ({ browserPageId: id, index: 0, url, title: 'MatrixKoder', active: false, loadError: null, worktreeId: 'w', profileId: 'default' });

test('command id is open-dashboard', () => {
  assert.equal(commandId, 'open-dashboard');
});

test('no dashboard tab open: tab create gets the port and the token', async () => {
  const runner = stubOrca();
  const r = await openDashboard(SERVICE, runner);
  assert.deepEqual(r, { ok: true, tab: 'created', port: 4242 });
  assert.deepEqual(runner.calls, [
    ['tab', 'list', '--worktree=all', '--json'],
    ['tab', 'create', '--url=http://127.0.0.1:4242/?t=tok-secret-123', '--json'],
  ]);
});

test('a tab already on this dashboard is focused, not duplicated', async () => {
  const runner = stubOrca({ tabs: [tab('other', 'https://example.com/'), tab('pg1', 'http://127.0.0.1:4242/?t=tok-secret-123#todo')] });
  const r = await openDashboard(SERVICE, runner);
  assert.deepEqual(r, { ok: true, tab: 'focused', port: 4242 });
  assert.deepEqual(runner.calls[1], ['tab', 'switch', '--page=pg1', '--focus', '--json']);
  assert.equal(runner.calls.length, 2, 'no tab create');
});

test('a tab from an earlier start (other port) is not reused', async () => {
  const runner = stubOrca({ tabs: [tab('old', 'http://127.0.0.1:55069/?t=old-token#todo'), tab('lookalike', 'http://127.0.0.1:42420/?t=x')] });
  const r = await openDashboard(SERVICE, runner);
  assert.equal(r.tab, 'created');
  assert.equal(runner.calls.at(-1)[1], 'create');
});

test('if Orca cannot list tabs, or cannot focus the one it listed, a new tab opens', async () => {
  const noList = stubOrca({ fail: ['tab list'] });
  assert.equal((await openDashboard(SERVICE, noList)).tab, 'created');

  const noSwitch = stubOrca({ tabs: [tab('pg1', 'http://127.0.0.1:4242/')], fail: ['tab switch'] });
  assert.equal((await openDashboard(SERVICE, noSwitch)).tab, 'created');
  assert.deepEqual(noSwitch.calls.map((c) => c[1]), ['list', 'switch', 'create']);
});

test('a refused tab create is an error result that does not carry the token', async () => {
  const runner = stubOrca({ fail: ['tab create'] });
  const echo = runner;
  const r = await openDashboard(SERVICE, async (argv, o) => {
    const out = await echo(argv, o);
    return argv[1] === 'create' ? { ...out, stdout: JSON.stringify({ ok: false, error: { message: `navigation failed: ${argv[2].slice(6)}` } }), exitCode: 1 } : out;
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /could not open the dashboard tab: navigation failed: http:\/\/127\.0\.0\.1:4242\/\?t=\[token\]/);
  assert.ok(!JSON.stringify(r).includes('tok-secret-123'));
});

test('tabList keeps only the page id and the address without query or fragment', async () => {
  const r = await tabList(stubOrca({ tabs: [tab('pg1', 'http://127.0.0.1:4242/?t=tok-secret-123#todo'), tab('', 'x'), tab('pg2', 'about:blank')] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.tabs, [
    { browserPageId: 'pg1', url: 'http://127.0.0.1:4242/' },
    { browserPageId: 'pg2', url: 'about:blank' },
  ]);
  assert.ok(!JSON.stringify(r.value).includes('tok-secret-123'));
});

test('tab switch needs a page id and builds --page and --focus', () => {
  assert.equal(buildActionArgv('tab switch', {}).ok, false);
  assert.deepEqual(buildActionArgv('tab switch', { page: 'pg1', focus: true }), { ok: true, argv: ['tab', 'switch', '--page=pg1', '--focus', '--json'] });
  assert.equal(buildActionArgv('tab switch', { index: 1 }).ok, false, 'only page, worktree and focus');
});

// ---- the worker starts the service when it is down ----

test('with no service, the command wrapper starts exactly one and then the tab opens', async () => {
  let starts = 0;
  const svc = { ...SERVICE, state: () => 'STATE', close: async () => {} };
  const keeper = createServiceKeeper(async () => {
    starts++;
    await new Promise((r) => setTimeout(r, 10));
    return svc;
  });
  assert.equal(keeper.current(), null);

  const handlers = new Map();
  const logs = [];
  await registerCommandModules({ commands: { register: (id, h) => handlers.set(id, h) }, log: (m) => logs.push(m) }, keeper);
  assert.ok(handlers.has('open-dashboard'), `registered: ${[...handlers.keys()]}`);

  // two commands arrive while no service is up: one start, both get the same service
  const [a, b] = await Promise.all([handlers.get('mk.state')({}), handlers.get('mk.state')({})]);
  assert.deepEqual([a, b, starts], ['STATE', 'STATE', 1]);
  assert.equal(keeper.current(), svc);

  // then the tab opens for that service
  const runner = stubOrca();
  assert.equal((await openDashboard(await keeper.ensure(), runner)).tab, 'created');
  assert.equal(starts, 1, 'a running service is not started again');
});

test('a start that fails gives a clear error, and the next command tries again', async () => {
  let starts = 0;
  const svc = { ...SERVICE, state: () => 'STATE', close: async () => {} };
  const keeper = createServiceKeeper(async () => {
    if (++starts === 1) throw new Error('EADDRINUSE');
    return svc;
  });
  const handlers = new Map();
  await registerCommandModules({ commands: { register: (id, h) => handlers.set(id, h) }, log: () => {} }, keeper);

  await assert.rejects(handlers.get('open-dashboard')({}), /the MatrixKoder dashboard service could not start: EADDRINUSE/);
  assert.equal(keeper.current(), null);
  assert.equal(await handlers.get('mk.state')({}), 'STATE');
  assert.equal(starts, 2);
});

test('close during a start still closes the service that start produces', async () => {
  let closed = 0;
  const keeper = createServiceKeeper(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return { ...SERVICE, close: async () => { closed++; } };
  });
  const starting = keeper.ensure();
  await keeper.close();
  await starting;
  assert.equal(closed, 1);
  assert.equal(keeper.current(), null);
});

test('close stops the service and a later command starts a fresh one', async () => {
  let closed = 0, starts = 0;
  const keeper = createServiceKeeper(async () => ({ ...SERVICE, close: async () => { closed++; }, n: ++starts }));
  const first = await keeper.ensure();
  await keeper.close();
  assert.equal(closed, 1);
  assert.equal(keeper.current(), null);
  const second = await keeper.ensure();
  assert.notEqual(first.n, second.n);
});
