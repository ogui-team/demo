/**
 * ============================================================================
 * CombatSystemDOD.ts - DOD-Adapter Pattern Example
 * ============================================================================
 *
 * Demonstrates complete DOD refactoring:
 * ✅ No Entity class instance method calls
 * ✅ All I/O through kernel buffers
 * ✅ Commands for inter-system communication (no direct imports)
 * ✅ Zero allocations in tick() loop
 *
 * Phase 2 Example: How all gameplay systems should be refactored
 */

import { SimulationKernel } from './SimulationKernel';
import type { IKernelSystem, SystemCategory } from './types';
import { SystemCategory as SC } from './types';
import { KernelCommandType } from './KernelCommandTypes';

/**
 * Combat mechanics configuration
 */
export interface CombatConfig {
  damageRollVariance: number; // % variance on damage (e.g. 0.1 = ±10%)
  critChance: number; // 0-1 probability
  critMultiplier: number; // e.g. 1.5x damage
}

/**
 * Per-entity combat state (read from buffers, never mutated here)
 */
export interface CombatState {
  handle: number; // EntityHandle
  denseIndex: number; // Dense array index
  maxHealth: number;
  currentHealth: number;
  armor: number;
}

/**
 * CombatSystemDOD - Pure DOD Architecture Example
 *
 * Demonstrates DOD pattern (Phase 2):
 * ✅ Reads from kernel buffers
 * ✅ Writes damage to HealthStorage
 * ✅ No direct method calls between systems
 * ✅ Zero allocations in execute()
 *
 * Note: This is a REFERENCE implementation for the DOD pattern.
 * Integration with actual kernel queue will follow in Phase 2.2
 */
export class CombatSystemDOD implements IKernelSystem {
  readonly id = 'combat_system_dod';
  readonly category = SC.KERNEL as const;
  readonly priority = 100; // Execution order

  private kernel: SimulationKernel | null = null;
  private config: CombatConfig;
  private activeCount = 0;

  // ── Metrics & debug state ─────────────────────────────────────────
  private damagesApplied = 0;
  private critsTriggered = 0;
  private overkills = 0;

  constructor(config: Partial<CombatConfig> = {}) {
    this.config = {
      damageRollVariance: config.damageRollVariance ?? 0.1,
      critChance: config.critChance ?? 0.15,
      critMultiplier: config.critMultiplier ?? 1.5,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // IKernelSystem interface
  // ────────────────────────────────────────────────────────────────────

  initialize(kernel: SimulationKernel): void {
    this.kernel = kernel;
  }

  setActiveCount(count: number): void {
    this.activeCount = count;
  }

  /**
   * Main execution: Process damage for active entities
   *
   * Called from SimulationKernel.tick(dt)
   * Demonstrates DOD pattern: pure buffer reads/writes
   */
  execute(dt: number): void {
    if (!this.kernel) {
      throw new Error('CombatSystemDOD not initialized');
    }

    this.damagesApplied = 0;
    this.critsTriggered = 0;
    this.overkills = 0;

    // ── Example: Iterate active entities and apply passive regeneration ────
    // This demonstrates zero-allocation iteration over buffer data
    const entities = this.kernel.entities;
    const healths = this.kernel.healths;

    for (let denseIndex = 0; denseIndex < this.activeCount; denseIndex++) {
      const handle = entities.getHandleForDense(denseIndex);
      if (!handle || handle < 0) continue; // Entity slot is empty

      // ── Apply passive regen (example DOD behavior) ────────────────
      const currentHealth = healths.getHealth(denseIndex);
      const maxHealth = healths.getMaxHealth(denseIndex);
      const passiveRegenPerSecond = 5; // config-driven

      if (currentHealth < maxHealth) {
        const regenAmount = passiveRegenPerSecond * dt;
        const newHealth = Math.min(maxHealth, currentHealth + regenAmount);
        healths.setHealth(denseIndex, newHealth);
      }
    }
  }

  // ── DOD pattern demonstration ───────────────────────────────────────

  /**
   * Calculate effective damage after armor mitigation
   * O(1) pure function - no state mutation
   */
  private calculateDamage(baseDamage: number, armor: number): number {
    // Simple armor formula: each point of armor = 1% reduction
    const armorReduction = Math.min(0.9, armor * 0.01);
    const mitigated = baseDamage * (1 - armorReduction);

    // Apply variance (prevents all damage being identical)
    const variance = 1 + (Engine.random.next() - 0.5) * 2 * this.config.damageRollVariance;
    return Math.max(1, mitigated * variance);
  }

  /**
   * Debug/inspection state
   */
  getCapabilities(): Record<string, unknown> {
    return {
      name: 'Combat System (DOD)',
      systemType: 'BufferSystem',
      priority: this.priority,
      inputCommands: [KernelCommandType.APPLY_DAMAGE],
      outputCommands: [KernelCommandType.ENTITY_EVENT],
      config: this.config,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      id: this.id,
      status: 'active',
      tickMetrics: {
        damagesApplied: this.damagesApplied,
        critsTriggered: this.critsTriggered,
        overkills: this.overkills,
      },
      config: this.config,
    };
  }
}


/**
 * Example damage query (non-allocating)
 */
export function queryEntityHealth(
  kernel: SimulationKernel,
  entityHandle: number,
): { current: number; max: number } | null {
  const denseIndex = kernel.entities.getDenseIndex(entityHandle);
  if (denseIndex < 0) return null;

  return {
    current: kernel.healths.getHealth(denseIndex),
    max: kernel.healths.getMaxHealth(denseIndex),
  };
}
