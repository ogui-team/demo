## Active Execution Scope (Post-Audit)

Completed milestones and completed checklist items are archived in `ARCHIVE_COMPLETED.md`.
This document now tracks only outstanding work for execution.

### Outstanding Now

- [ ] Run `window.__runTier0Tests()` and confirm 19/19 with captured output log.
- [ ] Run 3x bootstrap idempotency pass and confirm no duplicate system IDs.
- [ ] Capture memory before/after 3x bootstrap and confirm growth < +2 MB.
- [ ] Complete Phase 6 extraction and verify coordinator wiring contract end-to-end.
- [ ] Add bootstrap phase contract tests (Phase 3-6): creation, dispose, idempotency.
- [ ] Continue shared contracts extraction in small batches:
  - [ ] network message/payload contracts
  - [ ] snapshot contracts
  - [ ] game-state contracts
  - [ ] geometry contract rollout beyond `Vec3`
- [ ] Verify no listener accumulation during phase reload (`__reloadPhase`).

---

## 🧠 GLOBAL EXECUTION RULES (MANDATORY)

All milestones must satisfy:

- No increase in memory baseline after execution
- No duplicate system instances allowed
- No new event listeners without cleanup tracking
- All systems must be registered AND disposable via kernel lifecycle

Validation required after EACH milestone:

- Run Tier0 tests (19/19)
- Run memory snapshot before/after
- Run bootstrap twice (detect duplicate instantiation)

---

## 🏗️ PHASE ARCHITECTURE CONTRACT (v0.3.1 FOUNDATION)

All bootstrap phases (3–6) MUST implement this contract:

```typescript
// Defines what every phase must return
interface PhaseResult {
  systems: Record<string, System>      // All created systems
  dispose(): void                      // Clean up phase systems
}

// Every phase is a pure function with this signature
type BootstrapPhase = (context: BootstrapPhaseContext) => PhaseResult

// Phase 3: Gameplay Systems
function Phase3_GameplayRuntime(ctx: BootstrapPhaseContext): PhaseResult {
  const systems = {
    physics: new PhysicsSystem(),
    health: new HealthSystem(),
    weapon: new WeaponSystem(),
    ability: new AbilitySystem(),
    // ... 10 total gameplay systems
  }
  return {
    systems,
    dispose: () => {
      Object.values(systems).forEach(s => s.dispose?.())
    }
  }
}
```

**Requirements:**

1. **Pure Function**: No hidden global side effects
2. **Explicit Returns**: All created systems in PhaseResult
3. **Dispose Method**: Can clean up all phase systems
4. **Idempotent**: Safe to run 2-3 times (no duplication)
5. **Registered**: All systems go through System Registry (see below)

**Benefits:**
- ✅ Hot reload phase without losing state
- ✅ Swap systems at runtime (testing, streaming)
- ✅ Test phase in isolation
- ✅ Memory safe (detect leaks)

---

## 🔄 SYSTEM REGISTRY (SWAP LAYER)

The kernel must support runtime system replacement:

```typescript
interface SystemRegistry {
  // Register a new system or replace existing
  registerSystem(id: string, system: System): void
  
  // Swap a system atomically (dispose old, register new)
  replaceSystem(id: string, newSystem: System): void
  
  // Remove a system (dispose it)
  removeSystem(id: string): void
  
  // Get a system by ID
  getSystem(id: string): System | null
  
  // Get all systems (read-only snapshot)
  getAllSystems(): Record<string, System>
}
```

**Constraints:**
- Systems identified by stable IDs (e.g., "physics", "health")
- Replacing atomically disposes old system first
- No direct system-to-system instantiation
- Registry is authoritative source of truth

**Usage (Phase Registration):**
```typescript
const phase3Result = Phase3_GameplayRuntime(ctx)
Object.entries(phase3Result.systems).forEach(([id, system]) => {
  kernel.registry.registerSystem(id, system)
})
```

---

## 🔥 HOT RELOAD FLOW (MINIMAL)

To reload a single phase safely:

```typescript
async function reloadPhase(phaseId: 'phase3' | 'phase4' | 'phase5' | 'phase6') {
  // 1. Dispose all systems from this phase
  const systemIds = getSystemIdsByPhase(phaseId)
  systemIds.forEach(id => kernel.registry.removeSystem(id))
  
  // 2. Re-run phase function
  const context = buildPhaseContext(kernel)
  const phaseResult = phaseMap[phaseId](context)
  
  // 3. Re-register all systems
  Object.entries(phaseResult.systems).forEach(([id, system]) => {
    kernel.registry.registerSystem(id, system)
  })
  
  // 4. Reconnect phase listeners (game continues running)
  // NOTE: Game state persists, only logic reloads
}
```

