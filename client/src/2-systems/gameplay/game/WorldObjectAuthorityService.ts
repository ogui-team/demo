import { gameBus } from '@engine/1-kernel/core/public-api';
import type { Entity, Transform, Vector3 } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import * as Engine from '../../../0-foundation/foundation/Engine';
import * as THREE from 'three';

type PhysicsSystemAdapter = {
  addBody(entityId: string, config: { shape: 'aabb' | 'sphere'; radius?: number; halfExtents?: Vector3; layer?: string; isStatic?: boolean; isTrigger?: boolean; isSensor?: boolean }): void;
  removeBody(entityId: string): void;
};

interface WorldObjectData {
  id: string;
  entityType: string;
  position: Vector3;
  rotation: Vector3;
  renderData: {
    meshType: string;
    color: number;
    geometry: Record<string, unknown>;
  };
  metadata?: {
    colliderHalfExtents?: { x: number; y: number; z: number };
    isStaticCollider?: boolean;
  };
}

interface EntityManagerAdapter {
  createEntity(type: string, transform?: Partial<Transform>): Entity;
  destroyEntity(idOrEntity: string | Entity): boolean;
  getEntity(id: string): Entity | undefined;
}

interface EntityRendererAdapter {
  syncEntity(entity: Entity): void;
  getMeshForEntity?(entityId: string): {
    position: { set(x: number, y: number, z: number): void };
    rotation: { set(x: number, y: number, z: number): void };
  } | undefined;
}

interface PrefabSystemAdapter {
  createByEntityType(
    entityType: string,
    position: Vector3,
    overrides: { rotation: Vector3; networked: boolean; networkEntityId?: string },
  ): Entity | null | undefined;
}

interface CollisionAuthorityAdapter {
  upsertDynamicCollider(id: string, position: Vector3, halfExtents: Vector3, authoritative?: boolean): void;
  removeDynamicCollider(id: string): void;
}

interface StateStoreAdapter {
  set(path: string, value: unknown): void;
}

interface WorldObjectTransportAdapter {
  on?(event: 'world_object_place', handler: (payload: { object: WorldObjectData }) => void): void;
  on?(event: 'world_object_update', handler: (payload: { object: WorldObjectData }) => void): void;
  on?(event: 'world_object_remove', handler: (payload: { id: string }) => void): void;
  isConnected(): boolean;
  sendWorldObjectPlace(obj: WorldObjectData): void;
  sendWorldObjectUpdate(obj: WorldObjectData): void;
  sendWorldObjectRemove(id: string): void;
}

export interface WorldObjectAuthorityServiceConfig {
  entityManager: EntityManagerAdapter;
  entityRenderer: EntityRendererAdapter;
  prefabSystem: PrefabSystemAdapter;
  collisionAuthority: CollisionAuthorityAdapter;
  stateStore?: StateStoreAdapter | null;
  readHalfExtents(entity: Entity): Vector3;
}

export class WorldObjectAuthorityService {
  private readonly entityManager: EntityManagerAdapter;
  private readonly entityRenderer: EntityRendererAdapter;
  private readonly prefabSystem: PrefabSystemAdapter;
  private readonly collisionAuthority: CollisionAuthorityAdapter;
  private readonly stateStore: StateStoreAdapter | null;
  private readonly readHalfExtents: (entity: Entity) => Vector3;
  private readonly authorityToLocalEntity = new Map<string, string>();
  private transport: WorldObjectTransportAdapter | null = null;
  private systemContext: SystemContext | null = null;
  private physicsSystem: PhysicsSystemAdapter | null = null;
  private lastOperation = 'idle';
  private lastUpdatedAt = 0;

