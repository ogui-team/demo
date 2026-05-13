# Task 10 - Editor Event Router

## Goal
Replace scattered editor listeners with centralized editor event routing.

## Why
Prevents event spaghetti, stuck drag states, and lifecycle leaks.

## Must Include
- editor input ownership
- viewport focus routing
- keyboard shortcut routing
- modal priority handling
- drag state isolation
- cleanup guarantees

## Scope
- Build one router that owns editor input dispatch and lifecycle.
- Remove direct window listener ownership from individual tools where possible.

## Implementation Steps
1. Create EditorEventRouter service for pointer, keyboard, and focus events.
2. Define input ownership rules:
- active modal has highest priority
- active drag owner captures events
- focused viewport routes editor interactions
3. Register tool handlers with explicit priority and activation predicates.
4. Add centralized shortcut map and conflict resolution.
5. Add begin and end drag capture API with guaranteed release.
6. Add teardown routine that unsubscribes everything on reset or destroy.

## Integration Targets
- EditorController
- SelectionSystem
- GizmoSystem
- EditorPainterSystem
- TriggerVolumeTool
- UICompositionCoordinator hotkeys

## Done When
- Input flow is traceable from one router.
- Modal dialogs block lower-priority handlers correctly.
- Drag interactions cannot leak after mode changes.
- Listener cleanup is deterministic and testable.
