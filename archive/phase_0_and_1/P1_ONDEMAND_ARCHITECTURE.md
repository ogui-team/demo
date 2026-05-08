# P1: On-Demand Engine Architecture Implementation Guide

**Date**: April 17, 2026  
**Status**: Architecture & Baseline Ready  
**Goal**: Move from monolithic to on-demand delivery; achieve "Top 1%" performance  

---

## Phase 1: Visibility Baseline ✅ COMPLETE

### Bundle Breakdown (Post-Aggressive Splitting)

| Chunk | Size | Purpose | Priority | Lazy? |
|-------|------|---------|----------|-------|
| **three-vendor.js** | 561 KiB | Three.js + GLTFLoader | CRITICAL | Later* |
| **app-common.js** | 721 KiB | Kernel+Network+Systems | HIGH | 🎯 Split |
| **ui-diagnostics.js** | 198 KiB | UI + Debug systems | MEDIUM | ✓ Lazy |
| **engine-core.js** | 120 KiB | Core utilities | HIGH | ✓ Core |
| **runtime.js** | 1.01 KiB | Webpack runtime | - | - |
| **bundle.js** | 152 bytes | Entry point | - | - |
| **TOTAL** | **1.53 MiB** | - | - | - |

*Three.js can be lazy-loaded after rendering starts, but keep on critical path for now

### Analysis Tools Available
```bash
# Generate bundle report
ANALYZE_BUNDLE=true npm run build

# View report
open dist/bundle-report.html

# Measure build speed
MEASURE_SPEED=true npm run build
```

---

## Phase 2: Aggressive Splitting ✅ COMPLETE

### What Changed
- ✅ Added `runtimeChunk: 'single'` — Extracts webpack runtime separately (better cache)
- ✅ Created 7 dedicated cache groups with semantic names
- ✅ Minified cache groups capture engine subsystems as they scale
- ✅ Deterministic chunking for consistent, cache-friendly names

### Chunk Groups Priority (High → Low)
1. **three-vendor** (50) — Three.js, static, rarely changes
2. **networkEngine** (45) — Network subsystem, changed rarely after stabilization
3. **physicsCore** (42) — Physics + Kernel, performance critical
4. **runtimeSystems** (40) — Game systems, updates frequently
5. **engineCore** (38) — Core utilities, stable
6. **gameLogic** (35) — Game-specific code, **ready for lazy-load**
7. **ui** (25) — UI + Debug, **best candidate for lazy-load**
8. **appCommon** (10) — Fallback for remaining code

### Cache Impact
- Each chunk has **independent long-term cache** (via content hash in filename)
- Webpack runtime change → only `runtime.js` invalidates
- Three.js update → only `three-vendor.js` invalidates
- App code change → only affected chunk(s) invalidated

---

## Phase 3: Dynamic Imports (IMPLEMENTATION READY)

### Current Problem
All code loads at startup:
1. Browser downloads **1.53 MiB** monolithic bundle
2. Parser/compiler overhead scales linearly
3. 500ms+ Time-to-Interactive for slower connections

### Target Architecture
```
Initial Load (Critical Path):
  ├─ physics-core.js (kernel, transforms, rendering) ✓ CRITICAL
  ├─ three-vendor.js (WebGL backend) ✓ CRITICAL
  ├─ engine-core.js (scene management) ✓ CRITICAL
  ├─ runtime.js (webpack runtime) ✓ NEEDED
  └─ bundle.js (152 bytes entry)
     = ~850 KiB initial (44% reduction)

Load on Demand:
  ├─ network-engine.js (lazy: when multiplayer starts)
  ├─ ui-diagnostics.js (lazy: when menu opens)
  ├─ game-logic.js (lazy: when game mode selected)
  └─ runtime-systems.js (lazy: with game mode)
```

### Implementation: Multi-Entry Strategy

