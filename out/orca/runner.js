import { execFile } from 'node:child_process';
const MAX_BUFFER = 64 * 1024 * 1024;
// Default runner: `execFile('orca', argv)`, no shell. Orca prints its JSON envelope even when it
// exits non-zero (for example run_required), so a non-zero exit still returns the stdout.
// A timeout rejects with code 'ETIMEDOUT'; a missing binary rejects with Node's own error.
export const execOrca = (argv, opts) => new Promise((resolve, reject) => {
    execFile('orca', argv, { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (!err)
            return resolve({ stdout, stderr, exitCode: 0 });
        const e = err;
        if (e.killed && e.signal) {
            return reject(Object.assign(new Error(`orca timed out after ${opts.timeoutMs} ms`), { code: 'ETIMEDOUT' }));
        }
        if (typeof e.code === 'number')
            return resolve({ stdout, stderr, exitCode: e.code });
        reject(e);
    });
});
