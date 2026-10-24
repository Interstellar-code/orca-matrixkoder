# Orca plugin API (pluginApi 1): verified against source

Source: the `orca/main` remote of this repo, tip `e30184fa8d38` (2026-10-24). Citation format is `orca/main:path:line`. Everything below was read from source, not run. Anything not confirmed is marked **unverified**. The whole system is labelled EXPERIMENTAL in source (`src/shared/plugins/plugin-manifest.ts:28`, `plugin-host-api.ts:16`); no compatibility promise until pluginApi v1 freezes.

There is no plugin documentation in the Orca repo (no `docs/**/plugin*`, no `.md` about plugins). The authoritative sources are `src/shared/plugins/*` (contracts), `src/main/plugins/*` (host), `src/renderer/src/components/right-sidebar/PluginPanel.tsx` (panel host) and the two examples under `examples/plugins/`.

## 0. The five facts that decide our design

1. A panel can call exactly 3 host methods: `workspace.readContext`, `terminal.sendText`, `notifications.show` (`src/shared/plugins/plugin-host-api.ts:122-152`, `261-265`). `storage.*`, `secrets.*`, `settings.*`, `events.subscribe` are worker-only (`panel: false`).
2. There is no panel-to-worker channel and no worker-to-panel channel. The only message types between a panel and the host are `orca-panel-action`, `orca-panel-action-result`, `orca-panel-ping`, `orca-panel-pong` (`src/shared/plugins/plugin-panel-bridge.ts:15-18`). A repo-wide search for other `orca-panel-*` strings found none. `plugins.invokeCommand` exists, but only on the renderer preload API (`src/preload/api/plugin-host-api.ts:147-151`), which the sandboxed iframe cannot reach.
3. Events (`agent.status.changed`, `worktree.created`, `worktree.removed`) are delivered to the worker only (`src/main/plugins/plugin-event-delivery.ts`). The panel never sees them.
4. The worker is plain Node with no permission sandbox: `fork(...)` with `execArgv: []` and a scrubbed env that still includes `HOME` (`src/main/plugins/plugin-host-process.ts:88-102`, `src/main/plugins/plugin-worker-env.ts:8-52`). Capabilities gate host API calls, not filesystem access.
5. The whole plugin system is off by default: `pluginSystemEnabled` is a master switch ("no discovery, no panels, no plugin code paths run at all") (`src/shared/global-settings-types.ts:364-366`).

---

## 1. Manifest schema (`orca-plugin.json`)

Schema: `src/shared/plugins/plugin-manifest.ts:76-123`. Validated identically by desktop, `orca serve`, relay and CLI (`:25-26`).

### 1.1 Top-level fields

| Field | Type / rule | Cite |
| :--- | :--- | :--- |
| `manifestVersion` | literal `1` | manifest.ts:77 |
| `id` | kebab-case slug, not a reserved name | manifest.ts:78, manifest-fields.ts:7-9 |
| `publisher` | same rule as `id`; identity is `<publisher>.<id>` | manifest.ts:79-81 |
| `name` | string 1-256 | manifest.ts:82 |
| `version` | strict semver | manifest.ts:83 |
| `description` | optional, max 4096 | manifest.ts:84 |
| `author` | optional `{ name (1-256), url? (max 2048) }` | manifest.ts:85-87 |
| `repository` | optional string, max 2048 | manifest.ts:88 |
| `icon` | optional relative path inside the plugin dir, max 2 MB file | manifest.ts:89, plugin-artifact-validation.ts:11 |
| `engines.orca` | required, only the form `">=x.y.z"` | manifest.ts:39-42, 91 |
| `pluginApi` | required, literal `1` | manifest.ts:93 |
| `main` | optional relative path to the Node worker entry; max 50 MB | manifest.ts:95, plugin-artifact-validation.ts:10 |
| `contributes` | strict object, see 1.2; defaults to `{}` | manifest.ts:96-117 |
| `capabilities` | array of `{ kind }`, max 32, default `[]` | manifest.ts:118 |

Unknown top-level keys are not rejected (plain `z.object`, so they are stripped). Unknown keys inside `contributes` ARE rejected (`.strict()`, manifest.ts:115). Relative paths must be portable and inside the plugin dir (`manifest-fields.ts:13-17`).

### 1.2 `contributes` types (exactly seven; no settings contribution exists)

| Key | Shape | Limit | Cite |
| :--- | :--- | :--- | :--- |
| `panels` | `{ id, title (1-256), icon? (Lucide name, max 64), entry (relative path) }` | 64 | manifest.ts:44-51, 34 |
| `commands` | `{ id, title, context?: 'global'\|'worktree', action? }` | 256 | manifest.ts:53-59, 35 |
| `events` | `{ on: 'worktree.created'\|'worktree.removed'\|'agent.status.changed' }` | 3 | manifest.ts:63-74 |
| `languagePacks` | `{ locale, path }` | 16 | plugin-content-pack-contributions.ts:5, 18-23 |
| `keybindings` | `{ command, key, when?: 'global'\|'worktree' }` | 256 | content-pack-contributions.ts:6, 25-42 |
| `vmRecipes` | `{ path }` | 64 | content-pack-contributions.ts:7, 44-46 |
| `agents` | `{ path }` (agent profile file, max 1 MB) | 64 | content-pack-contributions.ts:8, 48-50 |

There is no `settings`, `configuration`, `statusBar` or similar contribution. A `contributes.settings` key would fail validation (strict object). `settings:own` is a capability for a worker-side key-value store only (see 2 and 5).

