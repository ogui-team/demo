/**
 * InventoryDropManager.ts
 *
 * Unified orchestrator for all item drops across the client.
 * Single entry point whether items are dropped from:
 * - Grid inventory UI (InventoryGridManager)
 * - GAS backpack/equipped slots (ItemInstanceSystem)
 * - World ground rearranging (future extension)
 *
 * Responsibilities:
 * 1. Fetch full ItemInstance from the item system
 * 2. Build UnifiedItemDropRequest with complete data
 * 3. Validate drop request (bounds, inventory state, idempotency)
 * 4. Send authoritative request to server
 * 5. Wait for server confirmation via WORLD_OBJECT_PLACE broadcast
 * 6. Remove from local inventory only after server confirms
 */

import type { ItemInstanceSystem } from './gas/ItemInstanceSystem';
import type { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import type { EquipSlot, UUID } from './gas/CombatTypes';
import type { Vec3 } from '../../../3-network/network/MultiplayerClient';
import type { GridItem } from './InventoryGridManager';
import type { UnifiedItemDropRequest } from './InventoryDropContract';
import { validateDropRequest } from './InventoryDropContract';

/**
 * Idempotency record: tracks drop requests by ID to detect duplicates.
 */
interface DropRequestRecord {
  requestId: string;
  timestamp: number;
  playerId: string;
}

export class InventoryDropManager {
  /** Maps dropRequestId → request metadata for idempotency detection. */
  private readonly pendingDropRequests = new Map<string, DropRequestRecord>();

  /** TTL for idempotency records (ms); old entries are cleaned up. */
  private readonly IDEMPOTENCY_TTL = 30_000;  // 30 seconds

  /**
   * Optional fallback invoked when not connected to multiplayer.
   * Receives the world drop position and item template ID.
   * Bootstrapper wires this to WorldObjectAuthorityService.spawnOrUpdateRemoteObject
   * so items physically appear on the ground in freeplay / offline mode.
   */
  localSpawnFallback: ((position: Vec3, templateId: string) => void) | null = null;

  constructor(
    private itemInstanceSystem: ItemInstanceSystem,
    private multiplayerClient: MultiplayerClient | null,
  ) {
    this._startCleanupTimer();
  }

  /**
   * Unified entry point for dropping items from inventory (backpack or equipped).
   *
   * Steps:
   *   1. Fetch full ItemInstance from ItemInstanceSystem
   *   2. Validate drop request (bounds, inventory state, idempotency)
   *   3. Build UnifiedItemDropRequest
   *   4. Send to server (NO optimistic local removal)
   *   5. Server validates and spawns world object
   *   6. Client receives WORLD_OBJECT_PLACE and removes from inventory
   *
   * @returns true if request was sent, false if validation failed
   */
  async dropItem(
    playerId: string,
    itemUuid: UUID,
    sourceSlot: EquipSlot | 'backpack',
    worldPosition: Vec3,
  ): Promise<boolean> {
    // ── 1. Fetch the full item instance ───────────────────────────────────
    const itemInstance = this.itemInstanceSystem.getInstance(itemUuid);
    if (!itemInstance) {
      console.warn(`[InventoryDropManager] Item not found in instance store: ${itemUuid}`);
      return false;
    }

    return this.sendDropRequest({
      playerId,
      sourceSlot,
      itemInstance,
      position: { ...worldPosition },
      dropRequestId: this._generateDropRequestId(),
      timestamp: Date.now(),
    });
  }

  async dropGridItem(
    playerId: string,
    item: GridItem,
    worldPosition: Vec3,
  ): Promise<boolean> {
    return this.sendDropRequest({
      playerId,
      sourceSlot: 'backpack',
      itemInstance: this.buildGridItemInstance(item),
      position: { ...worldPosition },
      dropRequestId: this._generateDropRequestId(),
      timestamp: Date.now(),
    });
  }

  private buildGridItemInstance(item: GridItem): UnifiedItemDropRequest['itemInstance'] {
    const metadataInstance = item.metadata?.itemInstance;
    if (metadataInstance && typeof metadataInstance === 'object') {
      const candidate = metadataInstance as Record<string, unknown>;
      return {
        uuid: typeof candidate.uuid === 'string' ? candidate.uuid : item.instanceId,
        templateId: typeof candidate.templateId === 'string' ? candidate.templateId : item.itemId,
        level: typeof candidate.level === 'number' ? candidate.level : 1,
        rarity: typeof candidate.rarity === 'string' ? candidate.rarity as UnifiedItemDropRequest['itemInstance']['rarity'] : 'Common',
        affixes: Array.isArray(candidate.affixes) ? candidate.affixes as UnifiedItemDropRequest['itemInstance']['affixes'] : [],
        abilityIdOverride: typeof candidate.abilityIdOverride === 'string' || candidate.abilityIdOverride === null
          ? candidate.abilityIdOverride as UnifiedItemDropRequest['itemInstance']['abilityIdOverride']
          : undefined,
        currentAmmo: typeof candidate.currentAmmo === 'number' ? candidate.currentAmmo : undefined,
        reserveAmmo: typeof candidate.reserveAmmo === 'number' ? candidate.reserveAmmo : undefined,
        lastModified: typeof candidate.lastModified === 'number' ? candidate.lastModified : Date.now(),
      };
    }

    return {
      uuid: item.instanceId,
      templateId: item.itemId,
      level: 1,
      rarity: 'Common',
      affixes: [],
      lastModified: Date.now(),
    };
  }

  private sendDropRequest(request: UnifiedItemDropRequest): Promise<boolean> {
    return Promise.resolve().then(() => {
      // ── 3. Validate the request ───────────────────────────────────────────
      const validation = validateDropRequest(request);
      if (!validation.valid) {
        console.warn(`[InventoryDropManager] Invalid drop request: ${validation.reason}`);
        return false;
      }

      // ── 4. Check idempotency (duplicate drop command?) ────────────────────
      if (this.pendingDropRequests.has(request.dropRequestId)) {
        console.warn(`[InventoryDropManager] Duplicate drop request (already pending): ${request.dropRequestId}`);
        return false;
      }

      // ── 5. Send to server (NO local mutation yet) ──────────────────────────
      if (!this.multiplayerClient?.connected) {
        // Spawn a local ground entity so the item is visible (freeplay / offline).
        // Return false so InventoryGridManager falls through to the REST path
        // which removes the item from the server inventory.
        if (this.localSpawnFallback) {
          this.localSpawnFallback(request.position, request.itemInstance.templateId);
        } else {
          console.warn('[InventoryDropManager] Not connected to multiplayer server; no localSpawnFallback set');
        }
        return false;
      }

      // Record as pending
      this.pendingDropRequests.set(request.dropRequestId, {
        requestId: request.dropRequestId,
        timestamp: Date.now(),
        playerId: request.playerId,
      });

      // Send the request
      this.multiplayerClient.sendLobbyAction('DROP_ITEM', request as unknown as Record<string, unknown>);

      console.log(
        `[InventoryDropManager] Drop request sent: ${request.itemInstance.uuid} from ${request.sourceSlot} ` +
        `@ (${request.position.x.toFixed(1)}, ${request.position.y.toFixed(1)}, ${request.position.z.toFixed(1)})`,
      );

      // ── 6. Server is now authoritative ────────────────────────────────────
      // Client will receive INVENTORY_SYNC and WORLD_OBJECT_PLACE from server.

      return true;
    });
  }

  /**
   * Called by the network layer when a drop request completes/times out.
   * Removes the request from the pending set.
   */
  markDropRequestCompleted(dropRequestId: string): void {
    this.pendingDropRequests.delete(dropRequestId);
  }

  /**
   * Generate a unique ID for this drop request.
   * Used for idempotency: if network retransmits, server recognizes duplicate.
   */
  private _generateDropRequestId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `drop_${timestamp}_${random}`;
  }

  /**
   * Periodically clean up old pending drop requests (older than IDEMPOTENCY_TTL).
   * Prevents the map from growing unbounded if drop confirmations are lost.
   */
  private _startCleanupTimer(): void {
    setInterval(() => {
      const now = Date.now();
      const expired: string[] = [];

      for (const [requestId, record] of this.pendingDropRequests.entries()) {
        if (now - record.timestamp > this.IDEMPOTENCY_TTL) {
          expired.push(requestId);
        }
      }

      for (const requestId of expired) {
        this.pendingDropRequests.delete(requestId);
        console.log(`[InventoryDropManager] Cleaned up expired drop request: ${requestId}`);
      }
    }, 10_000);  // Cleanup every 10 seconds
  }
}
