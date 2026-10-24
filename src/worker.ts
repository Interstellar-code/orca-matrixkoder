/**
 * MatrixKoder Plugin Worker for Orca IDE
 * Runs out-of-process in Node.js, coordinating Orca worktrees, events, and terminals.
 */

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

export default async function activate(context: PluginContext): Promise<void> {
  const { commands, events, host, log } = context;
  log('[MatrixKoder] Initializing MatrixKoder Orchestration Worker...');

  // 1. Subscribe to Orca's live agent lifecycle transitions
  events.on('agent.status.changed', async (rawPayload) => {
    const event = rawPayload as AgentStatusChangedEvent;
    log(`[MatrixKoder] Agent in pane ${event.paneKey} transitioned to: ${event.state}`);

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
  });

  events.on('worktree.removed', async (rawPayload) => {
    const event = rawPayload as WorktreeLifecycleEvent;
    log(`[MatrixKoder] Worktree cleaned up: ${event.path}`);
  });

  // 3. Register custom Command Palette actions
  commands.register('sweep-lanes', async () => {
    log('[MatrixKoder] Performing fleet lane sweep across all active worktrees...');
    const ctx = await host.call<{ branch: string; displayName: string; terminals: { id: string }[] }>('workspace.readContext');
    
    return {
      success: true,
      focusedWorkspace: ctx?.displayName || 'none',
      activeTerminals: ctx?.terminals?.length || 0,
      timestamp: Date.now()
    };
  });

  log('[MatrixKoder] Worker ready and listening to orchestration events.');
}

export async function deactivate(): Promise<void> {
  console.log('[MatrixKoder] Deactivating MatrixKoder worker.');
}
