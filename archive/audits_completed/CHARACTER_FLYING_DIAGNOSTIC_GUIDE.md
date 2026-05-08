# 🔍 Character Flying Away - Diagnostic Report & Fix

**Status**: Build successful with enhanced diagnostics
**Issue**: Character flies/teleports away when jumping

---

## What's Happening

The logs show **massive position corrections** (4,881 → 326,128 → 2.5M units):
```
correctionDistance: 4881.611374085927
correctionDistance: 326128.1240807573
correctionDistance: 2508741.1187388087
```

This means:
- **Client prediction** calculated position A
- **Server snapshot** says position B
- **Difference** is HUGE (thousands/millions of units)
- **Reconciliation** snaps back violently
- **Visual result**: Character teleports/flies

---

## Root Cause (Hypothesis)

After removing the input throttle, now that inputs aren't rate-limited:

1. **More inputs accumulate** in the pending buffer
2. **Input replay** applies all accumulated inputs
3. **Jump impulse** might be applied multiple times OR incorrectly
4. **Client velocity** diverges massively from server
5. **Position accumulates error** every frame
6. **Reconciliation** sees huge delta and snaps back

**OR**: Client/server have different physics constants and prediction diverges.

---

## Diagnostics Added

I've added enhanced logging to help identify the exact issue. Here's what to look for:

### 1. **Input Replay Overflow Warning**
```
[INPUT_REPLAY] Input buffer overflowed!
  pendingInputCount: 45
  maxAllowed: 30
  dropped: 15
```

**What it means**: Too many inputs queued. If you see this, the buffer is backing up.

### 2. **Massive Correction Warning**
```
[DESYNC_CRITICAL] Massive position correction!
  correctionDistance: 4881.61
  clientPos: {x: "1234.56", y: "500.00", z: "789.12"}
  serverPos: {x: "1234.56", y: "-4000.00", z: "789.12"}
  clientVel: {x: "0.00", y: "8.00", z: "0.00"}
  serverVel: {x: "0.00", y: "0.00", z: "0.00"}
```

**What it means**: 
- Client Y position was up high (jumped)
- Server Y position was on ground
- Client velocity Y was 8 (jump impulse)
- Server velocity Y was 0 (server didn't see jump)
- **=** Jump not synchronized server-side

### 3. **Jump Application Debug Log**
```
[JUMP_DEBUG] Jump applied in client prediction
  jumpImpulse: 8
  positionBefore: {x: "0.00", y: "0.10", z: "0.00"}
  velocityAfter: {x: "0.00", y: "8.00", z: "0.00"}
  wasAirborne: false
  hadCoyote: false
```

**What it means**:
- Jump was applied locally on client
- Velocity set to 8 (correct)
- Position was on ground (correct)
- wasAirborne=false (was grounded, OK)

---

## How To Test & Diagnose

### Test 1: Single Jump
```
1. Open browser console (F12)
2. Spawn in game
3. Press Space ONCE to jump
4. Watch console logs
```

**Expected logs**:
```
[INPUT_REPLAY] Starting replay: pendingInputCount=0...1
[JUMP_DEBUG] Jump applied in client prediction: jumpImpulse=8
[INPUT_REPLAY] Replay complete: replayed=1
```

**Problem signs**:
- `pendingInputCount > 5` on single jump
- Jump debug logged multiple times per jump
- Massive correction warnings

### Test 2: Rapid Jumps
```
1. Tap Space 3 times quickly
2. Watch console
3. Look for overflow warnings
```

**Expected**:
- No overflow warnings
- 3 separate jump debug logs

**Problem**:
- Overflow warnings = buffer backing up
- More than 3 jumps logged = input replay is replaying too much

### Test 3: Movement + Jump
```
1. Hold W to move
2. Press Space to jump
3. Check if massive corrections appear
```

**Expected**:
- No desync warnings
- Smooth movement + jump

**Problem**:
- Massive corrections = client/server physics mismatch

---

## Likely Fixes Based on Diagnostics

### If you see "Input buffer overflowed":
The input throttle fix exposed an input backlog problem. **Solution**:
- Lower `MAX_REPLAY_INPUTS` from 30 to 10
- Or re-enable the throttle (more conservative)
- Or fix the server to process inputs faster

### If you see "Massive position correction" with different Y values:
Jump isn't synchronized. **Solution**:
- Check if server `MovementRuntime.ts` and client `applyInput()` use same jump impulse (8)
- Check if server/client both detect grounded state correctly
- Add debug logs to server-side jump application

### If you see "[INPUT_REPLAY] Input buffer overflowed!":
**Immediate fix**: Reduce  `MAX_REPLAY_INPUTS` in NetworkSyncSystem.ts line ~1355

### If Jump Debug logs too many times:
Jump is being applied multiple times per real jump. **Solution**:
- Check jumpPressed edge detection
- Verify jumpBufferRemaining is being cleared after jump

---

## Where Code Changes Are

1. **Input Replay Safety Limits**: NetworkSyncSystem.ts line ~1355
   ```typescript
   const MAX_REPLAY_INPUTS = 30;  // Cap at this max
   ```

2. **Massive Correction Warning**: NetworkSyncSystem.ts line ~1251
   ```typescript
   if (correctionDistance > 100) {
     console.warn('[DESYNC_CRITICAL]...
   ```

3. **Jump Debug Logging**: NetworkSyncSystem.ts line ~2005
   ```typescript
   if (runtime.jumpBufferRemaining > 0 && ...) {
     console.log('[JUMP_DEBUG] Jump applied...
   ```

---

## Next Steps

1. **Run test suite above** (single jump, rapid jumps, movement+jump)
2. **Screenshot console logs** for each test
3. **Report which diagnostic warnings appear**
4. **I'll provide targeted fix** based on what logs show

---

## Quick Reference: Diagnostic Checklist

After jumping, check console for:

- [ ] `[INPUT_REPLAY]` logs appear
- [ ] `[JUMP_DEBUG]` appears exactly once per jump
- [ ] `[INPUT_REPLAY] Input buffer overflowed!` (problem if present)
- [ ] `[DESYNC_CRITICAL]` (problem if present)
- [ ] `[PERF_WARNING] Physics Desync Detected` (note correction distances)

---

## Revert Point If Needed

If the diagnostics cause too much spam:
- Remove the `if (correctionDistance > 100)` warning block
- Remove the `if (remaining.length > MAX_REPLAY_INPUTS)` warning
- Remove the jump debug log inside `if (runtime.jumpBufferRemaining > 0)`

All are non-critical for function, just for diagnosis.

---

**Test now and report which diagnostic messages you see!**
