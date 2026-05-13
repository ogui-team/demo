import * as THREE from 'three';
import {
  Entity,
  gameBus,
  type RoutedInputHandler,
  type SystemCapabilities,
  type SystemContext,
  type Vector3,
} from '@engine/1-kernel/core/public-api';

interface SelectionSystemAdapter {
  getSelectedEntity(): Entity | null;
}

interface EntityManagerAdapter {
  getEntity(entityId: string): Entity | null | undefined;
  getEntities(): Iterable<Entity>;
  destroyEntity(idOrEntity: string | Entity): boolean;
}

interface ToolCoordinatorAdapter {
  getActiveTool(): 'SELECT' | 'PAINT' | 'WHITEBOX';
  isBusy(): boolean;
  setActiveTool(tool: 'SELECT' | 'PAINT' | 'WHITEBOX', reason?: string, source?: 'ui' | 'hotkey' | 'system'): boolean;
}

interface PrefabSystemAdapter {
  create(prefabName: string, position: Vector3, overrides?: Record<string, unknown>): Entity;
  getPrefab(name: string): unknown;
  findPrefabNameByEntityType(entityType: string): string | null;
}

interface PhysicsSystemAdapter {
  raycastFirst(
    origin: Vector3,
    direction: Vector3,
    options: { maxDistance: number; layerMask?: string[]; ignore?: string[] },
  ): { entityId: string; point: Vector3; normal: Vector3 } | null;
}

interface WorldObjectAuthorityAdapter {
  sendPlacedEntity(entity: Entity, entityType?: string): boolean;
  syncAuthorityTransformForEntity(entityId: string): boolean;
}

interface EntityRendererAdapter {
  syncEntity(entity: Entity): void;
}

export interface PrefabPlacementSystemConfig {
  selectionSystem: SelectionSystemAdapter;
  toolCoordinator: ToolCoordinatorAdapter;
  entityManager: EntityManagerAdapter;
  entityRenderer: EntityRendererAdapter;
  camera: THREE.Camera;
  enableLogging?: boolean;
}

export interface PrefabPlacementRuntimeServices {
  prefabSystem?: PrefabSystemAdapter | null;
  physicsSystem?: PhysicsSystemAdapter | null;
  worldObjectAuthorityService?: WorldObjectAuthorityAdapter | null;
  isMultiplayerConnected?: (() => boolean) | null;
}

export interface GroundRayHit {
  entityId: string;
  point: Vector3;
  normal: Vector3;
}

export interface PrefabDropPayload {
  prefabId: string;
  clientX: number;
  clientY: number;
  source?: 'ui' | 'system';
}

export interface PlacePrefabOptions {
  position?: Vector3;
  rotation?: Vector3;
  scale?: Vector3;
  source?: 'ui' | 'paint' | 'system';
  snapOffsetY?: number;
  entityType?: string;
  authority?: 'local' | 'replicated';
  skipAuthoritySync?: boolean;
}

export interface FinalizePlacementOptions {
  entityType?: string;
  authority?: 'local' | 'replicated';
  skipAuthoritySync?: boolean;
}

export class PrefabPlacementSystem implements RoutedInputHandler {
  private readonly selectionSystem: SelectionSystemAdapter;
  private readonly toolCoordinator: ToolCoordinatorAdapter;
  private readonly entityManager: EntityManagerAdapter;
  private readonly entityRenderer: EntityRendererAdapter;
  private readonly camera: THREE.Camera;
  private readonly enableLogging: boolean;
  private readonly mouse = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private prefabSystem: PrefabSystemAdapter | null = null;
  private physicsSystem: PhysicsSystemAdapter | null = null;
  private worldObjectAuthorityService: WorldObjectAuthorityAdapter | null = null;
  private isMultiplayerConnected: (() => boolean) | null = null;
  private systemContext: SystemContext | null = null;
  private readonly lifecycleDisposers: Array<() => void> = [];
  private lastSpawnEventSignature: string | null = null;
  private lastSpawnEventAt = 0;

