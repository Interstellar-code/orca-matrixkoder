import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultSettings, loadSettings, loadSettingsDetailed, saveSettings, validateSettings, settingsPath, SETTINGS_SCHEMA,
} from '../../out/store/settings.js';
import { V1_DEFAULTS, migrateV1, droppedV1Key } from '../../out/store/settings-migrate.js';
import { tmpDataDir } from './helpers.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'settings');
/** A data dir holding one of the v1 fixtures as mk-settings.json. */
function dirWith(name) {
  const dir = tmpDataDir('mig');
  copyFileSync(join(FIX, name), settingsPath(dir));
  return dir;
}

test('V1_DEFAULTS holds the schema 1 defaults and defaultSettings() is schema 2 only', () => {
  assert.equal(V1_DEFAULTS.schema, 1);
  assert.equal(V1_DEFAULTS.routing.useJev, true);
  assert.equal(V1_DEFAULTS.alerts.stallMinutes, 10);
  assert.equal(defaultSettings().schema, SETTINGS_SCHEMA);
  assert.equal(defaultSettings().alerts, undefined);
});

test('T2: a v1 file with every key changed migrates per C2 without throwing', () => {
  const dir = dirWith('v1-all-changed.json');
  const { settings: s, migrationNotes: notes } = loadSettingsDetailed(dir);
  assert.deepEqual(validateSettings(s), []);
  assert.equal(s.schema, 2);
  // kept
  assert.deepEqual(s.general, { activeRepo: 'repo-1', mode: 'solo', openOnStart: 'projects', undoSeconds: 10, snoozeMinutes: 60, extra: 'keep' });
  assert.equal(s.routing.maxLanes, 5);
  assert.deepEqual(s.routing.bySize, { trivial: 'codex gpt-6-luna low', standard: 'agy gemini-3.1-pro-high', complex: 'claude opus max' });
  assert.deepEqual([s.agents.claude.routable, s.agents.claude.model, s.agents.claude.effort], [false, 'opus', 'max']);
  assert.deepEqual([s.agents.codex.model, s.agents.codex.effort], ['gpt-6.1-sol', 'xhigh']);
  assert.deepEqual([s.agents.opencode.model, s.agents.opencode.effort], ['glm-5', ''], 'effort "" differs from the v1 default "medium", so it is carried');
  assert.deepEqual(s.agents.gemini, { routable: false, model: 'g-1', effort: 'low' }, 'an agent v2 does not seed is kept');
  assert.deepEqual(s.safety.protectedBranches, ['trunk']);
  assert.equal(s.safety.askBeforePush, false);
  assert.equal(s.safety.confirmRiskAtLeast, 6, 'askBeforeDestructive false -> never ask');
  assert.equal(s.safety.neverRun.length, 40, 'the 50-item list is cut to the v2 cap');
  assert.deepEqual(s.safety.neverRun.slice(0, 2), ['cmd 0', 'cmd 1']);
  assert.equal(s.quota.floor.claude.weeklyPct, 55);
  // renamed
  assert.deepEqual(s.notify.events, { ask: false, laneDone: false, taskFailed: false, stall: true, quotaLow: false });
  assert.deepEqual(s.notify.quietHours, { enabled: true, from: '23:00', to: '06:30' });
  assert.equal(s.notify.wakeOrchestrator, true);
  assert.deepEqual(s.look, { rain: { enabled: false, brightness: 20, speed: 'fast' }, reduceMotion: 'on', textSize: 'L', density: 'compact' });
  // clamped
  assert.equal(s.lanes.stallMinutes, 5, 'stall 3 -> clamped to the v2 minimum');
  assert.equal(s.sync.slowSeconds, 900, '200 min x 60 -> clamped to the v2 maximum');
  // fell back
  assert.equal(s.agents.agy.model, '', 'a model that is not in the seeded list falls back to the default');
  assert.equal(s.agents.agy.effort, 'low');
  // dropped keys are gone, unknown keys stay
  for (const k of ['alerts', 'theme', 'shortcuts']) assert.equal(s[k], undefined, k);
  assert.equal(s.routing.useJev, undefined);
  assert.equal(s.routing.tiers, undefined);
  assert.equal(s.safety.blockDestructiveGit, undefined);
  assert.deepEqual(s.futureThing, { a: [1, 2] });
  // notes list each clamp and fallback
  const has = (re) => assert.ok(notes.some((n) => re.test(n)), `${re} in ${JSON.stringify(notes)}`);
  has(/agents\.agy\.model/);
  has(/lanes\.stallMinutes.*clamped to 5/);
  has(/sync\.slowSeconds.*clamped to 900/);
  has(/safety\.neverRun.*10 of 50/);
});

