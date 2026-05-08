/**
 * EffectSystem.ts
 *
 * Manages *active* Gameplay Effects on entities.
 *
 * Responsibilities
 * ────────────────
 * 1. Apply  — register an effect instance on an entity, write modifiers to
 *             its AttributeContainer immediately (Passive / Instant), or
 *             schedule them for Duration/tick effects.
 * 2. Remove — clean up modifiers and active records by source-id.
 * 3. Tick   — called every frame; advances Duration-effect timers, fires ticks
 *             (DoT/HoT), and expires effects when their duration runs out.
 *
 * Each active instance has a unique `instanceId` (UUID) so multiple copies of
 * the same EffectTemplate can coexist on the same entity (e.g., two stacks of
 * Burning from two different sources).
 */

import type { EffectTemplate, AttributeModifier } from './CombatTypes';
import type { EntityAttributeStore } from './AttributeContainer';
import type { DataRegistry } from './DataRegistry';
import { gameBus } from '@engine/1-kernel/core/public-api';

// ── Active effect record ──────────────────────────────────────────────────────

export interface ActiveEffect {
  /** Unique instance id (UUID) — stable across ticks. */
  instanceId:     string;
  /** Template this instance was created from. */
  templateId:     string;
  /** Entity this effect is applied to. */
  entityId:       string;
  /**
   * Logical source that applied the effect (e.g. `'cast:fireball'`).
   * Used as the `sourceId` key in AttributeContainer so we can remove it
   * cleanly.
   */
  effectSourceId: string;
  /** Roll multiplier inherited from the affix that generated this effect. */
  rollMultiplier: number;
  /** Seconds remaining (Duration effects only). Negative = permanent. */
  timeRemaining:  number;
  /** Seconds until the next tick (DoT/HoT). null when not a tick effect. */
  tickTimer:      number | null;
  /** The resolved modifiers (with rollMultiplier already applied). */
  modifiers:      AttributeModifier[];
}

// ── Callback types ────────────────────────────────────────────────────────────

export type EffectApplyCallback   = (effect: ActiveEffect) => void;
export type EffectExpireCallback  = (effect: ActiveEffect) => void;
export type EffectTickCallback    = (effect: ActiveEffect, delta: { attribute: string; value: number }[]) => void;

// ── EffectSystem ──────────────────────────────────────────────────────────────

export class EffectSystem {
  private readonly registry:  DataRegistry;
  private readonly attributes: EntityAttributeStore;

  /** All currently active Duration/Passive effects by instanceId. */
  private readonly active = new Map<string, ActiveEffect>();

  private instanceCounter = 0;
  private totalApplied = 0;
  private totalExpired = 0;
  private totalTicks = 0;

  private applyCallbacks:  EffectApplyCallback[]  = [];
  private expireCallbacks: EffectExpireCallback[]  = [];
  private tickCallbacks:   EffectTickCallback[]    = [];

