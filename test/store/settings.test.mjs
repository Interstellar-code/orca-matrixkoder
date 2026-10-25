import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import {
  defaultSettings, describeSettings, loadSettings, saveSettings, validateSettings, settingsPath, setting,
  SettingsError, SETTINGS_SCHEMA, MODEL_SEED, mergeSettings,
} from '../../out/store/settings.js';
import { checkRoute } from '../../out/store/routes-check.js';
import { tmpDataDir } from './helpers.mjs';

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Dotted paths of every leaf (lists are leaves). */
function leaves(o, prefix = '') {
  return Object.entries(o).flatMap(([k, v]) => (isObj(v) ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

test('defaults load when there is no file, and reading never creates one', () => {
  const dir = tmpDataDir('set');
  const s = loadSettings(dir);
  assert.deepEqual(s, defaultSettings());
  assert.equal(SETTINGS_SCHEMA, 2);
  assert.equal(s.schema, 2);
  assert.equal(s.routing.maxLanes, 3);
  assert.equal(s.look.rain.speed, 'normal');
  assert.equal(existsSync(settingsPath(dir)), false, 'no file after a read');
  assert.deepEqual(readdirSync(dir), []);
  assert.deepEqual(validateSettings(defaultSettings()), []);
});

test('C1 defaults: exactly the contract keys with the contract values', () => {
  const d = defaultSettings();
  assert.deepEqual(d.general, { activeRepo: null, mode: 'orchestrator', openOnStart: 'last', undoSeconds: 10, snoozeMinutes: 60 });
  assert.deepEqual(d.data, { backupKeep: 7, goneDays: 30, decisionDays: 90, eventMax: 5000 });
  assert.deepEqual(d.sync, { fastSeconds: 10, slowSeconds: 60, filesSeconds: 30 });
  assert.deepEqual(d.routing, { bySize: { trivial: 'claude haiku low', standard: 'claude sonnet medium', complex: 'claude opus high' }, maxLanes: 3 });
  assert.deepEqual(d.quota, { floor: { claude: { sessionPct: 40, weeklyPct: 30 }, others: { sessionPct: 10, weeklyPct: 15 } }, onBelowFloor: 'block' });
  assert.deepEqual([d.lanes, d.bugs], [{ stallMinutes: 15 }, { defaultRisk: 3 }]);
  assert.deepEqual(d.plans, { inboxDir: '.matrixkoder/inbox', autoImport: false });
  assert.deepEqual(d.work.specTemplates, { investigate: '', implement: '', subdispatch: '', review: '', fix: '' });
  assert.equal(d.safety.confirmRiskAtLeast, 4);
  assert.deepEqual(d.safety.protectedBranches, ['main', 'release/*']);
  assert.equal(d.safety.neverRun.length, 5);
  assert.equal(d.safety.askBeforePush, true);
  assert.deepEqual(d.notify.events, { ask: true, laneDone: true, taskFailed: true, stall: false, quotaLow: false });
  assert.deepEqual(d.notify.quietHours, { enabled: false, from: '22:00', to: '07:00' });
  assert.equal(d.notify.wakeOrchestrator, false);
  assert.deepEqual(d.look, { rain: { enabled: true, brightness: 60, speed: 'normal' }, reduceMotion: 'os', textSize: 'M', density: 'comfy' });
  assert.deepEqual(Object.keys(d.agents), ['claude', 'codex', 'agy', 'opencode', 'omp']);
  for (const a of Object.values(d.agents)) assert.deepEqual([a.routable, a.model, a.effort], [true, '', '']);
  // no v1 key survives in the defaults
  for (const k of ['alerts', 'theme', 'shortcuts']) assert.equal(d[k], undefined, k);
  assert.equal(d.routing.useJev, undefined);
  // the description covers every default leaf, and only those (plus the display-only Orca rows)
  const described = Object.keys(describeSettings()).filter((k) => !k.startsWith('orca.')).sort();
  assert.deepEqual(described, leaves(d).filter((k) => k !== 'schema').sort());
});

test('model seed follows C9 and fits the 12-model cap', () => {
  assert.deepEqual(MODEL_SEED.claude.map((m) => m.id), ['haiku', 'sonnet', 'opus', 'fable']);
  assert.deepEqual(MODEL_SEED.claude[0].efforts, ['low', 'medium', 'high', 'max']);
  assert.deepEqual(MODEL_SEED.codex.map((m) => m.id), ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna']);
  assert.deepEqual(MODEL_SEED.codex[0].efforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.deepEqual(MODEL_SEED.codex[2].efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(MODEL_SEED.agy.length, 12);
  assert.ok(MODEL_SEED.agy.every((m) => m.efforts.length === 0), 'agy encodes the effort in the id');
  assert.ok(MODEL_SEED.agy.some((m) => m.id === 'claude-opus-5-5-high') && MODEL_SEED.agy.some((m) => m.id === 'gpt-oss-120b-medium'));
  assert.deepEqual([MODEL_SEED.opencode, MODEL_SEED.omp], [[], []]);
  assert.deepEqual(defaultSettings().agents.codex.models, MODEL_SEED.codex);
});

test('the first save creates the file; a round trip returns what was saved', () => {
  const dir = tmpDataDir('set');
  const saved = saveSettings({ routing: { maxLanes: 5, bySize: { trivial: 'codex gpt-6-luna low' } }, look: { density: 'compact' } }, dir);
  assert.ok(existsSync(settingsPath(dir)));
  const onDisk = JSON.parse(readFileSync(settingsPath(dir), 'utf8'));
  assert.equal(onDisk.schema, 2);
  assert.equal(onDisk.routing.maxLanes, 5);
  assert.equal(onDisk.look.density, 'compact');
  assert.equal(onDisk.routing.bySize.standard, 'claude sonnet medium', 'untouched keys keep their defaults');
  assert.deepEqual(loadSettings(dir), saved);
  assert.deepEqual(readdirSync(dir), ['mk-settings.json'], 'no temp file left behind');
});

test('every key rejects a wrong value, naming the key, and nothing is written', () => {
  const dir = tmpDataDir('set');
  const cases = [
    [{ general: { activeRepo: 5 } }, 'general.activeRepo'],
    [{ general: { mode: 'chaos' } }, 'general.mode'],
    [{ general: { openOnStart: 'Projects' } }, 'general.openOnStart'],
    [{ general: { undoSeconds: 61 } }, 'general.undoSeconds'],
    [{ general: { undoSeconds: -1 } }, 'general.undoSeconds'],
    [{ general: { snoozeMinutes: 0 } }, 'general.snoozeMinutes'],
    [{ data: { backupKeep: 31 } }, 'data.backupKeep'],
    [{ data: { goneDays: 6 } }, 'data.goneDays'],
    [{ data: { decisionDays: 366 } }, 'data.decisionDays'],
    [{ data: { eventMax: 499 } }, 'data.eventMax'],
    [{ sync: { fastSeconds: 4 } }, 'sync.fastSeconds'],
    [{ sync: { slowSeconds: 901 } }, 'sync.slowSeconds'],
    [{ sync: { filesSeconds: 9 } }, 'sync.filesSeconds'],
    [{ agents: { claude: { routable: 'yes' } } }, 'agents.claude.routable'],
    [{ agents: { claude: { model: 'gpt-9' } } }, 'agents.claude.model'],
    [{ agents: { claude: { effort: 'turbo' } } }, 'agents.claude.effort'],
    [{ agents: { claude: { model: 'haiku', effort: 'ultra' } } }, 'agents.claude.effort'],
    [{ agents: { claude: { models: Array.from({ length: 13 }, (_, i) => ({ id: `m${i}`, efforts: [], note: '' })) } } }, 'agents.claude.models'],
    [{ agents: { claude: { models: [{ id: 'x', efforts: ['sideways'], note: '' }] } } }, 'agents.claude.models'],
    [{ agents: { claude: { models: [{ id: '', efforts: [], note: '' }] } } }, 'agents.claude.models'],
    [{ routing: { bySize: { trivial: 'nobody haiku low' } } }, 'routing.bySize.trivial'],
    [{ routing: { bySize: { standard: '' } } }, 'routing.bySize.standard'],
    [{ routing: { bySize: { complex: 'claude opus high extra' } } }, 'routing.bySize.complex'],
    [{ routing: { bySize: { complex: `claude ${'x'.repeat(130)}` } } }, 'routing.bySize.complex'],
    [{ routing: { maxLanes: 0 } }, 'routing.maxLanes'],
    [{ routing: { maxLanes: 13 } }, 'routing.maxLanes'],
    [{ routing: { maxLanes: 2.5 } }, 'routing.maxLanes'],
    [{ quota: { floor: { claude: { sessionPct: 101 } } } }, 'quota.floor.claude.sessionPct'],
    [{ quota: { floor: { claude: { weeklyPct: -1 } } } }, 'quota.floor.claude.weeklyPct'],
    [{ quota: { floor: { others: { sessionPct: 'x' } } } }, 'quota.floor.others.sessionPct'],
    [{ quota: { floor: { others: { weeklyPct: 100.5 } } } }, 'quota.floor.others.weeklyPct'],
    [{ quota: { onBelowFloor: 'panic' } }, 'quota.onBelowFloor'],
    [{ lanes: { stallMinutes: 4 } }, 'lanes.stallMinutes'],
    [{ bugs: { defaultRisk: 6 } }, 'bugs.defaultRisk'],
    [{ plans: { inboxDir: '/abs' } }, 'plans.inboxDir'],
    [{ plans: { inboxDir: '~/inbox' } }, 'plans.inboxDir'],
    [{ plans: { inboxDir: 'a/../b' } }, 'plans.inboxDir'],
    [{ plans: { inboxDir: '' } }, 'plans.inboxDir'],
    [{ plans: { autoImport: 1 } }, 'plans.autoImport'],
    [{ work: { specTemplates: { review: '/etc/passwd' } } }, 'work.specTemplates.review'],
    [{ work: { specTemplates: { fix: '../x.md' } } }, 'work.specTemplates.fix'],
    [{ work: { specTemplates: { fix: '~/.matrixkoder/templates/../x.md' } } }, 'work.specTemplates.fix'],
    [{ work: { specTemplates: { fix: '~/other/x.md' } } }, 'work.specTemplates.fix'],
    [{ work: { specTemplates: { implement: 'x'.repeat(401) } } }, 'work.specTemplates.implement'],
    [{ safety: { confirmRiskAtLeast: 0 } }, 'safety.confirmRiskAtLeast'],
    [{ safety: { confirmRiskAtLeast: 7 } }, 'safety.confirmRiskAtLeast'],
    [{ safety: { protectedBranches: Array.from({ length: 21 }, (_, i) => `b${i}`) } }, 'safety.protectedBranches'],
    [{ safety: { protectedBranches: ['x'.repeat(101)] } }, 'safety.protectedBranches'],
    [{ safety: { neverRun: Array.from({ length: 41 }, (_, i) => `c${i}`) } }, 'safety.neverRun'],
    [{ safety: { neverRun: ['x'.repeat(201)] } }, 'safety.neverRun'],
    [{ safety: { askBeforePush: 'yes' } }, 'safety.askBeforePush'],
    [{ notify: { events: { quotaLow: 'on' } } }, 'notify.events.quotaLow'],
    [{ notify: { events: { taskFailed: 0 } } }, 'notify.events.taskFailed'],
    [{ notify: { quietHours: { from: '25:00' } } }, 'notify.quietHours.from'],
    [{ notify: { quietHours: { to: '7am' } } }, 'notify.quietHours.to'],
    [{ notify: { wakeOrchestrator: 'x' } }, 'notify.wakeOrchestrator'],
    [{ look: { rain: { brightness: 101 } } }, 'look.rain.brightness'],
    [{ look: { rain: { speed: 'warp' } } }, 'look.rain.speed'],
    [{ look: { rain: { enabled: 'no' } } }, 'look.rain.enabled'],
    [{ look: { reduceMotion: true } }, 'look.reduceMotion'],
    [{ look: { textSize: 'XL' } }, 'look.textSize'],
    [{ look: { density: 'huge' } }, 'look.density'],
    [{ general: 'nope' }, 'general'],
    [{ schema: 1 }, 'schema'],
  ];
  for (const [patch, key] of cases) {
    assert.throws(() => saveSettings(patch, dir), (e) => e instanceof SettingsError && e.issues.some((i) => i.key === key) && e.message.includes(key), `${key} ${JSON.stringify(patch).slice(0, 80)}`);
  }
  assert.equal(existsSync(settingsPath(dir)), false, 'a rejected save writes nothing');
});

test('values on the edge of every range are accepted', () => {
  const s = mergeSettings(defaultSettings(), {
    general: { undoSeconds: 0, snoozeMinutes: 1440, openOnStart: 'waiting' },
    data: { backupKeep: 30, goneDays: 7, decisionDays: 365, eventMax: 500 },
    sync: { fastSeconds: 5, slowSeconds: 900, filesSeconds: 10 },
    quota: { floor: { claude: { sessionPct: 0, weeklyPct: 100 } }, onBelowFloor: 'off' },
    lanes: { stallMinutes: 120 }, bugs: { defaultRisk: 1 }, safety: { confirmRiskAtLeast: 6 },
    work: { specTemplates: { review: 'docs/review.md', fix: '~/.matrixkoder/templates/fix.md' } },
    routing: { maxLanes: 12 },
  });
  assert.deepEqual(validateSettings(s), []);
});

test('agent model and effort follow the agent models list', () => {
  const dir = tmpDataDir('set');
  const ok = saveSettings({ agents: { claude: { model: 'opus', effort: 'max' }, codex: { model: 'gpt-6-luna', effort: 'xhigh' }, agy: { model: 'gemini-3.1-pro-high', effort: '' } } }, dir);
  assert.equal(ok.agents.claude.model, 'opus');
  // an empty models list accepts any model; the user can also add their own
  const free = saveSettings({ agents: { opencode: { model: 'glm-5', effort: '' } } }, dir);
  assert.equal(free.agents.opencode.model, 'glm-5');
  const own = saveSettings({ agents: { omp: { models: [{ id: 'mine', efforts: ['low'], note: 'x' }], model: 'mine', effort: 'low' } } }, dir);
  assert.deepEqual(own.agents.omp.models, [{ id: 'mine', efforts: ['low'], note: 'x' }]);
  assert.throws(() => saveSettings({ agents: { omp: { effort: 'high' } } }, dir), /agents\.omp\.effort/);
  assert.throws(() => saveSettings({ agents: { codex: { model: 'gpt-6-luna', effort: 'ultra' } } }, dir), /agents\.codex\.effort/);
});

test('unknown keys survive a save, at the top level and inside known groups', () => {
  const dir = tmpDataDir('set');
  writeFileSync(settingsPath(dir), JSON.stringify({ schema: 2, futureThing: { a: [1, 2] }, general: { mode: 'solo', extra: 'keep' } }));
  const loaded = loadSettings(dir);
  assert.equal(loaded.general.mode, 'solo');
  assert.deepEqual(loaded.futureThing, { a: [1, 2] });
  saveSettings({ routing: { maxLanes: 4 } }, dir);
  const onDisk = JSON.parse(readFileSync(settingsPath(dir), 'utf8'));
  assert.deepEqual(onDisk.futureThing, { a: [1, 2] });
  assert.equal(onDisk.general.extra, 'keep');
  assert.equal(onDisk.general.mode, 'solo');
  assert.equal(onDisk.routing.maxLanes, 4);
});

test('a hand-edited bad value in a schema 2 file is reported by key on load, and a save that fixes it works', () => {
  const dir = tmpDataDir('set');
  writeFileSync(settingsPath(dir), JSON.stringify({ schema: 2, routing: { maxLanes: 99 } }));
  assert.throws(() => loadSettings(dir), /routing\.maxLanes/);
  saveSettings({ routing: { maxLanes: 3 } }, dir);
  assert.equal(loadSettings(dir).routing.maxLanes, 3);
  writeFileSync(settingsPath(dir), '{ not json');
  assert.throws(() => loadSettings(dir), /not valid JSON/);
});

test('agents can be added; arrays replace rather than merge', () => {
  const dir = tmpDataDir('set');
  const s = saveSettings({ agents: { gemini: { routable: false, model: 'x', effort: 'low' } }, safety: { protectedBranches: ['trunk'] } }, dir);
  assert.equal(s.agents.gemini.routable, false);
  assert.ok(s.agents.claude, 'default agents stay');
  assert.deepEqual(s.safety.protectedBranches, ['trunk']);
  assert.ok(describeSettings(s)['agents.gemini.routable'], 'the description lists an added agent');
  // a saved models list is the user\'s: it is not merged with the seed
  const trimmed = saveSettings({ agents: { claude: { models: [{ id: 'sonnet', efforts: ['low'], note: '' }], model: '', effort: '' } } }, dir);
  assert.deepEqual(trimmed.agents.claude.models.map((m) => m.id), ['sonnet']);
});

test('setting() reads nested paths and falls back to the default for a missing one', () => {
  const s = mergeSettings(defaultSettings(), { routing: { maxLanes: 7 }, look: { rain: { speed: 'fast' } } });
  assert.equal(setting(s, 'routing.maxLanes'), 7);
  assert.equal(setting(s, 'look.rain.speed'), 'fast');
  assert.equal(setting(s, 'notify.quietHours.from'), '22:00');
  assert.equal(setting(s, 'general.activeRepo'), null);
  assert.deepEqual(setting(s, 'safety.protectedBranches'), ['main', 'release/*']);
  assert.equal(setting({}, 'routing.maxLanes'), 3, 'an empty object reads the defaults');
  assert.equal(setting({ routing: {} }, 'routing.bySize.complex'), 'claude opus high');
});

test('describeSettings: C3 shape, owners, enforced labels, Orca rows, and a payload well under 64 KB', () => {
  const d = describeSettings();
  assert.deepEqual(d['routing.maxLanes'], { type: 'int', default: 3, min: 1, max: 12, options: null, owner: 'mk', enforced: null });
  assert.deepEqual(d['quota.onBelowFloor'].options, ['off', 'warn', 'block']);
  assert.deepEqual(d['look.reduceMotion'].options, ['os', 'on', 'off']);
  assert.deepEqual(d['agents.claude.effort'].options, ['', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.deepEqual(d['agents.claude.model'].options, ['haiku', 'sonnet', 'opus', 'fable']);
  assert.deepEqual(d['agents.opencode.model'].options, []);
  assert.equal(d['safety.confirmRiskAtLeast'].enforced, 'mk');
  for (const k of ['safety.protectedBranches', 'safety.neverRun', 'safety.askBeforePush']) assert.equal(d[k].enforced, 'advisory', k);
  assert.equal(d['safety.protectedBranches'].max, 20);
  assert.equal(d['plans.inboxDir'].type, 'path');
  assert.equal(d['look.rain.enabled'].enforced, null);
  for (const [k, v] of Object.entries(d)) {
    assert.deepEqual(Object.keys(v).filter((x) => !['label', 'orcaPane'].includes(x)).sort(), ['default', 'enforced', 'max', 'min', 'options', 'owner', 'type'], k);
    assert.ok(v.owner === 'mk' || v.owner === 'orca', k);
  }
  const orca = Object.entries(d).filter(([, v]) => v.owner === 'orca');
  assert.equal(orca.length, 5);
  assert.deepEqual(orca.map(([, v]) => v.orcaPane).sort(), ['Settings > Agents', 'Settings > Agents', 'Settings > Appearance', 'Settings > Keyboard', 'Settings > Notifications']);
  const payload = JSON.stringify({ values: defaultSettings(), schema: d, migrationNotes: [] });
  assert.ok(Buffer.byteLength(payload) < 64 * 1024, `${Buffer.byteLength(payload)} bytes`);
});

test('checkRoute: C9 rules', () => {
  const s = defaultSettings();
  const bad = (route, re) => { const r = checkRoute(route, s); assert.equal(r.ok, false, route); assert.match(r.issue, re, route); };
  assert.deepEqual(checkRoute('', s), { ok: true });
  assert.deepEqual(checkRoute('   ', s), { ok: true });
  assert.deepEqual(checkRoute('claude', s), { ok: true });
  assert.deepEqual(checkRoute('claude sonnet medium', s), { ok: true });
  assert.deepEqual(checkRoute('agy gemini-3.1-pro-high', s), { ok: true });
  assert.deepEqual(checkRoute('opencode anything-goes', s), { ok: true }, 'an empty models list accepts any model');
  assert.deepEqual(checkRoute({ agent: 'codex', model: 'gpt-6.1-sol', effort: 'ultra' }, s), { ok: true });
  bad('nobody x', /unknown agent/);
  bad('claude gpt-6 low', /model/);
  bad('claude haiku ultra', /effort/);
  bad('claude haiku turbo', /effort/);
  bad('agy gemini-3.1-pro-high high', /takes no effort/);
  bad('omp some-model low', /does not support an effort/);
  bad('opencode some-model low', /does not support an effort/);
  bad({ agent: 'claude', effort: 'high' }, /--effort requires --model/);
  bad('claude haiku low extra', /too many words/);
  const off = mergeSettings(s, { agents: { codex: { routable: false } } });
  const r = checkRoute('codex gpt-6.1-sol high', off);
  assert.equal(r.ok, false);
  assert.match(r.issue, /not routable/);
});
