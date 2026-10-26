/**
 * The service the worker runs: mk-data.db, the sync loop, the decision log, the HTTP server and the keep-alive.
 * Everything that talks to the outside world is injectable, so tests start the real thing against stubs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execOrca, type Runner } from '../orca/index.js';
import { realOrca, type OrcaRunner } from '../store/cli.js';
import { dataDir, openDb } from '../store/db.js';
import { runMaintenance } from '../store/maintenance.js';
import { Actions, ACTION_NAMES } from './actions.js';
import { realClock, type ActionOutcome, type Clock, type CliProber, type GitRunner, type ServerCtx } from './common.js';
import { Decisions } from './decisions.js';
import { Notifier } from './notify.js';
import { startHttp, type DashboardServer } from './http.js';
import { buildState, eventDetail, eventsPage, type StateQuery } from './snapshot.js';
import { Sync } from './sync.js';

export { ACTION_NAMES } from './actions.js';
export { buildState, SNAPSHOT_LIMIT } from './snapshot.js';

export interface ServiceOptions {
  /** Data folder (default: $MK_DATA_DIR, else ~/.matrixkoder). */
  dir?: string;
  runner?: Runner;
  cliOrca?: OrcaRunner;
  git?: GitRunner;
  probeCli?: CliProber;
  clock?: Clock;
  /** The dashboard page's folder. Default: web/ next to the worker's own out/ folder, never the repo. */
  webDir?: string;
  undoMs?: number;
  /** Shows one desktop notification: `{title, body}`. Default: none (the notifier then sends nothing). */
  notify?: (n: { title: string; body: string }) => unknown;
  /** false in tests: no timers, no first pull. */
  loops?: boolean;
  fastMs?: number;
  slowMs?: number;
  /** Called every 60 s so Orca does not reap the idle worker (a cheap host call). */
  keepAlive?: () => unknown;
  keepAliveMs?: number;
  log?: (message: string) => void;
}

export interface Service {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  readonly ctx: ServerCtx;
  readonly sync: Sync;
  readonly actions: Actions;
  readonly notifier: Notifier;
  /** The same data as GET /api/state, for the mk.state worker command. */
  state(q?: StateQuery): unknown;
  events(q?: { before?: number; limit?: number }): unknown;
  event(id: number): unknown | null;
  /** The same as POST /api/action, for the mk.action worker command. */
  action(name: unknown, args?: unknown): Promise<ActionOutcome>;
  close(): Promise<void>;
}

/** web/ is a sibling of out/: out/server/index.js -> ../../web. Relative to this file, so it works from Orca's plugin copy. */
export function defaultWebDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
}

function pluginVersion(): string | null {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'orca-plugin.json');
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as { version?: string }).version ?? null : null;
  } catch {
    return null;
  }
}

export async function startService(opts: ServiceOptions = {}): Promise<Service> {
  const dir = opts.dir ?? dataDir();
  const log = opts.log ?? ((m: string) => console.log(m));
  const db = openDb(dir);
  let sync!: Sync;
  const ctx: ServerCtx = {
    db, dir,
    runner: opts.runner ?? execOrca,
    cliOrca: opts.cliOrca ?? realOrca,
    clock: opts.clock ?? realClock,
    undoMs: opts.undoMs ?? 10_000,
    requestSync: () => sync.request(),
    notify: opts.notify,
    log,
  };
  const notifier = new Notifier(ctx);
  sync = new Sync(ctx, { git: opts.git, probeCli: opts.probeCli, notifier });
  const decisions = new Decisions(ctx);
  const actions = new Actions(ctx, sync, decisions, notifier);
  const version = pluginVersion();

  const state = (q: StateQuery = {}): unknown => buildState(ctx, q, { version });
  const events = (q: { before?: number; limit?: number } = {}): unknown => eventsPage(ctx, q);
  const event = (id: number): unknown | null => eventDetail(ctx, id);
  const action = (name: unknown, args?: unknown): Promise<ActionOutcome> => actions.run(name, args);

  const http: DashboardServer = await startHttp({ state, events, event, action }, { webDir: opts.webDir ?? defaultWebDir(), log });

  let keep: NodeJS.Timeout | null = null;
  if (opts.loops !== false) {
    sync.start({ fastMs: opts.fastMs, slowMs: opts.slowMs });
    if (opts.keepAlive) {
      const ping = opts.keepAlive;
      keep = setInterval(() => {
        try {
          void Promise.resolve(ping()).catch((e: Error) => log(`[keepalive] ${e.message}`));
        } catch (e) {
          log(`[keepalive] ${(e as Error).message}`);
        }
      }, opts.keepAliveMs ?? 60_000);
      keep.unref?.();
    }
  }

  // On start: finish or expire Undo windows a restart cut short, then the daily backup and prune. This comes after the
  // bind and the keep-alive, because replay makes Orca calls (up to 10 s each) and must not hold either back.
  const replayed = await decisions.replay();
  if (replayed.ran || replayed.expired || replayed.scheduled) log(`[decisions] replay: ${replayed.ran} sent, ${replayed.expired} expired, ${replayed.scheduled} waiting`);
  try {
    runMaintenance(db, dir, ctx.clock.now());
  } catch (e) {
    log(`[maintenance] ${(e as Error).message}`);
  }

  return {
    url: http.url, port: http.port, token: http.token, ctx, sync, actions, notifier,
    state, events, event, action,
    async close() {
      if (keep) clearInterval(keep);
      sync.stop();
      decisions.close();
      await http.close();
      db.close();
    },
  };
}

void ACTION_NAMES;
