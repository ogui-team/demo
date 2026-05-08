/**
 * Entity Manager
 * Central registry for all entities in the world
 * Manages lifecycle, updates, and serialization
 * 
 * Integrates with Transform System to route all position/rotation/scale
 * modifications through StateManager for consistency.
 * Integrates with SceneGraph for hierarchical entity relationships.
 */

import { Entity, EntityData, Transform } from './Entity';
import { ObjectPool } from './ObjectPool';
import { TransformSystem } from './Transform';
import { SceneGraph } from './SceneGraph';
import { gameBus } from './EventBus';

export interface EntityManagerConfig {
  enableLogging?: boolean;
  maxEntities?: number;
  transformSystem?: TransformSystem; // Optional transform system integration
  sceneGraph?: SceneGraph; // Optional scene graph integration
}

export interface EntityQueryOptions {
  type?: string;
  hasComponent?: string;
  active?: boolean;
}

export interface ActiveEntityDebugRecord {
  id: string;
  type: string;
  pooled: boolean;
  createdAt: number;
  createdStack: string | null;
  lastUsedTime: number;
  hasCollider: boolean;
  expectsPhysicsBody: boolean;
}

// ─── Player Initialization Contract ──────────────────────────────────────────

/**
 * Phases that must all complete before a player entity is considered "Active".
 * Marking all phases ready causes EntityManager to emit PLAYER_INIT_COMPLETE
 * on gameBus and resolve any awaiting Promises.
 *
 * Constraints:
 *  - No gameplay authority changes here; this is purely a readiness gate.
 *  - freeplay mode marks 'inventory', 'abilities', and 'avatar' immediately
 *    because there is no async server leg.
 *  - In multiplayer, each owning system marks its own phase exactly once.
 */
export type PlayerInitPhase = 'entity' | 'inventory' | 'abilities' | 'avatar';

const PLAYER_INIT_REQUIRED_PHASES: PlayerInitPhase[] = ['entity', 'inventory', 'abilities', 'avatar'];

interface PlayerReadinessRecord {
  phases: Set<PlayerInitPhase>;
  resolvers: Array<() => void>;
}

interface EntityDebugMetadata {
  type: string;
  pooled: boolean;
  createdAt: number;
  createdStack: string | null;
}

/**
 * EntityManager - Central hub for all entity management
 */
export class EntityManager {
  public readonly activeEntities: Map<string, Entity> = new Map();
  private readonly entityPools = new Map<string, ObjectPool<Entity>>();
  private readonly pooledEntityTypesById = new Map<string, string>();
  private readonly entityDebugMetadata = new Map<string, EntityDebugMetadata>();
  private entityIdCounter: number = 0;
  private createdCount = 0;
  private destroyedCount = 0;
  private config: Required<Omit<EntityManagerConfig, 'transformSystem' | 'sceneGraph'>> & {
    transformSystem?: TransformSystem;
    sceneGraph?: SceneGraph;
  };

  // Listeners for entity changes (for UI, multiplayer, etc.)
  private createListeners: Array<(entity: Entity) => void> = [];
  private destroyListeners: Array<(entity: Entity) => void> = [];
  private updateListeners: Array<(entity: Entity) => void> = [];

  // Player Initialization Contract state (keyed by playerId, not entityId)
  private readonly playerReadiness = new Map<string, PlayerReadinessRecord>();

  constructor(config: EntityManagerConfig = {}) {
    this.config = {
      enableLogging: config.enableLogging ?? false,
      maxEntities: config.maxEntities ?? 10000,
      transformSystem: config.transformSystem,
      sceneGraph: config.sceneGraph,
    };

    if (this.config.enableLogging) {
      console.log('[EntityManager] Initialized');
      if (this.config.transformSystem) {
        console.log('[EntityManager] Transform System integration enabled');
      }
      if (this.config.sceneGraph) {
        console.log('[EntityManager] Scene Graph integration enabled');
      }
    }
  }

  // ──────── Player Initialization Contract API ────────────────────────────

  /**
   * Begin tracking init phases for `playerId`. Idempotent: calling more than
   * once for the same player is a no-op so re-connect flows don't double-register.
   */
  registerPlayerInit(playerId: string): void {
    if (this.playerReadiness.has(playerId)) return;
    this.playerReadiness.set(playerId, { phases: new Set(), resolvers: [] });
  }

  /**
   * Signal that an init phase is complete for this player.
   * Emits PLAYER_INIT_COMPLETE + resolves awaiting promises once all phases
   * are satisfied. Safe to call multiple times for the same phase.
   */
  markPlayerPhaseReady(playerId: string, phase: PlayerInitPhase): void {
    const record = this.playerReadiness.get(playerId);
    if (!record) return;
    record.phases.add(phase);
    if (PLAYER_INIT_REQUIRED_PHASES.every((p) => record.phases.has(p))) {
      record.resolvers.forEach((r) => r());
      record.resolvers = [];
      gameBus.emit('PLAYER_INIT_COMPLETE', { playerId });
    }
  }

