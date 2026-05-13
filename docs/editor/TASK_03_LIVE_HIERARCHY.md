# Task 03 — Live Hierarchy Panel

## Problem
`HierarchyPanel` shows a hardcoded static list of 10 fake nodes.
It never reads from `EntityManager` so it never shows real entities.

File: `client/src/4-runtime/ui/docking/HierarchyPanel.ts`

The fake data at the top of the file looks like:
```typescript
const HIERARCHY_ITEMS: HierarchyItem[] = [
  { id: 'root', label: 'Scene', depth: 0, kind: 'group' },
  { id: 'map', label: 'MapRoot', depth: 1, kind: 'map-node' },
  ...
```

## What to do

### Step 1 — Add EntityManager to HierarchyPanel constructor

Change `HierarchyPanelOptions` to include an entity manager:
```typescript
interface HierarchyPanelOptions {
  selectionStore: EditorSelectionStore;
  entityManager: {
    getEntities(): Array<{ id: string; type: string }>;
    onEntityCreated(cb: (entity: { id: string; type: string }) => void): () => void;
    onEntityDestroyed(cb: (entity: { id: string; type: string }) => void): () => void;
  };
}
```

### Step 2 — Replace static render with dynamic render

Remove `HIERARCHY_ITEMS` constant entirely.

Replace `renderRows()` with a method that reads from `entityManager.getEntities()`:
```typescript
private renderRows(): void {
  this.list.replaceChildren(); // clear
  this.rowMap.clear();

  const entities = this.entityManager.getEntities();
  for (const entity of entities) {
    this.addRow(entity.id, entity.type);
  }
}

private addRow(entityId: string, label: string): void {
  const row = document.createElement('button');
  row.type = 'button';
  row.dataset.nodeId = entityId;
  row.textContent = label;
  // copy the same style as before
  row.style.cssText = '...'; // keep same styles as original

  row.addEventListener('click', () => {
    this.selectionStore.selectEntity(entityId, label);
  });

  this.rowMap.set(entityId, row);
  this.list.appendChild(row);
}
```

### Step 3 — Subscribe to entity create/destroy

In the constructor, after building the initial list:
```typescript
const unsubCreate = this.entityManager.onEntityCreated((entity) => {
  this.addRow(entity.id, entity.type);
});
const unsubDestroy = this.entityManager.onEntityDestroyed((entity) => {
  this.rowMap.get(entity.id)?.remove();
  this.rowMap.delete(entity.id);
});

// Store these in destroyFns so they get cleaned up
this.destroyFns.push(unsubCreate, unsubDestroy);
```

### Step 4 — Pass entityManager when constructing HierarchyPanel

Search for:
```
new HierarchyPanel
```

Add the entity manager to the options. The entity manager comes from `Engine.getEntityManager()` or the system context. Look at how other systems get it (search for `getEntityManager` or `ctx.entityManager`).

## Done when
- Hierarchy panel shows real entities
- When a prefab is spawned, it appears in the hierarchy immediately
- Clicking a row selects that entity (via Task 02 wiring)
