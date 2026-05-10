/**
 * InventoryGridManager (client-side)
 *
 * Manages the local copy of the player's grid inventory and provides
 * methods to mutate it (move, equip, drop, give) via the server REST API.
 *
 * Persistence and authoritative validation happen on the server.
 * Client-side moves are applied optimistically and reverted if the server
 * returns a rejection (409 / non-ok status).
 *
 * Also handles WebSocket messages (INVENTORY_SYNC) pushed by the server
 * so multiplayer item events (pickups, trades etc.) propagate in real time.
 *
 * Usage:
 *   const mgr = new InventoryGridManager();
 *   await mgr.init(playerId);
 *   mgr.onChange(inv => console.log(inv));
 */

import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';

const FALLBACK_ITEM_CATALOG: ItemInfo[] = [
  {
    id: 'weapon_pistol',
    label: 'Pistol',
    type: 'weapon',
    gridW: 2,
    gridH: 1,
    maxStack: 1,
    description: '9 mm sidearm.',
    color: '#101828',
    symbol: 'PST',
    stats: { damage: 20, range: 30, rateOfFire: 3 },
  },
  {
    id: 'weapon_rifle_ar',
    label: 'Assault Rifle',
    type: 'weapon',
    gridW: 2,
    gridH: 3,
    maxStack: 1,
    description: 'Drift Bomb attacker rifle loadout.',
    color: '#0c1820',
    symbol: 'RFL',
    stats: { damage: 35, range: 60, rateOfFire: 8 },
  },
  {
    id: 'weapon_macuahuitl',
    label: 'Macuahuitl',
    type: 'weapon',
    gridW: 2,
    gridH: 1,
    maxStack: 1,
    description: 'Volcanic-edged ritual blade for brutal close combat.',
    color: '#24120d',
    symbol: 'MAC',
    stats: { damage: 52, range: 3, rateOfFire: 1 },
  },
  {
    id: 'weapon_flareGun',
    label: 'Flare Gun',
    type: 'weapon',
    gridW: 2,
    gridH: 1,
    maxStack: 1,
    description: 'Incendiary signal sidearm that spits burning rounds.',
    color: '#2a1408',
    symbol: 'FLR',
    stats: { damage: 40, range: 22, rateOfFire: 1 },
  },
  {
    id: 'weapon_spiritSwarmStaff',
    label: 'Spirit-Swarm Staff',
    type: 'weapon',
    gridW: 1,
    gridH: 3,
    maxStack: 1,
    description: 'Hex staff that releases spiteful swarms through the canopy.',
    color: '#162212',
    symbol: 'SWS',
    stats: { damage: 28, range: 16, rateOfFire: 2 },
  },
  {
    id: 'weapon_poisonBlowgun',
    label: 'Poison Blowgun',
    type: 'weapon',
    gridW: 2,
    gridH: 1,
    maxStack: 1,
    description: 'Silent toxin launcher favored by the jungle stalkers.',
    color: '#102016',
    symbol: 'PBG',
    stats: { damage: 19, range: 140, rateOfFire: 3 },
  },
  {
    id: 'weapon_knife',
    label: 'Combat Knife',
    type: 'weapon',
    gridW: 1,
    gridH: 2,
    maxStack: 1,
    description: 'Silent melee weapon.',
    color: '#101a1a',
    symbol: 'KNF',
    stats: { damage: 45, range: 1, rateOfFire: 2 },
  },
  {
    id: 'physgun_tool',
    label: 'Physics Gun',
    type: 'misc',
    gridW: 2,
    gridH: 1,
    maxStack: 1,
    description: 'Gravity manipulation tool.',
    color: '#081828',
    symbol: 'PHY',
  },
  {
    id: 'drift_bomb_device',
    label: 'Drift Bomb',
    type: 'misc',
    gridW: 2,
    gridH: 2,
    maxStack: 1,
    description: 'Objective device carried by attackers and planted at the site.',
    color: '#281808',
    symbol: 'BMB',
  },
  {
    id: 'health_small',
    label: 'Health Pack',
    type: 'consumable',
    gridW: 1,
    gridH: 1,
    maxStack: 3,
    description: 'Restores 25 HP.',
    color: '#2e1010',
    symbol: 'HP',
    stats: { heal: 25 },
  },
  {
    id: 'health_potion_sm',
    label: 'Health Potion',
    type: 'consumable',
    gridW: 1,
    gridH: 2,
    maxStack: 3,
    description: 'Restores 25 HP.',
    color: '#2e0808',
    symbol: 'HP',
    stats: { heal: 25 },
  },
  {
    id: 'stim_pack',
    label: 'Stim Pack',
    type: 'consumable',
    gridW: 1,
    gridH: 1,
    maxStack: 4,
    description: 'Restores 10 HP.',
    color: '#3a1020',
    symbol: 'STM',
    stats: { heal: 10 },
  },
  {
    id: 'ammo_9mm',
    label: '9mm Rounds',
    type: 'ammo',
    gridW: 1,
    gridH: 1,
    maxStack: 4,
    description: '15-round box of 9 mm ammo.',
    color: '#1e180a',
    symbol: '9MM',
    stats: { rounds: 15 },
  },
  {
    id: 'debug_fireball',
    label: 'Fireball Tome',
    type: 'weapon',
    gridW: 2,
    gridH: 2,
    maxStack: 1,
    description: 'Spellbook that grants a volatile fireball cast.',
    color: '#7a1d05',
    symbol: 'FBL',
    stats: { damage: 56, range: 30 },
  },
];