  constructor(registry: DataRegistry, attributes: EntityAttributeStore) {
    this.registry   = registry;
    this.attributes = attributes;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Apply an effect template to an entity.
   *
   * - `Instant`  : modifiers applied once, no active record kept.
   * - `Duration` : active record stored; modifiers applied on each tick OR
   *                once on start (if no `tickInterval`).
   * - `Passive`  : works exactly like Duration but with `timeRemaining = -1`
   *                (never expires).  Remove it explicitly via `removeSource`.
   *
   * @param entityId       Target entity.
   * @param templateId     `EffectTemplate.id`.
   * @param sourceId       Logical owner string (used as AttributeContainer key).
   * @param rollMultiplier Affix roll scalar (default 1.0).
   * @returns instanceId of the created record, or null for Instant effects.
   */
  apply(
    entityId:       string,
    templateId:     string,
    sourceId:       string,
    rollMultiplier  = 1.0,
  ): string | null {
    const template = this.registry.getEffect(templateId);
    if (!template) {
      console.warn(`[EffectSystem] Unknown effect template: ${templateId}`);
      return null;
    }

    const container = this.attributes.ensure(entityId);

    // -- Scale Add-op modifier values by rollMultiplier ----------------------
    const scaledMods: AttributeModifier[] = template.modifiers.map((m) => ({
      ...m,
      value: m.op === 'Add' ? m.value * rollMultiplier : m.value,
    }));

    // -- Instant effect: apply once and done ─────────────────────────────────
    if (template.kind === 'Instant') {
      for (const m of scaledMods) {
        if (m.attribute === 'Health') {
          container.applyHealthDelta(m.value);
        } else if (m.attribute === 'Mana') {
          container.applyManaDelta(m.value);
        } else {
          // One-shot: wrap in a temporary source that we remove immediately
          const tmpId = `${sourceId}_instant_${++this.instanceCounter}`;
          container.addModifiers(tmpId, [m]);
          container.removeSource(tmpId);
        }
      }
      return null;
    }

    // -- Passive / Duration: keep an active record ───────────────────────────
    const instanceId = `effect_${++this.instanceCounter}_${templateId}`;
    const effectSourceId = `${sourceId}__${instanceId}`;

    const hasTicks = typeof template.tickInterval === 'number'
      && template.tickInterval > 0;

    const record: ActiveEffect = {
      instanceId,
      templateId,
      entityId,
      effectSourceId,
      rollMultiplier,
      timeRemaining: template.kind === 'Passive'
        ? -1  // never expires without explicit removal
        : (template.duration ?? 0) > 0 ? template.duration! : -1,
      tickTimer:   hasTicks ? template.tickInterval! : null,
      modifiers:   scaledMods,
    };

    // Apply modifiers to AttributeContainer immediately
    // (for tick-based DoTs, the actual damage comes ON each tick,
    //  but non-Health/Mana modifiers like MoveSpeed=0 apply upfront)
    const persistentMods = scaledMods.filter(
      (m) => m.attribute !== 'Health' && m.attribute !== 'Mana',
    );
    if (persistentMods.length > 0) {
      container.addModifiers(effectSourceId, persistentMods);
    }

    // For tickers, health/mana changes happen in the tick, not upfront
    // For non-tickers with Duration, apply health/mana once now
    if (!hasTicks) {
      for (const m of scaledMods) {
        if (m.attribute === 'Health') container.applyHealthDelta(m.value);
        else if (m.attribute === 'Mana') container.applyManaDelta(m.value);
      }
    }

    this.active.set(instanceId, record);
    this.totalApplied += 1;
    gameBus.emit('stateMutation', {
      source: 'EffectSystem',
      path: 'effects.active',
      changedCount: 1,
    });

    for (const cb of this.applyCallbacks) {
      try { cb(record); } catch { /* guard observer crashes */ }
    }

    return instanceId;
  }

  /**
   * Remove any active effects that were registered with the given `sourceId`.
   * Used to clear passive item bonuses when an item is unequipped.
   *
   * All `effectSourceId`s are prefixed with `${sourceId}__`, so this does a
   * prefix scan.
   */
  removeSource(entityId: string, sourceId: string): void {
    const container = this.attributes.get(entityId);
    const expired: string[] = [];

    for (const [instanceId, effect] of this.active) {
      if (effect.entityId !== entityId) continue;
      if (!effect.effectSourceId.startsWith(`${sourceId}__`)) continue;
      container?.removeSource(effect.effectSourceId);
      expired.push(instanceId);
    }

    for (const id of expired) {
      const effect = this.active.get(id)!;
      this.active.delete(id);
      this.totalExpired += 1;
      for (const cb of this.expireCallbacks) {
        try { cb(effect); } catch { /**/ }
      }
    }
    if (expired.length > 0) {
      gameBus.emit('stateMutation', {
        source: 'EffectSystem',
        path: 'effects.active',
        changedCount: expired.length,
      });
    }
  }

  /**
   * Immediately remove a specific effect instance by its `instanceId`.
   */
  removeInstance(instanceId: string): void {
    const effect = this.active.get(instanceId);
    if (!effect) return;
    this.attributes.get(effect.entityId)?.removeSource(effect.effectSourceId);
    this.active.delete(instanceId);
    this.totalExpired += 1;
    for (const cb of this.expireCallbacks) {
      try { cb(effect); } catch { /**/ }
    }
    gameBus.emit('stateMutation', {
      source: 'EffectSystem',
      path: 'effects.active',
      changedCount: 1,
    });
  }

  clearAll(): void {
    const expired = [...this.active.values()];
    for (const effect of expired) {
      this.attributes.get(effect.entityId)?.removeSource(effect.effectSourceId);
    }
    this.active.clear();
    this.totalExpired += expired.length;
    if (expired.length > 0) {
      gameBus.emit('stateMutation', {
        source: 'EffectSystem',
        path: 'effects.active',
        changedCount: expired.length,
      });
    }
  }

  /**
   * Get all active effects for a given entity (read-only snapshot).
   */
  getActiveEffects(entityId: string): readonly ActiveEffect[] {
    const out: ActiveEffect[] = [];
    for (const effect of this.active.values()) {
      if (effect.entityId === entityId) out.push(effect);
    }
    return out;
  }

  /**
   * True if the entity has any active effect with the given tag.
   */
  hasTag(entityId: string, tag: string): boolean {
    for (const effect of this.active.values()) {
      if (effect.entityId !== entityId) continue;
      const template = this.registry.getEffect(effect.templateId);
      if (template?.tags?.includes(tag)) return true;
    }
    return false;
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  /**
   * Advance all Duration effects.
   * Call this once per game-loop frame with the elapsed time in seconds.
   */
  update(dt: number): void {
    const safeDt = Math.min(dt, 0.1);  // clamp to avoid spiral-of-death
    const expired: string[] = [];

    for (const [instanceId, effect] of this.active) {
      // Passive effects never expire on their own
      if (effect.timeRemaining < 0) continue;

      effect.timeRemaining -= safeDt;

      // Tick (DoT / HoT)
      if (effect.tickTimer !== null) {
        effect.tickTimer -= safeDt;
        if (effect.tickTimer <= 0) {
          const template = this.registry.getEffect(effect.templateId);
          effect.tickTimer = template?.tickInterval ?? 1;
          this._fireTick(effect);
        }
      }

      if (effect.timeRemaining <= 0) {
        expired.push(instanceId);
      }
    }

    for (const instanceId of expired) {
      const effect = this.active.get(instanceId)!;
      this.attributes
        .get(effect.entityId)
        ?.removeSource(effect.effectSourceId);
      this.active.delete(instanceId);
      this.totalExpired += 1;
      for (const cb of this.expireCallbacks) {
        try { cb(effect); } catch { /**/ }
      }
    }
    if (expired.length > 0) {
      gameBus.emit('stateMutation', {
        source: 'EffectSystem',
        path: 'effects.active',
        changedCount: expired.length,
      });
    }
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        activeEffects: this.active.size,
        totalApplied: this.totalApplied,
        totalExpired: this.totalExpired,
        totalTicks: this.totalTicks,
      },
    };
  }

