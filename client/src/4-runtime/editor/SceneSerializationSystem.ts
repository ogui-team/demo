import {
  Entity,
  gameBus,
  type Component,
  type SystemCapabilities,
  type SystemContext,
  type Transform,
  type Vector3,
} from '@engine/1-kernel/core/public-api';
import { stripTransientAIControllerState, type AIControllerComponent } from '../../2-systems/gameplay/game/components/AIControllerComponent';

type SceneEntityKind = 'prefab' | 'triggerVolume' | 'light' | 'entity';

interface EntityManagerAdapter {
  getEntities(): Entity[];
  createEntity(type: string, transform?: Partial<Transform>): Entity;
  destroyEntity(idOrEntity: string | Entity): boolean;
}

interface EntityRendererAdapter {
  syncEntity(entity: Entity): void;
}

interface PrefabPlacementAdapter {
  placePrefab(
    prefabIdOrEntityType: string,
    options?: {
      position?: Vector3;
      rotation?: Vector3;
      scale?: Vector3;
      source?: 'ui' | 'paint' | 'system';
      entityType?: string;
      authority?: 'local' | 'replicated';
      skipAuthoritySync?: boolean;
    },
  ): Entity | null;
  finalizePlacedEntity(entity: Entity, options?: { entityType?: string; authority?: 'local' | 'replicated'; skipAuthoritySync?: boolean }): void;
}

interface PrefabSystemAdapter {
  remove?(entityId: string): boolean;
}

interface WorldObjectAuthorityAdapter {
  getAuthorityIdForLocalEntity?(entityId: string): string | null;
  sendRemovedAuthority?(authorityId: string): void;
}

export interface SerializedSceneEntity {
  sourceEntityId: string;
  kind: SceneEntityKind;
  entityType: string;
  prefabId?: string | null;
  authority: 'local' | 'replicated';
  transform: {
    position: Vector3;
    rotation: Vector3;
    scale: Vector3;
  };
  components: Record<string, Record<string, unknown>>;
}

export interface SerializedSceneMap {
  version: 'editor-scene-v1';
  savedAt: number;
  entityCount: number;
  entities: SerializedSceneEntity[];
}

export interface SceneSerializationSystemConfig {
  entityManager: EntityManagerAdapter;
  entityRenderer: EntityRendererAdapter;
  prefabPlacementSystem: PrefabPlacementAdapter;
  prefabSystem?: PrefabSystemAdapter | null;
  worldObjectAuthorityService?: WorldObjectAuthorityAdapter | null;
  enableLogging?: boolean;
}

export interface DeserializeSceneOptions {
  authority?: 'local' | 'replicated';
  skipAuthoritySync?: boolean;
}

export class SceneSerializationSystem {
  private readonly entityManager: EntityManagerAdapter;
  private readonly entityRenderer: EntityRendererAdapter;
  private readonly prefabPlacementSystem: PrefabPlacementAdapter;
  private readonly prefabSystem: PrefabSystemAdapter | null;
  private readonly worldObjectAuthorityService: WorldObjectAuthorityAdapter | null;
  private readonly enableLogging: boolean;
  private systemContext: SystemContext | null = null;

