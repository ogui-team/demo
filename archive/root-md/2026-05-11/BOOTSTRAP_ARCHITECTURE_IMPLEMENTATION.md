# Bootstrap Architecture Implementation Guide

**Date:** April 18, 2026  
**Version:** v0.3.1 (Upgrade)  
**Status:** ✅ Ready for Milestones 1–5

---

## 📋 PHASE ARCHITECTURE CONTRACT

**Definition:** Every bootstrap phase must conform to this interface.

### Interface Definition

```typescript
// client/src/engine/runtime/bootstrap/phases.ts

interface BootstrapPhaseContext {
  engine: Engine
  registry: SystemRegistry
  kernel: KernelContext
  eventBus: EventBus<GameEvents>
  scheduler: TaskScheduler
}

interface PhaseResult {
  systems: Record<string, System>
  dispose(): void
}

type BootstrapPhase = (context: BootstrapPhaseContext) => PhaseResult
```

### Why This Contract?

| Feature | Benefit |
|---------|---------|
| **Pure Function** | No hidden globals, testable, predictable |
| **Explicit Systems** | Know exactly what phase creates |
| **Dispose Method** | Clean cleanup for reload/streaming |
| **Idempotent** | Safe to run 2-3 times (detect leaks) |
| **Registry-Based** | Hot-swap systems at runtime |

---

## 🔧 PHASE 3 IMPLEMENTATION SKETCH

**Phase 3: Gameplay Systems (10 systems)**

```typescript
// client/src/engine/runtime/bootstrap/phases.ts

export function Phase3_GameplayRuntime(ctx: BootstrapPhaseContext): PhaseResult {
  // Create all gameplay systems
  const physicsSystem = new PhysicsSystem()
  const healthSystem = new HealthSystem()
  const weaponSystem = new WeaponSystem()
  const abilitySystem = new AbilitySystem()
  const characterActorSystem = new CharacterActorSystem()
  const objectCreatorSystem = new ObjectCreatorSystem()
  const prefabSystem = new PrefabSystem()
  const spawnSystem = new SpawnSystem()
  const playerModelSystem = new PlayerModelSystem()
  const menuIdentitySystem = new MenuIdentitySystem()
  
  // Each system gets context it needs
  physicsSystem.initialize(ctx.kernel.world)
  healthSystem.initialize(ctx.kernel.entities)
  // ... etc
  
  // Assign stable IDs (CRITICAL: IDs must be consistent across reloads)
  const systems = {
    physics: physicsSystem,
    health: healthSystem,
    weapon: weaponSystem,
    ability: abilitySystem,
    characterActor: characterActorSystem,
    objectCreator: objectCreatorSystem,
    prefab: prefabSystem,
    spawn: spawnSystem,
    playerModel: playerModelSystem,
    menuIdentity: menuIdentitySystem,
  }
  
  // Return both systems and dispose function
  return {
    systems,
    dispose: () => {
      Object.values(systems).forEach(system => {
        if (system.dispose) system.dispose()
        if (system.cleanup) system.cleanup()
      })
    }
  }
}
```

### Key Points

1. **No Hidden Initialization**
   - Everything system needs is passed as parameter
   - No reaching into global singletons

2. **Stable System IDs**
   - Always "physics", "health", etc. (not `Math.random()`)
   - Enables hot reload to identify which systems to replace

3. **Disposable Resources**
   - Each system must clean up listeners, timers, connections
   - Phase 3 dispose() calls all system dispose()

4. **Type Safety**
   - Return type is `PhaseResult` (enforced at compile-time)
   - Calling code can trust `return.systems` has all 10 systems

---

## 🔄 PHASE 4 NETWORKING SKETCH

```typescript
export function Phase4_NetworkingRuntime(ctx: BootstrapPhaseContext): PhaseResult {
  // Get networking systems (already registered by kernel)
  const networkSync = ctx.registry.getSystem('networkSync')
  const replication = ctx.registry.getSystem('replication')
  
  // Create coordinator systems
  const multiplayerClient = new MultiplayerClient()
  const collisionAuthority = new CollisionAuthoritySystem()
  
  multiplayerClient.initialize(ctx.kernel.session, replication)
  collisionAuthority.initialize(ctx.kernel.world)
  
  return {
    systems: {
      multiplayerClient,
      collisionAuthority,
    },
    dispose: () => {
      multiplayerClient.disconnect?.()
      collisionAuthority.dispose?.()
    }
  }
}
```