#### Step 1: Create Game Mode Entry Points
```typescript
// src/bootloader.ts (CRITICAL - replaces index.ts)
// Minimal bootstrap: initialize rendering kernel only
import { bootstrapMinimalRuntime } from './engine/runtime/bootstrapMinimalRuntime';

bootstrapMinimalRuntime();

// Then lazy-load game mode
const gameMode = new URLSearchParams(location.search).get('mode') || 'editor';
if (gameMode === 'multiplayer') {
  import('./engine/network/MultiplayerClient').then(m => m.startMultiplayer());
} else if (gameMode === 'singleplayer') {
  import('./games/SingleplayerGame').then(m => m.startGame());
} else {
  import('./engine/ui/EditorMode').then(m => m.startEditor());
}
```

#### Step 2: Create Minimal Bootstrap
```typescript
// src/engine/runtime/bootstrapMinimalRuntime.ts (NEW)
// Load only:
// - Three.js scene setup
// - Rendering pipeline
// - Input system (already mounted to DOM)
// - Network transport infrastructure (but NOT multiplayer client logic)

export function bootstrapMinimalRuntime() {
  // Initialize WebGL context, scene graph
  const engine = createEngineCore();
  
  // Attach to global for lazy-loaded modules to find
  (window as any).__engine = engine;
  
  // Show loading UI
  showBootScreen();
  
  return engine;
}
```

#### Step 3: Update webpack.config.js Entry Points
```javascript
entry: {
  // Critical path bootloader
  bootloader: './src/bootloader.ts',
  
  // Optional: Keep legacy single-entry for backwards compatibility
  bundle: './src/index.ts',
}
```

#### Step 4: HTML Template Routing
```html
<!-- src/index.html -->
<!DOCTYPE html>
<html>
  <head><title>PS1 Game Engine</title></head>
  <body>
    <div id="app"></div>
    <div id="loading-screen">Initializing...</div>
    
    <!-- Load bootloader (critical) -->
    <script src="bootloader.js"></script>
  </body>
</html>
```

#### Expected New Waterfall
```
0ms ┌─ HTML parsed
20ms │  ├─ runtime.js (1 KiB) ✓ loaded
40ms │  ├─ bootloader.js (150 KiB) ✓ loaded
100ms│  ├─ three-vendor.js (561 KiB) ✓ loaded, parsing starts
200ms│  ├─ engine-core.js (120 KiB) ✓ loaded
250ms│  ├─ physics-core.js (50 KiB est.) ✓ loaded
300ms│  ├─ bootstrap complete, app interactive ✨
     │
     ├─ User clicks "Multiplayer" (on-demand)
     │  └─ network-engine.js (100 KiB est.) ✓ lazy-loaded
     │
     └─ User opens settings (on-demand)
        └─ ui-diagnostics.js (198 KiB) ✓ lazy-loaded
```

**Before**: 1.53 MiB upfront → 500-800ms TTI  
**After**: 850 KiB upfront → 250-350ms TTI (**30-50% faster**)

---

## Phase 4: Cache Strategy (Filesystem + HTTP)

### Webpack Filesystem Cache ✅ PRESERVED
- Already enabled in `webpack.config.js`
- Each chunk invalidates independently based on **content hash**
- Rebuild only processes changed files

