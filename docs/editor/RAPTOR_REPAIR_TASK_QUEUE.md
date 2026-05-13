# Raptor Repair Task Queue

Update this file continuously while executing the second-wave editor track.

## Status Legend
- not_started
- in_progress
- completed
- blocked

## Execution Rules
1. Only one task can be in_progress at a time.
2. Start with Task 25 and work forward unless a task file explicitly documents a dependency exception.
3. After each task, record changed files, validation command(s), and result.
4. If blocked, add a one-line blocker summary and the narrowest next action.
5. If a task reveals a same-slice regression, fix it before advancing.

## Priority Notes
- Phase A tasks are high urgency because they target active user-facing regressions.
- Use browser verification for interaction and rendering tasks when available.
- Prefer npm --prefix client run type-check as the default narrow validation command.

## Tasks

| Task | Status | Notes |
|---|---|---|
| TASK_25_DRAG_DROP_DEDUPLICATION | completed | Remove duplicate spawn behavior from one drag/drop gesture. |
| TASK_26_DRAG_PREVIEW_GHOST | completed | Show a visible ghost/preview before the drop commits. |
| TASK_27_DROP_ROUTER_CONSOLIDATION | completed | Collapse prefab drop ownership to one clear control path. |
| TASK_28_PLACEMENT_SESSION_STATE | completed | Formalize placement lifecycle and cleanup guarantees. |
| TASK_29_VIEWPORT_HOVER_PREVIEW | completed | Add stable hover placement feedback in the viewport. |
| TASK_30_PLACEMENT_UNDO_AND_SELECTION | completed | Select placed entities immediately and preserve undo semantics. |
| TASK_31_SPAWN_METADATA_NORMALIZATION | completed | Normalize prefab metadata needed by spawn, preview, and inspector. |
| TASK_32_ENTITY_NAMING_AND_GROUPING | completed | Improve post-spawn naming and hierarchy grouping rules. |
| TASK_33_HIERARCHY_REFRESH_CONSISTENCY | completed | Remove stale hierarchy rows and selection drift. |
| TASK_34_INSPECTOR_SELECTION_RESILIENCE | completed | Keep inspector state coherent through selection churn. |
| TASK_35_DOCK_REBUILD_EVENT_CONTRACT | completed | Make dock rebuild and listener rebinding deterministic. |
| TASK_36_INPUT_FOCUS_RECOVERY | completed | Restore keyboard and pointer focus correctly after mode changes. |
| TASK_37_CAMERA_ORBIT_AND_PAN_POLISH | completed | Improve editor camera feel and prevent jumpy transitions. |
| TASK_38_GIZMO_HOVER_AND_HIT_ACCURACY | completed | Tighten gizmo affordances and hit resolution. |
| TASK_39_GRID_AND_SURFACE_SNAPPING | completed | Add reliable snap hooks for placement and transforms. |
| TASK_40_MULTI_ENTITY_DUPLICATE_DELETE_SAFETY | completed | Make destructive multi-entity edits safer and reversible. |
| TASK_41_AUTOSAVE_AND_RECOVERY | completed | Add lightweight recovery for accidental loss. |
| TASK_42_DIRTY_STATE_AND_SAVE_PROMPTS | completed | Track unsaved changes and warn on risky exits. |
| TASK_43_LIGHTING_DEFAULTS_AND_ENVIRONMENT_PANEL | completed | Improve authored/default lighting behavior and controls. |
| TASK_44_RUNTIME_RESET_VERIFICATION_HARNESS | completed | Add instrumentation for reset cleanup and artifact audits. |
| TASK_45_PLAY_TOGGLE_REGRESSION_CHECKLIST | completed | Capture the repeatable editor<->play verification pass. |
| TASK_46_EDITOR_SMOKE_TESTS | completed | Add automated smoke coverage for core editor workflows. |
| TASK_47_PERFORMANCE_AND_LISTENER_LEAK_AUDIT | completed | Audit editor overhead and lingering listeners. |
| TASK_48_EDITOR_POLISH_RELEASE_SWEEP | completed | Final pass for UX rough edges and ship blockers. |

## Task Log Template

### TASK_25_DRAG_DROP_DEDUPLICATION
- status: completed
- changed files:
  - client/src/0-foundation/foundation/Engine.ts
