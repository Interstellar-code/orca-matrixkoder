/**
 * MatrixKoder Plugin Worker for Orca IDE
 * Runs out-of-process in Node.js, coordinating Orca worktrees, events, and terminals.
 */
import { readdirSync } from 'node:fs';
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

let service: Service | null = null;

/** Every .js module in out/commands/ (next to this file, so it works from Orca's plugin copy), so LAUNCH adds commands without editing this file. */
async function registerCommandModules(context: PluginContext): Promise<void> {
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
      const handler = mod.default as (s: Service, args?: unknown) => unknown;
      context.commands.register(mod.commandId, async (args) => {
        if (!service) throw new Error('the MatrixKoder dashboard service is not running');
        return handler(service, args);
      });
    } catch (e) {
      context.log(`[MatrixKoder] commands/${f} failed to load: ${(e as Error).message}`);
    }
  }
}

export default async function activate(context: PluginContext): Promise<void> {
  const { commands, events, host, log } = context;
  log('[MatrixKoder] Initializing MatrixKoder Orchestration Worker...');

  // 0. The local dashboard server, the sync loop and the keep-alive (a cheap host call every 60 s: Orca reaps an idle worker after 5 min)
  try {
    service = await startService({
      log,
      keepAlive: () => host.call('workspace.readContext'),
    });
    log(`[MatrixKoder] Dashboard server on 127.0.0.1:${service.port}`);
  } catch (e) {
    log(`[MatrixKoder] dashboard server did not start: ${(e as Error).message}`);
  }

  // 1. Subscribe to Orca's live agent lifecycle transitions
  events.on('agent.status.changed', async (rawPayload) => {
    const event = rawPayload as AgentStatusChangedEvent;
    log(`[MatrixKoder] Agent in pane ${event.paneKey} transitioned to: ${event.state}`);
    service?.sync.onAgentStatus(event);

    if (event.state === 'done') {
      await host.call('notifications.show', {
        title: 'MatrixKoder: Lane Verified',
        body: `Worker in pane ${event.paneKey} has completed its task turn.`
      });
    }
  });

  // 2. Track worktree creations & removals
  events.on('worktree.created', async (rawPayload) => {
    const event = rawPayload as WorktreeLifecycleEvent;
    log(`[MatrixKoder] New worktree detected: ${event.branch || 'detached'} at ${event.path}`);
    service?.sync.onWorktreeCreated();
  });

  events.on('worktree.removed', async (rawPayload) => {
    const event = rawPayload as WorktreeLifecycleEvent;
    log(`[MatrixKoder] Worktree cleaned up: ${event.path}`);
    service?.sync.onWorktreeRemoved(event);
  });

  // 3. Register custom Command Palette actions
  commands.register('sweep-lanes', async () => {
    log('[MatrixKoder] Performing fleet lane sweep across all active worktrees...');
    const ctx = await host.call<{ branch: string; displayName: string; terminals: { id: string }[] }>('workspace.readContext');
    await service?.sync.pullAll();

    return {
      success: true,
      focusedWorkspace: ctx?.displayName || 'none',
      activeTerminals: ctx?.terminals?.length || 0,
      timestamp: Date.now()
    };
  });

  await registerCommandModules(context);

  log('[MatrixKoder] Worker ready and listening to orchestration events.');
}

export async function deactivate(): Promise<void> {
  console.log('[MatrixKoder] Deactivating MatrixKoder worker.');
  await service?.close();
  service = null;
}
