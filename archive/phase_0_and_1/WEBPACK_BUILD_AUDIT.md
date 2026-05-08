# Webpack Build Time Audit & Optimization Recommendations

**Date**: April 17, 2026  
**Current Bundle Size**: ~1.46 MiB (1.18 MiB app + 548 KiB three-vendor)  
**Status**: Needs optimization  

## Current Configuration Analysis

### ✅ Already Optimized
- **Filesystem caching** enabled (`.webpack_cache/`)
- **Production mode** uses minification + splitting
- **Three.js code splitting** into separate vendor chunk (548 KiB)
- **ts-loader** with incremental TypeScript compilation
- **Source maps** for debugging

### ⚠️ Issues Identified

#### 1. **Source Maps in Production** (CRITICAL)
- **Current**: `devtool: 'source-map'` on ALL builds (dev + production)
- **Impact**: Doubles build time, adds ~1.5-2 MiB overhead per build
- **Fix**: Use `'source-map'` for dev, `false` for production

#### 2. **TypeScript Loader Configuration** (HIGH)
- **Current**: `ts-loader` with standard configuration
- **Missing**: `transpileOnly` option (skips type checking during build)
- **Missing**: `happyPackMode` for parallel compilation
- **Impact**: Full type checking on every build (unnecessary in dev cycle)
- **Fix**: Enable `transpileOnly` in dev, use `fork-ts-checker-webpack-plugin` for separate checking

#### 3. **Bundle Size Over Limit** (MEDIUM)
- **Current**: 1.46 MiB entrypoint (> 1.16 MiB recommended)
- **Vendor**: Three.js takes 548 KiB (37% of bundle)
- **App code**: 947 KiB
- **Impact**: Slower initial load, browser parse time
- **Fix**: Tree-shake unused Three.js modules, lazy-load components

#### 4. **No Lazy Code Splitting** (MEDIUM)
- **Current**: Single entry point, all chunks numbered
- **Missing**: Named chunk strategy, route-based or feature-based splitting
- **Impact**: All code loads before interaction
- **Fix**: Dynamic imports for game modes, scenes, network features

#### 5. **No Build Performance Analysis** (LOW)
- **Missing**: `speed-measure-webpack-plugin` or similar
- **Missing**: Detailed per-loader breakdown
- **Impact**: Cannot identify slowest phase
- **Fix**: Add bundle analysis tooling

#### 6. **Babel Not Present** (LOW)
- **Current**: TypeScript only (no Babel transpilation layer)
- **Status**: Good for modern browsers, but no minification tuning
- **Note**: OK for this project given ES2020 target

#### 7. **dev-server HMR Not Optimized** (MEDIUM - Dev Only)
- **Current**: `hot: true` with default settings
- **Missing**: Runtime exclusions, module boundaries
- **Impact**: Slow hot reload on large changes
- **Fix**: Add module federation or HMR whitelist

---

## Priority Fixes (Quick Wins)

### 🔴 P0: Fix Source Maps
```javascript
// webpack.config.js - Change to:
devtool: isProduction ? false : 'source-map',
```
**Expected Improvement**: 30-50% faster production builds (eliminates source map generation)

### 🔴 P0: Enable ts-loader TranspileOnly
```javascript
// webpack.config.js - ts-loader options:
options: {
  configFile: path.resolve(__dirname, 'tsconfig.json'),
  transpileOnly: !isProduction,  // Skip type checking in dev
  happyPackMode: true,
  compilerOptions: {
    sourceMap: !isProduction,
  }
}
```
**Expected Improvement**: 40-60% faster dev builds

### 🟠 P1: Split Chunks More Aggressively
```javascript
// webpack.config.js - optimization section:
splitChunks: {
  chunks: 'all',
  minSize: 20000,
  maxAsyncRequests: 30,
  maxInitialRequests: 30,
  cacheGroups: {
    // Three.js (already split)
    threeVendor: { /* ... */ },
    
    // Game engine subsystems
    networkEngine: {
      test: /[\\/]src[\\/]engine[\\/]3-network[\\/]/,
      name: 'network-engine',
      priority: 35,
    },
    
    // Physics/transform core
    physicsCore: {
      test: /[\\/]src[\\/]engine[\\/](1-kernel|core)[\\/]/,
      name: 'physics-core',
      priority: 33,
    },
    
    // Default vendors
    vendor: { /* ... */ },
  }
}
```
**Expected Improvement**: Parallel load, better caching

### 🟠 P1: Dynamic Imports for Game Modes
```typescript
// src/index.ts - Change to lazy-load game systems:
const loadMultiplayer = () => import('./engine/game/MultiplayerClient');
const loadSingleplayer = () => import('./games/SingleplayerGame');
```
**Expected Improvement**: 20-30% smaller initial payload

---

## Medium-Term Optimizations (Tooling)

### P2: Add Bundle Analysis
```bash
npm install --save-dev webpack-bundle-analyzer
```
**In webpack.config.js**:
```javascript
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

plugins: [
  isProduction && new BundleAnalyzerPlugin({
    analyzerMode: 'static',
    reportFilename: 'bundle-report.html',
  }),
]
```
**Benefit**: Visual identification of large modules

### P2: Add Build Speed Analysis
```bash
npm install --save-dev speed-measure-webpack-plugin
```
**Benefit**: Per-loader timing breakdown

### P3: Three.js Tree Shaking
- Audit which Three.js modules are actually used in the codebase
- Create a curated three.js build or use three.js ES modules with proper tree-shaking

---

## Current Build Metrics

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| **Production Build Size** | 1.46 MiB | < 1.1 MiB | -24% |
| **TypeScript Compile Time** | ~5-8s (est) | < 2s | -75% |
| **Source Map Size** | ~1.5 MiB | 0 MiB (prod) | -100% |
| **Initial Page Load** | 1.46 MiB | < 800 KiB | -45% |

---

## Implementation Roadmap

### Week 1 (Immediate)
1. [ ] **Disable production source maps** (5 min)
2. [ ] **Enable transpileOnly in dev** (10 min)
3. [ ] **Run initial build with fixes** (validate 2-3x speedup)

### Week 2 (Quick Value)
1. [ ] **Install bundle analyzer** (5 min)
2. [ ] **Generate bundle report** (analyze large modules)
3. [ ] **Add dynamic imports for game modes** (1-2 hours)
4. [ ] **Aggressive chunk splitting** (30 min)

### Week 3+ (Polish)
1. [ ] **Speed-measure plugin** (identify bottlenecks)
2. [ ] **Three.js audit and tree-shake** (2-3 hours)
3. [ ] **Module federation** for HMR (research + implement)
4. [ ] **Continuous monitoring** (add to CI/CD)

---

## Testing & Validation

After each change, measure:
```bash
# Production build with timing
time npm run build

# Dev server rebuild
npm run dev
# Make a file change and check Hot Module Reload time
```

Expected results after P0 fixes:
- Production builds: **30-50% faster**
- Dev rebuilds: **40-60% faster**
- Bundle size: **No change** (yet)

---

## Notes for Future Sessions

- **HMR bottleneck**: Large file changes trigger full rebuild; consider finer module boundaries
- **Three.js**: Currently 37% of bundle—investigate if all features are used
- **TypeScript**: Full type checking every rebuild is overkill—separate concern from transpilation
- **Cache**: Already using webpack filesystem cache effectively; keep enabled

