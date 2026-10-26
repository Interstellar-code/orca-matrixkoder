import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * node --test --test-global-setup: runs in the parent before any test file starts and after all have finished.
 * It points TMPDIR at a fresh mk-run-<pid>-* dir, which every test file (and anything they spawn) inherits, then
 * removes that whole dir at the end. A run that was killed before teardown leaves its mk-run dir behind; the next
 * run removes it once its pid is gone.
 */
const PREFIX = 'mk-run-';
let base;
let runDir;

const rm = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function sweepStaleRuns(dir) {
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(PREFIX)) continue;
    const pid = Number(name.slice(PREFIX.length).split('-')[0]);
    if (Number.isInteger(pid) && pid > 0 && !alive(pid)) {
      try { rm(join(dir, name)); } catch { /* next run tries again */ }
    }
  }
}

export function globalSetup() {
  base = tmpdir();
  sweepStaleRuns(base);
  runDir = mkdtempSync(join(base, `${PREFIX}${process.pid}-`));
  process.env.TMPDIR = runDir;
}

export function globalTeardown() {
  // A setup that threw part-way leaves these unset; do not hide its error behind a second one.
  if (base) process.env.TMPDIR = base;
  if (runDir) rm(runDir);
}