### Key Point

Phase 4 demonstrates accessing systems from kernel (already created in earlier phases) + creating new systems.

---

## 🧠 SYSTEM REGISTRY IMPLEMENTATION SKETCH

**Purpose:** Runtime replacement of systems (hot reload, streaming, testing)

```typescript
// client/src/engine/kernel/SystemRegistry.ts

export class SystemRegistry {
  private systems: Map<string, System> = new Map()
  private phaseOwnership: Map<string, string> = new Map() // systemId → phaseId
  private listeners: Map<string, Function[]> = new Map()   // systemId → listeners
  
  registerSystem(id: string, system: System, phaseId?: string): void {
    // If system exists, dispose old one first
    if (this.systems.has(id)) {
      const oldSystem = this.systems.get(id)!
      oldSystem.dispose?.()
      
      // Clean up listeners from old system
      this.listeners.delete(id)
    }
    
    this.systems.set(id, system)
    if (phaseId) {
      this.phaseOwnership.set(id, phaseId)
    }
    
    console.log(`[SystemRegistry] Registered system: ${id}`)
  }
  
  replaceSystem(id: string, newSystem: System): void {
    const phaseId = this.phaseOwnership.get(id)
    this.registerSystem(id, newSystem, phaseId)
  }
  
  removeSystem(id: string): void {
    const system = this.systems.get(id)
    if (system) {
      system.dispose?.()
      this.systems.delete(id)
      this.phaseOwnership.delete(id)
      this.listeners.delete(id)
      console.log(`[SystemRegistry] Removed system: ${id}`)
    }
  }
  
  getSystem(id: string): System | null {
    return this.systems.get(id) ?? null
  }
  
  getAllSystems(): Map<string, System> {
    return new Map(this.systems)
  }
  
  // Get all systems from a specific phase
  getSystemsByPhase(phaseId: string): System[] {
    return Array.from(this.systems.entries())
      .filter(([id]) => this.phaseOwnership.get(id) === phaseId)
      .map(([, system]) => system)
  }
}
```

### Usage Pattern

```typescript
// After Phase 3 completes
const phase3Result = Phase3_GameplayRuntime(ctx)
Object.entries(phase3Result.systems).forEach(([id, system]) => {
  ctx.registry.registerSystem(id, system, 'phase3')
})

// Later: Hot reload Phase 3
async function reloadPhase3() {
  const systemIds = Array.from(ctx.registry.getAllSystems().entries())
    .filter(([_, system]) => ctx.registry.phaseOwnership.get(_) === 'phase3')
    .map(([id]) => id)
  
  systemIds.forEach(id => ctx.registry.removeSystem(id))
  
  const phase3Result = Phase3_GameplayRuntime(ctx)
  Object.entries(phase3Result.systems).forEach(([id, system]) => {
    ctx.registry.registerSystem(id, system, 'phase3')
  })
}
```

---

## 🔥 HOT RELOAD IMPLEMENTATION

**Minimal hot reload that works today:**

```typescript
// client/src/engine/kernel/hotReload.ts

export async function reloadPhase(
  phaseId: 'phase3' | 'phase4' | 'phase5' | 'phase6',
  ctx: BootstrapPhaseContext,
  phaseMap: Record<string, BootstrapPhase>
): Promise<void> {
  console.log(`[HotReload] Starting reload of ${phaseId}...`)
  
  // Step 1: Dispose all systems from this phase
  const allSystems = ctx.registry.getAllSystems()
  let disposed = 0
  
  for (const [id, system] of allSystems) {
    if (ctx.registry.getPhaseOwner(id) === phaseId) {
      ctx.registry.removeSystem(id)
      disposed++
    }
  }
  
  console.log(`[HotReload] Disposed ${disposed} systems from ${phaseId}`)
  
  // Step 2: Re-run phase function
  const phaseFunction = phaseMap[phaseId]
  if (!phaseFunction) {
    throw new Error(`Unknown phase: ${phaseId}`)
  }
  
  const result = phaseFunction(ctx)
  
  // Step 3: Re-register systems
  Object.entries(result.systems).forEach(([id, system]) => {
    ctx.registry.registerSystem(id, system, phaseId)
  })
  
  console.log(`[HotReload] Reload complete: ${phaseId}`)
  
  // Game continues running (state persists, only logic reloaded)
}
```

### How to Use in Browser Console

