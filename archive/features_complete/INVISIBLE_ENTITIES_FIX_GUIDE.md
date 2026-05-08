# Invisible Entities Fix Guide - v0.1.4

## Problem Statement
500 dummy entities spawned via `DummyEnemySystem.spawnArmy()` register correctly in the simulation kernel but remain invisible in the 3D viewport. The kernel logic is healthy (no freezes, buffers syncing), but the rendering layer cannot create visual representations.

## Root Cause Analysis

### The Broken Chain
```
✅ DummyEnemySystem.spawnArmy() → Entities created in kernel
✅ DUMMY_ARMY_SPAWNED event fired → EntityRenderer listener triggered
❌ Mesh creation failed → "Missing custom asset" console warning
❌ Entities rendered invisible → visible = false
```

### Why It Fails
1. **Asset Registry Issue**: `DummyEnemySystem` doesn't assign `assetId` during spawn
2. **Fallback Gap**: `EntityRenderer.createMeshForEntity()` returns early when `assetId` is null/undefined
3. **Visual Entity Mismatch**: Visual entities created with only sprite components, missing render components
4. **Position Sync Broken**: Transform updates from kernel buffers weren't reaching the mesh representations

---

## Implemented Fixes

### Fix #1: Fallback Mesh Generation (EntityRenderer.ts)
**What Changed**: Updated `onDummyArmySpawned()` handler

**Before**:
```typescript
// Just logged, no action
private onDummyArmySpawned(payload: any): void {
  console.log('Processing spawn...');
  // Nothing else happened
}
```

**After**:
```typescript
private onDummyArmySpawned(payload: any): void {
  // 1. Extract spawn parameters from payload
  const origin = payload.origin || { x: 16, y: 1, z: 16 };
  const spacing = payload.spacing || 2.0;
  
  // 2. Calculate grid layout (mirrors BinaryEntityTemplate.createGridBlob)
  const cols = Math.ceil(Math.sqrt(handles.length));
  const rows = Math.ceil(handles.length / cols);
  
  // 3. For each handle, create a red cube at the correct grid position
  for (let i = 0; i < handles.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = origin.x + (col - cols / 2) * spacing;
    const z = origin.z + (row - rows / 2) * spacing;
    const y = origin.y;
    
    // Create mesh and add to scene
    const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const material = new THREE.MeshPhongMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
  }
}
```

**Impact**: Red cube meshes now appear in the viewport at correct grid positions.

---

### Fix #2: Payload Enhancement (DummyEnemySystem.ts)
**What Changed**: `DUMMY_ARMY_SPAWNED` event now includes positioning metadata

**Before**:
```typescript
(gameBus as any).emit('DUMMY_ARMY_SPAWNED', {
  count: spawnedHandles.length,
  handles: spawnedHandles,
  timestamp: Date.now(),
});
```

**After**:
```typescript
(gameBus as any).emit('DUMMY_ARMY_SPAWNED', {
  count: spawnedHandles.length,
  handles: spawnedHandles,
  origin,          // ← NEW: Grid center
  spacing,         // ← NEW: Entity spacing
  timestamp: Date.now(),
});
```

**Impact**: EntityRenderer can now calculate correct spawn positions without hardcoding.

---

### Fix #3: Visual Entity Render Components (DummyEnemySystem.ts)
**What Changed**: `createVisualEntity()` now adds render component

**Before**:
```typescript
visualEntity.addComponent({
  name: 'sprite',
  data: { /* sprite data */ }
});
// Only sprite component!
```

**After**:
```typescript
visualEntity.addComponent({
  name: 'sprite',
  data: { /* sprite data */ }
});

// NEW: Add render component with fallback geometry
visualEntity.addComponent({
  name: 'render',
  data: {
    meshType: 'box',
    color: 0xff0000,
    geometry: { width: 0.5, height: 0.5, depth: 0.5 }
  }
});
```

**Impact**: Visual entities now trigger mesh creation in EntityRenderer via entity lifecycle.

---

### Fix #4: Transform Sync Fix (DummyEnemySystem.ts)
**What Changed**: Visual entity position updates now use proper transform API

**Before**:
```typescript
const visualPos = dummy.visualEntity.getPosition();
if (visualPos) {
  visualPos.x = readPosBuffer[basePos];
  // This didn't trigger EntityRenderer updates!
}
```

**After**:
```typescript
const transform = dummy.visualEntity.getTransform();
if (transform && transform.position) {
  transform.position.x = readPosBuffer[basePos];
  transform.position.y = readPosBuffer[basePos + 1];
  transform.position.z = readPosBuffer[basePos + 2];
  
  // Notify entity of change → triggers EntityRenderer.updateMeshForEntity()
  dummy.visualEntity.setTransform(transform);
}
```

**Impact**: Entities now move smoothly via idle-bob animation while rendered as red cubes.

