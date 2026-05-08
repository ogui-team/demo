/**
 * GASBridge.ts
 *
 * Connects the world-level pickup pipeline to the Gameplay Ability System (GAS).
 *
 * Responsibility:
 *   When the player picks up an entity whose `itemId` maps to a GAS template,
 *   this bridge:
 *     1. Creates a fresh `ItemInstance` from the correct `ItemTemplate`.
 *     2. Adds it to the player's GAS backpack.
 *     3. Auto-equips it to the appropriate slot (Primary for weapons, etc.).
 *     4. Fires an optional HUD notification so the player sees immediate feedback.
 *
 * The bridge is intentionally thin — it owns NO state beyond the sub-system
 * references. All durable state lives in `ItemInstanceSystem`.
 *
 * Pickup-ID → GAS template mapping
 * ─────────────────────────────────
 * Prefab `interactable.itemId` strings are in legacy catalogue format
 * (e.g. `"weapon_shotgun"`).  GAS template ids follow the `base_*` convention.
 * The static `PICKUP_MAP` below performs the translation.
 */

import type { DataRegistry }        from './DataRegistry';
import type { ItemInstanceSystem }  from './ItemInstanceSystem';
import type { EntityAttributeStore } from './AttributeContainer';

// ── Pickup-ID → GAS template mapping ─────────────────────────────────────────

/** Maps pickup `itemId` strings to their corresponding GAS `ItemTemplate` ids. */
const PICKUP_MAP: Readonly<Record<string, string>> = {
  // ── Weapons ──────────────────────────────────────────────────────────────
  weapon_shotgun:           'base_shotgun',
  weapon_pistol:            'base_pistol',
  weapon_grenade_launcher:  'base_grenade_launcher',

  // ── Tomes / Offhand ───────────────────────────────────────────────────────
  tome_necromancy:          'base_necromancy_tome',
  offhand_arcane:           'base_arcane_offhand',
  debug_fireball:           'debug_fireball',
  weapon_assault_rifle:     'base_assault_rifle',
  weapon_sniper_rifle:      'base_sniper_rifle',
  weapon_incinerator_gauntlet: 'weapon_incinerator_gauntlet',
  tome_ice_lance:           'tome_ice_lance',
  tome_fire_imp:            'tome_fire_imp',
  tome_ice_golem:           'tome_ice_golem',
  tome_arcane_advanced:     'tome_arcane_advanced',
  tome_poison:              'tome_poison',
  tome_holy:                'tome_holy',
  tome_storm_loop:          'tome_storm_loop',
  ring_dash:                'accessory_dash_ring',
  ring_summoner:            'accessory_summoner_ring',
  prism_guardian:           'accessory_guardian_prism',

  // ── Consumables ───────────────────────────────────────────────────────────
  // These items have equipSlot 'None' and no activeAbility.
  // GASBridge registers them in the ItemInstanceSystem backpack so the UI
  // can reflect ownership; actual healing/ammo effects are applied by the
  // InventorySystem / HealthSystem that process the pickup upstream.
  health_small:             'health_small',
  ammo_9mm:                 'ammo_9mm',
  ammo_shells:              'ammo_shells',
  shotgun_shells:           'shotgun_shells',
};

// ── GASBridge ─────────────────────────────────────────────────────────────────

export class GASBridge {
  private readonly registry:    DataRegistry;
  private readonly items:       ItemInstanceSystem;
  private readonly attributes:  EntityAttributeStore;
  private readonly onNotify:    ((text: string, duration?: number) => void) | null;

  constructor(
    registry:   DataRegistry,
    items:      ItemInstanceSystem,
    attributes: EntityAttributeStore,
    onNotify:   ((text: string, duration?: number) => void) | null = null,
  ) {
    this.registry   = registry;
    this.items      = items;
    this.attributes = attributes;
    this.onNotify   = onNotify;
  }

  // ── Player initialisation ─────────────────────────────────────────────────

  /**
   * Prepare GAS state for `playerId`.
   * Must be called once per player before any `onPickup` calls.
   * Idempotent — safe to call multiple times (e.g. on respawn).
   */
  initPlayer(playerId: string): void {
    this.items.initPlayer(playerId);
    this.attributes.ensure(playerId);
  }

  // ── Pickup handling ───────────────────────────────────────────────────────

  /**
   * Process a pickup event.
   *
   * @param playerId  The local player's ID (same key used by ItemInstanceSystem).
   * @param itemId    The `interactable.itemId` string from the picked-up entity.
   * @param quantity  How many items were picked up (default 1).
   */
  onPickup(playerId: string, itemId: string, quantity = 1): void {
    const templateId = PICKUP_MAP[itemId];
    if (!templateId) {
      // Not a GAS item (ammo, consumable health, etc.) — nothing to do here.
      return;
    }

    const template = this.registry.getItem(templateId);
    if (!template) {
      console.warn(`[GASBridge] Template "${templateId}" not found in DataRegistry.`);
      return;
    }

    if (quantity <= 0) {
      // A zero-quantity pickup means nothing was actually acquired.
      return;
    }

    // Ensure the player's GAS inventory exists.
    this.items.initPlayer(playerId);

    // Create one instance per unit picked up (e.g. qty > 1 for stackable items).
    const count = quantity;
    for (let i = 0; i < count; i++) {
      const instance = this.items.createInstance(templateId);
      if (!instance) break;

      // Add to backpack first, then auto-equip if slot is free or always-equip policy.
      this.items.addToBackpack(playerId, instance.uuid);

      // Auto-equip weapons / tomes; if the slot is already filled the item
      // stays in the backpack — the player can switch manually.
      if (template.equipSlot !== 'None') {
        const inv = this.items.getInventory(playerId);
        const slotOccupied = inv?.equipped[template.equipSlot] !== undefined;
        if (!slotOccupied) {
          this.items.equip(playerId, instance.uuid, template.equipSlot);
        }
      }
    }

    // ── HUD notification ────────────────────────────────────────────────────
    if (this.onNotify) {
      const label  = template.label ?? templateId;
      const prefix = count > 1 ? `${count}× ` : '';
      this.onNotify(`PICKED UP  ${prefix}${label.toUpperCase()}`, 3);
    }

    console.log(
      `[GASBridge] Player "${playerId}" picked up ${count}× "${templateId}"` +
      ` (slot: ${template.equipSlot})`,
    );
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  /**
   * Return `true` if the given pickup `itemId` has a GAS template mapping.
   * Useful for external code that wants to know whether a pickup will create
   * a GAS instance.
   */
  static hasGASTemplate(itemId: string): boolean {
    return Object.prototype.hasOwnProperty.call(PICKUP_MAP, itemId);
  }

  /** Expose the raw map for debugging / editor tooling. */
  static getPickupMap(): Readonly<Record<string, string>> {
    return PICKUP_MAP;
  }
}
