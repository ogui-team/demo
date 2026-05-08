# 🔍 CLIENT FOLDER AUDIT & CLEANUP PLAN

**Date**: April 17, 2026  
**Purpose**: Identify outdated files, blind spots, and alignment with Phase 3  
**Status**: Audit in progress  

---

## 📋 CURRENT STATE ANALYSIS

### Outdated Documentation Found ❌

| File | Version | Status | Action |
|------|---------|--------|--------|
| **GAME_V010_OVERVIEW.md** | v0.1.0 | OUTDATED | Delete (we're at v0.1.4, Phase 3) |
| **ENGINE_ARCHITECTURE.md** | v0.1.2 baseline | OUTDATED | Update or Delete |
| **ENGINE_SYSTEMS_OVERVIEW.md** | Unknown | Check needed | Verify & update |

**Issue**: These files reference old architecture before lazy-load, before transactional kernel, before Phase 0-3 work.

---

## 🔎 WHAT'S IN CLIENT/ NOW

```
client/
├─ .typescript_cache/              (Build artifact - OK)
├─ .webpack_cache/                 (Build artifact - OK)
├─ dist/                           (Build output - OK)
│
├─ 📄 ENGINE_ARCHITECTURE.md       ❌ OUTDATED (v0.1.2)
├─ 📄 ENGINE_SYSTEMS_OVERVIEW.md   ⚠️ NEEDS CHECK
├─ 📄 GAME_V010_OVERVIEW.md        ❌ DELETE (v0.1.0!)
├─ 📄 webpack-stats.json           (Build stats - OK)
│
├─ package.json                    ✅ OK
├─ tsconfig.json                   ✅ OK
├─ webpack.config.js               ✅ OK
├─ verify-imports.ts               ⚠️ NEEDS CHECK
│
└─ src/
   ├─ 📄 bootloader-test.html      (Test file - keep for now)
   ├─ 📄 bootloader.ts             ✅ OK (Phase 3)
   ├─ 📄 index.html                ✅ OK
   ├─ 📄 index.ts                  ✅ OK (Fallback entry)
   ├─ 📄 main.js                   ⚠️ NEEDS CHECK (What is this?)
   ├─ 📄 PhysicsConstants.ts        ✅ OK
   │
   ├─ engine/
   │  ├─ 📄 index.ts               ✅ OK (exports)
   │  ├─ 📄 systems.ts             ⚠️ NEEDS CHECK
   │  ├─ 0-foundation/             ✅ OK
   │  ├─ 1-kernel/                 ✅ OK
   │  ├─ 2-systems/                ✅ OK
   │  ├─ 3-network/                ✅ OK
   │  ├─ 4-runtime/                ✅ OK
   │  │
   │  ├─ core/                     ⚠️ NEEDS REVIEW
   │  ├─ runtime/                  ✅ Updated (Phase 3)
   │  ├─ gameplay/                 ✅ OK
   │  ├─ graphics/                 ⚠️ CHECK: Material/VFX systems
   │  ├─ network/                  ✅ OK
   │  └─ ...
   │
   └─ assets/
      ├─ mapColliders.json         ✅ OK
      ├─ models/                   ⚠️ Empty?
      └─ prefabs/                  ✅ OK (multiple prefabs)
```

---

## ⚡ BLIND SPOTS IDENTIFIED (Post-Refactoring)

### 1. ❌ MISSING: Runtime Bootstrap Documentation
**What**: We updated `bootstrapMinimalRuntime.ts`, `bootstrapMultiplayerRuntime.ts`, `bootstrapFreeplayRuntime.ts`  
**Missing**: No documentation in client/ explaining Phase 3 changes  
**Impact**: New developers won't understand lazy-load flow  
**Fix**: Create `client/PHASE_3_RUNTIME_GUIDE.md`

### 2. ❌ MISSING: Bootloader Architecture Doc
**What**: Bootloader is core Phase 3 component  
**Missing**: No architecture documentation  
**Impact**: Unclear what bootloader does, how it works  
**Fix**: Create `client/BOOTLOADER_ARCHITECTURE.md`

### 3. ⚠️ UNCLEAR: `engine/systems.ts` Purpose
**What**: File exists in engine/  
**Question**: Is this still used? What does it export?  
**Impact**: Potential dead code or unclear dependencies  
**Fix**: Audit and document

### 4. ⚠️ UNCLEAR: `src/main.js`
**What**: Main.js file in src/  
**Question**: Is this used? webpack entry? Why .js not .ts?  
**Impact**: Possible configuration artifact or dead code  
**Fix**: Verify or remove

### 5. ⚠️ UNCLEAR: `engine/graphics/` Structure
**What**: Graphics folder exists  
**Question**: Material/VFX systems mentioned in old docs - still there?  
**Impact**: Possible mismatch between planned and actual  
**Fix**: Audit folder contents

### 6. ❌ MISSING: Imports Verification Post-Phase3
**What**: `verify-imports.ts` exists  
**Question**: When was this last run? Does it catch Phase 3 bootloader changes?  
**Impact**: Unknown if imports are still valid  
**Fix**: Run verification

### 7. ⚠️ MISSING: Client-Side Lazy-Load Validation
**What**: LAZY_LOAD_DEBUG_SCRIPT.js is in root  
**Question**: Should there be client-side support for it? Integration point?  
**Impact**: Debug script might not be discoverable  
**Fix**: Add link/docs in client/

### 8. ❌ MISSING: webpack.config.js Documentation
**What**: Complex webpack config with 7 cache groups  
**Missing**: Inline documentation of what each group does  
**Impact**: Hard to maintain/modify  
**Fix**: Add detailed comments to webpack.config.js

### 9. ⚠️ UNCLEAR: Asset Pipeline
**What**: `assets/models/` folder is mostly empty  
**Question**: How are 3D models loaded? Asset pipeline?  
**Impact**: Prefab system vs. model system confusion  
**Fix**: Document asset loading architecture

### 10. ⚠️ UNCLEAR: Error Recovery in Bootloader
**What**: Bootloader has error handling  
**Missing**: No documentation on fallback behavior  
**Impact**: Not obvious what happens if chunk fails to load  
**Fix**: Add error recovery documentation

---

## 🎯 CLEANUP ACTIONS NEEDED

### DELETE (No longer relevant)
```
❌ client/GAME_V010_OVERVIEW.md          (v0.1.0 planning - completely outdated)
```

### ARCHIVE (Move to client/archive/ for reference)
```
📦 client/ENGINE_ARCHITECTURE.md        (v0.1.2 baseline - historical)
📦 client/ENGINE_SYSTEMS_OVERVIEW.md    (Outdated architecture view)
```

### VERIFY & UPDATE (Still relevant?)
```
⚠️ client/src/main.js                   (What is this? webpack artifact?)
⚠️ client/src/engine/systems.ts         (Still in use?)
⚠️ client/verify-imports.ts             (When last run? Does it validate Phase 3?)
```

### CREATE (Missing documentation)
```
✅ client/PHASE_3_RUNTIME_GUIDE.md      (Runtime bootstrap flow)
✅ client/BOOTLOADER_ARCHITECTURE.md    (Bootloader design)
✅ client/WEBPACK_CACHE_GROUPS.md       (Explanation of 7 cache groups)
✅ client/LAZY_LOAD_INTEGRATION.md      (How to test lazy loading)
✅ client/ASSET_PIPELINE.md             (How models/prefabs are loaded)
```

### UPDATE (Reflect Phase 3)
```
✅ client/webpack.config.js             (Add inline comments for cache groups)
✅ client/src/bootloader.ts             (Add architecture comments at top)
✅ client/tsconfig.json                 (Verify all paths still valid)
```

---

## 📊 CURRENT STATE SUMMARY

### Files Status
```
✅ Good State:        (bootloader, runtimes, package.json, webpack)
⚠️ Needs Verification: (main.js, systems.ts, verify-imports.ts)
❌ Outdated:          (ENGINE_ARCHITECTURE.md, GAME_V010_OVERVIEW.md)
❌ Missing:           (Phase 3 runtime docs, bootloader docs)
```

### Organization Score
```
Before Archival: 5/10 (Mixed old/new files)
After Archival:  2/10 (Lots of outdated docs, missing Phase 3 docs)
Target:          9/10 (Phase 3 reflected, docs current)
```

---

## 🚀 RECOMMENDED CLEANUP SEQUENCE

### STEP 1: DELETE (5 minutes)
```bash
# Delete completely outdated file
rm client/GAME_V010_OVERVIEW.md
```

### STEP 2: ARCHIVE (10 minutes)
```bash
# Create client/archive/ and move old docs
mkdir -p client/archive/
mv client/ENGINE_ARCHITECTURE.md client/archive/
mv client/ENGINE_SYSTEMS_OVERVIEW.md client/archive/
```

### STEP 3: VERIFY (15 minutes)
```bash
# Check unclear files
- Review: client/src/main.js (delete if unused)
- Review: client/src/engine/systems.ts (still used?)
- Run: client/verify-imports.ts (does it work?)
```

### STEP 4: CREATE NEW DOCS (1 hour)
```
✅ PHASE_3_RUNTIME_GUIDE.md
✅ BOOTLOADER_ARCHITECTURE.md
✅ LAZY_LOAD_INTEGRATION.md
```

### STEP 5: UPDATE EXISTING (30 minutes)
```
✅ webpack.config.js - Add comments
✅ bootloader.ts - Add top-of-file architecture
✅ README or INDEX for client folder
```

---

## 🔍 VERIFICATION CHECKLIST

### Before Moving Forward

- [ ] Run `npm run type-check` in client/ (verify all imports)
- [ ] Check: Is `main.js` actually used?
- [ ] Check: Is `systems.ts` still in use?
- [ ] Verify: `verify-imports.ts` works with new structure
- [ ] Review: `engine/graphics/` folder (what's inside?)
- [ ] Check: `assets/models/` usage
- [ ] Review: Boot sequence in webpack (does bootloader load first?)

---

## ✅ GOALS FOR THIS CLEANUP

1. **Clarity**: Client folder reflects Phase 3 architecture
2. **Discoverability**: New developers find documentation easily
3. **Blind Spots**: All unclear areas documented or removed
4. **Maintainability**: webpack, imports, structure are well-documented
5. **Alignment**: Client structure matches root-level master plan

---

## 📈 SUCCESS METRICS

After cleanup complete:
- ✅ Zero outdated documentation in client/
- ✅ All Phase 3 changes documented
- ✅ All unclear files resolved
- ✅ Lazy-load integration documented
- ✅ New developers can understand flow in 10 minutes
- ✅ No blind spots remain

---

**Status**: 🟡 READY FOR CLEANUP  
**Effort**: ~2 hours total  
**Risk**: Low (mostly docs, one delete)
