# How Orca stores and exposes settings (research for MK settings)

Date: 2026-10-24. Read-only research. Nothing in Orca or the repo was changed.

Citation forms: `orca/main:<path>:<line>` is Orca source on the `orca` git remote (package.json version 1.4.214). `~/...` is the user's real Orca data folder (`~/Library/Application Support/orca`, called `$ORCA` below), whose app is 1.4.239 (`orca --version`). The source is 25 versions older than the installed app, so anything marked "unverified on 1.4.239" may have moved.

Tool notes: `orca --help` has no `plugin` or `settings` subcommand (`orca plugin --help` and `orca settings --help` both print `Unknown command`). Settings can only be read from disk or the Settings UI. Two attempts of mine failed on my own typos (a SQL column list and a shell glob); fixed on retry, no tool failed three times.

---

## 1. Where Orca keeps things on disk

| What | Where | Format |
|---|---|---|
| Global settings | `$ORCA/profiles/local-default/profile-state.db`, table `profile_state_documents`, row `domain='settings'` (9.8 KB, 222 top-level keys) | SQLite (WAL) holding one JSON document per domain. Tables: `profile_state_meta`, `profile_state_documents(domain, payload, domain_version, revision, updated_at, content_hash)`, `profile_state_automation_runs*`. Schema: `orca/main:src/main/persistence/profile-state/profile-state-database-schema.ts:17-60` (schema v3). |
| Other app state | same DB, other domains: `repos`, `projects`, `worktreeMeta`, `ui`, `workspaceSession`, `sshTargets`, `automations`, `onboarding`... | JSON payloads, same table |
| Rolling backups | `profile-state.db.backup.<ts>-<uuid>.db` (hourly, 5 kept) next to the DB | SQLite copies |
| Small side files | `profiles/local-default/active-view.json`, `orca-secret-protection.json`, `orca-github-cache.json` | JSON |
| Per-repo config | `orca.yaml` and `.worktreeinclude` at the repo root; optional `.orca/issue-command` | YAML. Doc: `orca/main:docs/site/content/docs/model/orca-yaml.mdx`. Loader: `orca/main:src/main/hooks.ts:102,131`. |
| Installed plugins | `$ORCA/plugins/<publisher>.<id>/<content-hash>/` plus a `current` pointer file; `$ORCA/plugins/plugins.lock.json` | JSON lockfile (`version`, `plugins{ pluginKey, version, source, contentHash, installedAt, capabilityHash }`) |
| Plugin data dir | `$ORCA/plugins-data/<publisher>.<id>/` | Code: `orca/main:src/main/plugins/plugin-storage-store.ts:20-27` |
| Plugin `storage.*` | `plugins-data/<key>/storage.json` | Flat JSON key-value, written with `writeSecureFile` (`plugin-host-service-bindings.ts:69-76`) |
| Plugin `settings.*` | `plugins-data/<key>/settings.json` | Same KV store class, different file (`plugin-host-service-bindings.ts:82-84`) |
| Plugin `secrets.*` | `plugins-data/<key>/secrets.json.enc` | Encrypted (`plugin-secrets-store.ts:34`) |
| Plugin audit log | `$ORCA/plugins-data/audit.log` | JSONL, `{ts, actor:"plugin:<key>", method, summary, outcome}`. Our plugin's `notifications.show` calls appear here (real file). |
| Marketplaces | `$ORCA/plugins-data/marketplaces/sources.json` and `snapshots/*.json` | JSON |

Facts about the user's machine (all real files):
1. `plugins.lock.json` lists `interstellar.matrixkoder` 1.0.0, source `local-path` = `/Users/rohits/Development/orca-matrixkoder/plugin` (installed from our repo), and `stablyai.orca-navigation-shortcuts` (bundled).
2. `plugins-data/` has no `interstellar.matrixkoder/` folder. MK has never called `storage.*` or `settings.*` yet.
3. Orca does not use a `settings.json` for itself. The older name is only in tests and migrations; settings now live in SQLite.

KV limits for plugin storage and settings (`orca/main:src/shared/plugins/plugin-host-api.ts:68-70`): 256 KiB per value, 5 MiB per file, 1024 keys. The code comment says "an honest key-value store, not a database". Unreadable files are never overwritten (`plugin-storage-store.ts:42-60`); corrupt files reset to `{}`.

---

## 2. Settings schema (global, relevant groups)

