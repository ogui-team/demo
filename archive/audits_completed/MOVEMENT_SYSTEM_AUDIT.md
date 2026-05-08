# Movement System Architecture Audit
**Date**: April 16, 2026 | **Status**: Complete System Analysis

---

## Executive Summary

The movement system spans **9+ separate systems** across client/server with **significant complexity and redundancy**. The architecture has:

✅ **Good**: Clear separation of concerns (input → network → server physics → client sync)  
⚠️ **Issues**:
- **Triple input representation** (PlayController state, NetworkSyncSystem state, playerInputRuntime state)
- **Dual jump/coyote-time implementations** (client-side reconciliation + server-side tracking)
- **Complex interaction between 5+ movement modifiers** with unclear precedence
- **Client-side movement prediction may conflict with server authority**
- **Redundant movement intent handling** in multiple systems

---

## File Locations & Purposes

### **Server-Side Movement Core**

| File | Location | Purpose | Issues |
|------|----------|---------|--------|
| **MovementRuntime.ts** | `server/src/movement/` | Main physics engine: velocity, jump buffer, coyote time, gravity | ⚠️ Implements physics + handles ability intents + manages status modifiers (too many concerns) |
| **playerInputRuntime.ts** | `server/src/session/` | Processes keyboard input, manages jump buffer | ⚠️ Duplicates jump buffer logic with MovementRuntime |
| **playerValidationRuntime.ts** | `server/src/session/` | Sanitizes & validates rotation angles, direction vectors | ✅ Clean validation layer |
| **StatusRuntime.ts** | `server/src/gameplay/` | Builds movement modifiers (rooted, chilled, electrocuted) | ⚠️ Manages multiple modifier sources; unclear merge logic |
| **tickRuntime.ts** | `server/src/session/` | Invokes movement step each game tick | ✅ Simple tick coordinator |
| **GameSession.ts** | `server/src/core/` | Orchestrates: input processing → status updates → movement step → collision resolution | ⚠️ God object; knows about all movement subsystems |

### **Client-Side Input & Sync**

| File | Location | Purpose | Issues |
|------|----------|---------|--------|
| **PlayController.ts** | `client/src/engine/foundation/` | Captures keyboard input, emits `playerMovementInputCaptured` event | ✅ Clean input capture, but no verification that input is valid |
| **NetworkSyncSystem.ts** | `client/src/engine/network/` | Listens for PlayController input → maintains local prediction → handles reconciliation | ⚠️ 2500+ lines; predicts both movement AND jumping; reconciliation logic is complex |
| **MovementIntegrateSystem.ts** | `client/src/engine/core/kernel/` | Kernel-level velocity integration (low-level) | ✅ Simple, focused task |
| **KernelMovementIntegration.ts** | `client/src/engine/runtime/bootstrap/` | Bridges gameplay commands to kernel-level movement | ⚠️ Moderately complex bootstrapping |

### **Movement Modifiers & Effects**

| File | Location | Purpose | Issues |
|------|----------|---------|--------|
| **AbilityRules.ts** | `server/src/rules/` | Defines status effects & movement modifier profiles (rooted, chilled, electrocuted) | ⚠️ Hardcoded status effect logic; new effects require code changes |
| **StatusEffects.ts** | `server/src/gameplay/` | Applies movement-affecting statuses from abilities | ⚠️ Logic duplicated in StatusRuntime.ts |
| **MovementModifierContracts.ts** | `client/src/engine/network/` | TypeScript interface for movement modifiers | ✅ Simple contract |
| **MovementTuningConfig.ts** | `client/src/engine/network/` | Debug tuning parameters for movement feel | ✅ Useful for testing |

### **Collision & Physics**

| File | Location | Purpose | Issues |
|------|----------|---------|--------|
| **ActorRuntimeSupport.ts** | `server/src/actor/` | Resolves movement against collision geometry (slide-on-obstacle) | ✅ Clean collision resolution |
| **CollisionAuthoritySystem.ts** | `server/src/collision/` | Tracks dynamic colliders (player positions) | ✅ Focused responsibility |
| **PhysicsSystem.ts** | `client/src/engine/gameplay/systems/` | Client-side physics (THREE.js integration) | ⚠️ Not used for player movement; disconnected from server truth |

