/**
 * InventoryDropContract.ts
 *
 * Single, authoritative contract for all item drops across the engine.
 * This is the ONLY payload that should carry a drop request from client to server,
 * regardless of origin (grid UI, GAS inventory, world interaction).
 *
 * Key invariants:
 * - Full ItemInstance data is preserved end-to-end (affixes, ammo, modifiers)
 * - Server is authoritative: validates, creates world object, broadcasts to all
 * - Client performs NO optimistic removal; waits for server WORLD_OBJECT_PLACE
 * - Idempotency: drop request IDs prevent duplicate spawns on network retries
 */

import type { ItemInstance, EquipSlot } from './gas/CombatTypes';
import type { Vec3 } from '../../../3-network/network/MultiplayerClient';

/**
 * Unified request contract: client drops an item from inventory.
 * Sent via WebSocket to server as part of 'DROP_ITEM' lobby action.
 */
export interface UnifiedItemDropRequest {
  // ── Origin context ────────────────────────────────────────────────────────
  /** Which player is initiating the drop. */
  playerId: string;

  /** Source of the drop: 'backpack' | EquipSlot (e.g., 'weapon', 'armor') */
  sourceSlot: EquipSlot | 'backpack';

  // ── Item identity (FULL data, not just UUID) ──────────────────────────────
  /** The complete item instance being dropped, with all modifiers + affixes. */
  itemInstance: ItemInstance;

  // ── World placement ───────────────────────────────────────────────────────
  /** World position where the item drops. Server validates collision. */
  position: Vec3;

  // ── Idempotency & timestamps ──────────────────────────────────────────────
  /** Client-generated UUID for this drop request. Prevents duplicate processing. */
  dropRequestId: string;

  /** Client timestamp (ms); server uses for conflict resolution. */
  timestamp: number;
}

/**
 * Validate a drop request for basic correctness before transmission.
 * Returns { valid: true } or { valid: false, reason: "..." }
 *
 * Note: This is CLIENT-SIDE validation only. Server performs additional
 * checks (player exists, item in registry, affixes legitimate, etc.).
 */
export function validateDropRequest(req: UnifiedItemDropRequest): {
  valid: boolean;
  reason?: string;
} {
  if (!req) {
    return { valid: false, reason: 'Request is null or undefined' };
  }

  if (!req.playerId || req.playerId.trim().length === 0) {
    return { valid: false, reason: 'Missing or empty playerId' };
  }

  if (!req.itemInstance || typeof req.itemInstance !== 'object') {
    return { valid: false, reason: 'Missing or invalid itemInstance' };
  }

  if (!req.itemInstance.uuid || req.itemInstance.uuid.trim().length === 0) {
    return { valid: false, reason: 'Missing itemInstance.uuid' };
  }

  if (!req.itemInstance.templateId || req.itemInstance.templateId.trim().length === 0) {
    return { valid: false, reason: 'Missing itemInstance.templateId' };
  }

  if (!req.position || typeof req.position !== 'object') {
    return { valid: false, reason: 'Missing or invalid position' };
  }

  if (typeof req.position.x !== 'number' || typeof req.position.y !== 'number' || typeof req.position.z !== 'number') {
    return { valid: false, reason: 'Position must have numeric x, y, z' };
  }

  if (!req.dropRequestId || req.dropRequestId.trim().length === 0) {
    return { valid: false, reason: 'Missing dropRequestId (required for idempotency)' };
  }

  if (typeof req.timestamp !== 'number' || req.timestamp <= 0) {
    return { valid: false, reason: 'Invalid timestamp' };
  }

  return { valid: true };
}

/**
 * Server-side response to a drop request.
 * Indicates whether the drop succeeded or was rejected, and why.
 */
export interface DropRequestResult {
  /** Whether the drop was successful. */
  success: boolean;

  /** World object ID if created; null if rejected. */
  worldObjectId: string | null;

  /** Reason for rejection (for logging/analytics). */
  reason?: string;

  /** Client-side friendly message (if any). */
  message?: string;
}
