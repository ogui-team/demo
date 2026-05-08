# COMPREHENSIVE CAMERA & PLAYER MODEL POSITIONING AUDIT

**Date:** April 17, 2026  
**Goal:** Find mismatches between physics entity position, visual mesh position, and camera position that could explain "nudge" corrections.

---

## EXECUTIVE SUMMARY

**CRITICAL FINDING:** There is a **systematic positioning architecture** with THREE separate position values:

1. **Physics Entity Position** - Kernel DOD buffer (ground truth)
2. **Visual Mesh Position** - Three.js mesh driven by entity position updates  
3. **Camera Position** - Manually synced with eye height offset, potentially LAGGING behind entity

**The core issue:** Camera is synced to entity position at specific points in the update loop, but entity position updates come from the kernel. If camera sync happens BEFORE all physics updates complete, the camera can be 1-2 frames behind the actual collision position, making corrections appear as "nudges."

---

## DETAILED FINDINGS

### 1. CAMERA POSITIONING LOGIC

#### Primary Camera Update Location
**File:** [client/src/engine/runtime/coordinators/ClientWorldRuntimeCoordinator.ts](client/src/engine/runtime/coordinators/ClientWorldRuntimeCoordinator.ts#L444)

**Method:** `syncCameraToLocalPlayerEntity()`
```typescript
// Line 444-463
syncCameraToLocalPlayerEntity(): void {
  const camera = Engine.getEngineCamera();
  const localTransform = this.networkSyncSystem.getLocalPlayerTransform();
  if (!camera || !localTransform) return;
  
  const playViewRotation = Engine.getPlayController()?.getViewRotation();
  const viewRotation = playViewRotation ?? localTransform.rotation;
  
  const isCrouching = this.networkSyncSystem.getLocalResolvedMovementState()?.isCrouching ?? false;
  const cameraHeightOffset = isCrouching
    ? ClientWorldRuntimeCoordinator.LOCAL_CROUCH_CAMERA_OFFSET
    : ClientWorldRuntimeCoordinator.LOCAL_STAND_CAMERA_OFFSET;

  camera.rotation.order = 'YXZ';
  camera.position.set(
    localTransform.position.x,
    localTransform.position.y + cameraHeightOffset,  // ← OFFSET APPLIED
    localTransform.position.z,
  );
  camera.quaternion.setFromEuler(
    new THREE.Euler(viewRotation.x, viewRotation.y, viewRotation.z, 'YXZ'),
  );
}
```

**Key Points:**
- Camera reads from `networkSyncSystem.getLocalPlayerTransform()` (NOT directly from entity position)
- **Eye height offset APPLIED:** Y offset added to entity position
- Rotation comes from PlayController (mouse look) with fallback to entity rotation

#### Camera Height Offsets
**File:** [client/src/PhysicsConstants.ts](client/src/PhysicsConstants.ts#L28)

```typescript
PLAYER_EYE_HEIGHT: 1.65,           // units - standing camera height
```

**File:** [client/src/engine/runtime/coordinators/ClientWorldRuntimeCoordinator.ts](client/src/engine/runtime/coordinators/ClientWorldRuntimeCoordinator.ts#L73)

```typescript
private static readonly LOCAL_STAND_CAMERA_OFFSET = 0.65;      // Raised from 0 to head-level
private static readonly LOCAL_CROUCH_CAMERA_OFFSET = 0.1;      // Adjusted from -0.55 to match crouch eye height
```

**POTENTIAL ISSUE:**
- Standing offset = 0.65 units
- Crouch offset = 0.1 units
- These are HARDCODED offsets that may not match the actual collision capsule height
- If entity position Y represents CENTER or BOTTOM of collision shape, offset may be incorrect

#### Camera Sync Call Sites

1. **MultiplayerRuntimeCoordinator.ts** [Line 284, 292](client/src/engine/runtime/coordinators/MultiplayerRuntimeCoordinator.ts#L284)
```typescript
// Called in updateInput loop:
if (!this.mpClient.connected) {
  this.networkSyncSystem.stepLocalInput(movementInput, dt);
  this.worldRuntime.syncCameraToLocalPlayerEntity();  // LOCAL GAME
  return;
}

// MULTIPLAYER PATH (every 50ms / 0.05s):
this.inputSendAccumulator += dt;
while (this.inputSendAccumulator >= 0.05) {
  this.inputSendAccumulator -= 0.05;
  this.networkSyncSystem.queueLocalInput(movementInput);
  this.worldRuntime.syncCameraToLocalPlayerEntity();  // NETWORK GAME
}
```

2. **RuntimeAuxiliaryAssembly.ts** [Line 1077](client/src/engine/runtime/RuntimeAuxiliaryAssembly.ts#L1077)
```typescript
private updateLocalCamera(): void {
  this.worldRuntime.syncCameraToLocalPlayerEntity();
}
```

**TIMING ISSUE:** Camera is synced in `multiplayerInput` update (part of `onUpdate` callbacks), but physics kernel updates happen SEPARATELY. If camera sync runs BEFORE kernel tick, it reads stale position.

---

### 2. PLAYER MODEL / MESH POSITIONING

#### EntityRenderer - Primary Mesh Position Sync
**File:** [client/src/engine/core/EntityRenderer.ts](client/src/engine/core/EntityRenderer.ts#L215)

**Initial Mesh Creation:**
```typescript
// Line 215-230
const mesh = sceneObject;
const baseScale = data.scale ?? { x: 1, y: 1, z: 1 };
const entityScale = transform.scale ?? { x: 1, y: 1, z: 1 };

// MESH POSITION SET HERE ← NO OFFSET
mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
mesh.rotation.order = 'XYZ';
mesh.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
mesh.scale.set(
  baseScale.x * entityScale.x,
  baseScale.y * entityScale.y,
  baseScale.z * entityScale.z,
);
```

**Per-Frame Mesh Update:**
```typescript
// Line 243-252
private updateMeshForEntity(entity: Entity): void {
  const mesh = this.meshMap.get(entity.id);
  if (!mesh) return;

  const transform = entity.getTransform();

  // Update position - DIRECTLY FROM ENTITY
  mesh.position.set(transform.position.x, transform.position.y, transform.position.z);

  // Update rotation
  mesh.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  // ... scale update ...
}
```

**Key Facts:**
- Mesh position = Entity position (1:1 mapping, no offset)
- Mesh is updated when entity emits 'updated' event
- NO camera offset applied to mesh (correct - mesh is body, camera is head)

#### MeshBindingTable - Kernel Positions to Visual Mesh
**File:** [client/src/engine/render/MeshBindingTable.ts](client/src/engine/render/MeshBindingTable.ts#L256)

```typescript
// Line 256-264
syncFromPositionBuffer(positionBuffer: Float32Array, registry: EntityRegistry): void {
  for (const binding of this.bindings.values()) {
    const dense = registry.getDenseIndex(binding.handle);
    if (dense < 0) {
      continue;
    }
    const base = dense * 3;
    binding.mesh.position.set(
      positionBuffer[base],
      positionBuffer[base + 1],
      positionBuffer[base + 2],
    );
  }
}
```

**Purpose:** Syncs kernel DOD positions directly to mesh positions (for dummy armies spawned in bulk).

**Observation:** This is a SEPARATE pathway from EntityRenderer - used for performance-optimized batch updates, reads directly from kernel buffers.

---

### 3. ENTITY POSITION UPDATE FLOW

#### How Entity Position Gets Updated

**Step 1: NetworkSyncSystem reads from kernel**
```typescript
// getLocalPlayerTransform() returns position from networkSyncSystem internal state
// This is synced from kernel's position buffer
```

**Step 2: Entity.getTransform() reads from entity cache**
```typescript
// Entity has internal transform cache that's updated when component changes
```

**Step 3: Kernel Position Buffer (DOD)**
```typescript
// SimulationKernel.positions - Float32Array in DOD format
// Read buffer = last tick's published state
// Write buffer = this tick's in-flight state
```

**TIMING CONCERN:** If camera reads from `getLocalPlayerTransform()` which is synced from kernel's READ buffer (last tick's state), while kernel's WRITE buffer (current tick) has newer position, camera will be 1 frame behind.

---

### 4. INTERPOLATION SYSTEM

**File:** [client/src/engine/graphics/InterpolationSystem.ts](client/src/engine/graphics/InterpolationSystem.ts)

```typescript
// Line 83-120
update(activeCount: number): Float32Array {
  const alpha = this.tickManager.calculateRenderAlpha();

  // Fetch current buffer state
  const readBuffer = this.kernel.positions.getReadBuffer();   // Last tick (published)
  const writeBuffer = this.kernel.positions.getWriteBuffer(); // This tick (in-flight)

  // Linear interpolation between previous and current
  let visualX = prevX + (currX - prevX) * alpha;
  let visualY = prevY + (currY - prevY) * alpha;
  let visualZ = prevZ + (currZ - prevZ) * alpha;

  // Optional: Velocity-based extrapolation
  if (this.config.enableExtrapolation) {
    const extrapolationTime = (1.0 - alpha) * (1000 / 60);
    const extrapolationScale = (extrapolationTime / 1000) * this.config.extrapolationScale;
    visualX += velX * extrapolationScale;
    visualY += velY * extrapolationScale;
    visualZ += velZ * extrapolationScale;
  }

  return this.visualPositions;
}
```

**Key Points:**
- Interpolation system handles smooth movement BETWEEN physics ticks (60Hz kernel, 144Hz render)
- Uses READ and WRITE buffers for before/after state
- Applies velocity-based extrapolation
- **BUT:** This interpolation is for REMOTE entities and dummy armies, NOT for local player camera

**CAMERA DOES NOT USE INTERPOLATION** - it's synced directly, which could cause apparent "snapping" when physics corrections occur.

---

### 5. GAME LOOP ORDERING

**File:** [client/src/engine/foundation/GameLoop.ts](client/src/engine/foundation/GameLoop.ts)

```typescript
function tick(currentTime: number) {
  // Calculate delta time
  deltaTime = (currentTime - lastTime) / 1000;

  // PHASE 1: EXECUTE UPDATE CALLBACKS (all onUpdate registered functions)
  for (let i = 0, len = callbacks.update.length; i < len; i++) {
    callbacks.update[i](deltaTime);
  }

  // PHASE 2: EXECUTE RENDER CALLBACKS (all onRender registered functions)
  for (let i = 0, len = callbacks.render.length; i < len; i++) {
    callbacks.render[i]();
  }

  requestAnimationFrame(tick);
}
```

**Update Order (from RuntimeAuxiliaryAssembly.register()):**
1. **kernelTick** (order 10) - Physics simulation runs
2. **dummyEnemySystem** (order 10) - Dummy army updates
3. **multiplayerInput** (order 20) - **CAMERA SYNC CALLED HERE** ← Camera updated
4. **playerModelSystem** (order 20) - Remote player animations
5. **gameplaySystems** (order varies) - AI, weapons, abilities
6. **localCamera** (order varies) - **CAMERA SYNC ALSO CALLED HERE**

**CRITICAL PROBLEM IDENTIFIED:**
- `kernelTick` runs at order 10
- `multiplayerInput` (which calls `syncCameraToLocalPlayerEntity()`) runs at order 20
- **Camera sync happens AFTER physics tick, but reads position from NetworkSyncSystem**
- NetworkSyncSystem might have a 1-frame buffer/delay

---

### 6. NETWORK SYNC POSITION BUFFERING

**File:** [client/src/engine/runtime/coordinators/MultiplayerRuntimeCoordinator.ts](client/src/engine/runtime/coordinators/MultiplayerRuntimeCoordinator.ts#L284)

```typescript
// Camera is synced from getLocalPlayerTransform() which comes from networkSyncSystem
// The question is: when is networkSyncSystem position updated vs when is it read?
```

**SUSPECTED ISSUE:**
If `networkSyncSystem.getLocalPlayerTransform()` returns a cached/buffered transform from the PREVIOUS frame or previous tick, while the camera is being updated, this creates a 1-frame lag between:
- Physics position (kernel current tick)
- Camera position (networkSyncSystem cached position)

This would explain why corrections feel like "nudges" - the physics has already moved, but camera is catching up 1 frame later.

---

### 7. PLAYER MODEL SYSTEM (REMOTE PLAYERS)

**File:** [client/src/engine/gameplay/game/PlayerModelSystem.ts](client/src/engine/gameplay/game/PlayerModelSystem.ts)

**Remote Player Position Sync:**
```typescript
// Line 696-800 (update method signature)
/**
 * Call this from the game loop (Engine.onUpdate).
 */
update(dt: number): void {
  // Updates remote player model positions with interpolation
  // Reads from buffered snapshots
  // Interpolates between snapshots with alpha blending
}
```

**Key fact:** Remote players use **interpolation + snapshot buffering** (50ms delay), while local player camera does NOT.

**This asymmetry could cause:**
- Remote players appear smooth (interpolated)
- Local player appears to "snap" (direct sync)
- Corrections appear as nudges because camera is synced directly

---

## VISUAL POSITION MAPPINGS

### Local Player (YOU)

```
PHYSICS STATE (Kernel DOD Buffer)
    ↓
    ├─→ Read by: networkSyncSystem.getLocalPlayerTransform()
    │       ├─→ Cached transform value returned
    │       └─→ Used by: syncCameraToLocalPlayerEntity()
    │
    └─→ Read by: EntityRenderer.updateMeshForEntity()
            └─→ Mesh position = entity.position (no offset)

CAMERA POSITION
    = entity.position + cameraHeightOffset
    = entity.position.y + 0.65 (standing)
    = entity.position.y + 0.1 (crouching)

MESH POSITION (Player Body)
    = entity.position (NO offset from physics position)

COLLISION POSITION
    = entity.position (center of capsule or bottom?)
```

### Remote Player

```
NETWORK SNAPSHOT
    ↓
    ├─→ BUFFERED (50ms delay)
    │   └─→ Queued in PlayerModelSystem.pendingSnapshots
    │
    ├─→ INTERPOLATED between prev and target
    │   └─→ alpha = (currentTime - snapshotTime) / interpolationWindow
    │   └─→ visual = lerp(prev, target, alpha)
    │
    └─→ MESH POSITION = interpolated position (smooth)
```

---

## HYPOTHESIS: ROOT CAUSE OF "NUDGES"

### The Problem

When the server sends a **collision correction** (e.g., "player tried to walk through wall, pushed back"):

1. **Physics kernel:** Position is corrected immediately
2. **networkSyncSystem:** Transform is updated with corrected position
3. **Entity:** Position component updated
4. **Mesh:** Updated to reflect physics correction
5. **Camera:** Still at OLD position (hasn't been updated this frame yet)

**Result:** User sees:
- Their view (camera) is at position A
- All visual meshes snap to position B (corrected)
- Camera then updates to position B
- Feels like a "nudge" because camera lagged behind the visual correction

### Why Happens Specifically on Corrections

- **Normal movement:** Smooth, interpolated, camera and body move together
- **Corrections:** Instantaneous jump in physics, but camera on different update schedule
- Happens when `syncCameraToLocalPlayerEntity()` hasn't run yet after correction

---

## CRITICAL MEASUREMENTS

| Metric | Value | Source | Impact |
|--------|-------|--------|--------|
| **Physics Tick Rate** | 60 Hz | Kernel | ~16.67ms between ticks |
| **Render Frame Rate** | 144 Hz | Browser | ~6.94ms between frames |
| **Interpolation Delay** | 50 ms | PlayerModelSystem | Remote players lag 3 ticks |
| **Camera Height Offset** | 0.65 (stand) / 0.1 (crouch) | Constants | Eye position above entity |
| **Camera Sync Timing** | After kernelTick (order 20) | GameLoop | 1 order value after physics |
| **Position Lag** | UNKNOWN | ⚠️ NEEDS INVESTIGATION | Could be 1+ frames |

---

## KEY CODE LOCATIONS SUMMARY

| Purpose | File | Lines | Details |
|---------|------|-------|---------|
| **Camera Position Set** | ClientWorldRuntimeCoordinator.ts | 444-463 | Main camera sync function |
| **Camera Eye Height Offset** | ClientWorldRuntimeCoordinator.ts | 73 | Constants for stand/crouch |
| **Camera Sync Called** | MultiplayerRuntimeCoordinator.ts | 284, 292 | During input update phase |
| **Mesh Position Updated** | EntityRenderer.ts | 243-252 | Per-frame entity update |
| **Mesh Position Set** | EntityRenderer.ts | 215-230 | Initial mesh creation |
| **Kernel Position Buffer** | MeshBindingTable.ts | 256-264 | DOD position sync |
| **Interpolation** | InterpolationSystem.ts | 83-120 | Smooth between ticks (not local player) |
| **Game Loop Order** | GameLoop.ts | 19-50 | tick() function |
| **Kernel Tick** | RuntimeAuxiliaryAssembly.ts | 324 | Physics simulation |
| **Camera Update Order** | RuntimeAuxiliaryAssembly.ts | 1077 | localCamera system |

---

## RECOMMENDATIONS FOR INVESTIGATION

### 1. **Verify Position Lag**
```typescript
// In ClientWorldRuntimeCoordinator.syncCameraToLocalPlayerEntity()
// Add diagnostic logging:
console.log('[CameraSync]', {
  cameraPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
  entityPos: { x: localTransform.position.x, y: localTransform.position.y, z: localTransform.position.z },
  meshPos: mesh.position ? { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z } : null,
  kernelPos: kernel.positions.getReadBuffer()[...], // current entity's position
  offset: cameraHeightOffset,
  timestamp: performance.now(),
});
```

### 2. **Check Eye Height Accuracy**
- Verify collision capsule height vs camera offset
- `PLAYER_COLLISION_RADIUS: 0.8` - is this diameter or radius?
- `LOCAL_STAND_CAMERA_OFFSET: 0.65` - should this be based on capsule height?

### 3. **Trace Position Updates During Correction**
- Add logging when `ENTITY_RECONCILED` event fires
- Log camera position, entity position, mesh position
- Compare frame-by-frame if nudge occurs

### 4. **Verify Update Order**
- Confirm `multiplayerInput` runs after `kernelTick` in practice
- Check if any frame skipping or buffering occurs

### 5. **Test Camera Interpolation**
- Consider applying same interpolation to camera as remote players
- Would smooth out correction "nudges"

---

## NEXT STEPS

1. Create test scenario: walk into wall with debugging enabled
2. Log positions of camera, entity, mesh, kernel each frame
3. Identify exact frame where positions diverge
4. Determine if lag is 1 frame or multiple frames
5. Fix by either:
   - Syncing camera AFTER all kernel updates
   - Adding camera interpolation
   - Adjusting networkSyncSystem buffering

