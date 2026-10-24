"use strict";
/**
 * MatrixKoder Plugin Worker for Orca IDE
 * Runs out-of-process in Node.js, coordinating Orca worktrees, events, and terminals.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = activate;
exports.deactivate = deactivate;
async function activate(context) {
    const { commands, events, host, log } = context;
    log('[MatrixKoder] Initializing MatrixKoder Orchestration Worker...');
    // 1. Subscribe to Orca's live agent lifecycle transitions
    events.on('agent.status.changed', async (rawPayload) => {
        const event = rawPayload;
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
        const event = rawPayload;
        log(`[MatrixKoder] New worktree detected: ${event.branch || 'detached'} at ${event.path}`);
    });
    events.on('worktree.removed', async (rawPayload) => {
        const event = rawPayload;
        log(`[MatrixKoder] Worktree cleaned up: ${event.path}`);
    });
    // 3. Register custom Command Palette actions
    commands.register('sweep-lanes', async () => {
        log('[MatrixKoder] Performing fleet lane sweep across all active worktrees...');
        const ctx = await host.call('workspace.readContext');
        return {
            success: true,
            focusedWorkspace: ctx?.displayName || 'none',
            activeTerminals: ctx?.terminals?.length || 0,
            timestamp: Date.now()
        };
    });
    log('[MatrixKoder] Worker ready and listening to orchestration events.');
}
async function deactivate() {
    console.log('[MatrixKoder] Deactivating MatrixKoder worker.');
}
