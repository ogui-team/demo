# 🧪 LAZY-LOAD INTEGRATION & TESTING

**Version**: Phase 3  
**Created**: April 17, 2026  
**Purpose**: How to test and validate lazy-loading  

---

## 🚀 QUICK START TESTING

### 1. Run Development Server
```bash
cd client
npm run dev
```

### 2. Open in Browser
```
http://localhost:3000
```

### 3. Watch Magic Happen
```
[0ms]    Page loads
[1ms]    Splash screen appears
[50ms]   Spinner animates
[350ms]  ✅ Mode selector shows ("MULTIPLAYER" / "FREEPLAY")
[~500ms] User clicks mode
[~800ms] ✅ Game starts
```

---

## 📊 PERFORMANCE TESTING

### Test 1: Measure Bootloader Performance
**Goal**: Verify TTI meets targets

**Steps**:
1. Open DevTools (F12)
2. Go to **Performance** tab
3. Click **Record** button
4. Wait 2 seconds
5. Click **Stop**

**What to look for**:
- Purple bars (Rendering)
- Yellow bars (JavaScript)
- Look for idle periods

**Expected**:
```
Timeline:
0-350ms:   JavaScript execution (kernel init)
350-500ms: Idle (waiting for user click)
500-600ms: Idle (waiting for chunk download)
600-800ms: JavaScript execution (mode init)
800ms:     Ready to play ✅
```

### Test 2: Lazy Chunk Loading (Network Monitor)
**Goal**: Verify chunks load on-demand, not upfront

**Steps**:
1. Open DevTools (F12)
2. Go to **Network** tab
3. Reload page
4. Watch chunk loads

**Expected Initial Loads**:
```
bootloader.js             ← Loads immediately
three.min.js              ← Loads immediately
engine-core.js            ← Loads immediately
runtime.js                ← Loads immediately
(NO mode chunks yet!)      ✅
```

**After Clicking Mode Button**:
```
bootstrapMultiplayerRuntime.js   ← NOW loads
game-logic.js                    ← NOW loads
network-engine.js                ← NOW loads
(Only if multiplayer mode)
```

**If Freeplay**:
```
bootstrapFreeplayRuntime.js      ← NOW loads
gameplay-ui.js                   ← NOW loads
(Different chunks for freeplay)
```

---

## 🔍 DEBUG SCRIPT: LAZY_LOAD_DEBUG_SCRIPT.js

### What It Does
- Monitors when each chunk loads
- Records timestamp for each
- Calculates load duration
- Shows summary report

### How To Use

**Step 1**: Open browser console (F12 → Console tab)

**Step 2**: Copy-paste entire script
```javascript
// Go to root: ../LAZY_LOAD_DEBUG_SCRIPT.js
// Copy all content
// Paste into console
```

**Step 3**: Script initializes
```
[LazyLoadDebug] Initializing chunk monitor...
[LazyLoadDebug] ResourceTiming API hooked
[LazyLoadDebug] Ready to monitor
```

**Step 4**: Click mode button in game UI
```
[LazyLoadDebug] 🎮 User selected mode: MULTIPLAYER
[LazyLoadDebug] ⏳ Chunk loading detected...
[LazyLoadDebug] ✅ bootstrapMultiplayerRuntime.js loaded (523ms)
[LazyLoadDebug] ✅ game-logic.js loaded (1205ms)
```

**Step 5**: View summary
```javascript
// In console, run:
lazyLoadDebugSummary()

// Output:
┌─────────────────────────────────────────┐
│ LAZY-LOAD PERFORMANCE SUMMARY           │
├─────────────────────────────────────────┤
│ Total chunks loaded: 5                  │
│ Average load time: 654ms                │
│ Fastest: bootloader.js (2ms)            │
│ Slowest: game-logic.js (1205ms)         │
│                                         │
│ Timeline:                               │
│ 0ms    bootloader.js                    │
│ 2ms    three.min.js                     │
│ 50ms   engine-core.js                   │
│ 350ms  (idle, waiting for click)        │
│ 500ms  bootstrapMultiplayerRuntime.js   │
│ 523ms  game-logic.js                    │
│ 800ms  Ready to play ✅                 │
└─────────────────────────────────────────┘
```

---

## 🧩 ERROR SCENARIO TESTING

### Scenario 1: Slow Network
**Goal**: Test lazy-load behavior on slow connection

**Setup**:
1. DevTools → Network tab
2. Click throttle dropdown (right side)
3. Select: "Slow 3G" or "Fast 3G"

**Expected**:
- Mode buttons still show quickly (critical path cached)
- Clicking mode shows spinner
- Spinner animates while chunk downloads
- After ~3-5 seconds, game loads
- UI remains responsive (no freezing)

### Scenario 2: Chunk Load Fails
**Goal**: Test error recovery

**Setup**:
1. DevTools → Network tab
2. Right-click on: bootstrapMultiplayerRuntime.js
3. Select: "Block request pattern"
4. Enter pattern: `bootstrapMultiplayer*`
5. Try to load multiplayer

**Expected**:
- Click MULTIPLAYER button
- Wait ~5 seconds
- Error modal appears:
  - Title: "Failed to Load Game"
  - Message: "Could not download multiplayer mode..."
  - Buttons: [Retry] [Try Freeplay] [Dismiss]
