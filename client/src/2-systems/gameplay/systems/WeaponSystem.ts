import { Entity, Vector3 } from '@engine/1-kernel/core/public-api';
import { ObjectPool, type IPoolable } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import type { GameplayCommandTransport } from '../../../3-network/network/MultiplayerContracts';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { WEAPON_PRESETS, type FireMode, type WeaponDefinition } from './WeaponContracts';

type DamageType = 'bullet' | 'explosion' | 'melee' | 'fire' | 'poison' | 'fall' | 'generic';

interface PhysicsBodyAdapter {
  position: Vector3;
  velocity?: Vector3;
  gravityScale?: number;
}

interface PhysicsSystemAdapter {
  getBody(id: string): PhysicsBodyAdapter | undefined;
  overlapSphere(position: Vector3, radius: number, layers: string[]): string[];
  raycastFirst(origin: Vector3, direction: Vector3, options: { maxDistance: number; layerMask?: string[]; ignore?: string[] }): { entityId: string; point: Vector3 } | null;
  addBody(id: string, config: { shape: 'aabb' | 'sphere'; halfExtents?: Vector3; radius?: number; layer?: string; isStatic?: boolean; isTrigger?: boolean; isSensor?: boolean }): void;
  removeBody(id: string): void;
}

interface HealthSystemAdapter {
  applyDamage(targetId: string, opts: { amount: number; type?: DamageType; sourceId?: string }): number;
}

interface EntityWithRenderAdapter {
  id: string;
  addComponent(component: { name: string; data: unknown }): void;
}

interface EntityManagerAdapter {
  createEntity(entityType: string, config: { position: Vector3; rotation: Vector3 }): EntityWithRenderAdapter;
  getEntity(entityId: string): { setPosition(position: Vector3): void } | undefined;
  destroyEntity(entity: string | { id: string }): void;
}

interface PrefabSpawnerAdapter {
  create(prefabName: string, position: Vector3): { id: string };
}

interface WeaponStateStoreAdapter {
  set(path: string, value: unknown): void;
}

export type PlayerRef = string | Entity | { id: string };

export interface WeaponFireContext {
  origin: Vector3;
  direction: Vector3;
  layerMask?: string[];
}

export interface WeaponInventoryState {
  weaponId: string;
  currentAmmo: number;
  reserveAmmo: number;
  fireCooldown: number;
  isReloading: boolean;
  reloadTimer: number;
  burstRemaining: number;
  burstTimer: number;
  equippedAt: number;
}

interface PlayerWeaponState {
  equippedWeaponId: string | null;
  weapons: Map<string, WeaponInventoryState>;
}

interface ActiveProjectile extends IPoolable {
  id: string;
  ownerId: string;
  weaponId: string;
  position: Vector3;
  direction: Vector3;
  speed: number;
  damage: number;
  damageType: DamageType;
  splashRadius: number;
  splashDamage: number;
  lifetime: number;
  age: number;
  visualEntityId: string | null;
}

export interface FireEvent {
  shooterId: string;
  weaponId: string;
  origin: Vector3;
  direction: Vector3;
}

export interface HitEvent {
  shooterId: string;
  weaponId: string;
  targetId: string;
  point: Vector3;
  damage: number;
}

export interface MissEvent {
  shooterId: string;
  weaponId: string;
  origin: Vector3;
  direction: Vector3;
}

export interface ReloadEvent {
  playerId: string;
  weaponId: string;
}

export interface EquipEvent {
  playerId: string;
  weaponId: string;
}

export interface AmmoChangeEvent {
  entityId: string;
  weaponId: string;
  current: number;
  reserve: number;
}

export interface WeaponDiagnostics {
  timestamp: number;
  registeredWeapons: number;
  trackedPlayers: number;
  equippedPlayers: number;
  reloadingWeapons: number;
  coolingWeapons: number;
  burstingWeapons: number;
  activeProjectiles: number;
  players: Array<{
    playerId: string;
    equippedWeaponId: string | null;
    weaponCount: number;
    reloading: boolean;
    coolingDown: boolean;
    bursting: boolean;
  }>;
}

export type FireCallback = (event: FireEvent) => void;
export type HitCallback = (event: HitEvent) => void;
export type MissCallback = (event: MissEvent) => void;
export type ReloadCallback = (event: ReloadEvent) => void;
export type EquipCallback = (event: EquipEvent) => void;
export type AmmoChangeCallback = (event: AmmoChangeEvent) => void;
export type AnimationEventSink = (playerId: string, weaponId: string, clip: string) => void;
export type HitscanResolver = (playerId: string, weaponId: string, origin: Vector3, direction: Vector3, range: number, layerMask?: string[]) => {
  entityId: string;
  point: Vector3;
} | null;
export type FireContextResolver = (playerId: string, weaponId: string) => WeaponFireContext | null;

interface FireExecutionOptions {
  consumeAmmo: boolean;
  setCooldown: boolean;
  queueBurst: boolean;
  emitNetwork: boolean;
}

function toPlayerId(player: PlayerRef): string {
  if (typeof player === 'string') return player;
  if (player instanceof Entity) return player.id;
  return player.id;
}