**Constraints:**
- Must NOT reset global game state
- Must NOT duplicate systems or listeners
- Must NOT break in-flight network requests
- Phase reload ≠ full bootstrap

---

## 💾 STATE VS SYSTEM SEPARATION

**Critical Rule for Hot Reload:**

```
Systems = Logic Only (disposable)
State = Persistent Data (survives reload)
```

**Example:**
- Physics **system** (disposable) ← logic
- Game **state** (persistent) ← entity data, scores, etc.

Reloading Phase 3 must NOT wipe:
- Entity data
- Player scores
- World state
- Network connections

Only reload the logic layer (systems and their methods).

---

## 🎯 EVENT SYSTEM SAFETY

All event listeners must track ownership:

```typescript
// Register listener WITH ownership tracking
interface TrackedListener {
  systemId: string      // Which system owns this
  phaseId: string       // Which phase owns this
  listener: Function
}

// On phase reload, remove all listeners from that phase
function removePhaseListeners(phaseId: string) {
  gameBus.listeners
    .filter(l => l.phaseId === phaseId)
    .forEach(l => gameBus.removeListener(l.listener))
}
```

**Benefits:**
- ✅ No dangling listeners after reload
- ✅ No double-firing events
- ✅ Clean state between reloads

---

## ⚡ EFFICIENCY CONSTRAINTS (MANDATORY)

Before adding ANY logic to Milestones 1–4:

**ONLY implement if:**
- ✅ Prevents real failure (memory leak, duplication, crash)
- ✅ Enables hot reload / streaming directly

**DO NOT:**
- ❌ Introduce heavy abstractions
- ❌ Refactor unrelated systems
- ❌ Add speculative architecture

**Surgical changes only.**

---

# v0.3.1 Milestone Efficiency Plan

**Current Version:** v0.3.0 (Released April 18, 2026) ✅  
**Next Version:** v0.3.1 (Incremental Foundation Work)  
**Planning Model:** Milestone Efficiency (Deliverables, not Hours)

---

## 🎯 v0.3.1 Strategic Direction

**Goal:** Deepen and strengthen the v0.3.0 foundation by completing half-finished infrastructure and preparing for v0.4.0 multiplayer scale.

**Not:** A feature release. No new gameplay.  
**Is:** Technical depth, stability, and automation.

---

## 📦 Milestone Map (Dependency-Ordered)

### MILESTONE 0️⃣: Pre-Work Validation
**Deliverable:** Validate current v0.3.0 state and identify migration friction points

**Checklist:**
- [ ] Run all 19 Tier0 tests in fresh environment (`window.__runTier0Tests()`)
- [ ] Identify which bootstrap phases still contain inline system creation
- [ ] Map all system instantiation locations (currently scattered)
- [ ] List all client-side dynamic imports causing Webpack warnings
- [ ] Document current server domain boundaries
- [ ] Identify shared types duplicated between client/server

**Completion Criteria:** Blockers inventory + friction points documented  
**Blocks:** All downstream milestones

---

### MILESTONE 1️⃣: Bootstrap Phase 3 Migration (Gameplay Systems)
**Deliverable:** Move all gameplay system instantiation into `Phase3_GameplayRuntime()`

**Current State:** Systems created in main `bootstrapClientRuntime()`, scattered across ~150 lines  
**Target State:** Phase 3 implements PhaseResult contract + returns all systems + disposable + idempotent

**Phase 3 Contract (MUST SATISFY):**
```typescript
function Phase3_GameplayRuntime(ctx: BootstrapPhaseContext): PhaseResult {
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
    dispose: () => Object.values(systems).forEach(s => s.dispose?.())
  }
}
```

**Scope:**
- [ ] Create Phase 3 function following contract (pure, return PhaseResult, dispose method)
- [ ] Move PhysicsSystem creation into Phase 3
- [ ] Move HealthSystem creation into Phase 3
- [ ] Move WeaponSystem creation into Phase 3
- [ ] Move AbilitySystem creation into Phase 3
- [ ] Move CharacterActorSystem creation into Phase 3
- [ ] Move ObjectCreatorSystem creation into Phase 3
- [ ] Move PrefabSystem creation into Phase 3
- [ ] Move SpawnSystem creation into Phase 3
- [ ] Move PlayerModelSystem creation into Phase 3
- [ ] Move MenuIdentitySystem creation into Phase 3
- [ ] Update main bootstrap to register Phase 3 systems via kernel.registry
- [ ] **IDEMPOTENCY CHECK:** Run Phase 3 twice, verify no duplicate system instances
- [ ] **MEMORY CHECK:** After 2x run, memory increase < +2MB
- [ ] Run Tier0 tests (19/19 must pass)
- [ ] Type-check passes with zero errors

