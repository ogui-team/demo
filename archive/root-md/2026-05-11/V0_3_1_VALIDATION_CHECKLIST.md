# v0.3.1 Validation Checklist

**Date:** April 18, 2026  
**Applies To:** Milestones 1–13  
**Status:** Reference implementation

---

## Walkthrough Status (May 11, 2026)

This section summarizes the latest known execution state while preserving the original checklist below.

- Type-check (client): PASS (`npm run type-check --prefix client`)
- Type-check (server): PASS (`npm run type-check --prefix server`)
- Targeted SDK plugin test: PASS (`test/sdk/PluginSystem.test.ts`, 6/6)
- External consumer smoke tests: PASS (`sandbox-test` Empty + Zombie plugin runs)
- Build status: PASS with existing webpack size warnings (no new blocker identified in this pass)
- Tier0 browser gate run (`window.__runTier0Tests()`): NOT RE-EXECUTED in this cleanup pass, last known baseline remained green in prior milestone runs

---

## 📋 MILESTONE COMPLETION CHECKLIST

Every milestone must satisfy this checklist before being marked COMPLETE.

---

## ✅ UNIVERSAL CHECKS (All Milestones)

### Type Safety
- [ ] Run `npm run type-check`
- [ ] Result: PASSING (zero errors)
- [ ] All new files use TypeScript strict mode
- [ ] No `any` types without `// @ts-ignore` comment with reason

### Tier0 Validation
- [ ] Run `window.__runTier0Tests()` in browser console
- [ ] Result: 19/19 tests passing
- [ ] No regression from baseline
- [ ] All gate results unchanged (Gate 1A, Tier0A-E)

### Build Status
- [ ] Run `npm run build`
- [ ] Result: Warnings ≤ baseline (note any new warnings)
- [ ] Bundle size reported (should be stable or smaller)
- [ ] No compilation errors

### Code Quality
- [ ] No new `console.error` without corresponding fix
- [ ] All `console.log` statements are properly namespaced (`[Component]`, `[System]`)
- [ ] No commented-out code unless clearly labeled `TODO` with JIRA ticket
- [ ] File formatted (VS Code Format Document)

---

## ✅ MILESTONES 1–5: BOOTSTRAP ARCHITECTURE

### Idempotency Validation

**Run bootstrap 3 times and validate:**

```javascript
// In browser console, after opening the game

// RUN 1
console.log('RUN 1: Opening game')
// Game loads

// Manually reload page (Cmd+R or Ctrl+R)
// Game loads again

// Manually reload page one more time
// Game loads again

// Now check for duplication
window.__engine.registry.getAllSystems().size
// Should be same number each time (e.g., 50)

// Check for memory growth
console.log(performance.memory)
```

**Expected:**
- Same system count after each run (no duplication)
- Memory increase < +2MB per run
- No console errors about duplicate systems

### Phase Contract Validation (Milestones 1-4)

Each milestone phase must:

- [ ] Be a pure function (no side effects outside return)
- [ ] Accept BootstrapPhaseContext parameter
- [ ] Return PhaseResult { systems, dispose() }
- [ ] Have a dispose() method that cleans up all systems
- [ ] Have stable system IDs (same each run)
- [ ] All systems registered via kernel.registry

**Verification:**
```typescript
// In code, check Phase 3 signature
function Phase3_GameplayRuntime(ctx: BootstrapPhaseContext): PhaseResult {
  // ✅ All requirements met
}
```

### System Disposal Validation (Milestones 1-4)

After each phase migration:

```javascript
// Check that systems have dispose methods
const systems = window.__engine.registry.getAllSystems()
for (const [id, system] of systems) {
  if (!system.dispose) {
    console.error(`System "${id}" has no dispose() method`)
  }
}
// Should have zero errors
```

### Event Listener Cleanup (Milestone 5)

**Before Phase Reload:**
```javascript
const beforeCount = window.__engine.eventBus.listenerCount?.() || 
                   window.__engine.eventBus.listeners?.length
console.log(`Listeners before: ${beforeCount}`)
```

