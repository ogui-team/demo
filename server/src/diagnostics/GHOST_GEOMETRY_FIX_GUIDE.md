# Ghost Geometry Analysis & Fix Guide

## Problem Summary
Players collide with invisible walls - physics colliders exist on server but no meshes on client.

---

## ROOT CAUSE ANALYSIS

### 1. Map Loading Architecture

**Server-side loading** (`server/src/collision/MapCollisionData.ts`):
```typescript
// Maps are loaded from shared JSON file
const candidates = [
  'client/src/assets/mapColliders.json',
  '../client/src/assets/mapColliders.json',
  '../../client/src/assets/mapColliders.json',
];
// CACHED globally - loaded once, reused for all sessions
```

**Map structure**:
```json
{
  "version": 1,
  "maps": {
    "map_default": {
      "bounds": { "halfWidth": 50, "halfDepth": 50 },
      "boxes": [...static boxes...],
      "seeded": {
        "crateStacks": { procedural generation config }
      }
    }
  }
}
```

### 2. Collision Data Types

The server loads THREE types of colliders:
1. **Static boxes** - from JSON `maps[mapId].boxes[]`
2. **Seeded boxes** - procedurally generated each session based on sessionId
3. **Dynamic boxes** - added at runtime (players, world objects)

### 3. Current Snapshot Filter

**Location**: `server/src/session/SnapshotFilter.ts`

```typescript
const SNAPSHOT_ALLOWED_ENTITY_TYPES = new Set(['player']);
```

**Problem**: 
- ONLY 'player' entities are replicated to client
- Static colliders are NOT in this set
- World objects are NOT in this set
- Result: Client receives NO collision geometry except for players

### 4. Where Ghost Geometry Comes From

The physics kernel on client gets initialized with:
- Player positions (from snapshots)
- Replicated world objects (if any)
- BUT: NO static collision data from server's mapColliders.json

However, the server USES the static colliders for:
- Player movement validation
- Raycasting
- Collision detection
- Result: Player slides along invisible walls

---

## Entity Lifecycle: Why Static Colliders Don't Replicate

### Server-side (GameSession.ts):
1. `CollisionAuthoritySystem` loads `mapColliders.json` ✓
2. Static boxes stored in `staticLayout.boxes[]` ✓
3. But: Never converted to `EntityState` or `WorldObjectState` ✗
4. So: Never assigned a `networkEntityId` ✗
5. So: Never included in snapshot broadcast ✗

### Client-side (receives):
1. Snapshot arrives with only 'player' entities
2. Physics kernel has position buffer but NO static data
3. Renderer creates meshes for players only
4. Physics checks use... what? (kernel is missing collision data) ✓
5. Result: Physics accepts movement, but renderer shows nothing

---

## EntityRegistry Orphan Detection

**Location**: `client/src/1-kernel/core/kernel/EntityRegistry.ts`

Orphaned entities are those with:
- No `networkEntityId` assigned
- Or `networkEntityId` but entity type not in `SNAPSHOT_ALLOWED_ENTITY_TYPES`

**Check these**:
```typescript
// In EntityRegistry, iterate all handles:
forEachDense((denseIndex, handle) => {
  const networkId = handleToNetworkId.get(handle);
  if (!networkId) {
    console.warn(`Orphaned entity at index ${denseIndex}: no networkId`);
  }
});
```

---

## Map Caching Issue

**Cached at module level**:
```typescript
let cachedConfig: CollisionConfig | null = null;

function loadCollisionConfig(): CollisionConfig {
  if (cachedConfig) return cachedConfig;  // REUSED GLOBALLY
  // ... load from file ...
  cachedConfig = JSON.parse(...);
  return cachedConfig;
}
```

**Problem if map updates**:
- First session loads map into cache
- Subsequent sessions REUSE cached map
- If map file changes, old servers don't reload it
- **Solution**: Clear cache between sessions or use sessionId in cache key

---

## STEP-BY-STEP FIX

### Step 1: Detect Ghost Geometry (Diagnostic)

Run on server startup:
```typescript
// In GameSession.constructor(), after CollisionAuthoritySystem init:
import { analyzeGhostGeometry } from '../diagnostics/GhostGeometryDiagnostic';

const diagnostic = analyzeGhostGeometry(
  this.collisionAuthority.getStaticLayout(),
  this.replicatedEntityIds,
  room.selectedMap,
  this.sessionId
);

if (!diagnostic.isValid) {
  console.error(diagnostic.details);
}
```

### Step 2: Create Replicable Collision Objects

