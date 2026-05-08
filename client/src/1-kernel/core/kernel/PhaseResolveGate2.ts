/**
 * PHASE_RESOLVE Handler - Gate 2 Implementation
 * 
 * Executes all transactional mutations during PHASE_RESOLVE:
 * - Lane A: Decrement death timers, handle respawn transitions
 * - Lane B: Process inventory mutations (drop/pickup) from command queue
 * 
 * CONSTRAINT: All mutations are buffer-based (zero object allocation)
 * COMPLEXITY: O(N) where N = active entities (death timers)
 *             O(M) where M = pending commands (inventory operations)
 */

import type { EntityRegistry } from './EntityRegistry';
import type { HealthStorage } from './HealthStorage';
import type { AnimationEffectStorage } from './AnimationEffectStorage';
import type { InventoryStorage } from './InventoryStorage';
import type { PositionStorage } from './PositionStorage';
import { DeathState } from './AnimationEffectStorage';

export enum CommandType {
  PICKUP = 1,
  DROP = 2,
}

export interface InventoryCommand {
  type: CommandType;
  playerHandle: number;
  itemId: number;
  slotIndex?: number;
}

/**
 * Phase 2 Resolve Logic - Handles death animation and inventory mutations
 * Called once per tick in PHASE_RESOLVE phase
 */
export class PhaseResolveGate2 {
  /**
   * Process death timers and respawn transitions
   * 
   * Lane A: Animation Effects
   * - Decrement deathTimer for all dead entities
   * - Transition DEAD → RESPAWNING when timer expires
   * - Clear health buffer on death (no healing while dead)
   * 
   * @param entities - EntityRegistry for dense iteration
   * @param health - HealthStorage (health set to 0 for dead entities)
   * @param animations - AnimationEffectStorage (death state + timer)
   * @param deltaTime - seconds elapsed this tick
   * @param respawnCallback - called when entity respawn ready
   */
  static processDeathAnimations(
    entities: EntityRegistry,
    health: HealthStorage,
    animations: AnimationEffectStorage,
    deltaTime: number,
    respawnCallback: (denseIndex: number) => void
  ): void {
    const activeCount = entities.activeCount;
    const deathStateBuffer = animations.getDeathStateBuffer();
    const deathTimerBuffer = animations.getDeathTimerBuffer();
    const healthBuffer = health.getHealthBuffer();

    // O(N) linear pass over active entities
    for (let i = 0; i < activeCount; i++) {
      const state = deathStateBuffer[i] & 0xFF;

      if (state === DeathState.DEAD) {
        // Decrement timer
        const expired = animations.decrementDeathTimer(i, deltaTime);
        
        if (expired) {
          // Transition to RESPAWNING state
          animations.setDeathState(i, DeathState.RESPAWNING);
          
          // Call respawn handler (outside this function for separation of concerns)
          respawnCallback(i);
        }

        // Lock health at 0 (no healing while dead)
        if (healthBuffer[i] !== 0) {
          health.setHealth(i, 0);
        }
      } else if (state === DeathState.RESPAWNING) {
        // Keep in RESPAWNING state until respawn is complete
        // (respawnCallback will transition back to ALIVE)
      }
    }
  }

  /**
   * Process inventory mutations from command queue
   * 
   * Lane B: Inventory DOD
   * - PICKUP: Find empty slot, place itemId
   * - DROP: Clear equipped slot, move to ground
   * - All operations directly mutate gridBuffer (Uint16Array)
   * 
   * @param inventory - InventoryStorage (grid + metadata)
   * @param commands - Queue of inventory commands
   * @param health - HealthStorage (ignore commands for dead players)
   * @param animations - AnimationEffectStorage (check if player alive)
   * @returns array of dropped items for world spawn
   */
  static processInventoryCommands(
    inventory: InventoryStorage,
    commands: InventoryCommand[],
    health: HealthStorage,
    animations: AnimationEffectStorage
  ): Array<{ playerHandle: number; itemId: number; slotIndex: number }> {
    const droppedItems: Array<{ playerHandle: number; itemId: number; slotIndex: number }> = [];

    // O(M) where M = number of pending commands
    for (const cmd of commands) {
      // Map handle to dense index (assumed external translation)
      const denseIndex = cmd.playerHandle; // TODO: use registry.getDenseIndex(handle)

      // Skip commands for dead players (can't use inventory while dead)
      if (animations.isDead(denseIndex)) {
        continue;
      }

      switch (cmd.type) {
        case CommandType.PICKUP: {
          // Find first empty slot in grid
          const emptySlot = inventory.findFirstEmptySlot(denseIndex);
          if (emptySlot >= 0) {
            // O(1) direct buffer mutation
            inventory.setGridItem(denseIndex, emptySlot, cmd.itemId);
          }
          // If no empty slots, item pickup fails (no log, no exception)
          break;
        }

        case CommandType.DROP: {
          // Get currently equipped slot
          const equippedSlot = inventory.getEquippedSlot(denseIndex);
          if (equippedSlot !== 255) {
            // Get itemId from grid
            const itemId = inventory.getGridItem(denseIndex, equippedSlot);
            if (itemId !== 0) {
              // O(1) direct buffer mutation - clear grid slot
              inventory.setGridItem(denseIndex, equippedSlot, 0);
              
              // Record dropped item for world spawn
              droppedItems.push({
                playerHandle: cmd.playerHandle,
                itemId,
                slotIndex: equippedSlot,
              });
              
              // Unequip the weapon
              inventory.setEquippedSlot(denseIndex, 255);
            }
          }
          break;
        }
      }
    }

    return droppedItems;
  }

  /**
   * Combined Gate 2 PHASE_RESOLVE execution
   * Called once per tick after all PHASE_COLLECT operations
   * 
   * Order:
   * 1. Process death animations (Lane A)
   * 2. Process inventory commands (Lane B)
   * 3. Return side effects (respawns, dropped items)
   * 
   * COMPLEXITY: O(N) for animations + O(M) for commands
   */
  static executePhaseResolve(params: {
    entities: EntityRegistry;
    health: HealthStorage;
    animations: AnimationEffectStorage;
    inventory: InventoryStorage;
    position: PositionStorage;
    inventoryCommands: InventoryCommand[];
    deltaTime: number;
    spawnRespawnedEntity: (denseIndex: number, spawnPos: [number, number, number]) => void;
  }): {
    respawnedEntities: number[];
    droppedItems: Array<{ playerHandle: number; itemId: number; slotIndex: number }>;
  } {
    const respawnedEntities: number[] = [];

    // Lane A: Death Animations
    this.processDeathAnimations(
      params.entities,
      params.health,
      params.animations,
      params.deltaTime,
      (denseIndex: number) => {
        respawnedEntities.push(denseIndex);
        
        // Spawn at fixed respawn location (0, 1, 0)
        const spawnPos: [number, number, number] = [0, 1, 0];
        params.spawnRespawnedEntity(denseIndex, spawnPos);
      }
    );

    // Lane B: Inventory Commands
    const droppedItems = this.processInventoryCommands(
      params.inventory,
      params.inventoryCommands,
      params.health,
      params.animations
    );

    return { respawnedEntities, droppedItems };
  }
}