**Completion Criteria:**
- [ ] Phase 3 is pure function (no hidden globals)
- [ ] Phase 3 returns PhaseResult with all systems
- [ ] Phase 3 has dispose() that cleans up all systems
- [ ] Main bootstrap calls Phase 3 and registers results via kernel.registry
- [ ] Phase 3 testable in isolation (for Milestone 5)
- [ ] Zero new warnings/errors
- [ ] Tier0 tests still pass
- [ ] No memory growth after 2 bootstrap runs

**Blocks:** Phase 4 & 5 migrations, testing framework

---

### MILESTONE 2️⃣: Bootstrap Phase 4 Migration (Networking Systems)
**Deliverable:** Move all networking system instantiation into `Phase4_NetworkingRuntime()`

**Phase 4 Contract (MUST SATISFY):**
```typescript
function Phase4_NetworkingRuntime(ctx: BootstrapPhaseContext): PhaseResult {
  const systems = {
    multiplayerClient: new MultiplayerClient(),
    collisionAuthority: new CollisionAuthoritySystem(),
    // NetworkSyncSystem, ReplicationSystem already in kernel
  }
  return {
    systems,
    dispose: () => Object.values(systems).forEach(s => s.dispose?.())
  }
}
```

**Scope:**
- [ ] Create Phase 4 function following contract (pure, return PhaseResult, dispose method)
- [ ] Move MultiplayerClient creation → Phase 4
- [ ] Move CollisionAuthoritySystem creation → Phase 4
- [ ] Verify NetworkSyncSystem already available from kernel
- [ ] Verify ReplicationSystem already available from kernel
- [ ] Phase 4 validates network systems are ready and accessible
- [ ] Update main bootstrap to call Phase 4 and register results
- [ ] **IDEMPOTENCY CHECK:** Run Phase 4 twice, verify no duplicate instances
- [ ] **MEMORY CHECK:** After 2x run, memory increase < +2MB
- [ ] Run Tier0 tests (19/19 must pass)
- [ ] Type-check passes with zero errors

**Completion Criteria:**
- [ ] Phase 4 is pure function
- [ ] Phase 4 returns PhaseResult with networking systems
- [ ] Phase 4 has dispose() for cleanup
- [ ] All multiplayer systems accessible and initialized
- [ ] Phase 4 testable in isolation (for Milestone 5)
- [ ] Zero new warnings/errors
- [ ] Tier0 tests still pass
- [ ] No memory growth after 2 bootstrap runs

**Blocks:** Phase 5, Testing Framework, v0.4.0 multiplayer work

---

### MILESTONE 3️⃣: Bootstrap Phase 5 Migration (UI Systems)
**Deliverable:** Move all UI system instantiation into `Phase5_UIRuntime()`

**Phase 5 Contract (MUST SATISFY):**
```typescript
function Phase5_UIRuntime(ctx: BootstrapPhaseContext): PhaseResult {
  const systems = {
    hud: new HUDSystem(),
    inventory: new InventorySystem(),
    inventoryGridUI: new InventoryGridUI(),
    inGameModePanel: new InGameModePanel(),
    weaponPresentation: new WeaponPresentationSystem(),
    debugOverlay: new DebugOverlaySystem(),
  }
  return {
    systems,
    dispose: () => Object.values(systems).forEach(s => s.dispose?.())
  }
}
```

**Scope:**
- [ ] Create Phase 5 function following contract (pure, return PhaseResult, dispose method)
- [ ] Move HUDSystem creation → Phase 5
- [ ] Move InventorySystem creation → Phase 5
- [ ] Move InventoryGridUI initialization → Phase 5
- [ ] Move InGameModePanel initialization → Phase 5
- [ ] Move WeaponPresentationSystem creation → Phase 5
- [ ] Move debug overlay systems → Phase 5
- [ ] Phase 5 validates all UI ready and initialized
- [ ] Update main bootstrap to call Phase 5 and register results
- [ ] **IDEMPOTENCY CHECK:** Run Phase 5 twice, verify no duplicate instances
- [ ] **MEMORY CHECK:** After 2x run, memory increase < +2MB
- [ ] Run Tier0 tests (19/19 must pass)
- [ ] Type-check passes with zero errors

**Completion Criteria:**
- [ ] Phase 5 is pure function
- [ ] Phase 5 returns PhaseResult with UI systems
- [ ] Phase 5 has dispose() for cleanup
- [ ] UI initialization order correct
- [ ] Phase 5 testable in isolation (for Milestone 5)
- [ ] Zero new warnings/errors
- [ ] Tier0 tests still pass
- [ ] No memory growth after 2 bootstrap runs

