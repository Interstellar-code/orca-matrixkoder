# MatrixKoder for Orca: Panel Mockups & Theme Design

This document details the redesigned **MatrixKoder** side panel for Orca, taking advantage of Orca's native capabilities (omitting redundant file trees and quota pollers, integrating with native worktrees and automations), along with the design for the **Matrix Rain & Phosphor Cyberpunk Theme**.

---

## 1. What Gets Streamlined in Orca

By migrating MatrixKoder from a terminal CLI mod into a native Orca plugin, we shed significant weight:

| Dropped / Offloaded | Replaced By | Why It's Faster |
| :--- | :--- | :--- |
| **Custom React Ink Filetree** | **Orca's Built-in File Explorer & Diff Tabs** | Saves hundreds of lines of tree traversal code and avoids terminal rerenders. |
| **Manual `herdr` Terminal Splits** | **Orca Native Worktree Management** | Orca manages git worktrees and multi-agent panes natively without terminal fighting. |
| **Ad-Hoc Cron / Polling Scripts** | **Orca Scheduled Automations** (`orca automations`) | Recurring sweeps and sync jobs run via Orca's background scheduler. |
| **Heavy Quota Pollers** | **Lightweight Status Banner** | Keeps the dashboard responsive and focused purely on orchestrating active waves. |

---

## 2. Visual Side Panel Mockups & Tab System

### High-Fidelity Orca IDE & MatrixKoder Panel Mockup

![Orca IDE with MatrixKoder Sidebar](/Users/rohits/.gemini/antigravity-cli/brain/095a318a-e8cd-4a55-a0b3-a4c02daf2d51/matrixkoder_orca_ui_mockup_1792833161294.jpg)

---

### Detailed Tab Specifications in the Side Panel

The MatrixKoder Orca side panel is organized into **8 dedicated tabs**:

```
[Overview] [Lanes 3] [Plan W2] [Waiting !1] [Events] [Inbox 2] [Bugs & Todo] [Settings]
```

1. **Overview Tab**:
   - High-level health chip (`● STAGE 2 / 4: BUILD`), active run identifier, and bus heartbeat (`m-49`).
   - Pinned warning banner if any lane is blocked on user input.
   - Wave progress meters (Wave 1: 100%, Wave 2: 72%, Wave 3: Queued).
   - Compact summary rows for each worker with turn counters.
2. **Lanes Tab (Deep Worker Inspection)**:
   - Dedicated card per agent (`P1 Claude`, `P2 Codex`, `P3 AGY`).
   - Worktree path and Git branch link (`fix/jwt-rotation`).
   - Current task brief and HEAD commit hash (`c8f421a`).
   - **3-Gate Verification Matrix**: Build (Pass/Fail), Test (Pass/Running/Fail), Review (Clear/Ask/Rework).
   - Worker controls: `[Terminal ↗]`, `[Inspect Diff ⎘]`, `[Pause ❚❚]`, `[Handoff ⮂]`, `[Wake ⚡]`.
3. **Plan / Waves Tab (DAG & Kanban)**:
   - Wave-by-wave hierarchical task list with dependency links and assignees.
   - Task completion badges: `Merged`, `In Progress`, `Verifying`, `Blocked`.
   - Kanban view toggle for column-based task tracking.
4. **Waiting Tab (Decision & Review Gate)**:
   - Amber illuminated `! DECISION REQUIRED` card when a worker surfaces an ask.
   - Formatted question statement and options list with `(Recommended)` indicator.
   - Interactive radio selection, custom instruction prompt input, and `[✓ Submit Decision & Resume Lane]` action.
5. **Events Tab (Real-Time Audit Stream)**:
   - High-throughput chronological bus log with source tags (`LANE-P1`, `GATE`, `SYNC`, `COMMIT`, `BUS`).
   - Expandable payload inspection for debugging lane disagreements.
6. **Inbox Tab (Plan Drafts & Import)**:
   - Lists plan files stored in `<home>/inbox/` waiting to become projects.
   - Automatic template adherence rating: `✓ TEMPLATE PASS` vs `◐ PARTIAL (Missing QA/Rollback)`.
   - One-click `[⇩ Import as Active Project]` workflow.
7. **Bugs & Todo Tab**:
   - Bug tracker with derived risk scoring (1-5 points) and critical flags.
   - Project-persistent personal Todo items with keyboard shortcuts (`a` for add, `z` for undo).
8. **Settings Tab**:
   - Mode switcher (`Orchestrator` vs `Solo`).
   - Guard safety tripwires (deny destructive git/system commands).
   - Wake-on-events triggers and Matrix rain animation density toggle.

---

### Interactive Multi-Tab Prototype

