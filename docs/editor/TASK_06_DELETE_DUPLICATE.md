# Task 06 — Delete + Duplicate Hotkeys

## Problem
Del key and Ctrl+D do nothing in the editor. Standard in every editor.

## What to do

### Step 1 — Find where editor keyboard events are handled

Search for:
```
handleKeyDown
```

The main input router for the editor is likely in:
- `client/src/4-runtime/editor/tools/PrefabPlacementSystem.ts` (already has 1/2/3 hotkeys)
- Or a dedicated input handler — search for `'editor'` context key handling

### Step 2 — Add Delete key handler

In `PrefabPlacementSystem.handleKeyDown()` (or wherever editor keys are handled), add:

```typescript
// Delete selected entity
if (event.code === 'Delete' || event.code === 'Backspace') {
  const selected = this.selectionSystem.getSelectedEntity();
  if (!selected) return false;
  event.preventDefault();
  
  // Destroy the entity
  gameBus.emit('EDITOR_DELETE_ENTITY_REQUESTED', {
    entityId: selected.id,
    timestamp: Engine.time.now(),
  });
  return true;
}
```

Then somewhere that has access to `EntityManager`, listen for `EDITOR_DELETE_ENTITY_REQUESTED`:
```typescript
gameBus.on('EDITOR_DELETE_ENTITY_REQUESTED', ({ entityId }) => {
  entityManager.destroyEntity(entityId);
});
```

Search for `destroyEntity` to find the EntityManager method name (may also be `removeEntity` or `deleteEntity`).

### Step 3 — Add Ctrl+D duplicate handler

```typescript
// Duplicate selected entity
if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD') {
  const selected = this.selectionSystem.getSelectedEntity();
  if (!selected) return false;
  event.preventDefault();
  
  // Place a copy offset by 1 unit on X
  const pos = selected.getPosition();
  this.placePrefab(selected.type, {
    position: { x: pos.x + 1, y: pos.y, z: pos.z },
    source: 'system',
  });
  return true;
}
```

Note: `this.placePrefab` is already on `PrefabPlacementSystem`. If you're not in that class, emit `EDITOR_SPAWN_PREFAB` instead:
```typescript
gameBus.emit('EDITOR_SPAWN_PREFAB', {
  prefabId: selected.type,
  position: { x: pos.x + 1, y: pos.y, z: pos.z },
  source: 'system',
});
```

## Notes
- `getSelectedEntity()` is on `SelectionSystem` — check the exact method name, it may be `getSelected()` returning an ID, not an entity. Adjust as needed.
- For delete, also call `selectionStore.clear()` or `selectionSystem.deselect()` after destroying so inspector clears

## Done when
- Select an entity, press Del → it disappears from viewport and hierarchy
- Select an entity, press Ctrl+D → a copy appears next to it, also visible in hierarchy