**Blocks:** Phase 6, v0.4.0 UI work

---

### MILESTONE 4️⃣: Bootstrap Phase 6 Migration (Coordinator Wiring)
**Deliverable:** Move all coordinator creation and wiring into `Phase6_CoordinatorWiring()`

**Phase 6 Contract (MUST SATISFY):**
```typescript
function Phase6_CoordinatorWiring(ctx: BootstrapPhaseContext): PhaseResult {
  const systems = {
    gameLaunchCoordinator: new GameLaunchCoordinator(),
    sessionLifecycleCoordinator: new SessionLifecycleCoordinator(),
    clientWorldRuntimeCoordinator: new ClientWorldRuntimeCoordinator(),
    multiplayerRuntimeCoordinator: new MultiplayerRuntimeCoordinator(),
    runtimeDiagnosticsCoordinator: new RuntimeDiagnosticsCoordinator(),
    runtimeOverlayCoordinator: new RuntimeOverlayCoordinator(),
    lifecycleOrchestrator: new LifecycleOrchestrator(),
  }
  
  // All inter-coordinator wiring happens here
  systems.sessionLifecycleCoordinator.wire(systems.gameLaunchCoordinator)
  systems.clientWorldRuntimeCoordinator.wire(systems.sessionLifecycleCoordinator)
  // ... etc
  
  return {
    systems,
    dispose: () => Object.values(systems).forEach(s => s.dispose?.())
  }
}
```

**Scope:**
- [ ] Create Phase 6 function following contract (pure, return PhaseResult, dispose method)
- [ ] Move GameLaunchCoordinator creation → Phase 6
- [ ] Move SessionLifecycleCoordinator creation → Phase 6
- [ ] Move ClientWorldRuntimeCoordinator creation → Phase 6
- [ ] Move MultiplayerRuntimeCoordinator creation → Phase 6
- [ ] Move RuntimeDiagnosticsCoordinator creation → Phase 6
- [ ] Move RuntimeOverlayCoordinator creation → Phase 6
- [ ] Move LifecycleOrchestrator creation → Phase 6
- [ ] Move ALL inter-coordinator wiring logic → Phase 6
- [ ] Update main bootstrap to call Phase 6 and register results
- [ ] Main bootstrap now thin (~50 lines: call phases 1-6, enter ready state)
- [ ] **IDEMPOTENCY CHECK:** Run Phase 6 twice, verify no duplicate instances
- [ ] **MEMORY CHECK:** After 2x run, memory increase < +2MB
- [ ] **INTEGRATION CHECK:** Full game lifecycle works end-to-end (spawn → play → menu)
- [ ] Run Tier0 tests (19/19 must pass)
- [ ] Type-check passes with zero errors

**Completion Criteria:**
- [ ] Phase 6 is pure function
- [ ] Phase 6 returns PhaseResult with all coordinators
- [ ] Phase 6 has dispose() for cleanup
- [ ] All coordinators created and wired in Phase 6
- [ ] Main bootstrap reduced to thin orchestrator (~50 lines)
- [ ] Phase 6 testable in isolation (for Milestone 5)
- [ ] Full lifecycle works end-to-end
- [ ] Zero new warnings/errors
- [ ] Tier0 tests still pass
- [ ] No memory growth after 2 bootstrap runs

**Blocks:** Testing Framework, v0.4.0, refactoring cleanups

---

### MILESTONE 5️⃣: Bootstrap Testing Framework
**Deliverable:** Create automated tests for each bootstrap phase (validates contract compliance)

**Scope:**
- [ ] Create `client/src/engine/runtime/bootstrap/__tests__/phases.test.ts`
- [ ] Test Phase 1 validation (catches missing systems)
- [ ] Test Phase 2 rendering setup (Three.js, camera, renderer)
- [ ] Test Phase 3 returns PhaseResult with all 10 gameplay systems
- [ ] Test Phase 3 dispose() cleans up all systems
- [ ] Test Phase 3 idempotency (can call twice without duplication)
- [ ] Test Phase 4 returns PhaseResult with networking systems
- [ ] Test Phase 4 dispose() cleans up correctly
- [ ] Test Phase 4 idempotency
- [ ] Test Phase 5 returns PhaseResult with UI systems
- [ ] Test Phase 5 dispose() cleans up correctly
- [ ] Test Phase 5 idempotency
- [ ] Test Phase 6 creates all coordinators
- [ ] Test Phase 6 wiring is correct (coordinators can communicate)
- [ ] Test Phase 6 dispose() cleans up correctly
- [ ] Test Phase 6 idempotency
- [ ] Test full `executeBootstrapPhases()` end-to-end
- [ ] Each phase independently testable with mocks
- [ ] Verify Tier0 tests still pass after testing framework is added