  /** Returns true when all four phases are marked for this player. */
  isPlayerReady(playerId: string): boolean {
    const record = this.playerReadiness.get(playerId);
    if (!record) return false;
    return PLAYER_INIT_REQUIRED_PHASES.every((p) => record.phases.has(p));
  }

  /**
   * Resolves immediately if the player is already ready; otherwise waits.
   * Used by NetworkSyncSystem to gate the first outbound command.
   */
  awaitPlayerReady(playerId: string): Promise<void> {
    return new Promise((resolve) => {
      if (this.isPlayerReady(playerId)) { resolve(); return; }
      const record = this.playerReadiness.get(playerId);
      if (!record) { resolve(); return; }
      record.resolvers.push(resolve);
    });
  }

  /** Remove readiness tracking — call from hardResetRuntimeState. */
  clearPlayerInit(playerId: string): void {
    this.playerReadiness.delete(playerId);
  }

  /** Returns a snapshot of phase states for observability / Control Tower. */
  getPlayerInitDiagnostics(playerId: string): Record<string, unknown> {
    const record = this.playerReadiness.get(playerId);
    if (!record) return { registered: false };
    const phases: Record<string, boolean> = {};
    for (const p of PLAYER_INIT_REQUIRED_PHASES) phases[p] = record.phases.has(p);
    return { registered: true, ready: this.isPlayerReady(playerId), phases };
  }

  // ──────── Entity Lifecycle ────────────────────────────────────────────────

  /**
   * Create a new entity
   */
  createEntity(type: string, transform?: Transform): Entity {
    return this.createEntityInternal(type, transform, false);
  }

  createPooledEntity(type: string, transform?: Transform): Entity {
    return this.createEntityInternal(type, transform, true);
  }

  private createEntityInternal(type: string, transform: Transform | undefined, pooled: boolean): Entity {
    if (this.activeEntities.size >= this.config.maxEntities) {
      console.warn('[EntityManager] Max entity limit reached');
      throw new Error('Max entity limit reached');
    }

    const id = this.generateEntityId();
    const entity = pooled
      ? this.acquirePooledEntity(type, id, transform)
      : new Entity(id, type, transform);

    this.activeEntities.set(id, entity);
    if (pooled) {
      this.pooledEntityTypesById.set(id, type);
    }
    this.entityDebugMetadata.set(id, {
      type,
      pooled,
      createdAt: Date.now(),
      createdStack: this.captureStackTrace(),
    });

    // Register entity with Transform System if available
    if (this.config.transformSystem) {
      this.config.transformSystem.registerEntity(entity, transform);
    }

    // Register entity with SceneGraph if available
    if (this.config.sceneGraph) {
      this.config.sceneGraph.registerEntity(entity);
    }

    if (this.config.enableLogging) {
      console.log(`[EntityManager] Created entity: ${id} (${type})`);
    }

    // Notify listeners
    this.createListeners.forEach((listener) => listener(entity));
    this.createdCount += 1;
    gameBus.emit('stateMutation', {
      source: 'EntityManager',
      path: 'entities.created',
      changedCount: 1,
    });

    return entity;
  }

  /**
   * Destroy an entity
   */
  destroyEntity(idOrEntity: string | Entity): boolean {
    const id = typeof idOrEntity === 'string' ? idOrEntity : idOrEntity.id;
    const entity = this.activeEntities.get(id);

    if (!entity) {
      if (this.config.enableLogging) {
        console.warn(`[EntityManager] Entity not found: ${id}`);
      }
      return false;
    }

    entity.isActive = false;
    entity.touch();
    const pooledType = this.pooledEntityTypesById.get(id) ?? null;

    // Unregister from Transform System if available
    if (this.config.transformSystem) {
      this.config.transformSystem.unregisterEntity(entity);
    }

    // Unregister from SceneGraph if available
    if (this.config.sceneGraph) {
      this.config.sceneGraph.unregisterEntity(id);
    }

    this.activeEntities.delete(id);

    if (this.config.enableLogging) {
      console.log(`[EntityManager] Destroyed entity: ${id}`);
    }

    // Notify listeners
    this.destroyListeners.forEach((listener) => listener(entity));

    if (pooledType) {
      this.pooledEntityTypesById.delete(id);
      this.entityPools.get(pooledType)?.release(entity);
    }
    this.entityDebugMetadata.delete(id);

    this.destroyedCount += 1;
    gameBus.emit('stateMutation', {
      source: 'EntityManager',
      path: 'entities.destroyed',
      changedCount: 1,
    });

    return true;
  }

