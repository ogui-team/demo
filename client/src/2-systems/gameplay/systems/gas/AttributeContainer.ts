/**
 * AttributeContainer.ts
 *
 * Per-entity attribute store with a layered modifier stack:
 *
 *   finalValue(attr) =
 *     (baseValue + Σ Add-mods)
 *     × Π MultiplyBase-mods
 *     × Π MultiplyTotal-mods
 *
 * Modifiers are keyed by a `sourceId` string so they can be added and
 * removed atomically without reference-equality issues.  The same sourceId
 * is used for:
 *   - A passive effect from an equipped item  → sourceId = `equip:<slot>`
 *   - An active (duration) effect             → sourceId = `effect:<uuid>`
 *
 * `snapshot()` returns a fully resolved, immutable `AttributeSnapshot` that
 * the rest of the system can read cheaply.
 */

import type {
  AttributeKey,
  AttributeModifier,
  AttributeSnapshot,
} from './CombatTypes';
import { DEFAULT_ATTRIBUTES } from './CombatTypes';

// ── Internal modifier record ──────────────────────────────────────────────────

interface StoredModifier extends AttributeModifier {
  /** Unique key tying this modifier to its source. */
  sourceId: string;
}

// ── AttributeContainer ────────────────────────────────────────────────────────

/**
 * Manages all numeric attributes for a single entity (player or summon).
 *
 * Usage pattern:
 * ```ts
 * const ac = new AttributeContainer();
 * // when item equipped:
 * ac.addModifiers('equip:Primary', itemPassiveModifiers);
 * // when item unequipped:
 * ac.removeSource('equip:Primary');
 * // every frame (or on demand):
 * const { DamageMultiplier, MoveSpeed } = ac.snapshot();
 * ```
 */
export class AttributeContainer {
  /**
   * Base values before any modifiers.
   * Mutable — call `setBase` to change (e.g. on level-up).
   */
  private base: AttributeSnapshot;

  /** All currently active modifiers, keyed by sourceId. */
  private readonly modifiers = new Map<string, StoredModifier[]>();

  /** Cached resolved snapshot; invalidated on any modifier change. */
  private cache: AttributeSnapshot | null = null;

  constructor(base: Partial<AttributeSnapshot> = {}) {
    this.base = { ...DEFAULT_ATTRIBUTES, ...base };
  }

  // ── Base value management ─────────────────────────────────────────────────

  /** Override a single base attribute (e.g. on level-up). */
  setBase(attribute: AttributeKey, value: number): void {
    (this.base as unknown as Record<string, number>)[attribute] = value;
    this.cache = null;
  }

  /** Replace all base values at once. */
  setBases(values: Partial<AttributeSnapshot>): void {
    this.base = { ...DEFAULT_ATTRIBUTES, ...values };
    this.cache = null;
  }

  getBase(attribute: AttributeKey): number {
    return this.base[attribute];
  }

  // ── Modifier management ───────────────────────────────────────────────────

  /**
   * Register a batch of modifiers from one logical source.
   * Calling this twice with the same `sourceId` *replaces* the previous
   * modifiers for that source.
   *
   * @param sourceId   Stable identifier (e.g. `'equip:Primary'`).
   * @param modifiers  List of `AttributeModifier` entries to apply.
   * @param rollMultiplier  Scalar applied to all Add-op modifier values
   *                        (used by affixes with individual roll values).
   */
  addModifiers(
    sourceId:       string,
    modifiers:      AttributeModifier[],
    rollMultiplier  = 1.0,
  ): void {
    const stored: StoredModifier[] = modifiers.map((m) => ({
      ...m,
      // Multiplicative modifiers aren't scaled by roll (they're discrete tiers)
      value:    m.op === 'Add' ? m.value * rollMultiplier : m.value,
      sourceId,
    }));
    this.modifiers.set(sourceId, stored);
    this.cache = null;
  }

  /** Remove all modifiers registered under `sourceId`. */
  removeSource(sourceId: string): void {
    if (this.modifiers.delete(sourceId)) this.cache = null;
  }

  /** True if any modifiers are registered under `sourceId`. */
  hasSource(sourceId: string): boolean {
    return this.modifiers.has(sourceId);
  }

