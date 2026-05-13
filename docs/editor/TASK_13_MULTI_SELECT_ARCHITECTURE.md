# Task 13 - Multi Select Architecture

## Goal
Support selecting multiple entities safely.

## Why
Many editor systems fail once selection is no longer single-entity.

## Must Include
- additive selection
- box selection
- selection groups
- hierarchy sync
- inspector aggregation rules

## Scope
- Replace single selected entity model with robust selection set model.
- Keep APIs explicit about primary selection versus full selection set.

## Implementation Steps
1. Define EditorSelectionState:
- selected ids set
- primary id
- last interaction source
2. Implement additive selection modifiers and clear rules.
3. Add box selection in viewport with layer and visibility filters.
4. Sync selection to hierarchy with stable row highlighting.
5. Define inspector aggregation rules:
- common editable fields
- mixed value state display
6. Publish deterministic selection changed events for all consumers.

## Integration Targets
- SelectionSystem
- HierarchyPanel
- InspectorPanel
- GizmoSystem (group pivot behavior)

## Done When
- Shift-select and box-select are stable.
- Hierarchy and viewport selections always match.
- Inspector handles mixed selections predictably.