**Completion Criteria:**
- [ ] Phase tests exist and pass (8+ tests)
- [ ] Each phase independently testable
- [ ] Idempotency validated for all phases (3 runs, no duplication)
- [ ] Memory checked after tests (< +2MB growth)
- [ ] Build includes test suite

**Blocks:** v0.4.0, Phase 4 (multiplayer stress testing)

---

## ✅ VALIDATION FRAMEWORK (AFTER EACH MILESTONE)

After completing Milestones 1–5 (bootstrap architecture):

### Memory Validation
```
Before: Capture heap size (Chrome DevTools → Memory → Take heap snapshot)
Action: Run full bootstrap 3 times
After:  Capture heap size again
Check:  Final - Initial < +2 MB (allow for variance)
```

### Idempotency Validation
```
Run this sequence:
1. Full bootstrap → capture system IDs
2. Full bootstrap again → verify same IDs, no duplicates
3. Full bootstrap 3rd time → confirm stable
Check: No duplicate instances in registry
```

### System Duplication Check
```
function validateNoSystemDuplication() {
  const systemIds = kernel.registry.getAllSystems()
  const uniqueIds = new Set(systemIds.keys())
  if (uniqueIds.size !== systemIds.size) {
    throw new Error('Duplicate system IDs detected!')
  }
}
```

### Event Listener Cleanup Check
```
Before: Count gameBus.listeners.length
Action: Phase reload (e.g., reloadPhase('phase3'))
After:  Count gameBus.listeners.length again
Check:  Should be same or lower (no accumulation)
```

### Tier0 Tests Unchanged
```
Always run: window.__runTier0Tests()
Expected: 19/19 passing
Failure: Indicates regression in core stability
```

### Type-Check Clean
```
npm run type-check
Expected: PASSING (zero errors)
```

### Build Clean
```
npm run build
Expected: Warnings = 0 (or same as baseline)
```

---

## 🔀 SHARED CONTRACTS MIGRATION STRATEGY (MILESTONES 7–9)

**Critical Rule:** Incremental extraction, validate after each batch

**Why:** Large type extractions can cause:
- Import circular dependencies
- Type conflicts (same name, different definition)
- Temporary duplication during transition
- TypeScript compilation failures

**Approach:**

1. **Batch Size:** 10–20 files per extraction batch
2. **After Each Batch:**
   - Type-check passes
   - Tier0 tests still pass (19/19)
   - No new warnings
   - Document what moved and why
3. **Allow Temporary Duplication:** During transition, old + new locations may coexist (will be cleaned after full extraction)
4. **No Full Rewrite:** Gradual imports update, not a one-shot replacement

**Example for Milestone 7 (Network Types):**
```
Batch 1: Extract 15 network message types
  → Type-check & test
  → Update 5 client files to import from shared
  → Type-check & test

Batch 2: Extract 15 more network types
  → Type-check & test
  → Update 5 more client files
  → Type-check & test

... continue batches until all 50+ client files updated
```

---

### MILESTONE 6️⃣: Shared Contracts Package Scaffolding
**Deliverable:** Create `packages/shared-contracts/` with initial structure

**Scope:**
- [ ] Create `packages/shared-contracts/` directory
- [ ] Create `packages/shared-contracts/package.json` with correct dependencies
- [ ] Create `packages/shared-contracts/tsconfig.json` (strict mode)
- [ ] Create `packages/shared-contracts/src/` with subdirectories:
  - [ ] `src/network/` - Network message types (stub)
  - [ ] `src/game/` - Game state types (stub)
  - [ ] `src/geometry/` - Geometry types (stub)
  - [ ] `src/index.ts` - Public exports
- [ ] Add to root `package.json` workspaces
- [ ] Verify root `npm install` includes it
- [ ] All TypeScript references updated to find new package

**Completion Criteria:**
- Package structure exists
- Can be imported: `import { ... } from '@shared/contracts'`
- TypeScript finds it correctly
- Build includes it (no errors)

**Blocks:** Shared Contracts Migration, v0.4.0

---

### MILESTONE 7️⃣: Extract Network Message Types
**Deliverable:** Move all network protocol types into `packages/shared-contracts/src/network/`

**Current State:** Types scattered across:
- `client/src/engine/network/NetworkRuntimeContracts.ts`
- `server/src/sessionContracts.ts`
- Various message handler files

**Target State:** Single source of truth in `packages/shared-contracts/src/network/`

