# Task 09 - Undo Redo System

## Goal
Create a command-based undo/redo architecture.

## Why
Without command history, editing is risky and unscalable.

## Must Include
- centralized command stack
- reversible actions
- transform undo
- entity create/delete undo
- inspector property undo
- future multiplayer compatibility

## Scope
- Introduce editor command interfaces and one stack authority.
- Route mutating editor actions through command execution.

## Implementation Steps
1. Define command contract:
- execute
- undo
- optional redo metadata
- label and timestamps
2. Build central EditorCommandStack service:
- push and execute
- undo
- redo
- clear on hard reset
3. Implement command types:
- transform command
- create entity command
- delete entity command
- set component property command
4. Emit command lifecycle events for UI and telemetry.
5. Add keyboard bindings for undo and redo through editor router.
6. Keep network-safe metadata for future multiplayer reconciliation.

## Integration Targets
- GizmoSystem drag commit
- ComponentInspector updates
- PrefabPlacementSystem create operations
- delete and duplicate actions

## Done When
- Core edit actions are undoable and redoable.
- Stack state is inspectable for debugging.
- No direct mutation path bypasses command stack for covered actions.
