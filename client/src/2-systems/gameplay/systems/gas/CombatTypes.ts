/**
 * CombatTypes.ts
 *
 * Single source of truth for every data shape used by the GAS pipeline.
 * All interfaces here are JSON-serialisable so a GUI editor can read/write
 * them directly without any code changes.
 *
 * Intentionally zero runtime dependencies — import freely everywhere.
 */

// ── Primitive aliases ─────────────────────────────────────────────────────────

/** Globally unique item instance identifier. */
export type UUID = string;

// ── Lookup-key enumerations ───────────────────────────────────────────────────

/** How an ability delivers its payload. */
export type AbilityDelivery = 'Hitscan' | 'Projectile' | 'AoE' | 'Summon';

/** Lifecycle of a Gameplay Effect. */
export type EffectKind = 'Instant' | 'Duration' | 'Passive';

/** Elemental / physical damage categories. */
export type DamageType =
  | 'Physical'
  | 'Fire'
  | 'Lightning'
  | 'Poison'
  | 'Arcane'
  | 'Explosion'
  | 'Ice'
  | 'Holy'
  | 'Shadow'
  | 'Chaos';

/**
 * Every numeric attribute a player (or summon) can have.
 * Add new keys here and the AttributeContainer picks them up automatically.
 */
export type AttributeKey =
  | 'Health'
  | 'MaxHealth'
  | 'Mana'
  | 'MaxMana'
  | 'MoveSpeed'
  | 'DamageMultiplier'    // 1.0 = base, >1 = bonus
  | 'CooldownReduction'  // 0.0 = none, 0.5 = 50% faster
  | 'Armor'
  | 'AttackSpeed'        // multiplier on fire-rate (1.0 = base)
  | 'Shield'             // absorb layer — drains before HP
  | 'MaxShield'          // max absorb capacity
  | 'Resistance'         // 0..1 elemental damage reduction
  | 'CritChance'         // 0..1 probability of a critical hit
  | 'CritDamage'         // multiplier applied on crit (1.5 = +50%)
  | 'LifeSteal';         // 0..1 fraction of damage restored as health

/** How an AttributeModifier is combined with the existing value. */
export type ModifierOp =
  | 'Add'            // flat addition  (+15)
  | 'MultiplyBase'   // multiplies the BASE value before flat adds (×1.15)
  | 'MultiplyTotal'; // multiplies the fully-resolved value last (×1.1)

/** Drop rarity tier. Drives affix count and roll quality. */
export type Rarity = 'Common' | 'Magic' | 'Rare' | 'Unique' | 'Legendary';

/** Equipment slot a player can have an item in. */
export type EquipSlot = 'Primary' | 'Secondary' | 'Spellbook' | 'None';

/** Broad category of an item (used for loot filter / UI grouping). */
export type ItemCategory =
  | 'Weapon'
  | 'Tome'
  | 'Offhand'
  | 'Consumable'
  | 'Accessory';

/** Resource consumed when using an ability. */
export type CostType = 'Mana' | 'Ammo' | 'Health';

// ── Effect / Buff templates ───────────────────────────────────────────────────

/**
 * A single stat change inside an EffectTemplate.
 * Fully serialisable — the GUI can expose each field as a form control.
 */
export interface AttributeModifier {
  attribute: AttributeKey;
  op:        ModifierOp;
  /** The numeric magnitude of the change. */
  value:     number;
}

/**
 * Defines a reusable Gameplay Effect (buff / debuff / stat stick).
 *
 * - `Instant`  — applied once when triggered.
 * - `Duration` — applied for `duration` seconds, optionally ticking every
 *               `tickInterval` seconds (useful for DoTs / HoTs).
 * - `Passive`  — applied for as long as the source item is equipped.
 */
export interface EffectTemplate {
  id:           string;
  label:        string;
  kind:         EffectKind;

  /**
   * Seconds the effect lasts (`Duration` only).
   * 0 or omitted = permanent while the source is active.
   */
  duration?:     number;

  /**
   * Seconds between each application of `modifiers` (`Duration`+DoT only).
   * Omitted = apply once on start, not repeatedly.
   */
  tickInterval?: number;

  /** The stat changes this effect applies. */
  modifiers:    AttributeModifier[];

  /** Tag strings useful for conditional logic, e.g. 'Rooted', 'OnFire'. */
  tags?:        string[];

  /** UI icon asset key. */
  iconKey?:     string;

  /** Human-readable tooltip. */
  description?: string;
}

// ── Ability templates ─────────────────────────────────────────────────────────

/** Config blob specific to Hitscan delivery. */
export interface HitscanConfig {
  range:    number;
  spread?:  number;
  pellets?: number;   // shotgun-style multi-hit
}

