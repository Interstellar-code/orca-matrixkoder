// T5: the real HTTP server + snapshot, started on a temp data dir against recorded Orca fixtures. No real `orca`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importFile } from '../../out/store/import.js';
import { fx, fixtureRoutes, get, post, startTestService, stubRunner, tmpDir } from './helpers.mjs';

const SCREENS = ['projects', 'overview', 'lanes', 'plan', 'waiting', 'events', 'inbox', 'bugs', 'todo', 'settings'];
const KEYS = ['meta', 'badges', 'projects', 'overview', 'lanes', 'plan', 'waiting', 'events', 'inbox', 'bugs', 'todo', 'settings'];
const REAL_PLAN = new URL('../../.matrixkoder/inbox/orca-dashboard-wiring.md', import.meta.url).pathname;
const PLAN_NAME = 'orca-dashboard-wiring.md';
const LIMIT = 65536;

/** Run `fn(svc)` against a fresh service, always closing it. */
async function withService(opts, fn) {
  const svc = await startTestService(opts);
  try {
    return await fn(svc);
  } finally {
    await svc.close();
  }
}
const withFixtures = async (fn) => {
  return withService({ runner: stubRunner(fixtureRoutes()) }, async (svc) => {
    await svc.sync.pullAll();
    return fn(svc);
  });
};

