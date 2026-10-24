// THROWAWAY spike worker. Not the real plugin. Loaded only by spike/host-harness.mjs.
import { writeFileSync } from 'node:fs';
export default async function activate(orca) {
  orca.commands.register('probe', async (args) => {
    const out = { versions: process.versions, execArgv: process.execArgv, execPath: process.execPath, argv: process.argv, env_ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE, cwd: process.cwd() };
    const warnings = [];
    process.on('warning', (w) => warnings.push(String(w)));
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const d = new DatabaseSync(args.db);
      out.sqlite_version = d.prepare('select sqlite_version() v').get().v;
      out.journal_mode = d.prepare('PRAGMA journal_mode=WAL').get();
      d.exec('PRAGMA busy_timeout=5000');
      out.busy_timeout = d.prepare('PRAGMA busy_timeout').get();
      d.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, v TEXT)');
      d.prepare('INSERT INTO probe (v) VALUES (?)').run('hello-from-worker');
      out.readback = d.prepare('SELECT id, v FROM probe').all().map((r) => ({ ...r }));
      d.close();
      out.ok = true;
    } catch (e) { out.ok = false; out.error = String(e && e.stack || e); }
    await new Promise((r) => setTimeout(r, 50));
    out.warnings = warnings;
    writeFileSync(args.out, JSON.stringify(out, null, 2));
    return out;
  });
  orca.commands.register('write-rows', async (args) => {
    const { writeRows } = await import(args.core);
    return writeRows(args);
  });
}
