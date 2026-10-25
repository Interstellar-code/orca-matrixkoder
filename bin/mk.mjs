#!/usr/bin/env node
// mk: MatrixKoder CLI for agents (bugs, to-dos, subtasks, ask notes). Logic lives in out/store/cli.js (src/store/cli.ts).
// node:sqlite prints an ExperimentalWarning on stderr; drop it so a failure is one clean line.
process.removeAllListeners('warning');
const { main, realOrca } = await import('../out/store/cli.js');
const code = main(process.argv.slice(2), {
  out: (l) => process.stdout.write(`${l}\n`),
  err: (l) => process.stderr.write(`${l}\n`),
  env: process.env,
  cwd: process.cwd(),
  orca: realOrca,
});
process.exitCode = code;