Types: `orca/main:src/shared/global-settings-types.ts` (549 lines); defaults: `orca/main:src/shared/default-global-settings.ts` (293 lines). Key names below match the real DB payload unless marked.

1. Worktrees: `workspaceDir`, `nestWorkspaces`, `worktreeVisibilityDefaults`, `branchPrefix`, `branchPrefixCustom`, `refreshLocalBaseRefOnWorktreeCreate`, `autoRenameBranchFromWork`, `newWorkspaceSetupOnly` (deprecated, line 360), `compactWorktreeCards` (real DB), `jiraIssueKeyCasing`. Per-repo base ref is `orca repo set-base-ref` (CLI), not a global key. Repo setup/archive scripts, default tabs and shared dirs come from `orca.yaml` (see below), not settings.
2. Terminals: `terminalFontSize`, `terminalFontFamily`, `terminalCursorStyle`, `terminalThemeDark`, `terminalThemeLight`, `terminalUseSeparateLightTheme`, `terminalDefaultShell`, `terminalShortcutPolicy` (`orca-first`), `terminalRightClickToPaste`, `terminalInlineImages`, `terminalGpuAcceleration`, many more (all `terminal*`, `global-settings-types.ts:141-145,290`).
3. Agents: `defaultTuiAgent` (line 359), `disabledTuiAgents` (line 363: agents hidden from the picker; detection stays a raw PATH snapshot), `agentCmdOverrides` (418), `agentDefaultArgs` (428), `agentDefaultEnv` (430), `agentPermissionDefault` and `agentPermissionOverrides` (real DB: `full-access`, per-agent `own`), `agentStatusHooksEnabled` (434), `agentWorkspaceTrustEnabled` (442), `keepComputerAwakeWhileAgentsRun`, `experimentalAgentHibernation`, `agentHibernationIdleMs`. Per-agent selected models exist only inside `commitMessageAi` and `sourceControlAi`, not as a general "default model per agent".
4. Theme / appearance: `theme` (`'system'|'dark'|'light'`, line 78; real value `dark`), `appFontFamily` (86), `leftSidebarAppearanceMode`, `leftSidebarTintColor`, `leftSidebarTintOpacity`, `uiLanguage`, `appIcon`, `editorMinimapEnabled`, `editorWordWrap`. Docs mention accent colour and density (`settings.mdx:25`), but I found no matching key in the real payload: unverified.
5. Notifications: one object `notifications` (`orca/main:src/shared/notification-settings-types.ts:7-28`): `enabled`, `agentTaskComplete`, `terminalBell`, `suppressWhenFocused`, `customSoundId`, `customSoundPath`, `customSoundVolume`, `mutedNotificationSourceIds[]`, `notifyHiddenWorkspaces`. No quiet-hours field exists.
6. Plugins (`global-settings-types.ts:366-376`): `pluginSystemEnabled` (master switch, real value `true`), `disabledPlugins[]` (qualified keys), `pluginConsents{ "<publisher>.<id>": "sha256-..." }` (consent fingerprint of capabilities plus worker trust; a change re-prompts), `devPluginPaths[]`.

Per-repo `orca.yaml` (doc `orca-yaml.mdx`): keys `scripts.setup`, `scripts.archive`, `setupAgentStartupPolicy` (`start-immediately|wait-for-setup`), `issueCommand`, `defaultTabs[{title,command,color}]`, `worktree.sharedDirectories[]`, `environmentRecipes[]`. Unknown keys do not configure anything. File limit 256 KiB. Read from the primary checkout vs the new worktree depending on key (table in the doc). This repo has no `orca.yaml` or `.orca/`. Consequence: MK should not put its own keys in `orca.yaml` (they would be ignored, and the file is committed and shared).

---

## 3. Theme tokens a plugin panel receives