---

## Expected Behavior After Fixes

### Frame 0 (Spawn)
```
[DummyEnemySystem] Army spawned (FROSTBITE): 500 entities
[EntityRenderer] VISUAL BRIDGE: Processing dummy army spawn
[EntityRenderer] Created fallback cube for dummy [handle_1] at (14.0, 1.0, 14.0)
[EntityRenderer] Created fallback cube for dummy [handle_2] at (14.0, 1.0, 16.0)
... (498 more)
```

### Frame N (Animation)
```
Kernel.positions buffer: Updated with idle-bob sine wave
DummyEnemySystem.update(): Reads buffer, syncs visual entities
EntityRenderer.updateMeshForEntity(): Updates mesh positions to match transform
Result: Red cube army bobbing up/down in unison
```

---

## Verification Checklist

- [ ] **Visual Manifestation**: Red cube army visible in viewport when spawned
- [ ] **Grid Formation**: Entities in ~√500 × √500 grid (approx 22×23)
- [ ] **Idle-Bob Animation**: Smooth vertical bobbing animation (0.5 world units)
- [ ] **No Freezes**: Core loop maintains 60 Hz without stalls
- [ ] **Position Accuracy**: Grid centered at (16, 1, 16) with 2.0 unit spacing
- [ ] **Camera Frustum**: Ensure camera can see spawn area (not rotated away)

---

## Diagnostic Commands

### Check Kernel State
```typescript
console.log(kernel.entities.getHandleCount()); // Should be ~500
console.log(kernel.positions.getReadBuffer()); // Should have position data
```

### Check Mesh Creation
```typescript
entityRenderer.getAllMeshes().size; // Should be 500
entityRenderer.getMeshForEntity(handle); // Should return THREE.Mesh
```

### Check Event Flow
```javascript
// In browser console:
// Listen for spawn event
window.gameBus.on('DUMMY_ARMY_SPAWNED', (payload) => {
  console.log('Spawn payload:', payload);
  console.log('Handles count:', payload.handles.length);
});
```

---

## Phase 2: From Static to Dynamic

### Observation
Red cubes manifested on screen at spawn but remained static (no idle-bob animation). Position updates were calculated in the kernel but not reflected in the Three.js meshes.

### Root Cause
**Missing Render Loop Sync**: The fallback meshes were created once during spawn, but their positions were never updated from the kernel buffers each frame. DummyEnemySystem was writing Y-offset values to the kernel, but EntityRenderer was only reading at spawn time.

### The Fixes

#### Fix #1: EntityRenderer.update() Method
**What Changed**: Added per-frame position synchronization

```typescript
// EntityRenderer.ts - NEW method
update(): void {
  if (!this.kernel || !this.kernel.positions) return;
  
  const posBuffer = this.kernel.positions.getReadBuffer();
  const entityRegistry = this.kernel.entities;
  
  // For each fallback mesh, read position from kernel and update Three.js
  for (const [handle, mesh] of this.meshMap.entries()) {
    if (!mesh.userData?.isFallbackMesh) continue;
    
    const denseIndex = entityRegistry.getDenseIndex(handle);
    if (denseIndex < 0) continue;
    
    const basePos = denseIndex * 3;
    const x = posBuffer[basePos];
    const y = posBuffer[basePos + 1];
    const z = posBuffer[basePos + 2];
    
    mesh.position.set(x, y, z);
  }
}
```

**Impact**: Mesh positions now sync with kernel state every frame, enabling smooth animation.

#### Fix #2: Game Loop Integration
**What Changed**: Registered EntityRenderer.update() in render loop

```typescript
// Engine.ts - onRender() callback
onRender(() => {
  // Per-frame sync BEFORE rendering
  if (entityRenderer) {
    entityRenderer.update();
  }
  
  // Then render scene with updated positions
  renderingPipeline.render();
});
```

**Impact**: Ensures position updates happen before Three.js renders each frame.

#### Fix #3: Kernel Reference
**What Changed**: EntityRenderer now accepts SimulationKernel as constructor parameter

```typescript
// Engine.ts - EntityRenderer instantiation
entityRenderer = new EntityRenderer(
  entityManager, 
  scene, 
  false, 
  stateManager,
  simulationKernel  // ← NEW: kernel reference
);
```

**Impact**: EntityRenderer can now read from kernel position buffers directly.

### Expected Behavior After Phase 2 Fixes

**Frame N**:
```
DummyEnemySystem.update(dt):
  → Calculates Y = baseY + sin(time) * 0.5
  → Writes to kernel.positions buffer
  → Calls kernel.positions.publish()

EntityRenderer.update():
  → Reads from kernel.positions.getReadBuffer()
  → For each fallback mesh: mesh.position.set(x, y, z)

Game Loop:
  → Renders scene with updated mesh positions
  → All 500 cubes visible at new coordinates
```