```typescript
// In GameSession.constructor():
import { createReplicableCollisionObjects } from '../diagnostics/GhostGeometryDiagnostic';

const staticCollisionBoxes = 
  this.collisionAuthority.getStaticLayout().boxes;

const replicableObjects = createReplicableCollisionObjects(staticCollisionBoxes);

// Add to world objects (these will now be replicated):
for (const obj of replicableObjects) {
  this.worldObjects.set(obj.id, obj as any);
  this.replicatedEntityIds.add(obj.networkEntityId);
}
```

### Step 3: Update Snapshot Filter

Edit `server/src/session/SnapshotFilter.ts`:
```typescript
// CHANGE THIS:
const SNAPSHOT_ALLOWED_ENTITY_TYPES = new Set(['player']);

// TO THIS:
const SNAPSHOT_ALLOWED_ENTITY_TYPES = new Set([
  'player',
  'static_collider',  // Now static colliders will be sent to client
]);
```

### Step 4: Client-side Visualization

Option A - Use Debug Visualizer:
```typescript
import { PhysicsDebugVisualizer } from '../core/PhysicsDebugVisualizer';

const debugViz = new PhysicsDebugVisualizer(kernel, scene);

// In render loop:
if (DEBUG_MODE) {
  debugViz.renderPhysicsDebugColliders();
  debugViz.renderStaticColliders(staticColliderDataFromSnapshot);
}
```

Option B - Create Actual Meshes:
```typescript
// In ClientWorldRuntimeCoordinator, when spawning 'static_collider' entity:
if (entity.metadata?.isStaticCollider) {
  const { colliderHalfExtents } = entity.metadata;
  const geometry = new THREE.BoxGeometry(
    colliderHalfExtents.x * 2,
    colliderHalfExtents.y * 2,
    colliderHalfExtents.z * 2
  );
  const material = new THREE.MeshStandardMaterial({
    color: 0x888888,
    metalness: 0.5,
    roughness: 0.5,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(entity.position);
  scene.add(mesh);
}
```

---

## FILES INVOLVED

### Server:
- `server/src/collision/MapCollisionData.ts` - Loads mapColliders.json
- `server/src/collision/CollisionAuthoritySystem.ts` - Manages static/dynamic colliders
- `server/src/core/GameSession.ts` - Creates session, initializes collisions
- `server/src/session/SnapshotFilter.ts` - FILTER CONTROLS REPLICATION
- `server/src/snapshot/SnapshotBroadcast.ts` - Sends snapshots to client

### Client:
- `client/src/assets/mapColliders.json` - **SOURCE OF TRUTH** for collision geometry
- `client/src/1-kernel/core/kernel/SimulationKernel.ts` - Physics kernel
- `client/src/1-kernel/core/kernel/PositionStorage.ts` - Position buffer
- `client/src/1-kernel/core/EntityRenderer.ts` - Renders entities to meshes
- `client/src/4-runtime/runtime/coordinators/ClientWorldRuntimeCoordinator.ts` - Scene management

---

## DIAGNOSTICS: How to Check

### On Server:
```typescript
// Get collision diagnostics:
const diags = collisionAuthority.getDiagnostics();
console.log(diags);
// Output: {
//   staticColliderCount: 50,
//   dynamicColliderCount: 2,
//   hasStaticLayout: true,
// }
```

### On Client:
```typescript
// Use PhysicsDebugVisualizer to see what the kernel has:
const viz = new PhysicsDebugVisualizer(kernel, scene);
viz.renderPhysicsDebugColliders();
const stats = viz.getDebugStats();
console.log(stats);
// Output: {
//   debugMeshesCount: 2,      // Only players!
//   kernelEntityCount: 2,     // Should be 50+ if static colliders were synced
// }
```

---

## VERIFICATION CHECKLIST

- [ ] Run `analyzeGhostGeometry()` on server startup
- [ ] Static collider count should match JSON file
- [ ] Replicated entity count should increase after fix
- [ ] Snapshot should include 'static_collider' entities
- [ ] Client receives static colliders in snapshot
- [ ] PhysicsDebugVisualizer shows all colliders
- [ ] Player can see/walk against what they collide with

---

## PERFORMANCE NOTES

**Sending static geometry per tick is expensive!**

Optimization: Send static colliders ONCE at session start, not every frame:
- Use a separate "MAP_INIT" or "LEVEL_GEOMETRY" message
- Send only on first connection
- Cache on client permanently
- Only send dynamic colliders in regular snapshots

```typescript
// Better: Send static colliders separately
if (firstSnapshot) {
  sendMessage({
    type: 'STATIC_COLLIDERS',
    boxes: allStaticBoxes,
  });
}

// Then only dynamic objects in regular ticks:
sendMessage({
  type: 'WORLD_DELTA',
  entities: dynamicEntitiesOnly,
});
```

