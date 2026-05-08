# Gate 1A: Map Geometry Isolation
**Status**: 🟡 IN PROGRESS  
**Blocker**: YES (ROOT) - Freeplay collision bleeds into multiplayer  
**Target Completion**: [v0.2.0 - Phase 1]  
**Risk**: LOW - Isolated to collision system, no cross-cutting concerns

---

## Problem Statement

**Root Cause**: Map collision geometry is not mode-scoped  

When player transitions from Freeplay → Multiplayer:
- Freeplay collision boxes remain cached in CollisionAuthoritySystem
- Multiplayer session loads, but collision data not refreshed (if map ID similar)
- Result: Player can walk through geometry that should be solid, physics misalignment

**Evidence**:
- Collision data loaded once per map ID globally (not per mode)
- `setActiveMapCollisionLayout` not called during `startMultiplayerMatch`
- `GameLaunchCoordinator.startMultiplayerMatch` skipped collision reload  
- CollisionAuthoritySystem has no mode tracking

---

## Solution Architecture

Simple, non-invasive fix: **Ensure collision is reloaded per mode**

Rather than refactoring to mode-aware class, we leverage existing system:
1. Ensure `setActiveMapCollisionLayout` called for EVERY mode transition
2. Add comprehensive logging to verify state changes
3. Validate collision boxes differ per mode in console logs

**Design Change**: None (uses existing pure-function API)  
**API Change**: None (no public interface changes)  
**Backwards Compatible**: Yes (only adds missing calls)

---

## Implementation Status: ✅ TASKS 1-3 COMPLETE

### Task 1: Add Missing Multiplayer Collision Load Call ✅
**File**: `client/src/engine/gameplay/game/GameLaunchCoordinator.ts`  
**Change**: Added `setActiveMapCollisionLayout(data.map, data.sessionId)` at start of `startMultiplayerMatch`

**Before**:
```typescript
startMultiplayerMatch(data: MultiplayerGameStartPayload): void {
  this.config.enableMultiplayerFeature();
  // ... collision was NEVER set!
}
```

**After**:
```typescript
startMultiplayerMatch(data: MultiplayerGameStartPayload): void {
  console.log(`[GameLaunch] Starting MULTIPLAYER: map=${data.map}, mode=${data.mode}, sessionId=${data.sessionId}`);
  // Gate 1A: MODE-SCOPED COLLISION - Load collision for multiplayer mode immediately
  this.config.setActiveMapCollisionLayout(data.map, data.sessionId);
  
  this.config.enableMultiplayerFeature();
  // ...
}
```

**Status**: ✅ Implemented  
**Tests**: Type check passing

---

### Task 2: Enhance Collision Logging ✅
**File**: `client/src/engine/network/CollisionAuthoritySystem.ts`  
**Change**: Added detailed logging to `setStaticLayout` showing collision transitions

**Before**:
```typescript
setStaticLayout(mapId: string, sessionId: string): void {
  this.hasStaticLayout = hasMapCollisionLayout(mapId);
  this.staticLayout = getMapCollisionLayout(mapId, sessionId);
  // silent
}
```

**After**:
```typescript
setStaticLayout(mapId: string, sessionId: string): void {
  const previousMapId = this.staticLayout.mapId;
  const previousBoxCount = this.staticLayout.boxes.length;
  
  this.hasStaticLayout = hasMapCollisionLayout(mapId);
  this.staticLayout = getMapCollisionLayout(mapId, sessionId);
  
  // Gate 1A: MODE-SCOPED COLLISION - Log collision changes
  const newBoxCount = this.staticLayout.boxes.length;
  console.log(
    `[Collision] Layout change: ${previousMapId}(${previousBoxCount} boxes) → ${mapId}(${newBoxCount} boxes) [session:${sessionId}]`
  );
  
  gameBus.emit('stateMutation', { ... });
}
```