  constructor(config: WorldObjectAuthorityServiceConfig) {
    this.entityManager = config.entityManager;
    this.entityRenderer = config.entityRenderer;
    this.prefabSystem = config.prefabSystem;
    this.collisionAuthority = config.collisionAuthority;
    this.stateStore = config.stateStore ?? null;
    this.readHalfExtents = config.readHalfExtents;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    this.physicsSystem = (ctx.systems.physicsSystem as PhysicsSystemAdapter | undefined) ?? null;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
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
      status: 'active',
      active: true,
      metrics: {
        ...this.getDiagnostics(),
        hasSystemContext: this.systemContext !== null,
        hasTransport: this.transport !== null,
      },
    };
  }

  setTransport(transport: WorldObjectTransportAdapter | null): void {
    this.transport = transport;
  }

  bindTransport(transport: WorldObjectTransportAdapter | null): void {
    this.transport = transport;
    transport?.on?.('world_object_place', ({ object }) => {
      this.spawnOrUpdateRemoteObject(object);
    });
    transport?.on?.('world_object_update', ({ object }) => {
      this.applyRemoteUpdate(object);
    });
    transport?.on?.('world_object_remove', ({ id }) => {
      this.removeRemoteObject(id);
    });
  }

  clear(): void {
    for (const [authorityId, localEntityId] of [...this.authorityToLocalEntity.entries()]) {
      this.collisionAuthority.removeDynamicCollider(authorityId);
      if (authorityId !== localEntityId) {
        this.getEntityManager().destroyEntity(localEntityId);
      }
    }
    this.authorityToLocalEntity.clear();
    this.recordOperation('cleared');
    gameBus.emit('worldObjectAuthority', {
      action: 'cleared',
      mappedWorldObjects: 0,
    });
  }

  getLocalEntityId(authorityId: string): string | null {
    return this.authorityToLocalEntity.get(authorityId) ?? null;
  }

  getAuthorityIdForLocalEntity(entityId: string): string | null {
    for (const [authorityId, localEntityId] of this.authorityToLocalEntity.entries()) {
      if (localEntityId === entityId) return authorityId;
    }
    return null;
  }

  getOwnedAuthorityId(entityId: string): string | null {
    const authorityId = this.getAuthorityIdForLocalEntity(entityId);
    return authorityId === entityId ? authorityId : null;
  }

  isServerReplicatedEntity(entityId: string): boolean {
    const authorityId = this.getAuthorityIdForLocalEntity(entityId);
    return authorityId !== null && authorityId !== entityId;
  }

  trackLocalPlacement(entityId: string): void {
    this.authorityToLocalEntity.set(entityId, entityId);
    this.syncDynamicCollider(entityId, entityId);
    this.recordOperation('tracked_local');
    gameBus.emit('worldObjectAuthority', {
      action: 'tracked_local',
      authorityId: entityId,
      entityId,
    });
  }

  untrack(authorityId: string): string | null {
    const localEntityId = this.authorityToLocalEntity.get(authorityId) ?? null;
    if (localEntityId) {
      this.authorityToLocalEntity.delete(authorityId);
      this.collisionAuthority.removeDynamicCollider(authorityId);
      this.recordOperation('untracked');
      gameBus.emit('worldObjectAuthority', {
        action: 'untracked',
        authorityId,
        entityId: localEntityId,
      });
    }
    return localEntityId;
  }

  syncDynamicCollider(authorityId: string, localEntityId: string): void {
    const entity = this.getEntityManager().getEntity(localEntityId);
    if (!entity) {
      this.collisionAuthority.removeDynamicCollider(authorityId);
      return;
    }

    this.collisionAuthority.upsertDynamicCollider(
      authorityId,
      entity.getPosition(),
      this.readHalfExtents(entity),
      true,
    );
  }

  spawnOrUpdateRemoteObject(obj: WorldObjectData): { localEntityId: string; spawned: boolean } | null {
    const existingLocalEntityId = this.getLocalEntityId(obj.id);
    if (existingLocalEntityId) {
      this.applyRemoteUpdate(obj);
      return { localEntityId: existingLocalEntityId, spawned: false };
    }

    // ─ STATIC COLLIDER VISUALIZATION: Red transparent boxes
    if (obj.entityType === 'static_collider') {
      const scene = Engine.getEngineScene();
      if (!scene) return null;

      const halfExtents = obj.metadata?.colliderHalfExtents;
      if (!halfExtents) return null;

      const geometry = new THREE.BoxGeometry(
        halfExtents.x * 2,
        halfExtents.y * 2,
        halfExtents.z * 2
      );
      const material = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.15,
        wireframe: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
      mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
      mesh.userData = { debugType: 'staticCollider', authorityId: obj.id };
      scene.add(mesh);

      if (this.physicsSystem) {
        this.physicsSystem.addBody(obj.id, {
          shape: 'aabb',
          halfExtents: { ...halfExtents },
          layer: 'environment',
          isStatic: true,
        });
      }

      this.authorityToLocalEntity.set(obj.id, obj.id);
      this.recordOperation('spawned_static_collider');
      gameBus.emit('worldObjectAuthority', {
        action: 'spawned_static_collider',
        authorityId: obj.id,
      });
      return { localEntityId: obj.id, spawned: true };
    }

    const prefabEntity = this.getPrefabSystem().createByEntityType(obj.entityType, obj.position, {
      rotation: obj.rotation,
      networked: false,
      networkEntityId: obj.id,
    });
    if (prefabEntity) {
      this.authorityToLocalEntity.set(obj.id, prefabEntity.id);
      this.syncDynamicCollider(obj.id, prefabEntity.id);
      this.recordOperation('spawned_remote_prefab');
      gameBus.emit('worldObjectAuthority', {
        action: 'spawned_remote_prefab',
        authorityId: obj.id,
        entityId: prefabEntity.id,
        entityType: obj.entityType,
      });
      return { localEntityId: prefabEntity.id, spawned: true };
    }

    this.recordOperation('dropped_remote_stale_prefab');
    gameBus.emit('worldObjectAuthority', {
      action: 'dropped_remote_stale_prefab',
      authorityId: obj.id,
      entityType: obj.entityType,
    });
    return null;
  }

  syncRemoteWorldState(objects: WorldObjectData[]): void {
    for (const object of objects) {
      this.spawnOrUpdateRemoteObject(object);
    }
  }

  applyRemoteUpdate(obj: Pick<WorldObjectData, 'id' | 'position' | 'rotation'>): boolean {
    const localEntityId = this.getLocalEntityId(obj.id) ?? obj.id;
    const entity = this.getEntityManager().getEntity(localEntityId);
    if (!entity) return false;

    entity.setPosition(obj.position);
    entity.setRotation(obj.rotation);
    this.stateStore?.set(`entities.${localEntityId}.position`, obj.position);
    this.stateStore?.set(`entities.${localEntityId}.rotation`, obj.rotation);

    const mesh = this.entityRenderer.getMeshForEntity?.(localEntityId);
    if (mesh) {
      mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
      mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
    }

    this.syncDynamicCollider(obj.id, localEntityId);
    this.recordOperation('updated_remote');
    gameBus.emit('worldObjectAuthority', {
      action: 'updated_remote',
      authorityId: obj.id,
      entityId: localEntityId,
    });
    return true;
  }

  removeRemoteObject(authorityId: string): string | null {
    const localEntityId = this.untrack(authorityId);
    if (!localEntityId) return null;
    
    // Handle static collider mesh cleanup
    const scene = Engine.getEngineScene();
    if (scene) {
      const meshesToRemove: THREE.Mesh[] = [];
      scene.traverse((obj: any) => {
        if (obj.userData?.debugType === 'staticCollider' && obj.userData?.authorityId === authorityId) {
          meshesToRemove.push(obj);
        }
      });
      meshesToRemove.forEach(mesh => scene.remove(mesh));
    }

    if (this.physicsSystem) {
      this.physicsSystem.removeBody(authorityId);
    }

    if (localEntityId !== authorityId) {
      this.getEntityManager().destroyEntity(localEntityId);
    }
    this.recordOperation('removed_remote');
    gameBus.emit('worldObjectAuthority', {
      action: 'removed_remote',
      authorityId,
      entityId: localEntityId,
    });
    return localEntityId;
  }

  buildWorldObjectPayload(entity: Entity, authorityId?: string, entityType?: string): WorldObjectData | null {
    const renderData = entity.getComponent('render')?.data as WorldObjectData['renderData'] | undefined;
    if (!renderData || typeof renderData.meshType !== 'string' || typeof renderData.color !== 'number') {
      return null;
    }

    return {
      id: authorityId ?? this.getAuthorityIdForLocalEntity(entity.id) ?? entity.id,
      entityType: entityType ?? entity.type,
      position: entity.getPosition(),
      rotation: entity.getRotation(),
      renderData: {
        meshType: renderData.meshType,
        color: renderData.color,
        geometry: (renderData.geometry ?? {}) as Record<string, unknown>,
      },
    };
  }

  syncOwnedEntity(entity: Entity): boolean {
    const authorityId = this.getOwnedAuthorityId(entity.id);
    if (!authorityId) return false;

    this.syncDynamicCollider(authorityId, entity.id);
    const payload = this.buildWorldObjectPayload(entity, authorityId);
    if (payload && this.transport?.isConnected()) {
      this.transport.sendWorldObjectUpdate(payload);
    }

    this.recordOperation('synced_owned');
    gameBus.emit('worldObjectAuthority', {
      action: 'synced_owned',
      authorityId,
      entityId: entity.id,
    });
    return true;
  }

  syncAuthorityTransformForEntity(entityId: string): boolean {
    const authorityId = this.getAuthorityIdForLocalEntity(entityId) ?? entityId;
    this.syncDynamicCollider(authorityId, entityId);
    const entity = this.getEntityManager().getEntity(entityId);
    if (!entity) return false;
    return this.syncOwnedEntity(entity);
  }

  sendPlacedEntity(entity: Entity, entityType?: string): boolean {
    this.trackLocalPlacement(entity.id);
    const payload = this.buildWorldObjectPayload(entity, entity.id, entityType);
    if (!payload) return false;
    if (this.transport?.isConnected()) {
      this.transport.sendWorldObjectPlace(payload);
    }
    this.recordOperation('placed_local');
    gameBus.emit('worldObjectAuthority', {
      action: 'placed_local',
      authorityId: entity.id,
      entityId: entity.id,
      entityType: payload.entityType,
    });
    return true;
  }

  sendRemovedAuthority(authorityId: string): void {
    const resolvedAuthorityId = this.getAuthorityIdForLocalEntity(authorityId) ?? authorityId;
    if (this.transport?.isConnected()) {
      this.transport.sendWorldObjectRemove(resolvedAuthorityId);
    }
    this.untrack(resolvedAuthorityId);
    this.recordOperation('removed_local');
  }

  getDiagnostics(): Record<string, unknown> {
    let locallyOwnedCount = 0;
    let serverReplicatedCount = 0;
    for (const [authorityId, localEntityId] of this.authorityToLocalEntity.entries()) {
      if (authorityId === localEntityId) locallyOwnedCount += 1;
      else serverReplicatedCount += 1;
    }

    return {
      mappedWorldObjects: this.authorityToLocalEntity.size,
      locallyOwnedCount,
      serverReplicatedCount,
      lastOperation: this.lastOperation,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }

  private recordOperation(operation: string): void {
    this.lastOperation = operation;
    this.lastUpdatedAt = Date.now();
  }

  private getEntityManager(): EntityManagerAdapter {
    return (this.systemContext?.entityManager as EntityManagerAdapter | null) ?? this.entityManager;
  }

  private getPrefabSystem(): PrefabSystemAdapter {
    return (this.systemContext?.systems?.prefabSystem as PrefabSystemAdapter | null | undefined) ?? this.prefabSystem;
  }
}