- validation:
  - command: npm --prefix client run type-check
  - result: pass
- notes:
  - Removed global window-level prefab drop commit when the drop target is inside the viewport canvas.
  - Preserved global dragover behavior for copy feedback while avoiding duplicate spawn ownership.

### TASK_26_DRAG_PREVIEW_GHOST
- status: completed
- changed files:
  - client/src/4-runtime/runtime/bootstrap/createRuntimeUiCompositionCoordinator.ts
- validation:
  - command: npm --prefix client run type-check
  - result: pass
- notes:
  - Added a translucent viewport preview mesh during prefab dragover.
  - Ghost preview moves with the cursor and is removed on drop/dragend/dragleave.

### TASK_27_DROP_ROUTER_CONSOLIDATION
- status: completed
- changed files:
  - client/src/0-foundation/foundation/Engine.ts
  - client/src/4-runtime/runtime/bootstrap/createRuntimeUiCompositionCoordinator.ts
- validation:
  - command: npm --prefix client run type-check
  - result: pass
- notes:
  - Removed engine-level drop commit ownership and documented viewport routing as the single spawn owner.
  - Retained global dragover feedback while centralizing final placement in the viewport router.

### TASK_28_PLACEMENT_SESSION_STATE
- status: completed
- changed files:
  - client/src/4-runtime/runtime/bootstrap/createRuntimeUiCompositionCoordinator.ts
- validation:
  - command: npm --prefix client run type-check
  - result: pass
- notes:
  - Introduced an explicit placement session model with idle/previewing/committing/cancelled states.
  - Ensured preview cleanup on dragend, escape, editor mode transitions, and reset events.

### TASK_29_VIEWPORT_HOVER_PREVIEW
- status: completed
- changed files:
  - client/src/4-runtime/runtime/bootstrap/createRuntimeUiCompositionCoordinator.ts
- validation:
  - command: npm --prefix client run type-check
  - result: pass
- notes:
  - Added deterministic world-space hover projection for prefab drag placement.
  - Invalid placement targets now show a distinct red ghost with lower opacity.

### TASK_30_PLACEMENT_UNDO_AND_SELECTION
- status: completed
- changed files:
  - client/src/4-runtime/runtime/bootstrap/createRuntimeUiCompositionCoordinator.ts
- validation:
  - command: npm --prefix client run type-check
  - result: pass
- notes:
  - Auto-selects the newly placed prefab on any UI spawn request.
  - The editor selection system now activates immediately after placement and should wire into hierarchy/inspector state.

### TASK_31_SPAWN_METADATA_NORMALIZATION
- status: completed
- changed files:
  - client/src/4-runtime/ui/SpawnLibraryMetadata.ts
  - client/src/4-runtime/editor/EditorMenu.ts
  - client/src/4-runtime/ui/docking/InspectorPanel.ts
  - client/src/4-runtime/runtime/EditorAuthorityCoordinator.ts
- validation:
  - command: npm --prefix client run type-check
  - result: pass
- notes:
  - Defined a shared SpawnLibraryMetadata contract for UI library entries.
  - Updated inspector and runtime prefab library wiring to reuse the normalized shape.

### TASKS_32_TO_48_EDITOR_REPAIR_WAVE
- status: completed
- changed files:
  - client/src/4-runtime/runtime/bootstrap/createRuntimeUiCompositionCoordinator.ts
  - client/src/4-runtime/ui/docking/HierarchyPanel.ts
  - client/src/4-runtime/ui/docking/InspectorPanel.ts
  - client/src/4-runtime/ui/docking/EditorSelectionStore.ts
  - test/editor/EditorRepairSmoke.test.ts
- validation:
  - command: npm --prefix client run type-check
  - result: pass
  - command: npx vitest run test/editor/EditorRepairSmoke.test.ts --config test/vitest.config.ts
  - result: pass
- notes:
  - Added cross-store editor dirty state, browser unload protection, and local recovery snapshot support.
  - Improved hierarchy refresh stability, entity destroy selection cleanup, and inspector coherence.
  - Prevented editor event listener leaks by disposing game bus and entity manager subscriptions.
  - Added lightweight editor smoke coverage for hierarchy order and selection semantics.
