# 🔴 Movement System Root Cause Analysis - CRITICAL ISSUES

**Status**: Critical system desync - Over-complication is the root cause

---

## Issue 1: INPUT THROTTLING BUG (PRIMARY ISSUE)

**Location**: `server/src/session/playerInputRuntime.ts` lines 37-40

```typescript
const minIntervalMs = Math.max(28, Math.round((1000 / options.tickRate) * 0.65));
if (player.lastMoveCommandAt > 0 && options.now - player.lastMoveCommandAt < minIntervalMs) {
  return;  // ← DROPS INPUT SILENTLY!
}
```

**The Problem**:
- Jump inputs are throttled to minimum 28ms interval (55 Hz maximum)
- At 60 FPS client with 60 tick/s server, frames come every ~16.67ms
- Jump press can be DROPPED if it arrives within 28ms of last input
- Client sends jump continuously while held, so throttle prevents rapid jumps

**Impact**:
- Jump feels unreliable/doesn't work sometimes
- Rapid movement commands get dropped
- Input latency appears inconsistent

**Root Cause**: 
Over-engineered input throttling for a problem that doesn't exist. Network already rate-limits via tickrate.

---

## Issue 2: TRIPLE INPUT REPRESENTATION (DESYNC RISK)

**Three separate state machines** for the same data:

| System | Location | State |
|--------|----------|-------|
| **PlayController** | client/src/engine/foundation/ | `this.keys` Set (pressed keys) |
| **NetworkSyncSystem** | client/src/engine/network/ | `this.liveInputs` Map + `pendingInputs` |
| **playerInputRuntime** | server/src/session/ | `player.currentInput` |

**The Problem**: 
- Same jump state stored in 3 places
- Edge detection happens on client in NetworkSyncSystem.applyInput()
- But server also does edge detection in playerInputRuntime.processPlayerInput()
- If timing differs by even 1 frame → desync

**Impact**:
- Jump works sometimes on client, not registered on server
- Or vice versa: server jumps but client doesn't see it
- Causes "ghost" jumps or missing jumps

---

## Issue 3: MOVEMENT CODE DUPLICATION

**Two copies of physics simulation**:

1. **Client**: `NetworkSyncSystem.ts` applyInput() - ~150 lines
2. **Server**: `MovementRuntime.ts` applyPlayerMovementStep() - ~180 lines

**The Problem**:
- 60%+ identical code in both places
- ANY difference in constants/logic → desync
- Hard to maintain, easy to introduce bugs
- Example: Client uses `LOCAL_VELOCITY_STOP_THRESHOLD`, server might use different

**Impact**:
- Large position drift after reconciliation
- Jitter and snap-back
- Unpredictable behavior

---

## Issue 4: MULTI-LAYER JUMP BUFFER (CONFUSION)

**Jump logic is SCATTERED across 3 locations**:

1. **MovementRuntime.ts** (server):
   - Initialize jumpBuffer = 0.12s
   - Decay each frame
   - Apply jump when buffer > 0

2. **playerInputRuntime.ts** (server):
   - Detect jump edge
   - Set jumpBuffer = 0.12s again
   - **But MovementRuntime already manages decay**
   - Unclear which takes precedence

3. **NetworkSyncSystem.ts** (client):
   - Same logic repeated
   - `jumpPressed = jumpRequested && !runtime.jumpRequested`
   - Separate decay loop

**The Problem**:
- Jump buffer initialized twice potentially
- Decay logic could reset it prematurely
- Edge detection split across two modules
- No single source of truth for "should jump now?"

**Impact**:
- Jump unreliable when rapidly tapping
- Jump might not work if jump buffer reset by wrong system
- Hard to debug because logic is spread out

---

## Issue 5: STATUS MODIFIER CONFLICTS

**How does system behave when multiple mods apply?**

Scenario: Player is both "rooted" AND "electrocuted"

```typescript
if (statusMovementModifier.blockMovement) {
  nextVelocity.x = 0;
  nextVelocity.z = 0;
} else if (statusMovementModifier.speedMultiplier < 0.999) {
  nextVelocity.x *= statusMovementModifier.speedMultiplier;
  nextVelocity.z *= statusMovementModifier.speedMultiplier;
}
if (statusMovementModifier.impulseOverride) {
  nextVelocity = statusMovementModifier.impulseOverride;
}
```

