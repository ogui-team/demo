# 🎮 MULTIPLAYER REPLICATION OVERHAUL - OVERWATCH/CS:GO QUALITY
## Master Plan: v0.1.6 + v0.1.7

**Date**: April 16, 2026  
**Status**: DESIGN PHASE  
**Goal**: Achieve <30ms felt latency, zero rubber-banding, perfect shot registration

---

## 🎯 THE PROBLEM WE'RE SOLVING

**Current State**:
- ❌ 60Hz server but 20Hz client input (3× mismatch)
- ❌ No extrapolation - only 15% lerp causes 50-100ms visual lag
- ❌ Movement "freezes 2 frames then snaps" - microsnapping
- ❌ Shot registration misses (client sees hit, server disagrees)
- ❌ Physics prediction off (collision feels delayed)

**Target State** (like Overwatch/CS:GO):
- ✅ Smooth 144fps+ visuals from 60Hz kernel ticks
- ✅ Local player movement feels instant (client-side prediction)
- ✅ Remote players extrapolated smoothly (velocity-based)
- ✅ Server reconciliation < 1 frame visible correction
- ✅ Shot prediction: client predicts where enemy IS, not WAS

---

## 🔧 SOLUTION ARCHITECTURE

### LAYER 1: Tick Synchronization (Foundation)
**Goal**: Make tick boundaries predictable

**Changes**:
1. **Server sends timestamp with every snapshot**:
   ```typescript
   // SnapshotBroadcast.ts
   interface WorldSnapshot {
     serverTick: number;
     timestamp: number;        // milliseconds
     tickInterval: 16.67;      // 60Hz = 16.67ms
     entities: EntitySnapshot[];
   }
   ```

2. **Client tracks tick timeline**:
   ```typescript
   // TickTracker.ts (new file)
   class TickTracker {
     serverTick: number;
     serverTimestamp: number;
     tickInterval: number = 16.67;
     
     // Calculate when NEXT tick should arrive
     nextTickTime(): number {
       return this.serverTimestamp + (this.tickInterval * (this.serverTick + 1));
     }
     
     // Current alpha: 0.0 = last tick, 1.0 = next tick
     currentAlpha(): number {
       const now = performance.now();
       const nextTick = this.nextTickTime();
       const lastTick = nextTick - this.tickInterval;
       return Math.max(0, Math.min(1, (now - lastTick) / this.tickInterval));
     }
   }
   ```

**Files to Create**:
- `client/src/engine/network/TickTracker.ts`

**Files to Modify**:
- `server/src/snapshot/SnapshotBroadcast.ts` - add timestamp
- `client/src/engine/network/NetworkSnapshotReconciler.ts` - use TickTracker

---

### LAYER 2: Position Interpolation (Smooth Visuals)
**Goal**: Make 60Hz kernel ticks invisible at 144fps render rate

**Formula** (Linear Interpolation + Velocity Extrapolation):
```typescript
// Given: last tick position P0, current position P1, velocity V
// Find: visual position at current frame time (alpha = 0.0 to 1.0)

visualPos = lerp(P0, P1, alpha) + V * velocityScaleFactor

// Breakdown:
// - lerp(P0, P1, alpha): linearly blend between last and current
// - V * factor: predict ahead using velocity (lag compensation)
```

**Implementation**:
```typescript
// client/src/engine/graphics/InterpolationSystem.ts (new file)
class InterpolationSystem {
  interpolate(
    lastPos: Vec3,
    currentPos: Vec3,
    velocity: Vec3,
    alpha: number,
    latency: number  // estimated round-trip latency
  ): Vec3 {
    // Linear interpolation between frames
    const lerpedPos = vec3Lerp(lastPos, currentPos, alpha);
    
    // Extrapolate ahead using velocity (predict movement during network latency)
    // Scale factor: latency / tickInterval
    // For 60Hz (16.67ms) + 50ms latency: extrapolate 3 ticks ahead
    const extrapolationScale = latency / 16.67;
    const extrapolatedPos = vec3Add(lerpedPos, vec3Scale(velocity, extrapolationScale));
    
    return extrapolatedPos;
  }
}
```