/** Config blob specific to Projectile delivery. */
export interface ProjectileConfig {
  speed:        number;
  lifetime:     number;
  radius:       number;
  splashRadius?: number;
  splashDamage?: number;
  gravityScale?: number;
  /** EntityManager mesh key for the visual representation. */
  assetKey?:    string;
}

/** Config blob specific to AoE delivery. */
export interface AoEConfig {
  /** Geometry used for target acquisition. Defaults to 'sphere'. */
  shape?:         'sphere' | 'ring' | 'cone';
  radius:        number;
  /** Inner radius used by `shape: 'ring'`. */
  innerRadius?:  number;
  /** Max range used by `shape: 'cone'` (defaults to radius when omitted). */
  range?:        number;
  /** Full cone angle in degrees for `shape: 'cone'`. */
  angleDeg?:     number;
  /** Seconds the AoE zone persists. 0 = instant burst. */
  duration?:     number;
  /** Tick rate for persistent AoE (DoT zone). */
  tickInterval?: number;
  falloff?:      'linear' | 'none';
}

/** Config blob specific to Summon delivery. */
export interface SummonConfig {
  /** EntityManager / asset-loader key for the summon mesh. */
  assetKey:    string;
  /** Optional AI context label (e.g. 'pet', 'totem', 'minion'). */
  spawnContext?: string;
  /** Maximum simultaneous summons the caster may have alive. */
  maxCount:    number;
  /** Seconds before the summon despawns. 0 = alive until killed. */
  lifetime:    number;
  maxHealth:   number;
  damagePerHit:number;
  attackRange: number;
  moveSpeed:   number;
  /** EffectTemplate ids applied to the summon entity on spawn. */
  spawnEffectIds?: string[];
}

/**
 * Defines an active ability (what happens when the player clicks / fires).
 *
 * `delivery` determines which of `hitscan`, `projectile`, `aoe`, or `summon`
 * config blobs is actually used at runtime.
 */
export interface AbilityTemplate {
  id:       string;
  label:    string;
  delivery: AbilityDelivery;

  /** Base damage before any attribute multipliers. */
  damage:     number;
  damageType: DamageType;

  /** Resource cost per use. */
  cost:     number;
  costType: CostType;

  /** Seconds before this ability can fire again (base value, reduced by CooldownReduction). */
  cooldown: number;

  /**
   * Optional shared cooldown bucket.
   * If set, all abilities in the same group share the same cooldown timer.
   */
  cooldownGroup?: string;

  /**
   * Optional linked groups that should also start cooling down when this
   * ability is used.
   */
  linkedCooldownGroups?: string[];

  /**
   * Optional conditional cooldown multipliers keyed by caster tags.
   * Example: { Berserk: 0.75, Exhausted: 1.2 }
   */
  cooldownTagMultipliers?: Record<string, number>;

  /**
   * String tags that must all be present on the caster for the ability to
   * fire (e.g. `['HasAmmo', 'NotReloading']`).
   */
  requiredTags?: string[];

  /** EffectTemplate ids applied to the *target* on successful hit. */
  onHitEffectIds?:  string[];

  /** EffectTemplate ids applied to the *caster* on cast (regardless of hit). */
  onCastEffectIds?: string[];

  // ── Delivery-specific config (one must be provided) ─────────────────────
  hitscan?:   HitscanConfig;
  projectile?: ProjectileConfig;
  aoe?:        AoEConfig;
  summon?:     SummonConfig;

  // ── UI metadata ──────────────────────────────────────────────────────────
  iconKey?:     string;
  description?: string;
  /** Animation clip to play on the caster when this ability fires. */
  animClip?:    string;
}

// ── Item templates ────────────────────────────────────────────────────────────

/**
 * Defines an item *base type* (the blueprint for loot drops).
 * An `ItemTemplate` never has a UUID — it's the read-only definition.
 * At runtime, `ItemInstance` objects are created from it.
 */
export interface ItemTemplate {
  id:       string;
  label:    string;
  category: ItemCategory;

  /** Which player slot this item occupies when equipped. */
  equipSlot: EquipSlot;

  /** `AbilityTemplate` id that fires when the player activates this item. */
  activeAbilityId: string;

  /**
   * `EffectTemplate` ids that are ALWAYS applied when the item is equipped
   * (regardless of affixes).  Think of these as the item's base stats.
   */
  passiveEffectIds: string[];

  /**
   * Pool of `EffectTemplate` ids that CAN randomly roll as affixes on a
   * dropped instance.  The loot roller picks from this list.
   */
  affixPool?: string[];

  // ── Ammo / magazine plumbing (bridged from WeaponSystem) ─────────────────
  magazineSize?:   number;
  reserveAmmoCap?: number;
  reloadTime?:     number;

  // ── Loot table metadata ───────────────────────────────────────────────────
  /** Higher weight = more common in the loot table. */
  dropWeight?: number;
  /** Minimum player level for this template to appear in drops. */
  minLevel?:   number;

