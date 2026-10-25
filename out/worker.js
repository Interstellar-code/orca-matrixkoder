/**
 * MatrixKoder Plugin Worker for Orca IDE
 * Runs out-of-process in Node.js, coordinating Orca worktrees, events, and terminals.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startService } from './server/index.js';
let service = null;
/** Every .js module in out/commands/ (next to this file, so it works from Orca's plugin copy), so LAUNCH adds commands without editing this file. */
async function registerCommandModules(context) {
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'commands');
    let files = [];
    try {
        files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
    }
    catch {
        context.log('[MatrixKoder] no commands folder');
        return;
    }
    for (const f of files) {
        try {
            const mod = (await import(pathToFileURL(join(dir, f)).href));
            if (typeof mod.commandId !== 'string' || typeof mod.default !== 'function') {
                context.log(`[MatrixKoder] skipped commands/${f}: it needs a commandId and a default function`);
                continue;
            }
            const handler = mod.default;
            context.commands.register(mod.commandId, async (args) => {
                if (!service)
                    throw new Error('the MatrixKoder dashboard service is not running');
                return handler(service, args);
            });
        }
        catch (e) {
            context.log(`[MatrixKoder] commands/${f} failed to load: ${e.message}`);
        }
    }
}
export default async function activate(context) {
    const { commands, events, host, log } = context;
    log('[MatrixKoder] Initializing MatrixKoder Orchestration Worker...');
    // 0. The local dashboard server, the sync loop and the keep-alive (a cheap host call every 60 s: Orca reaps an idle worker after 5 min)
    try {
        service = await startService({
            log,
            keepAlive: () => host.call('workspace.readContext'),
        });
        log(`[MatrixKoder] Dashboard server on 127.0.0.1:${service.port}`);
    }
    catch (e) {
        log(`[MatrixKoder] dashboard server did not start: ${e.message}`);
    }
    // 1. Subscribe to Orca's live agent lifecycle transitions
    events.on('agent.status.changed', async (rawPayload) => {
        const event = rawPayload;
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
        const event = rawPayload;
        log(`[MatrixKoder] New worktree detected: ${event.branch || 'detached'} at ${event.path}`);
        service?.sync.onWorktreeCreated();
    });
    events.on('worktree.removed', async (rawPayload) => {
        const event = rawPayload;
        log(`[MatrixKoder] Worktree cleaned up: ${event.path}`);
        service?.sync.onWorktreeRemoved(event);
    });
    // 3. Register custom Command Palette actions
    commands.register('sweep-lanes', async () => {
        log('[MatrixKoder] Performing fleet lane sweep across all active worktrees...');
        const ctx = await host.call('workspace.readContext');
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
export async function deactivate() {
    console.log('[MatrixKoder] Deactivating MatrixKoder worker.');
    await service?.close();
    service = null;
}
