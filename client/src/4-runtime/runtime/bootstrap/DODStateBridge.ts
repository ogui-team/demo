import type { StateManager } from '../../../0-foundation/foundation/state/StateManager';
import { SCHEMA_PATHS } from '../../../0-foundation/foundation/state/hydrateStateManager';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { EntityHandle, SimulationKernel } from '@engine/1-kernel/core/public-api';

interface KernelBridgeAdapter {
  getKernel(): SimulationKernel;
  getPlayerHandle(playerId: string): EntityHandle | null;
}

interface DODStateBridgeConfig {
  kernelBridge: KernelBridgeAdapter;
  stateManager: StateManager;
  getPlayerId: () => string | null;
  getActivePhase: () => string;
}

export class DODStateBridge {
  private readonly kernelBridge: KernelBridgeAdapter;
  private readonly stateManager: StateManager;
  private readonly getPlayerId: () => string | null;
  private readonly getActivePhase: () => string;
  private accumulator = 0;

  constructor(config: DODStateBridgeConfig) {
    this.kernelBridge = config.kernelBridge;
    this.stateManager = config.stateManager;
    this.getPlayerId = config.getPlayerId;
    this.getActivePhase = config.getActivePhase;

    gameBus.on('GLOBAL_STATE_REFRESH', () => {
      this.syncNow('GLOBAL_STATE_REFRESH');
    });
    gameBus.on('STATE_UPDATE', () => {
      this.syncNow('STATE_UPDATE');
    });
    // Run an initial sync as soon as the state tree is fully hydrated.
    // This ensures DOD buffers are reflected in StateManager before the first
    // frame that any system or UI reads health/ammo values.
    gameBus.on('STATE_HYDRATION_COMPLETE', () => {
      this.syncNow('STATE_HYDRATION_COMPLETE');
    });
    // ─ AWAIT-READY HANDSHAKE: Trigger forced buffer hydration when snapshot is verified ─
    gameBus.on('SYNC_VERIFIED', ({ playerId, tick, networkEntityId }: any) => {
      console.log('[DODStateBridge] SYNC_VERIFIED received - forcing buffer hydration', {
        playerId,
        tick,
        networkEntityId,
      });
      // Immediately sync DOD buffers into StateManager
      this.syncNow('SYNC_VERIFIED');
      // Emit event to signal that buffers are now properly initialized
      gameBus.emit('FORCE_BUFFER_HYDRATION', {
        playerId,
        tick,
        networkEntityId,
        reason: 'Snapshot verification complete - buffers hydrated from kernel',
        timestamp: Date.now(),
      });
    });
  }

  update(dt: number): void {
    this.accumulator += dt;
    if (this.accumulator < 0.05) {
      return;
    }
    this.accumulator = 0;
    this.syncNow('tick');
  }

  private syncNow(source: string): void {
    const phase = this.getActivePhase();
    // Allow sync from SPAWN_READY onwards (not just PLAY_ACTIVE) so that the
    // state tree reflects DOD buffer data as soon as a player entity exists —
    // this prevents the UI from showing schema-default values (e.g. hp=100)
    // for one frame after transitioning to PLAY_ACTIVE.
    if (phase !== 'PLAY_ACTIVE' && phase !== 'SPAWN_READY' && source !== 'STATE_HYDRATION_COMPLETE') {
      return;
    }

    const playerId = this.getPlayerId();
    if (!playerId) {
      return;
    }

    const kernel = this.kernelBridge.getKernel();
    const handle = this.kernelBridge.getPlayerHandle(playerId);
    if (handle == null) {
      return;
    }

    const dense = kernel.entities.getDenseIndex(handle);
    if (dense < 0) {
      return;
    }

    const health = Math.max(0, Math.floor(kernel.healths.getHealth(dense)));
    const maxHealth = Math.max(0, Math.floor(kernel.healths.getMaxHealth(dense)));
    const ammo = Math.max(0, Math.floor(kernel.inventories.getAmmo(dense)));
    const itemId = Math.max(0, Math.floor(kernel.inventories.getItemId(dense)));

    // Use SCHEMA_PATHS constants — no hardcoded strings in the sync loop.
    this.stateManager.set(SCHEMA_PATHS.healthHp(playerId), health);
    this.stateManager.set(SCHEMA_PATHS.healthMaxHp(playerId), maxHealth);
    this.stateManager.set(SCHEMA_PATHS.PLAYERS_LOCAL_HEALTH, health);
    this.stateManager.set(SCHEMA_PATHS.PLAYERS_LOCAL_MAX_HEALTH, maxHealth);
    this.stateManager.set(SCHEMA_PATHS.DIAGNOSTICS_AMMO_CURRENT, ammo);
    this.stateManager.set(SCHEMA_PATHS.DIAGNOSTICS_AMMO_ITEM_ID, itemId);
    this.stateManager.set(SCHEMA_PATHS.playerInventoryKernel(playerId), {
      handle,
      dense,
      ammo,
      itemId,
      source,
      timestamp: Date.now(),
    });
  }
}