  /** Remove all modifiers instantly (e.g. on entity death). */
  clearAll(): void {
    this.modifiers.clear();
    this.cache = null;
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  /**
   * Returns a resolved, immutable snapshot of all attribute values.
   * The result is cached until any modifier change invalidates it.
   */
  snapshot(): Readonly<AttributeSnapshot> {
    if (this.cache) return this.cache;

    // Flatten all stored modifiers into three buckets per attribute
    const adds:         Partial<Record<AttributeKey, number>>   = {};
    const mulBase:      Partial<Record<AttributeKey, number>>   = {};
    const mulTotal:     Partial<Record<AttributeKey, number>>   = {};

    for (const mods of this.modifiers.values()) {
      for (const m of mods) {
        const key = m.attribute;
        if (m.op === 'Add') {
          adds[key] = (adds[key] ?? 0) + m.value;
        } else if (m.op === 'MultiplyBase') {
          mulBase[key] = (mulBase[key] ?? 1) * m.value;
        } else {
          mulTotal[key] = (mulTotal[key] ?? 1) * m.value;
        }
      }
    }

    // Resolve each attribute key
    const resolved: AttributeSnapshot = { ...this.base };

    for (const key of Object.keys(this.base) as AttributeKey[]) {
      const base  = this.base[key];
      const add   = adds[key]     ?? 0;
      const mB    = mulBase[key]  ?? 1;
      const mT    = mulTotal[key] ?? 1;

      resolved[key] = (base + add) * mB * mT;
    }

    // Hard clamps (Health / Mana can't exceed their maximums)
    resolved.Health = Math.min(resolved.Health, resolved.MaxHealth);
    resolved.Mana   = Math.min(resolved.Mana,   resolved.MaxMana);
    // Nothing can be negative
    for (const key of Object.keys(resolved) as AttributeKey[]) {
      if (resolved[key] < 0) resolved[key] = 0;
    }

    this.cache = resolved;
    return this.cache;
  }

  /** Directly read a single resolved attribute. */
  get(attribute: AttributeKey): number {
    return this.snapshot()[attribute];
  }

  /** Apply a delta directly to the *base* Health (for damage / healing). */
  applyHealthDelta(delta: number): void {
    const current    = this.base.Health;
    const maxHealth  = this.snapshot().MaxHealth;
    this.base.Health = Math.max(0, Math.min(maxHealth, current + delta));
    this.cache = null;
  }

  /** Apply a delta directly to the *base* Mana. */
  applyManaDelta(delta: number): void {
    const current  = this.base.Mana;
    const maxMana  = this.snapshot().MaxMana;
    this.base.Mana = Math.max(0, Math.min(maxMana, current + delta));
    this.cache = null;
  }

  /** Returns `true` if the entity has no health left. */
  isDead(): boolean {
    return this.base.Health <= 0;
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  /** Export current state for network sync / save-load. */
  export(): { base: AttributeSnapshot; sources: Record<string, StoredModifier[]> } {
    const sources: Record<string, StoredModifier[]> = {};
    for (const [k, v] of this.modifiers) sources[k] = v;
    return { base: { ...this.base }, sources };
  }

  /** Restore state from an exported snapshot. */
  import(data: ReturnType<AttributeContainer['export']>): void {
    this.base = { ...DEFAULT_ATTRIBUTES, ...data.base };
    this.modifiers.clear();
    for (const [k, v] of Object.entries(data.sources)) this.modifiers.set(k, v);
    this.cache = null;
  }
}

// ── EntityAttributeStore ──────────────────────────────────────────────────────

/**
 * Lightweight registry that maps entity IDs to `AttributeContainer` instances.
 * Used by `EffectSystem` and `AbilitySystem` to look up any entity by string id.
 */
export class EntityAttributeStore {
  private readonly store = new Map<string, AttributeContainer>();

  /** Create (or ensure) an `AttributeContainer` for `entityId`. */
  ensure(entityId: string, base?: Partial<AttributeSnapshot>): AttributeContainer {
    const existing = this.store.get(entityId);
    if (existing) return existing;
    const container = new AttributeContainer(base);
    this.store.set(entityId, container);
    return container;
  }

  get(entityId: string): AttributeContainer | undefined {
    return this.store.get(entityId);
  }

  remove(entityId: string): void {
    this.store.delete(entityId);
  }

  clearAll(): void {
    this.store.clear();
  }

  has(entityId: string): boolean {
    return this.store.has(entityId);
  }

  /** Snapshot all entities (for network broadcast or UI). */
  snapshotAll(): Record<string, AttributeSnapshot> {
    const out: Record<string, AttributeSnapshot> = {};
    for (const [id, container] of this.store) out[id] = { ...container.snapshot() };
    return out;
  }
}
