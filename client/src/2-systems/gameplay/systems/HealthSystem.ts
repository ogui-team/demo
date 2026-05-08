/**
 * HealthSystem
 * Component-based health, damage, and death management.
 * Works identically for Player, Enemy, and any damageable Entity.
 * Syncs health values to StateManager for multiplayer consistency.
 *
 * Usage:
 *   import { HealthSystem } from './systems/HealthSystem';
 *
 *   const health = new HealthSystem(stateManager);
 *   health.register('player_01', { maxHp: 100, armor: 0.2 });
 *   health.applyDamage('player_01', { amount: 30, type: 'bullet', sourceId: 'enemy_02' });
 *   health.onDeath((evt) => { ... });
 */

import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

interface HealthStateStoreAdapter {
  set(path: string, value: unknown): void;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type DamageType = 'bullet' | 'explosion' | 'melee' | 'fire' | 'poison' | 'fall' | 'generic';

export interface HealthConfig {
  /** Maximum (and initial) hit points. Default 100. */
  maxHp?: number;
  /** Flat damage reduction applied before hp loss (0..1). Default 0. */
  armor?: number;
  /** Whether the entity can be revived after death. Default false. */
  revivable?: boolean;
  /** Invulnerability window in seconds after being hit. Default 0. */
  invulnerabilityDuration?: number;
  /** HP regeneration per second when not recently damaged. Default 0. */
  regenRate?: number;
  /** Seconds of no-damage before regen begins.  Default 5. */
  regenDelay?: number;
  /** Starting shield amount. Default 0. */
  shield?: number;
  /** Max shield capacity. Default 0 (disabled). */
  maxShield?: number;
  /** Shield regeneration per second. Default 0. */
  shieldRegenRate?: number;
  /** Seconds before shield regen starts after damage. Default 5. */
  shieldRegenDelay?: number;
}

export interface HealthComponent {
  entityId: string;
  hp: number;
  maxHp: number;
  armor: number;
  revivable: boolean;
  isAlive: boolean;
  isDead: boolean;
  /** Tracks invulnerability window, in seconds. */
  invulnerabilityTimer: number;
  invulnerabilityDuration: number;
  regenRate: number;
  regenDelay: number;
  /** Seconds since last damage. When > regenDelay, regen starts. */
  timeSinceLastDamage: number;
  /** Absorb layer — damage drains shield before HP. */
  shield: number;
  /** Maximum shield capacity (0 = no shield feature). */
  maxShield: number;
  /** Regen rate for shield per second (0 = no regen). */
  shieldRegenRate: number;
  /** Seconds of no-damage before shield regen begins. */
  shieldRegenDelay: number;
}

export interface DamageEvent {
  targetId: string;
  sourceId?: string;
  amount: number;
  /** Effective damage after armor reduction. */
  effectiveDamage: number;
  type: DamageType;
  /** HP remaining after the hit. */
  hpAfter: number;
}

export interface DeathEvent {
  entityId: string;
  killedBy?: string;
  damageType: DamageType;
}

export interface HealEvent {
  entityId: string;
  amount: number;
  hpAfter: number;
}

export interface ShieldEvent {
  entityId: string;
  /** Positive = shield added, negative = shield absorbed damage. */
  delta: number;
  shieldAfter: number;
}

export type DamageCallback = (event: DamageEvent) => void;
export type DeathCallback  = (event: DeathEvent)  => void;
export type HealCallback   = (event: HealEvent)   => void;
export type ShieldCallback = (event: ShieldEvent) => void;

// ─── HealthSystem ─────────────────────────────────────────────────────────────

export class HealthSystem {
  private components: Map<string, HealthComponent> = new Map();
  private stateManager: HealthStateStoreAdapter | null;
  private systemContext: SystemContext | null = null;

  private damageCallbacks: DamageCallback[] = [];
  private deathCallbacks:  DeathCallback[]  = [];
  private healCallbacks:   HealCallback[]   = [];
  private shieldCallbacks: ShieldCallback[] = [];

