// Stands in for the `orca` binary in CLI tests. Records argv (one JSON line) to $MK_STUB_LOG and prints a receipt from
// orca-receipts.json. Ids derive from --retry-request, so the same request id returns the same receipt (Orca's replay rule).
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
appendFileSync(process.env.MK_STUB_LOG, `${JSON.stringify(args)}\n`);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const tpl = JSON.parse(readFileSync(new URL('./orca-receipts.json', import.meta.url), 'utf8'));
const fill = (o, map) => JSON.parse(JSON.stringify(o).replace(/@([A-Z_]+)@/g, (_, k) => map[k] ?? ''));
const cmd = args.slice(0, 2).join(' ');

if (cmd === 'orchestration run-create') {
  console.log(JSON.stringify(fill(tpl['run-create'], { RUN_ID: `run_${hash(flag('retry-request') ?? Math.random().toString())}`, OBJECTIVE: flag('objective') })));
} else if (cmd === 'orchestration task-create') {
  if (process.env.MK_STUB_FAIL_TASK_CREATE) { console.error('stub: orca runtime is not running'); process.exit(1); }
  console.log(JSON.stringify(fill(tpl['task-create'], { TASK_ID: `task_${hash(flag('retry-request') ?? Math.random().toString())}`, RUN: flag('run'), TITLE: flag('task-title') })));
} else if (cmd === 'repo list') {
  if (!process.env.MK_STUB_REPO_PATH) { console.log(JSON.stringify({ ok: true, result: { repos: [] } })); }
  else console.log(JSON.stringify(fill(tpl['repo-list'], { REPO_ID: 'repo-from-orca', REPO_PATH: process.env.MK_STUB_REPO_PATH })));
} else {
  console.error(`stub: unexpected orca call: ${args.join(' ')}`);
  process.exit(1);
}
