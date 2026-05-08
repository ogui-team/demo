import type { EntityHandle } from '../kernel/types';
import { HandleAllocator } from './HandleAllocator';
import type { EntityManager } from '../EntityManager';
import type { Entity } from '../Entity';

export type EntityOwnershipType = 'local' | 'remote' | 'server' | 'system' | 'unassigned';

export interface EntityLifecycleMetadata {
  entityId: string;
  handle?: EntityHandle;
  isActive: boolean;
  createdAt: number;
  lastTouchedAt: number;
  ownerType: EntityOwnershipType;
  ownerId: string | null;
  chunkId: string | null;
  pooled: boolean;
  staleSince: number | null;
  runtimeTags: string[];
}

export interface EntityRegisterOptions {
  ownerType?: EntityOwnershipType;
  ownerId?: string | null;
  chunkId?: string | null;
  pooled?: boolean;
  runtimeTags?: string[];
}

export class EntityLifetimeRegistry {
  private readonly handleAllocator: HandleAllocator;
  private readonly entityManager: EntityManager;
  private readonly entityIdToHandle = new Map<string, EntityHandle>();
  private readonly handleToEntityId = new Map<EntityHandle, string>();
  private readonly metadataByEntityId = new Map<string, EntityLifecycleMetadata>();

  constructor(entityManager: EntityManager, handleAllocator: HandleAllocator) {
    this.entityManager = entityManager;
    this.handleAllocator = handleAllocator;

    for (const entity of this.entityManager.getEntities()) {
      this.registerEntity(entity, { ownerType: 'unassigned', pooled: false });
    }

    this.entityManager.onEntityCreated((entity) => {
      this.registerEntity(entity, { ownerType: 'unassigned', pooled: false });
    });

    this.entityManager.onEntityDestroyed((entity) => {
      this.unregisterEntity(entity.id);
    });
  }

  registerEntity(entity: Entity, options: EntityRegisterOptions = {}): EntityLifecycleMetadata {
    const existing = this.metadataByEntityId.get(entity.id);
    if (existing) {
      existing.lastTouchedAt = Date.now();
      existing.isActive = true;
      existing.staleSince = null;
      existing.ownerType = options.ownerType ?? existing.ownerType;
      existing.ownerId = options.ownerId ?? existing.ownerId;
      existing.chunkId = options.chunkId ?? existing.chunkId;
      existing.pooled = options.pooled ?? existing.pooled;
      existing.runtimeTags = options.runtimeTags ?? existing.runtimeTags;
      return existing;
    }

    const handle = this.handleAllocator.allocateNullable();
    const createdAt = Date.now();
    const metadata: EntityLifecycleMetadata = {
      entityId: entity.id,
      handle: handle ?? undefined,
      isActive: entity.isActive,
      createdAt,
      lastTouchedAt: createdAt,
      ownerType: options.ownerType ?? 'unassigned',
      ownerId: options.ownerId ?? null,
      chunkId: options.chunkId ?? null,
      pooled: options.pooled ?? false,
      staleSince: null,
      runtimeTags: options.runtimeTags ?? [],
    };

    if (handle != null) {
      this.entityIdToHandle.set(entity.id, handle);
      this.handleToEntityId.set(handle, entity.id);
    }

    this.metadataByEntityId.set(entity.id, metadata);
    return metadata;
  }

  unregisterEntity(entityId: string): boolean {
    const handle = this.entityIdToHandle.get(entityId);
    const metadata = this.metadataByEntityId.get(entityId);
    if (metadata) {
      metadata.isActive = false;
      metadata.staleSince = Date.now();
      metadata.lastTouchedAt = Date.now();
    }

    if (handle != null) {
      this.entityIdToHandle.delete(entityId);
      this.handleToEntityId.delete(handle);
      this.handleAllocator.destroy(handle);
    }

    return this.metadataByEntityId.delete(entityId);
  }

  resolveEntityId(entityRef: string | EntityHandle): string | null {
    if (typeof entityRef === 'number') {
      return this.handleToEntityId.get(entityRef) ?? null;
    }
    return this.entityManager.hasEntity(entityRef) ? entityRef : null;
  }

  resolve(entityRef: string | EntityHandle): Entity | undefined {
    const entityId = this.resolveEntityId(entityRef);
    if (!entityId) {
      return undefined;
    }
    return this.entityManager.getEntity(entityId);
  }

  isEntityValid(entityRef: string | EntityHandle | null | undefined): boolean {
    if (entityRef == null) {
      return false;
    }
    if (typeof entityRef === 'number') {
      return this.handleAllocator.isValid(entityRef) && this.handleToEntityId.has(entityRef);
    }
    return this.entityManager.hasEntity(entityRef);
  }

  getMetadata(entityId: string): EntityLifecycleMetadata | null {
    const metadata = this.metadataByEntityId.get(entityId);
    return metadata ? { ...metadata } : null;
  }

  annotateOwnership(entityRef: string | EntityHandle, ownerType: EntityOwnershipType, ownerId: string | null = null): boolean {
    const entityId = this.resolveEntityId(entityRef);
    if (!entityId) {
      return false;
    }
    const metadata = this.metadataByEntityId.get(entityId);
    if (!metadata) {
      return false;
    }
    metadata.ownerType = ownerType;
    metadata.ownerId = ownerId;
    metadata.lastTouchedAt = Date.now();
    return true;
  }

  annotateChunk(entityRef: string | EntityHandle, chunkId: string | null): boolean {
    const entityId = this.resolveEntityId(entityRef);
    if (!entityId) {
      return false;
    }
    const metadata = this.metadataByEntityId.get(entityId);
    if (!metadata) {
      return false;
    }
    metadata.chunkId = chunkId;
    metadata.lastTouchedAt = Date.now();
    return true;
  }

  markEntityUsed(entityRef: string | EntityHandle): boolean {
    const entityId = this.resolveEntityId(entityRef);
    if (!entityId) {
      return false;
    }
    const metadata = this.metadataByEntityId.get(entityId);
    if (!metadata) {
      return false;
    }
    metadata.lastTouchedAt = Date.now();
    metadata.staleSince = null;
    return true;
  }

  getEntityHandle(entityId: string): EntityHandle | null {
    return this.entityIdToHandle.get(entityId) ?? null;
  }
}