---

## Data Flow: Movement & Jumping

### **1. INPUT CAPTURE (Client)**
```
User presses 'W', 'Space', 'A', 'D', 'Ctrl'
         ↓
PlayController.handleKeyDown()
  - Stores keys in this.keys Set
  - Stores keyCodes in this.keyCodes Set
  - Emits gameBus 'playerMovementInputCaptured' event
         ↓
PlayController.update() [called each frame]
  - Calls getMovementInput()
  - Extracts from keys: forward, backward, left, right, jump, sprint, crouch
  - Includes movementIntent: {jump: boolean, crouch: boolean}
  - Includes rotation: {yaw, pitch}
  - EMITS EVENT: 'playerMovementInputCaptured'
         ↓
NetworkSyncSystem listens to 'playerMovementInputCaptured'
  - Stores in this.liveLocalInput
  - Updates movementIntent
  - Records for client-side prediction
```

**FILES INVOLVED**: PlayController.ts → NetworkSyncSystem.ts

---

### **2. NETWORK TRANSMISSION (Client → Server)**
```
NetworkSyncSystem.updateInput() [each frame]
  - Reads this.liveLocalInput
  - Builds input command: {seq, ts, input: {forward, backward, left, right, jump, crouch, sprint, yaw, pitch, movementIntent}}
  - Sends to server via MultiplayerClient.sendMovementCommand()
         ↓
Server receives movement command
  - Stores in player input queue
```

**FILES INVOLVED**: NetworkSyncSystem.ts → MultiplayerClient.ts

---

### **3. SERVER INPUT PROCESSING (Server)**
```
GameSession._gameTick()
  - For each player:
    - Call processPlayerInput(player) [playerInputRuntime.ts]
      - Extracts jump from input
      - If jump pressed & !jumpHeld → set jumpBufferRemaining
      - Store currentInput
         ↓
    - Call applyActivePlayerMovement() [tickRuntime.ts]
      - Calls applyPlayerMovementStep() [MovementRuntime.ts]
        FOR EACH FRAME:
          1. Check if grounded (position.y ≤ groundHeight)
          2. Decay jumpBuffer and coyoteTime
          3. Calculate wishVelocity from input (forward/backward/left/right)
          4. Apply acceleration/deceleration
          5. Handle crouch speed multiplier
          6. Apply ability movement intents (impulse overrides)
          7. Check status modifiers (blockMovement, speedMultiplier, impulseOverride)
          8. Handle jump:
             - If jumpBuffer > 0 AND (grounded OR coyoteTime > 0):
               → Apply jumpImpulse to velocity.y
               → Clear jumpBuffer & coyoteTime
          9. Apply gravity to velocity.y
          10. Call resolveMovement() → CollisionAuthoritySystem
          11. Resolve new position against colliders
          12. Set player.isAirborne based on new position
```

**FILES INVOLVED**: tickRuntime.ts → MovementRuntime.ts → playerInputRuntime.ts

**COMPLEXITY**: 6-8 separate decision points per frame

---

### **4. SERVER BROADCAST (Server → Client)**
```
GameSession.broadcastSnapshot()
  - Snapshot includes: position, velocity, rotation, isCrouching, isAirborne
  - Includes: statusMovementModifier (current state)
  - Broadcast to all clients
```

**FILES INVOLVED**: SnapshotBroadcast.ts

---

### **5. CLIENT RECONCILIATION (Client)**
```
NetworkSyncSystem.applyAuthoritativeSnapshot(snapshot)
  1. Extract authoritative position, velocity, rotation
  2. Apply to local entity
  3. If error > 0.05 units:
     - Initialize positionError = predicted - authoritative
     - Start positionErrorDecayRemaining = 100ms
  4. Blend position decay over 100ms window
     - Each frame: error *= 0.9
     - Visual position = authoritative + error
```

**FILES INVOLVED**: NetworkSyncSystem.ts

---

