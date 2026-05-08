# Invisible Colliders Fix - COMPLETE

**Date**: April 17, 2026  
**Status**: ✅ RESOLVED & REMOVED  
**Version**: v0.1.4+

---

## Problem Summary

When spawning into FREEPLAY mode, players encountered **invisible blocking walls** that prevented movement but had no visual representation. This was caused by:

1. **Root Cause**: Static colliders from the map were being replicated to the client
2. **Visualization Bug**: THREE.js wasn't available in `window` scope, so collider meshes failed to create
3. **Result**: Physics colliders existed on client (caused blocking) but had no visual representation (invisible walls)

---

## Solution Implemented

### Complete Removal Strategy

We chose to **completely delete the ghost colliders** rather than just hide them because:
- Server-side collision detection still works (physics is authoritative on server)
- No need to replicate static collider entities to client
- Cleaner architecture - client only receives dynamic entities

### Changes Made

#### 1. Server-side: Stop Creating Static Collider Entities
**File**: `server/src/core/GameSession.ts` (lines ~200-215)

**Removed**: Code block that converted static collision boxes to replicable world objects
```typescript
// DELETED: This entire section was removed
const staticLayout = this.collisionAuthority.getStaticLayout();
for (const box of staticLayout.boxes) {
  const staticColliderEntity = {
    id: box.id,
    entityType: 'static_collider',
    position: { ...box.position },
    rotation: { x: 0, y: 0, z: 0 },
    metadata: {
      colliderHalfExtents: { ...box.halfExtents },
      isStaticCollider: true,
    },
  };
  this.worldObjects.set(box.id, staticColliderEntity);
}
```

**Impact**: Static colliders no longer added to `worldObjects`, so they're not sent to clients

#### 2. Server Snapshot Filter: Stop Broadcasting Static Colliders
**File**: `server/src/session/SnapshotFilter.ts` (line 13)

**Before**:
```typescript
const SNAPSHOT_ALLOWED_ENTITY_TYPES = new Set(['player', 'static_collider']);
```

**After**:
```typescript
const SNAPSHOT_ALLOWED_ENTITY_TYPES = new Set(['player']);
```

**Impact**: Even if static colliders existed in worldObjects, they wouldn't be sent in network snapshots

#### 3. Client: Remove Static Collider Visualization Handler
**File**: `client/src/engine/gameplay/game/WorldObjectAuthorityService.ts`

**Removed sections**:
- THREE.js import (no longer needed)
- Debug helpers: `__showColliders`, `__toggleColliders` functions
- Entire `if (obj.entityType === 'static_collider')` block from `spawnOrUpdateRemoteObject()`
  - BoxGeometry mesh creation
  - Material configuration  
  - Scene.add() logic
  - Visibility toggle code

**Result**: Client no longer tries to visualize static colliders at all

---

## How It Works Now

### Physics Side (Server)
```
Map Collision Data → CollisionAuthoritySystem (server-side only)
                  ↓
              Physics Simulation
                  ↓
            Movement Validation
                  ↓
         Entity position sync to client
```

- **Server has**: Static collision boxes for movement validation
- **Server sends to client**: Only player entities
- **Client receives**: Only dynamic entities (players, enemies, etc.)
- **Result**: No invisible walls, physics still correct

### Visual Side (Client)
```
Network Snapshot (only players) → WorldObjectAuthorityService
                                ↓
                    PrefabSystem.createByEntityType()
                                ↓
                    Visual representation
```

---

## Testing Commands

### Current State (v0.1.4+)
**No collider visualization code remains**. To test the fix:

1. **Start game**: `npm run dev` (client) + server running
2. **Launch FREEPLAY**: Click "Solo Sandbox"
3. **Expected**: Clean gameplay area with no red boxes, movement works correctly
4. **Collision test**: Try to walk through map boundaries - should hit invisible wall (server-side physics)

---

## If You Need Debug Visualization in Future

If future development needs to visualize static colliders for debugging map design:

### Option A: Restore Simple Debug Overlay
Create a debug mode that loads map colliders from server data and renders them locally:

```typescript
// In a debug utility file
export function enableStaticColliderDebugViz() {
  const scene = Engine.getEngineScene();
  const collisionData = window.__mapColliders; // Load from map data
  
  collisionData.boxes.forEach(box => {
    const geometry = new THREE.BoxGeometry(
      box.halfExtents.x * 2,
      box.halfExtents.y * 2,
      box.halfExtents.z * 2
    );
    const material = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(box.position.x, box.position.y, box.position.z);
    mesh.name = `debug_collider_${box.id}`;
    scene.add(mesh);
  });
}
```

**Console command**:
```javascript
window.enableStaticColliderDebugViz()
```

### Option B: Re-enable Network Replication
If you need to visualize colliders received from server again:

1. Restore `'static_collider'` in `SNAPSHOT_ALLOWED_ENTITY_TYPES`
2. Restore static collider creation in GameSession.ts
3. Restore visualization in WorldObjectAuthorityService.ts
4. Add toggle: `window.__showColliders = true/false`

---

## Performance Impact

**Positive**:
- ✅ Reduced network snapshot size (no static collider entities)
- ✅ Reduced client-side entities to process
- ✅ Cleaner scene graph (no invisible meshes)

**Maintained**:
- ✅ Server-side collision detection unchanged
- ✅ Movement validation still accurate
- ✅ Physics simulation unchanged

---

## Verification Checklist

- ✅ No static_collider handling in WorldObjectAuthorityService.ts
- ✅ SNAPSHOT_ALLOWED_ENTITY_TYPES = ['player'] only
- ✅ GameSession.ts doesn't create static collider entities
- ✅ Client builds without errors
- ✅ Freeplay loads without invisible walls
- ✅ Movement collision still works (server-side physics)

---

## References

**Related Files**:
- `server/src/core/GameSession.ts` - Entity creation (colliders removed)
- `server/src/session/SnapshotFilter.ts` - Network filtering
- `client/src/engine/gameplay/game/WorldObjectAuthorityService.ts` - Entity spawning
- `server/src/collision/CollisionAuthoritySystem.ts` - Server-side physics (unchanged)
- `server/src/collision/MapCollisionData.ts` - Map collision data (unchanged)

**Historical Context**:
- Previous version had red semi-transparent boxes visible (debug visualization)
- These were hidden with `window.__toggleColliders()` command
- Complete removal was chosen over hiding for cleaner architecture
