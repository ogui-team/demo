# Task 22 - Entity Context Menu

## Goal
Deliver professional hierarchy interaction UX.

## Why
Right-click actions are essential workflow accelerators in mature editors.

## Must Include
- right-click actions
- duplicate
- rename
- prefab actions
- grouping
- delete
- create child

## Scope
- Replace placeholder context actions with real command-backed operations.
- Support both hierarchy and viewport context entry points.

## Implementation Steps
1. Create context menu action registry with enable predicates.
2. Implement actions:
- rename
- duplicate
- delete
- create child
- group selected
- prefab actions where applicable
3. Route actions through command stack where mutating.
4. Add viewport right-click support for entity under cursor.
5. Keep context selection sync consistent before action execution.
6. Add keyboard fallback actions for frequent operations.

## Integration Targets
- HierarchyPanel
- Selection state model
- command stack
- prefab system

## Done When
- Context menu actions perform real edits.
- All destructive actions are undoable.
- Hierarchy and viewport right-click flows feel consistent.