1. Panels render in an iframe with `sandbox="allow-scripts"` only (`orca/main:src/renderer/src/components/right-sidebar/PluginPanel.tsx:226`), via a host shell that injects tokens and a CSP (`src/shared/plugins/plugin-panel-shell.ts`).
2. Injected as CSS custom properties on `:root` inside `<style>` (`plugin-panel-shell.ts:66`), read from Orca's computed styles (`plugin-panel-design-token-css.ts:9-19`). The allowlist `PANEL_DESIGN_TOKEN_ALLOWLIST` (`plugin-panel-shell.ts:34-55`) is exactly 20 names: `--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --destructive-foreground --border --input --ring --radius`.
3. Light/dark: the shell `<html>` gets a class (`dark` or `light`) from `document.documentElement.classList.contains('dark')` (`plugin-panel-design-token-css.ts:21-23`). Orca's own switch is `orca/main:src/renderer/src/lib/document-theme.ts:71`.
4. Live changes: a MutationObserver on the root re-bakes the snapshot, and the panel iframe is remounted when the baked values change (`use-plugin-panel-theme-revision.ts:10-33`). So a theme switch reloads the panel and drops in-panel state unless the state is saved elsewhere.
5. Not available: terminal theme colours, `appFontFamily`, sidebar tint, accent, status colours (success / warning). The settings values `theme`, `appFontFamily`, `terminalTheme*` cannot be read by a panel (the `settings.*` host methods are plugin-private; see 4).
6. For "Follow Orca theme": map MK's ground = `--background`, card = `--card`, error = `--destructive`, text = `--foreground`, muted = `--muted-foreground`, line = `--border`, you/accent = `--primary`. MK's `done` and `live` greens have no Orca token and must stay MK-defined. Only usable in CSS (`var(--card)`); the panel cannot read Orca's `theme` string, but it can read `html.dark`.

---

## 4. Can a plugin add a section to Orca's Settings UI?

No. Evidence:
1. The manifest `contributes` object is `.strict()` and only accepts `panels, commands, events, languagePacks, keybindings, vmRecipes, agents` (`orca/main:src/shared/plugins/plugin-manifest.ts:97-114`). There is no `settings` contribution. `git grep contributes.settings|settingsSchema` found nothing.
2. Settings panes are hard-coded in the renderer. The only plugin-related UI is Orca's own Settings > Plugins section (`settings-advanced-section-renderers.tsx:87-100`), which lists plugins with enable/disable, consent, logs, install, update, rollback (`PluginSettingsRow.tsx`, `PluginsSettingsSection.tsx`). It shows no per-plugin settings form.
3. Capability `settings:own` ("Read and change the plugin's own settings", `plugin-capabilities.ts:15-23,43`) only gives the plugin's worker a private KV (`settings.get` / `settings.set`); it has no UI.
4. Hard limit for our Settings screen: panel-callable actions are only `workspace.readContext`, `terminal.sendText`, `notifications.show` (the `panel: true` rows in `plugin-host-api.ts:122-252`; `isPluginPanelAction` gates the bridge at `plugin-panel-bridge.ts:42`). `storage.*`, `secrets.*`, `settings.*`, `events.subscribe` are `panel: false` (worker only). The panel CSP has `connect-src 'none'` (`plugin-panel-shell.ts` CSP constant) and the iframe has an opaque origin, so `fetch` is blocked and `localStorage` is almost certainly unavailable (unverified here, standard sandbox behaviour). Messages are capped at 64 KiB and 30 per 10 s (`plugin-panel-bridge.ts:22-23`).
5. I found no host method for a panel to send a message to its own worker (unverified on 1.4.239). Our panel (`plugin/web/index.html`) currently makes zero bridge calls (`grep orca-panel-action` = 0).

So MK must host its Settings screen inside its own panel (as the design canvas already does). The persistence path from panel to disk is the open technical risk (see 5).

Things the plugin CAN contribute that overlap Settings: `contributes.keybindings` (we ship `Mod+Alt+M`; Orca shows these in the consent dialog and Plugins list) and `contributes.agents` (agent profiles, `plugin-manifest.ts:110-113`; not studied in depth, unverified what it does in the agent picker).

---

## 5. Comparison with our 7 Settings screens

Source: `panel/screens/Settings.dc.html` (General), `SettingsAgents`, `SettingsRouting`, `SettingsSafety`, `SettingsAlerts`, `SettingsLook` (tab "Theme"), `SettingsShortcuts`.

