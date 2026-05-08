/**
 * DODWeaponSystem.ts
 * 
 * Sprint-A: Weapon system kernelization for v0.1.3.
 * 
 * Operates directly on TypedArray buffers (DOD pattern):
 * - Reads ammo from InventoryStorage buffer
 * - Performs raycast against PositionStorage buffer (DOD)
 * - Mutates ammo buffer (no Entity property access)
 * - Queues DAMAGE_CMD for HealthSystem processing
 * 
 * No allocations in execute() hot path.
 * Single responsibility: Process FIRE_CMD commands deterministically.
 */

import { SystemCategory, type IKernelSystem, type EntityHandle } from './types';
import type { SimulationKernel } from './SimulationKernel';
import { gameBus } from '../EventBus';

export class DODWeaponSystem implements IKernelSystem {
  // IKernelSystem interface properties
  readonly id = 'weapon_system';
  readonly category = SystemCategory.KERNEL;

  // Reference to kernel for DOD operations (Sprint-A)
  private kernel: SimulationKernel | null = null;

  // Reuse scratch Vector3 objects to avoid allocations (DOD principle)
  private readonly scratchOrigin = { x: 0, y: 0, z: 0 };
  private readonly scratchDistance = { x: 0, y: 0, z: 0 };

  constructor() {
    // Minimal constructor - all state is external (no instance data)
  }

  /**
   * Set kernel reference for DOD operations.
   * Called during bootstrap to link system to SimulationKernel.
   */
  setKernel(kernel: SimulationKernel): void {
    this.kernel = kernel;
  }

  /**
   * IKernelSystem: execute() called each frame by kernel.tickOnce().
   * Currently a placeholder - FIRE_CMD processing happens via consumeFireCommand().
   */
  execute(dt: number): void {
    if (!this.kernel) return;

    // Sprint-A: Actual FIRE_CMD processing is triggered by kernel's command dispatcher.
    // This method will expand in Sprint-B for passive systems (cooldown decrement, etc).
  }

  /**
   * Optional: Notify system of active entity count for optimization.
   */
  setActiveCount?(count: number): void {
    // Could preallocate raycast result buffers based on active count
  }

