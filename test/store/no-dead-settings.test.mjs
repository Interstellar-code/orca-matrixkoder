// T8 — dead-key check. Every C1 key must be read by something: the server through setting(), or the panel.
// (a) Server half: a loader hook wraps setting() in out/store/settings.js so each path it is asked for is logged;
//     the T4-T7 and T11 suites run as child processes with that hook and the log is checked against C1.
// (b) Panel half: look.*, general.openOnStart and general.activeRepo appear in a literal bind('<key>') or a look. prefix read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { defaultSettings } from '../../out/store/settings.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SUITES = ['routes', 'notify', 'safety', 'consumers', 'spec-templates'].map((n) => `test/server/${n}.test.mjs`);

/** C1 leaf paths from the defaults. Lists are leaves; the families read by computed path collapse to one entry each. */
const FAMILIES = [
  { name: 'agents.<id>.routable', re: /^agents\.[^.]+\.routable$/, prefix: 'agents.' },
  { name: 'agents.<id>.models', re: /^agents\.[^.]+\.models$/, prefix: 'agents.' },
  { name: 'agents.<id>.model', re: /^agents\.[^.]+\.model$/, prefix: 'agents.' },
  { name: 'agents.<id>.effort', re: /^agents\.[^.]+\.effort$/, prefix: 'agents.' },
  { name: 'routing.bySize.*', re: /^routing\.bySize\./, prefix: 'routing.bySize.' },
  { name: 'quota.floor.*', re: /^quota\.floor\./, prefix: 'quota.floor.' },
  { name: 'notify.events.*', re: /^notify\.events\./, prefix: 'notify.events.' },
  { name: 'work.specTemplates.*', re: /^work\.specTemplates\./, prefix: 'work.specTemplates.' },
];
const PANEL_READ = (k) => k.startsWith('look.') || k === 'general.openOnStart' || k === 'general.activeRepo';

function leaves(obj, base = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = base ? `${base}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...leaves(v, p));
    else out.push(p);
  }
  return out;
}

function walk(dir, ok, acc = []) {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, ok, acc);
    else if (ok(n)) acc.push(f);
  }
  return acc;
}
const text = (files) => files.map((f) => readFileSync(f, 'utf8')).join('\n');

const C1 = leaves(defaultSettings()).filter((k) => k !== 'schema');

test('T8a: every C1 key the server owns is read through setting() by the T4-T7 and T11 suites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mk-deadkey-'));
  const log = join(dir, 'setting.log');
  writeFileSync(log, '');
  const hooks = join(dir, 'hooks.mjs');
  writeFileSync(hooks, `
export async function load(url, context, next) {
  const r = await next(url, context);
  if (!url.endsWith('/out/store/settings.js')) return r;
  const orig = String(r.source);
  const src = orig.replace('export function setting(', 'function __mkSetting(');
  if (src === orig) throw new Error('setting() export not found in out/store/settings.js');
  return { ...r, source: src + '\\nimport { appendFileSync as __mkAppend } from "node:fs";\\n'
    + 'export function setting(s, p) { if (process.env.MK_SETTING_LOG) __mkAppend(process.env.MK_SETTING_LOG, p + "\\\\n"); return __mkSetting(s, p); }\\n' };
}
`);
  const pre = join(dir, 'preload.mjs');
  writeFileSync(pre, `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`);
  const env = { ...process.env, MK_SETTING_LOG: log, NODE_OPTIONS: `--import ${pathToFileURL(pre).href}` };
  delete env.NODE_TEST_CONTEXT; // else the child reports to this runner instead of running its suites
  const res = spawnSync(process.execPath, ['--test', ...SUITES], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
  assert.equal(res.status, 0, `the suites must pass under the recorder:\n${(res.stdout || '').slice(-3000)}${res.stderr}`);

  const asked = new Set(readFileSync(log, 'utf8').split('\n').filter(Boolean));
  assert.ok(asked.size > 20, `the recorder saw only ${asked.size} paths; the hook is not recording`);
  const src = text(walk(join(ROOT, 'src'), (n) => n.endsWith('.ts')));

  const dead = [];
  const familyDone = new Set();
  for (const key of C1) {
    if (PANEL_READ(key)) continue;
    const fam = FAMILIES.find((f) => f.re.test(key));
    if (fam) {
      if (familyDone.has(fam.name)) continue;
      familyDone.add(fam.name);
      const hit = [...asked].some((p) => fam.re.test(p));
      const declared = src.includes('`' + fam.prefix + '${');
      if (!hit) dead.push(`${fam.name}: no member was read`);
      else if (!declared) dead.push(`${fam.name}: no computed read by prefix "${fam.prefix}\${" in src/`);
    } else if (!asked.has(key)) dead.push(key);
  }
  assert.deepEqual(dead, [], `dead settings (no reader): ${dead.join(', ')}`);
});

test('T8b: every look.*, general.openOnStart and general.activeRepo key is read by the panel', () => {
  const panel = text(walk(join(ROOT, 'panel'), (n) => n.endsWith('.html') || n.endsWith('.js')));
  const prefixRead = /\blook\.[a-z]/.test(panel) || /\bgetPath\([^)]*['"]look['"]/.test(panel);
  assert.ok(prefixRead, 'the panel reads no look. prefix');
  const dead = [];
  for (const key of C1.filter(PANEL_READ)) {
    if (panel.includes(`bind('${key}'`) || panel.includes(`bind("${key}"`)) continue;
    // a look.* key may be read through its section: look.rain.enabled via look.rain, look.textSize via look.textSize
    if (key.startsWith('look.')) {
      const parts = key.split('.');
      const read = parts.slice(1).every((_, i) => panel.includes(parts.slice(0, i + 2).join('.')));
      if (read) continue;
    }
    dead.push(key);
  }
  assert.deepEqual(dead, [], `panel keys with no reader: ${dead.join(', ')}`);
});