test('T2: values a user never changed from the v1 defaults are not carried', () => {
  assert.deepEqual(migrateV1(structuredClone(V1_DEFAULTS)).settings, { schema: 2 });
  assert.deepEqual(migrateV1(structuredClone(V1_DEFAULTS)).notes, []);
  const dir = dirWith('v1-minimal.json');
  const { settings: s, migrationNotes } = loadSettingsDetailed(dir);
  assert.deepEqual(s, defaultSettings(), 'the v2 defaults win: openOnStart last, stall 15 minutes');
  assert.deepEqual(migrationNotes, []);
  assert.equal(s.general.openOnStart, 'last');
  assert.equal(s.lanes.stallMinutes, 15);
  assert.equal(s.agents.claude.model, '', 'the v1 default "sonnet 5.5" is not carried');
});

test('T2: gateFail false lands on taskFailed, openOnStart is lower-cased, reduceMotion false means os', () => {
  const v1 = structuredClone(V1_DEFAULTS);
  v1.alerts.events.gateFail = false;
  v1.alerts.events.runDone = false;
  v1.general.openOnStart = 'Waiting';
  v1.theme.reduceMotion = false; // equals the v1 default: nothing to carry
  const m = migrateV1(v1);
  assert.deepEqual(m.settings, { schema: 2, notify: { events: { taskFailed: false } }, general: { openOnStart: 'waiting' } });
  v1.theme.reduceMotion = true;
  assert.equal(migrateV1(v1).settings.look.reduceMotion, 'on');
});

test('T2: bad v1 values never throw; each falls back to its default and is listed in the notes', () => {
  const dir = dirWith('v1-bad-values.json');
  const { settings: s, migrationNotes: notes } = loadSettingsDetailed(dir);
  assert.deepEqual(validateSettings(s), []);
  const d = defaultSettings();
  assert.equal(s.general.mode, d.general.mode);
  assert.equal(s.general.openOnStart, d.general.openOnStart);
  assert.equal(s.general.activeRepo, null);
  assert.equal(s.routing.maxLanes, 12, 'a number out of range is clamped');
  assert.deepEqual(s.routing.bySize, d.routing.bySize, 'a route naming an unknown agent, and a non-string route, fall back');
  assert.equal(s.agents.claude.routable, true);
  assert.equal(s.agents.claude.model, '');
  assert.equal(s.agents.claude.effort, '');
  assert.deepEqual(s.safety.protectedBranches, d.safety.protectedBranches);
  assert.equal(s.safety.askBeforePush, true);
  assert.equal(s.safety.confirmRiskAtLeast, 4);
  assert.equal(s.notify.events.ask, true);
  assert.deepEqual(s.notify.quietHours, { enabled: true, from: '22:00', to: '07:00' }, 'enabled is valid and carried; the two bad times fall back');
  assert.equal(s.lanes.stallMinutes, 5);
  assert.equal(s.sync.slowSeconds, 60);
  assert.deepEqual(s.look, { ...d.look, rain: { ...d.look.rain, brightness: 100 } });
  assert.ok(notes.length >= 12, `${notes.length} notes`);
  for (const key of ['general.mode', 'general.openOnStart', 'general.activeRepo', 'routing.maxLanes', 'routing.bySize.trivial', 'routing.bySize.standard',
    'agents.claude.routable', 'agents.claude.model', 'agents.claude.effort', 'safety.protectedBranches', 'safety.askBeforePush',
    'quota.floor.claude.weeklyPct', 'notify.events.ask', 'look.textSize', 'look.density', 'look.reduceMotion']) {
    assert.ok(notes.some((n) => n.includes(key)), `a note names ${key}`);
  }
});

