// Run by test/tmp-leak.test.mjs only (not a *.test.mjs, so the main run skips it). It leaks on purpose: one dir
// made with a bare mkdtempSync and never removed, one made with tempDir(), then a failing test.
import { test } from 'node:test';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from '../../tmp.mjs';

test('leaks temp dirs and fails mid-way', () => {
  const raw = mkdtempSync(join(tmpdir(), 'mk-leak-raw-'));
  const reg = tempDir('mk-leak-reg-');
  appendFileSync(process.env.LEAK_LOG, `raw ${raw}\nreg ${reg}\n`);
  throw new Error('deliberate failure');
});
