/**
 * SpawnPointRegistry: Deterministic player spawn offset calculation
 * 
 * Manages spawn indices and calculates spatial offsets for players joining the game.
 * Uses a circular distribution pattern to spread players around a base spawn point.
 */

import type { Vec3 } from '../sessionContracts';

export class SpawnPointRegistry {
  private spawnIndexMap: Map<string, number> = new Map();
  private nextSpawnIndex = 0;
  private readonly SPAWN_OFFSET_DISTANCE = 3.5; // Units offset per player index

  /**
   * Register a player spawn by ID, returning their spawn index.
   * Multiple calls with the same playerId return the same index.
   */
  registerPlayerSpawn(playerId: string): number {
    if (this.spawnIndexMap.has(playerId)) {
      return this.spawnIndexMap.get(playerId)!;
    }
    const index = this.nextSpawnIndex++;
    this.spawnIndexMap.set(playerId, index);
    console.log('[SpawnPointRegistry] Player spawn registered', {
      playerId,
      assignedIndex: index,
      totalRegistered: this.spawnIndexMap.size,
      timestamp: Date.now(),
    });
    return index;
  }

  /**
   * Remove a player from the spawn registry (cleanup on disconnect).
   */
  unregisterPlayerSpawn(playerId: string): void {
    this.spawnIndexMap.delete(playerId);
  }

  /**
   * Calculate a deterministic spatial offset for a player based on their spawn index.
   * Distributes players in a circular pattern around the base spawn point.
   */
  calculateDeterministicOffset(spawnIndex: number, basePoint: Vec3): Vec3 {
    // Distribute players in a circular pattern around the base spawn point
    const anglePerPlayer = (Math.PI * 2) / Math.max(4, Math.ceil(spawnIndex / 2));
    const angle = (spawnIndex % 4) * anglePerPlayer;
    const radius = Math.floor(spawnIndex / 4) * this.SPAWN_OFFSET_DISTANCE;
    
    return {
      x: basePoint.x + Math.cos(angle) * radius,
      y: basePoint.y,
      z: basePoint.z + Math.sin(angle) * radius,
    };
  }

  /**
   * Get diagnostic information about spawn registry state.
   */
  getDiagnostics(): Record<string, unknown> {
    return {
      totalRegistered: this.spawnIndexMap.size,
      nextIndex: this.nextSpawnIndex,
      offsetDistance: this.SPAWN_OFFSET_DISTANCE,
      spawnedPlayers: Array.from(this.spawnIndexMap.entries()),
    };
  }
}