### HTTP Cache Headers (Recommended for Deployment)
```nginx
# Long-term cache for vendor + core (1 year)
location ~* (three-vendor|runtime|engine-core|physics-core)\.js$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}

# Medium-term cache for game logic (30 days)
location ~* (game-logic|network-engine)\.js$ {
  expires 30d;
  add_header Cache-Control "public";
}

# Short-term for bootloader (1 hour)
location ~* bootloader\.js$ {
  expires 1h;
  add_header Cache-Control "public";
}

# Never cache HTML
location = /index.html {
  add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

### How Chunks Stay Fresh
1. **three-vendor.js** → changes rarely → 1-year cache OK
2. **physics-core.js** → changes monthly → 30-day cache safe
3. **bootloader.js** → deploys frequently → 1-hour cache
4. **Webpack detects changes** → hash in filename changes → browsers fetch new version

**Result**: Users on repeat visits load only changed chunks from disk cache

---

## Phase 5: Implementation Checklist

### Week 1: Foundation
- [ ] Create `src/bootloader.ts` (minimal runtime init)
- [ ] Create `src/engine/runtime/bootstrapMinimalRuntime.ts`
- [ ] Update `webpack.config.js` entry points
- [ ] Update `src/index.html` to load bootloader
- [ ] Test cold load: verify chunks load on-demand
- [ ] Verify filesystem cache works (rebuild should be instant)

### Week 2: Game Modes
- [ ] Create lazy-load for MultiplayerClient
- [ ] Create lazy-load for SingleplayerGame
- [ ] Create lazy-load for EditorMode
- [ ] Test mode switching: no reload needed
- [ ] Measure TTI improvement

### Week 3: Optimization + Monitoring
- [ ] Profile with DevTools to find remaining bottlenecks
- [ ] Consider tree-shaking unused Three.js modules
- [ ] Add real-user-monitoring (RUM) to track performance
- [ ] Set up performance budget tracking
- [ ] Document deployment cache headers

---

## Constraints Addressed

### ✅ Filesystem Cache
- `config.cache.type: 'filesystem'` already in place
- Each chunk invalidates independently
- Rebuilds are instant on unchanged files

### ✅ Long-term Caching
- Content hashing already enabled
- `runtimeChunk: 'single'` ensures runtime stays tiny (won't invalidate app)
- Subsystem chunks get independent cache keys

### ✅ No Breaking Changes
- Keep legacy `index.ts` entry point for backwards compatibility
- Can run old and new bundles side-by-side during rollout
- Multiplayer/singleplayer already separate workflows

---

## Performance Targets

| Metric | Current | Target | Method |
|--------|---------|--------|--------|
| Initial Bundle | 1.53 MiB | 850 KiB | Aggressive splitting + lazy-load |
| TTI (Slow 4G) | ~800ms | ~350ms | Reduce critical path |
| Build Time | ~85s | ~30s | Continue P0 gains |
| Repeat Visit Load | 0 KiB (cache) | 0 KiB (cache) | HTTP caching |
| Filesystem Cache | ✓ Enabled | ✓ Enabled | Already working |

---

## Next Actions

1. **This week**: Implement bootloader + lazy-load MultiplayerClient
2. **Validation**: Test multiplayer mode startup time
3. **Measurement**: Compare before/after with DevTools Performance tab
4. **Rollout**: A/B test on 50% of users before full deployment

---

## Files to Create/Modify

| File | Type | Purpose |
|------|------|---------|
| `src/bootloader.ts` | CREATE | Minimal bootstrap entry point |
| `src/engine/runtime/bootstrapMinimalRuntime.ts` | CREATE | Core-only runtime init |
| `client/webpack.config.js` | MODIFY | Update entry points, add bootloader |
| `src/index.html` | MODIFY | Load bootloader instead of bundle |
| `src/index.ts` | KEEP | Legacy entry, can be deprecated |

---

## Monitoring & Rollback

### Monitoring
- Use `performance.now()` to log chunk load times
- Track TTI, First Paint, First Contentful Paint
- Monitor chunk loading errors via Sentry/LogRocket

### Rollback
- Keep both bundles deployed for 2 weeks
- Monitor error rates in new bootloader path
- If issues: route query param `?use-legacy=true` to old bundle

---

## Questions for Validation

1. **Multiplayer startup**: Does NetworkSyncSystem need all of network-engine upfront, or can parts load on-demand?
2. **Shared buffers**: Do physics-core and network-engine share any buffers that need sequential init?
3. **UI timing**: Can main menu UI (health, ammo, tools) be shown before network loads?
4. **Error handling**: If lazy-load of multiplayer fails, what's the user experience?