  // ── Observers ─────────────────────────────────────────────────────────────

  onApply(cb: EffectApplyCallback):   () => void {
    this.applyCallbacks.push(cb);
    return () => { this.applyCallbacks = this.applyCallbacks.filter((c) => c !== cb); };
  }

  onExpire(cb: EffectExpireCallback): () => void {
    this.expireCallbacks.push(cb);
    return () => { this.expireCallbacks = this.expireCallbacks.filter((c) => c !== cb); };
  }

  onTick(cb: EffectTickCallback): () => void {
    this.tickCallbacks.push(cb);
    return () => { this.tickCallbacks = this.tickCallbacks.filter((c) => c !== cb); };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _fireTick(effect: ActiveEffect): void {
    const container = this.attributes.get(effect.entityId);
    if (!container) return;

    const deltas: { attribute: string; value: number }[] = [];

    for (const m of effect.modifiers) {
      if (m.attribute === 'Health') {
        container.applyHealthDelta(m.value);
        deltas.push({ attribute: 'Health', value: m.value });
      } else if (m.attribute === 'Mana') {
        container.applyManaDelta(m.value);
        deltas.push({ attribute: 'Mana', value: m.value });
      }
      // Non-Health/Mana mods are already applied as persistent modifiers
    }

    if (deltas.length > 0) {
      this.totalTicks += 1;
      for (const cb of this.tickCallbacks) {
        try { cb(effect, deltas); } catch { /**/ }
      }
    }
  }

  dispose(): void {
    // Clear all active effects and callbacks
    this.clearAll();
    this.applyCallbacks = [];
    this.expireCallbacks = [];
    this.tickCallbacks = [];
    // Reset counters
    this.instanceCounter = 0;
    this.totalApplied = 0;
    this.totalExpired = 0;
    this.totalTicks = 0;
  }
}