| Tab | Orca already owns (do not duplicate) | MK-only |
|---|---|---|
| General | Project list and default base ref per repo (`orca repo set-base-ref`); app version/updates | Mode (Orchestrator/Solo), open-on-start tab, MK data folder, plan inbox, export/import, reset, about |
| Agents | Detection, enable/disable (`disabledTuiAgents`), command override, args, env, permission mode; usage bars in Orca's status bar (docs, unverified depth) | "MK may route to this agent", default model + effort per agent for routing, quota thresholds |
| Routing | Nothing | Route with Jev, fallback rule, ask before destructive, tier table, lanes at once, spare-Claude threshold |
| Safety | `agentWorkspaceTrustEnabled`, `agentPermissionDefault` are related but different | Guard toggles, protected branches, never-run commands |
| Alerts | Master notifications switch, sound id/volume, mute per source, `suppressWhenFocused`, `notifyHiddenWorkspaces` | Which MK events notify, quiet hours, wake orchestrator, test button (calls `notifications.show`, title max 120, body max 1000) |
| Theme | `theme` light/dark/system, UI font, terminal theme (panel only gets 20 tokens) | Rain on/off, brightness, speed, reduce motion, follow-Orca toggle, text size, density, MK status colours |
| Shortcuts | Real OS-level keybindings (manifest `contributes.keybindings`); Orca terminal shortcut policy | Footer shortcut slots (in-panel only, max 4) |

Upstream MK, today (real files):
1. `~/.matrixkoder/config.json`: `{schema:1, dashboard.{auto_open,chip,toasts}, usage.poll_min, updated}`.
2. `~/.matrixkoder/mk-settings.yaml`: the same four keys flattened (`dashboard.auto_open: true`, `usage.poll_min: 5`).
3. Upstream README/howto: `config.json` is retired; effective value = project DB `settings` row, then global `mk-settings.yaml`, then legacy `project.yaml`, then default. Written only via `scripts/mk-config.py set [--global]`. Each key has `level` (global|project) and `home` (userConfig|yaml); the Settings tab's `scope` is `project|routing|agents|child`. (`~/Development/matrixkoder/README.md` line 80, `docs/howto.md` lines 96 and 123.)

---

## 6. Recommendation

### 6.1 Format: JSON file, not SQLite, not Orca plugin storage as the source of truth

1. JSON file (recommended). Human-editable, easy Export/Import (the General tab already promises it), diffable, and matches Orca's own model (Orca stores settings as JSON documents even inside SQLite). Written atomically (temp file plus rename).
2. SQLite: no. Settings are about 50 flat keys. Upstream already owns SQLite for run data (`mk-overview.db`, per-project `mk-project.db`); a second DB adds locking, migrations and no benefit. A DB is only justified by a history/audit need; none exists.
3. Orca plugin storage (`plugins-data/interstellar.matrixkoder/settings.json`): good as a cache/mirror only. Pros: sanctioned API, per-plugin isolation, audited, encrypted secrets sibling. Cons: worker-only (panel cannot call it), tied to this Orca install, invisible to upstream `mk-*.py` and the MK CLI, wiped on uninstall (not verified: whether data survives uninstall), 5 MiB / 1024 key caps. Use `secrets.*` for any token, never the JSON file.

### 6.2 Where the file lives

1. Global user prefs: `~/.matrixkoder/mk-settings.json` (same folder as upstream `usage.json`, `mk-settings.yaml`). The panel's General tab already shows `~/.matrixkoder` as the data folder.
2. Project policy that should travel with a repo (protected branches, never-run commands, lanes cap): repo-local `.matrixkoder/mk-settings.json`, which overrides the global file. Pros: committable team policy, per-project. Cons: upstream says "the repo keeps no MK data" and keeps per-project settings in `projects/<slug>/mk-project.db`; repo-local files can leak into commits and conflict across worktrees (lanes are worktrees, so a lane would see its own copy). Decision for the caller: either follow upstream (project layer in `projects/<slug>/`) or add the repo-local layer. My pick: global file only for v1, plus the project layer under `~/.matrixkoder/projects/<slug>/` to match upstream resolution order; repo-local is a later opt-in.
3. Do not touch `orca.yaml` for MK keys (ignored by Orca, shared with the team).
4. Overlap with upstream: for keys upstream already defines (routing, agents, safety are upstream `scope`s) write through `mk-config.py set --global` so there is one writer. Keep `mk-settings.json` for panel-only keys (theme, shortcuts, rain, mode). Alternative: replace the YAML with the JSON and migrate; needs an upstream decision (unverified which they prefer).

### 6.3 The blocker to resolve first (spike)

The sandboxed panel cannot read or write any file, storage or settings (section 4.4), and I found no panel-to-worker channel. Options:
1. Spike on 1.4.239: test `localStorage`/`postMessage` from the panel and whether a worker command can be invoked from the panel. Cheap, answers it for good. Recommended first step.
2. Read-only panel, edits through command palette commands or `terminal.sendText` running `mk-config.py set` in a terminal: works today but clunky and visible to the user.
3. Ask Orca upstream for a `panel: true` `settings.*` or a panel-to-worker call: clean, slow, not in our control.

