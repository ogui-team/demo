# Quick Testing Guide - Invisible Entities Fix

## Objective
Verify that 500 dummy entities spawn as visible red cubes in grid formation with idle-bob animation.

---

## Pre-Test Checklist

1. **Code Changes Applied**
   - [ ] `EntityRenderer.ts`: `onDummyArmySpawned()` creates fallback meshes
   - [ ] `DummyEnemySystem.ts`: Payload includes `origin` and `spacing`
   - [ ] `DummyEnemySystem.ts`: Visual entities have render components
   - [ ] `DummyEnemySystem.ts`: Transform sync uses `setTransform()`

2. **Build Status**
   ```bash
   npm --prefix client run build
   # Should complete without errors
   ```

3. **Dev Server Ready**
   ```bash
   npm --prefix client run dev
   # Should start without asset-loading errors
   ```

---

## Test Scenario 1: Basic Spawn & Visibility

### Steps
1. Start dev server: `npm --prefix client run dev`
2. Open game in browser
3. Execute spawn command (or add test trigger):
   ```javascript
   // In game code or via console
   dummyEnemySystem.spawnArmy(500);
   ```

### Expected Results
- ✅ 500 red cube meshes appear in viewport
- ✅ Cubes arranged in ~22×23 grid formation
- ✅ Grid centered at approximately (16, 1, 16)
- ✅ Each cube is 0.5 world units in size
- ✅ No console errors like "Missing custom asset"

### Failure Modes
| Problem | Cause | Fix |
|---------|-------|-----|
| Red cubes don't appear | Payload not being emitted | Check `DummyEnemySystem.spawnArmy()` |
| Cubes appear at origin (0,0,0) | Grid calc broken | Verify payload includes `origin` and `spacing` |
| Cubes appear but flicker | Scene visibility toggled | Check `mesh.visible` assignments |
| Wrong number of cubes | Event listener not registered | Check `setupListeners()` in EntityRenderer |

---

## Test Scenario 2: Idle-Bob Animation

### Steps
1. After army spawned, wait 2 seconds for animation to initialize
2. Activate idle-bob:
   ```javascript
   dummyEnemySystem.setIdleBobActive(true);
   ```
3. Observe cubes for 5+ seconds

### Expected Results
- ✅ Cubes bob smoothly up and down
- ✅ All cubes move in unison (same sine wave phase)
- ✅ Vertical amplitude ≈ 0.5 world units
- ✅ Oscillation frequency ≈ 2 cycles/second (smooth, not jerky)
- ✅ No stalls or frame rate drops

### Failure Modes
| Problem | Cause | Fix |
|---------|-------|-----|
| No movement | `idleBobActive` not set or `EntityRenderer.update()` not called | Call `setIdleBobActive(true)` AND verify `onRender()` hook includes `entityRenderer.update()` |
| Movement jerky/stutters | Position sync too slow | Check `EntityRenderer.update()` is being called every frame |
| Cubes desync (different phases) | Buffer write/read misaligned | Verify `kernel.positions.publish()` called after writes in DummyEnemySystem |
| Movement only on some cubes | Partial mesh sync | Check error handling; should sync all fallback meshes |
| Cubes move horizontally | Positions being read from wrong buffer or wrong offset | Verify buffer math: `basePos = denseIndex * 3; posBuffer[basePos + 1]` for Y |

### Phase 2 Specific: Verify Render Loop Integration
```javascript
// In browser console - check if EntityRenderer is syncing each frame:

// Before calling anything, add logging
const originalLog = console.log;
let syncCount = 0;

// Hook into EntityRenderer to count syncs
// (Requires temporary debug logging in EntityRenderer.update())

// Spawn army
dummyEnemySystem.spawnArmy(500);

// Enable animation
dummyEnemySystem.setIdleBobActive(true);

// Wait 60 frames (~1 second at 60 FPS)
// Check console for "[EntityRenderer] Per-frame mesh sync" logs
// Should see ~60 sync messages

// If you see NO sync messages: EntityRenderer.update() not being called
// If you see 1-2 sync messages: Only happening once (not per-frame)
// If you see 60+ sync messages: Working correctly!
```

---

## Test Scenario 3: Mesh Mapping & Tracking

### Steps
1. After army spawned, run diagnostic in game code:
   ```javascript
   const meshCount = entityRenderer.getAllMeshes().size;
   console.log('Total meshes:', meshCount);
   
   const firstHandle = spawnedHandles[0];
   const mesh = entityRenderer.getMeshForEntity(firstHandle);
   console.log('First entity mesh:', mesh);
   console.log('Is fallback:', mesh?.userData?.isFallbackMesh);
   ```

