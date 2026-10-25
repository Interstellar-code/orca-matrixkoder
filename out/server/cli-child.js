/**
 * The mk CLI as a child process of the server: `node out/server/cli-child.js <mk args>` (same as bin/mk.mjs, but next to
 * the server's own code so it ships with out/). bug.fix runs here because the CLI's Orca calls are synchronous (up to 60 s
 * each) and would otherwise freeze the server's HTTP, Undo timers and sync for as long as Orca takes.
 * MK_DATA_DIR and MK_REPORTED_BY come from the parent.
 */
// node:sqlite prints an ExperimentalWarning on stderr; drop it so a failure is one clean line.
process.removeAllListeners('warning');
const { main, realOrca } = await import('../store/cli.js');
process.exitCode = main(process.argv.slice(2), {
    out: (l) => process.stdout.write(`${l}\n`),
    err: (l) => process.stderr.write(`${l}\n`),
    env: process.env,
    cwd: process.cwd(),
    orca: realOrca,
});
export {};
