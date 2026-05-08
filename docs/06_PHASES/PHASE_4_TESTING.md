# 🧪 PHASE 4 TESTING GUIDE

**Version**: Phase 4  
**Date**: April 17, 2026  
**Purpose**: Test smart preloading, safe transitions, and performance monitoring  

---

## 🚀 QUICK START TEST

### 1. Start Dev Server
```bash
cd client
npm run dev
```

### 2. Open Browser
```
http://localhost:3000
```

### 3. Open DevTools (F12)
Go to **Console** tab

### 4. Watch Console Logs
```
[Bootloader] Phase 4: Smart preloading activated
[Preload] Selection recorded: multiplayer
[ModeTransition] Starting transition...
[PerformanceMonitor] Session metrics recorded
```

---

## 🔬 DETAILED TESTS

### TEST 1: Verify Preloading Started
**Goal**: Confirm preloading strategy is active

**Steps**:
1. Open Console (F12)
2. Paste this:
```javascript
console.log('Checking preloading...');
// The bootloader should have created PreloadingStrategy
// Watch for: "[Preload] Selection recorded" logs
```

3. Click mode button
4. Check console for:
```
[Preload] Selection recorded: multiplayer
```

**Expected**: Preload logs appear ✅

---

### TEST 2: Predict Next Mode
**Goal**: Test mode prediction algorithm

**Steps**:
1. Select these modes in this order:
   - Click MULTIPLAYER
   - Wait for game to load
   - Click again to change mode
   - Click FREEPLAY
   - Wait for game to load
   - Repeat pattern 3x

2. Check prediction in Console:
```javascript
preloadingStrategy.userBehaviorHistory
// Should show: ['multiplayer', 'freeplay', 'multiplayer', 'freeplay', ...]
```

**Expected**: History tracks all selections ✅

---

### TEST 3: Mode Transition Cleanup
**Goal**: Verify safe cleanup between mode switches

**Steps**:
1. Open Console (F12)
2. Select MULTIPLAYER mode
3. Wait for game to load
4. Switch to FREEPLAY
5. Check console for:
```
[ModeTransition] Starting transition from multiplayer → freeplay
[ModeTransition] Cleaning up multiplayer systems...
[ModeTransition] Network cleanup attempted
[ModeTransition] Event listeners cleared
[ModeTransition] Gameplay UI cleared
[ModeTransition] Complete (XXXms, freed XXMb)
```

**Expected**: All cleanup steps logged ✅

---

### TEST 4: Performance Metrics Tracking
**Goal**: Verify metrics are recorded

**Steps**:
1. Open Console (F12)
2. Play normally
3. Paste in Console:
```javascript
const stats = performanceMonitor.getStats();
console.table(stats);
// Shows: metricsCollected, averageTTI, worstTTI, bestTTI, averageMemory, alertsTriggered
```

4. Check results:
```
metricsCollected:  1
averageTTI:        1023
worstTTI:          1023
bestTTI:           1023
averageMemory:     45
alertsTriggered:   0
```

**Expected**: Metrics collected ✅

---

### TEST 5: Performance Regression Detection
**Goal**: Verify regression alerts work

**Steps**:
1. Play game for 5+ minutes
2. Collect performance baseline
3. Paste in Console:
```javascript
// Get recent metrics
const recent = performanceMonitor.getRecentMetrics(5);
recent.forEach(m => {
  console.log(`TTI: ${m.totalTTI}ms, Memory: ${m.memoryUsed}MB`);
});
```

4. If TTI > 10% higher than average:
```javascript
const alerts = performanceMonitor.getAlerts();
alerts.forEach(a => console.log(a.message));
// Should see regression alerts
```

**Expected**: Regressions detected if TTI degrades ✅

---

### TEST 6: Memory Freed During Transition
**Goal**: Measure memory cleanup effectiveness

**Steps**:
1. Open DevTools → Memory tab
2. Click "Take Heap Snapshot" (before mode switch)
3. Note the size
4. Switch to different mode in game
5. Click "Take Heap Snapshot" (after transition)
6. Compare sizes

**Expected**: Memory usage lower after transition ✅

---

### TEST 7: Metrics Persistence
**Goal**: Verify metrics saved to localStorage

**Steps**:
1. Play game
2. Open DevTools → Application/Storage → Local Storage
3. Look for key: `game-performance-metrics`
4. Click on it, view JSON
5. Should contain:
```json
{
  "timestamp": "2026-04-17T10:30:00Z",
  "stats": { ... },
  "recentMetrics": [ ... ],
  "alerts": [ ... ]
}
```

**Expected**: Data persisted in localStorage ✅

---

### TEST 8: Preload Efficiency
**Goal**: Check if preloading saved time

**Steps**:
1. Play game normally (let preloading work)
2. Paste in Console:
```javascript
preloadingStrategy.getStats();
// Output should show preloaded modes + time saved
```

3. Expected output:
```javascript
{
  preloadedModes: ['multiplayer'],
  totalPreloaded: 1,
  totalSavingsMs: 400
}
```

