/**
 * AbilitySystem.ts
 *
 * The GAS (Gameplay Ability System) core for the ARPG / Looter-Shooter.
 *
 * Responsibilities
 * ────────────────
 * 1. **Cooldown management** per (caster × ability).
 * 2. **Cost enforcement** — Mana and Ammo deducted before execution.
 * 3. **Delivery execution** for all four delivery types:
 *      Hitscan   → physics.raycastFirst (mirrors WeaponSystem pattern)
 *      Projectile → physics.addBody + per-frame movement (same loop as WeaponSystem)
 *      AoE        → physics.overlapSphere (instant or ticking zone)
 *      Summon     → entityManager.createEntity + simple AI component
 * 4. **Damage scaling** — raw `ability.damage` multiplied by the caster's
 *    `DamageMultiplier` attribute and `AttackSpeed` (which reduces cooldowns).
 * 5. **Effect application** — `onHitEffectIds` applied to targets,
 *    `onCastEffectIds` applied to the caster.
 * 6. **Multiplayer sync** — sends a server-authoritative gameplay command.
 *
 * Dependencies mirror WeaponSystem's constructor pattern so the two can
 * coexist during a gradual migration period.
 */

import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import type { GameplayCommandTransport } from '../../../../3-network/network/MultiplayerContracts';
import type {
  AbilityFireCallback,
  AbilityHitCallback,
  AbilityMissCallback,
  EquipSlot,
  DamageType,
} from './CombatTypes';
import type { DataRegistry } from './DataRegistry';
import type { EntityAttributeStore } from './AttributeContainer';
import type { Vector3 } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { createPointLightComponent } from '../components/LightComponent';
import { createProjectileComponent } from '../../game/components/ProjectileComponent';
import { createSphereCollider } from '../../game/components/ColliderComponent';
import { createAudioEmitterComponent } from '../../game/components/AudioEmitterComponent';
import * as Engine from '../../../../0-foundation/foundation/Engine';

interface AbilityEntityAdapter {
  id: string;
  addComponent(component: { name: string; data: unknown }): void;
  getComponent(componentName: string): { name: string; data: any } | undefined;
  setPosition(position: Vector3): void;
  getPosition(): Vector3;
}

interface EntityManagerAdapter {
  createEntity(entityType: string, config: { position: Vector3; rotation: Vector3 }): AbilityEntityAdapter;
  getEntity(entityId: string): AbilityEntityAdapter | undefined;
  getEntities(): Iterable<AbilityEntityAdapter>;
  destroyEntity(entityId: string): void;
}

interface PhysicsBodyAdapter {
  position: Vector3;
  velocity?: Vector3;
  gravityScale?: number;
}

interface PhysicsSystemAdapter {
  raycastFirst(origin: Vector3, direction: Vector3, options: { maxDistance: number; layerMask?: string[]; ignore?: string[] }): { entityId: string; point: Vector3 } | null;
  addBody(id: string, config: { shape: 'aabb' | 'sphere'; halfExtents?: Vector3; radius?: number; layer?: string; isStatic?: boolean; isTrigger?: boolean; isSensor?: boolean }): void;
  getBody(id: string): PhysicsBodyAdapter | undefined;
  overlapSphere(center: Vector3, radius: number, layers: string[]): string[];
  overlapRing(center: Vector3, innerRadius: number, outerRadius: number, query: { layerMask: string[]; ignore?: string[] }): string[];
  overlapCone(center: Vector3, direction: Vector3, range: number, angleDeg: number, query: { layerMask: string[]; ignore?: string[] }): string[];
  overlapSphereFiltered(center: Vector3, radius: number, query: { layerMask: string[]; ignore?: string[] }): string[];
  removeBody(id: string): void;
}

interface HealthSystemAdapter {
  applyDamage(targetId: string, opts: { amount: number; type?: string; sourceId?: string }): number;
  get?(targetId: string): { hp: number; maxHp: number; isDead?: boolean } | undefined;
}

interface EffectSystemAdapter {
  hasTag(entityId: string, tag: string): boolean;
  apply(entityId: string, effectId: string, sourceId: string, magnitude?: number): void;
}

interface ItemInstanceSystemAdapter {
  getActiveAbilityId(casterId: string, slot: EquipSlot): string | null;
  consumeAmmo(casterId: string, slot: EquipSlot, amount: number): boolean;
}

// ── Internal state types ──────────────────────────────────────────────────────

interface CooldownEntry {
  /** Seconds remaining until the ability can be used again. */
  remaining: number;
}

interface ActiveProjectile {
  id:           string;
  casterId:     string;
  casterEntityId?: string | null;
  abilityId:    string;
  position:     Vector3;
  direction:    Vector3;
  speed:        number;
  damage:       number;
  damageType:   DamageType;
  splashRadius: number;
  splashDamage: number;
  lifetime:     number;
  age:          number;
  visualEntityId: string | null;
}

interface ActiveAoEZone {
  id:          string;
  casterId:    string;
  casterEntityId?: string | null;
  abilityId:   string;
  center:      Vector3;
  radius:      number;
  shape:       'sphere' | 'ring' | 'cone';
  innerRadius: number;
  coneRange:    number;
  coneAngleDeg:number;
  direction:   Vector3;
  damage:      number;
  damageType:  DamageType;
  duration:    number;     // -1 = instant (already applied)
  age:         number;
  tickInterval:number;
  tickTimer:   number;
  onHitEffectIds: string[];
  falloff:     'linear' | 'none';
}

interface ActiveSummon {
  entityId:    string;
  casterId:    string;
  abilityId:   string;
  lifetime:    number;    // -1 = permanent until killed
  age:         number;
}

// ── Helper geometry ───────────────────────────────────────────────────────────

