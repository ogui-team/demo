/**
 * ItemInstanceSystem.ts
 *
 * Handles the full lifecycle of `ItemInstance` objects:
 *
 *   1. **Instancing** — rolls a new `ItemInstance` from an `ItemTemplate`
 *      (affix selection, rarity, UUID generation).
 *   2. **Inventory management** — backpack ↔ equip-slot book-keeping for each
 *      player, including slot-capacity rules.
 *   3. **Passive effect wiring** — when an item is equipped / unequipped this
 *      system automatically applies / removes its passive effects (base stats +
 *      affix effects) via `EffectSystem`.
 *   4. **Ammo initialisation** — seeds `currentAmmo` / `reserveAmmo` from the
 *      parent template on equip if not already set.
 *   5. **Multiplayer hooks** — emits `sendLobbyAction` for equip/unequip/drop
 *      to keep all clients in sync.
 */

import type {
  ItemInstance,
  ItemAffix,
  PlayerInventory,
  EquipSlot,
  AffixTier,
  Rarity,
  UUID,
  EquipChangeCallback,
} from './CombatTypes';
import type { DataRegistry } from './DataRegistry';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

interface ItemEffectsAdapter {
  apply(playerId: string, effectId: string, source: string, rollMultiplier: number): void;
  removeSource(playerId: string, source: string): void;
}

interface ItemMultiplayerAdapter {
  connected?: boolean;
  sendLobbyAction(type: string, payload: Record<string, unknown>): void;
}

// ── Loot-generation helpers ───────────────────────────────────────────────────

/** How many affixes each rarity tier generates. */
const RARITY_AFFIX_COUNT: Record<Rarity, number> = {
  Common:    0,
  Magic:     1,
  Rare:      2,
  Unique:    3,
  Legendary: 4,
};

/** Roll-multiplier range for each affix tier. */
const AFFIX_TIER_RANGES: Record<AffixTier, [min: number, max: number]> = {
  Minor:   [0.7,  0.9],
  Major:   [0.9,  1.1],
  Exalted: [1.1,  1.4],
};

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickAffixTier(level: number): AffixTier {
  if (level >= 15) return Math.random() < 0.2 ? 'Exalted' : 'Major';
  if (level >= 7)  return Math.random() < 0.5 ? 'Major'   : 'Minor';
  return 'Minor';
}

/** Simple UUID v4 that works in any browser environment. */
function generateUUID(): UUID {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — not cryptographically strong but sufficient for game IDs
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16)|0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ── ItemInstanceSystem ────────────────────────────────────────────────────────

export class ItemInstanceSystem {
  private readonly registry:  DataRegistry;
  private readonly effects:   ItemEffectsAdapter;
  private multiplayer: ItemMultiplayerAdapter | null;
  private systemContext: SystemContext | null = null;

  /** Master store of ALL known instances (by UUID). */
  private readonly instances = new Map<UUID, ItemInstance>();

  /** Per-player inventory state. */
  private readonly inventories = new Map<string, PlayerInventory>();

  /** Equip-change observers. */
  private equipCallbacks: EquipChangeCallback[] = [];