**Incremental Migration Strategy (Batches of 10–15 files):**

**Batch 1: Core Network Messages**
- [ ] Extract network message base types → `packages/shared-contracts/src/network/messages.ts`
- [ ] Update client files (5 files) to import from shared
- [ ] Update server files (3 files) to import from shared
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)
- [ ] No new warnings

**Batch 2: Payload Types**
- [ ] Extract payload/state types → `packages/shared-contracts/src/network/payloads.ts`
- [ ] Update client files (8 files)
- [ ] Update server files (5 files)
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)

**Batch 3: Snapshot Contracts**
- [ ] Extract snapshot types → `packages/shared-contracts/src/network/snapshot.ts`
- [ ] Update client files (12 files)
- [ ] Update server files (7 files)
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)

**Batch 4: Remaining Network Types**
- [ ] Extract remaining types → `packages/shared-contracts/src/network/`
- [ ] Update remaining client files (~25 files)
- [ ] Update remaining server files (~15 files)
- [ ] Create public API: `packages/shared-contracts/src/network/index.ts`
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)

**Completion Criteria:**
- [ ] All network types in shared package
- [ ] Zero duplication (old locations removed or deprecated)
- [ ] Type-check passes
- [ ] Tier0 tests still pass
- [ ] No runtime behavior changes (types only)
- [ ] Both client & server import from `@shared/contracts/network`

**Blocks:** Game Types Extraction, v0.4.0

---

### MILESTONE 8️⃣: Extract Game State Constants & Types
**Deliverable:** Move game balance/state types into `packages/shared-contracts/src/game/`

**Incremental Migration Strategy (Batches of 10–15 files):**

**Batch 1: Health/Status Types**
- [ ] Extract health, mana, armor constants → `packages/shared-contracts/src/game/vitals.ts`
- [ ] Extract status effect types → `packages/shared-contracts/src/game/statusEffects.ts`
- [ ] Update client files (6 files)
- [ ] Update server files (4 files)
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)

**Batch 2: Ability & Weapon Types**
- [ ] Extract ability definitions → `packages/shared-contracts/src/game/abilities.ts`
- [ ] Extract weapon definitions → `packages/shared-contracts/src/game/weapons.ts`
- [ ] Update client files (10 files)
- [ ] Update server files (8 files)
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)

**Batch 3: Entity & Game Mode Types**
- [ ] Extract entity type enums → `packages/shared-contracts/src/game/entities.ts`
- [ ] Extract game mode types → `packages/shared-contracts/src/game/modes.ts`
- [ ] Update client files (8 files)
- [ ] Update server files (6 files)
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)

**Batch 4: Remaining Game Types**
- [ ] Extract remaining constants/types → `packages/shared-contracts/src/game/`
- [ ] Create public API: `packages/shared-contracts/src/game/index.ts`
- [ ] Update remaining client files (~56 files)
- [ ] Update remaining server files (~42 files)
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)

**Completion Criteria:**
- [ ] All game constants in shared package
- [ ] Zero duplication
- [ ] Type-check passes
- [ ] Both client & server import from `@shared/contracts/game`
- [ ] No behavioral changes

**Blocks:** Geometry Types Extraction, Shared Package Complete

---

### MILESTONE 9️⃣: Extract Geometry & Math Types
**Deliverable:** Move Vector3, Transform, geometry types into `packages/shared-contracts/src/geometry/`

**Incremental Migration Strategy (Batches of 15–20 files):**

**Batch 1: Vector & Transform Basics**
- [ ] Create shared Vector3 definition → `packages/shared-contracts/src/geometry/vector.ts`
- [ ] Create shared Transform definition → `packages/shared-contracts/src/geometry/transform.ts`
- [ ] Update client files (8 files)
- [ ] Update server files (4 files)
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)

**Batch 2: Collision & Physics Geometry**
- [ ] Move collision geometry types → `packages/shared-contracts/src/geometry/collision.ts`
- [ ] Move physics bounds → `packages/shared-contracts/src/geometry/bounds.ts`
- [ ] Update client files (15 files)
- [ ] Update server files (8 files)
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)

**Batch 3: Angle & Rotation Helpers**
- [ ] Move angle/rotation helpers → `packages/shared-contracts/src/geometry/rotation.ts`
- [ ] Move matrix/quaternion types → `packages/shared-contracts/src/geometry/matrices.ts`
- [ ] Update client files (18 files)
- [ ] Update server files (10 files)
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)