  constructor(stateManager?: HealthStateStoreAdapter) {
    this.stateManager = stateManager ?? null;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      registeredEntities: this.components.size,
      aliveEntities: [...this.components.values()].filter((component) => component.isAlive).length,
      deadEntities: [...this.components.values()].filter((component) => component.isDead).length,
      shieldedEntities: [...this.components.values()].filter((component) => component.maxShield > 0).length,
      hasSystemContext: this.systemContext !== null,
      replicatedStateRoot: 'health.*',
      sampleEntityIds: [...this.components.keys()].slice(0, 12),
    };
  }

  // ─── Registration ──────────────────────────────────────────────────────────

  register(entityId: string, config: HealthConfig = {}): HealthComponent {
    const maxHp = config.maxHp ?? 100;
    const comp: HealthComponent = {
      entityId,
      hp: maxHp,
      maxHp,
      armor: Math.max(0, Math.min(1, config.armor ?? 0)),
      revivable: config.revivable ?? false,
      isAlive: true,
      isDead: false,
      invulnerabilityTimer: 0,
      invulnerabilityDuration: config.invulnerabilityDuration ?? 0,
      regenRate: config.regenRate ?? 0,
      regenDelay: config.regenDelay ?? 5,
      timeSinceLastDamage: 9999,
      shield:           Math.min(config.shield ?? 0, config.maxShield ?? 0),
      maxShield:        config.maxShield ?? 0,
      shieldRegenRate:  config.shieldRegenRate ?? 0,
      shieldRegenDelay: config.shieldRegenDelay ?? 5,
    };

    this.components.set(entityId, comp);
    this._syncToState(entityId);
    return comp;
  }

  unregister(entityId: string): void {
    this.components.delete(entityId);
  }

  clearAll(): void {
    this.components.clear();
  }

  get(entityId: string): HealthComponent | undefined {
    return this.components.get(entityId);
  }

  isAlive(entityId: string): boolean {
    return this.components.get(entityId)?.isAlive ?? false;
  }

  // ─── Damage ────────────────────────────────────────────────────────────────

  /**
   * Apply damage to an entity.
   * Shield absorbs damage first, then HP is reduced by any remainder.
   * Returns the effective damage dealt (after armor + shield), or 0 if immune/dead.
   */
  applyDamage(
    targetId: string,
    opts: { amount: number; type?: DamageType; sourceId?: string },
  ): number {
    const comp = this.components.get(targetId);
    if (!comp || comp.isDead) return 0;
    if (comp.invulnerabilityTimer > 0) return 0;

    const type: DamageType = opts.type ?? 'generic';
    const rawAmount = Math.max(0, opts.amount);

    // Armor reduces damage multiplicatively
    const armorReduced = rawAmount * (1 - comp.armor);

    // Shield absorbs before HP
    let shieldAbsorbed = 0;
    if (comp.shield > 0) {
      shieldAbsorbed = Math.min(comp.shield, armorReduced);
      comp.shield = Math.max(0, comp.shield - shieldAbsorbed);
      this.shieldCallbacks.forEach((cb) => cb({ entityId: targetId, delta: -shieldAbsorbed, shieldAfter: comp.shield }));
    }

    const effective = armorReduced - shieldAbsorbed;
    comp.hp = Math.max(0, comp.hp - effective);
    comp.timeSinceLastDamage = 0;

    // Start invulnerability window
    if (comp.invulnerabilityDuration > 0) {
      comp.invulnerabilityTimer = comp.invulnerabilityDuration;
    }

    const evt: DamageEvent = {
      targetId,
      sourceId: opts.sourceId,
      amount: rawAmount,
      effectiveDamage: effective + shieldAbsorbed,
      type,
      hpAfter: comp.hp,
    };
    this.damageCallbacks.forEach((cb) => cb(evt));
    this._syncToState(targetId);

    if (comp.hp <= 0) {
      this._triggerDeath(comp, opts.sourceId, type);
    }

    return effective + shieldAbsorbed;
  }

  // ─── Healing ───────────────────────────────────────────────────────────────

  heal(entityId: string, amount: number): number {
    const comp = this.components.get(entityId);
    if (!comp || comp.isDead) return 0;
    const before = comp.hp;
    comp.hp = Math.min(comp.maxHp, comp.hp + Math.max(0, amount));
    const healed = comp.hp - before;
    if (healed > 0) {
      const evt: HealEvent = { entityId, amount: healed, hpAfter: comp.hp };
      this.healCallbacks.forEach((cb) => cb(evt));
      this._syncToState(entityId);
    }
    return healed;
  }

