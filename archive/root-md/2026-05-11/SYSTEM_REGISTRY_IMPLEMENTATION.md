# System Registry Implementation Details

**Date:** April 18, 2026  
**Status:** Reference implementation for v0.3.1  

---

## 📍 WHERE TO ADD

**File:** `client/src/engine/kernel/SystemRegistry.ts` (NEW)

---

## ✅ FULL IMPLEMENTATION

```typescript
// client/src/engine/kernel/SystemRegistry.ts

import { System } from '../core/System'

/**
 * Manages all engine systems with support for:
 * - Registration and replacement
 * - Phase ownership tracking
 * - Hot reload (dispose + re-register)
 * - Memory safety (detect duplication)
 */
export class SystemRegistry {
  private systems: Map<string, System> = new Map()
  private phaseOwnership: Map<string, string> = new Map()  // systemId → phaseId
  private registrationOrder: string[] = []                 // Track order for debugging
  private metrics = {
    registrations: 0,
    replacements: 0,
    removals: 0,
  }

  /**
   * Register a new system or replace existing
   * 
   * If system with ID already exists:
   * 1. Calls dispose() on old system
   * 2. Removes from phaseOwnership
   * 3. Registers new system
   */
  registerSystem(
    id: string,
    system: System,
    phaseId?: string,
    force = false
  ): void {
    if (!id || !system) {
      throw new Error(`Invalid system registration: id=${id}, system=${system}`)
    }

    const exists = this.systems.has(id)
    
    if (exists && !force) {
      console.warn(
        `[SystemRegistry] System "${id}" already registered. ` +
        `Use replaceSystem() to swap it, or set force=true.`
      )
      return
    }

    // If replacing, dispose old first
    if (exists) {
      const oldSystem = this.systems.get(id)!
      try {
        oldSystem.dispose?.()
        this.metrics.replacements++
      } catch (e) {
        console.error(`[SystemRegistry] Error disposing old "${id}":`, e)
      }
    } else {
      this.registrationOrder.push(id)
      this.metrics.registrations++
    }

    this.systems.set(id, system)
    if (phaseId) {
      this.phaseOwnership.set(id, phaseId)
    }

    // Call initialize if it exists
    try {
      system.initialize?.()
    } catch (e) {
      console.error(`[SystemRegistry] Error initializing "${id}":`, e)
      this.systems.delete(id)
      throw e
    }

    console.log(
      `[SystemRegistry] ${exists ? 'Replaced' : 'Registered'} system: "${id}"` +
      (phaseId ? ` (phase: ${phaseId})` : '')
    )
  }

  /**
   * Swap a system atomically
   * Disposes old, registers new
   */
  replaceSystem(id: string, newSystem: System): void {
    const phaseId = this.phaseOwnership.get(id)
    this.registerSystem(id, newSystem, phaseId, true)
  }

  /**
   * Remove a system permanently
   * Disposes and removes from registry
   */
  removeSystem(id: string): void {
    const system = this.systems.get(id)
    if (!system) {
      console.warn(`[SystemRegistry] System "${id}" not found`)
      return
    }

    try {
      system.dispose?.()
      this.metrics.removals++
    } catch (e) {
      console.error(`[SystemRegistry] Error disposing "${id}":`, e)
    }

    this.systems.delete(id)
    this.phaseOwnership.delete(id)

    console.log(`[SystemRegistry] Removed system: "${id}"`)
  }

  /**
   * Get a single system by ID
   */
  getSystem<T extends System = System>(id: string): T | null {
    return (this.systems.get(id) as T) ?? null
  }

  /**
   * Get all registered systems (read-only)
   */
  getAllSystems(): ReadonlyMap<string, System> {
    return new Map(this.systems)
  }

  /**
   * Get all system IDs
   */
  getSystemIds(): string[] {
    return Array.from(this.systems.keys())
  }

  /**
   * Get all systems created by a specific phase
   */
  getSystemsByPhase(phaseId: string): System[] {
    const result: System[] = []
    
    for (const [id, system] of this.systems) {
      if (this.phaseOwnership.get(id) === phaseId) {
        result.push(system)
      }
    }
    
    return result
  }

  /**
   * Get the phase that owns a system
   */
  getPhaseOwner(systemId: string): string | undefined {
    return this.phaseOwnership.get(systemId)
  }

  /**
   * Remove all systems from a specific phase
   * Used for hot reload
   */
  removePhase(phaseId: string): string[] {
    const systemIds: string[] = []
    
    for (const [id, owner] of this.phaseOwnership) {
      if (owner === phaseId) {
        systemIds.push(id)
      }
    }

    systemIds.forEach(id => this.removeSystem(id))
    return systemIds
  }

  /**
   * Check for duplicate system IDs
   * (Should never happen, but detect if it does)
   */
  validateNoDuplicates(): boolean {
    const uniqueIds = new Set(this.systems.keys())
    const hasDuplicates = uniqueIds.size !== this.systems.size
    
    if (hasDuplicates) {
      console.error(
        `[SystemRegistry] DUPLICATE SYSTEM IDS DETECTED! ` +
        `Unique: ${uniqueIds.size}, Total: ${this.systems.size}`
      )
    }
    
    return !hasDuplicates
  }

  /**
   * Validate all systems are disposable
   */
  validateAllDisposable(): boolean {
    let allDisposable = true
    
    for (const [id, system] of this.systems) {
      if (!system.dispose) {
        console.warn(`[SystemRegistry] System "${id}" has no dispose() method`)
        allDisposable = false
      }
    }
    
    return allDisposable
  }

  /**
   * Get diagnostic information
   */
  getDiagnostics(): {
    totalSystems: number
    systemsByPhase: Record<string, number>
    metrics: typeof this.metrics
    registrationOrder: string[]
  } {
    const systemsByPhase: Record<string, number> = {}
    
    for (const phaseId of new Set(this.phaseOwnership.values())) {
      systemsByPhase[phaseId] = this.getSystemsByPhase(phaseId).length
    }

    return {
      totalSystems: this.systems.size,
      systemsByPhase,
      metrics: this.metrics,
      registrationOrder: this.registrationOrder,
    }
  }

  /**
   * Debug output to console
   */
  printDiagnostics(): void {
    const diag = this.getDiagnostics()
    
    console.group(`[SystemRegistry] Diagnostics`)
    console.log(`Total Systems: ${diag.totalSystems}`)
    console.table(diag.systemsByPhase)
    console.table(diag.metrics)
    console.log(`Registration Order:`, diag.registrationOrder)
    console.groupEnd()
  }

  /**
   * Clear all systems (used for reset/testing)
   */
  clear(): void {
    for (const system of this.systems.values()) {
      try {
        system.dispose?.()
      } catch (e) {
        console.error(`[SystemRegistry] Error disposing during clear:`, e)
      }
    }
    
    this.systems.clear()
    this.phaseOwnership.clear()
    this.registrationOrder = []
    
    console.log(`[SystemRegistry] Cleared all systems`)
  }
}
```

