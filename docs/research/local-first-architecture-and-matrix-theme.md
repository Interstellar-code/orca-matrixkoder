# Local-First Architecture & Orca Matrix Theme Specification

This document details MatrixKoder's local-first design strategy to avoid cloud lock-in, alongside the complete design and integration specification for the **Matrix Phosphor & Digital Rain Theme** for the Orca IDE.

---

## 1. Local-First Strategy vs. Cloud Artifacts

### The Threat of Vendor Lock-In & Cloud Dependencies
Orca provides an `orca artifacts share` command that uploads Markdown and HTML files to Stably AI's cloud infrastructure (`orca.dev`) behind a short link. While convenient, relying on cloud-hosted artifacts introduces:
- **Commercial Risk & Paywalls:** Potential future subscription tiers, quotas, or service changes.
- **Intellectual Property & Privacy Risks:** Sending proprietary code reviews, bug findings, or architecture briefs to a third-party multi-tenant cloud.
- **Offline Failure:** Loss of review workflows when operating without an internet connection or on air-gapped networks.

### MatrixKoder's Local-First Guarantees
MatrixKoder is architected to be **100% operational offline without any external cloud dependency**:

1. **Local Inbox Plans (`<home>/inbox/`):**
   - High-level feature plans are stored locally as plain Markdown files.
   - MatrixKoder's parser reads them directly from disk, validates the template, and populates the task DAG without cloud roundtrips.
2. **Local Task DAG (`orchestration.db`):**
   - All runs, waves, tasks, subtasks, and inter-agent messages live inside Orca's local SQLite database.
3. **Local Report Rendering via Orca Browser:**
   - When an agent or automation (like `bug-hunt`) produces an HTML report or visual mockup, MatrixKoder uses Orca's embedded Chromium engine to open it locally:
     ```bash
     orca tab create --url "file:///path/to/report.html"
     ```
   - No external upload is required; the report renders instantly inside your Orca workspace.
4. **Self-Hosted Sharing & API Overrides:**
   - Orca natively supports overriding the artifact upload service via `--api-url <url>` or the `ORCA_ARTIFACTS_API_URL` environment variable.
   - If team-wide sharing is ever needed, the publisher can be repointed to a self-hosted S3/MinIO endpoint, a local LAN server, or a Tailscale Funnel.
5. **Opt-in Cloud Convenience:**
   - Public sharing via `orca artifacts share` is kept strictly as an optional one-click button (`[Share via Orca Cloud]`), never a hard workflow dependency.

---

## 2. The Matrix Theme: Transforming Orca

MatrixKoder introduces a comprehensive **Matrix Cyberpunk Phosphor Theme** that skins both the MatrixKoder side panel and the entire surrounding Orca IDE.

```
┌────────────────────────────────────────────────────────┐
│                   ORCA MATRIX THEME                    │
├──────────────────────────┬─────────────────────────────┤
│ 1. Terminal Engine       │ 2. Workbench Tokens         │
│    (custom:matrix-phosphor)│   (CSS Variables)           │
│    • Background: #050805 │    • --background: #050805  │
│    • Foreground: #00ff41 │    • --foreground: #00ff41  │
│    • Cursor:     #00ff66 │    • --primary:    #00ff41  │
│    • Selection:  #003b00 │    • --card:       #08160b  │
│    • Ansi Green: #00ff41 │    • --border: rgba(0,255,65│
├──────────────────────────┴─────────────────────────────┤
│ 3. MatrixKoder Panel (HTML5 Canvas Rain)               │
│    • Falling katakana / hex digital rain animation     │
│    • Translucent dark glass HUD cards (rgba 0.88)      │
│    • Neon green glow (text-shadow: 0 0 8px #00ff41)    │
└────────────────────────────────────────────────────────┘
```

### A. Terminal Theme (`custom:matrix-phosphor`)
Orca supports custom terminal color schemes via its `custom:` prefix. We define the Matrix Phosphor palette:

```json
{
  "theme": "custom:matrix-phosphor",
  "background": "#050805",
  "foreground": "#00ff41",
  "cursor": "#00ff66",
  "cursorAccent": "#050805",
  "selectionBackground": "#003b00",
  "selectionForeground": "#00ff66",
  "black": "#050805",
  "red": "#ff3344",
  "green": "#00ff41",
  "yellow": "#ffb700",
  "blue": "#00b4d8",
  "magenta": "#d946ef",
  "cyan": "#00f5d4",
  "white": "#b1ffc2",
  "brightBlack": "#153315",
  "brightRed": "#ff5566",
  "brightGreen": "#50ff7b",
  "brightYellow": "#ffd166",
  "brightBlue": "#38bdf8",
  "brightMagenta": "#f472b6",
  "brightCyan": "#70e000",
  "brightWhite": "#ffffff"
}
```

### B. Workbench Design Tokens (Orca Outer Frame)
Orca injects design tokens into its UI components and plugin panels. The Matrix theme maps these variables:
- `--background`: `#050805` (Deep pitch-black)
- `--foreground`: `#00ff41` (High-visibility terminal phosphor green)
- `--card`: `rgba(8, 22, 11, 0.92)` (Translucent dark HUD glass)
- `--card-foreground`: `#a5f3b7` (Soft readable green)
- `--primary`: `#00ff41`
- `--primary-foreground`: `#020502`
- `--border`: `rgba(0, 255, 65, 0.3)`
- `--radius`: `2px` (Sharp cyber corners instead of soft rounded rectangles)

### C. Digital Rain Background Canvas
The MatrixKoder sidebar panel mounts a hardware-accelerated 2D canvas in the background:
- **Low Overhead:** Runs at a throttled 22 FPS using semi-transparent clear rects (`rgba(2, 5, 2, 0.12)`) to create the phosphor fade trail.
- **Readable Foreground:** Operates at `0.18` opacity with blurred dark glass card backdrops so code, diffs, and text retain 100% legibility.
- **Toggleable:** Includes an instant `[Rain: ON / OFF]` button in the top toolbar.

### D. Packaging & Distribution
1. **Bundled in MatrixKoder:** The Matrix theme tokens and canvas are baked directly into `web/index.html` and the plugin assets.
2. **Global Orca Contribution:** When Orca enables its deferred theme marketplace categories (`contributes.themes`), MatrixKoder will expose a standalone `matrix-phosphor-theme` package to theme the entire Orca IDE shell natively.