  setHp(entityId: string, hp: number): void {
    const comp = this.components.get(entityId);
    if (!comp) return;
    comp.hp = Math.max(0, Math.min(comp.maxHp, hp));
    this._syncToState(entityId);
  }

  // ─── Shield ────────────────────────────────────────────────────────────────

  /** Set shield directly (clamped to [0, maxShield]). */
  setShield(entityId: string, amount: number): void {
    const comp = this.components.get(entityId);
    if (!comp) return;
    const prev = comp.shield;
    comp.shield = Math.max(0, Math.min(comp.maxShield, amount));
    const delta = comp.shield - prev;
    if (delta !== 0) {
      this.shieldCallbacks.forEach((cb) => cb({ entityId, delta, shieldAfter: comp.shield }));
      gameBus.emit('shieldChanged', { entityId, shield: comp.shield, maxShield: comp.maxShield });
      this._syncToState(entityId);
    }
  }

  /** Add (or subtract with negative) shield, clamped. Returns actual delta. */
  addShield(entityId: string, amount: number): number {
    const comp = this.components.get(entityId);
    if (!comp) return 0;
    const prev = comp.shield;
    comp.shield = Math.max(0, Math.min(comp.maxShield, comp.shield + amount));
    const delta = comp.shield - prev;
    if (delta !== 0) {
      this.shieldCallbacks.forEach((cb) => cb({ entityId, delta, shieldAfter: comp.shield }));
      gameBus.emit('shieldChanged', { entityId, shield: comp.shield, maxShield: comp.maxShield });
      this._syncToState(entityId);
    }
    return delta;
  }

  /** Update shield capacity and clamp current shield to the new range. */
  setMaxShield(entityId: string, maxShield: number): void {
    const comp = this.components.get(entityId);
    if (!comp) return;
    comp.maxShield = Math.max(0, maxShield);
    comp.shield = Math.max(0, Math.min(comp.shield, comp.maxShield));
    gameBus.emit('shieldChanged', { entityId, shield: comp.shield, maxShield: comp.maxShield });
    this._syncToState(entityId);
  }

  /**
   * Safe channel-sync helper for bridging external stat systems (e.g. GAS)
   * into HealthSystem without recreating components.
   */
  syncVitals(
    entityId: string,
    vitals: {
      hp?: number;
      maxHp?: number;
      shield?: number;
      maxShield?: number;
      armor?: number;
    },
  ): void {
    const comp = this.components.get(entityId);
    if (!comp) return;
    const wasDead = comp.isDead;

    if (typeof vitals.maxHp === 'number') {
      comp.maxHp = Math.max(1, vitals.maxHp);
    }
    if (typeof vitals.hp === 'number') {
      comp.hp = Math.max(0, Math.min(comp.maxHp, vitals.hp));
      if (comp.hp > 0) {
        comp.isDead = false;
        comp.isAlive = true;
        if (wasDead) {
          comp.invulnerabilityTimer = 0;
          comp.timeSinceLastDamage = 0;
        }
      }
      if (comp.hp <= 0 && !comp.isDead) {
        this._triggerDeath(comp, undefined, 'generic');
      }
    }
    if (typeof vitals.maxShield === 'number') {
      comp.maxShield = Math.max(0, vitals.maxShield);
    }
    if (typeof vitals.shield === 'number') {
      comp.shield = Math.max(0, Math.min(comp.maxShield, vitals.shield));
    }
    if (typeof vitals.armor === 'number') {
      comp.armor = Math.max(0, Math.min(1, vitals.armor));
    }

    gameBus.emit('shieldChanged', { entityId, shield: comp.shield, maxShield: comp.maxShield });
    this._syncToState(entityId);
  }

  getShield(entityId: string): number {
    return this.components.get(entityId)?.shield ?? 0;
  }

  getMaxShield(entityId: string): number {
    return this.components.get(entityId)?.maxShield ?? 0;
  }

  /** Shield as 0..1 fraction. */
  getShieldFraction(entityId: string): number {
    const comp = this.components.get(entityId);
    if (!comp || comp.maxShield === 0) return 0;
    return comp.shield / comp.maxShield;
  }

  // ─── Death / Revival ───────────────────────────────────────────────────────