---

## 🔗 INTEGRATION WITH KERNEL

**Where to create registry:**

```typescript
// client/src/engine/kernel/Engine.ts (existing file)

export class Engine {
  public registry: SystemRegistry
  public world: World
  // ... other properties

  constructor() {
    this.registry = new SystemRegistry()
    this.world = new World()
    // ... etc
  }
}
```

**Usage in bootstrap:**

```typescript
// client/src/engine/runtime/bootstrapClientRuntime.ts

export async function bootstrapClientRuntime() {
  const engine = new Engine()
  
  // Phase 1 & 2 already done (automatic)
  
  // Phase 3: Gameplay
  const phase3Result = Phase3_GameplayRuntime({ engine, registry: engine.registry, /* ... */ })
  Object.entries(phase3Result.systems).forEach(([id, system]) => {
    engine.registry.registerSystem(id, system, 'phase3')
  })
  
  // Phase 4: Networking
  const phase4Result = Phase4_NetworkingRuntime({ /* ... */ })
  Object.entries(phase4Result.systems).forEach(([id, system]) => {
    engine.registry.registerSystem(id, system, 'phase4')
  })
  
  // ... Phase 5, 6 ...
  
  // Done
  return engine
}
```

---

## 🧪 TESTING THE REGISTRY

```typescript
// client/src/engine/kernel/__tests__/SystemRegistry.test.ts

import { SystemRegistry } from '../SystemRegistry'
import { MockSystem } from './mocks/MockSystem'

describe('SystemRegistry', () => {
  let registry: SystemRegistry
  
  beforeEach(() => {
    registry = new SystemRegistry()
  })

  it('registers a system', () => {
    const system = new MockSystem()
    registry.registerSystem('test', system, 'phase3')
    
    expect(registry.getSystem('test')).toBe(system)
    expect(registry.getPhaseOwner('test')).toBe('phase3')
  })

  it('replaces a system', () => {
    const system1 = new MockSystem()
    const system2 = new MockSystem()
    
    registry.registerSystem('test', system1)
    registry.replaceSystem('test', system2)
    
    expect(registry.getSystem('test')).toBe(system2)
    expect(system1.disposed).toBe(true)  // Old one disposed
  })

  it('removes systems by phase', () => {
    const s1 = new MockSystem()
    const s2 = new MockSystem()
    
    registry.registerSystem('physics', s1, 'phase3')
    registry.registerSystem('health', s2, 'phase3')
    
    const removed = registry.removePhase('phase3')
    
    expect(removed).toEqual(['physics', 'health'])
    expect(registry.getSystem('physics')).toBeNull()
    expect(registry.getSystem('health')).toBeNull()
  })

  it('detects no duplicates', () => {
    const system = new MockSystem()
    registry.registerSystem('test', system)
    
    const hasDuplicates = registry.validateNoDuplicates()
    
    expect(hasDuplicates).toBe(false)
  })
})
```

---

## 📊 MEMORY SAFETY CHECKS

**Automatic checks after each phase:**

```typescript
// In validatePhaseCompletion() function
export function validatePhaseCompletion(
  registry: SystemRegistry,
  phaseId: string
): {
  passed: boolean
  issues: string[]
} {
  const issues: string[] = []

  // Check no duplicates
  if (!registry.validateNoDuplicates()) {
    issues.push('Duplicate system IDs detected')
  }

  // Check all systems are disposable
  if (!registry.validateAllDisposable()) {
    issues.push('Some systems missing dispose() method')
  }

  // Check phase systems exist
  const phaseSystems = registry.getSystemsByPhase(phaseId)
  if (phaseSystems.length === 0) {
    issues.push(`No systems registered for phase: ${phaseId}`)
  }

  return {
    passed: issues.length === 0,
    issues,
  }
}
```

---

## 🎯 CONSTRAINTS APPLIED

✅ **Prevents duplication** (validateNoDuplicates)  
✅ **Enables hot reload** (removePhase + registerSystem)  
✅ **Memory safe** (dispose on replace)  
✅ **No overengineering** (single class, ~200 lines)  
✅ **Testable** (pure methods, no globals)  

---

## 📝 CHECKLIST FOR MILESTONE 1

- [ ] SystemRegistry.ts created in `client/src/engine/kernel/`
- [ ] Engine class updated to include registry
- [ ] Phase 3 function created and tested
- [ ] bootstrapClientRuntime updated to use registry
- [ ] Type-check passes (zero errors)
- [ ] Tier0 tests pass (19/19)
- [ ] No memory growth after 2x bootstrap