**The Problem**:
- `else if` means if blockMovement=true, speedMultiplier is ignored
- But then impulseOverride can override blockMovement
- Precedence is unclear
- No way to combine modifiers (AND logic)

**Impact**:
- Unpredictable behavior with status effects
- "Rooted" might not actually root you if impulseOverride present
- Hard to reason about game balance

---

## Issue 6: RECONCILIATION + DECAY RUNNING SIMULTANEOUSLY

**Error decay happens EVERY frame WHILE reconciliation is happening**:

```typescript
update(dt) {
  this.applyPositionErrorDecay(dt);  // ← Applies error blending
  
  while (fixedAccumulator >= fixedStep) {
    this.applyLiveLocalInput();       // ← This might cause NEW corrections
  }
}
```

**The Problem**:
- Error decay is visual smoothing (real-time, variable dt)
- Fixed-step movement is deterministic (fixed dt)
- They run at different rates
- Decay can be interrupted by new input/correction

**Impact**:
- Smooth decay might jitter if new correction arrives
- Position might snap back again during decay
- Visual feedback feels inconsistent

---

## The Root Problem: Over-Complication

This architecture has **9+ systems** interacting:
1. PlayController (input capture)
2. InputContextManager (pointer lock)
3. NetworkSyncSystem (prediction + reconciliation)
4. NetworkManager (communication)
5. MovementRuntime (physics)
6. playerInputRuntime (input processing)
7. CollisionAuthoritySystem (collision)
8. StatusRuntime (modifiers)
9. AbilitySystem (abilities)
10. ReplicationSystem (snapshot apply)

**Each system only partially understands movement.** No one system is authoritative.

---

## Quick Wins (Low Risk)

1. **Remove input throttle** (28ms minimum)
   - File: `server/src/session/playerInputRuntime.ts` line 37-40
   - Risk: Very low - network already rate-limits

2. **Consolidate jump logic**
   - Move edge detection to ONE place: playerInputRuntime
   - Remove duplicate from client MovementRuntime
   - Single jumpBuffer source of truth

3. **Document modifier precedence**
   - Clarify: blockMovement > speedMultiplier > impulseOverride
   - Add unit tests for all combinations

4. **Extract shared physics constants**
   - Create single `PhysicsConstants.ts` imported by both
   - No more duplicate constants causing drift

---

## Recommended Refactor (Medium Term)

### Step 1: Remove Input Throttle
Delete throttle check, trust network tick rate

### Step 2: Unify Jump Logic  
Single function in playerInputRuntime that is authoritative

### Step 3: Extract Shared Physics
Client and server both import same constants/functions

### Step 4: Single Movement Authority
- Server: authoritative physics simulation
- Client: client-side prediction only
- Remove duplicate client physics code

### Step 5: Simplify Status Modifiers
Clear precedence rules:
```
blockMovement (absolute priority)
  └─> impulseOverride
      └─> speedMultiplier
          └─> normal movement
```

---

## Immediate Action: Fix Jump

**File**: `server/src/session/playerInputRuntime.ts` lines 37-40

**Current (BROKEN)**:
```typescript
const minIntervalMs = Math.max(28, Math.round((1000 / options.tickRate) * 0.65));
if (player.lastMoveCommandAt > 0 && options.now - player.lastMoveCommandAt < minIntervalMs) {
  return;  // BREAKS JUMP INPUT!
}
```

**Fixed (SIMPLE)**:
```typescript
// Remove the throttle entirely - network rate-limits via tickrate
// if (player.lastMoveCommandAt > 0 && options.now - player.lastMoveCommandAt < minIntervalMs) {
//   return;
// }
```

Just remove the throttle. The tickrate already prevents too-frequent updates.

---

## Testing After Fix

1. **Jump rapidly**: Tap space 5 times quickly
   - Expected: All jumps work
   - Current: Some jumps silently dropped

2. **Jump while moving**: Move + jump simultaneously
   - Expected: Smooth arc motion
   - Current: Might stutter/dropped

3. **Jump at edge**: Stand at platform edge and jump
   - Expected: Jump applies, lands safely
   - Current: Might not jump

---

## Recommended Reading Order

1. Read this file (you're here)
2. Look at MOVEMENT_SYSTEM_AUDIT.md (detailed 400-line breakdown)
3. Implement "Immediate Action: Fix Jump" 
4. Test
5. If issues remain, implement "Recommended Refactor"

---

**Bottom Line**: The system isn't broken, it's over-engineered. The input throttle is actively breaking jump. Remove it. Done.