function v3len(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function v3scale(v: Vector3, scalar: number): Vector3 {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

function v3norm(v: Vector3): Vector3 {
  const length = v3len(v);
  if (length === 0) return { x: 0, y: 0, z: -1 };
  return v3scale(v, 1 / length);
}

function v3dist(a: Vector3, b: Vector3): number {
  return v3len({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
}

function assignVector(target: Vector3, source: Vector3): void {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
}

function createPooledProjectile(): ActiveProjectile {
  return {
    isActive: false,
    id: '',
    ownerId: '',
    weaponId: '',
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
    speed: 0,
    damage: 0,
    damageType: 'bullet',
    splashRadius: 0,
    splashDamage: 0,
    lifetime: 0,
    age: 0,
    visualEntityId: null,
    reset() {
      this.id = '';
      this.ownerId = '';
      this.weaponId = '';
      this.position.x = 0;
      this.position.y = 0;
      this.position.z = 0;
      this.direction.x = 0;
      this.direction.y = 0;
      this.direction.z = -1;
      this.speed = 0;
      this.damage = 0;
      this.damageType = 'bullet';
      this.splashRadius = 0;
      this.splashDamage = 0;
      this.lifetime = 0;
      this.age = 0;
      this.visualEntityId = null;
      this.isActive = false;
    },
  };
}

function applySpread(direction: Vector3, spread: number): Vector3 {
  if (spread <= 0) return { ...direction };
  const arbitrary = Math.abs(direction.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const right = v3norm({
    x: direction.y * arbitrary.z - direction.z * arbitrary.y,
    y: direction.z * arbitrary.x - direction.x * arbitrary.z,
    z: direction.x * arbitrary.y - direction.y * arbitrary.x,
  });
  const up = v3norm({
    x: direction.y * right.z - direction.z * right.y,
    y: direction.z * right.x - direction.x * right.z,
    z: direction.x * right.y - direction.y * right.x,
  });
  const angle = Engine.random.next() * Math.PI * 2;
  const magnitude = Engine.random.next() * Math.tan(spread);
  return v3norm({
    x: direction.x + (right.x * Math.cos(angle) + up.x * Math.sin(angle)) * magnitude,
    y: direction.y + (right.y * Math.cos(angle) + up.y * Math.sin(angle)) * magnitude,
    z: direction.z + (right.z * Math.cos(angle) + up.z * Math.sin(angle)) * magnitude,
  });
}

export class WeaponSystem {
  private readonly definitions = new Map<string, WeaponDefinition>();
  private readonly playerStates = new Map<string, PlayerWeaponState>();
  private readonly projectiles = new Map<string, ActiveProjectile>();
  private readonly projectilePool = new ObjectPool<ActiveProjectile>(() => createPooledProjectile());
  private readonly expiredProjectileIds: string[] = [];
  private physics: PhysicsSystemAdapter;
  private health: HealthSystemAdapter;
  private readonly stateManager: WeaponStateStoreAdapter | null;
  private entityManager: EntityManagerAdapter | null;
  private prefabSystem: PrefabSpawnerAdapter | null;
  private readonly enableLogging: boolean;
  private multiplayer: GameplayCommandTransport | null = null;
  private systemContext: SystemContext | null = null;
  private hitscanResolver: HitscanResolver | null = null;
  private fireContextResolver: FireContextResolver | null = null;
  private animationSink: AnimationEventSink | null = null;
  private fireCallbacks: FireCallback[] = [];
  private hitCallbacks: HitCallback[] = [];
  private missCallbacks: MissCallback[] = [];
  private reloadCallbacks: ReloadCallback[] = [];
  private equipCallbacks: EquipCallback[] = [];
  private ammoCallbacks: AmmoChangeCallback[] = [];
  private projectileCounter = 0;
  private shotCounter = 0;
  // ─ DEATH-SPIRAL-RESILIENCE: Throttle weapon_equip commands to prevent spam
  private lastEquipNetworkSync = new Map<string, { weaponId: string; timestamp: number }>();
  private lastReloadNetworkSync = new Map<string, { weaponId: string; timestamp: number }>();

  constructor(
    physics: PhysicsSystemAdapter,
    health: HealthSystemAdapter,
    stateManager?: WeaponStateStoreAdapter,
    deps: {
      entityManager?: EntityManagerAdapter;
      prefabSystem?: PrefabSpawnerAdapter;
      multiplayer?: GameplayCommandTransport;
      hitscanResolver?: HitscanResolver;
      fireContextResolver?: FireContextResolver;
      animationSink?: AnimationEventSink;
      enableLogging?: boolean;
    } = {},
  ) {
    this.physics = physics;
    this.health = health;
    this.stateManager = stateManager ?? null;
    this.entityManager = deps.entityManager ?? null;
    this.prefabSystem = deps.prefabSystem ?? null;
    this.multiplayer = deps.multiplayer ?? null;
    this.hitscanResolver = deps.hitscanResolver ?? null;
    this.fireContextResolver = deps.fireContextResolver ?? null;
    this.animationSink = deps.animationSink ?? null;
    this.enableLogging = deps.enableLogging ?? false;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    this.multiplayer = this.multiplayer ?? (ctx.network.getClient() as GameplayCommandTransport | null);
    this.physics = (ctx.systems.physicsSystem as PhysicsSystemAdapter | undefined) ?? this.physics;
    this.health = (ctx.systems.healthSystem as HealthSystemAdapter | undefined) ?? this.health;
    this.entityManager = (ctx.entityManager as EntityManagerAdapter | null) ?? this.entityManager;
    this.prefabSystem = (ctx.systems.prefabSystem as PrefabSpawnerAdapter | undefined) ?? this.prefabSystem;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  registerWeapon(id: string, definition: WeaponDefinition): void {
    this.definitions.set(id, {
      ...definition,
      type: definition.type ?? (definition.fireMode === 'projectile' ? 'projectile' : 'hitscan'),
    });
  }

  registerPresets(): void {
    Object.entries(WEAPON_PRESETS).forEach(([id, definition]) => this.registerWeapon(id, definition));
  }

  /**
   * Register a map of additional weapon definitions on top of (or overriding)
   * the built-in presets.  Call this with `ProjectConfig.weapons` during boot.
   *
   * @example
   * weaponSystem.registerDefinitions(config.weapons ?? {});
   */
  registerDefinitions(defs: Record<string, WeaponDefinition>): void {
    Object.entries(defs).forEach(([id, def]) => this.registerWeapon(id, def));
  }

  listWeapons(): string[] {
    return [...this.definitions.keys()].sort();
  }

  logWeapons(): string {
    const summary = this.listWeapons().map((weaponId) => {
      const definition = this.definitions.get(weaponId)!;
      return `${weaponId} -> ${definition.fireMode} dmg:${definition.damage} mag:${definition.magazineSize ?? -1}`;
    }).join('\n');
    if (summary) console.log(summary);
    return summary;
  }

  getDefinition(id: string): WeaponDefinition | undefined {
    return this.definitions.get(id);
  }

  attachMultiplayer(multiplayer: GameplayCommandTransport | null): void {
    this.multiplayer = multiplayer;
  }

  setHitscanResolver(resolver: HitscanResolver | null): void {
    this.hitscanResolver = resolver;
  }

  setFireContextResolver(resolver: FireContextResolver | null): void {
    this.fireContextResolver = resolver;
  }

  setAnimationSink(sink: AnimationEventSink | null): void {
    this.animationSink = sink;
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
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
        ...this.getDiagnostics(),
        hasSystemContext: this.systemContext !== null,
        usingNetworkFacade: this.systemContext !== null,
        legacyMultiplayerAttached: this.multiplayer !== null,
        trackedPlayerIds: [...this.playerStates.keys()].slice(0, 12),
        projectileIds: [...this.projectiles.keys()].slice(0, 12),
      },
    };
  }

  getDiagnostics(): WeaponDiagnostics {
    const players = [...this.playerStates.entries()].map(([playerId, playerState]) => {
      const weaponStates = [...playerState.weapons.values()];
      return {
        playerId,
        equippedWeaponId: playerState.equippedWeaponId,
        weaponCount: weaponStates.length,
        reloading: weaponStates.some((entry) => entry.isReloading),
        coolingDown: weaponStates.some((entry) => entry.fireCooldown > 0),
        bursting: weaponStates.some((entry) => entry.burstRemaining > 0),
      };
    });

    return {
      timestamp: Engine.time.now(),
      registeredWeapons: this.definitions.size,
      trackedPlayers: this.playerStates.size,
      equippedPlayers: players.filter((entry) => entry.equippedWeaponId).length,
      reloadingWeapons: players.filter((entry) => entry.reloading).length,
      coolingWeapons: players.filter((entry) => entry.coolingDown).length,
      burstingWeapons: players.filter((entry) => entry.bursting).length,
      activeProjectiles: this.projectiles.size,
      players,
    };
  }

  ensurePlayer(player: PlayerRef): void {
    this.ensurePlayerState(toPlayerId(player));
  }

  giveWeapon(player: PlayerRef, weaponId: string, reserveAmmo = -1): boolean {
    const playerId = toPlayerId(player);
    const definition = this.definitions.get(weaponId);
    if (!definition) return false;

    const playerState = this.ensurePlayerState(playerId);
    if (playerState.weapons.has(weaponId)) return true;

    playerState.weapons.set(weaponId, this.createWeaponState(weaponId, definition, reserveAmmo));

    if (!playerState.equippedWeaponId) {
      this.equip(playerId, weaponId);
    } else {
      this.syncWeaponState(playerId);
    }

    return true;
  }

  pickupWeapon(player: PlayerRef, weaponId: string, reserveAmmo = -1, autoEquip = true): boolean {
    const added = this.giveWeapon(player, weaponId, reserveAmmo);
    if (added && autoEquip) {
      this.equip(player, weaponId);
    }
    return added;
  }

  removeWeapon(player: PlayerRef, weaponId: string): void {
    const playerId = toPlayerId(player);
    const playerState = this.playerStates.get(playerId);
    if (!playerState) return;
    playerState.weapons.delete(weaponId);
    if (playerState.equippedWeaponId === weaponId) {
      playerState.equippedWeaponId = [...playerState.weapons.keys()][0] ?? null;
    }
    this.syncWeaponState(playerId);
  }

  equip(player: PlayerRef, weaponId: string): boolean {
    return this.setEquippedWeapon(toPlayerId(player), weaponId, true, true);
  }

  equipWeapon(player: PlayerRef, weaponId: string): boolean {
    return this.equip(player, weaponId);
  }

  getEquipped(player: PlayerRef): string | undefined {
    return this.playerStates.get(toPlayerId(player))?.equippedWeaponId ?? undefined;
  }

  getInventoryEntry(player: PlayerRef, weaponId: string): WeaponInventoryState | undefined {
    return this.playerStates.get(toPlayerId(player))?.weapons.get(weaponId);
  }

  getWeaponStates(player: PlayerRef): WeaponInventoryState[] {
    return [...(this.playerStates.get(toPlayerId(player))?.weapons.values() ?? [])].map((entry) => ({ ...entry }));
  }

  addAmmo(player: PlayerRef, weaponId: string, amount: number): boolean {
    const entry = this.getInventoryEntry(player, weaponId);
    const definition = this.definitions.get(weaponId);
    if (!entry || !definition) return false;
    if (entry.reserveAmmo < 0) return true;
    const cap = definition.reserveAmmoCap ?? Number.MAX_SAFE_INTEGER;
    entry.reserveAmmo = Math.min(cap, entry.reserveAmmo + Math.max(0, amount));
    this.syncAmmoState(toPlayerId(player), weaponId, entry);
    return true;
  }

  applyRemoteEquip(playerId: string, weaponId: string): boolean {
    return this.setEquippedWeapon(playerId, weaponId, false, false);
  }

  applyRemoteReload(playerId: string, weaponId: string): boolean {
    this.ensureWeaponEntry(playerId, weaponId);
    return this.beginReload(playerId, weaponId, false, false);
  }

  syncAuthoritativeAmmoState(
    playerId: string,
    weaponId: string,
    snapshot: {
      currentAmmo?: number;
      reserveAmmo?: number;
      isReloading?: boolean;
    },
  ): boolean {
    const weaponState = this.ensureWeaponEntry(playerId, weaponId);
    if (!weaponState) return false;
    if (!this.playerStates.get(playerId)?.equippedWeaponId) {
      this.setEquippedWeapon(playerId, weaponId, false, false);
    }

    if (typeof snapshot.currentAmmo === 'number') {
      weaponState.currentAmmo = snapshot.currentAmmo;
    }
    if (typeof snapshot.reserveAmmo === 'number') {
      weaponState.reserveAmmo = snapshot.reserveAmmo;
    }
    if (typeof snapshot.isReloading === 'boolean') {
      weaponState.isReloading = snapshot.isReloading;
      weaponState.reloadTimer = snapshot.isReloading
        ? Math.max(weaponState.reloadTimer, this.definitions.get(weaponId)?.reloadTime ?? 0)
        : 0;
    }

    this.syncAmmoState(playerId, weaponId, weaponState);
    
    // BRIDGE: Emit ammo state to gameBus so InventorySystem can access it across domains
    gameBus.emit('ammoStateSyncBridge', {
      playerId,
      weaponId,
      currentAmmo: weaponState.currentAmmo,
      reserveAmmo: weaponState.reserveAmmo,
      isReloading: weaponState.isReloading,
    });
    
    return true;
  }

  recordRemoteShot(playerId: string, weaponId: string, origin: Vector3, direction: Vector3): boolean {
    const definition = this.definitions.get(weaponId);
    const weaponState = this.ensureWeaponEntry(playerId, weaponId);
    if (!definition || !weaponState) return false;

    this.setEquippedWeapon(playerId, weaponId, false, false);
    weaponState.fireCooldown = Math.max(weaponState.fireCooldown, 1 / Math.max(0.01, definition.fireRate));

    const normalizedDirection = v3norm(direction);
    this.fireCallbacks.forEach((callback) => callback({
      shooterId: playerId,
      weaponId,
      origin,
      direction: normalizedDirection,
    }));
    gameBus.emit('weaponFired', { entityId: playerId, weaponId });
    this.emitAnimation(playerId, weaponId, definition.animation?.fireClip);
    return true;
  }

  fire(player: PlayerRef, origin?: Vector3, direction?: Vector3, layerMask?: string[]): boolean {
    const playerId = toPlayerId(player);
    const playerState = this.ensurePlayerState(playerId);
    const weaponId = playerState.equippedWeaponId;
    if (!weaponId) return false;

    const definition = this.definitions.get(weaponId);
    const weaponState = playerState.weapons.get(weaponId);
    if (!definition || !weaponState) return false;

    const context = origin && direction
      ? { origin, direction, layerMask }
      : this.fireContextResolver?.(playerId, weaponId) ?? null;
    if (!context) return false;

    if (weaponState.isReloading || weaponState.fireCooldown > 0) return false;
    if (weaponState.currentAmmo === 0) {
      if (definition.autoReload) this.reload(playerId);
      return false;
    }

    return this.executeShot(playerId, weaponId, definition, weaponState, context.origin, context.direction, context.layerMask, {
      consumeAmmo: true,
      setCooldown: true,
      queueBurst: true,
      emitNetwork: true,
    });
  }

  reload(player: PlayerRef): boolean {
    const playerId = toPlayerId(player);
    const weaponId = this.getEquipped(playerId);
    if (!weaponId) return false;
    return this.beginReload(playerId, weaponId, true, true);
  }

  cancelReload(player: PlayerRef): void {
    const playerId = toPlayerId(player);
    const weaponId = this.getEquipped(playerId);
    const weaponState = weaponId ? this.playerStates.get(playerId)?.weapons.get(weaponId) : null;
    if (!weaponId || !weaponState) return;
    weaponState.isReloading = false;
    weaponState.reloadTimer = 0;
    this.syncWeaponState(playerId);
  }

  resetPlayerState(player: PlayerRef, position?: Vector3): void {
    const playerId = toPlayerId(player);
    const playerState = this.playerStates.get(playerId);
    if (!playerState) return;
    for (const [weaponId, weaponState] of playerState.weapons) {
      const definition = this.definitions.get(weaponId);
      weaponState.isReloading = false;
      weaponState.reloadTimer = 0;
      weaponState.fireCooldown = 0;
      weaponState.burstRemaining = 0;
      weaponState.burstTimer = 0;
      if (definition?.magazineSize && definition.magazineSize > -1 && weaponState.currentAmmo <= 0) {
        weaponState.currentAmmo = Math.max(1, Math.min(definition.magazineSize, definition.magazineSize));
      }
      this.syncAmmoState(playerId, weaponId, weaponState);
    }
    if (position) {
      this.stateManager?.set(`weapons.${playerId}.lastRespawnPosition`, position);
    }
  }

  update(deltaTime: number, entityPositions?: Map<string, Vector3>): void {
    const dt = Math.min(deltaTime, 0.1);

    for (const [playerId, playerState] of this.playerStates) {
      for (const [weaponId, weaponState] of playerState.weapons) {
        const definition = this.definitions.get(weaponId);
        if (!definition) continue;

        if (weaponState.fireCooldown > 0) {
          weaponState.fireCooldown = Math.max(0, weaponState.fireCooldown - dt);
        }

        if (weaponState.burstRemaining > 0) {
          weaponState.burstTimer = Math.max(0, weaponState.burstTimer - dt);
          if (weaponState.burstTimer === 0) {
            const fireContext = this.fireContextResolver?.(playerId, weaponId);
            if (fireContext) {
              weaponState.burstRemaining -= 1;
              const fired = this.executeShot(
                playerId,
                weaponId,
                definition,
                weaponState,
                fireContext.origin,
                fireContext.direction,
                fireContext.layerMask,
                {
                  consumeAmmo: true,
                  setCooldown: false,
                  queueBurst: false,
                  emitNetwork: false,
                },
              );
              if (fired && weaponState.burstRemaining > 0) {
                weaponState.burstTimer = definition.burstInterval ?? 0.08;
              } else {
                weaponState.burstRemaining = 0;
                weaponState.burstTimer = 0;
              }
            } else {
              weaponState.burstRemaining = 0;
              weaponState.burstTimer = 0;
            }
          }
        }

        if (weaponState.isReloading) {
          weaponState.reloadTimer = Math.max(0, weaponState.reloadTimer - dt);
          if (weaponState.reloadTimer === 0) {
            weaponState.isReloading = false;
            const magazineSize = definition.magazineSize ?? -1;
            if (magazineSize === -1) {
              weaponState.currentAmmo = -1;
            } else if (weaponState.reserveAmmo < 0) {
              weaponState.currentAmmo = magazineSize;
            } else {
              const needed = Math.max(0, magazineSize - weaponState.currentAmmo);
              const transferred = Math.min(needed, weaponState.reserveAmmo);
              weaponState.currentAmmo += transferred;
              weaponState.reserveAmmo -= transferred;
            }
            this.syncAmmoState(playerId, weaponId, weaponState);
          }
        }
      }
    }

    this.expiredProjectileIds.length = 0;
    for (const projectile of this.projectiles.values()) {
      projectile.age += dt;
      if (projectile.age >= projectile.lifetime) {
        this.expiredProjectileIds.push(projectile.id);
        continue;
      }

      projectile.position.x += projectile.direction.x * projectile.speed * dt;
      projectile.position.y += projectile.direction.y * projectile.speed * dt;
      projectile.position.z += projectile.direction.z * projectile.speed * dt;
      entityPositions?.set(projectile.id, {
        x: projectile.position.x,
        y: projectile.position.y,
        z: projectile.position.z,
      });

      const body = this.physics.getBody(projectile.id);
      if (body) {
        assignVector(body.position, projectile.position);
      }

      if (projectile.visualEntityId) {
        this.entityManager?.getEntity(projectile.visualEntityId)?.setPosition({
          x: projectile.position.x,
          y: projectile.position.y,
          z: projectile.position.z,
        });
      }

      const hits = this.physics.overlapSphere(projectile.position, projectile.splashRadius > 0 ? projectile.splashRadius : 0.3, ['enemy', 'player', 'environment']);
      for (const targetId of hits) {
        if (targetId === projectile.ownerId || targetId === projectile.id) continue;
        this.applyProjectileImpact(projectile, targetId);
        this.expiredProjectileIds.push(projectile.id);
        break;
      }
    }

    for (const projectileId of this.expiredProjectileIds) {
      this.destroyProjectile(projectileId);
    }
    this.expiredProjectileIds.length = 0;
  }

  onFire(callback: FireCallback): () => void {
    this.fireCallbacks.push(callback);
    return () => { this.fireCallbacks = this.fireCallbacks.filter((current) => current !== callback); };
  }

  onHit(callback: HitCallback): () => void {
    this.hitCallbacks.push(callback);
    return () => { this.hitCallbacks = this.hitCallbacks.filter((current) => current !== callback); };
  }

  onMiss(callback: MissCallback): () => void {
    this.missCallbacks.push(callback);
    return () => { this.missCallbacks = this.missCallbacks.filter((current) => current !== callback); };
  }

  onReload(callback: ReloadCallback): () => void {
    this.reloadCallbacks.push(callback);
    return () => { this.reloadCallbacks = this.reloadCallbacks.filter((current) => current !== callback); };
  }

  onEquip(callback: EquipCallback): () => void {
    this.equipCallbacks.push(callback);
    return () => { this.equipCallbacks = this.equipCallbacks.filter((current) => current !== callback); };
  }

  onAmmoChange(callback: AmmoChangeCallback): () => void {
    this.ammoCallbacks.push(callback);
    return () => { this.ammoCallbacks = this.ammoCallbacks.filter((current) => current !== callback); };
  }

  getCurrentAmmo(player: PlayerRef): number {
    const weaponId = this.getEquipped(player);
    if (!weaponId) return 0;
    return this.getInventoryEntry(player, weaponId)?.currentAmmo ?? 0;
  }

  getReserveAmmo(player: PlayerRef): number {
    const weaponId = this.getEquipped(player);
    if (!weaponId) return 0;
    return this.getInventoryEntry(player, weaponId)?.reserveAmmo ?? 0;
  }

  isReloading(player: PlayerRef): boolean {
    const weaponId = this.getEquipped(player);
    if (!weaponId) return false;
    return this.getInventoryEntry(player, weaponId)?.isReloading ?? false;
  }

  getActiveProjectileCount(): number {
    return this.projectiles.size;
  }

  exportState(): Record<string, { equippedWeaponId: string | null; weapons: WeaponInventoryState[] }> {
    const out: Record<string, { equippedWeaponId: string | null; weapons: WeaponInventoryState[] }> = {};
    for (const [playerId, playerState] of this.playerStates) {
      out[playerId] = {
        equippedWeaponId: playerState.equippedWeaponId,
        weapons: [...playerState.weapons.values()].map((weapon) => ({ ...weapon })),
      };
    }
    return out;
  }

  clearAll(): void {
    this.expiredProjectileIds.length = 0;
    for (const projectileId of this.projectiles.keys()) {
      this.expiredProjectileIds.push(projectileId);
    }
    for (const projectileId of this.expiredProjectileIds) {
      this.destroyProjectile(projectileId);
    }
    this.expiredProjectileIds.length = 0;
    this.playerStates.clear();
  }

  importState(snapshot: Record<string, { equippedWeaponId: string | null; weapons: WeaponInventoryState[] }> | undefined): void {
    this.playerStates.clear();
    for (const [playerId, state] of Object.entries(snapshot ?? {})) {
      const weapons = new Map<string, WeaponInventoryState>();
      for (const weaponState of state.weapons ?? []) {
        weapons.set(weaponState.weaponId, { ...weaponState });
      }
      this.playerStates.set(playerId, {
        equippedWeaponId: state.equippedWeaponId ?? null,
        weapons,
      });
      this.syncWeaponState(playerId);
    }
  }

  private ensurePlayerState(playerId: string): PlayerWeaponState {
    const existing = this.playerStates.get(playerId);
    if (existing) return existing;
    const created: PlayerWeaponState = { equippedWeaponId: null, weapons: new Map() };
    this.playerStates.set(playerId, created);
    return created;
  }

  private createWeaponState(weaponId: string, definition: WeaponDefinition, reserveAmmo: number): WeaponInventoryState {
    return {
      weaponId,
      currentAmmo: definition.magazineSize === -1 ? -1 : (definition.magazineSize ?? -1),
      reserveAmmo,
      fireCooldown: 0,
      isReloading: false,
      reloadTimer: 0,
      burstRemaining: 0,
      burstTimer: 0,
      equippedAt: Engine.time.now(),
    };
  }

  private ensureWeaponEntry(playerId: string, weaponId: string): WeaponInventoryState | null {
    const definition = this.definitions.get(weaponId);
    if (!definition) return null;

    const playerState = this.ensurePlayerState(playerId);
    const existing = playerState.weapons.get(weaponId);
    if (existing) return existing;

    const created = this.createWeaponState(weaponId, definition, definition.reserveAmmoCap ?? -1);
    playerState.weapons.set(weaponId, created);
    return created;
  }

  private setEquippedWeapon(playerId: string, weaponId: string, syncToNetwork: boolean, emitCallbacks: boolean): boolean {
    const playerState = this.ensurePlayerState(playerId);
    const weaponState = this.ensureWeaponEntry(playerId, weaponId);
    if (!weaponState) return false;

    playerState.equippedWeaponId = weaponId;
    weaponState.equippedAt = Engine.time.now();
    this.syncWeaponState(playerId);

    if (emitCallbacks) {
      this.emitAnimation(playerId, weaponId, this.definitions.get(weaponId)?.animation?.equipClip);
      this.equipCallbacks.forEach((callback) => callback({ playerId, weaponId }));
    }

    if (syncToNetwork) {
      // ─ DEATH-SPIRAL-RESILIENCE: Throttle weapon_equip to prevent spam
      this._sendEquipCommandWithThrottling(playerId, weaponId);
    }

    return true;
  }

  private _sendEquipCommandWithThrottling(playerId: string, weaponId: string): void {
    const lastSync = this.lastEquipNetworkSync.get(playerId);
    const now = Engine.time.now();
    
    // Only send if weapon changed or enough time has passed (50ms throttle)
    if (lastSync && lastSync.weaponId === weaponId && (now - lastSync.timestamp) < 50) {
      return; // Skip, same weapon and too recent
    }
    
    this.lastEquipNetworkSync.set(playerId, { weaponId, timestamp: now });
    this.sendGameplayCommand('weapon_equip', { weaponId });
  }

  private beginReload(playerId: string, weaponId: string, syncToNetwork: boolean, emitCallbacks: boolean): boolean {
    const definition = this.definitions.get(weaponId);
    const weaponState = this.playerStates.get(playerId)?.weapons.get(weaponId);
    if (!definition || !weaponState) return false;
    if (weaponState.isReloading || definition.magazineSize === -1) return false;
    if (weaponState.currentAmmo === definition.magazineSize) return false;
    if (weaponState.reserveAmmo === 0) return false;

    weaponState.isReloading = true;
    weaponState.reloadTimer = definition.reloadTime ?? 1.5;

    if (emitCallbacks) {
      this.emitAnimation(playerId, weaponId, definition.animation?.reloadClip);
      this.reloadCallbacks.forEach((callback) => callback({ playerId, weaponId }));
    }

    if (syncToNetwork) {
      // ─ DEATH-SPIRAL-RESILIENCE: Throttle weapon_reload to prevent spam
      this._sendReloadCommandWithThrottling(playerId, weaponId);
    }

    this.syncWeaponState(playerId);
    return true;
  }

  private _sendReloadCommandWithThrottling(playerId: string, weaponId: string): void {
    const lastSync = this.lastReloadNetworkSync.get(playerId);
    const now = Engine.time.now();
    
    // Only send if weapon changed or enough time has passed (50ms throttle)
    if (lastSync && lastSync.weaponId === weaponId && (now - lastSync.timestamp) < 50) {
      return; // Skip, same weapon and too recent
    }
    
    this.lastReloadNetworkSync.set(playerId, { weaponId, timestamp: now });
    this.sendGameplayCommand('weapon_reload', { weaponId });
  }

  private executeShot(
    playerId: string,
    weaponId: string,
    definition: WeaponDefinition,
    weaponState: WeaponInventoryState,
    origin: Vector3,
    direction: Vector3,
    layerMask: string[] | undefined,
    options: FireExecutionOptions,
  ): boolean {
    const ammoPerShot = Math.max(1, definition.ammoPerShot ?? 1);
    if (options.consumeAmmo && weaponState.currentAmmo > -1 && weaponState.currentAmmo < ammoPerShot) {
      if (definition.autoReload) this.beginReload(playerId, weaponId, true, true);
      return false;
    }

    const normalizedDirection = v3norm(direction);
    const pellets = Math.max(1, definition.pellets ?? 1);

    if (options.consumeAmmo && weaponState.currentAmmo > -1) {
      weaponState.currentAmmo = Math.max(0, weaponState.currentAmmo - ammoPerShot);
    }
    if (options.setCooldown) {
      weaponState.fireCooldown = 1 / Math.max(0.01, definition.fireRate);
    }

    this.fireCallbacks.forEach((callback) => callback({ shooterId: playerId, weaponId, origin, direction: normalizedDirection }));
    gameBus.emit('weaponFired', { entityId: playerId, weaponId });
    this.emitAnimation(playerId, weaponId, definition.animation?.fireClip);

    if (definition.fireMode === 'projectile') {
      for (let index = 0; index < pellets; index += 1) {
        this.spawnProjectile(playerId, weaponId, definition, origin, applySpread(normalizedDirection, definition.spread ?? 0));
      }
    } else {
      for (let index = 0; index < pellets; index += 1) {
        const hitDirection = applySpread(normalizedDirection, definition.spread ?? 0);
        this.fireHitscan(playerId, weaponId, definition, origin, hitDirection, layerMask);
      }
    }

    if (options.queueBurst && definition.fireMode === 'burst') {
      weaponState.burstRemaining = Math.max(0, (definition.burstCount ?? 3) - 1);
      weaponState.burstTimer = weaponState.burstRemaining > 0 ? (definition.burstInterval ?? 0.08) : 0;
    }

    this.syncAmmoState(playerId, weaponId, weaponState);

    if (options.consumeAmmo && weaponState.currentAmmo === 0 && definition.autoReload) {
      this.beginReload(playerId, weaponId, true, true);
    }

    if (options.emitNetwork) {
      this.sendGameplayCommand('player_shoot', {
        weapon: weaponId,
        origin,
        direction: normalizedDirection,
        shotId: `${playerId}_${weaponId}_${++this.shotCounter}`,
        timestamp: Engine.time.now(),
      });
    }

    return true;
  }

  private fireHitscan(
    playerId: string,
    weaponId: string,
    definition: WeaponDefinition,
    origin: Vector3,
    direction: Vector3,
    layerMask?: string[],
  ): void {
    const resolved = this.hitscanResolver
      ? this.hitscanResolver(playerId, weaponId, origin, direction, definition.range ?? 1000, layerMask)
      : this.physics.raycastFirst(origin, direction, {
          maxDistance: definition.range ?? 1000,
          layerMask: (layerMask as any) ?? ['enemy', 'player', 'environment'],
          ignore: [playerId],
        });

    if (resolved) {
      this.health.applyDamage(resolved.entityId, {
        amount: definition.damage,
        type: definition.damageType ?? 'bullet',
        sourceId: playerId,
      });
      this.hitCallbacks.forEach((callback) => callback({
        shooterId: playerId,
        weaponId,
        targetId: resolved.entityId,
        point: resolved.point,
        damage: definition.damage,
      }));
    } else {
      this.missCallbacks.forEach((callback) => callback({ shooterId: playerId, weaponId, origin, direction }));
    }
  }

  private spawnProjectile(playerId: string, weaponId: string, definition: WeaponDefinition, origin: Vector3, direction: Vector3): void {
    const projectileConfig = definition.projectile;
    if (!projectileConfig) return;

    const projectileId = `weapon_projectile_${++this.projectileCounter}`;
    let visualEntityId: string | null = null;

    if (this.prefabSystem && definition.projectilePrefab) {
      visualEntityId = this.prefabSystem.create(definition.projectilePrefab, origin).id;
    } else if (this.entityManager) {
      const projectileEntity = this.entityManager.createEntity('WeaponProjectile', {
        position: origin,
        rotation: { x: 0, y: 0, z: 0 },
      });
      projectileEntity.addComponent({
        name: 'render',
        data: {
          meshType: definition.projectileAssetKey ? 'custom' : 'sphere',
          color: this.resolveProjectileColor(weaponId, definition),
          geometry: definition.projectileAssetKey
            ? { assetKey: definition.projectileAssetKey }
            : { radius: Math.max(0.1, projectileConfig.radius), segments: 8 },
        },
      });
      visualEntityId = projectileEntity.id;
    }

    this.physics.addBody(projectileId, {
      shape: 'sphere',
      radius: projectileConfig.radius,
      layer: 'projectile',
      isStatic: false,
    });

    const body = this.physics.getBody(projectileId);
    if (body) {
      assignVector(body.position, origin);
      body.velocity = v3scale(direction, projectileConfig.speed);
      body.gravityScale = projectileConfig.gravityScale ?? 0;
    }

    const projectile = this.projectilePool.acquire();
    projectile.id = projectileId;
    projectile.ownerId = playerId;
    projectile.weaponId = weaponId;
    assignVector(projectile.position, origin);
    assignVector(projectile.direction, direction);
    projectile.speed = projectileConfig.speed;
    projectile.damage = definition.damage;
    projectile.damageType = definition.damageType ?? 'bullet';
    projectile.splashRadius = projectileConfig.splashRadius ?? 0;
    projectile.splashDamage = projectileConfig.splashDamage ?? definition.damage;
    projectile.lifetime = projectileConfig.lifetime;
    projectile.age = 0;
    projectile.visualEntityId = visualEntityId;

    this.projectiles.set(projectileId, projectile);
  }

  private resolveProjectileColor(weaponId: string, definition: WeaponDefinition): number {
    switch (weaponId) {
      case 'spiritSwarmStaff':
        return 0xb8f0cd;
      case 'debug_fireball':
        return 0xff7a33;
      case 'flareGun':
        return 0xff8e52;
      default:
        switch (definition.damageType) {
          case 'fire':
            return 0xff9a45;
          case 'poison':
            return 0x8be08f;
          default:
            return 0xffaa55;
        }
    }
  }

  private applyProjectileImpact(projectile: ActiveProjectile, targetId: string): void {
    if (projectile.splashRadius > 0) {
      const targets = this.physics.overlapSphere(projectile.position, projectile.splashRadius, ['enemy', 'player']);
      let feedbackTargetId: string | null = null;
      let feedbackDamage = 0;
      for (const splashTarget of targets) {
        if (splashTarget === projectile.ownerId) continue;
        const targetBody = this.physics.getBody(splashTarget);
        const distance = v3dist(projectile.position, targetBody?.position ?? projectile.position);
        const falloff = Math.max(0, 1 - distance / projectile.splashRadius);
        const damage = projectile.splashDamage * falloff;
        const appliedDamage = this.health.applyDamage(splashTarget, { amount: damage, type: projectile.damageType, sourceId: projectile.ownerId });
        if (appliedDamage > feedbackDamage) {
          feedbackTargetId = splashTarget;
          feedbackDamage = appliedDamage;
        }
      }

      this.hitCallbacks.forEach((callback) => callback({
        shooterId: projectile.ownerId,
        weaponId: projectile.weaponId,
        targetId: feedbackTargetId ?? targetId,
        point: { ...projectile.position },
        damage: feedbackDamage,
      }));

      if (feedbackTargetId) {
        gameBus.emit('ENTITY_HIT', {
          targetId: feedbackTargetId,
          sourceId: projectile.ownerId,
          amount: feedbackDamage,
          position: { ...projectile.position },
        });
      }

      return;
    }

    this.health.applyDamage(targetId, { amount: projectile.damage, type: projectile.damageType, sourceId: projectile.ownerId });
    this.hitCallbacks.forEach((callback) => callback({
      shooterId: projectile.ownerId,
      weaponId: projectile.weaponId,
      targetId,
      point: { ...projectile.position },
      damage: projectile.damage,
    }));
    gameBus.emit('ENTITY_HIT', {
      targetId,
      sourceId: projectile.ownerId,
      amount: projectile.damage,
      position: { ...projectile.position },
    });
  }

  private destroyProjectile(projectileId: string): void {
    const projectile = this.projectiles.get(projectileId);
    if (!projectile) return;
    if (projectile.visualEntityId) {
      this.entityManager?.destroyEntity(projectile.visualEntityId);
    }
    this.physics.removeBody(projectileId);
    this.projectiles.delete(projectileId);
    this.projectilePool.release(projectile);
  }

  private emitAnimation(playerId: string, weaponId: string, clip?: string): void {
    if (!clip || !this.animationSink) return;
    this.animationSink(playerId, weaponId, clip);
  }

  private sendGameplayCommand(type: string, payload: Record<string, unknown>): void {
    const network = this.systemContext?.network ?? null;
    if (network && (network.getClient() || network.getSync())) {
      network.sendCommand({ type, payload, timestamp: Engine.time.now() });
      return;
    }
    if (this.multiplayer?.connected) {
      this.multiplayer.sendGameplayCommand(type, payload);
    }
  }

  private syncAmmoState(playerId: string, weaponId: string, weaponState: WeaponInventoryState): void {
    if (this.stateManager) {
      const base = `weapons.${playerId}.${weaponId}`;
      this.stateManager.set(`${base}.currentAmmo`, weaponState.currentAmmo);
      this.stateManager.set(`${base}.reserveAmmo`, weaponState.reserveAmmo);
      this.stateManager.set(`${base}.isReloading`, weaponState.isReloading);
    }
    this.ammoCallbacks.forEach((callback) => callback({
      entityId: playerId,
      weaponId,
      current: weaponState.currentAmmo,
      reserve: weaponState.reserveAmmo,
    }));
    // Mirror on the global event bus for HUD / audio consumers.
    gameBus.emit('ammoChanged', {
      entityId: playerId,
      weaponId,
      current:  weaponState.currentAmmo,
      reserve:  weaponState.reserveAmmo,
      max:      this.definitions.get(weaponId)?.magazineSize ?? weaponState.currentAmmo,
      isReloading: weaponState.isReloading,
    });
  }

  private syncWeaponState(playerId: string): void {
    const playerState = this.playerStates.get(playerId);
    if (!playerState || !this.stateManager) return;
    this.stateManager.set(`weapons.${playerId}.equipped`, playerState.equippedWeaponId);
    this.stateManager.set(`weapons.${playerId}.inventory`, [...playerState.weapons.values()].map((entry) => ({ ...entry })));
    for (const [weaponId, weaponState] of playerState.weapons) {
      this.syncAmmoState(playerId, weaponId, weaponState);
    }
  }
}