### 6.4 Draft `mk-settings.json`

`O` = Orca owns it (read-only or deep-link to Orca Settings, no MK key). `U` = upstream MK key already exists (route through `mk-config.py`). Others are new MK keys.

```json
{
  "schema": 2,
  "general": {
    "mode": "orchestrator",            // orchestrator | solo
    "openOnStart": "projects",         // tab id
    "dataDir": "~/.matrixkoder",
    "inboxDir": "~/.matrixkoder/inbox",
    "defaultBaseBranch": "O: orca repo set-base-ref"
  },
  "agents": {
    "<claude|codex|agy|opencode>": {
      "routable": true,                // MK-only: may MK hand lanes to it
      "model": "opus 5.5",             // MK routing default (U agents.*)
      "effort": "high",
      "enabledInOrca": "O: disabledTuiAgents",
      "cmdOverride": "O: agentCmdOverrides"
    }
  },
  "routing": {
    "useJev": true,                    // U
    "lowConfidence": "risk-based",
    "askBeforeDestructive": true,
    "tiers": { "trivial": "claude haiku low", "standard": "claude sonnet medium",
               "complex": "claude opus high", "finalReview": "claude fable max" },
    "maxLanes": 3,
    "spareClaudeBelowPct": 30
  },
  "safety": {
    "blockDestructiveGit": true,
    "blockDeleteOutsideWorktree": true,
    "askBeforePush": true,
    "scanDiffsForSecrets": true,
    "protectedBranches": ["main", "release/*"],
    "neverRun": ["git reset --hard", "git push --force", "git clean -fdx", "rm -rf ~", "npm publish"]
  },
  "alerts": {
    "events": { "ask": true, "laneDone": true, "gateFail": true, "runDone": true, "stall": false },
    "desktop": true,                   // MK-only: calls notifications.show
    "sound": "O: notifications.customSoundId",
    "masterSwitch": "O: notifications.enabled",
    "quietHours": { "enabled": true, "from": "22:00", "to": "07:00" },
    "wakeOrchestrator": false,         // U: wake
    "stallMinutes": 10,
    "dashboard": { "autoOpen": true, "chip": true, "toasts": true },   // U (config.json today)
    "usagePollMin": 5                  // U
  },
  "theme": {
    "followOrca": false,               // reads the 20 allowlisted tokens + html.dark
    "rain": { "enabled": true, "brightness": 60, "speed": "normal" },
    "reduceMotion": false,
    "textSize": "M",
    "density": "comfy",
    "colorMode": "O: theme (light|dark|system), only html.dark visible to panel"
  },
  "shortcuts": {
    "footer": ["improve", "jev"],      // max 4 in-panel slots
    "osBindings": "O: manifest contributes.keybindings (Mod+Alt+M today)"
  }
}
```

Backup, reset and migration notes: Export/Import = copy the file; Reset = delete the keys, never plans or runs. On first run, read `config.json` and `mk-settings.yaml` once to seed `alerts.dashboard.*` and `alerts.usagePollMin`.

### 6.5 Settings UI fit with Orca

1. Orca has no slot for MK settings, so keep MK's Settings tabs inside the MK panel; add a short note per tab where Orca owns the setting, with the wording "Set in Orca: Settings > <pane>" (no deep link API for plugins was found: unverified).
2. Orca's Settings > Plugins shows MK's on/off, consent and logs. Anything about enabling/disabling MK itself belongs there, not in MK.
3. Layout should respect the panel's width and the 20 tokens so "Follow Orca theme" is the cheap default; keep the Matrix palette as the MK-branded option.

---

## Unverified list

1. Whether Orca 1.4.239 (installed) differs from source 1.4.214 in panel actions, tokens or the settings schema.
2. Any panel-to-worker messaging channel.
3. `localStorage` / `IndexedDB` behaviour in the sandboxed panel.
4. Whether plugin data survives uninstall.
5. Whether a worker has any filesystem sandbox (spawn spec shows only an env allowlist: `PATH, HOME, TMPDIR...` in `plugin-worker-env.ts`; so reading `~/.matrixkoder` is expected to work, untested).
6. Accent/density settings keys and the shape of `contributes.agents`.
7. Upstream's preference between `mk-settings.json` and the existing `mk-settings.yaml`.