  constructor(config: PrefabPlacementSystemConfig) {
    this.selectionSystem = config.selectionSystem;
    this.toolCoordinator = config.toolCoordinator;
    this.entityManager = config.entityManager;
    this.entityRenderer = config.entityRenderer;
    this.camera = config.camera;
    this.enableLogging = config.enableLogging ?? false;

    this.lifecycleDisposers.push(
      gameBus.on('EDITOR_SPAWN_PREFAB', ({ prefabId, position, rotation, scale, source }) => {
        const roundedPos = position
          ? `${position.x.toFixed(3)},${position.y.toFixed(3)},${position.z.toFixed(3)}`
          : 'none';
        const spawnSignature = `${prefabId}|${roundedPos}|${source ?? 'unknown'}`;
        const now = Engine.time.now();
        if (this.lastSpawnEventSignature === spawnSignature && (now - this.lastSpawnEventAt) < 100) {
          return;
        }
        this.lastSpawnEventSignature = spawnSignature;
        this.lastSpawnEventAt = now;
        this.placePrefab(prefabId, {
          position,
          rotation,
          scale,
          source,
        });
      }),
      gameBus.on('EDITOR_DELETE_ENTITY_REQUESTED', ({ entityId }) => {
        this.entityManager.destroyEntity(entityId);
      }),
      gameBus.on('EDITOR_SNAP_TO_FLOOR_REQUESTED', ({ entityId, maxDistance, epsilon }) => {
        this.snapEntityToFloor(entityId, maxDistance, epsilon);
      }),
    );
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  setRuntimeServices(services: PrefabPlacementRuntimeServices): void {
    if (services.prefabSystem !== undefined) this.prefabSystem = services.prefabSystem;
    if (services.physicsSystem !== undefined) this.physicsSystem = services.physicsSystem;
    if (services.worldObjectAuthorityService !== undefined) this.worldObjectAuthorityService = services.worldObjectAuthorityService;
    if (services.isMultiplayerConnected !== undefined) this.isMultiplayerConnected = services.isMultiplayerConnected;
  }

  update(_dt: number): void {
    // Event and input driven.
  }

  destroy(): void {
    while (this.lifecycleDisposers.length > 0) {
      this.lifecycleDisposers.pop()?.();
    }
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
    return {
      status: 'active',
      active: true,
      metrics: {
        hasPrefabSystem: this.prefabSystem !== null,
        hasPhysicsSystem: this.physicsSystem !== null,
        hasWorldAuthority: this.worldObjectAuthorityService !== null,
        activeTool: this.toolCoordinator.getActiveTool(),
      },
    };
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.repeat) return false;

    if (event.code === 'Digit1') {
      event.preventDefault();
      return this.toolCoordinator.setActiveTool('SELECT', 'hotkey_select', 'hotkey');
    }
    if (event.code === 'Digit2') {
      event.preventDefault();
      return this.toolCoordinator.setActiveTool('PAINT', 'hotkey_paint', 'hotkey');
    }
    if (event.code === 'Digit3') {
      event.preventDefault();
      return this.toolCoordinator.setActiveTool('WHITEBOX', 'hotkey_whitebox', 'hotkey');
    }
    if (event.code === 'Escape' && this.toolCoordinator.getActiveTool() !== 'SELECT') {
      event.preventDefault();
      return this.toolCoordinator.setActiveTool('SELECT', 'hotkey_escape', 'hotkey');
    }
    if ((event.code === 'End' || event.code === 'PageDown') && !this.toolCoordinator.isBusy()) {
      const selected = this.selectionSystem.getSelectedEntity();
      if (!selected) return false;
      event.preventDefault();
      gameBus.emit('EDITOR_SNAP_TO_FLOOR_REQUESTED', {
        entityId: selected.id,
        source: 'shortcut',
        timestamp: Date.now(),
      });
      return true;
    }
    if (event.code === 'Delete' || event.code === 'Backspace') {
      const selected = this.selectionSystem.getSelectedEntity();
      if (!selected) return false;
      event.preventDefault();
      gameBus.emit('EDITOR_DELETE_ENTITY_REQUESTED', {
        entityId: selected.id,
        timestamp: Date.now(),
      });
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD') {
      const selected = this.selectionSystem.getSelectedEntity();
      if (!selected) return false;
      event.preventDefault();
      const pos = selected.getPosition();
      this.placePrefab(selected.type, {
        position: { x: pos.x + 1, y: pos.y, z: pos.z },
        source: 'system',
      });
      return true;
    }
    return false;
  }

