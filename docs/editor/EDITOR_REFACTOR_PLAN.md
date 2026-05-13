# Editor Refactor Plan

**Written:** 2026-05-13  
**Scope:** Fix four persistent bugs + harden the editor lifecycle for future work.

---

## Root Cause Analysis

### Bug 1 – Drag-to-scene doesn't auto-select

**Flow:**
1. Spawn Library fires `editor:spawn-library-drag-start` (custom event)
2. Viewport `dragover` creates a placement preview
3. Viewport `drop` calls `finishPlacementSession(x, y)`
4. `finishPlacementSession` emits `EDITOR_SPAWN_PREFAB` with `source: 'ui'`
5. `gameBus.on('EDITOR_SPAWN_PREFAB')` fires → sets `autoSelectNextPlacedPrefab = true`
6. `PrefabPlacementSystem` (also listening) calls `placePrefab()` → emits `EDITOR_PREFAB_PLACED`
7. `gameBus.on('EDITOR_PREFAB_PLACED')` checks `autoSelectNextPlacedPrefab` → should select

**Actual break:** The `EDITOR_SPAWN_PREFAB` bus handler (step 5) is registered in a **different closure** from the `EDITOR_PREFAB_PLACED` handler (step 7) — but more critically, the Q menu calls `spawnPrefab(prefabId)` which emits `EDITOR_SPAWN_PREFAB` and that triggers a *different* selection path (via `EditorMenu.spawnPrefab` → `createPlacementSession()`). When using the Q menu, the `createPlacementSession` click-to-place flow fires `source: 'ui'`. When dragging, the drag preview is created with `createPlacementPreview()` — **not** `createPlacementSession()`. The `autoSelectNextPlacedPrefab` flag is only set on `EDITOR_SPAWN_PREFAB` `source === 'ui'`, but both paths emit that. The actual missing step is that the drag `drop` event reads `activeDragPrefabId` which is set by `editor:spawn-library-drag-start` — **but that event is only dispatched by the SpawnLibraryPanel, which lives inside `dockRoot`. If `pointer-events: none` is applied to `dockRoot` during drag, the `dragend` event that clears `activeDragPrefabId` may fire BEFORE `drop`, leaving the flag cleared when `drop` tries to read it.**

**Fix target:** `createRuntimeUiCompositionCoordinator.ts` — swap `activeDragPrefabId` cleanup to happen after `drop` is processed, and always auto-select when source is `drag` at the `finishPlacementSession` call site.

---

### Bug 2 – Scene hierarchy empties after play→editor cycle

**Flow during play→editor:**
1. `GameLaunchCoordinator.onExitPlayMode()` (does NOT merge)
2. `UICompositionCoordinator` calls `restoreEditorWorldFromBuffer()`
3. → `WorldBuildService.applyActiveWorldBuffer()`
4. → `saveLoadManager.deserializeWorld(buffer.runtimeWorld)`
   - Calls `entityManager.clear()` — destroys all entities
   - Each destroyed entity fires `onEntityDestroyed` — hierarchy removes all rows
   - `entityManager.deserialize(entities)` — recreates entities **one by one**
   - For each recreated entity, `onEntityCreated` fires
5. Hierarchy filter: `entity.hasComponent('editorPlacement')` is checked at `onEntityCreated` time

**The break:** `entityManager.deserialize()` calls `createEntity()` which fires `onEntityCreated`, and **then** adds components to the entity. `editorPlacement` is not present on the entity object at the moment `onEntityCreated` fires, so the hierarchy filter `entity.hasComponent('editorPlacement')` returns `false`. The entity is never added to the hierarchy list.

`onEntityUpdated` fires later when components are added, and our `updateRow` (upsert) patch should catch this — but the filter in the `onEntityUpdated` wrapper also checks `entity.hasComponent('editorPlacement')`, and it's possible that components are added **after** the entity update event fires, or the update event is simply not fired during batch deserialization.

Even if `onEntityUpdated` fires correctly, there's a second problem: `WorldBuildService.applyActiveWorldBuffer()` only applies `buffer.runtimeWorld` via `saveLoadManager.deserializeWorld()`. The `buffer.scene` (which is the `SceneSerializationSystem` snapshot with clean editorPlacement metadata) is **never applied during restoration**. The scene snapshot is built as a record of truth but then discarded.

**Fix target:** After `applyActiveWorldBuffer()` completes, trigger a full hierarchy panel rebuild (`renderRows()`). Also: add `sceneSerializationSystem.deserializeScene(buffer.scene)` to the restore flow OR force a hierarchy re-render via a new bus event.

---

### Bug 3 – Prefab children misaligned (one piece spawned far away)

**The multi-piece prefab flow:**
1. `PrefabSystem.create()` → `toSpawnDef(prefab, position)` → children get `toSpawnDef(child, { x: 0, y: 0, z: 0 })`
2. `ObjectCreatorSystem.spawn(def, parentId)` for root entity → creates `entity_root`
3. For each child: `ObjectCreatorSystem.spawn(childDef, rootObjectId)` → creates `entity_child`
4. For each child: a new `THREE.Group` is added to `this.scene` (the scene root) at `(0, 0, 0)` in **world space**
5. The parent's THREE.Group is also at the spawn position in world space
6. Result: parent's mesh is at `(5, 0, 3)` (spawn position), child's group is at `(0, 0, 0)` world origin — **they are disconnected**

