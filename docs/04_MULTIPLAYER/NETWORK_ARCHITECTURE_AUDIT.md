# Comprehensive Multiplayer/Network Architecture Audit

**Date**: April 16, 2026 | **Project**: NEXUS ENGINE v0.1.4+  
**Scope**: Client-server network synchronization, tick systems, entity replication, and DOD integration

---

## 1. CURRENT NETWORK ARCHITECTURE

### 1.1 Server Tick Rate & Structure

| Property | Value | File | Line |
|----------|-------|------|------|
| **Server Tick Rate** | **60 Hz** | [server/src/core/GameSession.ts](server/src/core/GameSession.ts#L186) | 186 |
| Tick Interval (ms) | 16.67 ms | [server/src/core/GameSession.ts](server/src/core/GameSession.ts#L269) | 269 |
| Fixed Step | 1/60 | [server/src/core/GameSession.ts](server/src/core/GameSession.ts#L796) | 796 |
| Constructor Default | 60 | [server/src/core/GameSession.ts](server/src/core/GameSession.ts#L193) | 193 |

**Key Code**:
```typescript
private tickRate = 60; // FIXED: Increased from 20 Hz to 60 Hz to match client frame rate (fixes rubberbanding)
constructor(room: LobbyRoom, tickRate = 60) { // FIXED: Default param changed from 20 to 60
  this.tickRate = tickRate;
  this.tickInterval = setInterval(() => this._gameTick(), 1000 / this.tickRate);
  const step = 1 / this.tickRate;  // 0.01667 seconds per tick
}
```

---

### 1.2 Client Update Frequency

| Property | Value | File | Line |
|----------|-------|------|------|
| **Client State Update Interval** | **50 ms (20 Hz)** | [client/src/engine/network/NetworkManager.ts](client/src/engine/network/NetworkManager.ts#L47) | 47 |
| **Client Frame Rate** | **~60 fps** | [client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts](client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts#L67) | 67 |
| Snapshot Interpolation Delay | 50 ms | [client/src/engine/runtime/bootstrapClientRuntime.ts](client/src/engine/runtime/bootstrapClientRuntime.ts#L160) | 160 |

**Key Code**:
```typescript
// NetworkManager.ts - Client sends state every 50ms
private stateUpdateInterval: number = 0.05; // Send state every 50ms
private stateSendAccumulator: number = 0;

update(deltaTime: number): void {
  this.stateSendAccumulator += deltaTime;
  if (this.stateSendAccumulator >= this.stateUpdateInterval) {
    this.sendLocalPlayerState();
    this.stateSendAccumulator = 0;
  }
}

// KernelMovementIntegration.ts - Client kernel runs at 60Hz
private readonly fixedStep = 1 / 60;
```

**Synchronization Issue**: 
- ⚠️ **Server ticks at 60 Hz (16.67 ms)**, but client sends state at **20 Hz (50 ms)**
- This creates **3× tick mismatch** - server generates 3 ticks per client update
- Can cause inconsistent input processing and movement stuttering

---

### 1.3 Network Message Format

#### Snapshot Contract (Server → Client)

**File**: [server/src/snapshot/SnapshotContract.ts](server/src/snapshot/SnapshotContract.ts)  
**Schema Version**: `2`  
**Delta Mode**: `sparse-entity-delta-v1`

```typescript
export interface SnapshotEnvelopeContract {
  schemaVersion: number;                    // Version 2
  deltaMode: typeof SNAPSHOT_DELTA_MODE;    // "sparse-entity-delta-v1"
  tick: number;                             // Server tick number
  ack: number;                              // Acknowledgement of client input
  timestamp: number;                        // Server timestamp
  entities: Array<Record<string, unknown>>; // Entity state deltas
  events: Array<Record<string, unknown>>;   // Gameplay events
}
```

**Broadcast Logic**:  
[server/src/snapshot/SnapshotBroadcast.ts](server/src/snapshot/SnapshotBroadcast.ts)
- Hard-filters out grunt entities before snapshot processing (line 89-111)
- Per-player relevance filtering: entities outside **relevanceRadius (72 units)** filtered
- **Always includes local player** regardless of distance (line 133-135)
- Tracks delta entities count per snapshot
- Maintains per-player snapshot stores in `Map<playerId, Map<entityId, snapshot>>`

#### Input Command Format (Client → Server)

**File**: [client/src/engine/network/NetworkRuntimeContracts.ts](client/src/engine/network/NetworkRuntimeContracts.ts)

```typescript
export interface NetworkInputCommand {
  playerId: string;
  seq: number;           // Sequence number for ordering
  tick: number;          // Client tick this input was generated
  timestamp: number;     // Client timestamp
  input: Record<string, unknown>;  // Movement/action input data
}
```

#### Entity Replication Format

**File**: [client/src/engine/network/NetworkRuntimeContracts.ts](client/src/engine/network/NetworkRuntimeContracts.ts)

```typescript
export interface NetworkReplicatedEntityState {
  entityId: string;
  tick: number;
  transform?: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale?: { x: number; y: number; z: number };
  };
  velocity?: { x: number; y: number; z: number };
  replicated?: Record<string, unknown>;
}
```

---

### 1.4 Interpolation Code

#### Client-Side Interpolation

**Interpolation Delay**: 50 ms (line 160 of [bootstrapClientRuntime.ts](client/src/engine/runtime/bootstrapClientRuntime.ts))

```typescript
playerModelSystem.setSnapshotInterpolationDelayMs(50);
```

**Reconciliation with Lerp Correction**:  
[client/src/engine/network/NetworkSnapshotReconciler.ts](client/src/engine/network/NetworkSnapshotReconciler.ts)

```typescript
private static readonly CORRECTION_LERP_FACTOR = 0.15;       // 15% blend toward authoritative
private static readonly PERF_WARNING_DISTANCE = 0.35;        // Distance threshold for warnings
private static readonly PERF_WARNING_STREAK = 8;             // Warn after 8 consecutive corrections

processSnapshot(snapshot: AuthoritativeSnapshot): void {
  for (const entity of snapshot.entities) {
    const handle = this.entityRegistry.getHandleByNetworkId(entity.networkEntityId);
    // Read current position from TypedArray
    const currentPosition = {
      x: authoritativeRead[base],
      y: authoritativeRead[base + 1],
      z: authoritativeRead[base + 2],
    };
    // Calculate correction delta
    const deltaX = entity.position.x - currentPosition.x;
    const deltaY = entity.position.y - currentPosition.y;
    const deltaZ = entity.position.z - currentPosition.z;
    const distance = Math.sqrt((deltaX*deltaX) + (deltaY*deltaY) + (deltaZ*deltaZ));
    
    if (distance > this.errorThreshold) {
      // Apply lerp correction (blend 15% toward server position)
      const blendedX = currentPosition.x + (deltaX * CORRECTION_LERP_FACTOR);
      const blendedY = currentPosition.y + (deltaY * CORRECTION_LERP_FACTOR);
      const blendedZ = currentPosition.z + (deltaZ * CORRECTION_LERP_FACTOR);
      
      this.positionStorage.setAuthoritativeWriteXYZ(denseIndex, blendedX, blendedY, blendedZ);
    }
  }
}
```

**Smoothness Monitoring**:  
[client/src/engine/testing/MovementSmoothnessTest.ts](client/src/engine/testing/MovementSmoothnessTest.ts) - Captures reconciliation events on `gameBus.on('SMOOTHNESS_SAMPLE', ...)`

---

## 2. TICK SYNCHRONIZATION

### 2.1 How Kernel Ticks Are Synchronized

**Server Side** ([server/src/core/GameSession.ts](server/src/core/GameSession.ts)):
1. Server runs `_gameTick()` at fixed 60 Hz interval
2. Each tick:
   - Processes player input commands (line ~405)
   - Updates player movement via `applyActivePlayerMovement()` (line ~796)
   - Applies physics step
   - Broadcasts snapshot with current `tick` number

**Client Side** ([client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts](client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts)):
1. Client kernel runs at 60 Hz with `fixedStep = 1/60` (line 67)
2. Each frame:
   - Integrates velocities via `MovementIntegrateSystem.execute()` (line 84)
   - Accumulates time in accumulator (line ~160)
   - Steps kernel at 60 Hz to match server

**Sync Point**: Tick numbers in snapshots ([server/src/snapshot/SnapshotBroadcast.ts](server/src/snapshot/SnapshotBroadcast.ts))
```typescript
tick: number;  // Server tick number sent in every snapshot
ack: number;   // Client's last processed input sequence
```

**Issue Identified**:
- ⚠️ Server broadcasts snapshots **every tick (60 Hz)** but there's **NO feedback about actual send rate**
- ⚠️ Client **cannot determine expected snapshot arrival interval**
- ⚠️ Creates **unpredictable interpolation** as noted in [NETWORK_STABILITY_PLAN.md](NETWORK_STABILITY_PLAN.md#L21-L26)

---

### 2.2 Timestamp Handling

| Component | Usage | File | Line |
|-----------|-------|------|------|
| **Server Timestamp** | Snapshot creation time | [server/src/snapshot/SnapshotBroadcast.ts](server/src/snapshot/SnapshotBroadcast.ts#L200) | ~200 |
| **Client Timestamp** | Input command creation | [client/src/engine/network/NetworkRuntimeContracts.ts](client/src/engine/network/NetworkRuntimeContracts.ts#L9) | 9 |
| **Latency Simulation** | LocalNetworkTransport | [client/src/engine/network/NetworkTransport.ts](client/src/engine/network/NetworkTransport.ts#L31) | 31 |

**Timestamp Format**: `Date.now()` (milliseconds since epoch)

**Sanitization**:  
[server/src/session/playerValidationRuntime.ts](server/src/session/playerValidationRuntime.ts) - Function `sanitizeTimestamp()` validates incoming timestamps

---

### 2.3 Extrapolation Logic

**Current State**: ❌ **NO EXTRAPOLATION IMPLEMENTED**

**Prediction Mode Settings** ([client/src/engine/network/CollisionAuthoritySystem.ts](client/src/engine/network/CollisionAuthoritySystem.ts)):
```typescript
export type RemotePredictionMode = 'deterministic' | 'server_only';
private remotePredictionMode: RemotePredictionMode = 'deterministic';

canPredictMovement(authorityMode: 'local' | 'remote'): boolean {
  return this.remotePredictionMode === 'deterministic' && this.hasStaticLayout;
}
```

**Current Behavior**:
- Deterministic prediction is **enabled but only for collision checks** (not for rendering position)
- Remote entity positions are **NOT extrapolated** from velocity
- Positions use **only lerp correction** (15% blend toward server)
- This causes **visual lag** on remote player movement

---

## 3. KEY NETWORK FILES

### Server-Side

| File | Purpose | Key Classes/Functions |
|------|---------|----------------------|
| [server/src/core/GameSession.ts](server/src/core/GameSession.ts) | Core server session, tick loop, player state | `GameSession`, `_gameTick()` |
| [server/src/core/GameState.ts](server/src/core/GameState.ts) | Player/object state management | `GameState`, `players` Map |
| [server/src/snapshot/SnapshotBroadcast.ts](server/src/snapshot/SnapshotBroadcast.ts) | Snapshot delta encoding & broadcast | `broadcastWorldDelta()` |
| [server/src/snapshot/SnapshotContract.ts](server/src/snapshot/SnapshotContract.ts) | Protocol definition | Schema version 2, delta mode |
| [server/src/session/playerInputRuntime.ts](server/src/session/playerInputRuntime.ts) | Input validation & processing | `processPlayerInput()` |
| [server/src/session/tickRuntime.ts](server/src/session/tickRuntime.ts) | Per-tick entity/movement updates | `applyActivePlayerMovement()` |
| [server/src/actor/AuthoritativeActorRuntime.ts](server/src/actor/AuthoritativeActorRuntime.ts) | NPC/actor simulation | `ensureSingleton()`, `update()` |
| [server/src/movement/MovementRuntime.ts](server/src/movement/MovementRuntime.ts) | Player movement integration | `applyPlayerMovementStep()` |
| [server/src/session/SnapshotFilter.ts](server/src/session/SnapshotFilter.ts) | Entity relevance filtering | `isEntityAllowedForSnapshot()`, grunt filtering |

### Client-Side

| File | Purpose | Key Classes/Functions |
|------|---------|----------------------|
| [client/src/engine/network/MultiplayerClient.ts](client/src/engine/network/MultiplayerClient.ts) | Main network client facade | `MultiplayerClient`, event handling |
| [client/src/engine/network/NetworkManager.ts](client/src/engine/network/NetworkManager.ts) | State sync & input sending | `NetworkManager`, 50ms send interval |
| [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts) | Snapshot reception & replication | Movement intent handling |
| [client/src/engine/network/NetworkSnapshotReconciler.ts](client/src/engine/network/NetworkSnapshotReconciler.ts) | Position reconciliation with lerp | `processSnapshot()`, 15% correction |
| [client/src/engine/network/NetworkTransport.ts](client/src/engine/network/NetworkTransport.ts) | WebSocket & local transport layers | `WebSocketNetworkTransport`, `LocalNetworkTransport` |
| [client/src/engine/network/SnapshotContract.ts](client/src/engine/network/SnapshotContract.ts) | Protocol validation | `isSupportedSnapshotSchema()` |
| [client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts](client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts) | Bootstrap & kernel integration | Kernel init, movement system wiring |
| [client/src/engine/core/kernel/MovementIntegrateSystem.ts](client/src/engine/core/kernel/MovementIntegrateSystem.ts) | Velocity → position integration | `execute()` - direct TypedArray writes |
| [client/src/engine/core/kernel/SnapshotWriter.ts](client/src/engine/core/kernel/SnapshotWriter.ts) | Kernel state serialization | Captures DOD buffer state |
| [client/src/engine/core/kernel/SnapshotReader.ts](client/src/engine/core/kernel/SnapshotReader.ts) | Kernel state deserialization | Zero-copy reads of position buffer |
| [client/src/engine/runtime/coordinators/MultiplayerRuntimeCoordinator.ts](client/src/engine/runtime/coordinators/MultiplayerRuntimeCoordinator.ts) | Multiplayer lifecycle orchestration | Server connection, game launch |

---

## 4. CURRENT ISSUES IDENTIFIED

### 4.1 Position Update Flow

**Server Side**:
1. **Input Processing** → [server/src/session/playerInputRuntime.ts](server/src/session/playerInputRuntime.ts#L19-L45)
   - Validates input sequence & timing
   - Sets `player.currentInput`
   
2. **Movement Step** → [server/src/movement/MovementRuntime.ts](server/src/movement/MovementRuntime.ts#L65-L140)
   - Applies physics (gravity, acceleration, air control)
   - **Directly writes to `player.position`** (Vec3 object)
   - Line ~140: `nextPosition = this.host.resolveMovement(...)`

3. **Position Broadcast** → [server/src/snapshot/SnapshotBroadcast.ts](server/src/snapshot/SnapshotBroadcast.ts#L200-L250)
   - Reads `entity.position` from in-memory player state
   - Creates delta snapshot
   - Broadcasts every tick (60 Hz)

**Issue**: ⚠️ **Raw in-memory objects** (not TypedArrays) - no DOD structure on server

---

### 4.2 Visual Entity Positioning

**Client Side**:
1. **Snapshot Received** → [client/src/engine/network/NetworkSnapshotReconciler.ts](client/src/engine/network/NetworkSnapshotReconciler.ts#L35-L95)
   - Gets position from `snapshot.entities[].position`
   - Reads current position from DOD buffer: `authoritativeRead[base]` etc.
   - **Applies 15% lerp correction** toward server position

2. **Kernel Integration Step** → [client/src/engine/core/kernel/MovementIntegrateSystem.ts](client/src/engine/core/kernel/MovementIntegrateSystem.ts#L60-L75)
   - Reads velocity from DOD `velocityStorage`
   - **Integrates directly into position buffer**: 
     ```typescript
     positionWriteBuffer[i] += velocity[i] * dt;
     ```

3. **Render Layer** → [client/src/engine/core/EntityRenderer.ts](client/src/engine/core/EntityRenderer.ts)
   - Reads positions from kernel DOD buffers
   - **Direct mesh binding** via [client/src/engine/render/MeshBindingTable.ts](client/src/engine/render/MeshBindingTable.ts)
   - Updates THREE.js mesh positions

**Issue**: ⚠️ **Position updates every frame (60 fps) but snapshots arrive every 50ms (20 Hz)**
- Server broadcasts EVERY tick but client only processes network every 50ms
- Creates **stuttering effect** - position stays frozen for 50ms, then jumps

---

### 4.3 Frame Synchronization Points

| Point | Frequency | Behavior | Issue |
|-------|-----------|----------|-------|
| **Server Tick** | 60 Hz (16.67 ms) | Movement integration | Server runs 3 ticks per client input |
| **Client Input Send** | 20 Hz (50 ms) | Network message | 3× mismatch with server tick |
| **Snapshot Broadcast** | 60 Hz (16.67 ms) | Per tick | Should arrive ~50-100 ms later at client |
| **Snapshot Reception** | Variable | Lerp correction | Client doesn't know expected arrival |
| **Client Frame Render** | 60 Hz (16.67 ms) | Mesh update | Interpolates between lerped positions |

**Critical Issue**: ⚠️ **No predictable snapshot timing**
- As noted in [NETWORK_STABILITY_PLAN.md](NETWORK_STABILITY_PLAN.md#L45-L47):
  ```
  Clients [receive snapshot, don't know rate]
    ↓ [can't predict next snapshot]
  ```

---

### 4.4 TODO/FIXME Comments Related to Sync

| File | Line | Comment |
|------|------|---------|
| [server/src/core/GameSession.ts](server/src/core/GameSession.ts#L798) | 798 | `// Broadcast tick sync every frame so clients can sync interpolation timing` |
| [client/src/engine/core/kernel/SimulationKernel.ts](client/src/engine/core/kernel/SimulationKernel.ts#L373) | 373 | `SYNC_ERROR: Entity ${entity.networkEntityId} position drift` |
| [client/src/engine/core/kernel/MovementIntegrateSystem.ts](client/src/engine/core/kernel/MovementIntegrateSystem.ts#L46-L54) | 46-54 | `// FIX: Don't block movement during reconciliation` |
| [NETWORK_STABILITY_PLAN.md](NETWORK_STABILITY_PLAN.md#L21) | - | `Moving player doesn't interpolate own position (no self-snapshot)` |
| [NETWORK_STABILITY_PLAN.md](NETWORK_STABILITY_PLAN.md#L26) | - | `Snapshots arrive at random intervals → position jumps` |

---

## 5. DOD INTEGRATION

### 5.1 Networked Entity Storage

**Kernel DOD Buffers**:

| Buffer | Type | File | Purpose |
|--------|------|------|---------|
| **positions** | Float32Array | [client/src/engine/core/kernel/PositionStorage.ts](client/src/engine/core/kernel/PositionStorage.ts) | Entity XYZ coordinates (dense layout) |
| **velocities** | Float32Array | [client/src/engine/core/kernel/VelocityStorage.ts](client/src/engine/core/kernel/VelocityStorage.ts) | Entity velocity vectors |
| **healths** | HealthStorage | [client/src/engine/core/kernel/HealthStorage.ts](client/src/engine/core/kernel/HealthStorage.ts) | HP + max HP per entity |
| **inventories** | InventoryStorage | [client/src/engine/core/kernel/InventoryStorage.ts](client/src/engine/core/kernel/InventoryStorage.ts) | Ammo, equipment, items |
| **networkEntityId Mapping** | EntityRegistry | [client/src/engine/core/kernel/EntityRegistry.ts](client/src/engine/core/kernel/EntityRegistry.ts) | Sparse-set for handle→networkId |

**Data Layout**:
```typescript
// PositionStorage - stride of 3 (x, y, z)
positions[denseIndex * 3]     = x
positions[denseIndex * 3 + 1] = y
positions[denseIndex * 3 + 2] = z

// VelocityStorage - same stride
velocities[denseIndex * 3]     = vx
velocities[denseIndex * 3 + 1] = vy
velocities[denseIndex * 3 + 2] = vz
```

---

### 5.2 Prediction State in TypedArrays

**Current**: ❌ **NO PREDICTION STATE STORED**

What's stored:
- ✅ Position (current)
- ✅ Velocity (current)
- ✅ Health
- ✅ Inventory (ammo)

What's NOT stored:
- ❌ Predicted position (extrapolated)
- ❌ Input sequence number (for validation)
- ❌ Last received snapshot tick
- ❌ Correction history

**Performance Impact**:
- Remote entity predictions happen **in scripting code** (not DOD)
- Each frame: lookup entity → apply lerp → update mesh
- No SIMD parallelization of remote predictions

---

### 5.3 Transactional Kernel Integration Points

**Kernel Initialization** → [client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts](client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts#L50-L65)

```typescript
const { kernel, transactional } = initTransactionalKernel({
  maxEntities: 2048,
  commandCapacity: 4096,
});
this.kernel = kernel;
this.transactional = transactional;
```

**Command Processing**:
1. Network snapshot → [NetworkSnapshotReconciler](client/src/engine/network/NetworkSnapshotReconciler.ts) reconciles positions
2. Local input → [MovementIntegrateSystem](client/src/engine/core/kernel/MovementIntegrateSystem.ts) consumes `MOVE_CMD` (line 42-77)
   ```typescript
   const consumeCommand: KernelCommandConsumer = (
     seq, tick, timestamp, source, type, playerId, payload
   ) => {
     if (type !== 'MOVE_CMD') return;
     // Update velocity in DOD buffer
     this.velocityStorage.setAuthoritativeXYZ(dense, moveX * speed, moveY * speed, moveZ * speed);
   };
   ```
3. Physics step via `SimulationKernel.update()` → integrates all systems

**Transaction Boundaries**:
- ✅ **Transactional**: Kernel publishes authoritative position after integration
- ✅ **Atomic**: Position + velocity updates happen same tick
- ⚠️ **Issue**: Client prediction state NOT in transaction boundaries

---

## 6. SNAPSHOT AUDIT: VISIBILITY & FILTERING

### 6.1 Visibility System

**File**: [client/src/engine/network/SnapshotVisibilityDebugger.ts](client/src/engine/network/SnapshotVisibilityDebugger.ts)

```typescript
auditSnapshot(snapshot: AuthoritativeSnapshot): {
  mappingMissing: number;      // Missing networkId→handle mappings
  ghostEntities: string[];     // Entities with no kernel handle
  report: { ... }
}
```

**Issues Detected**:
- ⚠️ Warns if `mappingMissing > 0` - entities arrive before entity registry mapping created
- ⚠️ **GHOST ENTITIES**: Network IDs without kernel handles
- 🚨 Fatal error if handle resolves to `null` (line 68-78)

---

### 6.2 Snapshot Filtering

**Server Filter** → [server/src/session/SnapshotFilter.ts](server/src/session/SnapshotFilter.ts)

```typescript
const SNAPSHOT_ALLOWED_ENTITY_TYPES = new Set(['player']);
const SNAPSHOT_RELEVANCE_RADIUS = 72;

// Grunt Filter (line 20-24)
const isGrunt = normalizedType === 'prefab_enemygrunt' 
  || normalizedType.includes('grunt')
  || entity.type === 'Prefab_EnemyGrunt'
  || entity.id?.includes?.('npc_enemy_grunt');
```

**Broadcast Filter** → [server/src/snapshot/SnapshotBroadcast.ts](server/src/snapshot/SnapshotBroadcast.ts#L89-L125)

Hard filters applied:
1. **Grunt Filter** (line 89-111): Removes all enemy grunts
2. **Type Filter**: Only 'player' entities allowed
3. **Relevance Radius** (line 133): Distance check (72 units)
4. **Local Player Override** (line 133-135): ALWAYS include self

---

## 7. ARCHITECTURE TIMELINE & DECISION HISTORY

### 7.1 Known Fixes Applied

| Fix | Ticket | Applied | Impact |
|-----|--------|---------|--------|
| Server tickRate 60 Hz | RUBBERBANDING | [GameSession.ts L186](server/src/core/GameSession.ts#L186) | Matches client frame rate |
| Reconciliation lerp 15% | SMOOTHNESS | [NetworkSnapshotReconciler.ts L1](client/src/engine/network/NetworkSnapshotReconciler.ts#L1) | Reduces jitter, adds lag |
| Grunt entity filtering | SERVER_EXORCISM | [SnapshotBroadcast.ts L89](server/src/snapshot/SnapshotBroadcast.ts#L89) | Prevents ghost enemies |
| Local player always included | SNAPSHOT_INTEGRITY | [SnapshotBroadcast.ts L133](server/src/snapshot/SnapshotBroadcast.ts#L133) | Fixes disappearing player |

### 7.2 Planned But Not Implemented

- ❌ Snapshot timing sync message to clients
- ❌ Client-side extrapolation of remote positions
- ❌ DOD prediction state buffers
- ❌ Input sequence validation in kernel
- ❌ Rewind/replay for hit validation

---

## 8. NETWORK MESSAGE FLOW DIAGRAM

```
┌─────────────┐                              ┌─────────────┐
│   CLIENT    │                              │   SERVER    │
└──────┬──────┘                              └──────┬──────┘
       │                                             │
       │  [1] Input Command (50ms interval)        │
       ├────────────────────────────────────────────→
       │     { playerId, seq, tick, input }         │
       │                                             │
       │                                       [2] Tick Loop (60Hz)
       │                                    ├─ Process input
       │                                    ├─ Apply movement
       │                                    ├─ Physics step
       │                                    ├─ Snapshot creation
       │                                    │
       │  [3] Authoritative Snapshot                │
       │        (60Hz broadcast)                    │
       ←────────────────────────────────────────────┤
       │     { tick, ack, entities[], events[] }    │
       │                                             │
  [4] Kernel Update                                 │
  ├─ Reconcile position (lerp)                      │
  ├─ Integrate velocity                            │
  └─ Render mesh                                   │

Timing Issues:
  Server tick:      16.67 ms (60 Hz)
  Client send:      50 ms    (20 Hz)      ← 3× mismatch!
  Snapshot arrival: ~50-100 ms latency   ← unpredictable
  Client frame:     16.67 ms (60 Hz)
```

---

## 9. RECOMMENDATIONS

### Critical Issues (Blocking Quality)

1. **Unify Tick Rates**
   - [ ] Either reduce server to 30 Hz OR increase client input to 60 Hz
   - [ ] Recommendation: **Increase client to 60 Hz** (already sends at 50ms, just needs tighter sync)
   - **Impact**: Eliminates 3× tick mismatch, improves responsiveness

2. **Snapshot Timing Predictability**
   - [ ] Add server message: `{ snapshotIntervalMs: 16.67, expectedNextTickAt: T+16.67 }`
   - [ ] Client uses this to predict interpolation timing
   - **Impact**: Smooth interpolation without guessing

3. **Position Extrapolation**
   - [ ] Add velocity-based extrapolation for remote players
   - [ ] Store predicted position in DOD buffer (Float32Array)
   - [ ] Blend predicted + lerped positions
   - **Impact**: Reduces visual lag by ~50-100ms

### Medium Priority

4. **DOD Prediction Buffers**
   - [ ] Add `predictedPositions` TypedArray to kernel
   - [ ] Add `inputSeq`, `lastSnapshotTick` per entity
   - [ ] SIMD-friendly layout for batch extrapolation

5. **Input Buffering**
   - [ ] Store recent inputs in DOD buffer for local prediction
   - [ ] Validate against server corrections

### Low Priority (Polish)

6. **Replays & Validation**
   - [ ] Record input history for hit validation
   - [ ] Rewind logic for collision checks

---

## APPENDIX: File References Quick Index

**Client Network Stack**:
- [client/src/engine/network/](client/src/engine/network/) - Main network module
  - [MultiplayerClient.ts](client/src/engine/network/MultiplayerClient.ts) - Public API
  - [NetworkManager.ts](client/src/engine/network/NetworkManager.ts) - State sync
  - [NetworkSnapshotReconciler.ts](client/src/engine/network/NetworkSnapshotReconciler.ts) - Position reconciliation
  - [NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts) - Snapshot processing

**Client Kernel**:
- [client/src/engine/core/kernel/](client/src/engine/core/kernel/)
  - [PositionStorage.ts](client/src/engine/core/kernel/PositionStorage.ts) - DOD position buffer
  - [VelocityStorage.ts](client/src/engine/core/kernel/VelocityStorage.ts) - DOD velocity buffer
  - [MovementIntegrateSystem.ts](client/src/engine/core/kernel/MovementIntegrateSystem.ts) - Physics integration
  - [SnapshotWriter.ts](client/src/engine/core/kernel/SnapshotWriter.ts) - Kernel state capture
  - [SnapshotReader.ts](client/src/engine/core/kernel/SnapshotReader.ts) - Zero-copy buffer reads

**Server Game Logic**:
- [server/src/core/GameSession.ts](server/src/core/GameSession.ts) - Main tick loop, 60 Hz
- [server/src/snapshot/](server/src/snapshot/)
  - [SnapshotBroadcast.ts](server/src/snapshot/SnapshotBroadcast.ts) - Delta encoding
  - [SnapshotContract.ts](server/src/snapshot/SnapshotContract.ts) - Protocol
- [server/src/session/](server/src/session/)
  - [tickRuntime.ts](server/src/session/tickRuntime.ts) - Per-tick updates
  - [playerInputRuntime.ts](server/src/session/playerInputRuntime.ts) - Input processing
  - [SnapshotFilter.ts](server/src/session/SnapshotFilter.ts) - Entity filtering

**Bootstrap**:
- [client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts](client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts) - Kernel initialization

---

**End of Audit**