**After Phase Reload:**
```javascript
await window.__reloadPhase('phase3')
const afterCount = window.__engine.eventBus.listenerCount?.() || 
                   window.__engine.eventBus.listeners?.length
console.log(`Listeners after: ${afterCount}`)

// Should be same or lower (not accumulating)
```

### Testing Framework Validation (Milestone 5)

- [ ] `client/src/engine/runtime/bootstrap/__tests__/phases.test.ts` exists
- [ ] 8+ phase tests pass
- [ ] Each phase tested in isolation
- [ ] Idempotency tests included (run phase 3x)
- [ ] Memory tests included (< +2MB per run)
- [ ] All phase contract requirements tested

**Run:**
```bash
npm test -- phases.test.ts
# Expected: All tests PASS
```

---

## ✅ MILESTONES 6–10: SHARED CONTRACTS

### Package Structure (Milestone 6)

- [ ] `packages/shared-contracts/` directory exists
- [ ] `packages/shared-contracts/package.json` exists
- [ ] `packages/shared-contracts/tsconfig.json` (strict mode)
- [ ] Subdirectories exist:
  - [ ] `src/network/`
  - [ ] `src/game/`
  - [ ] `src/geometry/`
- [ ] `src/index.ts` exports public API
- [ ] Root `package.json` includes in workspaces
- [ ] `npm install` includes shared-contracts
- [ ] Import works: `import { ... } from '@shared/contracts'`

### Type Extraction Validation (Milestones 7-9)

**Per batch checklist:**

- [ ] Types extracted to shared package
- [ ] Old import locations updated (10-20 files per batch)
- [ ] Type-check passes (must be strict mode)
- [ ] Tier0 tests pass (19/19)
- [ ] No new build warnings
- [ ] No duplicate type definitions
- [ ] No breaking changes to runtime behavior

**Batch Completion Example:**

```bash
# After extracting network messages (Batch 1 of 7)

npm run type-check
# ✅ PASSING

window.__runTier0Tests()
# ✅ 19/19 passing

npm run build
# ✅ Warnings: 0

# Check: No duplicate types
grep -r "interface NetworkMessage" client/
grep -r "interface NetworkMessage" packages/shared-contracts/
# Should only be in packages/shared-contracts/
```

### Shared Package Complete (Milestone 10)

- [ ] All network types exported from `@shared/contracts/network`
- [ ] All game types exported from `@shared/contracts/game`
- [ ] All geometry types exported from `@shared/contracts/geometry`
- [ ] Public API in `packages/shared-contracts/src/index.ts`
- [ ] README with usage examples
- [ ] Type-check passes everywhere
- [ ] Build produces package
- [ ] Zero duplicate types across client/server
- [ ] Tier0 tests still pass (19/19)

**Verification:**
```bash
# Check for duplicates
find client/src -name "*.ts" -exec grep -l "interface Vector3" {} \;
# Should only be in @shared/contracts, not client/src

# Same for server
find server/src -name "*.ts" -exec grep -l "interface Vector3" {} \;
# Should only be in @shared/contracts, not server/src
```

---

## ✅ MILESTONES 11–13: POLISH & INFRASTRUCTURE

### Webpack Cleanup (Milestone 11)

- [ ] Run `npm run build` and count warnings
- [ ] Document current warning count (e.g., 3 warnings)
- [ ] Identify each warning and add to issue tracker
- [ ] Fix warnings one-by-one
- [ ] Final: `npm run build` shows 0 warnings
- [ ] Type-check passes
- [ ] Tier0 tests pass (19/19)

### Server Domain Boundaries (Milestone 12)

- [ ] `server/src/domains.ts` or `server/src/DOMAIN_RULES.ts` created
- [ ] Documents which files/modules belong to each domain:
  - [ ] Session domain
  - [ ] Collision domain
  - [ ] Gameplay domain
  - [ ] Network domain
  - [ ] Movement domain
- [ ] Cross-domain imports forbidden (with rare exceptions documented)
- [ ] Enforcement tests created:
  ```typescript
  // client/src/engine/__tests__/domainBoundaries.test.ts
  it('prevents session → collision imports', () => {
    // Verify no imports from collision in session files
  })
  ```