// ─── Shared types (must match server) ────────────────────────────────────────

export interface ItemInfo {
  id:          string;
  label:       string;
  type:        string;
  gridW:       number;
  gridH:       number;
  maxStack:    number;
  description: string;
  color:       string;
  symbol:      string;
  stats?:      Record<string, number>;
}

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

// ─── InventoryGridManager ────────────────────────────────────────────────────

export class InventoryGridManager {
  private playerId:   string = '';
  private inventory:  GridInventory | null = null;
  private catalog:    Map<string, ItemInfo> = new Map();
  private serverBase: string;
  private systemContext: SystemContext | null = null;
  private offlineMode = false;

  /** Guard against the double fire-and-forget in SessionLifecycleCoordinator. */
  private initInProgressForPlayer: string | null = null;

  private changeCallbacks: Array<(inv: GridInventory) => void> = [];
  private catalogReadyCallbacks: Array<() => void> = [];
  private catalogLoaded = false;

  constructor() {
    this.serverBase = this._detectBase();
    this._fetchCatalog();
  }

  initContext(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  initSystemContext(ctx: SystemContext): void {
    this.initContext(ctx);
  }

  setSystemContext(ctx: SystemContext): void {
    this.initContext(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: false,
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        hasSystemContext: this.systemContext !== null,
        playerId: this.playerId || null,
        hasInventory: this.inventory !== null,
        catalogSize: this.catalog.size,
        serverBase: this.serverBase,
      },
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Override the auto-detected server base URL with the authoritative backend
   *  origin (derived from the WebSocket URL). Call this once the WebSocket
   *  connection URL is known to prevent the fallback from using the dev-server
   *  port (e.g. :3000) instead of the backend port (e.g. :8080). */
  setServerBase(url: string): void {
    if (!url) return;
    const normalizedUrl = url.replace(/\/$/, '');
    if (normalizedUrl === this.serverBase) return;
    this.serverBase = normalizedUrl;
    this.catalog.clear();
    this.catalogLoaded = false;
    void this._fetchCatalog();
  }

  /** Initialise with a player id and fetch the inventory from the server. */
  async init(playerId: string): Promise<void> {
    // Idempotency guard: if a fetch is already in-flight for this player, skip.
    if (this.initInProgressForPlayer === playerId) return;
    // If offline mode is already active (set by a game-mode loadout via initOffline),
    // do not overwrite with server data — the loadout is authoritative.
    if (this.offlineMode && this.inventory) return;
    this.initInProgressForPlayer = playerId;
    this.playerId = playerId;
    this.inventory = null;
    try {
      console.log(`[InventoryGridManager.init] Starting initialization for player: ${playerId}`);
      await this._fetchCatalog();
      // A concurrent initOffline() may have set offlineMode while we were fetching the catalog.
      if (this.offlineMode) {
        console.log(`[InventoryGridManager.init] Offline mode set externally during catalog fetch, aborting server init`);
        return;
      }
      console.log(`[InventoryGridManager.init] Catalog loaded, attempting server inventory fetch`);
      await this._fetchInventory();
      // Check again — initOffline() may have won the race during _fetchInventory.
      if (this.offlineMode) {
        console.log(`[InventoryGridManager.init] Offline mode set externally during inventory fetch, aborting server init`);
        return;
      }
      this.offlineMode = false;

      // If inventory is still null after fetch attempt, server was unreachable
      if (!this.inventory) {
        console.log(`[InventoryGridManager.init] Server inventory unavailable, initializing offline mode`);
        await this.initOffline(playerId, ['physgun_tool', 'weapon_pistol', 'health_small', 'stim_pack', 'ammo_9mm']);
        return;
      }

      const inventory = this.getInventory();
      console.log(`[InventoryGridManager.init] Inventory loaded successfully with ${inventory?.items.length ?? 0} items`);
      // Bridge equipped items to the rest of the engine via gameBus.
      // SessionLifecycleCoordinator (or bootstrapClientRuntime) must subscribe
      // to INVENTORY_READY and call weaponSystem.equip() + mark the phase.
      gameBus.emit('INVENTORY_READY', {
        playerId,
        equippedWeapon: inventory?.equippedWeapon ?? null,
        equippedArmor: inventory?.equippedArmor ?? null,
        items: inventory?.items ?? [],
      });
    } catch (err) {
      console.error(`[InventoryGridManager.init] Unexpected error during initialization:`, err);
      // Attempt offline fallback on any error
      if (!this.inventory) {
        console.log(`[InventoryGridManager.init] Initializing offline mode due to error`);
        await this.initOffline(playerId, ['physgun_tool', 'weapon_pistol', 'health_small', 'stim_pack', 'ammo_9mm']);
      }
    } finally {
      this.initInProgressForPlayer = null;
    }
  }

  async initOffline(playerId: string, itemIds: string[]): Promise<void> {
    // Signal offline intent immediately so any in-flight init() will abort on its next await.
    this.offlineMode = true;
    if (this.initInProgressForPlayer === playerId) {
      // init() holds the lock for this player. Release it so we can proceed with the loadout.
      console.log(`[InventoryGridManager.initOffline] Overriding in-progress server init for ${playerId}`);
      this.initInProgressForPlayer = null;
    }
    this.initInProgressForPlayer = playerId;
    this.playerId = playerId;
    this.offlineMode = true;
    try {
      console.log(`[InventoryGridManager.initOffline] Initializing OFFLINE inventory for ${playerId} with items: ${itemIds.join(',')}`);
      this.ensureFallbackCatalog(itemIds);
      this.inventory = this.buildOfflineInventory(playerId, itemIds);
      console.log(`[InventoryGridManager.initOffline] Built offline inventory with ${this.inventory.items.length} items`);
      this._notify();
      gameBus.emit('INVENTORY_READY', {
        playerId,
        equippedWeapon: this.inventory.equippedWeapon,
        equippedArmor: this.inventory.equippedArmor,
        items: this.inventory.items,
      });
    } finally {
      this.initInProgressForPlayer = null;
    }
  }

  /** Called every frame by EngineController – currently no per-frame work. */
  update(_dt: number): void { /* no-op */ }

  // ── State access ─────────────────────────────────────────────────────────

  getInventory(): GridInventory | null { return this.inventory; }
  getCatalog():   Map<string, ItemInfo> { return this.catalog; }
  getPlayerId():  string { return this.playerId; }

  getItemInfo(itemId: string): ItemInfo | undefined {
    return this.catalog.get(itemId);
  }

  getItem(instanceId: string): GridItem | undefined {
    return this.inventory?.items.find((i) => i.instanceId === instanceId);
  }

  // ── Change listeners ──────────────────────────────────────────────────────

  onChange(cb: (inv: GridInventory) => void): () => void {
    this.changeCallbacks.push(cb);
    if (this.inventory) cb(this.inventory);
    return () => {
      this.changeCallbacks = this.changeCallbacks.filter((c) => c !== cb);
    };
  }

  onCatalogReady(cb: () => void): void {
    if (this.catalogLoaded) { cb(); return; }
    this.catalogReadyCallbacks.push(cb);
  }

  // ── WebSocket message handler ─────────────────────────────────────────────

  /** Call this from whatever handles raw WS messages (Engine game loop, etc.). */
  handleMessage(msg: Record<string, unknown>): void {
    if (msg['type'] === 'INVENTORY_SYNC') {
      this.inventory = msg['inventory'] as GridInventory;
      this._notify();
    }
  }

  // ── Local placement validation ────────────────────────────────────────────

  /**
   * Returns true if `itemId` of the given grid dimensions fits at (toX, toY)
   * without leaving the grid or overlapping another item.
   * Pass `excludeId` to ignore the moving item's current footprint.
   */
  canPlace(
    excludeId: string | null,
    itemId: string,
    toX: number,
    toY: number,
  ): boolean {
    if (!this.inventory) return false;
    const def = this.catalog.get(itemId);
    if (!def) return false;

    const { cols, rows, items } = this.inventory;
    if (toX < 0 || toY < 0 || toX + def.gridW > cols || toY + def.gridH > rows) return false;

    const occupied = new Set<string>();
    for (const it of items) {
      if (it.instanceId === excludeId) continue;
      const d = this.catalog.get(it.itemId);
      if (!d) continue;
      for (let dx = 0; dx < d.gridW; dx++) {
        for (let dy = 0; dy < d.gridH; dy++) {
          occupied.add(`${it.gridX + dx},${it.gridY + dy}`);
        }
      }
    }

    for (let dx = 0; dx < def.gridW; dx++) {
      for (let dy = 0; dy < def.gridH; dy++) {
        if (occupied.has(`${toX + dx},${toY + dy}`)) return false;
      }
    }
    return true;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Move an item to (toX, toY).
   * Applies optimistically, reverts on server rejection.
   */
  async moveItem(instanceId: string, toX: number, toY: number): Promise<boolean> {
    if (!this.inventory || !this.playerId) return false;
    const item = this.inventory.items.find((i) => i.instanceId === instanceId);
    if (!item) return false;

    // Local validation first
    if (!this.canPlace(instanceId, item.itemId, toX, toY)) return false;

    // Optimistic update
    const oldX = item.gridX;
    const oldY = item.gridY;
    item.gridX  = toX;
    item.gridY  = toY;
    this._notify();

    try {
      const res = await fetch(
        `${this.serverBase}/inventory/${encodeURIComponent(this.playerId)}/move`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ instanceId, toX, toY }),
        },
      );
      if (!res.ok) throw new Error('server rejected');
      const data = (await res.json()) as { inventory: GridInventory };
      this.inventory = data.inventory;
      this._notify();
      return true;
    } catch {
      // Revert
      item.gridX = oldX;
      item.gridY = oldY;
      this._notify();
      return false;
    }
  }