  handleKeyUp(_event: KeyboardEvent): boolean {
    return false;
  }

  canResolvePrefab(prefabIdOrEntityType: string): boolean {
    return this.resolvePrefabIdentifier(prefabIdOrEntityType) !== null;
  }

  handleDrop(data: PrefabDropPayload): Entity | null {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      return this.placePrefab(data.prefabId, {
        source: data.source ?? 'ui',
      });
    }

    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((data.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((data.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();
    const didIntersect = this.raycaster.ray.intersectPlane(groundPlane, hitPoint);

    return this.placePrefab(data.prefabId, {
      position: didIntersect
        ? { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z }
        : undefined,
      source: data.source ?? 'ui',
    });
  }

  placePrefab(prefabIdOrEntityType: string, options: PlacePrefabOptions = {}): Entity | null {
    const prefabSystem = this.prefabSystem;
    const prefabId = this.resolvePrefabIdentifier(prefabIdOrEntityType);
    if (!prefabSystem || !prefabId) {
      this.log(`Unable to resolve prefab ${prefabIdOrEntityType}`);
      return null;
    }

    const position = options.position ?? this.getDefaultSpawnPosition();
    const rotation = options.rotation ?? { x: 0, y: 0, z: 0 };
    const scale = options.scale;
    const entity = prefabSystem.create(prefabId, position, {
      rotation,
      scale,
      networked: false,
    });

    entity.setPosition({ ...position });
    entity.setRotation({ ...rotation });
    if (scale) entity.setScale({ ...scale });
    this.entityRenderer.syncEntity(entity);

    this.finalizePlacedEntity(entity, {
      entityType: options.entityType ?? entity.type,
      authority: options.authority ?? this.resolveAuthorityMode(),
      skipAuthoritySync: options.skipAuthoritySync,
    });

    return entity;
  }

  finalizePlacedEntity(entity: Entity, options: FinalizePlacementOptions = {}): void {
    this.stampEditorPlacementMetadata(entity, options);
    this.entityRenderer.syncEntity(entity);
    if (!options.skipAuthoritySync) {
      this.worldObjectAuthorityService?.sendPlacedEntity(entity, options.entityType ?? entity.type);
    }

    gameBus.emit('EDITOR_PREFAB_PLACED', {
      prefabId: options.entityType ?? entity.type,
      entityId: entity.id,
      authority: options.authority ?? this.resolveAuthorityMode(),
      position: entity.getPosition(),
      rotation: entity.getRotation(),
      scale: entity.getScale(),
      timestamp: Engine.time.now(),
    });

    gameBus.emit('stateMutation', {
      source: 'PrefabPlacementSystem',
      path: `entities.${entity.id}`,
      changedCount: 1,
    });
  }

  private stampEditorPlacementMetadata(entity: Entity, options: FinalizePlacementOptions): void {
    const existing = entity.getComponent('editorPlacement')?.data as Record<string, unknown> | undefined;
    const prefabData = entity.getComponent('prefab')?.data as { prefabName?: string } | undefined;
    const kind = entity.hasComponent('triggerVolume')
      ? 'triggerVolume'
      : entity.hasComponent('light')
        ? 'light'
        : prefabData?.prefabName
          ? 'prefab'
          : 'entity';

    const label = this.createEditorPlacementLabel(
      entity,
      typeof prefabData?.prefabName === 'string'
        ? prefabData.prefabName
        : typeof existing?.prefabId === 'string'
          ? existing.prefabId
          : null,
    );

    entity.addComponent({
      name: 'editorPlacement',
      data: {
        ...existing,
        serialize: true,
        kind,
        prefabId: prefabData?.prefabName ?? existing?.prefabId ?? null,
        entityType: options.entityType ?? entity.type,
        authority: options.authority ?? this.resolveAuthorityMode(),
        label,
      },
    });
  }

  private createEditorPlacementLabel(entity: Entity, prefabId: string | null): string {
    const baseLabel = this.getPrefabDisplayName(prefabId) ?? entity.type;
    const existingEntities = Array.from(this.entityManager.getEntities());
    const duplicateCount = existingEntities.reduce((count, candidate) => {
      if (candidate.id === entity.id) return count;
      const candidatePrefabId = candidate.getComponent('editorPlacement')?.data?.prefabId as string | null | undefined;
      if (prefabId && candidatePrefabId === prefabId) {
        return count + 1;
      }
      if (!prefabId && candidate.type === entity.type) {
        return count + 1;
      }
      return count;
    }, 0);

    if (duplicateCount === 0) {
      return baseLabel;
    }
    return `${baseLabel} ${duplicateCount + 1}`;
  }

  private getPrefabDisplayName(prefabId: string | null): string | null {
    if (!prefabId || !this.prefabSystem) {
      return null;
    }

    const prefab = this.prefabSystem.getPrefab(prefabId) as { metadata?: { editorMetadata?: { displayName?: string } } } | undefined;
    const displayName = prefab?.metadata?.editorMetadata?.displayName;
    if (typeof displayName === 'string' && displayName.trim() !== '') {
      return displayName.trim();
    }
    return null;
  }

  snapEntityToFloor(entityId: string, maxDistance = 2048, epsilon = 0.05): boolean {
    const target = this.entityManager.getEntity(entityId) ?? null;
    if (!target || !this.physicsSystem) {
      return false;
    }

    const previousPosition = target.getPosition();
    const hit = this.physicsSystem.raycastFirst(
      { x: previousPosition.x, y: previousPosition.y + epsilon, z: previousPosition.z },
      { x: 0, y: -1, z: 0 },
      {
        maxDistance,
        layerMask: ['environment'],
        ignore: [target.id],
      },
    );
    if (!hit) {
      return false;
    }

    const nextPosition = {
      x: previousPosition.x,
      y: hit.point.y + epsilon,
      z: previousPosition.z,
    };
    target.setPosition(nextPosition);
    this.entityRenderer.syncEntity(target);
    this.worldObjectAuthorityService?.syncAuthorityTransformForEntity(target.id);

    gameBus.emit('EDITOR_ENTITY_SNAPPED_TO_FLOOR', {
      entityId: target.id,
      previousPosition,
      position: nextPosition,
      hitPoint: hit.point,
      timestamp: Engine.time.now(),
    });
    gameBus.emit('stateMutation', {
      source: 'PrefabPlacementSystem',
      path: `entities.${target.id}.position`,
      changedCount: 1,
    });
    return true;
  }

  pickGroundPointFromPointer(event: MouseEvent, maxDistance = 4096): GroundRayHit | null {
    if (!this.physicsSystem) return null;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const origin = {
      x: this.raycaster.ray.origin.x,
      y: this.raycaster.ray.origin.y,
      z: this.raycaster.ray.origin.z,
    };
    const direction = {
      x: this.raycaster.ray.direction.x,
      y: this.raycaster.ray.direction.y,
      z: this.raycaster.ray.direction.z,
    };

    const hit = this.physicsSystem.raycastFirst(origin, direction, {
      maxDistance,
      layerMask: ['environment'],
    });
    if (!hit) return null;
    return hit;
  }

  private getDefaultSpawnPosition(): Vector3 {
    const cameraPosition = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, -1);
    this.camera.getWorldPosition(cameraPosition);
    forward.applyQuaternion(this.camera.quaternion).normalize().multiplyScalar(5);

    return {
      x: cameraPosition.x + forward.x,
      y: cameraPosition.y + forward.y,
      z: cameraPosition.z + forward.z,
    };
  }

  private resolvePrefabIdentifier(prefabIdOrEntityType: string): string | null {
    if (!this.prefabSystem) return null;
    if (this.prefabSystem.getPrefab(prefabIdOrEntityType)) {
      return prefabIdOrEntityType;
    }
    return this.prefabSystem.findPrefabNameByEntityType(prefabIdOrEntityType);
  }

  private resolveAuthorityMode(): 'local' | 'replicated' {
    return this.isMultiplayerConnected?.() ? 'replicated' : 'local';
  }

  private log(message: string): void {
    if (!this.enableLogging) return;
    console.log(`[PrefabPlacementSystem] ${message}`);
  }
}