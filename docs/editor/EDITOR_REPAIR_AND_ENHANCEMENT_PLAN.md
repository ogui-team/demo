# Editor Repair And Enhancement Plan

This is the second-wave editor track for tomorrow.

It assumes the first 24 editor tasks established the architecture, but the live editor still needs repair work, consolidation, regression hardening, and usability polish.

## Autonomous Mode Files
- Master prompt: [RAPTOR_NIGHT_SHIFT_MASTER_PROMPT.md](RAPTOR_NIGHT_SHIFT_MASTER_PROMPT.md)
- Progress queue: [RAPTOR_REPAIR_TASK_QUEUE.md](RAPTOR_REPAIR_TASK_QUEUE.md)

## Phase A - Stop Active Regressions First

1. Task 25 - Drag/drop deduplication
2. Task 26 - Drag preview ghost
3. Task 27 - Drop router consolidation
4. Task 28 - Placement session state
5. Task 29 - Viewport hover preview
6. Task 30 - Placement undo and selection

Reason:
These six tasks address the most visible editor breakages: duplicate spawns, no preview before placement, ambiguous drop ownership, and weak post-placement continuity.

## Phase B - Stabilize Existing Panels And Data Contracts

7. Task 31 - Spawn metadata normalization
8. Task 32 - Entity naming and grouping
9. Task 33 - Hierarchy refresh consistency
10. Task 34 - Inspector selection resilience
11. Task 35 - Dock rebuild event contract
12. Task 36 - Input focus recovery

Reason:
These tasks reduce stale UI state, rebuild regressions, and selection/input drift after editor/play or panel rebuild transitions.

## Phase C - Improve Core Interaction Quality

13. Task 37 - Camera orbit and pan polish
14. Task 38 - Gizmo hover and hit accuracy
15. Task 39 - Grid and surface snapping
16. Task 40 - Multi-entity duplicate/delete safety

Reason:
These tasks make manipulation more predictable and reduce accidental edits.

## Phase D - Protect Work And Restore Confidence

17. Task 41 - Autosave and recovery
18. Task 42 - Dirty state and save prompts
19. Task 43 - Lighting defaults and environment panel
20. Task 44 - Runtime reset verification harness

Reason:
These tasks protect user work, reduce dark-play regressions, and make reset/cleanup failures easier to catch.

## Phase E - Regression Coverage And Release Readiness

21. Task 45 - Play toggle regression checklist
22. Task 46 - Editor smoke tests
23. Task 47 - Performance and listener leak audit
24. Task 48 - Editor polish release sweep

Reason:
These tasks turn the repaired editor into a repeatable, testable product surface instead of a brittle dev-only tool.