**Why the ECS hierarchy doesn't fix it:** `PrefabSystem.linkHierarchy()` calls `sceneGraph.reparent(child.entityId, root.entityId)`. This correctly establishes the parent-child relationship in the ECS SceneGraph — but the THREE.js groups are separate objects in scene root. The renderer uses ECS positions which are relative to the SceneGraph parent, but the THREE.js meshes that the user sees are independently placed in world space.

**My last fix attempt** tried to reparent the child group under the parent group (`scene.remove(childGroup); parentGroup.add(childGroup)`). This is correct direction. But the ordering was wrong: `this.spawn(childDef, id)` is called recursively — the child entity + group are created inside the recursive call, and the parent group is not yet in the correct position when the child attempts to attach to it. Also, `childDef.transform.position` is `{x:0,y:0,z:0}` because `toSpawnDef` always passes 0,0,0 for children — so the relative offset is always (0,0,0) regardless of how the group is parented.

**Root fix required:** Add a `localOffset` field to `PrefabDefinition.children` (or use a wrapper) so child prefabs can declare their offset relative to their parent. `ObjectCreatorSystem.spawn()` must receive the actual spawn position as world-space for root, and local-space offset for children. After children spawn, their THREE.Group must be reparented from scene root to parent group.

---

### Bug 4 – Player spawns in wrong position on toggle

**The flow:**
1. `startLocalFreeplay(fromEditor = true)` → `selectSpawnPosition(..., isEditorToggle: true)`
2. `selectSpawnPosition` with `isEditorToggle=true` → `getForceSpawnPosition()`
3. `getForceSpawnPosition` → reads `getCameraPosition()` → returns engine camera world position ✓
4. `syncOrPossessLocalPlayer(spawnPosition)` — was calling `possessLocalPlayerFromEditorCamera()` which **moves the camera-following player to camera** but from an offset (`DEFAULT_POSSESSION_OFFSET`)

**My last fix** changed `syncOrPossessLocalPlayer` to always call `syncLocalPlayerToAuthoritativeSpawn` directly. This is correct. The remaining risk is that `syncLocalPlayerToAuthoritativeSpawn` uses Y=camera Y, which is eye height. The player capsule might float or clip if the camera was at eye height. The `possessFromEditorCamera()` with offset was compensating for this. Need to apply a Y offset when converting camera position to player spawn position.

---

## Refactor Steps (implement in order)

### Step 1 — Fix drag-to-scene auto-select
**Files:** `createRuntimeUiCompositionCoordinator.ts`

Change: When `drop` fires and `finishPlacementSession` is called, **set `autoSelectNextPlacedPrefab = true` immediately at the call site** (inside `finishPlacementSession`), instead of relying on the `EDITOR_SPAWN_PREFAB` event listener to set it asynchronously. The event listener path is fine for Q-menu but the drag path shares the same session mechanics, so embedding the flag flip inside `finishPlacementSession` makes it unconditional for all drag-and-Q-menu placement.

```typescript
// Before emitting EDITOR_SPAWN_PREFAB, unconditionally pre-arm selection
autoSelectNextPlacedPrefab = true;
gameBus.emit('EDITOR_SPAWN_PREFAB', { ... });
```

---

### Step 2 — Rebuild hierarchy after play→editor restore
**Files:** `WorldBuildService.ts`, `createRuntimeUiCompositionCoordinator.ts`

**Option A (simple):** After `restoreEditorWorldFromBuffer()` resolves successfully in the UI bootstrap coordinator, call `hierarchyPanel.renderRows()` to do a full rebuild from current entity state. The entity manager already has all entities restored at this point.

**Option B (clean):** Add a new `gameBus` event `EDITOR_WORLD_RESTORED`. Emit it at the end of `WorldBuildService.applyActiveWorldBuffer()`. Have `HierarchyPanel` listen for it and call `this.renderRows()`.

Option A is faster to implement. Option B is cleaner long-term.

**Additionally:** Make `HierarchyPanel.renderRows()` `public` (currently `private`) so the coordinator can call it.

---

### Step 3 — Fix prefab child offset storage in PrefabDefinition
**Files:** `PrefabSystem.ts`, `ObjectCreatorSystem.ts`

Currently `PrefabDefinition.children` is `PrefabDefinition[]` — each child is just another prefab definition with no concept of "position relative to parent".

**Change 1:** Add `offset?: { x: number; y: number; z: number }` to `PrefabDefinition` (optional, defaults to 0,0,0). This field is the local position offset within the parent.

```typescript
export interface PrefabDefinition {
  // ... existing fields ...
  offset?: { x: number; y: number; z: number };  // local position relative to parent
  children?: PrefabDefinition[];
}
```

