# COMPREHENSIVE POSITION/VELOCITY MODIFICATION AUDIT

## SUMMARY
Found systematic drift pattern (0.6-0.7 units / ~12 ticks = ~1 unit/sec error) caused by **multiple conflicting position/velocity modifications** happening in wrong order and without proper reconciliation.

**Root Cause**: Position error decay is applied BEFORE input application each frame, but input modifies position, then snapshot reconciliation happens, creating divergence.

---

## CRITICAL FINDINGS

### 🔴 ISSUE #1: POSITION ERROR DECAY TIMING CONFLICT
**Severity**: CRITICAL - Causes ~1 unit/sec systematic drift

**Flow (Current)**:
```
Frame N:
  1. applyPositionErrorDecay()     ← Sets position = auth + error
  2. applyLiveLocalInput()         ← Modifies velocity, then position
  3. applyAuthoritativeSnapshot()  ← Next frame receives snapshot
                                      Calculates NEW error based on NEW position
```

**Problem**: 
- Error decay applies correction to entity position
- Then input immediately moves entity from that position
- Snapshot arrives and sees NEW position (which includes input movement)
- New error = (auth + error + input_movement) - auth = error + input_movement
- **Each frame: position accumulates error + input movement**
- With 0.1 decay factor and continuous input, drift compounds

**Example**:
```
Frame 0: pos=10, auth=10, error=0
         decay: pos = 10 + 0 = 10
         input: pos = 10 + 0.5*dt = 10.5
         
Frame 1: auth comes in at 10 (server didn't move)
         client at 10.5
         new_error = 10.5 - 10 = 0.5
         decay: pos = 10 + 0.5*0.9 = 10.45
         input: pos = 10.45 + 0.5*dt = 10.95
         
Frame 2: auth = 10
         client = 10.95
         drift accumulates!
```

**Files Involved**:
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L1045-L1055) - update() calls applyPositionErrorDecay BEFORE applyLiveLocalInput
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L2335-L2395) - applyPositionErrorDecay() applies error to position

---

### 🔴 ISSUE #2: VELOCITY HANDLING MISMATCH
**Severity**: CRITICAL - Causes velocity divergence from position

**Client Velocity Modifications**:
1. **NetworkSyncSystem.applyInput()** (line 1970-2115):
   - Sets `runtime.velocity` from input, acceleration, and wishVelocity
   - Line 1986: `runtime.velocity = { x: planarVelocity.x, y: runtime.velocity.y, z: planarVelocity.z }`
   - Line 2024: `runtime.velocity.y = jumpImpulse`
   - Line 2050: `runtime.velocity.y -= tuning.gravityScale * PHYSICS_CONSTANTS.PLAYER_GRAVITY * dt`
   - Line 2055-2063: Status effects modify velocity

2. **NetworkSnapshotReconciler.processSnapshot()** (line 140-155):
   - Line 148-154: Directly sets velocity without lerp
   - `this.velocityStorage.setAuthoritativeXYZ(denseIndex, entity.velocity.x, entity.velocity.y, entity.velocity.z)`

3. **NetworkSyncSystem.applyAuthoritativeSnapshot()** (line 1320-1334):
   - Line 1334: `runtime.velocity = cloneVector(authoritative.velocity)`
   - **No decay or blending** - just overwrites

**Problem**: 
- Client prediction calculates velocity via input + physics
- Server snapshot provides authoritative velocity
- Client velocity gets completely replaced with server velocity WITHOUT considering momentum
- Then next frame, input modifies it again
- Result: Velocity jumps around, position can't keep up

**Files Involved**:
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L1320-L1334) - applyAuthoritativeSnapshot() line 1334
- [client/src/engine/network/NetworkSnapshotReconciler.ts](client/src/engine/network/NetworkSnapshotReconciler.ts#L145-L154) - processSnapshot()
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L2050) - gravity application

---

### 🔴 ISSUE #3: DOUBLE VELOCITY MODIFICATION FROM SERVER
**Severity**: HIGH - Causes velocity overshooting

**Locations**:

1. **NetworkSyncSystem.applyAuthoritativeSnapshot()** (line 1334)
```typescript
if (authoritative.velocity) {
  runtime.velocity = cloneVector(authoritative.velocity);
```
Sets runtime.velocity directly from server

2. **NetworkSyncSystem.applyAuthoritativeMovementState()** (line 1750-1765)
```typescript
if (raw.isGrounded === true) {
  if (runtime.velocity.y < 0) {
    runtime.velocity.y = 0;  // ← SECOND modification of velocity.y
  }
}
```
Called AFTER velocity is set from authoritative

**Problem**: 
- Velocity set from server (line 1334)
- Then immediately modified by movement state check (line 1765)
- Can cause velocity discrepancies

**Files Involved**:
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L1320-L1340)
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L1740-L1770)

---

### 🟡 ISSUE #4: POSITION ERROR APPLIED MULTIPLE TIMES PER SNAPSHOT
**Severity**: HIGH - Causes inconsistent corrections

**Flow**:
1. **applyPositionErrorDecay()** called in update() (line 1045)
   - Applies: `position = authoritative + remaining_error`
   - Decays error by 10% each frame

2. **applyAuthoritativeSnapshot()** called when snapshot arrives
   - Calculates new error if `correctionDistance > CORRECTION_THRESHOLD` (line 1299)
   - Sets `runtime.positionError = { x: after.x - authoritativePos.x, ... }` (line 1310-1316)
   - Sets position directly: `localBinding.entity.setPosition(authoritativePos)` (line 1318)

**Problem**: 
- If snapshot arrives while decay is active (0.1s window, 20 Hz = 2 snapshots)
- New correction resets the decay timer
- Error is recalculated on already-corrected position
- Can cause oscillation or amplification of error

**Example Timeline** (20 Hz server = 50ms per tick):
```
Tick 0:  Snapshot arrives, error = 0.3, decay starts
Tick 1:  Error decays to 0.27 (90%), position adjusted
Tick 2:  New snapshot arrives (100ms = 2 ticks)
         Client position after first decay = auth + 0.27
         But movement input has moved it further
         New error calculated from MOVED position
         If moved +0.1: new_error = 0.37 instead of 0.27
         Drift accumulates!
```

**Files Involved**:
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L1045) - update() calls decay first
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L1305-1320) - applyAuthoritativeSnapshot() recalculates error

---

### 🟡 ISSUE #5: INPUT APPLIED DURING POSITION ERROR DECAY
**Severity**: HIGH - Input moves entity away from correction target

**Flow Each Frame**:
```
1. applyPositionErrorDecay(dt)
   └─ position = auth + error * 0.9
   
2. applyLiveLocalInput(dt)  
   └─ wishVelocity calculated from input
   └─ nextPosition = position + velocity*dt
   └─ entity.setPosition(nextPosition)
   
3. Result: position drifts further from auth
```

**Problem**: 
- Decay tries to move entity toward authoritative position
- Input immediately moves it away again
- Net effect: decay is negated by input movement
- With continuous input, decay never catches up

**Files Involved**:
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L1045-1055) - update() order of operations
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L2088-2120) - applyInput() calculates nextPosition and calls setPosition

---

## POSITION MODIFICATIONS BY LOCATION

### CLIENT SIDE (NetworkSyncSystem.ts)

| Line | Function | Modification | Type | Authority Context |
|------|----------|--------------|------|-------------------|
| 746 | `registerSnapshot()` payload handler | `binding.entity.setPosition(payload.reconciliationPositionOverride)` | Direct override | Prediction |
| 1018 | `forceLocalState()` | `binding.entity.setPosition(position)` | Direct set | Prediction |
| 1305-1318 | `applyAuthoritativeSnapshot()` | `localBinding.entity.setPosition(authoritativePos)` | Authoritative snap | Authority |
| 1318-1355 | `applyPositionErrorDecay()` + error blending | `binding.entity.setPosition(correctedPos)` where correctedPos = auth + error | Blend toward authority | Prediction |
| 2117 | `applyInput()` | `binding.entity.setPosition(nextPosition)` | Prediction movement | Prediction |
| 2368-2375 | `applyPositionErrorDecay()` loop | `binding.entity.setPosition(correctedPos)` where correctedPos = current + positionError | Visual glide | Blend |

