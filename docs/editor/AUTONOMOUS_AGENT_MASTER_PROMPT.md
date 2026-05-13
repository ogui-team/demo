# Autonomous Agent Master Prompt

Use this prompt with your autonomous coding agent.

## Prompt to Paste

You are running in autonomous execution mode for this repository.

Primary objective:
Implement all editor architecture tasks in docs/editor from Task 01 through Task 24, in order, with production-safe code changes.

Execution policy:
1. Do not ask me clarifying questions during normal execution.
2. Continue task-by-task until all tasks are implemented, tested, and committed locally.
3. Only stop and ask me for input if you hit a true blocker that cannot be solved from repository context.
4. If blocked, include:
- exact blocker
- what you tried
- smallest decision needed from me
Then pause.
5. If not blocked, keep going.

Quality policy:
1. For each task, read the corresponding task file in docs/editor and implement exactly that scope.
2. Prefer minimal, clean diffs and maintain existing architecture style.
3. After each task:
- run relevant build or test commands
- fix errors introduced by your change
- update progress tracker file docs/editor/AUTONOMOUS_TASK_QUEUE.md
4. Do not skip failing tests silently. Either fix or report as blocker.
5. Preserve runtime/editor boundaries and avoid quick hacks.

Delivery policy:
1. Work through all tasks before asking for final review.
2. Keep a short implementation log per task in docs/editor/AUTONOMOUS_TASK_QUEUE.md.
3. At the end, provide:
- completed tasks list
- changed files summary
- validation results
- known follow-ups

Task source files:
- docs/editor/TASK_01_RENDERER_FALLBACK.md
- docs/editor/TASK_02_SELECTION_BUS.md
- docs/editor/TASK_03_LIVE_HIERARCHY.md
- docs/editor/TASK_04_INSPECTOR_DISPLAY.md
- docs/editor/TASK_05_CAMERA_RESTORE.md
- docs/editor/TASK_06_DELETE_DUPLICATE.md
- docs/editor/TASK_07_VIEWPORT_RAYCASTING.md
- docs/editor/TASK_08_TRANSFORM_GIZMOS.md
- docs/editor/TASK_09_UNDO_REDO_SYSTEM.md
- docs/editor/TASK_10_EDITOR_EVENT_ROUTER.md
- docs/editor/TASK_11_PLAY_MODE_ISOLATION.md
- docs/editor/TASK_12_EDITOR_SELECTION_OUTLINES.md
- docs/editor/TASK_13_MULTI_SELECT_ARCHITECTURE.md
- docs/editor/TASK_14_ASSET_BROWSER.md
- docs/editor/TASK_15_PREFAB_SYSTEM.md
- docs/editor/TASK_16_EDITOR_LAYOUT_SYSTEM.md
- docs/editor/TASK_17_COMPONENT_REFLECTION_SYSTEM.md
- docs/editor/TASK_18_EDITOR_PERFORMANCE_OVERLAY.md
- docs/editor/TASK_19_EDITOR_COMMAND_PALETTE.md
- docs/editor/TASK_20_EDITOR_MODE_SYSTEM.md
- docs/editor/TASK_21_SCENE_SERIALIZATION.md
- docs/editor/TASK_22_ENTITY_CONTEXT_MENU.md
- docs/editor/TASK_23_EDITOR_TEST_SCENE.md
- docs/editor/TASK_24_RUNTIME_EDITOR_BOUNDARY_AUDIT.md

Completion definition:
All tasks are implemented or marked blocked with concrete evidence, build passes, and queue file is fully updated.
