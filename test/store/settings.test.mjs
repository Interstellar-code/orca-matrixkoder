import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import {
  defaultSettings, loadSettings, saveSettings, validateSettings, settingsPath, SettingsError,
} from '../../out/store/settings.js';
import { tmpDataDir } from './helpers.mjs';

test('defaults load when there is no file, and reading never creates one', () => {
  const dir = tmpDataDir('set');
  const s = loadSettings(dir);
  assert.deepEqual(s, defaultSettings());
  assert.equal(s.routing.maxLanes, 3);
  assert.equal(s.theme.rain.speed, 'normal');
  assert.equal(existsSync(settingsPath(dir)), false, 'no file after a read');
  assert.deepEqual(readdirSync(dir), []);
  assert.deepEqual(validateSettings(defaultSettings()), []);
});

test('the first save creates the file; a round trip returns what was saved', () => {
  const dir = tmpDataDir('set');
  const saved = saveSettings({ routing: { maxLanes: 5, tiers: { trivial: 'claude haiku low' } }, theme: { density: 'compact' } }, dir);
  assert.ok(existsSync(settingsPath(dir)));
  const onDisk = JSON.parse(readFileSync(settingsPath(dir), 'utf8'));
  assert.equal(onDisk.routing.maxLanes, 5);
  assert.equal(onDisk.theme.density, 'compact');
  assert.equal(onDisk.routing.useJev, true, 'untouched keys keep their defaults');
  assert.deepEqual(loadSettings(dir), saved);
  assert.deepEqual(readdirSync(dir), ['mk-settings.json'], 'no temp file left behind');
});

test('a bad value is rejected naming the key, and nothing is written', () => {
  const dir = tmpDataDir('set');
  const cases = [
    [{ routing: { maxLanes: 0 } }, 'routing.maxLanes'],
    [{ routing: { maxLanes: 2.5 } }, 'routing.maxLanes'],
    [{ routing: { spareClaudeBelowPct: 101 } }, 'routing.spareClaudeBelowPct'],
    [{ general: { mode: 'chaos' } }, 'general.mode'],
    [{ alerts: { quietHours: { from: '25:00' } } }, 'alerts.quietHours.from'],
    [{ safety: { askBeforePush: 'yes' } }, 'safety.askBeforePush'],
    [{ shortcuts: { footer: ['a', 'b', 'c', 'd', 'e'] } }, 'shortcuts.footer'],
    [{ agents: { claude: { effort: 'turbo' } } }, 'agents.claude.effort'],
    [{ general: 'nope' }, 'general'],
    [{ schema: 2 }, 'schema'],
  ];
  for (const [patch, key] of cases) {
    assert.throws(() => saveSettings(patch, dir), (e) => e instanceof SettingsError && e.issues.some((i) => i.key === key) && e.message.includes(key), key);
  }
  assert.equal(existsSync(settingsPath(dir)), false, 'a rejected save writes nothing');
});

test('unknown keys survive a save, at the top level and inside known groups', () => {
  const dir = tmpDataDir('set');
  writeFileSync(settingsPath(dir), JSON.stringify({ schema: 1, futureThing: { a: [1, 2] }, general: { mode: 'solo', extra: 'keep' } }));
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

test('a hand-edited bad value in the file is reported by key on load, and a save that fixes it works', () => {
  const dir = tmpDataDir('set');
  writeFileSync(settingsPath(dir), JSON.stringify({ schema: 1, routing: { maxLanes: 99 } }));
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
});