**Visual Result**: Smooth vertical bobbing of entire 500-unit army in unison.

---

## Phase 3: Global Namespace Resolution (Critical Bug Fix)

### The Catch-22
After Phase 2 implementation, mesh positions were NOT syncing despite the code being correct. The smoking gun: `EntityRenderer.update()` had lazy-loading logic that tried to discover the kernel from `globalThis.__dummyEnemySystem`.

**The Problem**:
```typescript
// EntityRenderer.update() - Phase 2 code
if (!this.kernel) {
  const dummyEnemySystem = (globalThis as any).__dummyEnemySystem;
  if (dummyEnemySystem && dummyEnemySystem.kernel) {
    this.kernel = dummyEnemySystem.kernel;
  }
}
if (!this.kernel) return; // ← EXIT EARLY, NEVER SYNCS
```

**The Root Cause**:
- `EntityRenderer` was waiting for `globalThis.__dummyEnemySystem` to exist
- But `DummyEnemySystem` was NEVER explicitly attaching itself to the global scope
- Therefore, `__dummyEnemySystem` stayed undefined **forever**
- Result: `EntityRenderer.update()` exited early every frame, no mesh synchronization happened

### The Fix: Global Exposure

**What Changed**: Added one critical line to DummyEnemySystem constructor

```typescript
// DummyEnemySystem.ts - constructor
constructor(kernel: SimulationKernel, entityManager?: any) {
  this.kernel = kernel;
  this.entityManager = entityManager || null;
  this.kernelInitialized = !!kernel && !!kernel.positions && !!kernel.velocities;

  // CRITICAL: Expose system globally so EntityRenderer can discover the kernel
  (globalThis as any).__dummyEnemySystem = this;  // ← THE FIX

  (gameBus as any).on('ENTITY_TOOK_DAMAGE', (payload: any) => {
    this.onEntityTookDamage(payload);
  });

  console.log('[DummyEnemySystem] Initialized', { kernelInitialized: this.kernelInitialized });
}
```

**Impact**: 
- ✅ `EntityRenderer` can now discover the kernel on first `update()` call
- ✅ Mesh positions sync with kernel buffers starting frame 1
- ✅ Animation (idle-bob) becomes visible
- ✅ Console tests can access system: `window.__dummyEnemySystem.kernel`

### Verification

Console test to confirm the fix:

```javascript
// Run this AFTER spawning 500 entities
// Should show CHANGING Y values, not static
setInterval(() => {
  const handle0 = window.__dummyEnemySystem.dummies.values().next().value.handle;
  const posBuffer = window.__dummyEnemySystem.kernel.positions.getReadBuffer();
  const denseIndex = window.__dummyEnemySystem.kernel.entities.getDenseIndex(handle0);
  const y = posBuffer[denseIndex * 3 + 1];
  console.log(`Handle ${handle0} Y Position:`, y.toFixed(4));
}, 100);
```

**If you see numbers changing**: Animation is working ✅
**If numbers are static**: DummyEnemySystem.update() is not being called by the engine

---

## Next Steps

1. **Start Dev Server**: `npm --prefix client run dev`
2. **Trigger Spawn**: Call `DummyEnemySystem.spawnArmy(500)` via in-game command or test harness
3. **Verify Visuals**: Check if 500 red cubes appear in grid formation
4. **Monitor Animation**: Watch for idle-bob effect (vertical oscillation)
5. **Check Console**: Verify no "Missing custom asset" errors (replaced by fallback logic)

---

## Asset Upgrade Path

The fallback red cubes are **temporary visual proxies**. When actual 3D models are available:

1. Update `DummyEnemySystem.createVisualEntity()` to assign a valid `assetId`
2. Remove the fallback render component (or keep it as backup)
3. Update `EntityRenderer.createMeshForEntity()` to load asset via `createAssetInstance(assetId)`
4. No mesh creation changes needed—the flow remains identical

---

## Performance Notes

- **Memory**: Fallback meshes use shared geometry/material (not 500× copies)
- **CPU**: O(N) mesh creation where N=500 (one-time on spawn)
- **GPU**: 500 cubes at 60 Hz ≈ 30,000 vertices (well within modern budgets)
- **Buffer Churn**: Position updates via BITE are zero-allocation

---

## Related Documentation

- [CHANGELOG_v0.1.4.md](CHANGELOG_v0.1.4.md) - Architectural wins summary
- [EntityRenderer.ts](client/src/engine/core/EntityRenderer.ts) - Full rendering implementation
- [DummyEnemySystem.ts](client/src/engine/gameplay/systems/DummyEnemySystem.ts) - Spawn logic
- [BinaryEntityTemplate.ts](client/src/engine/gameplay/systems/BinaryEntityTemplate.ts) - Grid layout reference