function v3len(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function v3norm(v: Vector3): Vector3 {
  const l = v3len(v);
  return l === 0 ? { x: 0, y: 0, z: -1 } : { x: v.x/l, y: v.y/l, z: v.z/l };
}

function v3scale(v: Vector3, s: number): Vector3 {
  return { x: v.x*s, y: v.y*s, z: v.z*s };
}

function v3dist(a: Vector3, b: Vector3): number {
  return v3len({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
}

function applySpread(dir: Vector3, spread: number): Vector3 {
  if (spread <= 0) return { ...dir };
  const arb = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const right = v3norm({
    x: dir.y * arb.z - dir.z * arb.y,
    y: dir.z * arb.x - dir.x * arb.z,
    z: dir.x * arb.y - dir.y * arb.x,
  });
  const up = v3norm({
    x: dir.y * right.z - dir.z * right.y,
    y: dir.z * right.x - dir.x * right.z,
    z: dir.x * right.y - dir.y * right.x,
  });
  const angle = Math.random() * Math.PI * 2;
  const mag   = Math.random() * Math.tan(spread);
  return v3norm({
    x: dir.x + (right.x * Math.cos(angle) + up.x * Math.sin(angle)) * mag,
    y: dir.y + (right.y * Math.cos(angle) + up.y * Math.sin(angle)) * mag,
    z: dir.z + (right.z * Math.cos(angle) + up.z * Math.sin(angle)) * mag,
  });
}

// ── AbilitySystem ─────────────────────────────────────────────────────────────

export interface AbilitySystemConfig {
  registry:      DataRegistry;
  attributes:    EntityAttributeStore;
  effects:       EffectSystemAdapter;
  items:         ItemInstanceSystemAdapter;
  physics:       PhysicsSystemAdapter;
  health:        HealthSystemAdapter;
  entityManager: EntityManagerAdapter;
  multiplayer?:  GameplayCommandTransport;
  enableLogging?: boolean;
}

export type AbilityAnimationSink = (casterId: string, abilityId: string, clip: string) => void;

export interface AbilityMovementIntent {
  horizontalImpulse: number;
  direction: Vector3;
}

export type AbilityMovementIntentSink = (casterId: string, abilityId: string, intent: AbilityMovementIntent) => void;

const SHIELD_DASH_HORIZONTAL_IMPULSE = 10;

export class AbilitySystem {
  private readonly registry:      DataRegistry;
  private readonly attributes:    EntityAttributeStore;
  private effects:                EffectSystemAdapter;
  private items:                  ItemInstanceSystemAdapter;
  private physics:                PhysicsSystemAdapter;
  private health:                 HealthSystemAdapter;
  private em:                     EntityManagerAdapter;
  private multiplayer:            GameplayCommandTransport | null;
  private systemContext:          SystemContext | null = null;
  private readonly log:           boolean;

  // ── Per-entity cooldown tracking ─────────────────────────────────────────
  /** key: `${casterId}::${abilityId}` */
  private readonly cooldowns = new Map<string, CooldownEntry>();
  /** key: `${casterId}::${groupName}` */
  private readonly groupCooldowns = new Map<string, CooldownEntry>();

  // ── Active world objects ──────────────────────────────────────────────────
  private readonly projectiles = new Map<string, ActiveProjectile>();
  private readonly aoeZones    = new Map<string, ActiveAoEZone>();
  /** Per-caster list of active summon entity IDs. */
  private readonly summons     = new Map<string, ActiveSummon[]>();

  private projCounter = 0;
  private aoeCounter  = 0;
  private impactCounter = 0;
  private readonly impactVFX = new Map<string, { id: string; entityId: string; age: number; lifetime: number }>();

  // ── Observers ─────────────────────────────────────────────────────────────
  private fireCallbacks: AbilityFireCallback[] = [];
  private hitCallbacks:  AbilityHitCallback[]  = [];
  private missCallbacks: AbilityMissCallback[] = [];
  private animationSink: AbilityAnimationSink | null = null;
  private movementIntentSink: AbilityMovementIntentSink | null = null;

  // ── Per-entity runtime condition tags ─────────────────────────────────────
  // Tags are evaluated against ability.requiredTags at fire time.
  // External systems (status effects, game logic) write here.
  /** key: casterId → Set of currently active condition tag strings. */
  private readonly conditionTags = new Map<string, Set<string>>();

  constructor(cfg: AbilitySystemConfig) {
    this.registry   = cfg.registry;
    this.attributes = cfg.attributes;
    this.effects    = cfg.effects;
    this.items      = cfg.items;
    this.physics    = cfg.physics;
    this.health     = cfg.health;
    this.em         = cfg.entityManager;
    this.multiplayer = cfg.multiplayer ?? null;
    this.log        = cfg.enableLogging ?? false;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    this.multiplayer = this.multiplayer ?? (ctx.network.getClient() as GameplayCommandTransport | null);
    this.physics = (ctx.systems.physicsSystem as PhysicsSystemAdapter | undefined) ?? this.physics;
    this.health = (ctx.systems.healthSystem as HealthSystemAdapter | undefined) ?? this.health;
    this.effects = (ctx.systems.effectSystem as EffectSystemAdapter | undefined) ?? this.effects;
    this.items = (ctx.systems.itemInstanceSystem as ItemInstanceSystemAdapter | undefined) ?? this.items;
    this.em = (ctx.entityManager as EntityManagerAdapter | null) ?? this.em;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  setAnimationSink(sink: AbilityAnimationSink | null): void {
    this.animationSink = sink;
  }

  setMovementIntentSink(sink: AbilityMovementIntentSink | null): void {
    this.movementIntentSink = sink;
  }

  // ── Condition tag API ─────────────────────────────────────────────────────

  /** Replace the full tag set for an entity (e.g. set from status effect tick). */
  setConditionTags(casterId: string, tags: string[]): void {
    this.conditionTags.set(casterId, new Set(tags));
  }

  /** Add a single tag (e.g. when an entity picks up ammo → 'HasAmmo'). */
  addConditionTag(casterId: string, tag: string): void {
    if (!this.conditionTags.has(casterId)) this.conditionTags.set(casterId, new Set());
    this.conditionTags.get(casterId)!.add(tag);
  }

  /** Remove a single tag. */
  removeConditionTag(casterId: string, tag: string): void {
    this.conditionTags.get(casterId)?.delete(tag);
  }

  /** Clear all condition tags for an entity (e.g. on death/respawn). */
  clearConditionTags(casterId: string): void {
    this.conditionTags.delete(casterId);
  }

  /** Read-only view of an entity's active tags. */
  getConditionTags(casterId: string): ReadonlySet<string> {
    return this.conditionTags.get(casterId) ?? new Set();
  }

  /** Returns `true` if the entity has ALL of the supplied tags. */
  hasAllTags(casterId: string, required: string[]): boolean {
    const tags = this.conditionTags.get(casterId);
    if (!required.length) return true;
    if (!tags) return false;
    return required.every((t) => tags.has(t));
  }

  // ── Cooldown query API ────────────────────────────────────────────────────

  /**
   * Returns a snapshot of all currently-cooling abilities for `casterId`.
   * Key = abilityId, value = seconds remaining.
   */
  getActiveCooldowns(casterId: string): Map<string, number> {
    const result = new Map<string, number>();
    const prefix = `${casterId}::`;
    for (const [key, entry] of this.cooldowns) {
      if (key.startsWith(prefix) && entry.remaining > 0) {
        result.set(key.slice(prefix.length), entry.remaining);
      }
    }
    return result;
  }

  /**
   * Returns 0..1 where 0 = ready, 1 = fully cooling.
   * Requires the template to be in the registry to know the base cooldown.
   */
  getCooldownFraction(casterId: string, abilityId: string): number {
    const key = `${casterId}::${abilityId}`;
    const entry = this.cooldowns.get(key);
    if (!entry || entry.remaining <= 0) return 0;
    const template = this.registry.getAbility(abilityId);
    if (!template || template.cooldown <= 0) return 0;
    return Math.min(1, entry.remaining / template.cooldown);
  }

  /** `true` if the ability is off-cooldown (or has no cooldown). */
  isReady(casterId: string, abilityId: string): boolean {
    if (this.getCooldownFraction(casterId, abilityId) !== 0) return false;
    const template = this.registry.getAbility(abilityId);
    if (!template?.cooldownGroup) return true;
    return (this.groupCooldowns.get(this._groupKey(casterId, template.cooldownGroup))?.remaining ?? 0) <= 0;
  }

  // ── Primary fire entry-point ──────────────────────────────────────────────

  /**
   * Attempt to activate the item in `slot` for `casterId`.
   *
   * @param casterId   Player entity id.
   * @param slot       Equipment slot ('Primary', 'Secondary', 'Spellbook').
   * @param origin     World-space fire origin.
   * @param direction  Normalised fire direction.
   * @param layerMask  Physics layer filter (forwarded to raycast/overlap).
   * @returns `true` if the ability fired successfully.
   */
  activateSlot(
    casterId:   string,
    slot:       EquipSlot,
    origin:     Vector3,
    direction:  Vector3,
    layerMask?: string[],
  ): boolean {
    const abilityId = this.items.getActiveAbilityId(casterId, slot);
    if (!abilityId) return false;
    return this.activateAbility(casterId, abilityId, origin, direction, layerMask);
  }

  /**
   * Attempt to activate a specific ability by id.
   * Validates cooldown, checks costs, executes delivery.
   */
  activateAbility(
    casterId:   string,
    abilityId:  string,
    origin:     Vector3,
    direction:  Vector3,
    layerMask?: string[],
  ): boolean {
    const ability = this.registry.getAbility(abilityId);
    if (!ability) {
      if (this.log) console.warn(`[AbilitySystem] Unknown ability: ${abilityId}`);
      return false;
    }

    // ── Cooldown check ────────────────────────────────────────────────────
    const cdKey  = `${casterId}::${abilityId}`;
    const cdEntry = this.cooldowns.get(cdKey);
    if (cdEntry && cdEntry.remaining > 0) return false;
    if (ability.cooldownGroup) {
      const groupRemaining = this.groupCooldowns.get(this._groupKey(casterId, ability.cooldownGroup))?.remaining ?? 0;
      if (groupRemaining > 0) return false;
    }

    // ── Attribute snapshot ────────────────────────────────────────────────
    const attrs = this.attributes.ensure(casterId).snapshot();

    // ── Required-tag check ─────────────────────────────────────────────────
    // Tags can come from EffectSystem (status effects) OR the conditionTags
    // map maintained by external systems (inventory pickups, game logic, etc.)
    for (const tag of ability.requiredTags ?? []) {
      const inEffects  = this.effects.hasTag(casterId, tag);
      const inConditional = this.conditionTags.get(casterId)?.has(tag) ?? false;
      if (!inEffects && !inConditional) return false;
    }

    // ── Cost deduction ────────────────────────────────────────────────────
    if (ability.costType === 'Mana') {
      if (attrs.Mana < ability.cost) return false;
      this.attributes.ensure(casterId).applyManaDelta(-ability.cost);
    } else if (ability.costType === 'Ammo') {
      // Ammo is managed by ItemInstanceSystem; determine slot from context
      // We search all equip slots for the item that owns this abilityId
      const slot = this._slotForAbility(casterId, abilityId);
      if (slot) {
        const consumed = this.items.consumeAmmo(casterId, slot, ability.cost);
        if (!consumed) return false;
      }
    } else if (ability.costType === 'Health') {
      if (attrs.Health <= ability.cost) return false;
      this.attributes.ensure(casterId).applyHealthDelta(-ability.cost);
    }

    // ── Apply effective cooldown (reduced by CooldownReduction) ───────────
    const cdReduction  = Math.min(0.9, attrs.CooldownReduction);  // max 90%
    const effectiveCd  = ability.cooldown * (1 - cdReduction) * this._getCooldownTagMultiplier(casterId, abilityId);
    this.cooldowns.set(cdKey, { remaining: effectiveCd });
    if (ability.cooldownGroup) {
      this.groupCooldowns.set(this._groupKey(casterId, ability.cooldownGroup), { remaining: effectiveCd });
    }
    for (const linkedGroup of ability.linkedCooldownGroups ?? []) {
      this.groupCooldowns.set(this._groupKey(casterId, linkedGroup), { remaining: effectiveCd });
    }
    gameBus.emit('cooldownStarted', { entityId: casterId, abilityId, duration: effectiveCd });

    // ── Calculate final damage ─────────────────────────────────────────────
    const scaledDamage = Math.round(ability.damage * attrs.DamageMultiplier);
    const finalDamage = abilityId === 'ability_fireball' ? 25 : scaledDamage;

    // ── Fire callbacks ─────────────────────────────────────────────────────
    const norm = v3norm(direction);
    for (const cb of this.fireCallbacks) {
      try { cb({ casterId, abilityId, origin, direction: norm }); } catch { /**/ }
    }
    const movementIntent = this.buildMovementIntent(abilityId, norm);
    if (movementIntent && this.movementIntentSink) {
      try { this.movementIntentSink(casterId, abilityId, movementIntent); } catch { /**/ }
    }
    if (ability.animClip && this.animationSink) {
      try { this.animationSink(casterId, abilityId, ability.animClip); } catch { /**/ }
    }
    gameBus.emit('abilityCast', { entityId: casterId, abilityId });

    // ── onCast effects ─────────────────────────────────────────────────────
    for (const effectId of ability.onCastEffectIds ?? []) {
      this.effects.apply(casterId, effectId, `cast:${abilityId}:${Date.now()}`, 1.0);
    }

    // ── Delivery ───────────────────────────────────────────────────────────
    switch (ability.delivery) {
      case 'Hitscan':
        this._executeHitscan(casterId, abilityId, ability, finalDamage, origin, norm, layerMask);
        break;
      case 'Projectile':
        this._spawnProjectile(casterId, abilityId, ability, finalDamage, origin, norm);
        break;
      case 'AoE':
        this._executeAoE(casterId, abilityId, ability, finalDamage, origin, norm);
        break;
      case 'Summon':
        this._executeSummon(casterId, abilityId, ability);
        break;
    }

    // ── Multiplayer sync ───────────────────────────────────────────────────
    const abilityPayload = {
      casterId,
      abilityId,
      origin:    { x: origin.x,    y: origin.y,    z: origin.z },
      direction: { x: norm.x,      y: norm.y,      z: norm.z },
      timestamp: Date.now(),
    };
    gameBus.emit('abilityActivationRequested', {
      entityId: casterId,
      abilityId,
      payload: abilityPayload,
    });
    this.sendGameplayCommand('use_ability', abilityPayload);

    return true;
  }

  // ── Cooldown queries ──────────────────────────────────────────────────────

  getCooldownRemaining(casterId: string, abilityId: string): number {
    return this.cooldowns.get(`${casterId}::${abilityId}`)?.remaining ?? 0;
  }

  isOnCooldown(casterId: string, abilityId: string): boolean {
    return this.getCooldownRemaining(casterId, abilityId) > 0;
  }

  /** Force-reset the cooldown for an ability (e.g. cheat code / power-up). */
  resetCooldown(casterId: string, abilityId: string): void {
    this.cooldowns.delete(`${casterId}::${abilityId}`);
  }

  clearRuntimeState(): void {
    for (const projectileId of [...this.projectiles.keys()]) {
      this._destroyProjectile(projectileId);
    }
    this.aoeZones.clear();
    for (const summonList of this.summons.values()) {
      for (const summon of summonList) {
        this.em.destroyEntity(summon.entityId);
      }
    }
    this.summons.clear();
    this.cooldowns.clear();
    this.groupCooldowns.clear();
    this.conditionTags.clear();
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  /**
   * Advance all timed state: cooldowns, active projectiles, AoE zones, summon lifetimes.
   * Call once per game-loop frame with elapsed seconds.
   */
  update(dt: number, entityPositions?: Map<string, Vector3>): void {
    const safeDt = Math.min(dt, 0.1);

    // -- Cooldowns ----------------------------------------------------------
    for (const [key, entry] of this.cooldowns) {
      entry.remaining -= safeDt;
      if (entry.remaining <= 0) this.cooldowns.delete(key);
    }
    for (const [key, entry] of this.groupCooldowns) {
      entry.remaining -= safeDt;
      if (entry.remaining <= 0) this.groupCooldowns.delete(key);
    }

    // -- Projectiles --------------------------------------------------------
    const expiredProj: string[] = [];
    for (const proj of this.projectiles.values()) {
      proj.age += safeDt;
      if (proj.age >= proj.lifetime) { expiredProj.push(proj.id); continue; }

      proj.position.x += proj.direction.x * proj.speed * safeDt;
      proj.position.y += proj.direction.y * proj.speed * safeDt;
      proj.position.z += proj.direction.z * proj.speed * safeDt;
      entityPositions?.set(proj.id, { ...proj.position });

      const body = this.physics.getBody(proj.id);
      if (body) body.position = { ...proj.position };

      if (proj.visualEntityId) {
        this.em.getEntity(proj.visualEntityId)?.setPosition({ ...proj.position });
      }

      const ability = this.registry.getAbility(proj.abilityId);
      const checkRadius = (proj.splashRadius > 0 ? proj.splashRadius : 0.3);
      const ignoreTargets = [proj.casterId, proj.id];
      if (proj.casterEntityId && proj.casterEntityId !== proj.casterId) {
        ignoreTargets.push(proj.casterEntityId);
      }
      const hits = this.physics.overlapSphereFiltered(proj.position, checkRadius, {
        layerMask: ['enemy', 'player', 'environment'],
        ignore: ignoreTargets,
      });
      for (const targetId of hits) {
        this._applyProjectileImpact(proj, targetId, ability?.onHitEffectIds ?? []);
        this._spawnImpactVFX(proj.position);
        expiredProj.push(proj.id);
        break;
      }
    }
    for (const id of expiredProj) this._destroyProjectile(id);

    // -- Impact VFX --------------------------------------------------------
    const expiredImpactVFX: string[] = [];
    for (const vfx of this.impactVFX.values()) {
      vfx.age += safeDt;
      if (vfx.age >= vfx.lifetime) expiredImpactVFX.push(vfx.id);
    }
    for (const id of expiredImpactVFX) {
      const vfx = this.impactVFX.get(id);
      if (vfx) this.em.destroyEntity(vfx.entityId);
      this.impactVFX.delete(id);
    }

    // -- AoE zones ----------------------------------------------------------
    const expiredAoE: string[] = [];
    for (const zone of this.aoeZones.values()) {
      zone.age += safeDt;
      if (zone.duration > 0 && zone.age >= zone.duration) {
        expiredAoE.push(zone.id);
        continue;
      }
      // Ticking AoE
      if (zone.tickInterval > 0) {
        zone.tickTimer -= safeDt;
        if (zone.tickTimer <= 0) {
          zone.tickTimer = zone.tickInterval;
          this._applyAoEDamage(zone);
        }
      }
    }
    for (const id of expiredAoE) this.aoeZones.delete(id);

    // -- Summons ------------------------------------------------------------
    for (const [casterId, list] of this.summons) {
      const surviving: ActiveSummon[] = [];
      for (const summon of list) {
        if (summon.lifetime > 0) {
          summon.age += safeDt;
          if (summon.age >= summon.lifetime) {
            this.em.destroyEntity(summon.entityId);
            continue;
          }
        }
        // Check if entity still alive
        if (!this.em.getEntity(summon.entityId)) continue;
        surviving.push(summon);
      }
      this.summons.set(casterId, surviving);
    }
  }

  // ── Observers ─────────────────────────────────────────────────────────────

  onFire(cb: AbilityFireCallback): () => void {
    this.fireCallbacks.push(cb);
    return () => { this.fireCallbacks = this.fireCallbacks.filter((c) => c !== cb); };
  }

  onHit(cb: AbilityHitCallback): () => void {
    this.hitCallbacks.push(cb);
    return () => { this.hitCallbacks = this.hitCallbacks.filter((c) => c !== cb); };
  }

  onMiss(cb: AbilityMissCallback): () => void {
    this.missCallbacks.push(cb);
    return () => { this.missCallbacks = this.missCallbacks.filter((c) => c !== cb); };
  }

  attachMultiplayer(mp: GameplayCommandTransport | null): void {
    this.multiplayer = mp;
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
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
        ...this.getDiagnostics(),
        hasSystemContext: this.systemContext !== null,
        activeConditionTagSets: this.conditionTags.size,
        trackedCasters: [...this.conditionTags.keys()].slice(0, 12),
        activeAbilities: this.projectiles.size + this.aoeZones.size,
      },
    };
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      cooldownCount: this.cooldowns.size,
      groupCooldownCount: this.groupCooldowns.size,
      projectileCount: this.projectiles.size,
      aoeZoneCount: this.aoeZones.size,
      summonCasterCount: this.summons.size,
      multiplayerAttached: this.multiplayer !== null,
    };
  }

  private sendGameplayCommand(type: string, payload: Record<string, unknown>): void {
    const network = this.systemContext?.network ?? null;
    if (network && (network.getClient() || network.getSync())) {
      network.sendCommand({ type, payload, abilityId: typeof payload.abilityId === 'string' ? payload.abilityId : undefined, timestamp: Date.now() });
      return;
    }
    if (this.multiplayer?.connected) {
      this.multiplayer.sendGameplayCommand(type, payload);
    }
  }

  private buildMovementIntent(abilityId: string, direction: Vector3): AbilityMovementIntent | null {
    switch (abilityId) {
      case 'ability_shield_dash': {
        const planarDirection = this.normalizePlanarDirection(direction);
        return {
          horizontalImpulse: SHIELD_DASH_HORIZONTAL_IMPULSE,
          direction: planarDirection,
        };
      }
      default:
        return null;
    }
  }

  private normalizePlanarDirection(direction: Vector3): Vector3 {
    const planar = { x: direction.x, y: 0, z: direction.z };
    const length = Math.hypot(planar.x, planar.z);
    if (length <= 0.00001) {
      return { x: 0, y: 0, z: 0 };
    }
    return {
      x: planar.x / length,
      y: 0,
      z: planar.z / length,
    };
  }

  // ── Delivery implementations ──────────────────────────────────────────────

  private _executeHitscan(
    casterId:   string,
    abilityId:  string,
    ability:    ReturnType<DataRegistry['getAbility']>  & object,
    damage:     number,
    origin:     Vector3,
    direction:  Vector3,
    layerMask?: string[],
  ): void {
    const cfg            = ability.hitscan;
    const pellets        = Math.max(1, cfg?.pellets ?? 1);
    const range          = cfg?.range ?? 1000;
    const spread         = cfg?.spread ?? 0;
    const ignoreTargets  = [casterId];
    const casterEntityId = this._resolveCasterEntityId(casterId);
    if (casterEntityId && casterEntityId !== casterId) ignoreTargets.push(casterEntityId);

    for (let p = 0; p < pellets; p++) {
      const dir = applySpread(direction, spread);
      const hit = this.physics.raycastFirst(origin, dir, {
        maxDistance: range,
        layerMask:   (layerMask as any) ?? ['enemy', 'player', 'environment'],
        ignore:      ignoreTargets,
      });

      if (hit) {
        const appliedDamage = this.health.applyDamage(hit.entityId, {
          amount:   damage,
          type:     ability.damageType as any,
          sourceId: casterId,
        });
        this.emitEntityDamageEvents(hit.entityId, casterId, abilityId, appliedDamage, hit.point);
        for (const effectId of ability.onHitEffectIds ?? []) {
          this.effects.apply(hit.entityId, effectId, `hit:${abilityId}:${Date.now()}`, 1.0);
        }
        for (const cb of this.hitCallbacks) {
          try { cb({ casterId, abilityId, targetId: hit.entityId, damage, point: hit.point }); } catch { /**/ }
        }
        if (this.log) console.log(`[AbilitySystem] Hitscan hit ${hit.entityId} for ${damage}`);
      } else {
        for (const cb of this.missCallbacks) {
          try { cb({ casterId, abilityId, origin, direction: dir }); } catch { /**/ }
        }
      }
    }
  }

  private _spawnProjectile(
    casterId:  string,
    abilityId: string,
    ability:   ReturnType<DataRegistry['getAbility']> & object,
    damage:    number,
    origin:    Vector3,
    direction: Vector3,
  ): void {
    const cfg = ability.projectile;
    if (!cfg) return;

    const id = `gas_proj_${++this.projCounter}`;
    let visualEntityId: string | null = null;
    const casterEntityId = this._resolveCasterEntityId(casterId);
    const projectileRadius = 0.2;
    const spawnOffset = { x: direction.x * 1.25, y: direction.y * 1.25 + 0.18, z: direction.z * 1.25 };
    const spawnPosition: Vector3 = {
      x: origin.x + spawnOffset.x,
      y: origin.y + spawnOffset.y,
      z: origin.z + spawnOffset.z,
    };

    const entity = this.em.createEntity('GASProjectile', {
      position: { ...spawnPosition },
      rotation: { x: 0, y: 0, z: 0 },
    });
    entity.addComponent({
      name: 'render',
      data: {
        meshType: 'sphere',
        color:    0xff7f1f,
        emissive: 0xff9a35,
        emissiveIntensity: 3.2,
        flatShading: true,
        geometry: { radius: projectileRadius, segments: 16 },
      },
    });
    entity.addComponent({
      name: 'light',
      data: createPointLightComponent({
        color: 0xff8800,
        intensity: 4.2,
        distance: 14,
        decay: 2,
        castShadow: true,
      }).data,
    });
    entity.addComponent({
      name: 'collider',
      data: createSphereCollider(projectileRadius, {
        isTrigger: true,
      }),
    });
    entity.addComponent({
      name: 'projectile',
      data: createProjectileComponent(cfg.speed, direction, cfg.lifetime, {
        gravity: cfg.gravityScale ?? 0,
        ownerId: casterId,
        impactDamage: damage,
        destroyOnImpact: true,
      }),
    });
    if (abilityId === 'ability_fireball') {
      entity.addComponent({
        name: 'audioEmitter',
        data: createAudioEmitterComponent('fireball_cast', {
          category: 'weapon',
          volume: 0.08,
          loop: true,
          autoPlay: true,
          maxDist: 24,
          toneHz: 520,
          waveform: 'triangle',
        }),
      });
      gameBus.emit('ABILITY_PROJECTILE_SPAWNED', {
        abilityId,
        casterId,
        projectileId: id,
        entityId: entity.id,
        position: { ...spawnPosition },
      });
    }
    Engine.getEntityRenderer()?.syncEntity(entity as any);
    visualEntityId = entity.id;

    this.physics.addBody(id, {
      shape:    'sphere',
      radius:   projectileRadius,
      layer:    'projectile',
      isStatic: false,
      isTrigger: true,
    });
    const body = this.physics.getBody(id);
    if (body) {
      body.position = { ...spawnPosition };
      body.velocity = v3scale(direction, cfg.speed);
      body.gravityScale = cfg.gravityScale ?? 0;
    }

    this.projectiles.set(id, {
      id,
      casterId,
      casterEntityId,
      abilityId,
      position:    { ...spawnPosition },
      direction:   { ...direction },
      speed:       cfg.speed,
      damage,
      damageType:  ability.damageType as DamageType,
      splashRadius: cfg.splashRadius ?? 0,
      splashDamage: cfg.splashDamage ?? damage,
      lifetime:    cfg.lifetime,
      age:         0,
      visualEntityId,
    });
  }

  private _executeAoE(
    casterId:  string,
    abilityId: string,
    ability:   ReturnType<DataRegistry['getAbility']> & object,
    damage:    number,
    origin:    Vector3,
    direction: Vector3,
  ): void {
    const cfg = ability.aoe;
    if (!cfg) return;

    const duration = cfg.duration ?? 0;

    // Instant AoE — apply damage immediately, don't register a zone
    if (duration <= 0 && !cfg.tickInterval) {
      const pseudoZone: ActiveAoEZone = {
        id: 'instant',
        casterId,
        casterEntityId: this._resolveCasterEntityId(casterId),
        abilityId,
        center:       { ...origin },
        radius:       cfg.radius,
        shape:        cfg.shape ?? 'sphere',
        innerRadius:  cfg.innerRadius ?? 0,
        coneRange:    cfg.range ?? cfg.radius,
        coneAngleDeg: cfg.angleDeg ?? 60,
        direction:    { ...direction },
        damage,
        damageType:   ability.damageType as DamageType,
        duration:     0,
        age:          0,
        tickInterval: 0,
        tickTimer:    0,
        onHitEffectIds: ability.onHitEffectIds ?? [],
        falloff:      cfg.falloff ?? 'none',
      };
      this._applyAoEDamage(pseudoZone);
      return;
    }

    const casterEntityId = this._resolveCasterEntityId(casterId);
    const id = `gas_aoe_${++this.aoeCounter}`;
    this.aoeZones.set(id, {
      id, casterId, casterEntityId, abilityId,
      center:       { ...origin },
      radius:       cfg.radius,
      shape:        cfg.shape ?? 'sphere',
      innerRadius:  cfg.innerRadius ?? 0,
      coneRange:    cfg.range ?? cfg.radius,
      coneAngleDeg: cfg.angleDeg ?? 60,
      direction:    { ...direction },
      damage,
      damageType:   ability.damageType as DamageType,
      duration,
      age:          0,
      tickInterval: cfg.tickInterval ?? 0,
      tickTimer:    cfg.tickInterval ?? 0,
      onHitEffectIds: ability.onHitEffectIds ?? [],
      falloff:      cfg.falloff ?? 'none',
    });
  }

  private _executeSummon(
    casterId:  string,
    abilityId: string,
    ability:   ReturnType<DataRegistry['getAbility']> & object,
  ): void {
    const cfg = ability.summon;
    if (!cfg) return;

    // Enforce max-summon cap
    const existing = (this.summons.get(casterId) ?? []).filter(
      (s) => this.em.getEntity(s.entityId) && s.abilityId === abilityId,
    );
    if (existing.length >= cfg.maxCount) {
      // Remove the oldest summon to make room
      const oldest = existing[0];
      this.em.destroyEntity(oldest.entityId);
      existing.splice(0, 1);
    }

    // Spawn entity
    const casterEntity = this.em.getEntity(casterId);
    const casterPos    = casterEntity?.getPosition() ?? { x: 0, y: 0, z: 0 };
    const spawnPos: Vector3 = {
      x: casterPos.x + (Math.random() - 0.5) * 4,
      y: casterPos.y,
      z: casterPos.z + (Math.random() - 0.5) * 4,
    };

    const summonEntity = this.em.createEntity('GAS_Summon', {
      position: spawnPos,
      rotation: { x: 0, y: 0, z: 0 },
    });

    summonEntity.addComponent({
      name: 'render',
      data: {
        meshType: 'custom',
        geometry: { assetKey: cfg.assetKey },
        color:    0x8855aa,
      },
    });

    // Attach health component (AI is application-tier; we wire the stats here)
    summonEntity.addComponent({
      name: 'summonAI',
      data: {
        masterId:    casterId,
        abilityId,
        spawnContext: cfg.spawnContext ?? 'minion',
        maxHealth:   cfg.maxHealth,
        health:      cfg.maxHealth,
        damagePerHit:cfg.damagePerHit,
        attackRange: cfg.attackRange,
        moveSpeed:   cfg.moveSpeed,
        alive:       true,
      },
    });

    // Initialise attribute container for the summon
    this.attributes.ensure(summonEntity.id, {
      Health:    cfg.maxHealth,
      MaxHealth: cfg.maxHealth,
      MoveSpeed: cfg.moveSpeed,
    });

    // Spawn effects
    for (const effectId of cfg.spawnEffectIds ?? []) {
      this.effects.apply(summonEntity.id, effectId, `spawn:${abilityId}`, 1.0);
    }

    const record: ActiveSummon = {
      entityId:  summonEntity.id,
      casterId,
      abilityId,
      lifetime:  cfg.lifetime > 0 ? cfg.lifetime : -1,
      age:       0,
    };

    const list = this.summons.get(casterId) ?? [];
    list.push(record);
    this.summons.set(casterId, list);

    if (this.log) {
      console.log(`[AbilitySystem] Summon spawned: ${summonEntity.id} for ${casterId}`);
    }
  }

  // ── Projectile impact ─────────────────────────────────────────────────────

  private _applyProjectileImpact(
    proj:            ActiveProjectile,
    primaryTargetId: string,
    onHitEffectIds:  string[],
  ): void {
    if (proj.abilityId === 'ability_fireball') {
      gameBus.emit('ABILITY_PROJECTILE_IMPACT', {
        abilityId: proj.abilityId,
        casterId: proj.casterId,
        targetId: primaryTargetId,
        position: { ...proj.position },
      });
    }

    if (proj.splashRadius > 0) {
      const targets = this.physics.overlapSphere(
        proj.position, proj.splashRadius, ['enemy', 'player'],
      );
      for (const tid of targets) {
        if (tid === proj.casterId || tid === proj.casterEntityId) continue;
        const body = this.physics.getBody(tid);
        const dist = v3dist(proj.position, body?.position ?? proj.position);
        const falloff = Math.max(0, 1 - dist / proj.splashRadius);
        const dmg = Math.round(proj.splashDamage * falloff);
        const appliedDamage = this.health.applyDamage(tid, { amount: dmg, type: proj.damageType as any, sourceId: proj.casterId });
        this.emitEntityDamageEvents(tid, proj.casterId, proj.abilityId, appliedDamage, proj.position);
        for (const effectId of onHitEffectIds) {
          this.effects.apply(tid, effectId, `projectile_hit:${Date.now()}`, 1.0);
        }
      }
      return;
    }

    const appliedDamage = this.health.applyDamage(primaryTargetId, {
      amount:   proj.damage,
      type:     proj.damageType as any,
      sourceId: proj.casterId,
    });
    this.emitEntityDamageEvents(primaryTargetId, proj.casterId, proj.abilityId, appliedDamage, proj.position);
    for (const effectId of onHitEffectIds) {
      this.effects.apply(primaryTargetId, effectId, `projectile_hit:${Date.now()}`, 1.0);
    }
    for (const cb of this.hitCallbacks) {
      try { cb({ casterId: proj.casterId, abilityId: proj.abilityId, targetId: primaryTargetId, damage: proj.damage, point: { ...proj.position } }); } catch { /**/ }
    }
  }

  private emitEntityDamageEvents(targetId: string, sourceId: string, abilityId: string, amount: number, position: Vector3): void {
    if (amount <= 0) {
      return;
    }

    const healthSnapshot = this.health.get?.(targetId);
    const killed = (healthSnapshot?.isDead ?? false) || (typeof healthSnapshot?.hp === 'number' && healthSnapshot.hp <= 0);

    gameBus.emit('ENTITY_HIT', {
      targetId,
      sourceId,
      abilityId,
      amount,
      position: { ...position },
      remainingHp: healthSnapshot?.hp ?? null,
      maxHp: healthSnapshot?.maxHp ?? null,
      killed,
    });

    if (killed) {
      gameBus.emit('ENTITY_KILLED', {
        targetId,
        killedBy: sourceId,
        abilityId,
        position: { ...position },
      });
    }
  }

  private _spawnImpactVFX(position: Vector3): void {
    const vfxId = `gas_impact_${++this.impactCounter}`;
    const entity = this.em.createEntity('GASImpactVFX', {
      position: { ...position },
      rotation: { x: 0, y: 0, z: 0 },
    });
    entity.addComponent({
      name: 'render',
      data: {
        meshType: 'sphere',
        color: 0xff4400,
        emissive: 0xff2200,
        emissiveIntensity: 3.0,
        flatShading: true,
        geometry: { radius: 0.12, segments: 12 },
      },
    });
    entity.addComponent({
      name: 'light',
      data: createPointLightComponent({
        color: 0xff0000,
        intensity: 5,
        distance: 6,
        decay: 2,
        castShadow: false,
      }).data,
    });
    Engine.getEntityRenderer()?.syncEntity(entity as any);
    this.impactVFX.set(vfxId, {
      id: vfxId,
      entityId: entity.id,
      age: 0,
      lifetime: 0.2,
    });
  }

  private _destroyProjectile(id: string): void {
    const proj = this.projectiles.get(id);
    if (!proj) return;
    if (proj.visualEntityId) this.em.destroyEntity(proj.visualEntityId);
    this.physics.removeBody(id);
    this.projectiles.delete(id);
  }

  // ── AoE damage application ────────────────────────────────────────────────

  private _applyAoEDamage(zone: ActiveAoEZone): void {
    const ignoreTargets = [zone.casterId];
    if (zone.casterEntityId && zone.casterEntityId !== zone.casterId) {
      ignoreTargets.push(zone.casterEntityId);
    }
    const query = { layerMask: ['enemy', 'player'], ignore: ignoreTargets };
    const targets = zone.shape === 'ring'
      ? this.physics.overlapRing(zone.center, zone.innerRadius, zone.radius, query)
      : zone.shape === 'cone'
        ? this.physics.overlapCone(zone.center, zone.direction, zone.coneRange, zone.coneAngleDeg, query)
        : this.physics.overlapSphereFiltered(zone.center, zone.radius, query);
    for (const tid of targets) {
      if (tid === zone.casterId || tid === zone.casterEntityId) continue;
      let dmg = zone.damage;
      if (zone.falloff === 'linear') {
        const body = this.physics.getBody(tid);
        const dist = v3dist(zone.center, body?.position ?? zone.center);
        const normDist = zone.shape === 'cone'
          ? Math.max(0.0001, zone.coneRange)
          : Math.max(0.0001, zone.radius);
        dmg = Math.round(zone.damage * Math.max(0, 1 - dist / normDist));
      }
      if (dmg <= 0) continue;
      this.health.applyDamage(tid, { amount: dmg, type: zone.damageType as any, sourceId: zone.casterId });
      for (const effectId of zone.onHitEffectIds) {
        this.effects.apply(tid, effectId, `aoe_hit:${zone.id}:${Date.now()}`, 1.0);
      }
      for (const cb of this.hitCallbacks) {
        try { cb({ casterId: zone.casterId, abilityId: zone.abilityId, targetId: tid, damage: dmg, point: { ...zone.center } }); } catch { /**/ }
      }
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  /**
   * Find which equip slot currently holds the item whose active ability is `abilityId`.
   */
  private _slotForAbility(casterId: string, abilityId: string): EquipSlot | null {
    const slots: EquipSlot[] = ['Primary', 'Secondary', 'Spellbook'];
    for (const slot of slots) {
      const id = this.items.getActiveAbilityId(casterId, slot);
      if (id === abilityId) return slot;
    }
    return null;
  }

  private _groupKey(casterId: string, groupName: string): string {
    return `${casterId}::${groupName}`;
  }

  private _getCooldownTagMultiplier(casterId: string, abilityId: string): number {
    const template = this.registry.getAbility(abilityId);
    if (!template?.cooldownTagMultipliers) return 1;

    let mult = 1;
    for (const [tag, value] of Object.entries(template.cooldownTagMultipliers)) {
      const fromEffect = this.effects.hasTag(casterId, tag);
      const fromCondition = this.conditionTags.get(casterId)?.has(tag) ?? false;
      if (fromEffect || fromCondition) {
        mult *= Math.max(0.1, value);
      }
    }
    return mult;
  }

  private _resolveCasterEntityId(casterId: string): string | null {
    const directEntity = this.em.getEntity(casterId);
    if (directEntity) return casterId;

    for (const entity of this.em.getEntities()) {
      const localPlayer = entity.getComponent('localPlayer')?.data as { playerId?: string } | undefined;
      if (localPlayer?.playerId === casterId) return entity.id;

      const dodAvatar = entity.getComponent('dodPlayerAvatar')?.data as { playerId?: string } | undefined;
      if (dodAvatar?.playerId === casterId) return entity.id;

      const networkEntityId = (entity as any).networkEntityId;
      if (typeof networkEntityId === 'string' && networkEntityId === casterId) return entity.id;
    }
    return null;
  }
}