**Batch 4: Remaining Geometry Types**
- [ ] Extract remaining types → `packages/shared-contracts/src/geometry/`
- [ ] Create public API: `packages/shared-contracts/src/geometry/index.ts`
- [ ] Update remaining client files (~59 files)
- [ ] Update remaining server files (~28 files)
- [ ] Run type-check (must pass)
- [ ] Run Tier0 tests (19/19 must pass)

**Completion Criteria:**
- [ ] All geometry types in shared package
- [ ] Zero duplication
- [ ] Type-check passes (no conflicts)
- [ ] Both client & server import from `@shared/contracts/geometry`
- [ ] No behavioral changes
- [ ] Single source of truth for all math types

**Blocks:** Shared Package Complete

---

### MILESTONE 🔟: Shared Contracts Package Complete
**Deliverable:** Verify `packages/shared-contracts` is production-ready

**Scope:**
- [ ] All network types exported
- [ ] All game types exported
- [ ] All geometry types exported
- [ ] Public API complete in `packages/shared-contracts/src/index.ts`
- [ ] Package.json includes all needed exports
- [ ] README with usage examples
- [ ] Type-check passes everywhere
- [ ] Build includes package
- [ ] Zero duplication across client/server
- [ ] Tier0 tests still pass

**Completion Criteria:**
- Shared contracts package production-ready
- Can be published to npm if desired
- Single source of truth for all types

**Blocks:** v0.4.0 Multiplayer Phase 1

---

### MILESTONE 1️⃣1️⃣: Webpack Configuration Cleanup
**Deliverable:** Fix all Webpack warnings and optimize build

**Current State:** ~3 "Critical Dependency" warnings from dynamic imports  
**Target State:** Zero Webpack warnings

**Scope:**
- [ ] Audit all `import()` statements
- [ ] Convert dynamic imports to static where possible
- [ ] Use Webpack template literals for those that must be dynamic
- [ ] Remove unused imports/dead code
- [ ] Optimize code-splitting strategy
- [ ] Measure and document bundle size change
- [ ] Verify incremental build time stays <2s

**Completion Criteria:**
- Zero Webpack warnings
- Build output clean
- Bundle size maintained or improved

**Blocks:** v0.4.0 Performance Work

---

### MILESTONE 1️⃣2️⃣: Server Domain Boundary Formalization
**Deliverable:** Document and enforce server module boundaries

**Scope:**
- [ ] Create `server/src/core/domain-boundaries.md`
- [ ] Define what each domain owns (collision, actor, gameplay, etc.)
- [ ] Define what each domain CANNOT do (no circular deps, etc.)
- [ ] Create import boundary tests (eslint or similar)
- [ ] Verify no domain violations in existing code
- [ ] Document single entry points per domain
- [ ] Type-check passes with stricter rules

**Completion Criteria:**
- Domain boundaries documented
- Enforceable through linting/tests
- No violations in current code

**Blocks:** v0.4.0 Architecture Review

---

### MILESTONE 1️⃣3️⃣: Developer Workflow Quick Start
**Deliverable:** Create fast on-boarding scripts and commands

**Scope:**
- [ ] Create `scripts/dev-setup.sh` - Install, build, start
- [ ] Create `scripts/validate.sh` - Run all checks (type-check, build, tests)
- [ ] Create `scripts/clean.sh` - Clean all caches and build artifacts
- [ ] Add npm commands to `package.json`:
  - [ ] `npm run validate` - Full suite
  - [ ] `npm run dev:client` - Client only
  - [ ] `npm run dev:server` - Server only
  - [ ] `npm run dev:both` - Both (via concurrently)
- [ ] Document in `docs/01_GUIDES/DEVELOPER_SETUP.md`

**Completion Criteria:**
- New developers can start in <5 minutes
- All validation commands in one place
- Documentation complete

**Blocks:** v0.4.0 Team Expansion

---

## 🔗 Dependency Graph

```
MILESTONE 0️⃣ (Pre-Work)
    ↓ (depends on)
MILESTONE 1️⃣ (Phase 3) → MILESTONE 2️⃣ (Phase 4) → MILESTONE 3️⃣ (Phase 5) → MILESTONE 4️⃣ (Phase 6)
    ↓ (all phases complete)
MILESTONE 5️⃣ (Testing Framework)
    ↓ (with Testing)
MILESTONE 6️⃣ (Shared Package Scaff)
    ↓
MILESTONE 7️⃣ (Network Types) → MILESTONE 8️⃣ (Game Types) → MILESTONE 9️⃣ (Geometry)
    ↓ (all types)
MILESTONE 🔟 (Shared Package Complete)

Parallel Work:
MILESTONE 1️⃣1️⃣ (Webpack) - Can run anytime after Milestone 1️⃣
MILESTONE 1️⃣2️⃣ (Domains) - Can run anytime after Milestone 4️⃣
MILESTONE 1️⃣3️⃣ (Dev Workflow) - Can run anytime
```