**Change 2:** In `PrefabSystem.toSpawnDef(prefab, position, overrides)`, pass `prefab.offset ?? { x: 0, y: 0, z: 0 }` as the child position when recursing into children:

```typescript
children: prefab.children?.map((child) => 
  this.toSpawnDef(child, child.offset ?? { x: 0, y: 0, z: 0 })
),
```

**Change 3:** In `ObjectCreatorSystem.spawn()`, after spawning all children and getting their groups, reparent each child group from scene root to the parent group. Since children are spawned with positions in local space (relative to parent), their group position is correct once reparented:

```typescript
for (const childDef of resolved.children ?? []) {
  const childId = this.spawn(childDef, id);
  const childObj = this.objects.get(childId);
  if (!childObj) continue;
  obj.children.push(childObj);
  
  const childGroup = this.groups.get(childId);
  if (childGroup && group) {
    this.scene.remove(childGroup);   // detach from world root
    group.add(childGroup);           // attach to parent group (local space)
    // child group position is already correct (local offset from spawn)
  }
}
```

---

### Step 4 — Fix player spawn height on editor toggle
**Files:** `GameLaunchCoordinator.ts`

The camera is at eye height (Y ≈ player Y + 1.7). When spawning the player at camera position, their feet are floating. Apply a standing offset:

```typescript
// In selectSpawnPosition, when using editor camera position:
const editorCameraPos = this.config.getCameraPosition?.() ?? null;
if (editorCameraPos) {
  // Camera is at eye height; adjust to feet level
  return { x: editorCameraPos.x, y: editorCameraPos.y - 1.6, z: editorCameraPos.z };
}
```

This constant should match the capsule half-height used in PlayerModelSystem.

---

### Step 5 — Ensure editorPlacement survives deserialization
**Files:** `createRuntimeUiCompositionCoordinator.ts` (hierarchy panel wiring)

The current `onEntityCreated` filter in the hierarchy adapter checks `entity.hasComponent('editorPlacement')` at creation time. During batch deserialization, components may not be applied yet. Change the adapter to **not filter on `onEntityCreated`** but instead always call `renderRows()` after any world restore:

```typescript
onEntityCreated: (callback) => entityManager?.onEntityCreated((entity) => {
  // During live editing: only show editor entities  
  // After world restore: renderRows() handles the full rebuild
  if (!entity.hasComponent('editorPlacement') && entity.type !== 'LocalPlayer') return;
  callback({ id: entity.id, type: entity.type, label: getEntityLabel(entity) });
}) ?? (() => {}),
```

The `renderRows()` call after restore (Step 2) provides the reliable fallback when `onEntityCreated` misses the component.

---

### Step 6 (optional cleanup) — Unify entity filter in hierarchy to a single predicate
**Files:** `createRuntimeUiCompositionCoordinator.ts`

Extract the filter logic into a named function that's shared between `getEntities`, `onEntityCreated`, and `onEntityUpdated` adapters:

```typescript
const isHierarchyEntity = (entity: Entity): boolean =>
  entity.hasComponent('editorPlacement') || entity.type === 'LocalPlayer';
```

This prevents drift between the three call sites.

---

## Implementation Order

| # | Step | Risk | Time estimate |
|---|------|------|---------------|
| 1 | Auto-select on drag | Low | 10 min |
| 2 | Hierarchy rebuild after restore | Low | 15 min |
| 3a | Add `offset` to PrefabDefinition | Low | 5 min |
| 3b | Fix child group parenting | Medium | 20 min |
| 4 | Player spawn height offset | Low | 5 min |
| 5 | Harden entity created filter | Low | 10 min |
| 6 | Unify filter predicate | Low | 5 min |

**Recommended sequence:** 1 → 2 → 5 (these are independent and low-risk) → 4 → 3a → 3b

---

## Files touched

| File | Steps |
|------|-------|
| `client/src/4-runtime/runtime/bootstrap/createRuntimeUiCompositionCoordinator.ts` | 1, 2, 5, 6 |
| `client/src/4-runtime/ui/docking/HierarchyPanel.ts` | 2 (make `renderRows` public) |
| `client/src/2-systems/gameplay/systems/PrefabSystem.ts` | 3a |
| `client/src/2-systems/gameplay/game/ObjectCreatorSystem.ts` | 3b |
| `client/src/2-systems/gameplay/game/GameLaunchCoordinator.ts` | 4 |
| `client/src/4-runtime/runtime/WorldBuildService.ts` | 2 (Option B) |

---

## What we are NOT changing (intentionally)

- `SceneSerializationSystem` serialization format — already correct  
- `SaveLoadManager` entity serialization — it correctly saves/restores editorPlacement  
- `PrefabSystem.create()` return value and event contract — stable API  
- `finalizePlacedEntity` — already correctly stamps editorPlacement  
- `WorldBuildService.buildActiveWorldBuffer()` — snapshot format stays the same  
- The two-buffer design (`scene` + `runtimeWorld`) — keep as-is for now; the `scene` snapshot is used for save/load from disk but not for play→editor restore (by design, the runtimeWorld path handles the entity ECS state and is sufficient once the hierarchy is rebuilt via `renderRows()`)
