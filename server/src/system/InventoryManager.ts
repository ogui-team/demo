/**
 * InventoryManager (server-side)
 *
 * - One GridInventory per player, identified by playerId
 * - Persisted to  server/data/inventories/{sanitized_id}_inventory.json
 * - Validates all moves before applying (bounds + no overlap)
 * - Singleton – import { inventoryManager } from './inventoryManager'
 */

import * as fs   from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { CATALOG_MAP, CatalogItem } from '../data/itemCatalog';
import { generateDeterministicItemId } from '../utils/DeterministicIdHash';  // ─ TIER 0D: Deterministic IDs ─

// ─── Shared types (must match client) ────────────────────────────────────────

export interface GridItem {
  instanceId: string;
  itemId:     string;
  gridX:      number;
  gridY:      number;
  quantity:   number;
  equipped:   boolean;
  metadata?:  Record<string, unknown>;
}

export interface GridInventory {
  playerId:       string;
  cols:           number;
  rows:           number;
  items:          GridItem[];
  equippedWeapon: string | null;
  equippedArmor:  string | null;
  version:        number;
}

export interface OpResult {
  ok:        boolean;
  reason?:   string;
  inventory: GridInventory;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GRID_COLS = 10;
const GRID_ROWS = 6;

// Directory where inventory JSON files are stored (relative to compiled output)
const DATA_DIR = path.resolve(__dirname, '../../data/inventories');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** Sanitise playerId so it is safe as a filename component. */
function safeName(playerId: string): string {
  return playerId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function inventoryPath(playerId: string): string {
  return path.join(DATA_DIR, `${safeName(playerId)}_inventory.json`);
}

function makeInstanceId(): string {
  // ─ TIER 0D: This will be updated to use deterministic generation ─
  // For now, use temporary ID - should be called via proper inventory context
  return `itm_temp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * TIER 0D: Generate deterministic item instance ID
 * Called when creating items with full context (playerId, slot, itemId)
 */
export function makeDeterministicInstanceId(playerId: string, slotIndex: number, itemId: string): string {
  return generateDeterministicItemId(playerId, slotIndex, itemId);
}

function loadFromDisk(playerId: string): GridInventory | null {
  try {
    const p = inventoryPath(playerId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as GridInventory;
  } catch {
    return null;
  }
}

function saveToDisk(inv: GridInventory): void {
  ensureDir();
  try {
    fs.writeFileSync(inventoryPath(inv.playerId), JSON.stringify(inv, null, 2), 'utf-8');
  } catch (err) {
    console.error('[InventoryManager] Save error:', (err as Error).message);
  }
}

/** Build a default starter inventory with a few items for first-time players. */
function makeDefaultInventory(playerId: string): GridInventory {
  const items: GridItem[] = [
    // Two small health potions at (0,0) — 1×2 each
    // ─ TIER 0D: Use deterministic instance IDs ─
    { instanceId: makeDeterministicInstanceId(playerId, 0, 'health_potion_sm'), itemId: 'health_potion_sm', gridX: 0, gridY: 0, quantity: 2, equipped: false },
    // Pistol at (2,0) — 2×1
    { instanceId: makeDeterministicInstanceId(playerId, 1, 'weapon_pistol'), itemId: 'weapon_pistol',   gridX: 2, gridY: 0, quantity: 1, equipped: true  },
    // Knife at (4,0) — 1×2
    { instanceId: makeDeterministicInstanceId(playerId, 2, 'weapon_knife'), itemId: 'weapon_knife',    gridX: 4, gridY: 0, quantity: 1, equipped: false },
    // Pistol ammo at (5,0) — 1×1
    { instanceId: makeDeterministicInstanceId(playerId, 3, 'ammo_9mm'), itemId: 'ammo_9mm',        gridX: 5, gridY: 0, quantity: 2, equipped: false },
    // Stim pack at (6,0) — 1×1
    { instanceId: makeDeterministicInstanceId(playerId, 4, 'stim_pack'), itemId: 'stim_pack',       gridX: 6, gridY: 0, quantity: 3, equipped: false },
  ];
  return {
    playerId,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    items,
    equippedWeapon: items[1].instanceId,
    equippedArmor:  null,
    version: 1,
  };
}

/**
 * Check whether `itemId` can be placed at (toX, toY) without exceeding
 * grid bounds or overlapping another item.
 * Pass `excludeId` to temporarily ignore the item being moved (so it doesn't
 * block its own destination when the source and destination overlap).
 */
function canPlace(
  inv: GridInventory,
  excludeId: string | null,
  itemId: string,
  toX: number,
  toY: number,
): boolean {
  const def: CatalogItem | undefined = CATALOG_MAP.get(itemId);
  if (!def) return false;

  // Grid bounds
  if (toX < 0 || toY < 0 || toX + def.gridW > inv.cols || toY + def.gridH > inv.rows) return false;

  // Build occupied-cell set (exclude the item being moved)
  const occupied = new Set<string>();
  for (const it of inv.items) {
    if (it.instanceId === excludeId) continue;
    const d: CatalogItem | undefined = CATALOG_MAP.get(it.itemId);
    if (!d) continue;
    for (let dx = 0; dx < d.gridW; dx++) {
      for (let dy = 0; dy < d.gridH; dy++) {
        occupied.add(`${it.gridX + dx},${it.gridY + dy}`);
      }
    }
  }

  // Check proposed cells
  for (let dx = 0; dx < def.gridW; dx++) {
    for (let dy = 0; dy < def.gridH; dy++) {
      if (occupied.has(`${toX + dx},${toY + dy}`)) return false;
    }
  }
  return true;
}

// ─── InventoryManager ────────────────────────────────────────────────────────

export class InventoryManager {
  /** In-memory cache: playerId → inventory */
  private cache = new Map<string, GridInventory>();
  private readonly events = new EventEmitter();
  private mutationCount = 0;
  private diskWriteCount = 0;

  // ── Retrieval ────────────────────────────────────────────────────────────

  /** Load from disk or create a default inventory. */
  getOrCreate(playerId: string): GridInventory {
    if (this.cache.has(playerId)) return this.cache.get(playerId)!;

    const loaded = loadFromDisk(playerId);
    const inv    = loaded ?? makeDefaultInventory(playerId);
    this.cache.set(playerId, inv);
    return inv;
  }

  /** Return cached inventory (null if player has not yet connected). */
  get(playerId: string): GridInventory | null {
    return this.cache.get(playerId) ?? null;
  }

  /** Flush a specific player's inventory to disk. */
  savePlayer(playerId: string): void {
    const inv = this.cache.get(playerId);
    if (inv) {
      saveToDisk(inv);
      this.diskWriteCount += 1;
    }
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  /**
   * Give an item to a player's inventory.
   * Scans for the first free position that fits the item dimensions.
   */
  giveItem(playerId: string, itemId: string, quantity = 1): OpResult {
    const inv = this.getOrCreate(playerId);
    const def = CATALOG_MAP.get(itemId);
    if (!def) return { ok: false, reason: `Unknown item id: ${itemId}`, inventory: inv };

    const qty = Math.max(1, Math.min(quantity, def.maxStack));

    // Try to stack onto an existing item of the same type (if stackable)
    if (def.maxStack > 1) {
      for (const it of inv.items) {
        if (it.itemId === itemId && it.quantity < def.maxStack) {
          it.quantity = Math.min(it.quantity + qty, def.maxStack);
          inv.version++;
          saveToDisk(inv);
          this.diskWriteCount += 1;
          this.mutationCount += 1;
          this.events.emit('changed', { action: 'stack', playerId, instanceId: it.instanceId });
          return { ok: true, inventory: inv };
        }
      }
    }

    // Find the first empty cell region
    for (let y = 0; y <= inv.rows - def.gridH; y++) {
      for (let x = 0; x <= inv.cols - def.gridW; x++) {
        if (canPlace(inv, null, itemId, x, y)) {
          inv.items.push({
            instanceId: makeInstanceId(),
            itemId,
            gridX: x,
            gridY: y,
            quantity: qty,
            equipped: false,
          });
          inv.version++;
          saveToDisk(inv);
          this.diskWriteCount += 1;
          this.mutationCount += 1;
          this.events.emit('changed', { action: 'give', playerId, itemId });
          return { ok: true, inventory: inv };
        }
      }
    }

    return { ok: false, reason: 'Inventory full — no space for item', inventory: inv };
  }

  /**
   * Move an item to a new grid position.
   * Validates bounds and overlap before applying.
   */
  moveItem(playerId: string, instanceId: string, toX: number, toY: number): OpResult {
    const inv  = this.getOrCreate(playerId);
    const item = inv.items.find((i) => i.instanceId === instanceId);
    if (!item) return { ok: false, reason: 'Item instance not found', inventory: inv };

    if (!canPlace(inv, instanceId, item.itemId, toX, toY)) {
      return { ok: false, reason: 'Invalid placement (out of bounds or overlap)', inventory: inv };
    }

    item.gridX = toX;
    item.gridY = toY;
    inv.version++;
    saveToDisk(inv);
    this.diskWriteCount += 1;
    this.mutationCount += 1;
    this.events.emit('changed', { action: 'move', playerId, instanceId });
    return { ok: true, inventory: inv };
  }

  /**
   * Toggle equip state for a given item in the specified slot.
   * Un-equips any previously equipped item in the same slot.
   */
  toggleEquip(playerId: string, instanceId: string, slot: 'weapon' | 'armor'): OpResult {
    const inv  = this.getOrCreate(playerId);
    const item = inv.items.find((i) => i.instanceId === instanceId);
    if (!item) return { ok: false, reason: 'Item instance not found', inventory: inv };

    const slotKey: keyof GridInventory = slot === 'weapon' ? 'equippedWeapon' : 'equippedArmor';
    const currentId = inv[slotKey] as string | null;

    if (currentId === instanceId) {
      // Un-equip
      (inv as any)[slotKey] = null;
      item.equipped = false;
    } else {
      // Un-equip old item
      if (currentId) {
        const old = inv.items.find((i) => i.instanceId === currentId);
        if (old) old.equipped = false;
      }
      (inv as any)[slotKey] = instanceId;
      item.equipped = true;
    }

    inv.version++;
    saveToDisk(inv);
    this.diskWriteCount += 1;
    this.mutationCount += 1;
    this.events.emit('changed', { action: 'toggle_equip', playerId, instanceId, slot });
    return { ok: true, inventory: inv };
  }

  /**
   * Remove an item from the inventory (drop / delete).
   */
  dropItem(playerId: string, instanceId: string): OpResult {
    const inv = this.getOrCreate(playerId);
    const idx = inv.items.findIndex((i) => i.instanceId === instanceId);
    if (idx === -1) return { ok: false, reason: 'Item instance not found', inventory: inv };

    const item = inv.items[idx];
    if (inv.equippedWeapon === instanceId) inv.equippedWeapon = null;
    if (inv.equippedArmor  === instanceId) inv.equippedArmor  = null;

    inv.items.splice(idx, 1);
    inv.version++;
    saveToDisk(inv);
    this.diskWriteCount += 1;
    this.mutationCount += 1;
    this.events.emit('changed', { action: 'drop', playerId, instanceId });
    return { ok: true, inventory: inv };
  }

  /**
   * Remove a player's inventory from the in-memory cache.
   * Call on disconnect to free memory (disk copy is already saved).
   */
  evict(playerId: string): void {
    this.cache.delete(playerId);
    this.events.emit('changed', { action: 'evict', playerId });
  }

  onChanged(listener: (payload: { action: string; playerId: string; instanceId?: string; itemId?: string; slot?: string }) => void): () => void {
    this.events.on('changed', listener);
    return () => {
      this.events.off('changed', listener);
    };
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        cachedInventories: this.cache.size,
        mutationCount: this.mutationCount,
        diskWriteCount: this.diskWriteCount,
      },
    };
  }
}

/** Singleton — import this directly wherever needed. */
export const inventoryManager = new InventoryManager();
