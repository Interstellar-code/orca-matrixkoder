import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './tmp.mjs';

const SETUP = new URL('./global-setup.mjs', import.meta.url).pathname;
const LEAKY = new URL('./fixtures/tmp-leak/leaky.mjs', import.meta.url).pathname;
const mkDirs = (dir) => readdirSync(dir).filter((n) => n.startsWith('mk-')).sort();

/** Run the leaky fixture under node --test with TMPDIR=base; returns the dirs it logged as { raw, reg }. */
function runLeaky(base, args) {
  const log = join(tempDir('mk-leaklog-'), 'log');
  const env = { ...process.env, TMPDIR: base, LEAK_LOG: log };
  delete env.NODE_TEST_CONTEXT; // a nested run must report on its own, not to this run
  const r = spawnSync(process.execPath, ['--test', ...args, LEAKY], { env, encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'the fixture fails on purpose');
  return Object.fromEntries(readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' ')));
}

test('a run with the global setup leaves no mk-* dir in TMPDIR, even when a file leaks and fails', () => {
  const base = tempDir('mk-leakcheck-');
  const before = mkDirs(base);
  mkdirSync(join(base, 'mk-run-999999999-stale')); // left by a killed run whose pid is gone
  const made = runLeaky(base, [`--test-global-setup=${SETUP}`]);
  assert.ok(made.raw.startsWith(join(base, 'mk-run-')), `made under the run dir: ${made.raw}`);
  assert.equal(existsSync(made.raw), false);
  assert.equal(existsSync(made.reg), false);
  assert.deepEqual(mkDirs(base), before);
});

test('without the global setup, dirs made by tempDir() are still removed when the file exits', () => {
  const base = tempDir('mk-leakcheck-');
  const made = runLeaky(base, []);
  assert.equal(existsSync(made.reg), false);
  assert.equal(existsSync(made.raw), true, 'a bare mkdtempSync is only caught by the run-level layer');
});