  // ── UI ────────────────────────────────────────────────────────────────────
  iconKey?:     string;
  description?: string;
  /** 3-D mesh asset key used by EntityRenderer. */
  meshKey?:     string;
}

// ── Item instances ────────────────────────────────────────────────────────────

/** Quality tier of a rolled affix (drives the roll multiplier range). */
export type AffixTier = 'Minor' | 'Major' | 'Exalted';

/**
 * A single randomised affix on an `ItemInstance`.
 * References an `EffectTemplate` and carries an individual roll multiplier
 * so the UI can display the exact rolled stat value.
 */
export interface ItemAffix {
  /** `EffectTemplate` id. */
  templateId:     string;
  tier:           AffixTier;
  /**
   * Multiplier applied to all modifier *values* in the referenced template.
   * 1.0 = exact template value.  Generated at drop time.
   */
  rollMultiplier: number;
}

/**
 * A unique, network-safe item instance.
 *
 * - `uuid`       : globally unique, generated at drop time, persisted cross-session.
 * - `templateId` : foreign key into `DataRegistry.itemTemplates`.
 * - `affixes`    : rolled at drop time; immutable after creation (for item integrity).
 */
export interface ItemInstance {
  uuid:       UUID;
  templateId: string;
  level:      number;
  rarity:     Rarity;

  /** Randomised affixes generated when this instance was dropped / created. */
  affixes: ItemAffix[];

  /**
   * If set, overrides the parent template's `activeAbilityId`.
   * Useful for unique items with custom abilities.
   */
  abilityIdOverride?: string | null;

  // ── Runtime ammo state (ephemeral — reset on load) ────────────────────────
  currentAmmo?: number;
  reserveAmmo?: number;

  /** Server timestamp (ms) of the last state sync for conflict resolution. */
  lastModified?: number;
}

// ── Inventory layout ──────────────────────────────────────────────────────────

/** Map from slot name to the UUID of the equipped instance (if any). */
export type EquipSlotMap = Partial<Record<EquipSlot, UUID>>;

/** Full inventory state for one player. */
export interface PlayerInventory {
  playerId:        string;
  /** UUIDs of instances in the backpack (ordered). */
  backpack:        UUID[];
  /** Equipped items by slot. */
  equipped:        EquipSlotMap;
  maxBackpackSize: number;
}

// ── Attribute container snapshot ─────────────────────────────────────────────

/**
 * The fully-resolved attribute values for one entity after all modifiers are
 * applied.  Read-only snapshot exposed by `AttributeContainer.snapshot()`.
 */
export interface AttributeSnapshot {
  Health:             number;
  MaxHealth:          number;
  Mana:               number;
  MaxMana:            number;
  MoveSpeed:          number;
  DamageMultiplier:   number;
  CooldownReduction:  number;
  Armor:              number;
  AttackSpeed:        number;
  // Extended attributes
  Shield:             number;
  MaxShield:          number;
  Resistance:         number;
  CritChance:         number;
  CritDamage:         number;
  LifeSteal:          number;
}

/** Base attribute values before any modifiers. */
export const DEFAULT_ATTRIBUTES: AttributeSnapshot = {
  Health:            100,
  MaxHealth:         100,
  Mana:              100,
  MaxMana:           100,
  MoveSpeed:           5,
  DamageMultiplier:    1.0,
  CooldownReduction:   0.0,
  Armor:               0,
  AttackSpeed:         1.0,
  // Extended
  Shield:              0,
  MaxShield:           0,
  Resistance:          0.0,
  CritChance:          0.05,
  CritDamage:          1.5,
  LifeSteal:           0.0,
};

// ── Network action payloads ───────────────────────────────────────────────────

export interface EquipItemPayload {
  playerId: string;
  itemUuid: UUID;
  slot:     EquipSlot;
}

export interface UnequipItemPayload {
  playerId: string;
  slot:     EquipSlot;
}

export interface UseAbilityPayload {
  playerId:  string;
  abilityId: string;
  origin:    { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  targetId?: string;
}

export interface ItemDropPayload {
  playerId:   string;
  instance:   ItemInstance;
  /** World position where the item dropped. */
  position:   { x: number; y: number; z: number };
}

// ── Callback type helpers ─────────────────────────────────────────────────────

export type AbilityHitCallback = (event: {
  casterId:  string;
  abilityId: string;
  targetId:  string;
  damage:    number;
  point:     { x: number; y: number; z: number };
}) => void;

export type AbilityMissCallback = (event: {
  casterId:  string;
  abilityId: string;
  origin:    { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}) => void;

export type AbilityFireCallback = (event: {
  casterId:  string;
  abilityId: string;
  origin:    { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}) => void;

export type EquipChangeCallback = (event: {
  playerId:  string;
  slot:      EquipSlot;
  itemUuid:  UUID | null;
}) => void;