  /**
   * Get entity by ID
   */
  getEntity(id: string): Entity | undefined {
    return this.activeEntities.get(id);
  }

  hasEntity(id: string): boolean {
    return this.activeEntities.has(id);
  }

  isEntityAlive(id: string): boolean {
    const entity = this.activeEntities.get(id);
    return entity?.isActive ?? false;
  }

  /**
   * Get all entities
   */
  getEntities(): Entity[] {
    return Array.from(this.activeEntities.values());
  }

  /**
   * Query entities by criteria
   */
  queryEntities(options: EntityQueryOptions): Entity[] {
    return this.getEntities().filter((entity) => {
      if (options.active !== undefined && entity.active !== options.active) {
        return false;
      }
      if (options.type !== undefined && entity.type !== options.type) {
        return false;
      }
      if (options.hasComponent !== undefined && !entity.hasComponent(options.hasComponent)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get entities by type
   */
  getEntitiesByType(type: string): Entity[] {
    return this.queryEntities({ type });
  }

  /**
   * Get entities with a specific component
   */
  getEntitiesWithComponent(componentName: string): Entity[] {
    return this.queryEntities({ hasComponent: componentName });
  }

  /**
   * Update all entities
   */
  update(deltaTime: number): void {
    for (const entity of this.activeEntities.values()) {
      entity.update(deltaTime);
      this.updateListeners.forEach((listener) => listener(entity));
    }
  }

  setEntityActive(id: string, active: boolean): boolean {
    const entity = this.activeEntities.get(id);
    if (!entity) return false;
    entity.isActive = active;
    this.updateListeners.forEach((listener) => listener(entity));
    return true;
  }

  markEntityUsed(id: string, timestamp: number = Date.now()): boolean {
    const entity = this.activeEntities.get(id);
    if (!entity) return false;
    entity.touch(timestamp);
    return true;
  }

  /**
   * Register listener for entity creation
   */
  onEntityCreated(listener: (entity: Entity) => void): () => void {
    this.createListeners.push(listener);
    return () => {
      const index = this.createListeners.indexOf(listener);
      if (index > -1) this.createListeners.splice(index, 1);
    };
  }

  /**
   * Register listener for entity destruction
   */
  onEntityDestroyed(listener: (entity: Entity) => void): () => void {
    this.destroyListeners.push(listener);
    return () => {
      const index = this.destroyListeners.indexOf(listener);
      if (index > -1) this.destroyListeners.splice(index, 1);
    };
  }

  /**
   * Register listener for entity updates
   */
  onEntityUpdated(listener: (entity: Entity) => void): () => void {
    this.updateListeners.push(listener);
    return () => {
      const index = this.updateListeners.indexOf(listener);
      if (index > -1) this.updateListeners.splice(index, 1);
    };
  }

  /**
   * Serialize all entities to JSON
   */
  serialize(): EntityData[] {
    return this.getEntities().map((entity) => entity.toJSON());
  }

  /**
   * Deserialize entities from JSON
   */
  deserialize(data: EntityData[]): Entity[] {
    const created: Entity[] = [];

    for (const entityData of data) {
      const entity = Entity.fromJSON(entityData);
      this.activeEntities.set(entity.id, entity);
      this.entityDebugMetadata.set(entity.id, {
        type: entity.type,
        pooled: false,
        createdAt: Date.now(),
        createdStack: '[EntityManager] deserialized entity',
      });
      created.push(entity);

      if (this.config.transformSystem) {
        this.config.transformSystem.registerEntity(entity, entityData.transform);
      }

      // Register with SceneGraph if available
      if (this.config.sceneGraph) {
        this.config.sceneGraph.registerEntity(entity);
      }

      if (this.config.enableLogging) {
        console.log(`[EntityManager] Deserialized entity: ${entity.id} (${entity.type})`);
      }

      this.createListeners.forEach((listener) => listener(entity));
    }

    return created;
  }

  /**
   * Clear all entities
   */
  clear(): void {
    const entitiesToDestroy = Array.from(this.activeEntities.values());

    for (const entity of entitiesToDestroy) {
      this.destroyEntity(entity);
    }

    // Clear all pending init contracts — callers must re-register after a reset.
    this.playerReadiness.clear();

    if (this.config.enableLogging) {
      console.log('[EntityManager] Cleared all entities');
    }
  }

  /**
   * Save scene to JSON string
   */
  saveScene(): string {
    return JSON.stringify(this.serialize());
  }

  /**
   * Load scene from JSON string
   */
  loadScene(jsonString: string): void {
    try {
      const data = JSON.parse(jsonString) as EntityData[];
      this.clear();
      this.deserialize(data);

      if (this.config.enableLogging) {
        console.log(`[EntityManager] Scene loaded with ${data.length} entities`);
      }
    } catch (error) {
      console.error('[EntityManager] Failed to load scene:', error);
      throw error;
    }
  }

  /**
   * Get entity count
   */
  getEntityCount(): number {
    return this.activeEntities.size;
  }

  getActiveEntityDebugRecords(): ActiveEntityDebugRecord[] {
    const records: ActiveEntityDebugRecord[] = [];
    for (const [id, entity] of this.activeEntities.entries()) {
      const metadata = this.entityDebugMetadata.get(id);
      const type = entity.type;
      const hasCollider = entity.hasComponent('collider');
      records.push({
        id,
        type,
        pooled: metadata?.pooled ?? false,
        createdAt: metadata?.createdAt ?? entity.lastUsedTime,
        createdStack: metadata?.createdStack ?? null,
        lastUsedTime: entity.lastUsedTime,
        hasCollider,
        expectsPhysicsBody: hasCollider || type.includes('Projectile') || type.includes('Player'),
      });
    }
    return records;
  }

  getDiagnostics(): Record<string, unknown> {
    const poolStats = [...this.entityPools.entries()].reduce<Record<string, unknown>>((accumulator, [type, pool]) => {
      accumulator[type] = pool.getStats();
      return accumulator;
    }, {});
    const pooledEntities = [...this.entityPools.values()].reduce<number>((count, pool) => count + pool.getStats().available, 0);
    return {
      status: 'ok',
      active: true,
      metrics: {
        count: this.activeEntities.size,
        activeEntities: this.activeEntities.size,
        totalTrackedEntities: this.activeEntities.size + pooledEntities,
        created: this.createdCount,
        destroyed: this.destroyedCount,
        transform: !!this.config.transformSystem,
        scene: !!this.config.sceneGraph,
        pooledEntityTypes: this.entityPools.size,
        pooledEntities,
        pools: poolStats,
      },
    };
  }

  getActiveEntityIds(): string[] {
    return [...this.activeEntities.keys()];
  }

  getLeakMetadata(entityId: string): EntityDebugMetadata | null {
    const metadata = this.entityDebugMetadata.get(entityId);
    return metadata ? { ...metadata } : null;
  }

  /**
   * Generate unique entity ID
   */
  private generateEntityId(): string {
    return `entity_${this.entityIdCounter++}_${Date.now()}`;
  }

  /**
   * Reset ID counter (useful for testing)
   */
  resetIdCounter(): void {
    this.entityIdCounter = 0;
  }

  /**
   * Get Transform System (if set)
   */
  getTransformSystem(): TransformSystem | undefined {
    return this.config.transformSystem;
  }

  /**
   * Set Transform System (for late initialization)
   */
  setTransformSystem(transformSystem: TransformSystem): void {
    this.config.transformSystem = transformSystem;

    // Register all existing entities with the new transform system
    for (const entity of this.activeEntities.values()) {
      transformSystem.registerEntity(entity);
    }

    if (this.config.enableLogging) {
      console.log(`[EntityManager] Transform System set, registered ${this.activeEntities.size} existing entities`);
    }
  }

  /**
   * Set Scene Graph (for late initialization)
   */
  setSceneGraph(sceneGraph: SceneGraph): void {
    this.config.sceneGraph = sceneGraph;

    // Register all existing entities with the new scene graph
    for (const entity of this.activeEntities.values()) {
      sceneGraph.registerEntity(entity);
    }

    if (this.config.enableLogging) {
      console.log(`[EntityManager] Scene Graph set, registered ${this.activeEntities.size} existing entities`);
    }
  }

  getSceneGraph(): SceneGraph | undefined {
    return this.config.sceneGraph;
  }

  private acquirePooledEntity(type: string, id: string, transform?: Transform): Entity {
    const pool = this.getOrCreateEntityPool(type);
    const entity = pool.acquire();
    entity.reinitialize(id, type, transform);
    return entity;
  }

  private getOrCreateEntityPool(type: string): ObjectPool<Entity> {
    const existing = this.entityPools.get(type);
    if (existing) return existing;

    const created = new ObjectPool<Entity>(() => new Entity('', type), {
      reset: (entity) => entity.reset(),
    });
    this.entityPools.set(type, created);
    return created;
  }

  private captureStackTrace(): string | null {
    try {
      throw new Error('[EntityManager] entity allocation');
    } catch (error) {
      return error instanceof Error ? error.stack ?? null : null;
    }
  }
}