### Expected Results
- ✅ `meshCount` equals 500
- ✅ First entity mesh is a THREE.Mesh object
- ✅ `userData.isFallbackMesh` === true
- ✅ Mesh color is red (0xff0000)

### Console Logs Should Include
```
[EntityRenderer] VISUAL BRIDGE: Processing dummy army spawn
  count: 500
  origin: { x: 16, y: 1, z: 16 }
  spacing: 2
[EntityRenderer] Created fallback cube for dummy [handle_0] at (14.0, 1.0, 14.0)
[EntityRenderer] Created fallback cube for dummy [handle_1] at (14.0, 1.0, 16.0)
... (many more)
[EntityRenderer] VISUAL BRIDGE: Fallback meshes created
  count: 500
```

---

## Test Scenario 4: Camera Frustum Check

### Steps
1. After army spawned, check if visible
2. Zoom out to see full grid
3. Rotate camera around spawn point

### Expected Results
- ✅ Red cube grid visible from most angles
- ✅ Cubes render correctly when camera is outside sphere
- ✅ No clipping/disappearing when moving through grid
- ✅ Culling system properly registers/unregisters meshes

### If Cubes Invisible
```
Troubleshooting:
1. Camera position: console.log(camera.position)
   → Should be able to see (16, 1, 16) area
   
2. Camera frustum: camera.frustum.intersectsSphere(bounds)
   → Should return true for spawn area
   
3. Layer settings: Check if raycast layers are correct
   → Fallback meshes use ['world', 'editor'] layers
```

---

## Test Scenario 5: Cleanup & Destruction

### Steps
1. After 10+ seconds of idle-bob, kill some entities:
   ```javascript
   dummyEnemySystem.killDummy(spawnedHandles[0]);
   dummyEnemySystem.killDummy(spawnedHandles[1]);
   dummyEnemySystem.killDummy(spawnedHandles[2]);
   ```
2. Check mesh count again:
   ```javascript
   console.log('Meshes after kill:', entityRenderer.getAllMeshes().size);
   ```

### Expected Results
- ✅ Killed entities' cubes disappear from viewport
- ✅ Mesh count decreases (now 497)
- ✅ Geometry properly disposed (no memory leaks)
- ✅ No console warnings about missing objects

---

## Performance Monitoring

### Commands to Run in Browser Console

1. **Frame Rate Check**
   ```javascript
   let frameCount = 0;
   let lastTime = performance.now();
   
   function checkFPS() {
     frameCount++;
     const now = performance.now();
     if (now - lastTime >= 1000) {
       console.log('FPS:', frameCount);
       frameCount = 0;
       lastTime = now;
     }
     requestAnimationFrame(checkFPS);
   }
   checkFPS();
   // Target: 60 FPS
   ```

2. **Memory Usage** (Chrome DevTools)
   - Open DevTools → Memory tab
   - Take heap snapshot before spawn
   - Spawn 500 entities
   - Take heap snapshot after
   - Compare: Should see ~1-2 MB increase (not 50+ MB)

3. **GPU Usage**
   - Open DevTools → Performance tab
   - Record while army is bobbing
   - Check GPU time: Should be <5ms per frame for 500 cubes

---

## Regression Testing

If fixes don't work, test each component individually:

### 1. Event Emission
```javascript
(gameBus).on('DUMMY_ARMY_SPAWNED', (payload) => {
  console.log('Event received:', payload);
});
dummyEnemySystem.spawnArmy(10); // Start small
```

### 2. Grid Calculation
```javascript
// Manually test grid math
const count = 500;
const cols = Math.ceil(Math.sqrt(count));
const rows = Math.ceil(count / cols);
console.log(`Grid: ${cols}×${rows}`);

for (let i = 0; i < Math.min(5, count); i++) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const x = 16 + (col - cols / 2) * 2;
  const z = 16 + (row - rows / 2) * 2;
  console.log(`Entity ${i}: (${x.toFixed(1)}, 1, ${z.toFixed(1)})`);
}
```

### 3. Mesh Creation
```javascript
// In EntityRenderer.ts, add temporary logging:
console.log('Creating mesh count:', handles.length);
handles.forEach((h, i) => {
  if (i < 5 || i % 100 === 0) {
    console.log(`Mesh ${i}/${handles.length} for handle ${h}`);
  }
});
```

---

## Success Criteria Summary

| Criterion | Pass | Fail |
|-----------|------|------|
| 500 red cubes visible | ✅ | ❌ |
| Grid formation (22×23) | ✅ | ❌ |
| Idle-bob animation | ✅ | ❌ |
| 60 FPS maintained | ✅ | ❌ |
| Mesh count = 500 | ✅ | ❌ |
| No console errors | ✅ | ❌ |
| Memory < 50 MB overhead | ✅ | ❌ |

**All Pass = ✅ Issue Resolved**
