# MatrixKoder: Claude Code to Orca Migration Reference

This document maps MatrixKoder's original Claude Code terminal mod architecture to the Orca IDE native plugin ecosystem.

---

## 1. Architectural Evolution

| Capability | Claude Code Implementation | Orca Implementation | Advantage |
| :--- | :--- | :--- | :--- |
| **Dashboard UI** | React Ink (`<Box>`, `<Text>`) constrained to a 46-column terminal split. | Responsive HTML/CSS/Canvas web frame docked in Orca's right sidebar (`web/index.html`). | Rich interactive tables, buttons, canvas digital rain, collapsible sections. |
| **Multi-Agent Management** | Shelling out to `herdr` to manage tmux panes and git worktrees. | Native Orca worktrees (`orca worktree create`) and agent processes (`orca agent launch`). | No tmux/herdr dependencies needed; native OS terminal process monitoring. |
| **Communication Bus** | Ad-hoc Python daemon (`scripts/mk-bus.py`) with JSON file locking. | Orca internal orchestration engine (`orchestration.db`) + `orca orchestration send/reply`. | High-integrity SQLite transactions, automatic lease recovery, cross-host federation. |
| **Worker Decision Gates** | Terminal prompts polling `waiting.json`. | Native `decision_gate` records in Orca's bus, exposed via the **Waiting Tab**. | Single-click approve/rework buttons directly in the IDE sidebar. |
| **File Browser** | Heavy custom tree traversal script in React Ink. | Dropped in favor of Orca's native high-performance File Explorer and Diff tabs. | Massive CPU and memory savings; faster dashboard rendering. |
| **Scheduler & Cron** | Background python pollers (`mk-usage.py`, `mk-state.py`). | Native Orca Automations (`orca automations create`). | Persistent scheduling managed directly by the Orca runtime. |
