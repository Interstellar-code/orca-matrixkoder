import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('package.json declares the mk bin and the test script', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin.mk, 'bin/mk.mjs');
  assert.equal(pkg.scripts.test, 'node --test --test-global-setup=./test/global-setup.mjs "test/**/*.test.mjs"');
});