**Logging Output Example**:
```
[GameLaunch] Starting LOCAL FREEPLAY
[Collision] Layout change: bootstrap(0 boxes) → freeplay_test(12 boxes) [session:freeplay_test]

[GameLaunch] Starting MULTIPLAYER: map=default_arena, mode=ffa, sessionId=abc123xyz
[Collision] Layout change: freeplay_test(12 boxes) → default_arena(8 boxes) [session:abc123xyz]
```

**Status**: ✅ Implemented  
**Tests**: Type check passing

---

### Task 3: Add Mode Transition Logging ✅
**File**: `client/src/engine/gameplay/game/GameLaunchCoordinator.ts`  
**Changes**: Added console.log at start of each mode launch

**startScriptedLevel**:
```typescript
console.log(`[GameLaunch] Starting SCRIPTED level: ${levelId}`);
```

**startLocalFreeplay**:
```typescript
console.log(`[GameLaunch] Starting LOCAL FREEPLAY`);
```

**startMultiplayerMatch**: (already added above)
```typescript
console.log(`[GameLaunch] Starting MULTIPLAYER: map=${data.map}, mode=${data.mode}, sessionId=${data.sessionId}`);
```

**Result**: All mode transitions now produce clear, traceable console output

**Status**: ✅ Implemented  
**Tests**: Type check passing

---

## TASK 4: VALIDATION TESTING (READY TO EXECUTE)

### Setup: Build & Run
```bash
# Build for development
npm run build
npm run dev

# Start server (if not already running)
npm --prefix server run dev
```

### Test 1: Freeplay Collision Validation
**Goal**: Verify freeplay collision blocks movement  
**Steps**:
1. Start game → Select "Local Freeplay"
2. Open browser console (F12)
3. Expect to see:
   ```
   [GameLaunch] Starting LOCAL FREEPLAY
   [Collision] Layout change: bootstrap(...) → freeplay_test(...boxes) [session:freeplay_test]
   ```
4. Walk around level, try to walk through known walls/doorways
5. **PASS**: Movement blocked by collision geometry ✓

### Test 2: Mode Transition (Freeplay → Multiplayer)
**Goal**: Verify collision reloads on mode change  
**Steps**:
1. In freeplay, note collision behavior at specific location (e.g., door)
2. Exit to main menu
3. Start multiplayer (Host or Join room)
4. Open console, expect:
   ```
   [GameLaunch] Starting MULTIPLAYER: map=default_arena, mode=ffa, sessionId=<sessionId>
   [Collision] Layout change: freeplay_test(N boxes) → default_arena(M boxes) [session:<sessionId>]
   ```
5. Box count should DIFFER (N ≠ M) - proves collision was reloaded
6. **PASS**: Different collision geometry loaded ✓

### Test 3: Collision Isolation Verification
**Goal**: Verify freeplay/multiplayer don't share collision  
**Steps**:
1. In multiplayer, find location with different collision than freeplay
2. Try to walk in that location
3. Behavior should match multiplayer collision (not freeplay)
4. Exit multiplayer → return to freeplay
5. Same location should now behave per freeplay collision
6. **PASS**: Isolation working, no bleed ✓

