/**
 * network/ClientItemDropCoordinator.ts
 *
 * Handles client-side item drop reconciliation.
 * Ensures items are NOT spawned locally until server validates and includes them in a snapshot.
 *
 * Architecture:
 * 1. Player requests dropItem()
 * 2. Send CMD_DROP_ITEM to server via MultiplayerClient
 * 3. Server validates and includes item in next AUTHORITATIVE_SNAPSHOT with ENTITY_SPAWNED
 * 4. Client receives snapshot, creates the item locally
 * 5. Never create items locally in multiplayer - wait for server validation
 */

import { gameBus } from '@engine/1-kernel/core/public-api';
import type { MultiplayerClient } from './MultiplayerClient';

export interface PendingItemDrop {
  requestId: string;
  playerId: string;
  itemId: string;
  position: { x: number; y: number; z: number };
  createdAt: number;
  timeout: ReturnType<typeof setTimeout>;
}

export class ClientItemDropCoordinator {
  private multiplayerClient: MultiplayerClient | null = null;
  private pendingDrops: Map<string, PendingItemDrop> = new Map();
  private readonly dropTimeoutMs = 5000; // 5 second timeout for server response

  /**
   * Initialize with MultiplayerClient instance.
   */
  init(mpClient: MultiplayerClient): void {
    this.multiplayerClient = mpClient;
  }

  /**
   * Initiate an item drop request.
   *
   * Flow:
   * 1. Client sends CMD_DROP_ITEM to server
   * 2. Server validates (ownership, position, etc)
   * 3. Server creates item entity and includes in snapshot
   * 4. Client receives AUTHORITATIVE_SNAPSHOT with item
   * 5. This method resolves the promise
   *
   * @returns Promise that resolves when item is confirmed by server
   */
  requestDropItem(
    itemId: string,
    position: { x: number; y: number; z: number },
    playerId: string,
  ): Promise<{ confirmed: boolean; entityId?: string }> {
    return new Promise((resolve, reject) => {
      if (!this.multiplayerClient) {
        reject(new Error('MultiplayerClient not initialized'));
        return;
      }

      const requestId = `drop_${itemId}_${Date.now()}`;

      // Create timeout handler
      const timeout = setTimeout(() => {
        this.pendingDrops.delete(requestId);
        reject(new Error(`Item drop timeout for ${itemId}`));
        console.warn(
          `[ItemDrop] Timeout waiting for server confirmation of item ${itemId}. ` +
          `This suggests the server did not include the item in the snapshot.`,
        );
      }, this.dropTimeoutMs);

      // Store pending drop
      const pendingDrop: PendingItemDrop = {
        requestId,
        playerId,
        itemId,
        position,
        createdAt: Date.now(),
        timeout,
      };
      this.pendingDrops.set(requestId, pendingDrop);

      // Send command to server
      console.log(`[ItemDrop] Requesting drop for itemId=${itemId} at`, position);
      this.multiplayerClient.sendGameplayCommand('DROP_ITEM', {
        itemId,
        position,
        playerId,
      });

      // Listen for confirmation in next snapshot
      const onSnapshotReceived = (snapshot: any) => {
        // Check if snapshot contains ENTITY_SPAWNED event for this item
        const spawnedEvent = snapshot.entities?.find(
          (e: any) =>
            e.id === itemId ||
            (e.sourceItemId === itemId && e.type === 'item'),
        );

        if (spawnedEvent) {
          clearTimeout(timeout);
          this.pendingDrops.delete(requestId);
          console.log(
            `[ItemDrop] Confirmed item ${itemId} on server, entityId=${spawnedEvent.id}`,
          );
          resolve({
            confirmed: true,
            entityId: spawnedEvent.id,
          });
        }
      };

      // Temporary listener for this specific drop
      let unsubscribe: (() => void) | undefined;
      const listener = (data: any) => {
        if (data.type === 'AUTHORITATIVE_SNAPSHOT') {
          onSnapshotReceived(data);
          // Auto-cleanup after first match
          if (this.pendingDrops.has(requestId)) {
            return;
          }
          // Remove listener once confirmed
          unsubscribe?.();
        }
      };

      // Listen to snapshots
      unsubscribe = gameBus.on('authority_snapshot' as any, listener);
    });
  }

  /**
   * Confirms an item drop when server snapshot arrives.
   * Called internally when AUTHORITATIVE_SNAPSHOT is processed.
   */
  confirmItemDropFromSnapshot(spawnedEntities: Array<{ id: string; sourceItemId?: string; type?: string }>): void {
    for (const [requestId, pendingDrop] of this.pendingDrops.entries()) {
      const spawned = spawnedEntities.find(
        (e) =>
          e.id === pendingDrop.itemId ||
          (e.sourceItemId === pendingDrop.itemId && e.type === 'item'),
      );

      if (spawned) {
        clearTimeout(pendingDrop.timeout);
        this.pendingDrops.delete(requestId);
        console.log(
          `[ItemDrop] Server-confirmed spawn: itemId=${pendingDrop.itemId} → entityId=${spawned.id}`,
        );
      }
    }
  }

  /**
   * Check if we're currently waiting for a drop confirmation.
   */
  hasPendingDrops(): boolean {
    return this.pendingDrops.size > 0;
  }

  /**
   * Get all pending drops (for debugging).
   */
  getPendingDrops(): Array<{
    itemId: string;
    playerId: string;
    position: { x: number; y: number; z: number };
    ageMs: number;
  }> {
    return Array.from(this.pendingDrops.values()).map((drop) => ({
      itemId: drop.itemId,
      playerId: drop.playerId,
      position: drop.position,
      ageMs: Date.now() - drop.createdAt,
    }));
  }

  /**
   * Clear all pending drops (e.g., on round end or disconnect).
   */
  clear(): void {
    for (const drop of this.pendingDrops.values()) {
      clearTimeout(drop.timeout);
    }
    this.pendingDrops.clear();
  }
}

/**
 * Global instance for use across systems.
 */
export const clientItemDropCoordinator = new ClientItemDropCoordinator();
