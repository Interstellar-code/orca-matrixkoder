import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const json = (f) => JSON.parse(readFileSync(new URL(f, root), 'utf8'));
const manifest = json('orca-plugin.json');
const pkg = json('package.json');

test('the sidebar panel opens the launcher page, which exists', () => {
  const panels = manifest.contributes.panels;
  assert.equal(panels.length, 1);
  assert.equal(panels[0].entry, 'web/launcher.html');
  assert.ok(existsSync(new URL('web/launcher.html', root)));
});

test('the launcher tells the user how to open the dashboard and shows nothing live', () => {
  const html = readFileSync(new URL('web/launcher.html', root), 'utf8');
  assert.match(html, /MatrixKoder: Open Dashboard/);
  assert.match(html, /⌘J/);
  assert.match(html, /⌥⌘D/);
  assert.doesNotMatch(html, /supervisor active|stale|connection to local worker/i);
});

test('Open Dashboard is a global worker command with its own keybinding; the toggle stays', () => {
  const cmd = manifest.contributes.commands.find((c) => c.id === 'open-dashboard');
  assert.ok(cmd, 'command declared');
  assert.equal(cmd.title, 'MatrixKoder: Open Dashboard');
  assert.equal(cmd.context, 'global');
  assert.equal(cmd.action, undefined, 'a worker command, not a built-in alias');

  const keys = manifest.contributes.keybindings;
  const open = keys.find((k) => k.command === 'open-dashboard');
  assert.deepEqual(open, { command: 'open-dashboard', key: 'Mod+Alt+D', when: 'global' });
  assert.ok(keys.some((k) => k.command === 'toggle-dashboard' && k.key === 'Mod+Alt+M'));
  assert.equal(new Set(keys.map((k) => k.key)).size, keys.length, 'no duplicate keys');
  for (const k of keys) {
    const c = manifest.contributes.commands.find((x) => x.id === k.command);
    assert.ok(c, `${k.command} is contributed`);
    assert.equal(k.when, c.context ?? 'global', `${k.command}: when matches the command context`);
  }
});

test('a compiled command module backs open-dashboard', () => {
  assert.ok(existsSync(new URL('out/commands/open-dashboard.js', root)));
});

test('every version agrees: package, lockfile, manifest, marketplace ref', () => {
  const lock = json('package-lock.json');
  const market = json('orca-marketplace.json');
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(market.plugins[0].source.ref, `v${pkg.version}`);
  assert.equal(market.plugins[0].id, `${manifest.publisher}.${manifest.id}`);
});

test('the bug skill ships next to the manifest and names the shipped CLI', () => {
  const skill = readFileSync(new URL('skills/matrixkoder/SKILL.md', root), 'utf8');
  assert.match(skill, /^---\nname: matrixkoder\n/);
  for (const needle of ['mk bug add', 'mk bug fix', 'mk todo add', 'bin/mk.mjs', 'interstellar.matrixkoder']) assert.ok(skill.includes(needle), needle);
  assert.ok(existsSync(new URL('bin/mk.mjs', root)));
});
