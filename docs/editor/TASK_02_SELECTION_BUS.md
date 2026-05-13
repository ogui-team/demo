# Task 02 — Unified Selection Bus

## Problem
There are two separate selection systems that never talk to each other:

1. `SelectionSystem` — used by the 3D viewport (raycasting, gizmos)
   - File: `client/src/4-runtime/editor/tools/SelectionSystem.ts`
   - Knows about real entity IDs

2. `EditorSelectionStore` — used by HierarchyPanel and InspectorPanel
   - File: `client/src/4-runtime/ui/docking/EditorSelectionStore.ts`
   - Only knows about "map-node" types, not real entities

Result: clicking in viewport does NOT highlight hierarchy row, and vice versa.

## What to do

### Step 1 — Extend EditorSelectionStore to support entity selection

Open `client/src/4-runtime/ui/docking/EditorSelectionStore.ts`

Change `EditorSelectionType` from:
```typescript
export type EditorSelectionType = 'none' | 'map-node';
```
to:
```typescript
export type EditorSelectionType = 'none' | 'map-node' | 'entity';
```

Add a new method:
```typescript
selectEntity(entityId: string, label?: string): void {
  this.setState({
    type: 'entity',
    nodeId: entityId,
    label: label ?? entityId,
  });
}
```

### Step 2 — Wire SelectionSystem into EditorSelectionStore

Find where `SelectionSystem` is wired up. Search for:
```
selectionSystem.onSelect
```

Where that wiring happens, add:
```typescript
selectionSystem.onSelect((entityId: string) => {
  selectionStore.selectEntity(entityId);
});
selectionSystem.onDeselect(() => {
  selectionStore.clear();
});
```

The `selectionStore` here is the `EditorSelectionStore` instance. Find it by searching for:
```
new EditorSelectionStore
```

### Step 3 — Wire HierarchyPanel entity clicks back to SelectionSystem

In `client/src/4-runtime/ui/docking/HierarchyPanel.ts`, when a row is clicked for an entity kind, call `selectionStore.selectEntity(item.id)` — this is already partially there for `map-node`.

For now, the hierarchy still has a static list (that's fixed in Task 3), so just make sure the click calls `selectEntity` instead of nothing.

## Done when
- Clicking an entity in viewport highlights the correct row in hierarchy panel
- The inspector panel shows the selected entity label (it already reads from `EditorSelectionStore`)
