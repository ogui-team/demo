# MILESTONE 1️⃣ - PHASE 3 MIGRATION (MICRO EXECUTION)

**Date:** April 18, 2026  
**Status:** Ready to start  
**Mode:** Micro execution loop (test after every block)  
**Tokens:** Optimized (no big prompts, only code + small tests)

---

## 🚨 HARD STOP CONDITIONS (MANDATORY)

**STOP immediately and fix if:**
- ❌ Same system instantiated twice
- ❌ Memory increases after re-run
- ❌ Type-check shows new errors
- ❌ Bootstrap logs duplicate initialization
- ❌ Phase 3 runs differently on 2nd call

Do NOT proceed until resolved.

---

## 🎯 MILESTONE 1️⃣ OBJECTIVE

Move all gameplay system instantiation into `Phase3_GameplayRuntime()` function

**Deliverable:** Phase 3 function implements PhaseResult contract + returns all systems + disposable

---

## 📋 PHASE 3 CONTRACT (MUST SATISFY)

Every system moved to Phase 3 must follow this pattern:

```typescript
// client/src/engine/runtime/bootstrap/phases.ts

export function Phase3_GameplayRuntime(ctx: BootstrapPhaseContext): PhaseResult {
  // 1. Create all systems
  // 2. Initialize each with context
  // 3. Collect into map with stable IDs
  // 4. Return PhaseResult with dispose method
  
  const systems = {
    physics: physicsSystem,
    health: healthSystem,
    // ... all 10 systems
  }
  
  return {
    systems,
    dispose: () => {
      Object.values(systems).forEach(s => s.dispose?.())
    }
  }
}
```

**Key Requirements:**
1. ✅ Pure function (no hidden globals)
2. ✅ Return PhaseResult with all systems
3. ✅ Dispose method cleans up all systems
4. ✅ Idempotent (safe to run multiple times)

---

## 📚 SYSTEMS TO MOVE (10 TOTAL)

| # | System | Current File | Status |
|---|--------|--------------|--------|
| 1 | PhysicsSystem | bootstrapClientRuntime | Ready |
| 2 | HealthSystem | bootstrapClientRuntime | Ready |
| 3 | WeaponSystem | bootstrapClientRuntime | Ready |
| 4 | AbilitySystem | bootstrapClientRuntime | Ready |
| 5 | CharacterActorSystem | bootstrapClientRuntime | Ready |
| 6 | ObjectCreatorSystem | bootstrapClientRuntime | Ready |
| 7 | PrefabSystem | bootstrapClientRuntime | Ready |
| 8 | SpawnSystem | bootstrapClientRuntime | Ready |
| 9 | PlayerModelSystem | bootstrapClientRuntime | Ready |
| 10 | MenuIdentitySystem | bootstrapClientRuntime | Ready |

---

## 🔧 MICRO EXECUTION - 3 CORE BLOCKS

### 🔹 BLOCK 1: SYSTEM REGISTRY (Isolated)

**Goal:** Create & test SystemRegistry independently (no Phase yet)

**Files:**
- Create: `client/src/engine/kernel/SystemRegistry.ts`
- Copy: Full implementation from SYSTEM_REGISTRY_IMPLEMENTATION.md (~150 lines)

**Test:**
```bash
npm run type-check
# Expected: PASSING (zero errors)
```

**Verify:**
- [ ] File created
- [ ] Type-check passes
- [ ] No new warnings

**Lock:** Stop here if any type-check errors. Fix immediately.

---

### 🔹 BLOCK 2: PHASE 3 FUNCTION (Isolated Creation)

**Goal:** Create Phase3_GameplayRuntime() function (don't integrate yet)

**File:** `client/src/engine/runtime/bootstrap/phases.ts`

**Create function (template):**
```typescript
export function Phase3_GameplayRuntime(ctx: BootstrapPhaseContext): PhaseResult {
  const systems = {
    physics: new PhysicsSystem(),
    health: new HealthSystem(),
    weapon: new WeaponSystem(),
    ability: new AbilitySystem(),
    characterActor: new CharacterActorSystem(),
    objectCreator: new ObjectCreatorSystem(),
    prefab: new PrefabSystem(),
    spawn: new SpawnSystem(),
    playerModel: new PlayerModelSystem(),
    menuIdentity: new MenuIdentitySystem(),
  }
  
  return {
    systems,
    dispose: () => {
      Object.values(systems).forEach(s => s.dispose?.())
    }
  }
}
```

**Test:**
```bash
npm run type-check
# Expected: PASSING (zero errors)
```

**Verify:**
- [ ] Function created
- [ ] Type-check passes
- [ ] No new warnings

**Lock:** Stop here if any type-check errors. Fix immediately.

---

### 🔹 BLOCK 3: INTEGRATION (Bootstrap + Idempotency)

**Goal:** Replace bootstrap Phase 3 call with registry registration + test idempotency

**File:** `client/src/engine/runtime/bootstrapClientRuntime.ts`

**Find current Phase 3 section:**
```typescript
// OLD: Find this
const phase3Result = Phase3_GameplayRuntime(ctx)
// ... or whatever current code is
```

**Replace with:**
```typescript
const phase3Result = Phase3_GameplayRuntime(ctx)
Object.entries(phase3Result.systems).forEach(([id, system]) => {
  ctx.engine.registry.registerSystem(id, system, 'phase3')
})
```

**Test:**
```bash
npm run type-check
npm run build
# Expected: PASSING, no new warnings
```

**Idempotency Test (Browser Console):**
```javascript
// After bootstrap completes
const before = window.__engine.registry.getAllSystems().size
console.log(`Systems: ${before}`)

// Reload page
// (Page reloads, bootstrap runs again)

const after = window.__engine.registry.getAllSystems().size
console.log(`Systems: ${after}`)

// Expected: before === after (no duplication)
```

**Verify:**
- [ ] Type-check passes
- [ ] Build passes (≤ 5 warnings)
- [ ] Tier0 tests pass (19/19) - run `window.__runTier0Tests()`
- [ ] No duplicate system logs in console
- [ ] Memory stable after 2 page reloads

**Lock:** If ANY check fails, stop and fix before continuing.

---

## ✅ SUCCESS SNAPSHOT (After Milestone 1)

**Phase 3 Function:**
- ✅ Returns `systems` object (10 systems)
- ✅ Returns `dispose()` method
- ✅ Can be called 2x without side effects

**Engine Registry:**
- ✅ Systems registered via `registry.registerSystem()`
- ✅ No direct instantiation in main bootstrap
- ✅ All systems have stable IDs

**Runtime Behavior:**
- ✅ No duplicate "Registered system" logs
- ✅ No memory growth between bootstrap runs
- ✅ Tier0 tests unchanged (19/19 passing)
- ✅ Build warning count unchanged (≤ 5)

**If all above verified:** ✅ MILESTONE 1 COMPLETE
