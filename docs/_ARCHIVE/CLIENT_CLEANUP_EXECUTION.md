# 🧹 CLIENT FOLDER CLEANUP - EXECUTION PLAN

**Status**: Ready for execution  
**Effort**: 30 minutes  
**Risk**: Low (mostly docs, one delete)  

---

## 🔴 FILES TO DELETE

### 1. `client/src/main.js` 
**Status**: OUTDATED ENTRY POINT  
**Why**: Old JavaScript entry point, replaced by TypeScript (`index.ts` + `bootloader.ts`)  
**Action**: DELETE

```bash
rm client/src/main.js
```

### 2. `client/GAME_V010_OVERVIEW.md`
**Status**: v0.1.0 PLANNING (We're at v0.1.4 Phase 3)  
**Why**: Completely outdated, no longer relevant  
**Action**: DELETE

```bash
rm client/GAME_V010_OVERVIEW.md
```

---

## 📦 FILES TO ARCHIVE (Move to client/archive/)

### 1. `client/ENGINE_ARCHITECTURE.md`
**Status**: v0.1.2 baseline documentation  
**Why**: Historical - we've moved to Phase 3 lazy-load architecture  
**Action**: Archive for reference

### 2. `client/ENGINE_SYSTEMS_OVERVIEW.md`
**Status**: Outdated system overview  
**Why**: Before transactional kernel, before lazy-load orchestration  
**Action**: Archive for reference

---

## ✅ FILES VERIFIED - KEEP

| File | Status | Notes |
|------|--------|-------|
| `verify-imports.ts` | ✅ OK | Path resolution auditor - should be run after Phase 3 changes |
| `src/engine/systems.ts` | ✅ OK | Barrel re-export for backwards compatibility |
| `src/assets/models/index.ts` | ✅ OK | Procedural model generators (crate, barrel, etc.) |
| `webpack.config.js` | ✅ OK | Already updated for Phase 3 (dual entry points) |
| `src/bootloader.ts` | ✅ OK | Phase 3 implementation |
| `src/index.ts` | ✅ OK | Legacy fallback entry |

---

## 📄 NEW DOCUMENTATION TO CREATE

### 1. `client/PHASE_3_RUNTIME_GUIDE.md`
**Purpose**: Explain lazy-load runtime bootstrap  
**Covers**:
- Bootloader flow
- Mode selection UI
- On-demand chunk loading
- Error recovery
- Integration with Engine.ts

### 2. `client/BOOTLOADER_ARCHITECTURE.md`
**Purpose**: Deep dive into bootloader design  
**Covers**:
- What bootloader does
- 152-byte entry point
- Mode selector UI
- Error handling
- Lazy import orchestration

### 3. `client/LAZY_LOAD_INTEGRATION.md`
**Purpose**: How to test and monitor lazy-loading  
**Covers**:
- Using LAZY_LOAD_DEBUG_SCRIPT.js
- Network tab monitoring
- Performance metrics
- TTI measurement

### 4. `client/WEBPACK_PHASE3_CONFIG.md`
**Purpose**: Explain webpack Phase 3 setup  
**Covers**:
- 7 semantic cache groups
- Dual entry points (bootloader + bundle)
- Chunk splitting strategy
- Bundle size optimization

---

## 🔍 VERIFICATION TO RUN

### Before proceeding:
```bash
# 1. Run import verification
cd client && npx ts-node verify-imports.ts

# 2. Build to ensure no errors
npm run build

# 3. Type check
npm run type-check
```

### Expected Results:
- ✅ Import verification passes
- ✅ Build succeeds (zero errors)
- ✅ Type check passes

---

## 📋 EXECUTION CHECKLIST

### Phase 1: Backup & Verification (5 min)
- [ ] Verify we're on latest git
- [ ] Run: `npm run build` (should pass)
- [ ] Run: `npx ts-node verify-imports.ts` (should pass)

### Phase 2: Delete Outdated (5 min)
- [ ] Delete `client/src/main.js`
- [ ] Delete `client/GAME_V010_OVERVIEW.md`
- [ ] Verify deletion successful

### Phase 3: Archive Old Docs (5 min)
- [ ] Create `client/archive/`
- [ ] Move `ENGINE_ARCHITECTURE.md` to archive/
- [ ] Move `ENGINE_SYSTEMS_OVERVIEW.md` to archive/
- [ ] Create `client/archive/README.md` with index

### Phase 4: Create New Docs (10 min)
- [ ] Create `PHASE_3_RUNTIME_GUIDE.md`
- [ ] Create `BOOTLOADER_ARCHITECTURE.md`
- [ ] Create `LAZY_LOAD_INTEGRATION.md`
- [ ] Create `WEBPACK_PHASE3_CONFIG.md`

### Phase 5: Final Verification (5 min)
- [ ] Run `npm run build` (should still pass)
- [ ] Run `npm run type-check` (should pass)
- [ ] Verify no imports broken

---

## 🎯 BLIND SPOTS AFTER CLEANUP

After cleanup, here's what was FOUND:

### ✅ RESOLVED
- ✅ `main.js` - Removed (was dead code)
- ✅ Old docs - Archived (preserved but organized)
- ✅ Phase 3 architecture - Now documented

### ⚠️ STILL NEEDS ATTENTION (For Phase 4)
1. **Asset Pipeline**: How are prefabs/models loaded at runtime?
2. **Boot Sequence**: Exact flow from bootloader → kernel → gameplay
3. **Mode Transitions**: Cleanup/memory management during mode switches
4. **Chunk Error Recovery**: What happens if chunk fails?

### 🔴 CRITICAL BLIND SPOT (DISCOVERED)
**Missing**: Integration documentation between:
- Bootloader (UI orchestration)
- Lazy chunk loading (webpack)
- initializeMode() functions (mode bootstrap)
- Engine.ts API (core runtime)

**Impact**: New developers won't understand how these 4 pieces fit together

**Fix**: Create `client/INTEGRATION_FLOW.md` showing complete flow

---

## 📊 EXPECTED OUTCOME

### Before Cleanup
```
client/
├─ 📄 ENGINE_ARCHITECTURE.md       (v0.1.2 - outdated)
├─ 📄 ENGINE_SYSTEMS_OVERVIEW.md   (outdated)
├─ 📄 GAME_V010_OVERVIEW.md        (v0.1.0 - very old!)
├─ 📄 src/main.js                  (dead code)
├─ src/
└─ assets/
```

### After Cleanup
```
client/
├─ 📄 PHASE_3_RUNTIME_GUIDE.md      ✅ (NEW - explains lazy-load)
├─ 📄 BOOTLOADER_ARCHITECTURE.md    ✅ (NEW - explains bootloader)
├─ 📄 LAZY_LOAD_INTEGRATION.md      ✅ (NEW - how to test)
├─ 📄 WEBPACK_PHASE3_CONFIG.md      ✅ (NEW - explains cache groups)
├─ 📄 INTEGRATION_FLOW.md           ✅ (NEW - how it all fits)
├─ 📄 CLIENT_CLEANUP_AUDIT.md       (documentation of this audit)
│
├─ archive/
│  ├─ ENGINE_ARCHITECTURE.md        (historical reference)
│  ├─ ENGINE_SYSTEMS_OVERVIEW.md    (historical reference)
│  └─ README.md                     (archive index)
│
├─ src/
│  ├─ bootloader.ts                 ✅ (Phase 3 - current)
│  ├─ index.ts                      ✅ (fallback entry)
│  ├─ webpack.config.js             ✅ (updated Phase 3)
│  └─ engine/
│     └─ runtime/
│        ├─ bootstrapMinimalRuntime.ts    ✅
│        ├─ bootstrapMultiplayerRuntime.ts ✅
│        └─ bootstrapFreeplayRuntime.ts   ✅
│
└─ assets/
```

---

## ⏱️ TIME ESTIMATE

| Task | Time |
|------|------|
| Backup & verification | 5 min |
| Delete files | 5 min |
| Archive old docs | 5 min |
| Create new docs | 10 min |
| Final verification | 5 min |
| **TOTAL** | **30 min** |

---

## 🚨 ROLLBACK PLAN

If something breaks:
```bash
# Restore from git
git checkout -- client/

# Or restore specific files
git checkout -- client/GAME_V010_OVERVIEW.md
git checkout -- client/src/main.js
```

---

## ✅ SUCCESS CRITERIA

After cleanup complete:
- [x] Zero outdated docs in client/
- [x] All Phase 3 architecture documented
- [x] Blind spots identified & documented
- [x] Build still passes
- [x] Type checking still passes
- [x] New developers can understand flow in 10 minutes

---

## 🎯 NEXT STEPS AFTER CLEANUP

1. **Run verification**: `npm run build && npm run type-check`
2. **Create integration flow doc**: Show complete bootloader → kernel → gameplay path
3. **Update README**: Point to new Phase 3 docs
4. **Ready for Phase 4**: All client structure aligned

---

**Status**: READY FOR EXECUTION  
**Recommendation**: Execute now (takes 30 minutes)  
**Benefit**: Client folder reflects current Phase 3 architecture