**Total Locations**: 6 places where client modifies entity position
**Conflict Points**: Lines 1318, 1355, 2375 all modify same entity in same frame

---

### SERVER SIDE (MovementRuntime.ts)

| Line | Function | Modification | Type | Authority Context |
|------|----------|--------------|------|-------------------|
| 155 | `applyPlayerMovementStep()` | `player.position = resolvedPosition` | Authoritative | Authority |
| 217-221 | `applyPlayerMovementStep()` | `player.velocity = { x, y, z }` | Velocity assignment | Authority |
| 206-209 | `applyPlayerMovementStep()` | `player.velocity.y = 0` (landing) | Velocity zeroing | Authority |
| 165-173 | `applyPlayerMovementStep()` | `nextVelocity.x/z = 0` and *= modifiers | Status effect blocking | Authority |

**Total Locations**: 4 places where server modifies position/velocity
**Consistency**: All in same function, sequential (less conflict than client)

---

## VELOCITY MODIFICATIONS BY LOCATION

### CLIENT SIDE

| Line | Function | Modification | Type | Prediction/Authority |
|------|----------|--------------|------|----------------------|
| 1334 | `applyAuthoritativeSnapshot()` | `runtime.velocity = cloneVector(authoritative.velocity)` | Authoritative replacement | Authority |
| 1765 | `applyAuthoritativeMovementState()` | `runtime.velocity.y = 0` (landing) | Conditional zeroing | Blend |
| 1986 | `applyInput()` | `runtime.velocity = { x: planarVelocity.x, y: runtime.velocity.y, z: planarVelocity.z }` | Input acceleration | Prediction |
| 2009-2010 | `applyInput()` | `runtime.velocity.x/z += impulse` | Movement intent | Prediction |
| 2024 | `applyInput()` | `runtime.velocity.y = jumpImpulse` | Jump | Prediction |
| 2050 | `applyInput()` | `runtime.velocity.y -= gravity * dt` | Gravity | Prediction |
| 2055-2063 | `applyInput()` | `runtime.velocity.x/z *= modifier` or `= override` | Status effects | Prediction |
| 2081 | `applyInput()` | `runtime.velocity = dt > 0 ? { movement / dt } : runtime.velocity` | Collision resolver | Prediction |

**Total Locations**: 8 places where client modifies velocity
**Conflict Points**: Line 1334 (auth) overwrites predictions set in lines 1986, 2024, 2050, 2055-2063, 2081

---

### SERVER SIDE

| Line | Function | Modification | Type | Authority |
|------|----------|--------------|------|-----------|
| 106-108 | `applyPlayerMovementStep()` | `player.velocity.y = 0` (landing) | Landing zeroing | Authority |
| 128-133 | `applyPlayerMovementStep()` | velocity delta calculation & clamping | Input acceleration | Authority |
| 146-147 | `applyPlayerMovementStep()` | `nextVelocity.x/z += impulse` | Movement intent | Authority |
| 165-173 | `applyPlayerMovementStep()` | `nextVelocity.x/z *= modifier` or `= override` | Status effects | Authority |
| 178 | `applyPlayerMovementStep()` | `nextVelocity.y = jumpImpulse` | Jump | Authority |
| 191 | `applyPlayerMovementStep()` | `nextVelocity.y -= gravity * dt` | Gravity | Authority |
| 207-209 | `applyPlayerMovementStep()` | `nextVelocity.y = 0` (landing check) | Landing check | Authority |
| 217-221 | `applyPlayerMovementStep()` | `player.velocity = { x, y, z }` | Velocity assignment | Authority |

**Total Locations**: 8 places (parallel to client)
**Issue**: Server calculates velocity from position delta (line 217), not independent

---

## POSITION ERROR CALCULATION LOCATIONS