---

## 📊 Completion Tracking

### Phase 1: Bootstrap Migration (Milestones 1️⃣-5️⃣)
**Status:** Not Started  
**Blocker:** None  
**Dependency Chain:** 0 → 1 → 2 → 3 → 4 → 5

**Why First:**
- Unlocks isolated phase testing
- Reduces main bootstrap complexity from 690 lines
- Enables lazy-loading architecture for v0.4.0

### Phase 2: Shared Contracts (Milestones 6️⃣-🔟)
**Status:** Not Started  
**Blocker:** None (can start after Phase 1 or in parallel)  
**Dependency Chain:** 6 → 7 → 8 → 9 → 10

**Why Second:**
- Single source of truth for network types
- Blocks v0.4.0 multiplayer work
- Reduces duplication across 150+ files

### Phase 3: Polish & Infrastructure (Milestones 1️⃣1️⃣-1️⃣3️⃣)
**Status:** Not Started  
**Blocker:** None (can run in parallel)

**Why Third:**
- Quality of life improvements
- Better team productivity
- Clean build output

---

## 🎯 v0.3.1 Success Criteria

**Release When ALL of:**
- [ ] Milestones 1️⃣-5️⃣ complete (Bootstrap phases + testing)
- [ ] Milestones 6️⃣-🔟 complete (Shared contracts package)
- [ ] Type-check: **PASSING** (zero errors)
- [ ] Tier0 tests: **19/19 passing** (unchanged)
- [ ] Build: **Clean output** (no new warnings)
- [ ] Documentation: **Updated** (milestones documented)

---

## 📝 v0.3.1 Release Notes (Draft)

```
## [0.3.1] - 2026-04-XX (Estimated)

### 🏗️ Architecture Refinement

- **Bootstrap Phase Migration:** Completed Phase 3-6 migrations
  - Phase 3: All gameplay systems instantiated independently
  - Phase 4: All networking systems instantiated independently
  - Phase 5: All UI systems instantiated independently
  - Phase 6: All coordinators wired independently
  - Main bootstrap reduced from 690 → ~50 lines

- **Bootstrap Testing Framework:** Phase-level unit tests
  - Each phase testable in isolation
  - Full end-to-end lifecycle tests
  - 100% phase coverage

- **Shared Contracts Package:** Extracted `packages/shared-contracts`
  - Network message types (single source of truth)
  - Game state constants and types
  - Geometry and math types
  - Used by 150+ files (client & server)
  - Eliminates type duplication

### 🔒 Code Quality

- Webpack warnings eliminated
- Server domain boundaries formalized and enforced
- Zero new compilation errors
- Type-check strict mode maintained

### 🎁 Developer Experience

- Developer workflow automation commands
- Faster on-boarding (<5 minutes)
- Better documentation for new team members

### ✅ Validation

- All 19 Tier0 tests passing (unchanged)
- Type-check passing (stricter)
- Build clean (zero warnings)
- 13 milestones completed

**Status:** Foundation strengthened, ready for v0.4.0 multiplayer scale.
```

---

## 🚀 Recommended Execution Strategy

### **Option A: Sequential (Safer)**
Complete Milestones in order: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13

**Pros:** Minimal merge conflicts, easy to review each milestone independently  
**Cons:** Longer total timeline

### **Option B: Parallel Teams (Faster)**
- **Team A:** Milestones 1-5 (Bootstrap phases)
- **Team B:** Milestones 6-10 (Shared contracts)
- **Team C:** Milestones 11-13 (Polish) in parallel

**Pros:** Faster completion, better parallelization  
**Cons:** Requires careful merge coordination

### **Option C: Hybrid (Recommended)**
1. **Week 1:** Complete Milestone 0 (pre-work validation)
2. **Week 1-2:** Milestones 1-4 in sequence (quick with one dev)
3. **Week 2:** Milestone 5 (testing) + Start Milestones 6-7 (shared package)
4. **Week 3:** Milestones 8-10 (finish shared package)
5. **Week 3:** Milestones 11-13 (polish, parallel)

---

## ✅ When Ready, v0.3.1 Unlocks v0.4.0

Once v0.3.1 complete:
- ✅ Bootstrap phases testable independently
- ✅ Shared contracts single source of truth
- ✅ Clean build with zero warnings
- ✅ Enhanced developer workflow
- ✅ Ready for multiplayer stress testing (v0.4.0 Phase 1)

**Path to v0.4.0:** Start multiplayer replication stress tests (50-100 players) immediately after v0.3.1 release.