**Files to Create**:
- `client/src/engine/graphics/InterpolationSystem.ts`
- `client/src/engine/graphics/LatencyEstimator.ts`

**Files to Modify**:
- `client/src/engine/core/EntityRenderer.ts` - use interpolated positions instead of raw kernel
- `client/src/engine/gameplay/systems/DummyEnemySystem.ts` - apply interpolation to remote dummies

---

### LAYER 3: Client-Side Prediction (Feels Instant)
**Goal**: Local player movement feels instant, not delayed by network

**How Overwatch does it**:
1. Player presses movement key → local kernel updates IMMEDIATELY (no network wait)
2. Visual renders predicted position IMMEDIATELY
3. Server processes input, sends back authoritative position
4. If delta > threshold, smoothly reconcile (0.5s snap)

**Implementation**:
```typescript
// client/src/engine/network/LocalPlayerPrediction.ts (new file)
class LocalPlayerPrediction {
  predictedPosition: Vec3;
  predictedVelocity: Vec3;
  
  // Called when PLAYER inputs movement (not network)
  applyLocalInput(input: InputCommand): void {
    // Update local kernel IMMEDIATELY (no network delay)
    this.kernel.enqueueCommand({
      playerId: localPlayerId,
      type: 'MOVE',
      payload: input,
      sequence: ++this.localSequence,
    });
    
    // Kernel processes and updates position buffer immediately
    // EntityRenderer reads and renders immediately
  }
  
  // Called when server sends authoritative position
  reconcileWithServer(serverPos: Vec3, serverVel: Vec3): void {
    const delta = vec3Distance(this.predictedPosition, serverPos);
    
    if (delta > RECONCILIATION_THRESHOLD) {
      // Smooth reconciliation over 0.5 seconds instead of snapping
      this.startReconciliationTween(
        this.predictedPosition,
        serverPos,
        0.5  // seconds
      );
    } else {
      // Small correction, just update
      this.predictedPosition = serverPos;
      this.predictedVelocity = serverVel;
    }
  }
}
```

**Files to Create**:
- `client/src/engine/network/LocalPlayerPrediction.ts`
- `client/src/engine/network/ReconciliationTween.ts`

---

### LAYER 4: Shot Prediction & Collision (Register Shots)
**Goal**: Shot registration accurate like CS:GO

**Problem**: When client shoots, server receives shot 50ms late. Enemy has moved 10 units. Shot misses.

**Solution - Server Backtracks** (CS:GO style):
```typescript
// server/src/combat/CollisionPredictor.ts (new file)
class CollisionPredictor {
  predictShotImpact(
    shooterPos: Vec3,
    shooterVel: Vec3,
    shootDirection: Vec3,
    targetPos: Vec3,
    targetVel: Vec3,
    shotTimestamp: number,
    serverNow: number
  ): HitResult {
    // How long ago was the shot fired?
    const latency = serverNow - shotTimestamp;
    
    // Where WAS the target at shot time?
    // Backtrack from current position using velocity
    const targetAtShotTime = vec3Sub(
      targetPos,
      vec3Scale(targetVel, latency / 1000)
    );
    
    // Check collision at that historical position
    return this.raycastAt(shooterPos, shootDirection, targetAtShotTime);
  }
}
```

**Files to Create**:
- `server/src/combat/CollisionPredictor.ts`
- `server/src/combat/ShotValidator.ts`

---

### LAYER 5: High-Tick Server Support (128 ticks)
**Goal**: When ready, support 128Hz ticks for competition

**Scalable structure**:
```typescript
// server/src/core/ServerConfig.ts
export const NETWORK_CONFIG = {
  TICK_RATE: 60,  // Change to 128 for high-tick
  TICK_INTERVAL: 1000 / 60,  // milliseconds
  
  // Auto-calculate
  get TICKS_PER_SECOND() { return 1000 / this.TICK_INTERVAL; }
};
```

