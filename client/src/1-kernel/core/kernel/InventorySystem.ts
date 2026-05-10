import { EntityRegistry } from './EntityRegistry';
import { InventoryStorage } from './InventoryStorage';
import type { BufferSystem, EntityHandle, KernelCommandConsumer } from './types';
import { gameBus } from '../EventBus';

interface UseItemCommandPayload {
  handle?: unknown;
  itemId?: unknown;
  amount?: unknown;
}

interface InventorySystemConfig {
  entityRegistry: EntityRegistry;
  inventoryStorage: InventoryStorage;
  resolveHandleByPlayerId?: (playerId: string) => EntityHandle | null;
  isReady?: () => boolean;
}

interface InventorySnapshotData {
  ammo?: number;
  itemId?: number;
  source?: string;
  timestamp?: number;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export class InventorySystem implements BufferSystem {
  readonly id = 'inventorySystem';

  private readonly entityRegistry: EntityRegistry;
  private readonly inventoryStorage: InventoryStorage;
  private readonly resolveHandleByPlayerId?: (playerId: string) => EntityHandle | null;
  private readonly isReady?: () => boolean;
  private readonly pendingInventoryMap = new Map<string, InventorySnapshotData[]>();
  private readonly latestHudAmmoByPlayerId = new Map<string, number>();
  private activeCount = 0;
  private isPlayActive = true;

  constructor(config: InventorySystemConfig) {
    this.entityRegistry = config.entityRegistry;
    this.inventoryStorage = config.inventoryStorage;
    this.resolveHandleByPlayerId = config.resolveHandleByPlayerId;
    this.isReady = config.isReady;

    gameBus.on('FULL_SYNC_DATA', ({ playerId }) => {
      if (!playerId) {
        return;
      }

      this.inventoryStorage.getAmmoBuffer().fill(0);
      this.inventoryStorage.getItemIdBuffer().fill(0);

      const handle = this.resolveHandleByPlayerId?.(playerId) ?? null;
      if (handle == null) {
        this.flushPendingSnapshotData(playerId);
        console.warn(`[InventorySystem] InventoryBuffer[handle] = 0 (handle missing for playerId=${playerId})`);
        return;
      }

      const dense = this.entityRegistry.getDenseIndex(handle);
      if (dense < 0) {
        console.warn(`[InventorySystem] InventoryBuffer[handle] = 0 (invalid dense index for handle=${handle})`);
        return;
      }

      if (this.inventoryStorage.getAmmo(dense) === 0) {
        console.warn(`[InventorySystem] InventoryBuffer[handle] = 0 (handle=${handle}, dense=${dense})`);
      }

      this.forceUpdateBuffer(playerId);
      gameBus.emit('GLOBAL_STATE_REFRESH', {
        source: 'InventorySystem.FULL_SYNC_DATA',
        playerId,
        timestamp: Engine.time.now(),
      });
    });

    gameBus.on('networkInventorySyncReceived', ({ inventory }) => {
      for (const [netId, data] of Object.entries(inventory ?? {})) {
        if (!data || typeof data !== 'object') {
          continue;
        }

        const raw = data as Record<string, unknown>;
        const ammo = this.extractNumeric(raw, ['ammo', 'currentAmmo', 'current']);
        const itemId = this.extractNumeric(raw, ['itemId', 'activeItemId']);

        if (ammo == null && itemId == null) {
          continue;
        }

        this.queueSnapshotData(netId, {
          ammo: ammo ?? undefined,
          itemId: itemId ?? undefined,
          source: 'networkInventorySyncReceived',
          timestamp: Engine.time.now(),
        });
      }
    });

    gameBus.on('ammoStateSyncBridge', ({ playerId, currentAmmo }) => {
      this.queueSnapshotData(playerId, {
        ammo: typeof currentAmmo === 'number' && Number.isFinite(currentAmmo) ? currentAmmo : undefined,
        source: 'ammoStateSyncBridge',
        timestamp: Engine.time.now(),
      });
    });

    gameBus.on('HUD_AMMO_SYNC', ({ playerId, current }) => {
      if (playerId && typeof current === 'number' && Number.isFinite(current)) {
        this.latestHudAmmoByPlayerId.set(playerId, current);
      }
    });

    gameBus.on('NETWORK_ENTITY_HANDLE_MAPPED', ({ playerId, networkEntityId }) => {
      this.flushPendingSnapshotData(playerId);
      this.flushPendingSnapshotData(String(networkEntityId));
    });

    gameBus.on('LIFECYCLE_CHANGED', ({ to }) => {
      this.isPlayActive = to === 'PLAY_ACTIVE';
      if (!this.isPlayActive) {
        this.inventoryStorage.getAmmoBuffer().fill(0);
        this.inventoryStorage.getItemIdBuffer().fill(0);
      }
    });

    gameBus.on('LIFECYCLE_PLAY_ACTIVE', () => {
      this.isPlayActive = true;
    });
  }

  readonly consumeCommand: KernelCommandConsumer = (
    _seq,
    _tick,
    _timestamp,
    _source,
    type,
    playerId,
    payload,
  ) => {
    // Phase-gate: Only process if system is ready
    if (this.isReady && !this.isReady()) {
      return;
    }

    if (type !== 'USE_ITEM_CMD') {
      return;
    }

    const usePayload = (payload ?? {}) as UseItemCommandPayload;
    const explicitHandle = typeof usePayload.handle === 'number' ? usePayload.handle : null;
    const resolvedHandle = explicitHandle
      ?? (playerId && this.resolveHandleByPlayerId ? this.resolveHandleByPlayerId(playerId) : null);

    if (resolvedHandle == null) {
      return;
    }

    const dense = this.entityRegistry.getDenseIndex(resolvedHandle);
    if (dense < 0) {
      return;
    }

    const itemId = toFiniteNumber(usePayload.itemId, 0);
    const amount = toFiniteNumber(usePayload.amount, 1);

    // Assuming using item reduces ammo by amount
    const currentAmmo = this.inventoryStorage.getAmmo(dense);
    const newAmmo = Math.max(0, currentAmmo - amount);
    this.inventoryStorage.setAmmo(dense, newAmmo);

    // Optionally set itemId if not set
    if (this.inventoryStorage.getItemId(dense) === 0) {
      this.inventoryStorage.setItemId(dense, itemId);
    }
  };

  setActiveCount(count: number): void {
    this.activeCount = count;
  }

  forceUpdateBuffer(playerId: string): void {
    if (!playerId) {
      return;
    }
    this.flushPendingSnapshotData(playerId);

    const handle = this.resolveHandleByPlayerId?.(playerId) ?? null;
    if (handle == null) {
      return;
    }

    const dense = this.entityRegistry.getDenseIndex(handle);
    if (dense < 0) {
      return;
    }

    this.validateHudSync(playerId, dense, handle);
  }

  queueSnapshotData(netId: string, data: InventorySnapshotData): void {
    if (!netId) {
      return;
    }

    const applied = this.tryApplySnapshotData(netId, data);
    if (applied) {
      return;
    }

    const queue = this.pendingInventoryMap.get(netId) ?? [];
    queue.push(data);
    this.pendingInventoryMap.set(netId, queue);
  }

  private flushPendingSnapshotData(netId: string): void {
    const queue = this.pendingInventoryMap.get(netId);
    if (!queue || queue.length === 0) {
      return;
    }

    const remaining: InventorySnapshotData[] = [];
    for (const data of queue) {
      const applied = this.tryApplySnapshotData(netId, data);
      if (!applied) {
        remaining.push(data);
      }
    }

    if (remaining.length > 0) {
      this.pendingInventoryMap.set(netId, remaining);
      return;
    }

    this.pendingInventoryMap.delete(netId);
  }

  private tryApplySnapshotData(netId: string, data: InventorySnapshotData): boolean {
    const handle = this.resolveHandleForNetId(netId);
    if (handle == null) {
      return false;
    }

    const dense = this.entityRegistry.getDenseIndex(handle);
    if (dense < 0) {
      return false;
    }

    if (typeof data.ammo === 'number' && Number.isFinite(data.ammo)) {
      this.inventoryStorage.setAmmo(dense, Math.max(0, Math.floor(data.ammo)));
    }
    if (typeof data.itemId === 'number' && Number.isFinite(data.itemId)) {
      this.inventoryStorage.setItemId(dense, Math.max(0, Math.floor(data.itemId)));
    }
    return true;
  }

  private resolveHandleForNetId(netId: string): EntityHandle | null {
    const byPlayerId = this.resolveHandleByPlayerId?.(netId) ?? null;
    if (byPlayerId != null) {
      return byPlayerId;
    }

    return this.entityRegistry.getHandleByNetworkId(netId);
  }

  private extractNumeric(source: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  }

  execute(_buffer: Float32Array, _dt: number): void {
    if (!this.isPlayActive) {
      return;
    }

    for (const playerId of this.latestHudAmmoByPlayerId.keys()) {
      const handle = this.resolveHandleByPlayerId?.(playerId) ?? null;
      if (handle == null) {
        continue;
      }
      const dense = this.entityRegistry.getDenseIndex(handle);
      if (dense < 0) {
        continue;
      }
      this.validateHudSync(playerId, dense, handle);
    }
  }

  private validateHudSync(playerId: string, dense: number, handle: EntityHandle): void {
    const ammoBuffer = this.inventoryStorage.getAmmoBuffer();
    const hudAmmo = this.latestHudAmmoByPlayerId.get(playerId) ?? 0;
    if (ammoBuffer[dense] > 0 && hudAmmo === 0) {
      console.error('HUD-DOD-Sync-Break', {
        playerId,
        handle,
        dense,
        ammoBuffer: ammoBuffer[dense],
        hudAmmo,
        timestamp: Engine.time.now(),
      });
    }
  }
}