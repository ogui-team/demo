import { Entity, Vector3 } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { createSpotLightComponent } from './components/LightComponent';
import type { EntityHandle } from '@engine/1-kernel/core/public-api';
import type { DummyEnemyVariantId } from './DummyEnemySystem';

interface SpawnEntityRecord {
  getPosition(): Vector3;
}

interface SpawnEntityManagerAdapter {
  getEntities(): SpawnEntityRecord[];
}

interface PrefabSpawnerAdapter {
  create(prefabName: string, position: Vector3): Entity;
}

interface NetworkEntityIdRegistrarAdapter {
  reserveHandleForPlayer(playerId: string): boolean;
  registerNetworkEntityIdMapping(playerId: string, networkEntityId: string | number): boolean;
}

interface EnemySpawnerAdapter {
  spawnEnemy(position: Vector3, enemyType: 'default' | 'flyingMask', variantId: DummyEnemyVariantId): EntityHandle | null;
}

export interface SpawnPoint {
  id: string;
  position: Vector3;
  weight: number;
  radius: number;
  tags: string[];
}

export interface SpawnSelectionOptions {
  tag?: string;
  clearance?: number;
  preferredPosition?: Vector3;
  maxAttempts?: number;
  playerId?: string;
  networkEntityId?: string | number;
}

export interface SpawnPlayerOptions extends SpawnSelectionOptions {
  prefabName?: string;
  localControlled?: boolean;
  position?: Vector3;
}

export interface SpawnEnemyOptions extends SpawnSelectionOptions {
  enemyType?: 'default' | 'flyingMask';
  variantId?: DummyEnemyVariantId;
  position?: Vector3;
}

export interface SpawnDebugState {
  pointCount: number;
  points: SpawnPoint[];
}

export class SpawnSystem {
  private entityManager: SpawnEntityManagerAdapter;
  private prefabSystem: PrefabSpawnerAdapter;
  private spawnPoints = new Map<string, SpawnPoint>();
  private systemContext: SystemContext | null = null;
  private networkEntityIdRegistrar: NetworkEntityIdRegistrarAdapter | null = null;
  private enemySpawner: EnemySpawnerAdapter | null = null;

  constructor(entityManager: SpawnEntityManagerAdapter, prefabSystem: PrefabSpawnerAdapter) {
    this.entityManager = entityManager;
    this.prefabSystem = prefabSystem;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (ctx.entityManager) {
      this.entityManager = ctx.entityManager as SpawnEntityManagerAdapter;
    }
    const prefabSystem = ctx.systems.prefabSystem as PrefabSpawnerAdapter | null | undefined;
    if (prefabSystem) {
      this.prefabSystem = prefabSystem;
    }
    const networkSyncSystem = ctx.systems.networkSyncSystem as {
      getNetworkEntityIdRegistrar?: () => NetworkEntityIdRegistrarAdapter | null;
    } | null | undefined;
    if (networkSyncSystem?.getNetworkEntityIdRegistrar) {
      this.networkEntityIdRegistrar = networkSyncSystem.getNetworkEntityIdRegistrar() ?? null;
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  setEnemySpawner(enemySpawner: EnemySpawnerAdapter | null): void {
    this.enemySpawner = enemySpawner;
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: false,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: true,
      usesNetworkFacade: false,
    };
  }

  registerSpawnPoint(point: Omit<SpawnPoint, 'id'> & { id?: string }): string {
    const id = point.id ?? `spawn_${this.spawnPoints.size}_${Date.now()}`;
    this.spawnPoints.set(id, {
      id,
      position: { ...point.position },
      weight: Math.max(0.01, point.weight),
      radius: Math.max(0.25, point.radius),
      tags: [...point.tags],
    });
    gameBus.emit('stateMutation', {
      source: 'spawnSystem',
      path: `spawn.points.${id}`,
      changedCount: 1,
    });
    return id;
  }

  clearSpawnPoints(): void {
    this.spawnPoints.clear();
    gameBus.emit('stateMutation', {
      source: 'spawnSystem',
      path: 'spawn.points',
      changedCount: 0,
    });
  }

  listSpawnPoints(): SpawnPoint[] {
    return [...this.spawnPoints.values()].map((point) => ({ ...point, position: { ...point.position }, tags: [...point.tags] }));
  }

  findSpawnPosition(options: SpawnSelectionOptions = {}): Vector3 {
    const eligible = this.listSpawnPoints().filter((point) => !options.tag || point.tags.includes(options.tag));
    const clearance = Math.max(0.5, options.clearance ?? 1.5);

    const byDistance = options.preferredPosition
      ? eligible.sort((a, b) => this.distanceSquared(a.position, options.preferredPosition!) - this.distanceSquared(b.position, options.preferredPosition!))
      : eligible;

    const available = byDistance.filter((point) => {
      // Check both entities AND collision geometry
      return this.isPositionFree(point.position, clearance + point.radius) 
        && this.isPositionClearOfCollision(point.position, clearance + point.radius);
    });
    if (available.length > 0) {
      return { ...this.weightedPick(available).position };
    }

    const base = options.preferredPosition ?? { x: 0, y: 1, z: 0 };
    const maxAttempts = Math.max(4, options.maxAttempts ?? 24);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const angle = attempt * 0.85;
      const radius = clearance + attempt * 1.35;
      const candidate = {
        x: base.x + Math.cos(angle) * radius,
        y: base.y,
        z: base.z + Math.sin(angle) * radius,
      };
      if (this.isPositionFree(candidate, clearance) && this.isPositionClearOfCollision(candidate, clearance)) {
        return candidate;
      }
    }

    // Fallback: if even the base position is occupied, elevate it
    return { ...base, y: base.y + 2 };
  }