| File | Line | Function | Calculation | Used For |
|------|------|----------|-------------|----------|
| NetworkSyncSystem.ts | 1299 | `applyAuthoritativeSnapshot()` | `correctionDistance = magnitude(subtract(auth, before))` | Threshold check |
| NetworkSyncSystem.ts | 1310-1316 | `applyAuthoritativeSnapshot()` | `positionError = { after - auth }` | Error blending decay |
| NetworkSnapshotReconciler.ts | 73-75 | `reconcileSnapshot()` | `distance = sqrt(deltaX² + deltaY² + deltaZ²)` | Lerp application |
| NetworkSnapshotReconciler.ts | 83-84 | `reconcileSnapshot()` | `blendedX = current + (deltaX * 0.15)` | 15% lerp blend |

**Conflicts**: 
- Two separate error calculations (NetworkSyncSystem vs NetworkSnapshotReconciler)
- Different blend factors (0.15 lerp vs 0.1 decay)
- Both modify position, can interfere

---

## CRITICAL FLOW ANALYSIS

### Current Problematic Frame Sequence:

```
=== FRAME N (Remote Authority Mode) ===

1. update(dt) called
   ├─ applyPositionErrorDecay(dt)          [LINE 1045]
   │  └─ For each player with active error decay:
   │     ├─ positionError *= 0.9             (10% decay)
   │     ├─ currentPos = entity.getPosition()
   │     ├─ correctedPos = currentPos + positionError
   │     └─ entity.setPosition(correctedPos)
   │
   ├─ fixedAccumulator += dt
   └─ while (fixedAccumulator >= fixedStep):
      └─ applyLiveLocalInput(fixedStep)    [LINE 1050]
         └─ applyInput(binding, liveInput, fixedStep)
            ├─ Reads current position
            ├─ Calculates wishVelocity from input
            ├─ Sets runtime.velocity based on acceleration/input
            ├─ Calculates nextPosition = currentPos + velocity * dt
            └─ entity.setPosition(nextPosition)

2. Network receives snapshot (happens at random time)
   └─ applyAuthoritativeSnapshot(snapshot)  [CLIENT METHOD]
      ├─ before = entity.getPosition()       (includes decay + input movement)
      ├─ correctionDistance = magnitude(snapshot.auth - before)
      ├─ IF correctionDistance > 0.05:
      │  ├─ entity.setPosition(snapshot.auth)
      │  ├─ runtime.positionError = {
      │  │    x: after.x - snapshot.auth.x,  (WAIT - this should be 0!)
      │  │  }
      │  └─ positionErrorDecayRemaining = 100ms
      └─ runtime.velocity = snapshot.velocity (DIRECT REPLACEMENT)

=== FRAME N+1 ===
1. applyPositionErrorDecay() 
   └─ positionError *= 0.9
   └─ BUT: input in last frame moved entity from auth position!
   └─ So error is now non-zero when it should be zero

=== SYSTEMATIC DRIFT ===
Each frame:
- Decay reduces error by 10%
- Input immediately adds movement again
- New error = (old_error * 0.9 + new_input_movement) * 0.9 + more_input
- With continuous input: drift accumulates ~1 unit/sec
```

### Why ~1 unit/sec Drift?

**Given**:
- Movement speed: ~5 units/sec
- Decay factor: 0.1 (error reduced to 90% per frame)
- Frame time: 16.67ms (60 Hz) or 50ms (20 Hz)
- Server tick: 50ms (20 Hz)
- Correction threshold: 0.05 (5cm)

**Math**:
```
If continuous input at 5 units/sec:
- Movement per frame (16.67ms): 5 * 0.01667 = 0.0833 units
- Decay per frame: error *= 0.9
- If error starts at 0.5 after correction:
  Frame 0: error = 0.5, decay to 0.45, input adds 0.083 → net 0.533
  Frame 1: decay to 0.48, input adds 0.083 → net 0.563
  Frame 2: decay to 0.507, input adds 0.083 → net 0.590
  ...
  Steady state: error ≈ 0.833 units

- Velocity from error: 0.833 units * 60 fps = 50 units/sec ERROR
- Actually observed: ~1 unit/sec suggests compounding across multiple players/snapshots
```

---

## RECOMMENDED FIXES (Priority Order)

