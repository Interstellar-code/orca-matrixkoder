import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Every temp dir a test makes goes through tempDir(), which records it here. The process 'exit' hook removes
 * whatever is still recorded, so a file that never cleans up (or fails mid-way) leaves nothing behind.
 * The run-level layer is test/global-setup.mjs, which also catches dirs made outside this module.
 */
const dirs = new Set();
const rm = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });

export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.add(dir);
  return dir;
}

/** Remove one temp dir now. */
export function dispose(dir) {
  dirs.delete(dir);
  rm(dir);
}

/** Remove every temp dir this process made and has not disposed. */
export function cleanupTempDirs() {
  for (const dir of dirs) {
    try { rm(dir); } catch { /* best effort at exit */ }
  }
  dirs.clear();
}

process.on('exit', cleanupTempDirs);

/** SIGTERM a child (headless Chrome) and wait for it to exit, so its profile dir can be removed. */
export async function stopProcess(proc, ms = 3000) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  proc.kill('SIGTERM');
  const timer = new Promise((resolve) => setTimeout(resolve, ms).unref());
  if ((await Promise.race([exited.then(() => true), timer.then(() => false)])) === false) {
    proc.kill('SIGKILL');
    await exited;
  }
}
