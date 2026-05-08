// client/src/engine/kernel/SystemRegistry.ts

import { System } from '../core/types'

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
        (oldSystem as any).dispose?.()
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
      (system as any).initialize?.()
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
      (system as any).dispose?.()
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
      if (!(system as any).dispose) {
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
    metrics: { registrations: number; replacements: number; removals: number }
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
        (system as any).dispose?.()
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