**Expected**: Shows preload effectiveness ✅

---

### TEST 9: Export Metrics for Analysis
**Goal**: Export performance data

**Steps**:
1. Paste in Console:
```javascript
const json = performanceMonitor.exportMetrics();
console.log(json);
// Full metrics exported as JSON
```

2. Copy output
3. Create file: `performance_report.json`
4. Paste JSON
5. Analyze in IDE

**Expected**: JSON file created with all metrics ✅

---

### TEST 10: Stress Test (Multiple Mode Switches)
**Goal**: Verify system handles rapid mode changes

**Steps**:
1. Open Console (F12)
2. Click MULTIPLAYER
3. Wait 2 seconds
4. Click FREEPLAY
5. Wait 2 seconds
6. Repeat 5x
7. Check console for errors

**Expected**: No crashes, all transitions succeed ✅

---

## 🧮 PERFORMANCE BENCHMARKS

### Expected Metrics
```
Bootloader → Kernel:      ~350ms (target: <400ms)
Kernel → UI Ready:        ~50ms
Mode Selection Idle:      ~500ms (preload window)
Mode Load (preloaded):    ~50ms (FAST!)
Mode Load (not preload):  ~600-800ms (normal)
Total TTI (with idle):    ~950-1050ms (acceptable)
Memory (kernel only):     ~15MB
Memory (mode loaded):     ~50MB
Memory freed on switch:   ~20MB (good cleanup)
```

---

## ⚠️ EXPECTED WARNINGS

### Console Warnings (OK to ignore)
```
[Preload] Failed to preload multiplayer: Error...
```
→ Normal if network is slow, will load on-demand

```
[ModeTransition] Warning: Could not cleanup network
```
→ Normal if mode not initialized, graceful fallback

---

## ❌ TROUBLESHOOTING

### Problem: No preload logs
**Solution**:
- Check if bootloader started: Look for "[Bootloader] Phase 4: Smart preloading activated"
- If missing, check browser console for errors
- Verify bootloader.ts loaded (Network tab → bootloader.js)

### Problem: Mode transitions hanging
**Solution**:
- Check Network tab for failed chunk downloads
- Try switching to freeplay (simpler)
- Reload page and try again

### Problem: No performance metrics
**Solution**:
- Metrics only recorded after full session
- Play for 10+ seconds then check
- Verify performanceMonitor is initialized

### Problem: Memory not showing
**Solution**:
- `performance.memory` is Chrome-only (DevTools required)
- Other browsers will show `0`
- Use DevTools Memory tab for actual memory profiling

---

## 📊 TEST CHECKLIST

- [ ] Preloading logs appear
- [ ] Mode prediction works
- [ ] Transitions complete successfully
- [ ] Metrics tracked
- [ ] Regressions detected
- [ ] Memory freed on transition
- [ ] Data persisted to localStorage
- [ ] Preload efficiency measured
- [ ] Export works
- [ ] Rapid mode switches OK
- [ ] Performance within budget
- [ ] No console errors

---

## 🎯 AUTOMATED TEST SCRIPT

Paste this into Console to run all tests:

```javascript
async function runPhase4Tests() {
  console.log('=== PHASE 4 TEST SUITE ===\n');
  
  const tests = {
    'Preloading Strategy Exists': () => {
      return typeof PreloadingStrategy !== 'undefined';
    },
    'Mode Transition Manager Exists': () => {
      return typeof modeTransitionManager !== 'undefined';
    },
    'Performance Monitor Exists': () => {
      return typeof performanceMonitor !== 'undefined';
    },
    'Metrics Collected': () => {
      const stats = performanceMonitor.getStats();
      return stats.metricsCollected > 0;
    },
    'localStorage has metrics': () => {
      const data = localStorage.getItem('game-performance-metrics');
      return data !== null;
    },
  };
  
  for (const [test, fn] of Object.entries(tests)) {
    const result = fn();
    const icon = result ? '✅' : '❌';
    console.log(`${icon} ${test}: ${result}`);
  }
  
  console.log('\n=== TEST SUMMARY ===');
  const stats = performanceMonitor.getStats();
  console.log(`Metrics collected: ${stats.metricsCollected}`);
  console.log(`Average TTI: ${stats.averageTTI.toFixed(0)}ms`);
  console.log(`Alerts: ${stats.alertsTriggered}`);
}

runPhase4Tests();
```

---

## 📝 TEST RESULTS TEMPLATE

**Session Date**: ___________  
**Tester**: ___________  
**Browser**: ___________  

### Metrics
- Bootloader → Kernel: _____ ms (target: <400ms) ✅ ❌
- Total TTI: _____ ms (target: <1200ms) ✅ ❌
- Mode Load (preloaded): _____ ms (target: <100ms) ✅ ❌
- Memory Freed: _____ MB (target: >10MB) ✅ ❌

### Issues Found
- [ ] None
- [ ] (List issues)

### Notes
___________________________________________

---

**Status**: ✅ TESTING SUITE READY  
**Date**: April 17, 2026