  /**
   * Consume a single FIRE_CMD command.
   * Called by SimulationKernel during command draining.
   */
  consumeFireCommand(cmd: {
    handle: EntityHandle;
    targetPos: [number, number, number];
    source: string;
  }): void {
    if (!this.kernel) return;

    const dense = this.kernel.entities.getDenseIndex(cmd.handle);
    if (dense < 0) return; // Entity destroyed

    // Step 1: Validate ammo
    const ammo = this.kernel.inventories.getAmmo(dense);
    if (ammo < 1) {
      // No ammo - fire fails
      gameBus.emit('FIRE_FAILED', {
        entityId: String(cmd.handle),
        weaponId: 'default_weapon',
        reason: 'NO_AMMO',
        timestamp: Date.now(),
      });
      return;
    }

    // Step 2: Get shooter position from DOD buffer
    const shooterPos = this.getEntityPosition(dense);
    if (!shooterPos) {
      gameBus.emit('FIRE_FAILED', {
        entityId: String(cmd.handle),
        weaponId: 'default_weapon',
        reason: 'NO_POSITION',
        timestamp: Date.now(),
      });
      return;
    }

    // Step 3: Raycast against PositionStorage DOD buffer
    const hitTarget = this.rayCastDOD(shooterPos, cmd.targetPos);

    // Step 4: Decrement ammo (DOD buffer mutation)
    const newAmmo = ammo - 1;
    this.kernel.inventories.setAmmo(dense, newAmmo);

    // Emit AMMO_CHANGED event for HUD sync (View-Bridge pattern)
    gameBus.emit('AMMO_CHANGED', {
      entityId: String(cmd.handle),
      weaponId: 'default_weapon',
      current: newAmmo,
      reserve: 100,
      max: 12,
      isReloading: false,
    });

    if (hitTarget !== null) {
      // HIT: Queue DAMAGE_CMD for target
      this.kernel.enqueueCommand(
        0, // System-generated seq
        Date.now(),
        'system',
        'DAMAGE_CMD',
        null,
        { handle: hitTarget.handle, amount: 25, source: cmd.handle }
      );

      // Emit HITSCAN_HIT event for replication
      gameBus.emit('HITSCAN_HIT', {
        shooterId: String(cmd.handle),
        targetId: String(hitTarget.handle),
        position: { x: hitTarget.position[0], y: hitTarget.position[1], z: hitTarget.position[2] },
        damage: 25,
        timestamp: Date.now(),
      });
    } else {
      // MISS: Emit event only
      gameBus.emit('HITSCAN_MISS', {
        shooterId: String(cmd.handle),
        position: { x: shooterPos[0], y: shooterPos[1], z: shooterPos[2] },
        direction: { x: cmd.targetPos[0], y: cmd.targetPos[1], z: cmd.targetPos[2] },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get entity position from DOD buffer (PositionStorage).
   * Returns [x, y, z] or null if entity invalid.
   */
  private getEntityPosition(dense: number): [number, number, number] | null {
    if (!this.kernel || dense < 0) return null;

    const posBuffer = this.kernel.positions.getReadBuffer();
    const idx = dense * 3;

    if (idx + 2 >= posBuffer.length) return null; // Out of bounds

    return [posBuffer[idx], posBuffer[idx + 1], posBuffer[idx + 2]];
  }

  /**
   * Simple raycast against PositionStorage DOD buffer.
   * Linear approximation: Find closest entity along ray direction.
   *
   * Returns { handle, position } if hit, null if miss.
   */
  private rayCastDOD(
    origin: [number, number, number],
    targetPos: [number, number, number]
  ): { handle: EntityHandle; position: [number, number, number] } | null {
    if (!this.kernel) return null;

    // Ray parameters
    const rayDir = [
      targetPos[0] - origin[0],
      targetPos[1] - origin[1],
      targetPos[2] - origin[2],
    ];

    const rayLength = Math.sqrt(rayDir[0] ** 2 + rayDir[1] ** 2 + rayDir[2] ** 2);
    if (rayLength === 0) return null; // Degenerate ray

    // Normalize ray direction
    rayDir[0] /= rayLength;
    rayDir[1] /= rayLength;
    rayDir[2] /= rayLength;

    const MAX_DISTANCE = rayLength * 1.1; // Allow slight overshoot
    const HIT_RADIUS = 1.0; // Bounding sphere radius for entities

    let closestDist = Infinity;
    let closestHandle: EntityHandle | null = null;
    let closestPos: [number, number, number] | null = null;

    // Iterate all entities via PositionStorage buffer
    const posBuffer = this.kernel.positions.getReadBuffer();
    const entityRegistry = this.kernel.entities;
    const activeCount = entityRegistry.activeCount;

    for (let dense = 0; dense < activeCount; dense += 1) {
      // Get entity position from buffer
      const idx = dense * 3;
      if (idx + 2 >= posBuffer.length) continue;

      const entityPos: [number, number, number] = [
        posBuffer[idx],
        posBuffer[idx + 1],
        posBuffer[idx + 2],
      ];

      // Simple spherical hit test: project entity onto ray
      const toEntity = [
        entityPos[0] - origin[0],
        entityPos[1] - origin[1],
        entityPos[2] - origin[2],
      ];

      // Dot product along ray direction
      const projectionDist =
        toEntity[0] * rayDir[0] + toEntity[1] * rayDir[1] + toEntity[2] * rayDir[2];

      // Skip if behind ray origin or beyond max distance
      if (projectionDist < 0 || projectionDist > MAX_DISTANCE) continue;

      // Perpendicular distance from ray
      const perpDist = Math.sqrt(
        toEntity[0] ** 2 + toEntity[1] ** 2 + toEntity[2] ** 2 - projectionDist ** 2
      );

      // Check if sphere intersects ray
      if (perpDist <= HIT_RADIUS && projectionDist < closestDist) {
        closestDist = projectionDist;
        closestHandle = entityRegistry.getHandleByDenseIndex(dense);
        closestPos = entityPos;
      }
    }

    if (closestHandle !== null && closestPos !== null) {
      return {
        handle: closestHandle,
        position: closestPos,
      };
    }

    return null;
  }
}
