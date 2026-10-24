# Orca Plugin Architecture & Runtime Specification

This document provides a technical reference for Orca's experimental plugin system (`pluginApi: 1`), reverse-engineered from the Orca v1.4 application runtime.

---

## 1. Dual-Plane Execution Model

An Orca plugin runs on two isolated planes:

```
┌────────────────────────────────────────────────────────┐
│                      Orca Host                         │
│                                                        │
│  ┌───────────────────────┐   ┌──────────────────────┐  │
│  │     Orca Renderer     │   │   Main / Host API    │  │
│  │   (Theme CSS Tokens)  │   │  (Capability Gating) │  │
│  └───────────▲───────────┘   └──────────▲───────────┘  │
└──────────────┼──────────────────────────┼──────────────┘
       postMessage (Tokens, Actions)      │ IPC (child_process.fork)
┌──────────────▼───────────┐   ┌──────────▼──────────────┐
│     GUI Panel (IFrame)   │   │  Worker Process (Node)   │
│  - Sandboxed HTML/CSS/JS │   │  - main: "out/worker.js" │
│  - Native Orca CSS vars  │   │  - activate() export     │
│  - workspace/term/notif  │   │  - commands & events     │
└──────────────────────────┘   └──────────────────────────┘
```

1. **GUI Panel (Renderer Iframe):**
   - Rendered in a secure sandboxed frame (`sandbox="allow-scripts"`).
   - Injected with strict Content Security Policy (CSP):
     ```http
     default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'
     ```
   - Automatically inherits Orca's active color scheme and design tokens:
     - `--background`, `--foreground`, `--card`, `--card-foreground`, `--primary`, `--primary-foreground`, `--muted`, `--accent`, `--border`, `--radius`.
   - Communicates with the host via `window.parent.postMessage`:
     ```javascript
     window.parent.postMessage({
       type: 'orca-panel-action',
       requestId: 'req-1',
       action: 'workspace.readContext',
       params: {}
     }, '*');
     ```

2. **Backend Worker (Out-of-Process Node.js):**
   - Forked via `child_process.fork` pointing to `main` in `orca-plugin.json`.
   - Exports `activate(context)` and optional `deactivate()`.
   - `context` exposes:
     - `context.commands.register(id, handler)`
     - `context.events.on(eventName, handler)`
     - `context.host.call(method, params)`
     - `context.grantedCapabilities`
     - `context.log(message)`

---

## 2. Capability & Permission Model

Orca enforces a strict, closed capability model (`PLUGIN_CAPABILITY_KINDS`). Any capability must be declared in `orca-plugin.json` and confirmed by the user via a cryptographic consent fingerprint dialog:

| Capability | Scope / Purpose |
| :--- | :--- |
| `workspace:read` | Read active worktree branch name, display label, and live terminal IDs. |
| `terminal:send` | Send text and keystrokes to an explicit terminal ID. |
| `notifications:show` | Display native desktop alerts labeled with the plugin name. |
| `events:subscribe` | Receive real-time push events (`agent.status.changed`, `worktree.created`, `worktree.removed`). |
| `storage` | Isolated key-value storage persisted in Orca's application data folder. |
| `secrets` | Encrypted storage vault for API tokens and credentials. |
| `settings:own` | Read and update user-configurable plugin settings. |

---

## 3. Host API v0 Methods

Worker and panel bridge methods available via `host.call(method, params)`:

- `workspace.readContext` -> `{ branch, displayName, terminals: [{ id }] }`
- `terminal.sendText` -> `{ terminalId, text, enter: boolean }`
- `notifications.show` -> `{ title, body }`
- `storage.get` / `storage.set` / `storage.delete` / `storage.keys`
- `secrets.get` / `secrets.set` / `secrets.delete`
- `settings.get` / `settings.set`
- `events.subscribe`

---

## 4. Prompt Copilot & Terminal Pane Injection Pipeline

MatrixKoder's prompt enhancement buttons ("Improve prompt", "Answer", "Question") integrate directly with Orca's host bridge and CLI layer:

```
┌────────────────────────────────────────────────────────┐
│ MatrixKoder Panel (HTML/Iframe)                        │
│                                                        │
│ [✨ Improve Prompt] [💬 Answer] [❓ Question]          │
└──────────────────────────┬─────────────────────────────┘
                           │ 1. User clicks action button
                           ▼
┌────────────────────────────────────────────────────────┐
│ Context Gathering & Synthesis                          │
│                                                        │
│ 1. Call `workspace.readContext` -> active terminalId   │
│ 2. Call `orca terminal read` -> last 50-100 log lines  │
│ 3. Run LLM enhancer (Claude / DeepSeek Flash / Rule)   │
│ 4. Populate interactive prompt preview textarea        │
└──────────────────────────┬─────────────────────────────┘
                           │ 2. Click "Inject into Pane"
                           ▼
┌────────────────────────────────────────────────────────┐
│ Orca Host Bridge Execution                             │
│                                                        │
│ window.parent.postMessage({                            │
│   type: 'orca-panel-action',                           │
│   action: 'terminal.sendText',                         │
│   params: {                                            │
│     terminalId: activeTerminalId,                      │
│     text: synthesizedPrompt,                           │
│     enter: false // false = fill input buffer;         │
│                  // true = submit immediately          │
│   }                                                    │
│ }, '*');                                               │
└──────────────────────────┬─────────────────────────────┘
                           │ 3. Direct pty injection
                           ▼
┌────────────────────────────────────────────────────────┐
│ Active Agent Terminal Pane (Claude Code / Codex / AGY) │
│                                                        │
│ > Review the failed assertion in tests/auth.spec.ts:42 █
└────────────────────────────────────────────────────────┘
```

### Key Technical Advantages in Orca:
1. **Interactive Review (`enter: false`):** Setting `enter: false` writes the prompt into the active terminal's readline buffer without pressing Enter. This lets the developer review, edit, or append to the improved prompt before committing.
2. **Immediate Execution (`enter: true`):** When responding to automated agent questions or decision gates, setting `enter: true` allows hands-free dispatch.
3. **No Window Switching:** The user never has to copy, paste, click into the terminal window, or lose focus.