  /**
   * Toggle equip state for the item in the given slot.
   */
  async equipItem(instanceId: string, slot: 'weapon' | 'armor'): Promise<boolean> {
    if (!this.playerId) return false;
    try {
      const res = await fetch(
        `${this.serverBase}/inventory/${encodeURIComponent(this.playerId)}/equip`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ instanceId, slot }),
        },
      );
      if (!res.ok) return false;
      const data = (await res.json()) as { inventory: GridInventory };
      this.inventory = data.inventory;
      this._notify();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove (drop) an item entirely.
   * Applies optimistically with a server revert fallback.
   */
  async dropItem(instanceId: string): Promise<boolean> {
    if (!this.playerId || !this.inventory) {
      console.warn('[InventoryGridManager.dropItem] Cannot drop - no playerId or inventory');
      return false;
    }

    console.log(`[InventoryGridManager.dropItem] Attempting to drop item: ${instanceId}`);

    // Optimistic remove
    const prevItems = [...this.inventory.items];
    const idx       = this.inventory.items.findIndex((i) => i.instanceId === instanceId);
    if (idx === -1) {
      console.warn(`[InventoryGridManager.dropItem] Item not found in inventory: ${instanceId}`);
      return false;
    }

    const droppedItem = this.inventory.items[idx];
    const prevEquippedWeapon = this.inventory.equippedWeapon;
    const prevEquippedArmor = this.inventory.equippedArmor;

    if (this.inventory.equippedWeapon === droppedItem.instanceId) {
      this.inventory.equippedWeapon = null;
    }
    if (this.inventory.equippedArmor === droppedItem.instanceId) {
      this.inventory.equippedArmor = null;
    }

    this.inventory.items.splice(idx, 1);
    this._notify();

    try {
      const res = await fetch(
        `${this.serverBase}/inventory/${encodeURIComponent(this.playerId)}/drop`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ instanceId }),
        },
      );
      if (!res.ok) {
        console.warn(`[InventoryGridManager.dropItem] Server rejected drop with status ${res.status}`);
        if (this.offlineMode) {
          console.log(`[InventoryGridManager.dropItem] Server rejected drop with status ${res.status} in offline mode - accepting local removal`);
          return true;
        }
        this.inventory.items = prevItems;
        this.inventory.equippedWeapon = prevEquippedWeapon;
        this.inventory.equippedArmor = prevEquippedArmor;
        this._notify();
        return false;
      }
      const data = (await res.json()) as { inventory: GridInventory };
      this.inventory = data.inventory;
      this.offlineMode = false;
      this._notify();
      console.log(`[InventoryGridManager.dropItem] Drop confirmed by server`);
      return true;
    } catch (err) {
      const errMsg = (err as Error).message;
      if (this.offlineMode) {
        console.log(`[InventoryGridManager.dropItem] Server unreachable (${errMsg}) - accepting offline drop`);
        return true;
      }
      console.warn(`[InventoryGridManager.dropItem] Server unreachable (${errMsg}) - reverting drop`);
      this.inventory.items = prevItems;
      this.inventory.equippedWeapon = prevEquippedWeapon;
      this.inventory.equippedArmor = prevEquippedArmor;
      this._notify();
      return false;
    }
  }

  /**
   * Give an item to the local player (admin / console command / pickup).
   *
   * Applies an optimistic local update immediately so the UI refreshes
   * without waiting for the server round-trip.  The server response is
   * authoritative — on success the local state is replaced; on failure the
   * optimistic entry is reverted.
   */
  async giveItem(itemId: string, quantity = 1): Promise<boolean> {
    if (!this.playerId) {
      console.warn('[InventoryGridManager.giveItem] playerId not set - inventory not initialized yet');
      return false;
    }
    if (!this.inventory) {
      console.warn('[InventoryGridManager.giveItem] inventory is null - server fetch may have failed. Attempting offline fallback.');
      // Auto-initialize offline if inventory is null
      this.inventory = this.buildOfflineInventory(this.playerId, ['weapon_pistol', 'health_small', 'stim_pack', 'ammo_9mm']);
      this.offlineMode = true;
      this._notify();
    }

    console.log(`[InventoryGridManager.giveItem] Adding item: ${itemId}, qty: ${quantity} to player: ${this.playerId}`);

    // Ensure we can display unknown fallback items in offline mode.
    this.ensureFallbackCatalog([itemId]);

    // ── Optimistic local update ────────────────────────────────────────────
    let tempInstanceId: string | null = null;
    const def = this.catalog.get(itemId);

    if (def && this.inventory) {
      // Try to stack onto an existing partial stack
      const existing = this.inventory.items.find(
        (i) => i.itemId === itemId && i.quantity < def.maxStack,
      );
      if (existing) {
        existing.quantity = Math.min(existing.quantity + quantity, def.maxStack);
        this._notify();
      } else {
        const pos = this._findFreeSlot(def.gridW, def.gridH);
        if (pos) {
          tempInstanceId = `_opt_${Engine.time.now().toString(36)}`;
          this.inventory.items.push({
            instanceId: tempInstanceId,
            itemId,
            gridX:    pos.x,
            gridY:    pos.y,
            quantity: Math.min(quantity, def.maxStack),
            equipped: false,
          });
          this._notify();
        }
      }
    }

    // ── Server sync ───────────────────────────────────────────────────────
    try {
      const res = await fetch(`${this.serverBase}/inventory/give`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ playerId: this.playerId, itemId, quantity }),
      });
      if (!res.ok) throw new Error('server rejected');
      const data = (await res.json()) as { inventory: GridInventory };
      this.inventory = data.inventory;
      this.offlineMode = false;
      this._notify();
      return true;
    } catch (err) {
      const errMsg = (err as Error).message;
      console.log(`[InventoryGridManager.giveItem] Server sync failed (${errMsg})`);
      if (this.offlineMode) {
        console.log('[InventoryGridManager.giveItem] Offline mode active, keeping optimistic item state');
        return true;
      }

      // Revert optimistic entry
      if (this.inventory) {
        if (tempInstanceId) {
          this.inventory.items = this.inventory.items.filter(
            (i) => i.instanceId !== tempInstanceId,
          );
        } else if (def) {
          // Revert stack increment
          const it = this.inventory.items.find((i) => i.itemId === itemId);
          if (it) it.quantity = Math.max(0, it.quantity - quantity);
        }
        this._notify();
      }
      return false;
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _detectBase(): string {
    if (typeof window === 'undefined') return '';
    try {
      const params = new URLSearchParams(window.location.search);
      const configuredBase = params.get('serverHttpUrl') ?? params.get('metricsBaseUrl');
      if (configuredBase) {
        return new URL(configuredBase, window.location.href).toString().replace(/\/$/, '');
      }
    } catch {
      // Fall through to same-origin default.
    }
    return window.location.origin.replace(/\/$/, '');
  }

  private async _fetchCatalog(): Promise<void> {
    try {
      const res = await fetch(`${this.serverBase}/inventory/catalog`);
      if (!res.ok) return;
      const data = (await res.json()) as { catalog: ItemInfo[] };
      this.catalog.clear();
      for (const item of data.catalog) this.catalog.set(item.id, item);
      this.catalogLoaded = true;
      for (const cb of this.catalogReadyCallbacks) cb();
      this.catalogReadyCallbacks = [];
      if (this.inventory) {
        this._notify();
      }
    } catch {
      // Server may not be reachable in offline/demo mode — fail silently
    }
  }

  private ensureFallbackCatalog(itemIds: string[]): void {
    let changed = false;
    for (const itemId of itemIds) {
      const fallback = FALLBACK_ITEM_CATALOG.find((entry) => entry.id === itemId);
      if (!fallback || this.catalog.has(itemId)) continue;
      this.catalog.set(itemId, { ...fallback });
      changed = true;
    }

    if (!changed) return;
    this.catalogLoaded = true;
    for (const cb of this.catalogReadyCallbacks) cb();
    this.catalogReadyCallbacks = [];
  }

  private buildOfflineInventory(playerId: string, rawItemIds: string[]): GridInventory {
    const itemIds = rawItemIds.filter((itemId) => typeof itemId === 'string' && itemId.length > 0);
    const items: GridItem[] = [];
    let cursorX = 0;
    let cursorY = 0;

    for (let index = 0; index < itemIds.length; index += 1) {
      const itemId = itemIds[index];
      const def = this.catalog.get(itemId);
      if (!def) continue;

      if (cursorX + def.gridW > 10) {
        cursorX = 0;
        cursorY += 2;
      }

      items.push({
        instanceId: `offline_${playerId}_${index}_${itemId}`,
        itemId,
        gridX: cursorX,
        gridY: cursorY,
        quantity: 1,
        equipped: index === 0,
      });
      cursorX += def.gridW;
    }

    const equippedWeapon = items.find((item) => item.itemId.startsWith('weapon_'))?.instanceId
      ?? items.find((item) => item.itemId === 'debug_fireball')?.instanceId
      ?? items[0]?.instanceId
      ?? null;

    if (equippedWeapon) {
      for (const item of items) {
        item.equipped = item.instanceId === equippedWeapon;
      }
    }

    return {
      playerId,
      cols: 10,
      rows: 6,
      items,
      equippedWeapon,
      equippedArmor: null,
      version: 1,
    };
  }

  private async _fetchInventory(): Promise<void> {
    if (!this.playerId) return;
    try {
      const res = await fetch(
        `${this.serverBase}/inventory/${encodeURIComponent(this.playerId)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { inventory: GridInventory };
      this.inventory = data.inventory;
      this._notify();
    } catch {
      // Same — fail silently when server is unavailable
    }
  }

  private _findFreeSlot(w: number, h: number): { x: number; y: number } | null {
    if (!this.inventory) return null;
    const { cols, rows, items } = this.inventory;
    const occupied = new Set<string>();
    for (const it of items) {
      const d  = this.catalog.get(it.itemId);
      const dw = d?.gridW ?? 1;
      const dh = d?.gridH ?? 1;
      for (let dx = 0; dx < dw; dx++)
        for (let dy = 0; dy < dh; dy++)
          occupied.add(`${it.gridX + dx},${it.gridY + dy}`);
    }
    for (let y = 0; y <= rows - h; y++) {
      for (let x = 0; x <= cols - w; x++) {
        let fits = true;
        outer: for (let dx = 0; dx < w && fits; dx++) {
          for (let dy = 0; dy < h; dy++) {
            if (occupied.has(`${x + dx},${y + dy}`)) { fits = false; break outer; }
          }
        }
        if (fits) return { x, y };
      }
    }
    return null;
  }

  private _notify(): void {
    if (!this.inventory) return;
    gameBus.emit('stateMutation', {
      source: 'inventoryGridManager',
      path: `inventory.grid.${this.inventory.playerId}`,
      changedCount: this.inventory.items.length,
    });
    for (const cb of this.changeCallbacks) {
      try { cb(this.inventory); } catch { /* never let a callback crash the manager */ }
    }
  }
}