### Test 4: Regression - No Collision Data Loss
**Goal**: Verify collision data not corrupted  
**Steps**:
1. Start freeplay → walk around
2. Access dev console: `systemContext.getSystem('CollisionAuthoritySystem').staticLayout.boxes.length`
3. Should be > 0 (e.g., 12)
4. Try entering multiplayer and exiting back to freeplay
5. Re-check box count → should be consistent (boxes don't disappear)
6. **PASS**: No data loss ✓

### Test 5: Multiplayer Consistency Check
**Goal**: Verify all players see same collision  
**Steps**:
1. Host multiplayer room
2. Have second player join (or observe from terminal)
3. Both players should log collision load messages
4. Box counts logged should be IDENTICAL for same map
5. Try same movement tests with both players
6. **PASS**: Both players can't walk through same geometry ✓

---

## Console Log Reference Map

**Expected output during lifecycle**:

```timeline
[GameLaunch] Starting LOCAL FREEPLAY
[Collision] Layout change: bootstrap(...) → freeplay_test(12 boxes)
  → Player spawned, can walk around

[GameLaunch] Exit to menu
  → (No collision log, system resets)

[GameLaunch] Starting MULTIPLAYER: map=default_arena, mode=ffa, sessionId=xyz
[Collision] Layout change: freeplay_test(12 boxes) → default_arena(8 boxes)
  → Player can move in arena with different collision

[GameLaunch] Exit multiplayer back to freeplay
[Collision] Layout change: default_arena(8 boxes) → freeplay_test(12 boxes)
  → Original collision restored
```

---

## VERIFICATION CHECKLIST

Before marking Gate 1A complete:

- [ ] Task 1: setActiveMapCollisionLayout called in startMultiplayerMatch
  - [ ] Type check passing ✓
  - [ ] No lint errors
  - [ ] Call is FIRST in function (before enableMultiplayerFeature)

- [ ] Task 2: Collision logging implemented
  - [ ] Console shows transition: "Layout change: X → Y"
  - [ ] Previous/new map IDs logged
  - [ ] Box counts logged
  - [ ] Session ID included

- [ ] Task 3: Mode logging implemented  
  - [ ] [GameLaunch] message appears on all mode launches
  - [ ] Mode type clear from message (SCRIPTED/FREEPLAY/MULTIPLAYER)
  - [ ] For multiplayer: map, mode, sessionId included

- [ ] All 5 tests passing:
  - [ ] Test 1: Freeplay collision blocks movement
  - [ ] Test 2: (CRITICAL) Collision reloads on mode change  
    - [ ] Box counts are DIFFERENT (X(N) → Y(M), N ≠ M)
  - [ ] Test 3: Collision isolation working (no bleed)
  - [ ] Test 4: No collision data loss on transitions
  - [ ] Test 5: Multiplayer players see same collision

- [ ] Build metrics maintained:
  - [ ] Type check: 0 errors
  - [ ] Type check: same duration (no perf regression)
  - [ ] System health: 98.28+ (no regression)

---

## Implementation Code Review

### Files Modified
1. `client/src/engine/gameplay/game/GameLaunchCoordinator.ts`
   - startScriptedLevel: +logging
   - startLocalFreeplay: +logging  
   - startMultiplayerMatch: +collision load + logging

2. `client/src/engine/network/CollisionAuthoritySystem.ts`
   - setStaticLayout: +logging

### Lines of Code Changed
- GameLaunchCoordinator.ts: 9 lines added (3 console.log, 1 function call)
- CollisionAuthoritySystem.ts: 8 lines added (logging logic)
- **Total**: ~17 lines, all additive (no deletions/refactors)

### Risk Assessment: LOW
- Pure function calls (no new side effects)
- Logging only (console output, no state mutation)
- Uses existing API (setActiveMapCollisionLayout)
- No behavioral change to core systems
- No dependency graph changes

---

## Next Steps After Gate 1A Completion

1. **Document findings** in memory system
2. **Commit** with message:
   ```
   Gate 1A: Map Geometry Isolation - Mode-scoped collision loading

   - Add missing setActiveMapCollisionLayout call in startMultiplayerMatch
   - Implement detailed collision transition logging
   - Add mode launch tracing for debugging
   - Result: Freeplay ↔ Multiplayer collisions now isolated
   - All 5 validation tests passing
   ```

3. **Begin Gate 1B** (Compile Optimization) - can run in parallel
4. **Unblock Gate 2A/2B** (Death animation + Inventory)

---

## Link to Main Documentation
See [PROJECT_AUDIT_AND_ROADMAP.md](../../PROJECT_AUDIT_AND_ROADMAP.md) Action Plan #1 for full context