### 1.3 Cross-field rules (`src/shared/plugins/plugin-manifest-contribution-validation.ts`)

1. Duplicate panel ids, command ids, language-pack locales, vmRecipe paths, agent paths are rejected (`:47-71`).
2. Duplicate keybindings are rejected across darwin, linux and win32 (`:72-85`).
3. A command with `action` must name a built-in alias (`:87-96`). The closed alias list is in `src/shared/plugins/plugin-command-actions.ts:5-21`: `worktree.history.back`, `worktree.history.forward`, `sidebar.left.toggle`, `sidebar.sleepingWorkspaces.toggle`, `floatingWorkspace.maximize`, `tab.rename`, `workspace.rename`, `workspace.openBoard`, `view.tasks`, `sidebar.right.toggle`, `sidebar.explorer.toggle`, `sidebar.search.toggle`, `sidebar.sourceControl.toggle`, `sidebar.checks.toggle`, `sidebar.ports.toggle`. Alias commands do not start a worker (`manifest.ts:57`).
4. A keybinding must point at a contributed command, and `when` must equal the command's `context` (default `global`) (`:97-115`).
5. `main` is required if any command lacks `action`, or if `events` is non-empty (`:117-133`).
6. `events:subscribe` capability is required if `events` is non-empty (`:134-143`).
7. Key syntax example that ships with Orca: `"Mod+Alt+T"` (`resources/plugins/launch/stablyai.orca-navigation-shortcuts/orca-plugin.json`). Our `Mod+Alt+M` follows the same grammar (full grammar in `src/shared/keybindings/normalization.ts`, not read in detail: **unverified** that `Mod+Alt+M` is not already taken, which would make it a conflict).

### 1.4 Versions

1. `pluginApi` must be exactly `1` (`manifest.ts:93`). Host methods carry a `since` minor (`'1.0'` for all current methods) (`plugin-host-api.ts:100`).
2. `engines.orca` is a minimum host version gate (`manifest.ts:90`); comparison in `satisfiesOrcaEngineRange` (`manifest.ts:157-176`). Prerelease and build suffixes on the host version are ignored.

---

## 2. Capabilities

Closed set of 7 unscoped kinds (`src/shared/plugins/plugin-capabilities.ts:15-23`). Each is `{ "kind": "..." }` with no extra fields (`:29`, strict). A typo fails manifest validation instead of granting nothing (`:10-12`).

| Capability | Grants (consent text, capabilities.ts:35-44) | Host methods it unlocks |
| :--- | :--- | :--- |
| `workspace:read` | name, branch and terminal list of the focused worktree | `workspace.readContext` |
| `terminal:send` | type text into a terminal you can see (always a specific terminal) | `terminal.sendText` |
| `notifications:show` | desktop notifications labelled with the plugin name | `notifications.show` |
| `storage` | the plugin's own storage folder | `storage.get/set/delete/keys` |
| `secrets` | the plugin's own encrypted vault | `secrets.get/set/delete` |
| `events:subscribe` | get notified of worktree create/remove and agent status change | `events.subscribe`, plus delivery of manifest `events` |
| `settings:own` | read and change the plugin's own settings | `settings.get/set` |

Mapping from method to capability: `src/shared/plugins/plugin-host-api.ts:122-253`.

### 2.1 How enforcement works

1. Gate (`src/shared/plugins/plugin-capability-gate.ts:34-63`), in order: unknown method -> `unknown_method`; panel calling a non-panel method -> `panel_forbidden`; plugin not enabled or consent stale -> `consent_required`; capability not granted -> `capability_denied`. Deny by default.
2. All plugin calls (panel bridge and worker `hostCall`) pass one chokepoint, `executePluginHostCall` (`src/main/plugins/plugin-host-methods.ts:31-118`): gate, then params validation (`invalid_params`), then audit-log "attempt" for mutations, then handler, then result schema validation.
3. Mutating methods (`terminal.sendText`, `notifications.show`, `storage.set/delete`, `secrets.set/delete`, `settings.set`) are audit-logged as `plugin:<id>`; if the audit log cannot be written the call fails with `unavailable` or `action_failed` (`plugin-host-methods.ts:61-91`).

### 2.2 How the user approves

1. Settings flag `pluginSystemEnabled` must be on (`global-settings-types.ts:364`). It is off by default.
2. Consent is stored as `pluginConsents[pluginKey] = fingerprint` (`global-settings-types.ts:370-374`). The fingerprint is `sha256-` + base64 of the canonical capability set, plus a marker if the plugin has a `main` worker ("trusted Node worker"), plus the tree content hash if it contributes keybindings, vmRecipes or agents (`src/shared/plugins/plugin-consent-fingerprint.ts:24-45`).
3. Any change that alters the fingerprint (new capability, adding `main`, changed content of an instructional pack) sets the plugin back to pending and re-prompts before code runs (`global-settings-types.ts:370-373`). Note: our keybinding means our consent is bound to our exact tree content, so every rebuild of a non-dev install re-prompts. Dev plugins: the dev tree is mutable, but the help text says dev plugins "still require permission review" (`PluginDevelopmentSection.tsx:69`). Whether a dev-tree edit re-prompts when keybindings are present is **unverified**.
4. UI: `PluginConsentDialog` shows the capability descriptions; the write contract is `{ pluginKey, reviewedFingerprint, decision: 'approve'|'keep-disabled' }` (`src/shared/plugins/plugin-consent-request.ts:8-14`; IPC `plugins:consent` at `src/main/ipc/plugins.ts:114-126`). Approval is conditional on the exact fingerprint the user reviewed.
5. Separate on/off per plugin: `disabledPlugins` list (`global-settings-types.ts:367-369`), `plugins:setEnabled` (`ipc/plugins.ts:128-139`).
6. A kill list can block plugins (`plugin-service.ts:215-220`).

