import { gameBus } from '@engine/1-kernel/core/public-api';

interface KernelHudSnapshot {
  ammo: number;
}

interface KernelHudAdapter {
  readHUDSnapshot(playerId: string): KernelHudSnapshot | null;
}

interface InventoryHudSyncHubConfig {
  kernel: KernelHudAdapter;
  getPlayerId: () => string | null;
  getActivePhase: () => string;
}

export class InventoryHudSyncHub {
  private readonly kernel: KernelHudAdapter;
  private readonly getPlayerId: () => string | null;
  private readonly getActivePhase: () => string;
  private accumulator = 0;

  constructor(config: InventoryHudSyncHubConfig) {
    this.kernel = config.kernel;
    this.getPlayerId = config.getPlayerId;
    this.getActivePhase = config.getActivePhase;
  }

  update(dt: number): void {
    this.accumulator += dt;
    if (this.accumulator < 0.1) {
      return;
    }
    this.accumulator = 0;

    const phase = this.getActivePhase();
    if (phase !== 'PLAY_ACTIVE') {
      return;
    }

    const playerId = this.getPlayerId();
    if (!playerId) {
      return;
    }

    const snapshot = this.kernel.readHUDSnapshot(playerId);
    if (!snapshot) {
      return;
    }

    gameBus.emit('HUD_AMMO_SYNC', {
      playerId,
      weaponId: null,
      current: snapshot.ammo,
      reserve: 0,
      max: snapshot.ammo,
      isReloading: false,
      timestamp: Engine.time.now(),
    });
  }
}