```javascript
// Expose reload function to window (add in bootloader.ts)
(window as any).__reloadPhase = reloadPhase

// Then in console:
await window.__reloadPhase('phase3')  // Reload gameplay systems only
await window.__reloadPhase('phase4')  // Reload networking systems only
```

---

## 💾 STATE PERSISTENCE DURING RELOAD

**Critical Pattern:**

```typescript
// ❌ WRONG: Resets game state
function Phase3_GameplayRuntime_WRONG(ctx) {
  return {
    systems: { /* ... */ },
    dispose: () => {
      ctx.kernel.world.clear()  // ← Wipes all entities!
    }
  }
}

// ✅ RIGHT: Keeps state, reloads logic
function Phase3_GameplayRuntime(ctx) {
  // Create NEW system instances, but they operate on EXISTING state
  const physicsSystem = new PhysicsSystem()
  physicsSystem.attachToExistingWorld(ctx.kernel.world)  // Attach, don't create
  
  return {
    systems: { physics: physicsSystem },
    dispose: () => {
      physicsSystem.detach()  // Detach logic from world, world persists
    }
  }
}
```

**Key Insight:** Phase reload ≠ full bootstrap. Game state (entities, scores, world) survives reload. Only the logic (systems) swaps out.

---

## ✅ VALIDATION CHECKLIST

### After Each Milestone (1–5)

**Type Checking**
```bash
npm run type-check
# Expected: PASSING (zero errors)
```

**Tier0 Tests**
```bash
# In browser console
window.__runTier0Tests()
# Expected: 19/19 passing
```

**Idempotency Check**
```javascript
// In browser console
const before = performance.memory?.usedJSHeapSize
await window.__reloadPhase('phase3')
await window.__reloadPhase('phase3')  // Run twice
const after = performance.memory?.usedJSHeapSize
console.log(`Memory delta: ${after - before} bytes`)
// Expected: < 2MB growth
```

**No System Duplication**
```javascript
// After reload, verify registry
window.__engine.registry.getAllSystems()
// Expected: 50 unique systems (no duplicates)
```

**Event Listener Cleanup**
```javascript
// Count listeners before/after reload
const before = window.__engine.eventBus.listenerCount()
await window.__reloadPhase('phase3')
const after = window.__engine.eventBus.listenerCount()
console.log(`Listeners: ${before} → ${after}`)
// Expected: same or lower (no accumulation)
```

**Build Verification**
```bash
npm run build
# Expected: Warnings = 0, Bundle < 2MB
```

---

## 🎯 EFFICIENCY CONSTRAINTS APPLIED

### Only Added If:
- ✅ Prevents real failure (memory leak, duplication, crash)
- ✅ Enables hot reload / streaming directly

### NOT Added:
- ❌ Dependency injection framework
- ❌ Generic service locator
- ❌ Heavy abstractions
- ❌ Speculative streaming layer

### Result:
- Pure functions (Phase 3-6)
- One registry class (SystemRegistry)
- One hot reload function (reloadPhase)
- ~200 lines of new code total

---

## 🚀 MINIMAL STREAMING SUPPORT

**For v0.4.0 multiplayer (later):**

```typescript
// Not implemented yet, but architecture supports:

// Load physics lazily
async function streamPhysics() {
  const physicsModule = await import('./PhysicsSystem.js')
  const system = new physicsModule.PhysicsSystem()
  ctx.registry.registerSystem('physics', system, 'phase3')
}

// Unload debug systems when done
function unloadDebugSystems() {
  ctx.registry.removeSystem('debugOverlay')
  ctx.registry.removeSystem('profiler')
}
```

**Why This Works:**

1. Systems identified by stable ID
2. Registry supports add/remove/replace
3. No global initialization order
4. Each system can be independent

---

## 📝 NEXT STEPS

### For Milestone 1 (Phase 3):
1. Create Phase 3 function in `client/src/engine/runtime/bootstrap/phases.ts`
2. Update `bootstrapClientRuntime()` to call Phase 3
3. Register Phase 3 results via kernel.registry
4. Test Phase 3 in isolation

### For Milestones 2-4:
- Follow same pattern for Phase 4, 5, 6

### For Milestone 5 (Testing):
- Create `client/src/engine/runtime/bootstrap/__tests__/phases.test.ts`
- Test each phase contract compliance
- Test idempotency (3 runs)
- Test disposal

---

**Status: Ready to execute v0.3.1 Milestones 1–5** ✅