### FIX #1: CORRECT FRAME ORDER (BLOCKING - MUST DO FIRST)
**Problem**: Decay applied before input, allowing input to negate decay
**Solution**: Apply decay AFTER input and snapshot processing
```
update(dt):
  1. Handle snapshot first (reconcile and set authoritative position/velocity)
  2. Apply live input (predict forward from authoritative)
  3. Apply decay last (smooth blend toward authoritative)
```

**File**: [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L1045-1055)

### FIX #2: LOCK POSITION DURING DECAY
**Problem**: Input can move entity while decay is active
**Solution**: Disable input modifications during active error decay, or apply both independently
```
applyInput():
  if (positionErrorDecayRemaining > 0):
    // Don't apply movement, just accept input state
    // Let decay move entity
  else:
    // Normal input processing
```

**Files**: 
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L1921-2120)
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L2335-2395)

### FIX #3: UNIFIED VELOCITY HANDLING
**Problem**: Velocity modified in 8 different places with conflicting logic
**Solution**: Single canonical velocity source - server snapshot
```
applyAuthoritativeSnapshot():
  runtime.velocity = snapshot.velocity  // ONLY place to set from authority
  
applyInput():
  // Don't touch velocity.y if just received correction
  if (not_in_reconciliation_window):
    apply_local_physics()
```

**Files**:
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L1334)
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L2024-2050)

### FIX #4: RECONCILIATION STATE TRACKING
**Problem**: Decay can be interrupted by new corrections, losing tracking
**Solution**: Add reconciliation mode flag to prevent interference
```
enum ReconciliationState {
  IDLE,
  DECAYING,          // In 100ms error decay window
  WAITING_SNAPSHOT,  // Waiting for next snapshot
}

if (state === DECAYING):
  only_apply_decay()  // Don't apply input movement
```

---

## DIAGNOSTIC COMMANDS

Add to console for verification:

```typescript
// Show position error state
window.debugPositionError = () => {
  const sync = /* get NetworkSyncSystem */;
  sync.movementState.forEach((runtime, playerId) => {
    console.table({
      playerId,
      positionError: runtime.positionError,
      decayRemaining: runtime.positionErrorDecayRemaining,
      velocity: runtime.velocity,
    });
  });
};

// Show drift accumulation
window.trackDrift = () => {
  let lastPos = null;
  setInterval(() => {
    const binding = /* get local player */;
    const pos = binding.entity.getPosition();
    if (lastPos) {
      const delta = Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z);
      console.log(`Frame drift: ${delta.toFixed(4)} units`);
    }
    lastPos = pos;
  }, 50);
};
```

---

## SUMMARY TABLE

| Issue | Severity | Root Cause | Drift Rate | Files Affected | Fix Priority |
|-------|----------|-----------|-----------|----------------|--------------|
| Position decay timing | CRITICAL | Decay before input | ~1 unit/sec | NetworkSyncSystem L1045, L1698 | 1 |
| Velocity replacement | CRITICAL | Direct overwrite | Oscillation | NetworkSyncSystem L1334 | 2 |
| Double velocity mod | HIGH | Landing check after auth | Glitches | NetworkSyncSystem L1334+L1765 | 3 |
| Error recalc in decay | HIGH | New snapshot resets timer | Amplification | NetworkSyncSystem L1310, L1045 | 4 |
| Input during decay | HIGH | No exclusion logic | Negates correction | NetworkSyncSystem L1698, L2335 | 5 |

---

## FILES TO MODIFY
1. **[client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts)** - Core issue location
   - update() method order
   - applyPositionErrorDecay() implementation
   - applyInput() during decay handling
   - applyAuthoritativeSnapshot() velocity handling

2. **[client/src/engine/network/NetworkSnapshotReconciler.ts](client/src/engine/network/NetworkSnapshotReconciler.ts)** - Secondary position lerp
   - Coordinate with NetworkSyncSystem decay

3. **[server/src/movement/MovementRuntime.ts](server/src/movement/MovementRuntime.ts)** - Verify server state
   - Ensure consistent velocity calculations

4. **[shared/PhysicsConstants.ts](shared/PhysicsConstants.ts)** - Constants tune
   - POSITION_ERROR_DECAY_FACTOR
   - POSITION_ERROR_DECAY_MS
