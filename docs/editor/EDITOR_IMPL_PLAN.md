# Editor Implementation Plan

Quick reference for tomorrow's session. Do these in order — each one is a standalone task.

## Autonomous Mode Files
- Master prompt: [AUTONOMOUS_AGENT_MASTER_PROMPT.md](AUTONOMOUS_AGENT_MASTER_PROMPT.md)
- Progress queue: [AUTONOMOUS_TASK_QUEUE.md](AUTONOMOUS_TASK_QUEUE.md)

---

## Task 1 — Entity Renderer Fallback (1 day)
**Why:** Entities are invisible in editor. Without this, nothing else can be tested.
**See:** [TASK_01_RENDERER_FALLBACK.md](TASK_01_RENDERER_FALLBACK.md)

## Task 2 — Unified Selection Bus (1-2 days)
**Why:** Viewport clicks and hierarchy clicks use two separate systems that never talk to each other.
**See:** [TASK_02_SELECTION_BUS.md](TASK_02_SELECTION_BUS.md)

## Task 3 — Live Hierarchy Panel (1-2 days)
**Why:** Hierarchy shows a hardcoded static list. It needs to reflect real entities.
**See:** [TASK_03_LIVE_HIERARCHY.md](TASK_03_LIVE_HIERARCHY.md)

## Task 4 — Inspector Component Display (2-3 days)
**Why:** Inspector only shows a label. Component data is already emitted but never rendered.
**See:** [TASK_04_INSPECTOR_DISPLAY.md](TASK_04_INSPECTOR_DISPLAY.md)

## Task 5 — Camera Save/Restore on P-Toggle (0.5 day)
**Why:** Camera teleports when returning from play. Should restore to where it was.
**See:** [TASK_05_CAMERA_RESTORE.md](TASK_05_CAMERA_RESTORE.md)

## Task 6 — Delete + Duplicate Hotkeys (1 day)
**Why:** Del and Ctrl+D are standard editor shortcuts, currently missing.
**See:** [TASK_06_DELETE_DUPLICATE.md](TASK_06_DELETE_DUPLICATE.md)

---

## Order to do them

```
1 → 2 → 3 → 4 → 5 → 6
```

Task 1 unlocks visual testing for everything else.
Task 2 must come before Task 3 and 4.
Tasks 5 and 6 are independent, can be done any time.

---

## Phase 2 — Professional Editor Foundation

## Task 7 — Viewport Raycasting
**See:** [TASK_07_VIEWPORT_RAYCASTING.md](TASK_07_VIEWPORT_RAYCASTING.md)

## Task 8 — Transform Gizmos
**See:** [TASK_08_TRANSFORM_GIZMOS.md](TASK_08_TRANSFORM_GIZMOS.md)

## Task 9 — Undo Redo System
**See:** [TASK_09_UNDO_REDO_SYSTEM.md](TASK_09_UNDO_REDO_SYSTEM.md)

## Task 10 — Editor Event Router
**See:** [TASK_10_EDITOR_EVENT_ROUTER.md](TASK_10_EDITOR_EVENT_ROUTER.md)

## Task 11 — Play Mode Isolation
**See:** [TASK_11_PLAY_MODE_ISOLATION.md](TASK_11_PLAY_MODE_ISOLATION.md)

## Task 12 — Editor Selection Outlines
**See:** [TASK_12_EDITOR_SELECTION_OUTLINES.md](TASK_12_EDITOR_SELECTION_OUTLINES.md)

## Task 13 — Multi Select Architecture
**See:** [TASK_13_MULTI_SELECT_ARCHITECTURE.md](TASK_13_MULTI_SELECT_ARCHITECTURE.md)

## Task 14 — Asset Browser
**See:** [TASK_14_ASSET_BROWSER.md](TASK_14_ASSET_BROWSER.md)

## Task 15 — Prefab System
**See:** [TASK_15_PREFAB_SYSTEM.md](TASK_15_PREFAB_SYSTEM.md)

## Task 16 — Editor Layout System
**See:** [TASK_16_EDITOR_LAYOUT_SYSTEM.md](TASK_16_EDITOR_LAYOUT_SYSTEM.md)

## Task 17 — Component Reflection System
**See:** [TASK_17_COMPONENT_REFLECTION_SYSTEM.md](TASK_17_COMPONENT_REFLECTION_SYSTEM.md)

## Task 18 — Editor Performance Overlay
**See:** [TASK_18_EDITOR_PERFORMANCE_OVERLAY.md](TASK_18_EDITOR_PERFORMANCE_OVERLAY.md)

## Task 19 — Editor Command Palette
**See:** [TASK_19_EDITOR_COMMAND_PALETTE.md](TASK_19_EDITOR_COMMAND_PALETTE.md)

## Task 20 — Editor Mode System
**See:** [TASK_20_EDITOR_MODE_SYSTEM.md](TASK_20_EDITOR_MODE_SYSTEM.md)

## Task 21 — Scene Serialization
**See:** [TASK_21_SCENE_SERIALIZATION.md](TASK_21_SCENE_SERIALIZATION.md)

## Task 22 — Entity Context Menu
**See:** [TASK_22_ENTITY_CONTEXT_MENU.md](TASK_22_ENTITY_CONTEXT_MENU.md)

## Task 23 — Editor Test Scene
**See:** [TASK_23_EDITOR_TEST_SCENE.md](TASK_23_EDITOR_TEST_SCENE.md)

## Task 24 — Runtime Editor Boundary Audit
**See:** [TASK_24_RUNTIME_EDITOR_BOUNDARY_AUDIT.md](TASK_24_RUNTIME_EDITOR_BOUNDARY_AUDIT.md)

---

## Suggested Phase 2 Order

1. Task 10 — Editor Event Router
2. Task 7 — Viewport Raycasting
3. Task 8 — Transform Gizmos
4. Task 9 — Undo Redo System
5. Task 13 — Multi Select Architecture
6. Task 12 — Editor Selection Outlines
7. Task 20 — Editor Mode System
8. Task 11 — Play Mode Isolation
9. Task 21 — Scene Serialization
10. Task 15 — Prefab System
11. Task 17 — Component Reflection System
12. Task 22 — Entity Context Menu
13. Task 14 — Asset Browser
14. Task 16 — Editor Layout System
15. Task 19 — Editor Command Palette
16. Task 18 — Editor Performance Overlay
17. Task 23 — Editor Test Scene
18. Task 24 — Runtime Editor Boundary Audit