  kill(entityId: string, killedBy?: string): void {
    const comp = this.components.get(entityId);
    if (!comp || comp.isDead) return;
    comp.hp = 0;
    this._triggerDeath(comp, killedBy, 'generic');
  }

  revive(entityId: string, hpPercent: number = 1): boolean {
    const comp = this.components.get(entityId);
    if (!comp || !comp.revivable) return false;
    comp.hp = Math.max(1, Math.floor(comp.maxHp * hpPercent));
    comp.isAlive = true;
    comp.isDead  = false;
    comp.invulnerabilityTimer = comp.invulnerabilityDuration;
    this._syncToState(entityId);
    return true;
  }

  // ─── Per-frame update ──────────────────────────────────────────────────────

  update(deltaTime: number): void {
    const dt = Math.min(deltaTime, 0.1);
    this.components.forEach((comp) => {
      if (comp.isDead) return;

      // Invulnerability countdown
      if (comp.invulnerabilityTimer > 0) {
        comp.invulnerabilityTimer = Math.max(0, comp.invulnerabilityTimer - dt);
      }

      comp.timeSinceLastDamage += dt;

      // HP regeneration
      if (comp.regenRate > 0 && comp.timeSinceLastDamage >= comp.regenDelay && comp.hp < comp.maxHp) {
        const regen = comp.regenRate * dt;
        this.heal(comp.entityId, regen);
      }

      // Shield regeneration
      if (comp.shieldRegenRate > 0 && comp.timeSinceLastDamage >= comp.shieldRegenDelay && comp.shield < comp.maxShield) {
        this.addShield(comp.entityId, comp.shieldRegenRate * dt);
      }
    });
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  onDamage(cb: DamageCallback): () => void {
    this.damageCallbacks.push(cb);
    return () => { this.damageCallbacks = this.damageCallbacks.filter((c) => c !== cb); };
  }

  onDeath(cb: DeathCallback): () => void {
    this.deathCallbacks.push(cb);
    return () => { this.deathCallbacks = this.deathCallbacks.filter((c) => c !== cb); };
  }

  onHeal(cb: HealCallback): () => void {
    this.healCallbacks.push(cb);
    return () => { this.healCallbacks = this.healCallbacks.filter((c) => c !== cb); };
  }

  onShield(cb: ShieldCallback): () => void {
    this.shieldCallbacks.push(cb);
    return () => { this.shieldCallbacks = this.shieldCallbacks.filter((c) => c !== cb); };
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  getHp(entityId: string): number {
    return this.components.get(entityId)?.hp ?? 0;
  }

  getMaxHp(entityId: string): number {
    return this.components.get(entityId)?.maxHp ?? 0;
  }

  /** Health as 0..1 fraction. */
  getHpFraction(entityId: string): number {
    const comp = this.components.get(entityId);
    if (!comp || comp.maxHp === 0) return 0;
    return comp.hp / comp.maxHp;
  }

  getAllComponents(): IterableIterator<HealthComponent> {
    return this.components.values();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _triggerDeath(comp: HealthComponent, killedBy: string | undefined, type: DamageType): void {
    comp.hp     = 0;
    comp.isAlive = false;
    comp.isDead  = true;
    this._syncToState(comp.entityId);
    const evt: DeathEvent = { entityId: comp.entityId, killedBy, damageType: type };
    this.deathCallbacks.forEach((cb) => cb(evt));
  }

  private _syncToState(entityId: string): void {
    const comp = this.components.get(entityId);
    if (!comp) return;
    // Always emit the bus event so subscribers (e.g. DummyEnemySystem) receive it
    // even when no StateManager is wired (offline / horde mode).
    gameBus.emit('healthChanged', { entityId, hp: comp.hp, maxHp: comp.maxHp });
    if (!this.stateManager) return;
    const base = `health.${entityId}`;
    this.stateManager.set(`${base}.hp`,      comp.hp);
    this.stateManager.set(`${base}.maxHp`,   comp.maxHp);
    this.stateManager.set(`${base}.shield`,  comp.shield);
    this.stateManager.set(`${base}.maxShield`, comp.maxShield);
    this.stateManager.set(`${base}.armor`,   comp.armor);
    this.stateManager.set(`${base}.isAlive`, comp.isAlive);
  }
}