---

## 3. Panel

### 3.1 Loading

1. Panel appears as an icon in the right-sidebar activity bar (Lucide icon name from `icon`; `manifest.ts:47`, `plugin-host-api.ts:11-17`) with a tab key of the form `plugin:...` (`PluginHostPanel.tabKey`, exact format **unverified**). Only shown when `pluginSystemEnabled` (`use-right-sidebar-activity-items.ts:59-63`).
2. Host reads `entry` from disk on every open, wraps it in a host shell, size cap 10 MB (`src/main/plugins/plugin-panel-controller.ts:134-169`, `plugin-artifact-validation.ts:9`). Reload on every `plugins:changed` event: if the HTML differs, the iframe is rebuilt (`PluginPanel.tsx:128-168`).
3. The renderer mounts the shell as `srcDoc`, not a URL (`PluginPanel.tsx:219-233`).

### 3.2 Iframe sandbox

```
<iframe sandbox="allow-scripts" name="orca-plugin-panel:<tabKey>" srcDoc=... />
```

`sandbox="allow-scripts"` only, no `allow-same-origin` (`PluginPanel.tsx:223-227`, with a SECURITY comment forbidding it). Result: opaque origin; no access to the app DOM, storage, or IPC. The frame name prefix is `orca-plugin-panel:` (`plugin-panel-bridge.ts:19`). Consequence (**unverified in Electron, per the HTML spec**): `localStorage`/`sessionStorage`/IndexedDB in the panel throw SecurityError, so the panel has no persistent state of its own.

### 3.3 Exact CSP

Injected as a `<meta http-equiv="Content-Security-Policy">` at the top of the shell, so it parses before any plugin content (`src/shared/plugins/plugin-panel-shell.ts:20-22, 65`):

```
default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'
```

A second CSP meta from the plugin can only tighten, never loosen (`plugin-panel-shell.ts:9-12`). So: inline scripts and styles only, images and fonts only as `data:` URIs, no `fetch`/XHR/WebSocket, no external scripts, no `eval` (not in `script-src`). Our `build-panel.mjs` CSP omits `connect-src` but the host shell supplies it.

The shell also installs a script that blocks `window.navigation` navigations, nulls `window.open`, blocks clicks on `<a href>` and all form submits, and answers pings (`plugin-panel-shell.ts:67-98`).

### 3.4 Panel to host protocol (request and response)

Panel to host (`window.parent.postMessage(msg, '*')`; the target origin must be `'*'` because the origin is opaque):

```json
{ "type": "orca-panel-action", "requestId": "req-1", "action": "workspace.readContext", "params": {} }
```

1. `requestId`: string 1-128 chars, chosen by the panel and echoed back (`plugin-panel-bridge.ts:41`).
2. `action`: must be one of the panel-callable names (`:42`, `isPluginPanelAction`).
3. `params`: validated against the host API spec for that action.

Host to panel reply:

```ts
{ type: 'orca-panel-action-result', requestId: string, ok: boolean,
  value?: unknown,                       // present when ok
  errorCode?: 'invalid_request'|'unknown_method'|'capability_denied'|'consent_required'|
              'panel_forbidden'|'invalid_params'|'rate_limited'|'unavailable'|'action_failed',
  error?: string }
```
(`plugin-panel-bridge.ts:53-72`, built in `plugin-panel-bridge-host.ts:157-181`.) Note the panel reply is a plain result object. The worker side instead gets a rejected Promise with `error.code`.

Origin and identity checks (there is no origin check, because there is no usable origin):
1. The host listener drops any message whose `event.source !== iframe.contentWindow` (`plugin-panel-bridge-host.ts:75-81`).
2. The renderer gives the panel an opaque `sessionToken` (32-128 chars) minted by main when the panel is opened; the panel never sees or supplies it or its plugin identity. Main resolves the token to `{pluginKey, panelId, rootDir, manifest snapshot}` and rejects the call if the plugin, root, manifest JSON or panel id changed (`plugin-panel-controller.ts:65-95`, `plugin-panel-sessions.ts`, `plugin-panel-bridge.ts:80-92`).
3. Capabilities are re-checked in main (see 2.1).

Budgets (per plugin, enforced both in the renderer handler and in main; `plugin-panel-bridge.ts:22-23`, `plugin-panel-call-admission.ts:35-49`):
1. Max message size 64 KB (structured-clone bytes).
2. Max 30 messages per 10 s, per plugin, shared across all its panel sessions in main. Over-budget replies with `invalid_request` (oversized) or `rate_limited`.
3. Budgets are checked before schema parsing, so malformed floods are also metered (`plugin-panel-bridge-host.ts:113-115`).

Liveness: the host sends `{ type: 'orca-panel-ping', pingId }` every 10 s; the shell script replies `{ type: 'orca-panel-pong', pingId }` automatically; if no pong within 5 s the panel is suspended and shows "stopped responding" (`plugin-panel-bridge.ts:35-36`, `PluginPanel.tsx:70-81, 197-206`). A panel whose JS busy-loops will therefore be killed. Pong frames are max 1 KB and use a reserved lane (`plugin-panel-bridge.ts:30`).