### **6. CLIENT-SIDE PREDICTION (Client)**
```
NetworkSyncSystem.update() [each frame]
  - If not reconciling:
    - Call stepLocalInput()
      - Run reduced version of applyPlayerMovementStep()
      - Predict next position/velocity locally
      - DO NOT submit to kernel (only for preview)
  - If reconciling:
    - Decay position error toward authoritative position
```

**FILES INVOLVED**: NetworkSyncSystem.ts

**ISSUE**: Client runs full physics simulation duplicate code; could drift from server truth

---

## Systems That Interact With Movement

### **Direct Interactions (7 systems)**

1. **StatusRuntime** → Applies movement modifiers
   - Reads: activeMovementStatuses
   - Writes: statusMovementModifier (blockMovement, speedMultiplier, impulseOverride)
   - Called from: applyPlayerMovementStep()

2. **AbilitySystem** → Generates movement intents & statuses
   - Reads: Player abilities
   - Writes: movementIntent (impulse, crouch, jump)
   - Called from: buildAbilityMovementIntent() [playerValidationRuntime.ts]

3. **CollisionAuthoritySystem** → Constrains movement
   - Reads: desiredMovement vector
   - Writes: resolved position (slides on obstacles)
   - Called from: applyPlayerMovementStep()

4. **PlayController** → Captures input
   - Reads: Keyboard events
   - Writes: playerMovementInputCaptured event
   - Runs on: Client, Foundation layer

5. **NetworkSyncSystem** → Synchronizes state
   - Reads: playerMovementInputCaptured event
   - Writes: Local prediction, sends to server
   - Runs on: Client, Network layer

6. **HealthSystem** → Conditionally affects movement
   - Reads: Player health
   - Writes: May trigger death → disables movement
   - Interaction: Indirect via dead flag in applyPlayerMovementStep()

7. **PhysicsSystem** (Client) → Visual representation
   - Reads: Server-provided position, velocity
   - Writes: THREE.js position/rotation updates
   - Interaction: Receives final reconciled position

### **Indirect Interactions (3 systems)**

8. **InputRouter** → Routes keyboard input
   - Reads: Raw keyboard events
   - Writes: Directs to PlayController.handleKeyDown()
   - Interaction: Entry point for input capture

9. **MovementIntegrateSystem** (Kernel) → Low-level velocity integration
   - Reads: MOVE_CMD kernel commands
   - Writes: Position += velocity * dt
   - Interaction: Receives predictive commands from gameplay layer

10. **SpawnSystem** → Initializes movement state
    - Reads: Spawn point
    - Writes: Initial position, velocity, isAirborne, jumpBuffer
    - Interaction: Resets movement on respawn

---

## Identified Complexity & Redundancy

### **🔴 CRITICAL ISSUES**

#### **1. Triple Input Representation** (Highly Redundant)
- **PlayController**: Maintains `this.keys` Set and `this.keyCodes` Set
- **NetworkSyncSystem**: Stores `this.liveLocalInput` with full input state
- **playerInputRuntime**: Validates and re-stores input in `player.currentInput`

