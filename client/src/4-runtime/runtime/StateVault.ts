import { SimulationKernel } from '@engine/1-kernel/core/public-api';
import type { EntityHandle } from '@engine/1-kernel/core/public-api';

/**
 * StateVault: Transient storage for entity "soul" (stats, ability state, inventory).
 * Enables seamless mode transitions (Editor -> Play) by saving/loading DOD buffer data.
 * Domain-agnostic: Works for any entity type.
 */
export interface EntityState {
  health?: number;
  maxHealth?: number;
  ammo?: number;
  itemId?: number;
  primaryAbilityId?: number;
  [key: string]: unknown;
}

export class StateVault {
  private readonly savedStates = new Map<string, EntityState>();
  private readonly kernel: SimulationKernel;

  constructor(kernel: SimulationKernel) {
    this.kernel = kernel;
  }

  /**
   * Saves entity state from DOD buffers into a transient JSON object.
   * @param entityId Unique entity identifier (e.g., "player_1", "grunt_42")
   * @param handle Entity handle in the kernel
   * @returns True if save successful; false if handle invalid
   */
  save(entityId: string, handle: EntityHandle): boolean {
    const dense = this.kernel.entities.getDenseIndex(handle);
    if (dense < 0) {
      console.error(`StateVault.save: Invalid handle ${handle} for entityId ${entityId}`);
      return false;
    }

    const state: EntityState = {
      health: this.kernel.healths.getHealth(dense),
      maxHealth: this.kernel.healths.getMaxHealth(dense),
      ammo: this.kernel.inventories.getAmmo(dense),
      itemId: this.kernel.inventories.getItemId(dense),
      primaryAbilityId: this.kernel.abilities.getPrimaryAbility(dense),
    };

    this.savedStates.set(entityId, state);
    console.log(`StateVault: Saved state for ${entityId}`, state);
    return true;
  }

  /**
   * Loads entity state into DOD buffers from saved data.
   * @param entityId Unique entity identifier
   * @param handle Entity handle in the kernel (typically new entity handle)
   * @returns True if load successful; false if no saved state or invalid handle
   */
  load(entityId: string, handle: EntityHandle): boolean {
    const state = this.savedStates.get(entityId);
    if (!state) {
      console.warn(`StateVault.load: No saved state for entityId ${entityId}`);
      return false;
    }

    const dense = this.kernel.entities.getDenseIndex(handle);
    if (dense < 0) {
      console.error(`StateVault.load: Invalid handle ${handle} for entityId ${entityId}`);
      return false;
    }

    // Hydrate buffers with saved data
    if (state.health !== undefined) {
      this.kernel.healths.setHealth(dense, state.health);
    }
    if (state.maxHealth !== undefined) {
      this.kernel.healths.setMaxHealth(dense, state.maxHealth);
    }
    if (state.ammo !== undefined) {
      this.kernel.inventories.setAmmo(dense, state.ammo);
    }
    if (state.itemId !== undefined) {
      this.kernel.inventories.setItemId(dense, state.itemId);
    }
    if (state.primaryAbilityId !== undefined) {
      this.kernel.abilities.setPrimaryAbility(dense, state.primaryAbilityId);
    }

    console.log(`StateVault: Loaded state for ${entityId}`, state);
    return true;
  }

  /**
   * Clears saved state for an entity.
   */
  clear(entityId: string): void {
    this.savedStates.delete(entityId);
  }

  /**
   * Clears all saved states.
   */
  clearAll(): void {
    this.savedStates.clear();
  }

  /**
   * Validates state consistency: compares saved state with current buffer data.
   * @returns Error message if mismatch detected; empty string if consistent
   */
  validateConsistency(entityId: string, handle: EntityHandle): string {
    const state = this.savedStates.get(entityId);
    if (!state) {
      return ''; // No saved state to validate
    }

    const dense = this.kernel.entities.getDenseIndex(handle);
    if (dense < 0) {
      return `Invalid handle ${handle}`;
    }

    const errors: string[] = [];

    const currentHealth = this.kernel.healths.getHealth(dense);
    if (state.health !== undefined && Math.abs(currentHealth - state.health) > 0.001) {
      errors.push(`Health mismatch: expected ${state.health}, got ${currentHealth}`);
    }

    const currentAmmo = this.kernel.inventories.getAmmo(dense);
    if (state.ammo !== undefined && currentAmmo !== state.ammo) {
      errors.push(`Ammo mismatch: expected ${state.ammo}, got ${currentAmmo}`);
    }

    const currentItemId = this.kernel.inventories.getItemId(dense);
    if (state.itemId !== undefined && currentItemId !== state.itemId) {
      errors.push(`ItemId mismatch: expected ${state.itemId}, got ${currentItemId}`);
    }

    if (errors.length > 0) {
      const errorMsg = `STATE_TRANSITION_ERROR for ${entityId}: ${errors.join('; ')}`;
      console.error(errorMsg);
      return errorMsg;
    }

    return '';
  }
}