### 3.5 Panel-callable host methods (full param and result shapes)

| Action | Params | Result |
| :--- | :--- | :--- |
| `workspace.readContext` | none (`{}` or omitted) | `null` (no focused worktree) or `{ branch: string, displayName: string, terminals: { id: string }[] }` (max 50 terminals, labels max 512 chars) |
| `terminal.sendText` | `{ terminalId: string, text: string (1-4096), enter?: boolean (default false) }` | `{ accepted: boolean }` |
| `notifications.show` | `{ title: string (1-120), body?: string (max 1000) }` | `{ delivered: boolean }` |

Cite: `plugin-host-api.ts:25-58`; handlers `plugin-host-method-bindings.ts:72-114`. Behaviours worth knowing:
1. `readContext` returns the focused worktree's terminal ids, not an "active terminal". The API deliberately has no "active terminal" write target (`plugin-host-api.ts:30-31, 46-47`). The `hello-orca` panel makes the user pick a terminal from a list.
2. `readContext` does not return a filesystem path of the worktree (only branch and displayName).
3. `terminal.sendText` re-lists the focused worktree's terminals right before sending and refuses an id outside it (`bindings.ts:98-107`). Text only (no keystrokes), max 4096 chars, so a long prompt must be chunked or trimmed.
4. What `enter: false` does at the pty (fill the agent's input buffer without submitting) is the obvious reading of the flag; the terminal-side implementation was not read: **unverified**.

### 3.6 Theme tokens

Injected into the shell as `:root{...}` custom properties, snapshotted from the app's computed styles at frame-build time, with `{}<>;` stripped from values (`PluginPanel.tsx:42-46`, `plugin-panel-design-token-css.ts:9-19`). The shell `<html>` gets class `light` or `dark` (`plugin-panel-shell.ts:62`, `design-token-css.ts:21-23`). The allowlist (exactly 20, `plugin-panel-shell.ts:34-55`):

`--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --destructive-foreground --border --input --ring --radius`

Not injected: font families, spacing, sidebar or terminal colours, any chart colours. Tokens are not pushed over postMessage; changing the theme rebuilds the whole iframe (frame key includes `themeRevision`, `PluginPanel.tsx:64-69`), which drops all in-memory panel state.

### 3.7 Size and visibility events

None. The host sends no resize, visibility, focus or theme messages. The iframe is `h-full w-full flex-1` (`PluginPanel.tsx:231`), so ordinary in-frame `resize` events should work (**unverified**; standard DOM behaviour, not Orca-specific). Whether an inactive panel tab stays mounted or is unmounted (which would reset it) was not determined: **unverified**.

---

## 4. Worker

### 4.1 Process model

1. Forked lazily on the first trigger (command, manifest-declared event, `ensure`), via `child_process.fork` of Orca's `plugin-host-entry.js`, with `ELECTRON_RUN_AS_NODE=1`, `execArgv: []`, `serialization: 'advanced'`, `stdio: ['ignore','pipe','pipe','ipc']` (`plugin-host-process.ts:88-102`). The host entry imports your `main` via `import(pathToFileURL(...))`, so ESM and CJS both work (`plugin-host-runtime.ts:82-83`; `main` entries stay under 50 MB).
2. Env is an allowlist: `PATH HOME USERPROFILE LANG LC_ALL LC_CTYPE TZ TMPDIR TEMP TMP` plus Windows vars (`plugin-worker-env.ts:8-27`). No inherited secrets. No `cwd` option is passed to `fork`, so the working directory is Orca's own: use absolute paths (the value is **unverified**).
3. Limits: ready timeout 10 s, command timeout 30 s, idle reap 5 min (re-forked on next trigger), max 5 concurrent workers, extra queue (`plugin-host-protocol.ts:108-114`). Event handler timeout 5 min, max 64 pending events (`plugin-host-process.ts:19-20`). Idle sweep runs every 60 s (`plugin-service-housekeeping.ts:23-28`). Crashes are supervised and restarted; repeated failure leaves the plugin `errored` (`plugin-worker-manager.ts:92-94`).
4. Workers have no rendering, no Electron APIs. Node `fetch`/`child_process`/`fs` are all usable (no net or exec capability exists in v0; scoped kinds "arrive in later phases", `plugin-capabilities.ts:12-13`).

### 4.2 `activate()` context

Entry module: `export default function activate(orca)` (sync or async) and optional `export function deactivate()` (`plugin-host-runtime.ts:83-91`). If the default export is not a function, or `deactivate` exists but is not a function, activation fails (`:85-90`).

```ts
type PluginWorkerOrcaApi = {                         // plugin-host-runtime.ts:20-36
  commands: { register(commandId: string, handler: (args: unknown) => unknown): void }
  events:   { on(event: 'worktree.created'|'worktree.removed'|'agent.status.changed',
                 handler: (payload: unknown) => void | Promise<void>): void }
  host:     { call(method: string, params?: unknown): Promise<unknown> }
  grantedCapabilities: readonly string[]           // informational; host re-gates
  log(message: string): void                       // level 'info', truncated to 8192
}
```

1. A command handler may return any structured-clone value; it becomes the result of the invoke (`:148-150`). Thrown errors are returned as `error` text (`:151-158`).
2. After `activate` resolves the worker sends `ready` with the list of registered command ids; any id not declared in the manifest (without `action`) kills the activation (`plugin-worker-controller.ts:88-99`).
3. `host.call` rejects with an `Error` whose `.code` is the error code (`plugin-host-runtime.ts:179-185`). Our `src/worker.ts` `PluginContext` matches this shape.

### 4.3 `host.call` methods (worker can call all 14)

| Method | Capability | Params | Result |
| :--- | :--- | :--- | :--- |
| `workspace.readContext` | workspace:read | none | `null` or `{branch, displayName, terminals:[{id}]}` |
| `terminal.sendText` | terminal:send | `{terminalId, text (1-4096), enter?}` | `{accepted}` |
| `notifications.show` | notifications:show | `{title (1-120), body? (max 1000)}` | `{delivered}` |
| `storage.get` | storage | `{key}` | `{value: json}` (`null` if absent) |
| `storage.set` | storage | `{key, value: json}` | `{ok: true}` |
| `storage.delete` | storage | `{key}` | `{ok: true}` |
| `storage.keys` | storage | none | `{keys: string[]}` (max 1024) |
| `secrets.get` | secrets | `{key}` | `{value: string \| null}` |
| `secrets.set` | secrets | `{key, value: string (max 64 KB)}` | `{ok: true}` |
| `secrets.delete` | secrets | `{key}` | `{ok: true}` |
| `settings.get` | settings:own | none | `{settings: Record<string, json>}` |
| `settings.set` | settings:own | `{key, value: json}` | `{ok: true}` |
| `events.subscribe` | events:subscribe | `{events: EventName[] (1-3)}` | `{subscribed: EventName[]}` |

Cite: `plugin-host-api.ts:45-96, 122-253`, `plugin-host-method-bindings.ts:72-170`. Storage keys: see 5.1. There is no method to read terminal output, list worktrees or projects, run commands, open files, read git state, or push anything to a panel. `summarizeParams` for the audit log is at `plugin-host-methods.ts:121-144`.

### 4.4 Events and payloads

Delivery: events listed in the manifest `contributes.events` are delivered after the plugin is approved, and they start the worker if it is not running. Events subscribed dynamically via `events.subscribe` are delivered only if the worker is already running (`plugin-event-delivery.ts:27-47`). Payloads are bounded projections, validated by `PLUGIN_EVENT_PAYLOAD_SCHEMAS` (`src/shared/plugins/plugin-events.ts`). Worktree events are for Git worktrees only, folder workspaces are skipped (`src/main/startup/main-process-pty-startup.ts:5-8`).

```ts
// worktree.created                       (plugin-events.ts:11-18)
{ worktreeId: string, path: string, branch: string }        // branch is required here, may be ""
// worktree.removed                       (plugin-events.ts:20-26)
{ worktreeId: string, path: string }                         // no branch
// agent.status.changed                   (plugin-events.ts:28-48)
{ worktreeId: string | null, paneKey: string,
  state: string,                    // free string, "combined status the user sees"; 'working' while main agent or any live child works
  receivedAt: number,               // ms epoch, host clock
  mainAgent?: { state: string,
                outcome?: string,   // only while state is 'done'; e.g. 'interruption', 'unconfirmed'
                stateStartedAt: number } }   // ms epoch, stamped by the agent's own host
```

Wiring: agent status is tapped from the hook pipeline (`src/main/startup/main-process-plugins.ts:163`); worktree events from the runtime lifecycle tap (`:163-166`). The exact set of `state` string values is not enumerated in the payload schema; our worker types them as a union plus `string`, which is fine. **Unverified:** the list of values the hook pipeline emits.

### 4.5 Lifecycle, shutdown, logging

1. Lifecycle: `init` (host sends `pluginId, pluginRoot, mainEntry, grantedCapabilities`) then `activate` then `ready`; later `invokeCommand`, `deliverEvent`, `hostResult`, and finally `shutdown` (`plugin-host-protocol.ts:11-53`).
2. On `shutdown` the runtime calls `deactivate()` (errors are logged), then `exit(0)`; the host SIGKILLs after a 2 s grace (`plugin-host-runtime.ts:188-199`, `plugin-host-process.ts:18`). Keep `deactivate` fast. A worker is shut down on idle reap (5 min), disable, remove, plugin-system off, or a spawn-spec change (see 6.3).
3. An uncaught exception or unhandled rejection sends `fatal` and exits 1 (`plugin-host-entry.ts:22-35`). A rejected promise inside an event handler is caught and logged as an error (`plugin-host-runtime.ts:164-168`); one inside a command handler is returned as the command error. Any unhandled one still kills the worker, so wrap fire-and-forget async work.
4. Logging sources, all captured into one per-plugin ring buffer: `orca.log()` (level info), worker `stdout` (info), worker `stderr` (error), and host-side warnings, e.g. dropped events (`plugin-host-runtime.ts:115-117`, `plugin-host-process.ts:101-102`, `plugin-worker-output-buffer.ts:6-9`, `plugin-event-delivery.ts`). So plain `console.log` works. `console.error` is shown as error level. A line is capped at 8192 chars.

---

## 5. Storage

### 5.1 `storage.*` and `settings.*` (worker only)

1. Backed by one JSON file per plugin per store: `<userData>/plugins-data/<publisher>.<id>/storage.json` and `.../settings.json` (`src/main/plugins/plugin-storage-store.ts:11-15, 21-26, 33-39`; `plugin-discovery.ts:71-73`). `userData` is Electron's per-profile userData directory (`src/main/orca-profiles/profile-storage-paths.ts:18-29`). The literal macOS folder name (likely under `~/Library/Application Support/`) was not confirmed: **unverified**.
2. Per-plugin isolation: the path is built from the host-bound qualified plugin key, validated by `isQualifiedPluginKey`; a plugin cannot name another's directory (`plugin-storage-store.ts:21-26`, and the key is bound host-side in `plugin-host-methods.ts:34-36`).
3. Value type: any JSON (`z.json()`), key: string (not `__proto__`, `prototype`, `constructor`) (`plugin-host-api.ts:60-66`). Limits: 256 KB per value, 5 MB per file, 1024 keys (`plugin-host-api.ts:68-70`, enforced `plugin-storage-store.ts:87-101`). "Honest key-value store, not a database" (`plugin-host-api.ts:67`).
4. Whole-file read-modify-write on every `set`/`delete` (`plugin-storage-store.ts:77-116`). A file that exists but cannot be read is never overwritten (`:41-63`). A corrupt file resets to `{}`; an over-limit file reads as `{}` (`:47-49, 60`).
5. `storage` and `settings` are separate files and separate capabilities, but the same mechanism. There is no settings UI or schema; "settings" are just a second KV file the worker can read and write.
6. `secrets.*` store per key ciphertext via Electron safeStorage in a separate vault file; no plaintext fallback (`plugin-secrets-store.ts:11-24`).
7. Removal passes `pluginsDataDir` to `removeInstalledPlugin` (`ipc/plugins.ts:211-217`), so plugin data is most likely deleted with the plugin (**inferred**, function body not read).
8. A panel cannot reach any of this (`panel: false`).

### 5.2 Arbitrary file access

1. Panel: none. No `fetch`, no storage, no file API (CSP + opaque origin, 3.2-3.3).
2. Worker: yes, unrestricted in practice. It is a normal Node process running as the user, with no `--permission` flags or sandbox (`execArgv: []`, `plugin-host-process.ts:95`; a search for permission or sandbox terms in `src/main/plugins` finds only unrelated text). The consent model treats the worker as "trusted Node code" (`plugin-consent-fingerprint.ts:19-29`) rather than restricting it. `HOME` is passed (`plugin-worker-env.ts:10`), so `~/.matrixkoder/` and any repo path are reachable. No capability is needed or checked for filesystem or network use.
3. Practical limits on the worker file route: the worker is not told where the focused repo is (`readContext` has no path). The `worktree.created` and `worktree.removed` payloads carry `path`, but `agent.status.changed` only has `worktreeId`, which "embeds provider paths" and is intentionally not parsed by the public projection (`plugin-host-method-bindings.ts:78-79`). So a repo-local `.matrixkoder/` is only discoverable via configuration or `worktree.created` events (**inferred**).
4. Our plugin root: installed plugins live at `<userData>/plugins/<publisher>.<id>/<hash>/` and are hash-verified on load (immutable, `plugin-discovery.ts:26-36`, `plugin-content-integrity.ts:17-34`); do not write there. Dev-path plugin trees are mutable and unverified (`:16`).

---

## 6. Dev workflow

### 6.1 Load a dev plugin from a path

1. Turn on the plugin system (`pluginSystemEnabled`, off by default).
2. Settings, Plugins, "Development", paste the folder path, "Add path" (`src/renderer/src/components/settings/PluginDevelopmentSection.tsx:43, 63-71, 116-119`). The path is stored in the `devPluginPaths` setting ("Local directories loaded as dev-mode plugins (manifest hot-reload)", `global-settings-types.ts:375-376`). Changing either setting triggers a refresh (`src/main/ipc/plugins.ts:99-106`). The directory must contain `orca-plugin.json` at its root; discovery reads it directly (`plugin-discovery.ts:236-241`; dev plugin with an installed plugin's identity wins, two dev paths with one identity collide, `:240-241`).
3. The plugin appears in the plugin list as pending until you approve its capabilities (2.2). Workers run on the desktop host; paths are desktop paths (`PluginDevelopmentSection.tsx:69`).
4. Alternatives: install from a local path or git URL (`plugins:install`, `ipc/plugins.ts:175-201`) copies a hash-addressed immutable tree; use the dev path for iteration.
5. Our `scripts/stage-plugin.mjs` was not part of this research.

### 6.2 What reloads automatically (watcher)

1. The dev watcher subscribes to each dev root recursively (macOS: parcel watcher), debounces 300 ms, then runs a full `refresh()` (`src/main/plugins/plugin-dev-watcher.ts:55-102, 234-242`; `plugin-service-housekeeping.ts:29-37`).
2. `refresh()` rediscovers manifests, notifies the renderer (`plugins:changed`), reconciles workers (`plugin-service.ts:126-184`).
3. Panel: `PluginPanel` re-reads the entry on every change event; if the HTML differs from the loaded copy, the iframe is rebuilt with a new document revision (`PluginPanel.tsx:128-168`). So editing `web/index.html` reloads the panel within roughly a second, and panel state resets.
4. Worker: reconcile restarts a worker only if its spawn spec changed. The spec is compared on `pluginKey`, `rootDir`, `mainEntry`, the full JSON of the manifest, and the sorted granted capabilities (`plugin-worker-spawn-spec.ts:5-41`; `plugin-worker-controller.ts:119-131`). The worker's file contents are not part of the spec. **Inferred from code, not run:** rebuilding `out/worker.js` alone does NOT restart an already-running worker. To pick up new worker code do one of: bump `version` (or any manifest field) in `orca-plugin.json`, disable then re-enable the plugin in Settings, or wait for the 5-minute idle reap (next trigger re-forks).
5. Manifest edits that change capabilities or add `main` change the consent fingerprint and need re-approval (2.2).

### 6.3 Where logs appear

1. Per-plugin in-memory ring buffer of the last 200 lines, `{ts, level, line}` (`plugin-log-buffer.ts:3, 46-52`; type `PluginHostLogLine` at `src/preload/api/plugin-host-api.ts:73-77`). It is read through `plugins:getLogs` (`ipc/plugins.ts:232-234`) and the Settings plugin row (`src/renderer/src/components/settings/use-plugin-logs.ts`). Not persisted to disk (inferred: ring buffer only); cleared on removal; lost on app restart.
2. Sources: see 4.5. Activation errors (undeclared command, missing entry, integrity failure, consent stale) show as the plugin's `error` and status (`errored`, `invalid`, `pending`...) in the list (`plugin-host-api.ts:20-28, 30-45`).
3. Panel (iframe) console output goes to the Electron renderer DevTools console, not to the plugin log (**unverified**; standard iframe behaviour).

---

## 7. Corrections to earlier notes

### 7.1 `.matrixkoder/inbox/research/orca-plugin-architecture.md`

Right: manifest `main` + `activate(context)` / `deactivate()`; context members `commands.register`, `events.on`, `host.call`, `grantedCapabilities`, `log`; panel sandbox flag `allow-scripts`; the CSP string (matches exactly, `plugin-panel-shell.ts:20-22`); the 7 capability kinds; the `orca-panel-action` request shape; the three event names; fork-based worker.

Wrong or misleading:

1. Diagram label "postMessage (Tokens, Actions)": tokens are not sent over postMessage. They are baked into the iframe `srcDoc` as `:root{...}` at frame build, and the frame is rebuilt when the theme changes (`PluginPanel.tsx:42-46, 64-69`).
2. Token list shows 10 of the 20; incomplete, not wrong. Full list in 3.6. It also omits that only the 20 are exposed.
3. "Worker and panel bridge methods available via `host.call(method, params)`" followed by all 14 methods: wrong for the panel. The panel gets 3 (`workspace.readContext`, `terminal.sendText`, `notifications.show`). Panels use `postMessage`, not `host.call`; `host.call` exists only in the worker (`plugin-host-api.ts:261-265`).
4. `terminal:send` described as "text and keystrokes": text only, max 4096 chars, explicit terminal id inside the focused worktree.
5. Methods are listed with arrow results that are really params (`terminal.sendText -> { terminalId, text, enter }`, `notifications.show -> { title, body }`). Real results are `{accepted}` and `{delivered}`.
6. `events:subscribe` "Receive real-time push events": push goes to the worker only, never the panel. It is also mandatory in the manifest whenever `contributes.events` is non-empty.
7. `settings:own` "user-configurable plugin settings" implies a settings UI; none exists. It is a KV file reachable only from the worker.
8. Section 4 step 1: "Call `workspace.readContext` -> active terminalId" is wrong. It returns the list of terminal ids of the focused worktree; there is no active/selected terminal concept (`plugin-host-api.ts:30-31`).
9. Section 4 step 2: panel calling `orca terminal read` (CLI) is not possible. The panel has no process or network access, and there is no host-API method that reads terminal output. Only the worker could shell out, and the panel cannot call the worker.
10. Section 4 step 3: running an LLM enhancer (Claude, DeepSeek) from the panel is not possible for the same reasons (`connect-src 'none'`). It would have to run in the worker, which the panel cannot reach.
11. "Interactive Review (`enter: false`) ... writes the prompt into the active terminal's readline buffer": `enter` defaults to false (`plugin-host-api.ts:50`), but the "active terminal" part is wrong (explicit id), and the buffer behaviour is **unverified**.
12. Missing from the note: the master switch `pluginSystemEnabled` (default off); the 64 KB / 30-per-10-s panel budget; the ping/pong watchdog (a busy panel is suspended); that panels have no persistence; timeouts and idle reap of the worker; the 4096-char text cap.
13. "reverse-engineered from the Orca v1.4 application runtime": the facts above are now confirmed from source at `orca/main`; the engines floor is `>=1.4.0`.

### 7.2 `.matrixkoder/inbox/research/orca-automations-and-commands.md`

This note is about the Orca CLI and the scheduler, not the plugin API; none of it is callable from a plugin (the plugin host API has no automations, CLI or orchestration methods, see 4.3).

Confirmed against `docs/site/content/docs/cli/automations.mdx` and `src/cli`: trigger presets, cron and RRULE (`automations.mdx:23`); `--timezone` (`:23`); `--schedule` is an alias of `--trigger` (`src/cli/flag-help-text.ts:91`); precheck, non-zero exit skips the run (`automations.mdx:43`); `--workspace-mode existing|new-per-run` (`flag-help-text.ts:110`, `src/cli/handlers/automation-handler-flags.ts:294-306`); `--base-branch` exists (`flag-help-text.ts:5`); `--host local|ssh:<id>|runtime:<id>` (`automations.mdx:74`); `--extra-agent-args` (`:107-124`); `automations list/create/run/edit/remove` (`:142, 149`); `--agent`, `--comment`, `--for exit|tui-idle`, `--element`, `--format <png|jpeg>` flags (`flag-help-text.ts:4,7,25,115,125`); spec paths `worktree ps`, `project setup-clone`, `orchestration worker-start`, `orchestration task-list` (`src/cli/specs/*.ts`).

Wrong:

1. `orca automations runs <id>`: the real form is `orca automations runs --id <automationId>` (`automations.mdx:150`, `src/cli/automation-format.ts:132`). `run <id>` is positional and correct.
2. `--extra-agent-args` example "`--model opus --effort high --add-dir docs`" is presented as general: extras accept only model and effort options (plus Claude's `--add-dir`) for Claude, Codex, CodeBuddy, Cursor, Grok, OMP; permission, config, prompt and session options are rejected; they require a fresh session (cannot combine with `--reuse-session`); the value must be passed with `=` (`automations.mdx:120-124`).
3. "`--workspace-mode` ... `existing` runs inside `--workspace <selector>`": the docs describe targets through `--repo`, `--workspace`, `--project`, `--host`; the `workspace-mode` flag exists in the CLI but is not in the public docs page. Semantics beyond the two values are **unverified**.
4. Omits `automations show <id>` and `--disabled` / `--enabled`, `--missed-run-grace-minutes`, `--reuse-session` (`automations.mdx:86-134`). Not errors, just gaps.

Unverified (not checked): the semantics of `orca orchestration send/check --wait/reply/ask`, `orca tab create`, `orca snapshot`, `orca click`, `orca fill`, `orca terminal create`: only that some spec paths and flags exist.

---

## 8. What this means for MatrixKoder

### 8.1 Live data for the dashboard

The panel cannot receive worker data, and the worker cannot call the panel (section 0, facts 2-3). Options, best first:

1. Patch our Orca build (we have the Orca source as a remote) to add a bridge. Smallest viable change, **design only, untested**: add a panel-callable method such as `plugin.invokeCommand` to the spec table (`plugin-host-api.ts`, `panel: true`, bound to the existing worker `invokeCommand`), and optionally a host-to-panel `orca-panel-event` message sent from `PluginPanel.tsx` when the worker emits state. Then: worker keeps state (agent status, worktrees, lanes) in memory/storage; panel polls or is pushed. This changes Orca itself, so it only works for our fork, not stock Orca.
2. On stock Orca, the only live host data a panel can get is `workspace.readContext` polling (branch, displayName, terminal ids). Poll at most every 2-3 s: the budget is 30 messages per 10 s per plugin, shared across all calls. No agent-status feed reaches the panel.
3. Stopgap for dev-path installs only (**inferred, hacky**): the worker writes a data snapshot into the panel file inside the dev plugin dir (for example regenerates `web/index.html`, or a `<script>` data block). The dev watcher then reloads the panel within about 1 s (6.2), and the panel's in-memory state resets each time. It fails for installed (hash-verified) plugins, and it needs the 10 MB panel cap respected. We do not recommend it as the production path.
4. Do not plan on: panel `fetch`/WebSocket to a local server (`connect-src 'none'`), a panel localStorage cache, or a panel-triggered `orca` CLI call.

Events in the worker are fine for worker-side logic (notifications, writing a status file for MK scripts, calling `terminal.sendText` or `notifications.show`).

### 8.2 Persisting settings

1. Worker-side store: `settings.get/set` (needs `settings:own`, which our manifest does not declare yet) at `<userData>/plugins-data/interstellar.matrixkoder/settings.json`; KV only, 256 KB per value, 5 MB total, 1024 keys. Right for plugin-owned values the worker consumes. The panel cannot read or write it without option 8.1-1.
2. `mk-settings.json` vs a database: the plugin API gives no database, and says storage is "an honest key-value store, not a database" (`plugin-host-api.ts:67`). If external tooling (`mk-state.py`, other MK processes) must read settings, use a plain JSON file written by the worker, because nothing outside Orca can read `plugins-data` safely. Location: `~/.matrixkoder/mk-settings.json` is reachable (HOME is passed); a repo-local `.matrixkoder/` needs the repo path, which only `worktree.created` carries (5.2-3). A sqlite db is possible only if a native module is bundled into `out/worker.js` (50 MB cap); we see no need.
3. Suggested split: canonical settings in `~/.matrixkoder/mk-settings.json` (worker reads and writes, atomic write, small), mirrored into `settings.json` via `settings.set` only if we want Orca to keep a copy. Until the bridge in 8.1-1 exists, the panel Settings screens can only be in-memory (state resets on theme change or panel reload).
4. Secrets (API keys for the prompt copilot) belong in `secrets.*` (needs `secrets` capability, worker-only), never in `mk-settings.json`.

### 8.3 Smaller items found while reading our files

1. `orca-plugin.json` is valid against the schema as far as read: alias command `toggle-dashboard` (`sidebar.right.toggle`) needs no worker, `sweep-lanes` is registered by the worker, keybinding `when` matches the command `context`, events plus `events:subscribe` are consistent. Our `PluginContext` type in `src/worker.ts` matches the real API. Not yet declared: `settings:own`, `secrets` (add only when used; adding them changes the consent fingerprint and re-prompts).
2. `WorktreeLifecycleEvent.branch?` in `src/worker.ts` is optional; in source it is required (possibly empty string) on `created` and absent on `removed` (`plugin-events.ts:11-26`). Harmless.
3. `agent.status.changed` fires for every pane; `state: 'done'` currently triggers a notification per pane turn in the worker. Rate limits on `notifications.show` were not found in source (only the generic audit log): **unverified**.
4. `web/index.html` is about 450 KB, far below the 10 MB panel cap (`plugin-artifact-validation.ts:9`).