/** node:http request, so tests can set Host and send odd paths that fetch would rewrite. */
function raw(svc, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: svc.port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const q = (db, sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
const now = () => Date.now();

/** The state text and parsed object for one request; asserts 200 and the 64 KB rule. */
async function state(svc, query = '') {
  const res = await get(svc, `/api/state${query}`);
  assert.equal(res.status, 200, `GET /api/state${query}`);
  const text = await res.text();
  const bytes = Buffer.byteLength(text);
  assert.ok(bytes < LIMIT, `/api/state${query} is ${bytes} bytes, over ${LIMIT}`);
  return { text, json: JSON.parse(text), bytes };
}

function addRepo(db, id, path, name = id) {
  db.prepare('INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at) VALUES(?,?,?,?,?)').run(id, path, name, now(), now());
}
function inTx(db, fn) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** A seed repo whose temp folder holds the real plan in its inbox, imported through the real importer. */
function seedPlanRepo(svc, id = 'seed-repo') {
  const repoPath = tmpDir('seedrepo');
  const inbox = join(repoPath, '.matrixkoder', 'inbox');
  mkdirSync(inbox, { recursive: true });
  copyFileSync(REAL_PLAN, join(inbox, PLAN_NAME));
  addRepo(svc.ctx.db, id, repoPath, 'seed repo');
  const r = importFile(svc.ctx.db, { repoId: id, repoPath }, PLAN_NAME);
  return { id, repoPath, planId: r.planId };
}
function addBugs(db, repoId, n, titleLen = 300) {
  const ins = db.prepare('INSERT INTO bug(id, repo_id, title, details, risk, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)');
  inTx(db, () => {
    for (let i = 0; i < n; i++) ins.run(`B-${i + 1}`, repoId, `bug ${i} ${'b'.repeat(titleLen)}`, 'd'.repeat(500), 1 + (i % 5), i % 3 === 0 ? 'fixed' : 'open', now() - i, now());
  });
}
function addTodos(db, repoId, n, textLen = 300) {
  const ins = db.prepare('INSERT INTO todo(repo_id, text, grp, done, sort, created_at) VALUES(?,?,?,?,?,?)');
  inTx(db, () => {
    for (let i = 0; i < n; i++) ins.run(repoId, `todo ${i} ${'t'.repeat(textLen)}`, ['today', 'soon', 'later'][i % 3], i % 4 === 0 ? 1 : 0, i, now());
  });
}
function addEvents(db, n, textLen = 300, repoId = null) {
  const ins = db.prepare('INSERT INTO event_log(at, kind, repo_id, text, src, ref, payload) VALUES(?,?,?,?,?,?,?)');
  const kinds = ['lane', 'gate', 'ask', 'commit', 'bus'];
  inTx(db, () => {
    for (let i = 0; i < n; i++) ins.run(1_700_000_000_000 + i, kinds[i % 5], repoId, `event ${i} ${'e'.repeat(textLen)}`, `P${i % 9} claude`, `msg:${i}`, JSON.stringify({ i }));
  });
}

// ------------------------------------------------------------------------------------------------ 1. auth

test('auth: every API path is 403 with no token, a wrong token, or a foreign Host; the right token and Host get 200', async () => {
  await withService({}, async (svc) => {
    addEvents(svc.ctx.db, 1, 10);
    assert.equal(q(svc.ctx.db, 'SELECT id FROM event_log')[0].id, 1);
    const paths = [
      { method: 'GET', path: '/api/state' },
      { method: 'GET', path: '/api/events' },
      { method: 'GET', path: '/api/event/1' },
      { method: 'POST', path: '/api/action', body: JSON.stringify({ name: 'nope', args: {} }) },
    ];
    const withJson = (p, h) => ({ ...p, headers: { ...(p.method === 'POST' ? { 'content-type': 'application/json' } : {}), ...h } });
    for (const p of paths) {
      const label = `${p.method} ${p.path}`;
      const none = await raw(svc, withJson(p, {}));
      assert.equal(none.status, 403, `${label} without a token`);
      const wrong = await raw(svc, withJson(p, { 'x-mk-token': 'f'.repeat(svc.token.length) }));
      assert.equal(wrong.status, 403, `${label} with a wrong token`);
      const short = await raw(svc, withJson(p, { 'x-mk-token': 'x' }));
      assert.equal(short.status, 403, `${label} with a short token`);
      const foreign = await raw(svc, withJson(p, { host: 'evil.example:80', 'x-mk-token': svc.token }));
      assert.equal(foreign.status, 403, `${label} with a foreign Host`);
      const rebind = await raw(svc, withJson(p, { host: `localhost:${svc.port}`, 'x-mk-token': svc.token }));
      assert.equal(rebind.status, 403, `${label} with Host localhost`);
      const wrongPort = await raw(svc, withJson(p, { host: '127.0.0.1:1', 'x-mk-token': svc.token }));
      assert.equal(wrongPort.status, 403, `${label} with the wrong port in Host`);
      const ok = await raw(svc, withJson(p, { 'x-mk-token': svc.token }));
      // the POST here is an unknown action: authorized, so it gets as far as the action's own 400
      assert.equal(ok.status, p.method === 'POST' ? 400 : 200, `${label} with the right token and Host`);
      for (const bad of [none, wrong, foreign]) assert.equal(bad.json.error.kind, 'unauthorized');
    }
    // the 403 body never carries state
    const denied = await raw(svc, { path: '/api/state' });
    assert.ok(!/meta|projects/.test(denied.text));
  });
});

test('auth: ?t= opens the page but never an /api/ path; the cookie set by a ?t= page load opens page files only', async () => {
  await withService({}, async (svc) => {
    const byQuery = await raw(svc, { path: `/?t=${svc.token}` });
    assert.equal(byQuery.status, 200);
    assert.match(byQuery.text, /<meta name="mk-token" content="[0-9a-f]+">/);
    assert.ok(byQuery.text.includes(`content="${svc.token}"`));
    assert.match(byQuery.headers['content-type'], /text\/html/);
    assert.match(String(byQuery.headers['set-cookie']), /mk_token=/);
    assert.equal(byQuery.headers['cache-control'], 'no-store');

    const byHeader = await raw(svc, { path: '/', headers: { 'x-mk-token': svc.token } });
    assert.equal(byHeader.status, 200);
    assert.match(byHeader.text, /<meta name="mk-token"/);
    assert.ok(byHeader.text.includes('dash'), 'the page comes from the web folder');

    assert.equal((await raw(svc, { path: '/' })).status, 403, 'the page needs a token too');
    assert.equal((await raw(svc, { path: '/?t=wrong' })).status, 403);

    for (const p of ['/api/state', '/api/events', '/api/event/1', '/api/ping']) {
      const r = await raw(svc, { path: `${p}${p.includes('?') ? '&' : '?'}t=${svc.token}` });
      assert.equal(r.status, 403, `${p} with only ?t=`);
    }
    // the cookie works for page files, not for the API
    const cookie = `mk_token=${svc.token}`;
    assert.equal((await raw(svc, { path: '/', headers: { cookie } })).status, 200);
    assert.equal((await raw(svc, { path: '/api/state', headers: { cookie } })).status, 403);
    // an unknown file under the web folder with a good token is 404, not an index fallback
    assert.equal((await raw(svc, { path: '/nope.js', headers: { 'x-mk-token': svc.token } })).status, 404);
  });
});

test('auth: path traversal is never served', async () => {
  await withService({}, async (svc) => {
    writeFileSync(join(svc.dir, 'secret.txt'), 'TOP-SECRET-OUTSIDE-WEB');
    const paths = [
      '/..%2f..%2fetc/passwd', '/%2e%2e/x', '/%2e%2e%2fsecret.txt', '/..%2fsecret.txt', '/../secret.txt', '/..%5csecret.txt',
      '/%2e%2e/%2e%2e/etc/passwd', '/web/../../secret.txt', '/%00', '/index.html%00.png', '/%',
    ];
    for (const p of paths) {
      for (const headers of [{ 'x-mk-token': svc.token }, {}]) {
        const r = await raw(svc, { path: `${p}${headers['x-mk-token'] ? '' : `?t=${svc.token}`}`, headers });
        assert.notEqual(r.status, 200, `${p} must not be served`);
        assert.ok(!r.text.includes('TOP-SECRET-OUTSIDE-WEB'), `${p} leaked a file outside web/`);
        assert.ok(!r.text.includes('root:'), `${p} leaked /etc/passwd`);
      }
    }
    // the data folder's own files are not under web/
    for (const f of ['mk-data.db', 'mk-settings.json']) {
      const r = await raw(svc, { path: `/${f}`, headers: { 'x-mk-token': svc.token } });
      assert.notEqual(r.status, 200, `${f} served`);
    }
  });
});

test('auth: POST needs application/json (415), a JSON object body (400) and a known action (400 unknown_action)', async () => {
  await withService({}, async (svc) => {
    const h = { 'x-mk-token': svc.token };
    const plain = await raw(svc, { method: 'POST', path: '/api/action', headers: { ...h, 'content-type': 'text/plain' }, body: '{"name":"x"}' });
    assert.equal(plain.status, 415);
    const none = await raw(svc, { method: 'POST', path: '/api/action', headers: h, body: '{"name":"x"}' });
    assert.equal(none.status, 415, 'no content-type');
    const form = await raw(svc, { method: 'POST', path: '/api/action', headers: { ...h, 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=x' });
    assert.equal(form.status, 415);
    const bad = await raw(svc, { method: 'POST', path: '/api/action', headers: { ...h, 'content-type': 'application/json' }, body: 'not json {' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.ok, false);
    for (const body of ['[]', '"str"', 'null', '3']) {
      const r = await raw(svc, { method: 'POST', path: '/api/action', headers: { ...h, 'content-type': 'application/json; charset=utf-8' }, body });
      assert.equal(r.status, 400, `body ${body}`);
      assert.equal(r.json.ok, false);
    }
    const unknown = await post(svc, 'definitely.not.an.action', {});
    assert.equal(unknown.status, 400);
    const u = await unknown.json();
    assert.equal(u.ok, false);
    assert.equal(u.error.kind, 'unknown_action');
    const noName = await raw(svc, { method: 'POST', path: '/api/action', headers: { ...h, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(noName.status, 400);
    assert.equal(noName.json.error.kind, 'unknown_action');
    // POST anywhere but /api/action, and other methods
    assert.equal((await raw(svc, { method: 'POST', path: '/api/state', headers: { ...h, 'content-type': 'application/json' }, body: '{}' })).status, 404);
    assert.equal((await raw(svc, { method: 'PUT', path: '/api/state', headers: h })).status, 405);
    assert.equal((await raw(svc, { method: 'DELETE', path: '/', headers: h })).status, 405);
    // an over-size body is refused, not buffered forever
    const big = await raw(svc, { method: 'POST', path: '/api/action', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', args: { pad: 'p'.repeat(1_200_000) } }) }).catch((e) => ({ status: 'closed', err: e }));
    assert.ok(big.status === 413 || big.status === 'closed', `over-size body: ${big.status}`);
    // the server still answers afterwards
    assert.equal((await get(svc, '/api/ping')).status, 200);
  });
});

test('auth: the server binds 127.0.0.1 only, and each start gets its own token', async () => {
  const a = await startTestService();
  const b = await startTestService();
  try {
    assert.match(a.token, /^[0-9a-f]{32,}$/);
    assert.notEqual(a.token, b.token);
    assert.notEqual(a.port, b.port);
    assert.equal(new URL(a.url).hostname, '127.0.0.1');
    assert.equal(new URL(a.url).searchParams.get('t'), a.token);
    assert.equal(Number(new URL(a.url).port), a.port);
    // a's token does not open b
    const cross = await fetch(`http://127.0.0.1:${b.port}/api/ping`, { headers: { 'x-mk-token': a.token } });
    assert.equal(cross.status, 403);
    // not reachable on a non-loopback address of this machine
    const external = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    for (const addr of external.slice(0, 2)) {
      const reachable = await new Promise((resolve) => {
        const s = connect({ host: addr, port: a.port, timeout: 1000 });
        s.on('connect', () => { s.destroy(); resolve(true); });
        s.on('error', () => resolve(false));
        s.on('timeout', () => { s.destroy(); resolve(false); });
      });
      assert.equal(reachable, false, `listening on ${addr}`);
    }
  } finally {
    await a.close();
    await b.close();
  }
  // closed servers refuse connections
  await assert.rejects(fetch(`http://127.0.0.1:${a.port}/api/ping`, { headers: { 'x-mk-token': a.token } }));
});

// ------------------------------------------------------------------------------------------------ 2. /api/state shape

test('/api/state: has every key, meta.stale has per-source keys, and the pulled fixtures show up', async () => {
  await withFixtures(async (svc) => {
    const { json } = await state(svc);
    assert.deepEqual(Object.keys(json), KEYS);
    assert.equal(json.meta.schema, 1);
    assert.deepEqual(Object.keys(json.meta.stale).sort(), ['files', 'git', 'inbox', 'orchestration', 'ps', 'quota', 'repos', 'runs', 'terminals']);
    for (const k of ['ps', 'terminals', 'repos', 'runs', 'inbox']) assert.equal(typeof json.meta.stale[k], 'number', `stale.${k} after a pull`);
    assert.equal(json.meta.runtimeOk, true);
    assert.equal(json.meta.screen, 'projects');
    assert.ok(json.projects.total >= 1, 'repos from repo list');
    assert.ok(json.projects.repos.length >= 1);
    // lanes are per selected repo: select the repo that owns the pulled lanes
    const laneRepo = q(svc.ctx.db, 'SELECT repo_id FROM lane GROUP BY repo_id ORDER BY COUNT(*) DESC LIMIT 1')[0]?.repo_id;
    assert.ok(laneRepo, 'the pull created lanes from worktree ps and terminals');
    const withLanes = (await state(svc, `?repo=${laneRepo}`)).json;
    assert.equal(withLanes.meta.repoId, laneRepo);
    assert.ok(withLanes.lanes.length >= 1, 'lanes of the selected repo');
    assert.ok(withLanes.lanes.every((l) => typeof l.label === 'string' && typeof l.state === 'string'));
    assert.equal(typeof json.badges.lanes, 'number');
    assert.ok(['waiting', 'inbox', 'bugs'].every((k) => typeof json.badges[k] === 'number'));
    // an unknown screen falls back to projects; the response is the same shape
    const odd = await state(svc, '?screen=../../etc');
    assert.equal(odd.json.meta.screen, 'projects');
    // junk numeric params are ignored rather than failing
    assert.equal((await get(svc, '/api/state?plan=abc&offset=-1&limit=x')).status, 200);
  });
});

test('/api/state: ?screen= sends the named heavy screen in full and only counts for the others', async () => {
  await withFixtures(async (svc) => {
    const seed = seedPlanRepo(svc);
    addBugs(svc.ctx.db, seed.id, 12);
    addTodos(svc.ctx.db, seed.id, 9);
    const before = q(svc.ctx.db, 'SELECT COUNT(*) n FROM event_log')[0].n; // the pull logs its own events
    addEvents(svc.ctx.db, 15, 80);
    const evTotal = before + 15;
    const full = {
      plan: (j) => Array.isArray(j.plan.phases),
      events: (j) => Array.isArray(j.events.rows),
      inbox: (j) => Array.isArray(j.inbox.files),
      bugs: (j) => Array.isArray(j.bugs.rows),
      todo: (j) => Array.isArray(j.todo.rows),
    };
    for (const screen of SCREENS) {
      const { json } = await state(svc, `?repo=${seed.id}&screen=${screen}`);
      assert.deepEqual(Object.keys(json), KEYS, screen);
      assert.equal(json.meta.screen, screen);
      assert.equal(json.meta.repoId, seed.id);
      assert.equal(json.meta.planId, seed.planId);
      for (const [name, isFull] of Object.entries(full)) {
        assert.equal(isFull(json), name === screen, `screen=${screen}: ${name} is ${name === screen ? 'full' : 'counts only'}`);
      }
      // the small screens are always whole
      assert.ok(Array.isArray(json.projects.repos) && Array.isArray(json.lanes) && Array.isArray(json.waiting.open) && Array.isArray(json.overview.waves ?? []));
      assert.ok(json.settings.values && Array.isArray(json.settings.agents));
    }
    const plan = (await state(svc, `?repo=${seed.id}&screen=plan`)).json.plan;
    assert.equal(plan.slug, 'orca-dashboard-wiring');
    assert.equal(plan.phases.length, 6);
    assert.ok(plan.phases.every((p) => Array.isArray(p.tasks)));
    assert.ok(plan.total > 0);
    // counts-only blocks still report the numbers
    const projects = (await state(svc, `?repo=${seed.id}`)).json;
    assert.equal(projects.plan.total, plan.total);
    assert.equal(projects.plan.phases, 6);
    assert.equal(projects.bugs.total, 12);
    assert.equal(projects.todo.open + projects.todo.done, 9);
    assert.equal(projects.events.count, evTotal);
    assert.equal(projects.inbox.imported, 1);
    const bugs = (await state(svc, `?repo=${seed.id}&screen=bugs`)).json.bugs;
    assert.equal(bugs.total, 12);
    assert.equal(bugs.rows.length, 12);
    assert.equal(bugs.hasMore, false);
    const todo = (await state(svc, `?repo=${seed.id}&screen=todo`)).json.todo;
    assert.equal(todo.rows.length, 9);
    const events = (await state(svc, `?repo=${seed.id}&screen=events`)).json.events;
    assert.equal(events.rows.length, evTotal);
    assert.ok(events.rows[0].id > events.rows[1].id, 'newest first');
    const inbox = (await state(svc, `?repo=${seed.id}&screen=inbox`)).json.inbox;
    assert.equal(inbox.files.length, 1);
    assert.equal(inbox.files[0].state, 'imported');
    assert.equal(inbox.files[0].planSlug, 'orca-dashboard-wiring');
  });
});

// ------------------------------------------------------------------------------------------------ 3. big tables

test('/api/state: thousands of rows never push a response over 64 KB, and the heavy slice is capped with a true total', async () => {
  await withFixtures(async (svc) => {
    const db = svc.ctx.db;
    const seed = seedPlanRepo(svc);
    addBugs(db, seed.id, 3000, 300);
    addTodos(db, seed.id, 3000, 300);
    const logged = q(db, 'SELECT COUNT(*) n FROM event_log')[0].n; // the pull logs its own events
    addEvents(db, 6000, 300);
    // 300 more repos, each with a plan
    const insRepo = db.prepare('INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at) VALUES(?,?,?,?,?)');
    const insPlan = db.prepare("INSERT INTO plan(slug, repo_id, title, status, created_at, updated_at) VALUES(?,?,?,'imported',?,?)");
    inTx(db, () => {
      for (let i = 0; i < 300; i++) {
        insRepo.run(`bulk-${i}`, `/tmp/mk-bulk/${'long-segment-'.repeat(8)}${i}`, `bulk repo ${i} ${'n'.repeat(120)}`, now(), now());
        insPlan.run(`bulk-plan-${i}`, `bulk-${i}`, `bulk plan ${i} ${'p'.repeat(200)}`, now(), now() + i);
      }
    });
    // 400 inbox files for the seed repo
    const insFile = db.prepare("INSERT INTO inbox_file(repo_id, path, name, title, sha, size, mtime, fit, missing, status, first_seen_at, status_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
    inTx(db, () => {
      for (let i = 0; i < 400; i++) {
        insFile.run(seed.id, `inbox/f${i}.md`, `f${i}.md`, `file ${i} ${'f'.repeat(300)}`, `sha${i}`, 100, now() - i, 'partial', JSON.stringify(Array.from({ length: 12 }, (_, k) => `missing block ${k} ${'m'.repeat(100)}`)), i % 2 ? 'new' : 'changed', now(), now());
      }
    });
    assert.equal(q(db, 'SELECT COUNT(*) n FROM bug')[0].n, 3000);
    assert.equal(q(db, 'SELECT COUNT(*) n FROM event_log')[0].n, logged + 6000);

    for (const scope of [`repo=${seed.id}&`, '']) {
      for (const screen of SCREENS) {
        const { json, bytes } = await state(svc, `?${scope}screen=${screen}`);
        assert.ok(bytes < LIMIT, `${scope}${screen}: ${bytes} bytes`);
        assert.deepEqual(Object.keys(json), KEYS);
        assert.ok(json.projects.repos.length <= 20, 'repo cards capped');
        assert.ok(json.projects.total >= 300, 'the true repo count is reported');
      }
    }

    const bugs = (await state(svc, `?repo=${seed.id}&screen=bugs`)).json.bugs;
    assert.ok(bugs.rows.length > 0 && bugs.rows.length <= 40, `bug rows ${bugs.rows.length}`);
    assert.equal(bugs.total, 3000);
    assert.equal(bugs.hasMore, true);
    const bigLimit = (await state(svc, `?repo=${seed.id}&screen=bugs&limit=100000`)).json.bugs;
    assert.ok(bigLimit.rows.length <= 40, 'a huge ?limit= is still capped');
    const page2 = (await state(svc, `?repo=${seed.id}&screen=bugs&offset=40`)).json.bugs;
    assert.equal(page2.offset, 40);
    assert.ok(page2.rows.length > 0 && page2.rows[0].id !== bugs.rows[0].id);
    assert.equal(new Set([...bugs.rows, ...page2.rows].map((r) => r.id)).size, bugs.rows.length + page2.rows.length, 'no row repeats across pages');
    const last = (await state(svc, `?repo=${seed.id}&screen=bugs&offset=2990`)).json.bugs;
    assert.equal(last.hasMore, false);

    const todo = (await state(svc, `?repo=${seed.id}&screen=todo`)).json.todo;
    assert.ok(todo.rows.length > 0 && todo.rows.length <= 40);
    assert.equal(todo.open + todo.done, 3000);
    assert.equal(todo.hasMore, true);

    const events = (await state(svc, `?repo=${seed.id}&screen=events`)).json.events;
    assert.ok(events.rows.length > 0 && events.rows.length <= 30);
    assert.equal(events.count, logged + 6000);
    assert.equal(events.hasMore, true);
    assert.equal(events.cursor, events.rows[0].id, 'cursor is the newest id');

    const inbox = (await state(svc, `?repo=${seed.id}&screen=inbox`)).json.inbox;
    assert.ok(inbox.files.length > 0 && inbox.files.length <= 30);
    assert.equal(inbox.new, 400);

    const plan = (await state(svc, `?repo=${seed.id}&screen=plan`)).json.plan;
    assert.ok(plan.phases.length > 0);

    // the same data through the worker-command path, which shares the builder
    assert.ok(Buffer.byteLength(JSON.stringify(svc.state({ repoId: seed.id, screen: 'bugs' }))) < LIMIT);
  });
});

// ------------------------------------------------------------------------------------------------ 4. events API

test('/api/events: newest first, ?before= pages with a next cursor until null, no id repeats; /api/event/<id> has the payload', async () => {
  await withService({}, async (svc) => {
    const db = svc.ctx.db;
    addEvents(db, 130, 20);
    // a row with a rich payload and no src
    db.prepare("INSERT INTO event_log(at, kind, repo_id, text, src, ref, payload) VALUES(?,?,?,?,?,?,?)")
      .run(1_800_000_000_000, 'gate', 'r1', 'gate waiting', null, 'ask:A1', JSON.stringify({ gate: 'merge', options: ['yes', 'no'], n: 3 }));
    const payloadId = q(db, 'SELECT MAX(id) m FROM event_log')[0].m;
    assert.equal(payloadId, 131);

    const first = await (await get(svc, '/api/events')).json();
    assert.equal(first.rows.length, 50, 'default page is 50');
    assert.equal(first.rows[0].id, 131);
    const ids = first.rows.map((r) => r.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'newest first');
    assert.equal(first.next, first.rows.at(-1).id);
    assert.equal(first.rows[0].payloadRef, 131);

    const seen = [];
    let cursor = null;
    let pages = 0;
    let url = '/api/events?limit=25';
    for (;;) {
      const page = await (await get(svc, url)).json();
      pages++;
      assert.ok(page.rows.length <= 25);
      for (const r of page.rows) {
        assert.ok(!seen.includes(r.id), `id ${r.id} repeated`);
        if (cursor !== null) assert.ok(r.id < cursor, 'strictly older than the previous page');
        seen.push(r.id);
      }
      if (page.next === null) break;
      assert.equal(page.next, page.rows.at(-1).id);
      cursor = page.next;
      url = `/api/events?before=${page.next}&limit=25`;
      assert.ok(pages < 20, 'paging terminates');
    }
    assert.equal(seen.length, 131, 'every event is reached exactly once');
    assert.equal(pages, 6);
    assert.deepEqual(seen, Array.from({ length: 131 }, (_, i) => 131 - i));

    // limit is clamped to 1..100; before past the oldest gives an empty page and next null
    assert.equal((await (await get(svc, '/api/events?limit=100000')).json()).rows.length, 100);
    assert.equal((await (await get(svc, '/api/events?limit=0')).json()).rows.length, 1, 'limit=0 is clamped up to 1');
    const none = await (await get(svc, '/api/events?before=1')).json();
    assert.deepEqual(none, { rows: [], next: null });

    const one = await get(svc, `/api/event/${payloadId}`);
    assert.equal(one.status, 200);
    const e = await one.json();
    assert.equal(e.id, payloadId);
    assert.equal(e.kind, 'gate');
    assert.equal(e.src, null);
    assert.equal(e.ref, 'ask:A1');
    assert.equal(e.repoId, 'r1');
    assert.deepEqual(e.payload, { gate: 'merge', options: ['yes', 'no'], n: 3 });
    const plain = await (await get(svc, '/api/event/2')).json();
    assert.deepEqual(plain.payload, { i: 1 });

    const missing = await get(svc, '/api/event/99999');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.kind, 'not_found');
    assert.equal((await get(svc, '/api/event/abc')).status, 404);
    assert.equal((await get(svc, '/api/event/')).status, 404);
    assert.equal((await get(svc, '/api/event/1/2')).status, 404);
  });
});

test('/api/events: an empty log pages cleanly', async () => {
  await withService({}, async (svc) => {
    assert.deepEqual(await (await get(svc, '/api/events')).json(), { rows: [], next: null });
    assert.equal((await get(svc, '/api/event/1')).status, 404);
    const { json } = await state(svc, '?screen=events');
    assert.deepEqual({ ...json.events }, { cursor: 0, count: 0, rows: [], hasMore: false });
  });
});

// ------------------------------------------------------------------------------------------------ 5. stale

test('stale: after a pull whose runner fails, errors name the source and the earlier good rows are still served', async () => {
  let fail = false;
  const base = fixtureRoutes();
  const routes = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, () => (fail ? { ok: false, error: { code: 'runtime_down', message: 'Orca runtime is not reachable' } } : v)]));
  await withService({ runner: stubRunner(routes) }, async (svc) => {
    await svc.sync.pullAll();
    const laneRepo = q(svc.ctx.db, 'SELECT repo_id FROM lane GROUP BY repo_id ORDER BY COUNT(*) DESC LIMIT 1')[0]?.repo_id;
    assert.ok(laneRepo, 'the good pull created lanes');
    const scope = `?repo=${laneRepo}`;
    const good = (await state(svc, scope)).json;
    assert.equal(good.meta.runtimeOk, true);
    assert.deepEqual(Object.keys(good.meta.errors).filter((k) => k !== 'git'), []);
    const goodRepos = good.projects.repos.map((r) => r.id);
    const goodLanes = good.lanes.map((l) => l.label);
    assert.ok(goodRepos.length >= 1 && goodLanes.length >= 1);
    assert.equal(typeof good.meta.stale.ps, 'number');

    fail = true;
    await svc.sync.pullAll();
    const bad = (await state(svc, scope)).json;
    assert.equal(bad.meta.runtimeOk, false, 'ps failed, so the runtime is not ok');
    for (const src of ['ps', 'repos', 'terminals']) assert.ok(Object.keys(bad.meta.errors).includes(src), `errors names ${src}: ${JSON.stringify(bad.meta.errors)}`);
    assert.match(String(bad.meta.errors.ps), /runtime|reachable|failed|down/i);
    // the data from the good pull is still there, not wiped
    assert.deepEqual(bad.projects.repos.map((r) => r.id), goodRepos);
    assert.deepEqual(bad.lanes.map((l) => l.label), goodLanes);
    assert.equal(bad.projects.total, good.projects.total);
    // last_ok_at is kept, so the age is still a number (it grows; it does not become null)
    assert.equal(typeof bad.meta.stale.ps, 'number');
    assert.equal(typeof bad.meta.stale.repos, 'number');

    // a thrown runner (the process cannot start) is handled the same way
    const thrower = stubRunner(Object.fromEntries(Object.keys(base).map((k) => [k, () => new Error('spawn orca ENOENT')])));
    svc.ctx.runner = thrower;
    await svc.sync.pullAll().catch(() => {});
    const thrown = (await state(svc, scope)).json;
    assert.equal(thrown.meta.runtimeOk, false);
    assert.deepEqual(thrown.projects.repos.map((r) => r.id), goodRepos);

    // and it recovers on the next good pull
    fail = false;
    svc.ctx.runner = stubRunner(routes);
    await svc.sync.pullAll();
    const back = (await state(svc, scope)).json;
    assert.equal(back.meta.runtimeOk, true);
    assert.equal(back.meta.errors.ps, undefined);
  });
});

test('stale: before any pull, nothing is ok and every age is null', async () => {
  await withService({ runner: stubRunner({}) }, async (svc) => {
    const { json } = await state(svc);
    assert.equal(json.meta.runtimeOk, false);
    for (const [k, v] of Object.entries(json.meta.stale)) assert.equal(v, null, `stale.${k}`);
    assert.deepEqual(json.projects.repos, []);
    assert.equal(json.meta.repoId, null);
    assert.deepEqual(json.lanes, []);
    // every screen still renders with no repo selected
    for (const screen of SCREENS) assert.equal((await get(svc, `/api/state?screen=${screen}`)).status, 200, screen);
  });
});

// ------------------------------------------------------------------------------------------------ 6. prompt leakage

test('no prompt text, assistant message, tool input or preview from the recorded fixtures reaches /api/state', async () => {
  const FORBIDDEN = ['prompt', 'lastAssistantMessage', 'toolInput', 'preview'];
  // collect the real string values the fixtures carry under those keys, so the test proves the data was there
  const values = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN.includes(k) && typeof x === 'string' && x.trim().length >= 12) values.add(x.trim());
        walk(x);
      }
    }
  };
  for (const name of Object.keys(fixtureRoutes()).map((k) => k)) void name;
  for (const f of ['worker-show', 'worker-show-failed', 'terminal-list', 'worktree-ps', 'worktree-list', 'worker-list', 'inbox']) walk(fx(f));
  assert.ok(values.size > 0, 'the fixtures do carry prompt-like fields');

  await withFixtures(async (svc) => {
    addEvents(svc.ctx.db, 5, 40);
    for (const screen of SCREENS) {
      const { text } = await state(svc, `?screen=${screen}`);
      for (const key of FORBIDDEN) assert.ok(!new RegExp(`"${key}"\\s*:`).test(text), `screen=${screen}: key "${key}" in /api/state`);
      for (const v of values) {
        // compare on a distinctive slice, as the text would be JSON-escaped in the response
        const slice = JSON.stringify(v.slice(0, 40)).slice(1, -1);
        assert.ok(!text.includes(slice), `screen=${screen}: fixture text leaked: ${v.slice(0, 40)}`);
      }
    }
    // not through the event API or the event_log either
    const events = await (await get(svc, '/api/events')).text();
    for (const key of FORBIDDEN) assert.ok(!events.includes(`"${key}"`));
    for (const row of q(svc.ctx.db, 'SELECT text, payload FROM event_log')) {
      for (const key of FORBIDDEN) assert.ok(!String(row.payload ?? '').includes(`"${key}"`), 'payload stored with a prompt-like key');
    }
  });
});
