/**
 * SnapshotWriter.ts
 * ═════════════════════════════════════════════════════════════════════════════
 * 
 * v0.1.7: Write kernel state to JSON snapshots
 * Inverse of SnapshotReader - for serialization
 * 
 * Use case:
 *   - Server sends state to client
 *   - Replay system records game state
 *   - Save/load persistence
 */

import type { SimulationKernel, EntityHandle } from '@engine/1-kernel/core/public-api';

export interface KernelSnapshot {
  tick: number;
  timestamp: number;
  entities: Array<{
    handle: EntityHandle;
    denseIndex: number;
    position: [number, number, number];
    velocity: [number, number, number];
    health: number;
    maxHealth: number;
    ammo: number;
  }>;
  stateHash?: number;
}

export class SnapshotWriter {
  /**
   * Capture complete kernel state to snapshot
   */
  static captureSnapshot(kernel: SimulationKernel, tick: number): KernelSnapshot {
    const entities: KernelSnapshot['entities'] = [];

    // Get all dense indices from entity registry
    // Iterate through the handles sparse set by checking each potential index
    const maxHandles = 4096; // reasonable upper bound for sparse set
    for (let handle = 1; handle < maxHandles; handle++) {
      const denseIndex = kernel.entities.getDenseIndex(handle);
      if (denseIndex < 0) continue; // Not a valid entity

      // Read all component data
      const posBuffer = kernel.positions.getReadBuffer();
      const velBuffer = kernel.velocities.getBuffer();
      const health = kernel.healths.getHealth(denseIndex);
      const maxHealth = kernel.healths.getMaxHealth(denseIndex);

      const posX = posBuffer[denseIndex * 3] ?? 0;
      const posY = posBuffer[denseIndex * 3 + 1] ?? 0;
      const posZ = posBuffer[denseIndex * 3 + 2] ?? 0;

      const velX = velBuffer[denseIndex * 3] ?? 0;
      const velY = velBuffer[denseIndex * 3 + 1] ?? 0;
      const velZ = velBuffer[denseIndex * 3 + 2] ?? 0;

      const ammoBuffer = kernel.inventories.getAmmoBuffer();
      const ammo = ammoBuffer[denseIndex] ?? 0;

      entities.push({
        handle,
        denseIndex,
        position: [posX, posY, posZ],
        velocity: [velX, velY, velZ],
        health,
        maxHealth,
        ammo,
      });
    }

    const snapshot: KernelSnapshot = {
      tick,
      timestamp: Engine.time.now(),
      entities,
    };

    return snapshot;
  }

  /**
   * Serialize snapshot to JSON string
   */
  static stringify(snapshot: KernelSnapshot): string {
    return JSON.stringify(snapshot);
  }

  /**
   * Deserialize from JSON
   */
  static parse(json: string): KernelSnapshot {
    return JSON.parse(json) as KernelSnapshot;
  }
}