- [ ] Type-check passes
- [ ] Tier0 tests pass (19/19)

### Developer Workflow (Milestone 13)

- [ ] Scripts in `package.json` for common tasks:
  ```json
  {
    "dev:client": "...",
    "dev:server": "...",
    "validate": "npm run type-check && npm run build && npm test",
    "test:tier0": "open browser with tests",
    "test:phase": "npm test -- phases.test.ts",
    "reset:env": "clean and reinstall"
  }
  ```
- [ ] `scripts/setup.sh` or `scripts/setup.ps1` for first-time setup
- [ ] `docs/GETTING_STARTED.md` updated with new workflow
- [ ] On-boarding time < 5 minutes for new developer
- [ ] Type-check passes
- [ ] Tier0 tests pass (19/19)

**Test onboarding:**
```bash
# First-time developer runs:
npm run setup
npm run dev

# Expected: Game runs in browser within 2 minutes
```

---

## 🔴 FAILURE CRITERIA (Halt & Debug)

If ANY of these occur, STOP and investigate:

### Type-Check Failures
```
❌ STOP: npm run type-check shows errors
Action: Fix errors before proceeding
```

### Tier0 Test Regression
```
❌ STOP: window.__runTier0Tests() shows < 19/19 passing
Action: Debug which gate failed and why
```

### Memory Growth > +3MB
```
❌ STOP: Memory increases by more than 3MB per bootstrap
Action: Run heap snapshot, identify which system is leaking
```

### Duplicate System IDs
```
❌ STOP: window.__engine.registry.getAllSystems() shows duplicates
Action: Check idempotency - which phase is creating duplicates?
```

### Build Fails or Major New Warnings
```
❌ STOP: npm run build produces errors or new warnings
Action: Fix all errors and document warnings
```

---

## 📊 VALIDATION COMMANDS (COPY-PASTE)

### Run Full Validation Suite

```bash
# Type-check
npm run type-check

# Build
npm run build

# Run (in browser console after game loads)
window.__runTier0Tests()

# Memory baseline
console.log(performance.memory)

# Idempotency test
await window.__reloadPhase('phase3')
await window.__reloadPhase('phase3')
console.log(window.__engine.registry.getAllSystems().size)

# System diagnostics
window.__engine.registry.printDiagnostics()
```

### Quick Pass/Fail Check

```bash
# All-in-one: If all pass, milestone is good
npm run type-check && npm run build && echo "✅ BUILD PASSED"

# Then in browser:
const tests = await new Promise(r => {
  window.__runTier0Tests?.then?.(r) || 
  (console.log('waiting...'), setTimeout(r, 2000))
})
// Should show: ✅ 19/19 passing
```

---

## 📝 MILESTONE SIGN-OFF TEMPLATE

**When completing each milestone:**

```markdown
## ✅ Milestone N: [Name]

**Completed:** [Date]

**Type-Check:** PASSING ✅
**Build:** SUCCESS ✅ (0 new warnings)
**Tier0 Tests:** 19/19 PASSING ✅
**Idempotency:** VERIFIED ✅ (3 runs, no duplication)
**Memory:** < +2MB ✅
**Code Review:** [APPROVED/PENDING]

**Changes Summary:**
- [File 1] - [Brief description]
- [File 2] - [Brief description]

**Notes:**
- [Any issues encountered and resolved]

**Next Milestone Blocker Resolved:**
- [What this milestone unblocks]
```

---

## 🚀 GO/NO-GO FOR v0.3.1 RELEASE

All milestones complete IF:

- ✅ Milestones 1–13 all signed off
- ✅ Type-check: PASSING (zero errors)
- ✅ Tier0 tests: 19/19 PASSING
- ✅ Build: ZERO new warnings
- ✅ Bootstrap phases: All 6 follow contract
- ✅ System Registry: Integrated and tested
- ✅ Shared contracts package: Production-ready
- ✅ Developer workflow: < 5 min onboarding
- ✅ Memory: No growth > +2MB per bootstrap
- ✅ No duplicate systems after 3 reloads

**Then:** v0.3.1 released, ready for v0.4.0 multiplayer work 🚀
