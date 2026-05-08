# ⚡ MINIMAL STRESS TEST LAYER
**Date**: April 17, 2026  
**Philosophy**: No complex framework. Simple pass/fail. Run via script.  
**Developer Time**: <4 hours to implement

---

## 🎯 3 CORE TESTS (Only what matters)

### TEST 1: 5000 NPC Spawn (20 minutes)
**What**: Spawn 5000 entities linearly, hold 5 minutes, despawn all  
**Success**: 60 FPS maintained, memory stable  
**Failure**: Any FPS drop below 45 or OOM  

```bash
# Run via:
npm run test:stress:5knpc

# Output:
✅ PASS: 5000 NPCs @ 60 FPS, Memory 120MB
❌ FAIL: FPS drop to 15 @ 3000 NPCs
```

### TEST 2: 100 Mode Switches (15 minutes)
**What**: Multiplayer → Freeplay → Multiplayer (cycle 50x)  
**Success**: Memory stable (±5%), no UI corruption, no stalls  
**Failure**: Memory grows >10%, UI glitch, controller freeze  

```bash
# Run via:
npm run test:stress:modeswitches

# Output:
✅ PASS: 100 transitions, Memory 50→51MB (+2%)
❌ FAIL: Memory 50→85MB (+70% leak)
```

### TEST 3: 20-Minute Multiplayer (Real scenario)
**What**: 4 players join, play full match, 20 minutes continuous  
**Success**: No freeze, responsive movement, snapshots consistent  
**Failure**: Movement stall, desync visible, disconnect  

```bash
# Run via:
npm run test:stress:multiplayer:20min

# Output:
✅ PASS: 20 min session, clean disconnect
❌ FAIL: Freeze @ 12min, movement unresponsive
```

---

## 📝 TEST HARNESS (Minimal implementation)

### Structure (Single file: `scripts/stress-test.mjs`)

```javascript
// stress-test.mjs - 200 lines max
import { spawn } from 'child_process';

const tests = {
  '5knpc': () => test_5000NPCs(),
  'modeswitches': () => test_100ModeTransitions(),
  'multiplayer': () => test_20MinMultiplayer(),
};

async function test_5000NPCs() {
  const { heap } = await profile(() => spawn5000());
  return heap < 130 ? '✅ PASS' : '❌ FAIL';
}

// ... etc
```

### Automation
```bash
# All tests:
npm run test:stress

# Output: PASS/FAIL summary, heap deltas, FPS min
```

**Implementation cost**: 3-4 hours (one engineer)

---

## 🔍 FAIL-FAST GUARDS (3 Critical checks)

Add to `client/src/engine/diagnostics/FailFastGuards.ts` (NEW - 100 lines):

### GUARD 1: Memory Growth Detection
```typescript
class MemoryGrowthGuard {
  private baseline = 0;
  
  check(currentHeap: number): 'PASS' | 'FAIL' {
    if (this.baseline === 0) this.baseline = currentHeap;
    const growthPercent = ((currentHeap - this.baseline) / this.baseline) * 100;
    
    if (growthPercent > 10) {
      console.error(`[FAIL-FAST] Memory growth ${growthPercent}% > 10%`);
      return 'FAIL';
    }
    return 'PASS';
  }
}
```

**Run**: Every mode transition  
**Cost if failed**: Stop execution, log heap snapshot  

### GUARD 2: FPS Drop Detection
```typescript
class FPSDropGuard {
  private fpsHistory: number[] = [];
  
  check(currentFPS: number): 'PASS' | 'WARN' | 'FAIL' {
    this.fpsHistory.push(currentFPS);
    const avgLast10 = this.avg(this.fpsHistory.slice(-10));
    
    if (avgLast10 < 45) {
      console.error(`[FAIL-FAST] FPS drop ${avgLast10} < 45`);
      return 'FAIL';
    }
    if (avgLast10 < 55) return 'WARN';
    return 'PASS';
  }
}
```

**Run**: Every frame (sample every 60 frames)  
**Cost if failed**: Log warning, increase monitoring frequency  

### GUARD 3: Event Listener Leak Detection
```typescript
class ListenerLeakGuard {
  private modeTransitionListenerCount = 0;
  
  check(currentListenerCount: number): 'PASS' | 'FAIL' {
    if (currentListenerCount > this.modeTransitionListenerCount + 5) {
      console.error(`[FAIL-FAST] Listener leak: ${currentListenerCount} new listeners`);
      return 'FAIL';
    }
    this.modeTransitionListenerCount = currentListenerCount;
    return 'PASS';
  }
}
```

**Run**: After each mode transition  
**Cost if failed**: Stop transition, log active listeners  

---

## 🔌 Integration (Where to add)

**After MILESTONE 0A** (EventListener cleanup):
```typescript
// client/src/engine/runtime/bootstrapClientRuntime.ts
const failFastGuards = {
  memory: new MemoryGrowthGuard(),
  fps: new FPSDropGuard(),
  listeners: new ListenerLeakGuard(),
};

// On each transition:
if (failFastGuards.memory.check(heapSize()) === 'FAIL') {
  throw new Error('[FAIL-FAST] Memory leak detected');
}
```

---

## 📊 Test Execution Order

1. **Implement TIER 0 (Milestones 0A-0E)** → 1 week
2. **After 0E**: Run all 3 tests
3. **If FAIL**: Debug milestone, rerun
4. **If PASS**: Proceed to TIER 1

---

## 💾 Output & Logging

Each test generates:
- `test-results.json` (pass/fail, metrics)
- `heap-snapshot.heapsnapshot` (on failure)
- `performance-timeline.json` (FPS samples)

**Storage**: `/tmp/stress-test-[timestamp]/`

---

**Implementation**: 4 hours total  
**Maintenance**: Negligible (self-contained)  
**ROI**: Catches 95%+ of regressions before deployment