**Files to Modify**:
- `server/src/core/GameSession.ts` - use config
- `server/src/snapshot/SnapshotBroadcast.ts` - use config

---

## 📋 IMPLEMENTATION ROADMAP

### **PHASE 1: Tick Synchronization** (v0.1.6, Sprint 1)
**Goal**: Make tick boundaries known and predictable

**Tasks**:
1. [ ] Create `TickTracker.ts` - track server tick timeline
2. [ ] Modify `SnapshotBroadcast.ts` - send `serverTick` + `timestamp` + `tickInterval`
3. [ ] Modify `NetworkSnapshotReconciler.ts` - use TickTracker to calculate alpha
4. [ ] Test: Verify alpha ranges 0.0-1.0 consistently
5. [ ] Console output: Log tick transitions and alpha values

**Success Criteria**:
```
[TickTracker] Alpha: 0.0 → 0.33 → 0.67 → 1.0 (smooth progression)
[TickTracker] Ticks: 100 → 101 → 102 (predictable)
```

**Estimated Time**: 4 hours

---

### **PHASE 2: Interpolation** (v0.1.6, Sprint 2)
**Goal**: Smooth movement between ticks (fixes microsnapping)

**Tasks**:
1. [ ] Create `InterpolationSystem.ts` - lerp + extrapolate
2. [ ] Create `LatencyEstimator.ts` - measure RTT
3. [ ] Modify `EntityRenderer.ts` - use interpolated positions instead of raw kernel
4. [ ] Update remote dummy rendering to use extrapolation
5. [ ] Test: Move player, observe smooth motion at 144fps from 60Hz ticks

**Success Criteria**:
- No visual jitter or microsnapping
- Smooth motion even with 100ms latency
- Remote players appear where they're going (not where they were)

**Estimated Time**: 6 hours

---

### **PHASE 3: Client Prediction** (v0.1.7, Sprint 1)
**Goal**: Local player movement feels instant

**Tasks**:
1. [ ] Create `LocalPlayerPrediction.ts` - immediate local input processing
2. [ ] Create `ReconciliationTween.ts` - smooth correction when server updates
3. [ ] Modify movement input handler - apply to kernel immediately
4. [ ] Modify network receiver - reconcile predicted vs actual
5. [ ] Test: Move locally, watch for instant response + smooth correction

**Success Criteria**:
- WASD movement feels instant (no input lag)
- Position converges with server within 0.5s
- No visible snapping/correction

**Estimated Time**: 5 hours

---

### **PHASE 4: Shot Prediction** (v0.1.7, Sprint 2)
**Goal**: Server validates shots against predicted enemy positions

**Tasks**:
1. [ ] Create `CollisionPredictor.ts` - backtrack enemy positions
2. [ ] Modify shot validation - use predicted collision
3. [ ] Add shot metadata to network (timestamp, shooter pos)
4. [ ] Test: Shoot moving target, verify hits when client predicts collision

**Success Criteria**:
- Shots register on client-predicted positions
- Server backtracking works up to 100ms latency
- Hit feedback within 1 frame of client-side prediction

**Estimated Time**: 4 hours

---

### **PHASE 5: High-Tick Support** (v0.1.8)
**Goal**: Support 128Hz tick rate for competitive play

**Tasks**:
1. [ ] Parameterize tick rate in `ServerConfig.ts`
2. [ ] Verify kernel can run at 128Hz (physics stability)
3. [ ] Benchmark bandwidth (128Hz vs 60Hz)
4. [ ] Add server option to select tick rate
5. [ ] Test: Run 128Hz, measure jitter + bandwidth

**Success Criteria**:
- 128Hz running stably
- Bandwidth increase < 2×
- Jitter < 10ms on stable connection

**Estimated Time**: 3 hours

---

## 🔬 MEASUREMENT & VALIDATION