test('T2: loading a v1 file writes nothing', () => {
  const dir = dirWith('v1-all-changed.json');
  const before = readFileSync(settingsPath(dir));
  loadSettings(dir);
  loadSettings(dir);
  loadSettingsDetailed(dir);
  assert.ok(readFileSync(settingsPath(dir)).equals(before), 'the v1 file is untouched');
  assert.deepEqual(readdirSync(dir), ['mk-settings.json'], 'no backup, temp or v2 file after a read');
});

test('T2: the first save copies the v1 file to mk-settings.v1.bak.json, then writes v2 atomically', () => {
  const dir = dirWith('v1-all-changed.json');
  const original = readFileSync(settingsPath(dir));
  const saved = saveSettings({ look: { density: 'comfy' } }, dir);
  assert.deepEqual(readdirSync(dir).sort(), ['mk-settings.json', 'mk-settings.v1.bak.json']);
  assert.ok(readFileSync(join(dir, 'mk-settings.v1.bak.json')).equals(original), 'the backup is the v1 file byte for byte');
  const onDisk = JSON.parse(readFileSync(settingsPath(dir), 'utf8'));
  assert.equal(onDisk.schema, 2);
  assert.equal(onDisk.routing.maxLanes, 5, 'migrated values are written');
  assert.equal(onDisk.look.density, 'comfy', 'the patch is applied');
  assert.equal(onDisk.alerts, undefined);
  assert.deepEqual(onDisk.futureThing, { a: [1, 2] });
  assert.deepEqual(loadSettings(dir), saved);
  // the file is v2 now: no migration notes and no second backup
  assert.deepEqual(loadSettingsDetailed(dir).migrationNotes, []);
  saveSettings({ look: { density: 'compact' } }, dir);
  assert.deepEqual(readdirSync(dir).sort(), ['mk-settings.json', 'mk-settings.v1.bak.json']);
  assert.ok(readFileSync(join(dir, 'mk-settings.v1.bak.json')).equals(original), 'the backup is not overwritten');
});

test('T2: a rejected first save leaves the v1 file and writes no backup', () => {
  const dir = dirWith('v1-all-changed.json');
  const original = readFileSync(settingsPath(dir));
  assert.throws(() => saveSettings({ routing: { maxLanes: 99 } }, dir), /routing\.maxLanes/);
  assert.ok(readFileSync(settingsPath(dir)).equals(original));
  assert.deepEqual(readdirSync(dir), ['mk-settings.json']);
});

test('T2: a missing file is defaults (A1) and a schema 2 file is not migrated', () => {
  const dir = tmpDataDir('mig');
  assert.deepEqual(loadSettingsDetailed(dir), { settings: defaultSettings(), migrationNotes: [] });
  writeFileSync(settingsPath(dir), JSON.stringify({ schema: 2, routing: { maxLanes: 8 }, theme: { density: 'x' } }));
  const { settings, migrationNotes } = loadSettingsDetailed(dir);
  assert.equal(settings.routing.maxLanes, 8);
  assert.deepEqual(settings.theme, { density: 'x' }, 'an unknown key in a v2 file is kept untouched');
  assert.deepEqual(migrationNotes, []);
});

test('droppedV1Key finds a v1-only key anywhere in a patch', () => {
  assert.equal(droppedV1Key({ routing: { maxLanes: 4 } }), null);
  assert.equal(droppedV1Key({ routing: { bySize: { trivial: 'claude haiku low' } }, safety: { askBeforePush: true } }), null);
  assert.equal(droppedV1Key({ routing: { useJev: false } }), 'routing.useJev');
  assert.equal(droppedV1Key({ routing: { tiers: { trivial: 'x' } } }), 'routing.tiers');
  assert.equal(droppedV1Key({ safety: { blockDestructiveGit: true } }), 'safety.blockDestructiveGit');
  assert.equal(droppedV1Key({ alerts: { events: { gateFail: true } } }), 'alerts');
  assert.equal(droppedV1Key({ theme: { density: 'compact' } }), 'theme');
  assert.equal(droppedV1Key({ shortcuts: { footer: [] } }), 'shortcuts');
  assert.equal(droppedV1Key({ routing: { spareClaudeBelowPct: 5 } }), 'routing.spareClaudeBelowPct');
  assert.equal(droppedV1Key({ routing: { askBeforeDestructive: false } }), 'routing.askBeforeDestructive');
  assert.equal(existsSync(settingsPath(tmpDataDir('mig'))), false);
});
