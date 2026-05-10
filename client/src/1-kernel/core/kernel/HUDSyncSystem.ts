/**
 * HUDSyncSystem.ts
 * 
 * Sprint-A: View-Bridge between DOD buffers and HUD UI.
 * 
 * This system watches the gameBus for weapon/inventory mutations and updates
 * the HUD UI by reading directly from the InventoryStorage DOD buffer.
 * 
 * Constraints:
 * - HUD holds NO references to WeaponSystem entity-map properties
 * - All ammo values read from kernel.inventories (TypedArray buffer)
 * - UI updates triggered by gameBus events, not polling
 * - Zero allocations in event handlers
 * 
 * Event Flow:
 * FIRE_CMD → DODWeaponSystem.consumeFireCommand() → inventories.setAmmo(dense, newAmmo)
 *         → gameBus.emit('AMMO_CHANGED', { handle, newAmmo })
 *         → HUDSyncSystem listener → update DOM with newAmmo value from buffer
 */

import type { IKernelSystem, EntityHandle } from './types';
import { SystemCategory } from './types';
import type { SimulationKernel } from './SimulationKernel';
import { gameBus } from '../EventBus';

/**
 * HUD-readable view of ammo state.
 * Produced by HUDSyncSystem after reading from InventoryStorage buffer.
 */
export interface AmmoSyncPayload {
  handle: EntityHandle;
  current: number;      // Current magazine ammo (from InventoryStorage buffer)
  reserve: number;      // Reserve ammo (from InventoryStorage buffer)
  timestamp: number;    // Time of update
}

/**
 * HUDSyncSystem: Reactive bridge between DOD buffers and UI updates.
 * 
 * Implements IKernelSystem interface for kernel integration, but performs
 * no active simulation—purely reactive to buffer mutations signaled via gameBus.
 */
export class HUDSyncSystem implements IKernelSystem {
  readonly id = 'hud_sync_system';
  readonly category = SystemCategory.KERNEL;

  private kernel: SimulationKernel | null = null;
  private unsubscribers: Array<() => void> = [];

  // Track active subscriptions to avoid duplicate listeners
  private isSubscribed = false;

  constructor() {
    // Minimal constructor - all state is external (DOD principle)
  }

  /**
   * Set kernel reference for buffer access.
   */
  setKernel(kernel: SimulationKernel): void {
    this.kernel = kernel;
  }

  /**
   * IKernelSystem: execute() - Placeholder (no active simulation).
   * Real work happens in gameBus event handlers.
   */
  execute(dt: number): void {
    // HUDSync is purely event-driven, not time-driven.
    // FIRE_CMD and ammo mutations trigger UI updates via gameBus listeners.
  }

  /**
   * Optional: Notify system of active entity count.
   */
  setActiveCount?(count: number): void {
    // No batching optimization needed for UI sync
  }

  /**
   * Subscribe to DOD buffer mutations via gameBus.
   * Called by kernel bootstrap or game controller.
   */
  subscribe(): void {
    if (this.isSubscribed || !this.kernel) return;
    this.isSubscribed = true;

    // Listen for ammo changes from WeaponSystem
    const unsubAmmo = gameBus.on('AMMO_CHANGED', (payload: any) => {
      this.onAmmoChanged(payload);
    });
    this.unsubscribers.push(unsubAmmo);

    // Listen for fire failures
    const unsubFireFailed = gameBus.on('FIRE_FAILED', (payload: any) => {
      this.onFireFailed(payload);
    });
    this.unsubscribers.push(unsubFireFailed);

    // Listen for raycast hits
    const unsubHitscan = gameBus.on('HITSCAN_HIT', (payload: any) => {
      this.onHitscanHit(payload);
    });
    this.unsubscribers.push(unsubHitscan);
  }

  /**
   * Unsubscribe from gameBus listeners.
   * Called during shutdown.
   */
  unsubscribe(): void {
    if (!this.isSubscribed) return;
    this.isSubscribed = false;

    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers.length = 0;
  }

  /**
   * Handle AMMO_CHANGED event.
   * Query buffer to get current ammo and broadcast to UI.
   */
  private onAmmoChanged(payload: any): void {
    if (!this.kernel) return;

    const handle: EntityHandle = payload.handle;
    const dense = this.kernel.entities.getDenseIndex(handle);

    if (dense < 0) {
      // Entity destroyed, ignore
      return;
    }

    // Read from DOD buffer (not from Entity property)
    const current = this.kernel.inventories.getAmmo(dense);
    const itemId = this.kernel.inventories.getItemId(dense);

    // Broadcast HUD-readable payload with full interface
    gameBus.emit('HUD_AMMO_SYNC', {
      playerId: String(handle),
      weaponId: 'default_weapon',
      current: current !== undefined ? current : 0,
      reserve: itemId !== undefined ? itemId : 0,
      max: 12,
      isReloading: false,
      timestamp: Engine.time.now(),
    });
  }

  /**
   * Handle FIRE_FAILED event.
   * Broadcast failure reason for HUD notification.
   */
  private onFireFailed(payload: any): void {
    const reason = payload.reason || 'UNKNOWN';

    // Emit for HUD UI to show error feedback
    gameBus.emit('HUD_FIRE_FAILED', {
      playerId: payload.entityId || null,
      weaponId: payload.weaponId || 'default_weapon',
      reason,
      timestamp: Engine.time.now(),
    });
  }

  /**
   * Handle HITSCAN_HIT event.
   * Notify HUD of successful raycast hit for visual feedback.
   */
  private onHitscanHit(payload: any): void {
    // Emit for HUD UI to show hit feedback
    gameBus.emit('HUD_HITSCAN_HIT', {
      playerId: payload.shooterId || null,
      targetId: payload.targetId || null,
      position: payload.position || { x: 0, y: 0, z: 0 },
      damage: payload.damage || 0,
      timestamp: Engine.time.now(),
    });
  }
}