The interactive HTML application allows clicking through all 8 tabs and toggling between **"Sidebar Only (440px)"** and **"Full Orca Workspace"** view modes:
- **File**: [matrixkoder_panel_preview.html](file:///Users/rohits/.gemini/antigravity-cli/brain/095a318a-e8cd-4a55-a0b3-a4c02daf2d51/matrixkoder_panel_preview.html)


```
┌─────────────────────────────────────────────────────────┐
│ ⬡ MATRIXKODER                      [⚙] [⚡ SWEEP] [✕]   │
├─────────────────────────────────────────────────────────┤
│ RUN: auth-v2-refactor             STATUS: ● BUILDING    │
│ WAVE 2 / 3                        BUS: CONNECTED (m-42) │
├─────────────────────────────────────────────────────────┤
│ ⚠ WAITING ON YOU (1 ACTION REQUIRED)                    │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [P2-codex] Security Review Check                    │ │
│ │ "Found 2 public route exposures in middleware.ts"   │ │
│ │ [✓ Approve & Continue]  [⎋ Request Rework]          │ │
│ └─────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│ ACTIVE LANES (3 WORKTREES)                              │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ P1 · CLAUDE       branch: fix/jwt-rotation          │ │
│ │ Status: ● Working (Turn 4)                          │ │
│ │ Task: "Update token expiration logic & redis TTL"   │ │
│ │ [Terminal ↗] [Inspect Diff ⎘] [Pause ❚❚]            │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ P2 · CODEX        branch: refactor/auth-guard       │ │
│ │ Status: ⧖ Verifying Tests                           │ │
│ │ Task: "Add unit tests for auth middleware"          │ │
│ │ [Terminal ↗] [Inspect Diff ⎘] [Wake ⚡]             │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ P3 · AGY          branch: docs/api-specs            │ │
│ │ Status: ✓ Idle (Waiting for Wave 3)                 │ │
│ │ Task: "Generate OpenAPI docs from endpoints"        │ │
│ └─────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│ PLAN WAVES                                              │
│ Wave 1: DB Schema & Migrations       [██████████] 100%  │
│ Wave 2: Middleware & Token Handling  [██████░░░░]  60%  │
│ Wave 3: Integration QA & PR Prep     [░░░░░░░░░░]   0%  │
├─────────────────────────────────────────────────────────┤
│ QUICK ACTIONS                                           │
│ [▶ Run Wave]  [⟳ Re-verify All]  [↗ Open Workspace PR] │
└─────────────────────────────────────────────────────────┘
```

---

## 3. The "Matrix Rain" Theme Concept

### Can We Transform Orca into The Matrix?
**Yes!** We achieve this on two synchronized layers:

1. **Inside the MatrixKoder Panel (Full Dynamic Rain):**
   - The panel is an HTML5/CSS/Canvas document. We mount a lightweight `<canvas>` falling digital rain script in the background with glowing green phosphor glyphs (`#00ff41` on deep pitch-black `#050805`).
   - Cards and buttons render as translucent cyberpunk HUD glass (`rgba(0, 255, 65, 0.08)` background with crisp `1px solid rgba(0, 255, 65, 0.3)` borders and neon green drop shadows).

2. **Across the Rest of Orca (Terminal & Workbench Theme):**
   - **Terminal Theme:** We define a custom terminal theme in Orca's configuration:
     - `background`: `#050805`
     - `foreground`: `#00ff41`
     - `cursor`: `#00ff66`
     - `selection`: `#003b00`
     - `green`: `#00ff41`
     - `brightGreen`: `#50ff7b`
   - **Orca Color Tokens:** In `orca-plugin.json` and theme variables, we set:
     - `--background`: `#070a07`
     - `--foreground`: `#00ff41`
     - `--primary`: `#00ff41`
     - `--primary-foreground`: `#001a00`
     - `--card`: `#0a0f0a`
     - `--border`: `#153315`
     - `--radius`: `2px` (sharp sci-fi corners)

---

## 4. Standalone HTML/CSS Interactive Prototype

Save this as your plugin's `panel.html` to test live:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MatrixKoder Panel</title>
  <style>
    :root {
      --matrix-bg: #050805;
      --matrix-green: #00ff41;
      --matrix-dim: #008f11;
      --matrix-card: rgba(6, 18, 8, 0.82);
      --matrix-border: rgba(0, 255, 65, 0.28);
      --matrix-alert: #ffb700;
      --font-mono: "Fira Code", "JetBrains Mono", Menlo, monospace;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      background: var(--matrix-bg);
      color: var(--matrix-green);
      font-family: var(--font-mono);
      font-size: 11px;
      overflow-x: hidden;
      position: relative;
    }

    /* Ambient digital rain canvas */
    #matrix-canvas {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
      opacity: 0.18;
      pointer-events: none;
    }

    /* HUD Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--matrix-border);
      padding-bottom: 8px;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .header h2 {
      margin: 0;
      font-size: 13px;
      text-shadow: 0 0 8px rgba(0, 255, 65, 0.7);
    }
    .status-badge {
      background: rgba(0, 255, 65, 0.15);
      border: 1px solid var(--matrix-green);
      padding: 2px 6px;
      border-radius: 2px;
      font-size: 10px;
    }

    /* Attention Box */
    .alert-card {
      background: rgba(255, 183, 0, 0.08);
      border: 1px solid var(--matrix-alert);
      color: var(--matrix-alert);
      padding: 10px;
      border-radius: 3px;
      margin-bottom: 12px;
    }
    .alert-card .title { font-weight: bold; margin-bottom: 4px; }
    .alert-actions { margin-top: 8px; display: flex; gap: 6px; }

    /* Lane Cards */
    .section-title {
      font-size: 10px;
      color: var(--matrix-dim);
      text-transform: uppercase;
      margin-bottom: 6px;
      letter-spacing: 0.5px;
    }
    .lane-card {
      background: var(--matrix-card);
      border: 1px solid var(--matrix-border);
      border-radius: 3px;
      padding: 10px;
      margin-bottom: 8px;
      backdrop-filter: blur(4px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    }
    .lane-head {
      display: flex;
      justify-content: space-between;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .lane-task {
      color: #92e6a3;
      font-size: 11px;
      margin-bottom: 8px;
    }
    .lane-btns {
      display: flex;
      gap: 5px;
    }

    /* Buttons */
    button {
      background: rgba(0, 255, 65, 0.1);
      border: 1px solid var(--matrix-green);
      color: var(--matrix-green);
      font-family: var(--font-mono);
      font-size: 10px;
      padding: 4px 8px;
      border-radius: 2px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    button:hover {
      background: var(--matrix-green);
      color: #000;
      box-shadow: 0 0 10px var(--matrix-green);
    }
    button.alert-btn {
      background: rgba(255, 183, 0, 0.15);
      border-color: var(--matrix-alert);
      color: var(--matrix-alert);
    }
    button.alert-btn:hover {
      background: var(--matrix-alert);
      color: #000;
    }

    /* Progress bar */
    .progress-bar {
      height: 4px;
      background: rgba(0, 255, 65, 0.15);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 4px;
    }
    .progress-fill {
      height: 100%;
      background: var(--matrix-green);
      box-shadow: 0 0 6px var(--matrix-green);
    }
  </style>
</head>
<body>
  <canvas id="matrix-canvas"></canvas>

  <div class="header">
    <h2>⬡ MatrixKoder</h2>
    <span class="status-badge">● STAGE 2</span>
  </div>

  <div class="alert-card">
    <div class="title">⚠ WAITING ON REVIEW (1)</div>
    <div>P2-codex: Found 2 unprotected routes in auth middleware.</div>
    <div class="alert-actions">
      <button class="alert-btn">✓ Approve</button>
      <button class="alert-btn">⎋ Request Rework</button>
    </div>
  </div>

  <div class="section-title">Active Lanes (3 Worktrees)</div>

  <div class="lane-card">
    <div class="lane-head">
      <span>P1 · Claude (working)</span>
      <span>wave 2</span>
    </div>
    <div class="lane-task">Refactoring JWT rotation and cache eviction logic...</div>
    <div class="progress-bar"><div class="progress-fill" style="width: 70%;"></div></div>
    <div class="lane-btns" style="margin-top: 8px;">
      <button>Terminal ↗</button>
      <button>Diff ⎘</button>
      <button>Pause ❚❚</button>
    </div>
  </div>

  <div class="lane-card">
    <div class="lane-head">
      <span>P2 · Codex (verifying)</span>
      <span>wave 2</span>
    </div>
    <div class="lane-task">Running integration test suite on auth endpoints.</div>
    <div class="progress-bar"><div class="progress-fill" style="width: 90%;"></div></div>
    <div class="lane-btns" style="margin-top: 8px;">
      <button>Terminal ↗</button>
      <button>Diff ⎘</button>
    </div>
  </div>

  <div class="section-title" style="margin-top: 14px;">Plan Waves</div>
  <div style="font-size: 10px; margin-bottom: 4px;">Wave 1: Database Schema [DONE]</div>
  <div style="font-size: 10px; margin-bottom: 4px;">Wave 2: Middleware & Tokens [IN PROGRESS]</div>
  <div style="font-size: 10px; color: var(--matrix-dim);">Wave 3: E2E Integration [QUEUED]</div>

  <script>
    // Matrix Rain Effect on Canvas
    const canvas = document.getElementById('matrix-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const chars = '0123456789ABCDEFｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈ';
    const fontSize = 11;
    const columns = Math.floor(canvas.width / fontSize);
    const drops = Array(columns).fill(1);

    function draw() {
      ctx.fillStyle = 'rgba(5, 8, 5, 0.12)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#00ff41';
      ctx.font = fontSize + 'px monospace';

      for (let i = 0; i < drops.length; i++) {
        const text = chars.charAt(Math.floor(Math.random() * chars.length));
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    }
    setInterval(draw, 45);
  </script>
</body>
</html>
```
