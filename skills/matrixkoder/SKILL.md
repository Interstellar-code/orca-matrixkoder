---
name: matrixkoder
description: >-
  Multi-agent orchestration loop for Orca IDE: plan multi-wave builds across
  supervised worktree lanes (Claude Code, Codex, AGY, OpenCode), execute staged reviews,
  and report progress through the MatrixKoder visual dashboard.
---

# MatrixKoder Orchestration Skill

This skill guides the lead coordinator agent in decomposing, dispatching, verifying, and merging multi-phase builds across Orca worktrees.

## The Orchestration Loop

1. **Plan & Wave Partitioning**:
   - Decompose user goals into self-contained Tasks grouped by dependency Waves.
   - Assign Tasks to specialized agents per wave (e.g., P1 Claude for core logic, P2 Codex for test coverage, P3 AGY for documentation).

2. **Worktree & Lane Dispatch**:
   - Create isolated worktrees per lane:
     ```bash
     orca worktree create --name fix-jwt-rotation --agent claude --prompt "<Task Brief>"
     ```

3. **Verification & Gates**:
   - Monitor worker state transitions via Orca orchestration messages.
   - For blocking security or architectural decisions, raise a `decision_gate` to pause the lane until user review.

4. **Merge & Release**:
   - Once all wave verification passes succeed, create a consolidated pull request and report the audit trail.