  constructor(config: SceneSerializationSystemConfig) {
    this.entityManager = config.entityManager;
    this.entityRenderer = config.entityRenderer;
    this.prefabPlacementSystem = config.prefabPlacementSystem;
    this.prefabSystem = config.prefabSystem ?? null;
    this.worldObjectAuthorityService = config.worldObjectAuthorityService ?? null;
    this.enableLogging = config.enableLogging ?? false;
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  update(_dt: number): void {
    // Scene persistence is command-driven.
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    const entities = this.collectSerializableEntities();
    return {
      status: 'active',
      active: true,
      metrics: {
        serializableEntities: entities.length,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  serializeEntities(): SerializedSceneEntity[] {
    return this.collectSerializableEntities()
      .map((entity) => this.serializeEntity(entity))
      .sort(compareSceneEntries);
  }

  serializeScene(format: 'object'): SerializedSceneMap;
  serializeScene(format: 'string'): string;
  serializeScene(format: 'object' | 'string' = 'object'): SerializedSceneMap | string {
    const map = this.buildSceneMap();
    gameBus.emit('persistenceLifecycle', {
      action: 'serialize',
      success: true,
      entitiesCreated: map.entityCount,
    });

    return format === 'string'
      ? JSON.stringify(map, null, 2)
      : map;
  }

  deserializeScene(
    mapData: SerializedSceneMap | string,
    options: DeserializeSceneOptions = {},
  ): { cleared: number; recreated: number } {
    const scene = typeof mapData === 'string'
      ? JSON.parse(mapData) as SerializedSceneMap
      : mapData;
    const cleared = this.clearScene();
    let recreated = 0;

    for (const entry of scene.entities) {
      const recreatedEntity = this.recreateSerializedEntity(entry, options);
      if (recreatedEntity) {
        recreated += 1;
      }
    }

    gameBus.emit('persistenceLifecycle', {
      action: 'deserialize',
      success: true,
      entitiesCreated: recreated,
    });

    this.log(`Deserialized scene with ${recreated} entities`);
    return { cleared, recreated };
  }

  deserializeEntities(
    entries: SerializedSceneEntity[],
    options: DeserializeSceneOptions = {},
  ): { recreated: number; entityIds: string[] } {
    const entityIds: string[] = [];

    for (const entry of [...entries].sort(compareSceneEntries)) {
      const recreated = this.recreateSerializedEntity(entry, options);
      if (!recreated) continue;
      entityIds.push(recreated.id);
    }

    return {
      recreated: entityIds.length,
      entityIds,
    };
  }

  clearScene(): number {
    const entities = this.collectSerializableEntities();
    for (const entity of entities) {
      const authorityId = this.worldObjectAuthorityService?.getAuthorityIdForLocalEntity?.(entity.id) ?? null;
      if (authorityId) {
        this.worldObjectAuthorityService?.sendRemovedAuthority?.(authorityId);
      }

      if (entity.hasComponent('prefab') && this.prefabSystem?.remove?.(entity.id)) {
        continue;
      }

      this.entityManager.destroyEntity(entity.id);
    }

    this.log(`Cleared ${entities.length} serialized scene entities`);
    return entities.length;
  }

  private buildSceneMap(): SerializedSceneMap {
    const entities = this.serializeEntities();

    const map: SerializedSceneMap = {
      version: 'editor-scene-v1',
      savedAt: Date.now(),
      entityCount: entities.length,
      entities,
    };

    this.log(`Serialized ${entities.length} scene entities`);
    return map;
  }

  private collectSerializableEntities(): Entity[] {
    return this.entityManager.getEntities().filter((entity) => {
      if (!entity.active) return false;

      const placement = entity.getComponent('editorPlacement')?.data as { serialize?: unknown } | undefined;
      if (placement?.serialize === true) return true;
      if (entity.hasComponent('triggerVolume')) return true;
      if (entity.hasComponent('prefab')) return true;
      if (entity.hasComponent('light')) return true;
      return false;
    });
  }

  private serializeEntity(entity: Entity): SerializedSceneEntity {
    const placement = entity.getComponent('editorPlacement')?.data as Record<string, unknown> | undefined;
    const prefabData = entity.getComponent('prefab')?.data as { prefabName?: string } | undefined;
    const kind = normalizeSceneEntityKind(placement?.kind, entity, prefabData?.prefabName);
    const authority = placement?.authority === 'replicated' ? 'replicated' : 'local';

    return {
      sourceEntityId: entity.id,
      kind,
      entityType: typeof placement?.entityType === 'string' ? placement.entityType : entity.type,
      prefabId: prefabData?.prefabName ?? (typeof placement?.prefabId === 'string' ? placement.prefabId : null),
      authority,
      transform: {
        position: entity.getPosition(),
        rotation: entity.getRotation(),
        scale: entity.getScale(),
      },
      components: this.serializeComponents(entity),
    };
  }

  private serializeComponents(entity: Entity): Record<string, Record<string, unknown>> {
    const components: Record<string, Record<string, unknown>> = {};

    for (const component of entity.getComponents()) {
      if (component.name === 'editorPlacement' || component.name === 'prefab') {
        continue;
      }
      if (component.name === 'aiController') {
        components[component.name] = stripTransientAIControllerState(component.data as AIControllerComponent);
        continue;
      }
      components[component.name] = cloneData(component.data) as Record<string, unknown>;
    }

    return components;
  }

  private recreateSerializedEntity(entry: SerializedSceneEntity, options: DeserializeSceneOptions): Entity | null {
    const resolvedAuthority = options.authority ?? entry.authority;
    const skipAuthoritySync = options.skipAuthoritySync ?? false;
    if (entry.kind === 'prefab' && entry.prefabId) {
      const entity = this.prefabPlacementSystem.placePrefab(entry.prefabId, {
        position: cloneVector3(entry.transform.position),
        rotation: cloneVector3(entry.transform.rotation),
        scale: cloneVector3(entry.transform.scale),
        source: 'system',
        entityType: entry.entityType,
        authority: resolvedAuthority,
        skipAuthoritySync,
      });
      if (!entity) return null;
      this.applySerializedComponents(entity, entry.components);
      entity.setPosition(cloneVector3(entry.transform.position));
      entity.setRotation(cloneVector3(entry.transform.rotation));
      entity.setScale(cloneVector3(entry.transform.scale));
      this.entityRenderer.syncEntity(entity);
      return entity;
    }

    const entity = this.entityManager.createEntity(entry.entityType, {
      position: cloneVector3(entry.transform.position),
      rotation: cloneVector3(entry.transform.rotation),
      scale: cloneVector3(entry.transform.scale),
    });
    entity.setPosition(cloneVector3(entry.transform.position));
    entity.setRotation(cloneVector3(entry.transform.rotation));
    entity.setScale(cloneVector3(entry.transform.scale));
    this.applySerializedComponents(entity, entry.components);
    this.entityRenderer.syncEntity(entity);
    this.prefabPlacementSystem.finalizePlacedEntity(entity, {
      entityType: entry.entityType,
      authority: resolvedAuthority,
      skipAuthoritySync,
    });
    return entity;
  }

  private applySerializedComponents(entity: Entity, components: Record<string, Record<string, unknown>>): void {
    for (const [name, data] of Object.entries(components)) {
      const nextComponent: Component = {
        name,
        data: cloneData(data) as Record<string, unknown>,
      };
      entity.addComponent(nextComponent);
    }
  }

  private log(message: string): void {
    if (!this.enableLogging) return;
    console.log(`[SceneSerializationSystem] ${message}`);
  }
}

function normalizeSceneEntityKind(kind: unknown, entity: Entity, prefabId: string | undefined): SceneEntityKind {
  if (kind === 'prefab' || kind === 'triggerVolume' || kind === 'light' || kind === 'entity') {
    return kind;
  }
  if (entity.hasComponent('triggerVolume')) return 'triggerVolume';
  if (entity.hasComponent('light')) return 'light';
  if (prefabId) return 'prefab';
  return 'entity';
}

function compareSceneEntries(left: SerializedSceneEntity, right: SerializedSceneEntity): number {
  return [
    left.kind.localeCompare(right.kind),
    (left.prefabId ?? '').localeCompare(right.prefabId ?? ''),
    left.entityType.localeCompare(right.entityType),
    left.transform.position.x - right.transform.position.x,
    left.transform.position.y - right.transform.position.y,
    left.transform.position.z - right.transform.position.z,
  ].find((value) => value !== 0) ?? 0;
}

function cloneVector3(vector: Vector3): Vector3 {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}