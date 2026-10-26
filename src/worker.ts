/**
 * MatrixKoder Plugin Worker for Orca IDE
 * Runs out-of-process in Node.js, coordinating Orca worktrees, events, and terminals.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startService, type Service } from './server/index.js';

export interface PluginContext {
  commands: {
    register: (commandId: string, handler: (args?: unknown) => Promise<unknown> | unknown) => void;
  };
  events: {
    on: (eventName: string, handler: (payload: unknown) => Promise<void> | void) => void;
  };
  host: {
    call: <T = unknown>(method: string, params?: unknown) => Promise<T>;
  };
  grantedCapabilities: string[];
  log: (message: string) => void;
}

export interface AgentStatusChangedEvent {
  worktreeId: string | null;
  paneKey: string;
  state: 'starting' | 'working' | 'idle' | 'done' | 'failed' | string;
  receivedAt: number;
  mainAgent?: {
    state: string;
    outcome?: string;
    stateStartedAt: number;
  };
}

export interface WorktreeLifecycleEvent {
  worktreeId: string;
  path: string;
  branch?: string;
}

/** A module in out/commands/ registers one worker command: `export const commandId` and a default `(service, args) => result`. */
interface CommandModule {
  commandId?: unknown;
  default?: unknown;
}

export interface ServiceKeeper {
  /** The running service, or null when none is up. */
  current(): Service | null;
  /** The running service; starts one if none is up. Callers that arrive during a start share that one start. */
  ensure(): Promise<Service>;
  close(): Promise<void>;
}

/** Holds the dashboard service so a command can start it again if activation could not (or it was closed). */
export function createServiceKeeper(start: () => Promise<Service>): ServiceKeeper {
  let service: Service | null = null;
  let starting: Promise<Service> | null = null;
  return {
    current: () => service,
    ensure() {
      if (service) return Promise.resolve(service);
      starting ??= start()
        .then((s) => (service = s))
        .finally(() => {
          starting = null;
        });
      return starting;
    },
    async close() {
      // a start still in flight finishes first, so its service is closed too instead of left running
      if (starting) await starting.catch(() => {});
      const s = service;
      service = null;
      await s?.close();
    },
  };
}

/**
 * Worker command ids declared in the plugin's orca-plugin.json (commands without a built-in `action`).
 * Orca stops the whole plugin when the worker registers a command the manifest does not declare. Null if unreadable.
 */
export function declaredWorkerCommands(manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'orca-plugin.json')): Set<string> | null {
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { contributes?: { commands?: { id?: unknown; action?: unknown }[] } };
    return new Set((m.contributes?.commands ?? []).filter((c) => c.action === undefined && typeof c.id === 'string').map((c) => c.id as string));
  } catch {
    return null;
  }
}

/** Every .js module in out/commands/ (next to this file, so it works from Orca's plugin copy), so LAUNCH adds commands without editing this file. */
export async function registerCommandModules(context: PluginContext, keeper: ServiceKeeper, declared: Set<string> | null = declaredWorkerCommands()): Promise<void> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'commands');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  } catch {
    context.log('[MatrixKoder] no commands folder');
    return;
  }
  for (const f of files) {
    try {
      const mod = (await import(pathToFileURL(join(dir, f)).href)) as CommandModule;
      if (typeof mod.commandId !== 'string' || typeof mod.default !== 'function') {
        context.log(`[MatrixKoder] skipped commands/${f}: it needs a commandId and a default function`);
        continue;
      }
      if (declared && !declared.has(mod.commandId)) {
        context.log(`[MatrixKoder] skipped commands/${f}: "${mod.commandId}" is not declared in orca-plugin.json`);
        continue;
      }
      const handler = mod.default as (s: Service, args?: unknown) => unknown;
      context.commands.register(mod.commandId, async (args) => {
        let running: Service;
        try {
          running = await keeper.ensure();
        } catch (e) {
          throw new Error(`the MatrixKoder dashboard service could not start: ${(e as Error).message}`);
        }
        return handler(running, args);
      });
    } catch (e) {
      context.log(`[MatrixKoder] commands/${f} failed to load: ${(e as Error).message}`);
    }
  }
}

// Set by activate, read when the keeper starts a service: the plugin's log and a cheap host call every 60 s (Orca reaps an idle worker after 5 min).
let active: PluginContext | null = null;
const keeper = createServiceKeeper(() => startService({
  log: (m) => (active ? active.log(m) : console.log(m)),
  notify: (n) => active?.host.call('notifications.show', n),
  keepAlive: () => active?.host.call('workspace.readContext'),
}));

export default async function activate(context: PluginContext): Promise<void> {
  const { commands, events, host, log } = context;
  active = context;
  log('[MatrixKoder] Initializing MatrixKoder Orchestration Worker...');

  // 0. The local dashboard server, the sync loop and the keep-alive (a cheap host call every 60 s: Orca reaps an idle worker after 5 min)
  try {
    const service = await keeper.ensure();
    log(`[MatrixKoder] Dashboard server on 127.0.0.1:${service.port}`);
  } catch (e) {
    log(`[MatrixKoder] dashboard server did not start: ${(e as Error).message}`);
  }

  // 1. Subscribe to Orca's live agent lifecycle transitions
  events.on('agent.status.changed', async (rawPayload) => {
    const event = rawPayload as AgentStatusChangedEvent;
    log(`[MatrixKoder] Agent in pane ${event.paneKey} transitioned to: ${event.state}`);
    keeper.current()?.sync.onAgentStatus(event);

    if (event.state === 'done') {
      await keeper.current()?.notifier.notify(
        'laneDone',
        `laneDone:${event.paneKey}:${Math.floor((event.receivedAt || Date.now()) / 60_000)}`,
        'MatrixKoder: Lane Verified',
        `Worker in pane ${event.paneKey} has completed its task turn.`,
      );
    }
  });

  // 2. Track worktree creations & removals
  events.on('worktree.created', async (rawPayload) => {
    const event = rawPayload as WorktreeLifecycleEvent;
    log(`[MatrixKoder] New worktree detected: ${event.branch || 'detached'} at ${event.path}`);
    keeper.current()?.sync.onWorktreeCreated();
  });

  events.on('worktree.removed', async (rawPayload) => {
    const event = rawPayload as WorktreeLifecycleEvent;
    log(`[MatrixKoder] Worktree cleaned up: ${event.path}`);
    keeper.current()?.sync.onWorktreeRemoved(event);
  });

  // 3. Register custom Command Palette actions
  commands.register('sweep-lanes', async () => {
    log('[MatrixKoder] Performing fleet lane sweep across all active worktrees...');
    const ctx = await host.call<{ branch: string; displayName: string; terminals: { id: string }[] }>('workspace.readContext');
    await keeper.current()?.sync.pullAll();

    return {
      success: true,
      focusedWorkspace: ctx?.displayName || 'none',
      activeTerminals: ctx?.terminals?.length || 0,
      timestamp: Date.now()
    };
  });

  await registerCommandModules(context, keeper);

  log('[MatrixKoder] Worker ready and listening to orchestration events.');
}

export async function deactivate(): Promise<void> {
  console.log('[MatrixKoder] Deactivating MatrixKoder worker.');
  await keeper.close();
}