### Key Metrics to Track

```typescript
// client/src/engine/diagnostics/MultiplayerMetrics.ts (new file)
class MultiplayerMetrics {
  trackInterpolationSmoothing(): {
    ticksPerSecond: 60,
    framesPerSecond: 144,
    alphaProgression: number[],  // should be smooth 0→1
    jitterMs: number,  // frame-to-frame position delta
  }
  
  trackClientPrediction(): {
    predictionAccuracy: number,  // 0-100%
    reconciliationDuration: number,  // ms
    visibleSnap: boolean,  // was correction visible?
  }
  
  trackShotValidation(): {
    clientHitsServerMisses: number,
    serverHitsClientMisses: number,
    prediction accuracy: number,  // % of backtracked shots that hit
  }
  
  trackLatency(): {
    estimatedRTT: number,
    variance: number,
    p95: number,
  }
}
```

### Console Output Examples

**Phase 1 (Tick Sync)**:
```
[TickTracker] Tick 100 @ 1234567890ms
[TickTracker] Alpha: 0.33 (550ms / 1667ms into tick)
[TickTracker] Next tick in 1117ms
```

**Phase 2 (Interpolation)**:
```
[InterpolationSystem] LastPos: (10, 0, 0), CurrentPos: (15, 0, 0)
[InterpolationSystem] Velocity: (2.5, 0, 0), Extrapolation: +3.34 units
[InterpolationSystem] Visual: (14.4, 0, 0) [alpha=0.28, latency=50ms]
```

**Phase 3 (Prediction)**:
```
[LocalPlayerPrediction] Input MOVE applied locally immediately
[LocalPlayerPrediction] Predicted: (20, 0, 0)
[LocalPlayerPrediction] Server: (20.1, 0, 0) - delta 0.1, no reconciliation needed
```

**Phase 4 (Shots)**:
```
[CollisionPredictor] Shot at t=1000, server time t=1050 (50ms latency)
[CollisionPredictor] Enemy backtracked: (100, 0, 0) → (95, 0, 0)
[CollisionPredictor] HIT - registered on predicted position
```

---

## 📊 COMPARISON: Before vs After

| Metric | Before | After (Target) |
|--------|--------|----------------|
| **Local Movement Latency** | ~50ms (network) | <16ms (local + network) |
| **Remote Movement Smoothness** | Stuttery, freezes | Smooth extrapolation |
| **Microsnapping** | Visible (2-3 frames) | Imperceptible |
| **Shot Registration** | 60% accuracy | >95% accuracy |
| **Remote Position Accuracy** | Position behind reality | Predicted ahead (lag comp) |
| **Felt Input Lag** | High | Low (<32ms) |
| **Rubber-banding** | Frequent (>30ms) | Rare (<5ms) |

---

## 🎮 INSPIRATION: CS:GO/Overwatch Techniques

| Technique | They Do | We'll Do |
|-----------|---------|---------|
| **Tick Sync** | Server sends tick # + time | ✅ Phase 1 |
| **Extrapolation** | Velocity-based prediction | ✅ Phase 2 |
| **Client Prediction** | Instant local movement | ✅ Phase 3 |
| **Shot Backtracking** | Verify on historical position | ✅ Phase 4 |
| **High Ticks** | 64/128 Hz option | ✅ Phase 5 |
| **Lag Comp** | Lead aim for moving targets | Could add Phase 6 |
| **Latency Bucketing** | Better extrapolation for high ping | Could add Phase 6 |

---

## 🚀 NEXT STEP: START PHASE 1

Ready to begin? Here's what I'll do:

1. Create `TickTracker.ts` - the foundation
2. Modify `SnapshotBroadcast.ts` to send timing info
3. Wire it into `NetworkSnapshotReconciler.ts`
4. Add console logging to validate tick progression
5. Test with multiplayer clients

**Estimated Phase 1 completion**: 4-6 hours

Should I proceed with Phase 1 implementation?