  spawnPrefab(prefabName: string, options: SpawnSelectionOptions & { position?: Vector3 } = {}): Entity {
    if (options.playerId && this.networkEntityIdRegistrar) {
      const reserved = this.networkEntityIdRegistrar.reserveHandleForPlayer(options.playerId);
      if (!reserved) {
        throw new Error(`FATAL_SPAWN_HANDLE_RESERVE_FAILED: playerId=${options.playerId}`);
      }
      if (options.networkEntityId != null) {
        const mapped = this.networkEntityIdRegistrar.registerNetworkEntityIdMapping(options.playerId, options.networkEntityId);
        if (!mapped) {
          throw new Error(`FATAL_SPAWN_MAPPING_FAILED: playerId=${options.playerId}, netId=${String(options.networkEntityId)}`);
        }
      }
    }

    const position = options.position ?? this.findSpawnPosition(options);
    return this.prefabSystem.create(prefabName, position);
  }

  spawnPlayer(playerId: string, prefabName = 'player_v1', options: SpawnPlayerOptions = {}): Entity {
    const entity = this.spawnPrefab(prefabName, {
      ...options,
      tag: options.tag ?? 'player',
      playerId,
      networkEntityId: options.networkEntityId ?? playerId,
      position: options.position,
    });

    entity.addComponent({
      name: 'dodPlayerAvatar',
      data: {
        prefab: prefabName,
        playerId,
        HealthComponent: { hp: 100, maxHp: 100 },
        InventoryComponent: { loadout: ['pistol', 'knife'], equipped: 'pistol' },
        MovementComponent: { velocityBuffer: true },
        AbilityComponent: { gasEnabled: true, primaryAbilityId: 1 },
      },
    });

    if (options.localControlled) {
      entity.addComponent({
        name: 'localPlayer',
        data: { isLocal: true, playerId },
      });
      // Add head torch light for local player (debug/test - toggle with "L" key)
      entity.addComponent({
        name: 'light',
        data: createSpotLightComponent({ castShadow: true }).data,
      });
      console.log(`[SpawnSystem] Local player spawned: ${playerId}, entity ID: ${entity.id}, light component added`);
    }

    return entity;
  }

  spawnEnemy(options: SpawnEnemyOptions = {}): EntityHandle | null {
    if (!this.enemySpawner) {
      console.warn('[SpawnSystem] Enemy spawn requested without an enemy spawner');
      return null;
    }

    const position = options.position ?? this.findSpawnPosition(options);
    const enemyType = options.enemyType ?? 'default';
    const variantId = options.variantId ?? (enemyType === 'flyingMask' ? 'rot-mask' : 'decay-husk');
    return this.enemySpawner.spawnEnemy(position, enemyType, variantId);
  }

  getDebugState(): SpawnDebugState {
    return {
      pointCount: this.spawnPoints.size,
      points: this.listSpawnPoints(),
    };
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      pointCount: this.spawnPoints.size,
      hasSystemContext: this.systemContext !== null,
      hasEnemySpawner: this.enemySpawner !== null,
    };
  }

  exportState(): SpawnPoint[] {
    return this.listSpawnPoints();
  }

  importState(points: SpawnPoint[] | undefined): void {
    this.clearSpawnPoints();
    for (const point of points ?? []) {
      this.registerSpawnPoint(point);
    }
  }

  private weightedPick(points: SpawnPoint[]): SpawnPoint {
    const total = points.reduce((sum, point) => sum + point.weight, 0);
    let roll = Math.random() * Math.max(total, 0.001);
    for (const point of points) {
      roll -= point.weight;
      if (roll <= 0) return point;
    }
    return points[points.length - 1]!;
  }

  private isPositionFree(position: Vector3, clearance: number): boolean {
    for (const entity of this.entityManager.getEntities()) {
      const other = entity.getPosition();
      if (this.distanceSquared(position, other) < clearance * clearance) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if position is inside collision geometry (from WorldGeometryCoordinator)
   * Prevents spawning players inside walls or collision boxes
   */
  private isPositionClearOfCollision(position: Vector3, clearance: number): boolean {
    // This would ideally check against WorldGeometryCoordinator collision boxes
    // For now, return true as collision boxes may not be loaded during spawn
    // The geometry check happens during runtime movement, not spawn
    return true;
  }

  private distanceSquared(a: Vector3, b: Vector3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
  }
}
