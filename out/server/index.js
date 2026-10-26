/**
 * The service the worker runs: mk-data.db, the sync loop, the decision log, the HTTP server and the keep-alive.
 * Everything that talks to the outside world is injectable, so tests start the real thing against stubs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execOrca } from '../orca/index.js';
import { realOrca } from '../store/cli.js';
import { dataDir, openDb } from '../store/db.js';
import { runMaintenance } from '../store/maintenance.js';
import { Actions, ACTION_NAMES } from './actions.js';
import { readSettings, realClock } from './common.js';
import { Decisions } from './decisions.js';
import { Notifier } from './notify.js';
import { startHttp } from './http.js';
import { buildState, eventDetail, eventsPage } from './snapshot.js';
import { Sync } from './sync.js';
export { ACTION_NAMES } from './actions.js';
export { buildState, SNAPSHOT_LIMIT } from './snapshot.js';
/** web/ is a sibling of out/: out/server/index.js -> ../../web. Relative to this file, so it works from Orca's plugin copy. */
export function defaultWebDir() {
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
}
function pluginVersion() {
    try {
        const p = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'orca-plugin.json');
        return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).version ?? null : null;
    }
    catch {
        return null;
    }
}
export async function startService(opts = {}) {
    const dir = opts.dir ?? dataDir();
    const log = opts.log ?? ((m) => console.log(m));
    const db = openDb(dir);
    let sync;
    const ctx = {
        db, dir,
        runner: opts.runner ?? execOrca,
        cliOrca: opts.cliOrca ?? realOrca,
        clock: opts.clock ?? realClock,
        undoMs: opts.undoMs,
        requestSync: () => sync.request(),
        notify: opts.notify,
        log,
    };
    const notifier = new Notifier(ctx);
    sync = new Sync(ctx, { git: opts.git, probeCli: opts.probeCli, notifier });
    const decisions = new Decisions(ctx);
    const actions = new Actions(ctx, sync, decisions, notifier);
    const version = pluginVersion();
    const state = (q = {}) => buildState(ctx, q, { version });
    const events = (q = {}) => eventsPage(ctx, q);
    const event = (id) => eventDetail(ctx, id);
    const action = (name, args) => actions.run(name, args);
    const http = await startHttp({ state, events, event, action }, { webDir: opts.webDir ?? defaultWebDir(), log });
    let keep = null;
    if (opts.loops !== false) {
        sync.start({ fastMs: opts.fastMs, slowMs: opts.slowMs, filesMs: opts.filesMs });
        if (opts.keepAlive) {
            const ping = opts.keepAlive;
            keep = setInterval(() => {
                try {
                    void Promise.resolve(ping()).catch((e) => log(`[keepalive] ${e.message}`));
                }
                catch (e) {
                    log(`[keepalive] ${e.message}`);
                }
            }, opts.keepAliveMs ?? 60_000);
            keep.unref?.();
        }
    }
    // On start: finish or expire Undo windows a restart cut short, then the daily backup and prune. This comes after the
    // bind and the keep-alive, because replay makes Orca calls (up to 10 s each) and must not hold either back.
    const replayed = await decisions.replay();
    if (replayed.ran || replayed.expired || replayed.scheduled)
        log(`[decisions] replay: ${replayed.ran} sent, ${replayed.expired} expired, ${replayed.scheduled} waiting`);
    try {
        runMaintenance(db, dir, ctx.clock.now(), readSettings(ctx));
    }
    catch (e) {
        log(`[maintenance] ${e.message}`);
    }
    return {
        url: http.url, port: http.port, token: http.token, ctx, sync, actions, notifier,
        state, events, event, action,
        async close() {
            if (keep)
                clearInterval(keep);
            sync.stop();
            decisions.close();
            await http.close();
            db.close();
        },
    };
}
void ACTION_NAMES;