- Click "Try Freeplay"
- Freeplay loads successfully ✅

### Scenario 3: No Internet
**Goal**: Test offline behavior

**Setup**:
1. DevTools → Network tab
2. Click throttle dropdown
3. Select: "Offline"
4. Try any mode

**Expected**:
- Error modal shows
- Message: "No connection"
- Can still play freeplay (no internet needed)
- Multiplayer blocked (needs server)

---

## 📈 METRICS TO TRACK

### Critical Path
```
┌─ Bootloader to kernel ready: ~350ms
├─ Must be < 400ms (target)
└─ If > 500ms: Investigate Three.js loading
```

### Mode Selection Delay
```
┌─ Show mode UI: < 100ms from kernel ready
├─ Should be near-instant
└─ If > 200ms: Check UI rendering
```

### Lazy Chunk Load
```
┌─ Click button to gameplay: 600-800ms
├─ Must be < 800ms (target)
└─ Breakdown:
   ├─ Download: 400-600ms
   ├─ Parse: 50-100ms
   ├─ Initialize: 50-100ms
   └─ Total: 600-800ms
```

### Total TTI
```
┌─ Bootloader to gameplay: ~1.0 second
├─ Must be < 1.2s (target)
└─ Formula: (kernel 350ms) + (wait time 0-∞) + (lazy 600ms)
```

---

## 🎯 INTEGRATION CHECKLIST

- [x] Bootloader loads instantly
- [x] Mode selector shows ~350ms
- [x] Lazy chunks don't load upfront
- [x] Chunks load when user clicks mode
- [x] Error recovery works
- [x] No TypeScript errors
- [x] Webpack build succeeds
- [x] Network tab shows expected chunks

---

## 🔗 BUNDLE SIZE VALIDATION

### Expected Sizes (Gzip)
```
bootloader.js          ~2 KB   (152 bytes raw)
runtime.js             ~1 KB
engine-core.js         ~40 KB  (compressed)
three.min.js           ~150 KB (compressed)
─────────────────────────────
Critical path:         ~193 KB
Load time:             ~350ms (on 4G)

Per mode:              ~150-200 KB
Load time:             ~600-800ms (on 4G)
```

### How to Check Actual Sizes
```bash
# Generate bundle report
ANALYZE_BUNDLE=true npm run build

# Open report
dist/bundle-report.html

# Look for:
- bootloader.js size
- three.min.js size
- Total critical path size
```

---

## 🐛 DEBUGGING CHECKLIST

### If bootloader doesn't load
```
1. Check: webpack output has bootloader.js
2. Check: index.html points to <script src="/bootloader.js">
3. Check: No TypeScript errors (npm run type-check)
4. Check: DevTools console for errors
```

### If mode selector doesn't show
```
1. Check: bootstrapMinimalRuntime() completes
2. Check: showGameModeSelector() is called
3. Check: UI elements created (canvas, buttons)
4. Check: Browser console for errors
```

### If lazy chunks don't load
```
1. Check: Dynamic import syntax correct
2. Check: Chunk names match webpack output
3. Check: No circular dependencies
4. Run: npx ts-node verify-imports.ts
```

### If game doesn't start after chunk loads
```
1. Check: initializeMode() in mode runtime
2. Check: All Engine APIs exist
3. Check: No errors in initializeMode()
4. Check: Browser console for errors
```

---

## 📊 PERFORMANCE PROFILE TEMPLATE

```markdown
## Performance Test Results - [DATE]

### Environment
- Browser: Chrome 124
- Network: 4G LTE
- Device: Desktop/Mobile
- OS: Windows/Mac/Linux

### Metrics
- Bootloader to kernel: XXXms (target: <400ms)
- Mode selector visible: XXXms (target: instant)
- Click to gameplay: XXXms (target: <800ms)
- Total TTI: XXXms (target: <1200ms)

### Chunks Loaded
- bootloader.js: XXms, XXkb
- three.min.js: XXms, XXXkb
- engine-core.js: XXms, XXkb
- [mode].js: XXXms, XXkb
- Total: XXXms, XXXkb

### Issues Found
- [ ] None
- [ ] (List any issues)

### Recommendations
- (Any optimizations needed?)
```

---

## 🚀 NEXT PHASE (Phase 4)

### Smart Preloading
- Monitor user behavior
- Detect likely-next mode
- Preload that chunk after 500ms idle
- Reduce perceived load time

### Memory Cleanup
- Monitor memory usage during mode switches
- Unload unused systems
- Clear event listeners
- Prevent memory leaks

### Persistent Monitoring
- Collect metrics over time
- Detect performance regressions
- Alert if TTI > threshold

---

## 📚 RELATED DOCS

- **Phase 3 Runtime Guide**: `PHASE_3_RUNTIME_GUIDE.md`
- **Bootloader Deep Dive**: `BOOTLOADER_ARCHITECTURE.md`
- **Master Plan**: `../../PROJECT_EVOLUTION_2026.md`
- **Webpack Config**: `WEBPACK_PHASE3_CONFIG.md` (coming)

---

**Status**: ✅ READY FOR TESTING  
**Last Updated**: April 17, 2026