**Why it matters**: 
- Same data stored 3 different ways
- Risk of desynchronization (one system updates, others don't)
- Example: If PlayController state clears before being sent, NetworkSyncSystem might still have old input

**Fix**: Single source of truth for input state (probably NetworkSyncSystem)

---

#### **2. Dual Jump Buffer Implementation**
- **playerInputRuntime.ts** (line 50-51): 
  - On jump key down: `player.jumpBufferRemaining = options.jumpBufferSeconds`
  - Stores `player.jumpHeld` to detect press vs hold

- **MovementRuntime.ts** (line 114-115):
  - Decays `player.jumpBufferRemaining` each frame
  - Also reads `movementIntent.jump` from abilities
  - Also respects coyote time buffer

**Why it's bad**:
- Jump buffer initialized in TWO places
- Jump state tracked in THREE places: jumpHeld, jumpBufferRemaining, + ability movementIntent
- Complex to reason about: "Is jump available now?"
- NETWORK_JITTER_FIX_v0.1.6.md mentions jump buffer reset timing was previously wrong

**Fix**: Consolidate jump logic to MovementRuntime only; playerInputRuntime should only sanitize input

---

#### **3. Movement Modifiers Applied at 4 Different Stages**

**Stage 1** (StatusRuntime.ts line 22):
```typescript
const nextModifier = buildStatusMovementModifier(player);
if (!statusMovementModifiersEqual(player.statusMovementModifier, nextModifier)) {
  player.statusMovementModifier = nextModifier;
}
```
Builds modifier from statuses, stores in player.statusMovementModifier

**Stage 2** (MovementRuntime.ts line 126-139):
```typescript
const statusMovementModifier = player.statusMovementModifier;
if (statusMovementModifier?.blockMovement) {
  nextVelocity.x = 0;
  nextVelocity.z = 0;
} else if (typeof statusMovementModifier?.speedMultiplier === 'number' && statusMovementModifier.speedMultiplier < 1) {
  nextVelocity.x *= statusMovementModifier.speedMultiplier;
  nextVelocity.z *= statusMovementModifier.speedMultiplier;
}
if (statusMovementModifier?.impulseOverride) {
  nextVelocity.x = statusMovementModifier.impulseOverride.x;
  nextVelocity.z = statusMovementModifier.impulseOverride.z;
}
```
Applies modifier to velocity

**Stage 3** (MovementRuntime.ts line 117-123):
```typescript
if (movementIntent?.jump) {
  player.jumpBufferRemaining = Math.max(player.jumpBufferRemaining, config.playerJumpBufferSeconds);
  jumpImpulse = movementIntent.verticalImpulse ?? config.playerJumpImpulse;
  consumedMovementIntent = true;
}
```
Ability intents override jump

**Stage 4** (StatusEffects.ts):
```typescript
await applyAbilityMovementStatuses({...});
refreshPlayerStatusMovementModifier(player, now);
```
Statuses are applied and modifier recalculated

**Problem**: 
- Unclear precedence: ability intent vs status modifier vs input
- If both ability impulse AND status impulse exist, which wins?
- Modifier recalculated every frame vs cached?

**Fix**: Clear hierarchy: Input → Ability Intent → Status Modifier with documented precedence

---

#### **4. Reconciliation Has Both "Decay" + "Replay" Logic**
**PhaseA** (NetworkSyncSystem line 1344-1380):
- Input replay buffer: `for (const input of this.pendingInputs) { stepLocalInput(input) }`
- Replays unacknowledged inputs to recover from correction snap

**PhaseB** (NetworkSyncSystem line 1261-1285):
- Position error decay: `error *= 0.9` per frame
- Blends visual position toward server truth

**Why it's concerning**:
- Two different reconciliation strategies active simultaneously
- Could cause double-correction (error blends AND replayed inputs moves position)
- If replay overshoots, error decay might not catch it
- Documented in SNAP_BACK_ELIMINATION_IMPLEMENTATION.md as recent fix

**Fix**: Clarify when each mode activates; ensure they don't compound

---

#### **5. Client-Side Movement Prediction May Diverge**
**Issue**: 
- Client runs full physics simulation in NetworkSyncSystem.stepLocalInput()
- Server runs different physics simulation in MovementRuntime.applyPlayerMovementStep()
- Code is similar but not identical (copy-paste)
- If physics constants differ (gravity, acceleration, jump impulse), they diverge

**Example divergence**:
- Client: `playerMoveAcceleration = 100` (tuned for responsiveness)
- Server: `playerMoveAcceleration = 100` (should match)
- But if ClientMovement code is out of sync with ServerMovement code → desyncs

**Fix**: Share physics constants; generate client code from server code or vice versa

---

### **🟡 MODERATE ISSUES**

#### **6. Movement Intent Data Structure Unclear**
In MovementRuntime.ts, line 82-89:
```typescript
const movementIntent = options.input.movementIntent && typeof options.input.movementIntent === 'object'
  ? options.input.movementIntent as { jump?: unknown; crouch?: unknown }
  : null;
return {
  forward: !!options.input.forward,
  ...
  jump: typeof movementIntent?.jump === 'boolean' ? movementIntent.jump : !!options.input.jump,
  ...
}
```

**Confusing**:
- `input.jump` (direct boolean)
- `input.movementIntent.jump` (nested, ability-provided)
- Which takes precedence?
- Why both?

**Better**: Single, documented precedence rule

---

#### **7. Coyote Time Scattered Across Multiple Systems**
- **MovementRuntime.ts**: Maintains `coyoteTimeRemaining` and decays it
- **AbilitySystem.ts**: May override coyote time via movement intent
- **PlayerModelSystem.ts** (client): Displays coyote time visually (if tracking it)

**Risk**: 
- If ability grants jump while coyote time active, what happens?
- Unclear if coyote time stacks or replaces

---

#### **8. Status Modifier Equality Check Too Expensive**
In StatusRuntime.ts line 23:
```typescript
if (!statusesChanged && statusMovementModifiersEqual(player.statusMovementModifier ?? null, nextModifier)) {
  return false;
}
```

Every frame, compares:
```typescript
export function statusMovementModifiersEqual(
  left: PlayerStatusMovementModifier | null,
  right: PlayerStatusMovementModifier | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftImpulse = left.impulseOverride;
  const rightImpulse = right.impulseOverride;
  return left.speedMultiplier === right.speedMultiplier
    && left.blockMovement === right.blockMovement
    && ((!leftImpulse && !rightImpulse)
      || (!!leftImpulse && !!rightImpulse
        && leftImpulse.x === rightImpulse.x
        && leftImpulse.y === rightImpulse.y
        && leftImpulse.z === rightImpulse.z));
}
```

**Performance**: 
- Called every frame for every player
- Multiple comparisons and deep equality checks
- Could be optimized with checksums or hash

---

### **🟢 MINOR ISSUES**

#### **9. Hardcoded Movement Status Types**
In AbilityRules.ts line 2:
```typescript
export type MovementStatusId = 'status_rooted' | 'status_chilled' | 'status_electrocuted';
```

**Problem**:
- Adding new status (e.g., `status_slowed`) requires code changes in multiple places
- No plugin system for custom statuses

**Fix**: Status registry pattern

---

#### **10. Redundant Crouch State Tracking**
- **MovementRuntime.ts**: Tracks `player.isCrouching`
- **PlayerModelSystem.ts** (client): Also tracks and visualizes crouch state
- **NetworkSyncSystem.ts** (client): Stores in prediction state

**Risk**: Out-of-sync crouch visuals

---

## Critical Data Flow Issues

### **Jump Execution Flow (Clarified)**

```
Frame N:
  User presses Space
    → PlayController.handleKeyDown() captures 'Space'
    → PlayController.getMovementInput().jump = true
    → gameBus 'playerMovementInputCaptured' emitted
    → NetworkSyncSystem.setLiveLocalInput({jump: true})
    → NetworkSyncSystem sends {jump: true} to server

Server Frame N+Δ:
  processPlayerInput() receives {jump: true}
    → If !jumpHeld: player.jumpBufferRemaining = 0.1 (10 frames @ 60 Hz)
    → player.jumpHeld = true

  applyPlayerMovementStep() on frame N+Δ, N+Δ+1, ... while jumpBuffer > 0:
    → Decay jumpBuffer by step time
    → If player.isAirborne=false && jumpBuffer > 0:
      → velocity.y = jumpImpulse (e.g., 5.0 units/sec)
      → player.coyoteTimeRemaining = 0
      → player.isAirborne = true
      → Clear jumpBuffer
    → Apply gravity: velocity.y -= gravity * step

  Broadcast: snapshot includes isAirborne=true, velocity.y=5.0

Client receives snapshot:
  → Update visual entity position/state
  → NetworkSyncSystem detects isAirborne change
  → May apply reconciliation if error detected
```

**Path**: Input → Input Processing → Jump Buffer Management → Physics Integration → Broadcast

---

## Potential Issues During Gameplay

### **Issue 1: Double-Jump Prevention Unclear**
**Scenario**: Player presses space while in air (jumping)

**Current handling**:
- `jumpHeld` flag prevents re-buffering jump
- But if player releases and presses space again while airborne → new jump buffer

**Is this intended?** (Unclear from code)

---

### **Issue 2: Ability Jump Intent Unclear**
**Scenario**: Ability provides jump intent while player is already airborne

In MovementRuntime.ts line 128:
```typescript
if (movementIntent?.jump) {
  player.jumpBufferRemaining = Math.max(player.jumpBufferRemaining, config.playerJumpBufferSeconds);
  jumpImpulse = movementIntent.verticalImpulse ?? config.playerJumpImpulse;
  consumedMovementIntent = true;
}
```

**Questions**:
- Does ability jump stack with input jump?
- Can ability jump interrupt mid-air movement?
- What if ability sets `verticalImpulse = 0`? (cancels jump?)

---

### **Issue 3: Status Modifier "Precedence" Unclear**
**Scenario**: Player is rooted (speed = 0) AND electrocuted (impulse override active)

In StatusRuntime.ts line 36-52:
```typescript
for (const status of player.activeMovementStatuses ?? []) {
  switch (status.statusId) {
    case 'status_rooted':
      blockMovement = true;
      speedMultiplier = 0;
      break;
    case 'status_chilled':
      speedMultiplier = Math.min(speedMultiplier, 0.5);
      break;
    case 'status_electrocuted':
      blockMovement = true;
      speedMultiplier = 0;
      if (debugOverride.impulseMagnitude > 0) {
        impulseOverride = {x: ..., y: 0, z: ...};
      }
      break;
  }
}
```

If both `rooted` AND `electrocuted`:
- blockMovement = true → velocity zeroed
- impulseOverride set → but will be applied AFTER zeroing

**Bug?** Impulse override might not work correctly with blockMovement flag

---

### **Issue 4: Reconciliation Decay Could Miss Real Drift**
In NetworkSyncSystem.ts lines 1261-1285:

```typescript
const error = vec3Subtract(this.predictedPosition, snapshot.position);
if (vec3Magnitude(error) > CORRECTION_THRESHOLD) {
  this.positionErrorDecayRemaining = 100;
}
this.positionError = error;
```

**Problem**:
- If error caused by network lag (not player input), decay will slowly correct
- But player could move further away → new error added
- Decay might never converge if errors keep arriving

**Scenario**: 
- Server position: (10, 1, 10)
- Client predicted: (10.1, 1, 10.1)
- Error = (0.1, 0, 0.1), start decay
- Server position updates: (10.2, 1, 10.2) (player moved)
- New error: (0.15, 0, 0.15)
- Decay resets? Or accumulates?

---

## Recommended Refactoring Priority

### **Priority 1 (High Impact, High Risk)**
1. **Consolidate jump logic** into MovementRuntime only
   - Remove from playerInputRuntime
   - Remove duplicate tracking
   
2. **Single input source of truth**
   - Consolidate PlayController → NetworkSyncSystem → playerInputRuntime
   - Pick one canonical store

3. **Document movement modifier precedence**
   - Clear rules: Input > Ability Intent > Status Modifier
   - Update MovementRuntime to follow rules exactly
   - Add test cases for each interaction

### **Priority 2 (Medium Impact, Medium Risk)**
4. **Refactor client prediction to avoid code duplication**
   - Extract shared physics logic into utility module
   - Both client and server import same functions
   - Reduces drift risk

5. **Unify reconciliation logic**
   - Clarify: decay vs. replay (when does each activate?)
   - Add logging to trace reconciliation decisions

### **Priority 3 (Low Impact, Low Risk)**
6. **Extract status effects to plugin system**
   - Remove hardcoded `status_rooted`, etc.
   - Register statuses with effects

7. **Optimize modifier equality checks**
   - Add checksums to modifier struct
   - Cache results

---

## Testing & Validation Recommendations

### **Unit Tests Needed**
1. Jump buffer decay over time
2. Coyote time availability
3. Status modifier precedence (all combinations)
4. Collision resolution edge cases
5. Input-to-velocity conversion (acceleration, deceleration, crouch)

### **Integration Tests Needed**
1. Jump while rooted → should NOT jump (or should?)
2. Ability jumps during status effects
3. Network lag + reconciliation: does error decay correctly?
4. Rapid input changes + reconciliation

### **Playtest Checklist**
- [ ] Jump feels responsive (not delayed)
- [ ] Coyote time works (can jump after walking off edge)
- [ ] Jump buffer works (can jump slightly before landing)
- [ ] Crouch speed reduction is smooth
- [ ] Status effects (root, chill) prevent movement correctly
- [ ] No jittering or snapping when moving
- [ ] No double-jumps
- [ ] Reconciliation is imperceptible (position blends smoothly)

---

## Code Metrics

| Metric | Value | Assessment |
|--------|-------|------------|
| Movement-related files | 9+ | Too many (should be ≤6) |
| Jump logic locations | 3+ | Should be 1 |
| Input state representations | 3 | Should be 1 |
| Status modifiers tracked | 4 layers | Should be 2 |
| Complexity (cyclomatic) in applyPlayerMovementStep | ~15 | Should be <10 |
| Code sharing client/server | 0% (duplicated) | Should be 60%+ |

---

## Summary of Identified Problems

| Issue | Severity | Impact | Location |
|-------|----------|--------|----------|
| Triple input representation | 🔴 HIGH | Desync risk, hard to maintain | PlayController, NetworkSyncSystem, playerInputRuntime |
| Dual jump buffer | 🔴 HIGH | Logic confusion, timing bugs | playerInputRuntime, MovementRuntime |
| 4-layer modifier application | 🔴 HIGH | Unclear precedence | AbilitySystem, StatusRuntime, MovementRuntime |
| Client prediction divergence | 🔴 HIGH | Major desyncs | NetworkSyncSystem vs MovementRuntime |
| Status rooted + electrocuted conflict | 🟡 MED | Edge case bugs | StatusRuntime line 36-52 |
| Reconciliation decay clarity | 🟡 MED | Could miss real drift | NetworkSyncSystem line 1261-1285 |
| Coyote time scattered | 🟡 MED | Hard to trace | MovementRuntime, AbilitySystem |
| Modifier equality check expensive | 🟡 MED | Performance | StatusRuntime |
| Hardcoded statuses | 🟢 LOW | Inflexible design | AbilityRules |
| Crouch tracking redundant | 🟢 LOW | Minor desync risk | MovementRuntime, NetworkSyncSystem, PlayerModelSystem |

---

## Quick Wins (Low Risk Fixes)

1. **Add comprehensive logging to movement flow**
   - Log at each stage: input capture → network send → server process → broadcast
   - Helps debug issues in production

2. **Document movement modifier precedence in code comments**
   - Add clear rules above buildStatusMovementModifier()
   - Add unit tests for each case

3. **Extract shared physics constants to config file**
   - Client and server both reference same file
   - Reduces drift risk

4. **Rename duplicate jump variables**
   - `jumpHeld` → `lastInputWasJump` (more descriptive)
   - `jumpBufferRemaining` → `jumpBufferTtl` (more descriptive)

---

## Files Needing Detailed Review

### **High Priority**
- [MovementRuntime.ts](server/src/movement/MovementRuntime.ts) - Core physics engine
- [NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts) - Reconciliation logic
- [playerInputRuntime.ts](server/src/session/playerInputRuntime.ts) - Input processing
- [StatusRuntime.ts](server/src/gameplay/StatusRuntime.ts) - Modifier application

### **Medium Priority**
- [PlayController.ts](client/src/engine/foundation/PlayController.ts) - Input capture
- [GameSession.ts](server/src/core/GameSession.ts) - Orchestration

### **Low Priority**
- [MovementIntegrateSystem.ts](client/src/engine/core/kernel/MovementIntegrateSystem.ts)
- [ActorRuntimeSupport.ts](server/src/actor/ActorRuntimeSupport.ts)

---

## Next Steps

1. **Run test suite** against movement scenarios to identify actual bugs
2. **Profile reconciliation** to see if decay-based approach is CPU-efficient
3. **Playtest** to validate jump feel and movement responsiveness
4. **Refactor in phases**:
   - Phase 1: Consolidate input state (lowest risk)
   - Phase 2: Unify jump logic (medium risk)
   - Phase 3: Document modifier precedence (lowest risk)
   - Phase 4: Extract client physics code (higher risk, bigger payoff)

---

*Document generated by comprehensive codebase analysis*
*Date: April 16, 2026*