  constructor(
    registry:    DataRegistry,
    effects:     ItemEffectsAdapter,
    multiplayer: ItemMultiplayerAdapter | null = null,
  ) {
    this.registry   = registry;
    this.effects    = effects;
    this.multiplayer = multiplayer;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (!this.multiplayer) {
      this.multiplayer = this.resolveMultiplayer();
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: true,
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: {
        instanceCount: this.instances.size,
        inventoryCount: this.inventories.size,
        equipCallbackCount: this.equipCallbacks.length,
        hasMultiplayer: this.multiplayer !== null,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  // ── Inventory initialisation ──────────────────────────────────────────────

  /**
   * Create (or reset) an empty inventory for `playerId`.
   * Call once per player on join / respawn.
   */
  initPlayer(playerId: string, maxBackpackSize = 20): PlayerInventory {
    const existing = this.inventories.get(playerId);
    if (existing) return existing;
    const inv: PlayerInventory = {
      playerId,
      backpack: [],
      equipped: {},
      maxBackpackSize,
    };
    this.inventories.set(playerId, inv);
    this.emitMutation(`inventory.${playerId}`);
    return inv;
  }

  getInventory(playerId: string): PlayerInventory | undefined {
    return this.inventories.get(playerId);
  }

  clearAll(): void {
    this.instances.clear();
    this.inventories.clear();
    this.emitMutation('inventory');
  }

  // ── Instance construction ─────────────────────────────────────────────────

  /**
   * Create a **new** `ItemInstance` from a template.
   * Rolls random affixes based on `rarity` and `level`.
   *
   * The instance is stored in the master map but NOT yet placed in any
   * inventory — call `addToBackpack` or `equip` next.
   */
  createInstance(
    templateId: string,
    level       = 1,
    rarity:     Rarity = 'Common',
  ): ItemInstance | null {
    const template = this.registry.getItem(templateId);
    if (!template) {
      console.warn(`[ItemInstanceSystem] Unknown item template: ${templateId}`);
      return null;
    }

    const affixCount = RARITY_AFFIX_COUNT[rarity];
    const affixes: ItemAffix[] = [];
    const pool = [...(template.affixPool ?? [])];

    for (let i = 0; i < affixCount && pool.length > 0; i++) {
      const idx      = Math.floor(Math.random() * pool.length);
      const [picked] = pool.splice(idx, 1);     // pick without replacement
      const tier     = pickAffixTier(level);
      const [min, max] = AFFIX_TIER_RANGES[tier];
      affixes.push({
        templateId:     picked,
        tier,
        rollMultiplier: randomInRange(min, max),
      });
    }

    const instance: ItemInstance = {
      uuid:         generateUUID(),
      templateId,
      level,
      rarity,
      affixes,
      currentAmmo:  template.magazineSize,
      reserveAmmo:  template.reserveAmmoCap,
      lastModified: Date.now(),
    };

    this.instances.set(instance.uuid, instance);
    this.emitMutation(`items.instances.${instance.uuid}`);
    return instance;
  }

  /**
   * Register an externally created instance (e.g. received from server).
   */
  registerInstance(instance: ItemInstance): void {
    this.instances.set(instance.uuid, instance);
    this.emitMutation(`items.instances.${instance.uuid}`);
  }

  getInstance(uuid: UUID): ItemInstance | undefined {
    return this.instances.get(uuid);
  }

  // ── Backpack management ───────────────────────────────────────────────────

  /**
   * Add an instance to a player's backpack.
   * @returns `true` on success, `false` if the backpack is full.
   */
  addToBackpack(playerId: string, uuid: UUID): boolean {
    const inv = this.inventories.get(playerId);
    if (!inv) {
      console.warn(`[ItemInstanceSystem] No inventory for player: ${playerId}`);
      return false;
    }
    if (inv.backpack.length >= inv.maxBackpackSize) return false;
    if (!inv.backpack.includes(uuid)) {
      inv.backpack.push(uuid);
      this.emitMutation(`inventory.${playerId}.backpack`);
    }
    return true;
  }

  removeFromBackpack(playerId: string, uuid: UUID): void {
    const inv = this.inventories.get(playerId);
    if (!inv) return;
    const previousLength = inv.backpack.length;
    inv.backpack = inv.backpack.filter((id) => id !== uuid);
    if (inv.backpack.length !== previousLength) {
      this.emitMutation(`inventory.${playerId}.backpack`);
    }
  }

  // ── Equip / unequip ───────────────────────────────────────────────────────

  /**
   * Equip an `ItemInstance` to a player's equipment slot.
   *
   * Steps:
   *   1. Unequip anything currently in that slot.
   *   2. Register the item in `equipped`.
   *   3. Apply all passive effects (base + affix) to the player's attributes.
   *   4. Seed ammo if not already set.
   *   5. Send multiplayer event.
   */
  equip(playerId: string, uuid: UUID, slot?: EquipSlot): boolean {
    const inv      = this.inventories.get(playerId);
    const instance = this.instances.get(uuid);
    if (!inv || !instance) return false;

    const template = this.registry.getItem(instance.templateId);
    if (!template) return false;

    const targetSlot = slot ?? template.equipSlot;
    if (targetSlot === 'None') return false;

    // 1. Unequip whatever is there
    const currentUuid = inv.equipped[targetSlot];
    if (currentUuid && currentUuid !== uuid) {
      this._unapplyPassives(playerId, currentUuid);
      // Return to backpack
      this.addToBackpack(playerId, currentUuid);
    }

    // 2. Remove from backpack + put in slot
    this.removeFromBackpack(playerId, uuid);
    inv.equipped[targetSlot] = uuid;

    // 3. Apply passives
    this._applyPassives(playerId, instance);

    // 4. Ensure ammo is seeded
    if (template.magazineSize !== undefined && instance.currentAmmo === undefined) {
      instance.currentAmmo = template.magazineSize;
      instance.reserveAmmo = template.reserveAmmoCap ?? 0;
    }

    // 5. Notify observers
    instance.lastModified = Date.now();
    for (const cb of this.equipCallbacks) {
      try { cb({ playerId, slot: targetSlot, itemUuid: uuid }); } catch { /**/ }
    }

    // 6. Network sync
    if (this.multiplayer?.connected) {
      this.multiplayer.sendLobbyAction('EQUIP_ITEM', {
        playerId,
        itemUuid: uuid,
        slot:     targetSlot,
      });
    }

    this.emitMutation(`inventory.${playerId}.equipped.${targetSlot}`);

    return true;
  }

  /**
   * Unequip the item in `slot`, moving it back to the backpack.
   */
  unequip(playerId: string, slot: EquipSlot): boolean {
    const inv = this.inventories.get(playerId);
    if (!inv) return false;

    const uuid = inv.equipped[slot];
    if (!uuid) return false;

    this._unapplyPassives(playerId, uuid);

    delete inv.equipped[slot];
    this.addToBackpack(playerId, uuid);

    for (const cb of this.equipCallbacks) {
      try { cb({ playerId, slot, itemUuid: null }); } catch { /**/ }
    }

    if (this.multiplayer?.connected) {
      this.multiplayer.sendLobbyAction('UNEQUIP_ITEM', { playerId, slot });
    }

    this.emitMutation(`inventory.${playerId}.equipped.${slot}`);

    return true;
  }

  /**
   * Drop an item completely — removes it from inventory AND from the instance
   * store (the server decides whether to spawn a world pickup entity).
   */
  dropItem(playerId: string, uuid: UUID, position: { x: number; y: number; z: number }): boolean {
    const inv = this.inventories.get(playerId);
    if (!inv) return false;

    // Was it equipped? Unapply passives first.
    for (const [slot, slotUuid] of Object.entries(inv.equipped) as [EquipSlot, UUID | undefined][]) {
      if (slotUuid === uuid) {
        this._unapplyPassives(playerId, uuid);
        delete inv.equipped[slot];
      }
    }

    this.removeFromBackpack(playerId, uuid);

    if (this.multiplayer?.connected) {
      this.multiplayer.sendLobbyAction('DROP_ITEM', {
        playerId, itemUuid: uuid, position,
      });
    }

    this.emitMutation(`inventory.${playerId}`);

    return true;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /** Returns the instance equipped in `slot`, if any. */
  getEquipped(playerId: string, slot: EquipSlot): ItemInstance | undefined {
    const uuid = this.inventories.get(playerId)?.equipped[slot];
    return uuid ? this.instances.get(uuid) : undefined;
  }

  /** Returns all instances in the player's backpack. */
  getBackpack(playerId: string): ItemInstance[] {
    const inv = this.inventories.get(playerId);
    if (!inv) return [];
    return inv.backpack
      .map((uuid) => this.instances.get(uuid))
      .filter((i): i is ItemInstance => i !== undefined);
  }

  /**
   * Returns the `AbilityTemplate` id the player should use when firing from
   * the given slot (respects `abilityIdOverride`).
   */
  getActiveAbilityId(playerId: string, slot: EquipSlot): string | null {
    const instance = this.getEquipped(playerId, slot);
    if (!instance) return null;
    if (instance.abilityIdOverride) return instance.abilityIdOverride;
    const template = this.registry.getItem(instance.templateId);
    return template?.activeAbilityId ?? null;
  }

  // ── Ammo management ───────────────────────────────────────────────────────

  consumeAmmo(playerId: string, slot: EquipSlot, amount = 1): boolean {
    const instance = this.getEquipped(playerId, slot);
    if (!instance) return false;
    if (instance.currentAmmo === undefined) return true;  // infinite ammo
    if (instance.currentAmmo < amount) return false;
    instance.currentAmmo -= amount;
    instance.lastModified = Date.now();
    this.emitMutation(`inventory.${playerId}.ammo.${slot}`);
    return true;
  }

  startReload(playerId: string, slot: EquipSlot): number {
    const instance = this.getEquipped(playerId, slot);
    const template  = instance ? this.registry.getItem(instance.templateId) : null;
    if (!instance || !template?.magazineSize || !template.reloadTime) return 0;

    const needed    = template.magazineSize - (instance.currentAmmo ?? 0);
    const reserve   = instance.reserveAmmo ?? 0;
    const transfer  = Math.min(needed, reserve);
    instance.currentAmmo  = (instance.currentAmmo ?? 0) + transfer;
    instance.reserveAmmo  = reserve - transfer;
    instance.lastModified = Date.now();
    this.emitMutation(`inventory.${playerId}.ammo.${slot}`);

    return template.reloadTime;
  }

  addReserveAmmo(playerId: string, slot: EquipSlot, amount: number): void {
    const instance = this.getEquipped(playerId, slot);
    const template  = instance ? this.registry.getItem(instance.templateId) : null;
    if (!instance || instance.reserveAmmo === undefined) return;
    const cap = template?.reserveAmmoCap ?? Number.MAX_SAFE_INTEGER;
    instance.reserveAmmo = Math.min(cap, instance.reserveAmmo + amount);
    instance.lastModified = Date.now();
    this.emitMutation(`inventory.${playerId}.ammo.${slot}`);
  }

  // ── Observers ─────────────────────────────────────────────────────────────

  onEquipChange(cb: EquipChangeCallback): () => void {
    this.equipCallbacks.push(cb);
    return () => { this.equipCallbacks = this.equipCallbacks.filter((c) => c !== cb); };
  }

  attachMultiplayer(mp: ItemMultiplayerAdapter): void {
    this.multiplayer = mp;
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  exportInventory(playerId: string): PlayerInventory | null {
    return this.inventories.get(playerId) ?? null;
  }

  importInventory(inv: PlayerInventory): void {
    this.inventories.set(inv.playerId, inv);
    this.emitMutation(`inventory.${inv.playerId}`);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _applyPassives(playerId: string, instance: ItemInstance): void {
    const template = this.registry.getItem(instance.templateId);
    if (!template) return;

    const sourceBase = `equip:${instance.uuid}:base`;

    // Base passives (always on, roll = 1.0)
    for (const effectId of template.passiveEffectIds) {
      const effectTpl = this.registry.getEffect(effectId);
      if (!effectTpl) continue;
      const tplMods = effectTpl.modifiers.map((m) => ({ ...m }));
      // We apply these as a "passive" registered directly on the AttributeContainer
      // (EffectSystem.apply with kind=Passive keeps them until removeSource is called)
      this.effects.apply(playerId, effectId, sourceBase, 1.0);
    }

    // Affix passives (individual roll multipliers)
    for (const affix of instance.affixes) {
      const sourceAffix = `equip:${instance.uuid}:${affix.templateId}`;
      this.effects.apply(playerId, affix.templateId, sourceAffix, affix.rollMultiplier);
    }
  }

  private _unapplyPassives(playerId: string, uuid: UUID): void {
    const instance = this.instances.get(uuid);
    if (!instance) return;
    const template = this.registry.getItem(instance.templateId);
    if (!template) return;

    const sourceBase = `equip:${uuid}:base`;
    this.effects.removeSource(playerId, sourceBase);

    for (const affix of instance.affixes) {
      const sourceAffix = `equip:${uuid}:${affix.templateId}`;
      this.effects.removeSource(playerId, sourceAffix);
    }
  }

  private resolveMultiplayer(): ItemMultiplayerAdapter | null {
    return this.systemContext?.network.getClient() as ItemMultiplayerAdapter | null;
  }

  private emitMutation(path: string): void {
    gameBus.emit('stateMutation', {
      source: 'itemInstanceSystem',
      path,
      changedCount: 1,
    });
  }
}
