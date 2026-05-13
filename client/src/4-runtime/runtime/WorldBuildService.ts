import { gameBus } from '@engine/1-kernel/core/public-api';
import type { Object3D } from 'three';
import type { SaveLoadManager, SavedWorldState } from '../../1-kernel/core/SaveLoadManager';
import type { SceneSerializationSystem, SerializedSceneMap } from '../editor/SceneSerializationSystem';

interface EntityAdapter {
  id: string;
  active: boolean;
  type?: string;
  hasComponent?(name: string): boolean;
}

interface EntityManagerAdapter {
  getEntity(entityId: string): EntityAdapter | null | undefined;
  getEntities?(): EntityAdapter[];
  destroyEntity?(idOrEntity: string | EntityAdapter): boolean;
}

interface EntityRendererAdapter {
  syncEntity(entity: EntityAdapter): void;
  rebindSceneMeshes?(): void;
}

interface SceneGraphNode {
  entityId: string;
}

interface SceneGraphAdapter {
  getAllNodes(): Map<string, Readonly<SceneGraphNode>>;
  unregisterEntity(entityId: string): void;
}

export interface ActiveWorldBuffer {
  version: 'active-world-v2';
  reason: string;
  builtAt: number;
  includeLights: boolean;
  prunedNodeIds: string[];
  scene: SerializedSceneMap;
  runtimeWorld: SavedWorldState;
  sceneRoot: Object3D | null;
}

export interface WorldBuildOptions {
  includeLights?: boolean;
}

export interface WorldBuildServiceConfig {
  sceneSerializationSystem: SceneSerializationSystem | null;
  saveLoadManager: SaveLoadManager | null;
  sceneGraph: SceneGraphAdapter | null;
  entityManager: EntityManagerAdapter | null;
  entityRenderer?: EntityRendererAdapter | null;
  snapshotSceneRoot?: (() => Object3D | null) | null;
  setSceneRoot?: ((root: Object3D) => void) | null;
  onWorldApplied?: (() => void) | null;
}

export interface WorldBuildResult {
  success: boolean;
  buffer: ActiveWorldBuffer | null;
  reason?: string;
}

export class WorldBuildService {
  private readonly sceneSerializationSystem: SceneSerializationSystem | null;
  private readonly saveLoadManager: SaveLoadManager | null;
  private readonly sceneGraph: SceneGraphAdapter | null;
  private readonly entityManager: EntityManagerAdapter | null;
  private readonly entityRenderer: EntityRendererAdapter | null;
  private readonly snapshotSceneRoot: (() => Object3D | null) | null;
  private readonly setSceneRoot: ((root: Object3D) => void) | null;
  private readonly onWorldApplied: (() => void) | null;
  private activeWorldBuffer: ActiveWorldBuffer | null = null;

  constructor(config: WorldBuildServiceConfig) {
    this.sceneSerializationSystem = config.sceneSerializationSystem;
    this.saveLoadManager = config.saveLoadManager;
    this.sceneGraph = config.sceneGraph;
    this.entityManager = config.entityManager;
    this.entityRenderer = config.entityRenderer ?? null;
    this.snapshotSceneRoot = config.snapshotSceneRoot ?? null;
    this.setSceneRoot = config.setSceneRoot ?? null;
    this.onWorldApplied = config.onWorldApplied ?? null;
  }

  async buildActiveWorldBuffer(reason: string, options: WorldBuildOptions = {}): Promise<WorldBuildResult> {
    if (!this.sceneSerializationSystem || !this.saveLoadManager) {
      return {
        success: false,
        buffer: null,
        reason: 'World build dependencies are unavailable.',
      };
    }

    const includeLights = options.includeLights ?? true;
    const prunedNodeIds = this.pruneTransientEditorNodes();
    const scene = this.sceneSerializationSystem.serializeScene('object');
    const runtimeWorld = this.serializeRuntimeWorld({ includeLights });
    const buffer: ActiveWorldBuffer = {
      version: 'active-world-v2',
      reason,
      builtAt: Date.now(),
      includeLights,
      prunedNodeIds,
      scene,
      runtimeWorld,
      sceneRoot: this.captureSceneRoot({ includeLights }),
    };

    this.activeWorldBuffer = buffer;
    gameBus.emit('stateMutation', {
      source: 'WorldBuildService',
      path: 'runtime.activeWorldBuffer',
      changedCount: Math.max(1, buffer.scene.entityCount),
    });

    await this.waitForWorldStabilization(buffer.runtimeWorld.entities.length);

    return { success: true, buffer };
  }

  hasActiveWorldBuffer(): boolean {
    return this.activeWorldBuffer !== null;
  }

  getActiveWorldBuffer(): ActiveWorldBuffer | null {
    return this.activeWorldBuffer;
  }

  async restoreEditorWorldFromBuffer(): Promise<{ success: boolean; entitiesCreated: number; settingsApplied: number }> {
    if (!this.activeWorldBuffer || !this.sceneSerializationSystem) {
      return { success: false, entitiesCreated: 0, settingsApplied: 0 };
    }

    this.purgeRuntimeEntitiesForEditorRestore();

    const result = this.sceneSerializationSystem.deserializeScene(this.activeWorldBuffer.scene, {
      authority: 'local',
      skipAuthoritySync: true,
    });
    await this.waitForWorldStabilization(this.activeWorldBuffer.scene.entityCount);
    this.rebindWorldVisuals();
    this.onWorldApplied?.();
    return {
      success: true,
      entitiesCreated: result.recreated,
      settingsApplied: 0,
    };
  }

  async applyActiveWorldBuffer(): Promise<{ success: boolean; entitiesCreated: number; settingsApplied: number }> {
    if (!this.activeWorldBuffer || !this.saveLoadManager) {
      return { success: false, entitiesCreated: 0, settingsApplied: 0 };
    }

    // Restore THREE.js scene geometry from the pre-play snapshot so that
    // EntityRenderer can rebind to existing scene objects after hard reset.
    if (this.activeWorldBuffer.sceneRoot && this.setSceneRoot) {
      const orderedRoot = this.orderSceneRootForApply(this.activeWorldBuffer.sceneRoot, this.activeWorldBuffer.includeLights);
      this.setSceneRoot(orderedRoot);
      this.entityRenderer?.rebindSceneMeshes?.();
    }

    const result = this.saveLoadManager.deserializeWorld(this.orderRuntimeWorldForApply(this.activeWorldBuffer.runtimeWorld));
    await this.waitForWorldStabilization(this.activeWorldBuffer.runtimeWorld.entities.length);
    this.rebindWorldVisuals();
    this.onWorldApplied?.();
    return {
      success: true,
      entitiesCreated: result.entitiesCreated,
      settingsApplied: result.settingsApplied,
    };
  }

  mergeRuntimeWorldIntoActiveBuffer(reason = 'onExitPlayMode'): { success: boolean; mergedEntities: number; newEntityIds: string[] } {
    if (!this.activeWorldBuffer || !this.saveLoadManager) {
      return { success: false, mergedEntities: 0, newEntityIds: [] };
    }

    const runtimeSnapshot = this.saveLoadManager.serializeWorld({ includeRuntimeEntities: false });
    const merged = this.mergeWorldStates(this.activeWorldBuffer.runtimeWorld, runtimeSnapshot);
    const refreshedScene = this.sceneSerializationSystem?.serializeScene('object') ?? this.activeWorldBuffer.scene;
    this.activeWorldBuffer = {
      ...this.activeWorldBuffer,
      reason,
      builtAt: Date.now(),
      scene: refreshedScene,
      runtimeWorld: merged.runtimeWorld,
      sceneRoot: this.captureSceneRoot({ includeLights: this.activeWorldBuffer.includeLights }),
    };

    return {
      success: true,
      mergedEntities: this.activeWorldBuffer.runtimeWorld.entities.length,
      newEntityIds: merged.newEntityIds,
    };
  }

  private serializeRuntimeWorld(options: { includeLights: boolean }): SavedWorldState {
    const runtime = this.saveLoadManager!.serializeWorld({ includeRuntimeEntities: false });
    if (options.includeLights) {
      return runtime;
    }

    const filtered = runtime.entities.filter((entity) => !this.isLightEntity(entity));
    return {
      ...runtime,
      entities: filtered,
      hierarchy: this.filterHierarchy(runtime.hierarchy, new Set(filtered.map((entity) => entity.id))),
    };
  }

  private captureSceneRoot(options: { includeLights: boolean }): Object3D | null {
    const root = this.snapshotSceneRoot?.() ?? null;
    if (!root || options.includeLights) {
      return root;
    }

    const clone = root.clone(true);
    clone.children = clone.children.filter((child) => !this.isLightObject(child));
    return clone;
  }

  private orderRuntimeWorldForApply(runtimeWorld: SavedWorldState): SavedWorldState {
    const lightEntities = runtimeWorld.entities.filter((entity) => this.isLightEntity(entity));
    const nonLightEntities = runtimeWorld.entities.filter((entity) => !this.isLightEntity(entity));
    return {
      ...runtimeWorld,
      entities: [...lightEntities, ...nonLightEntities],
    };
  }

  private orderSceneRootForApply(sceneRoot: Object3D, includeLights: boolean): Object3D {
    if (!includeLights) {
      return sceneRoot;
    }

    const ordered = sceneRoot.clone(true);
    const lightChildren = ordered.children.filter((child) => this.isLightObject(child));
    const geometryChildren = ordered.children.filter((child) => !this.isLightObject(child));
    ordered.clear();
    ordered.add(...lightChildren, ...geometryChildren);
    return ordered;
  }

  private isLightEntity(entity: SavedWorldState['entities'][number]): boolean {
    return Boolean(entity.components?.light) || entity.type.toLowerCase().includes('light');
  }

  private isLightObject(object: Object3D): boolean {
    const candidate = object as Object3D & { isLight?: boolean };
    return candidate.isLight === true
      || object.name.toLowerCase().includes('light')
      || object.userData?.light === true;
  }

  private mergeWorldStates(base: SavedWorldState, runtime: SavedWorldState): { runtimeWorld: SavedWorldState; newEntityIds: string[] } {
    const mergedById = new Map(base.entities.map((entity) => [entity.id, entity]));
    const newEntityIds: string[] = [];

    for (const runtimeEntity of runtime.entities) {
      if (!mergedById.has(runtimeEntity.id)) {
        newEntityIds.push(runtimeEntity.id);
      }
      mergedById.set(runtimeEntity.id, runtimeEntity);
    }

    const mergedEntities = [...mergedById.values()];
    const allowedIds = new Set(mergedEntities.map((entity) => entity.id));

    const mergedHierarchy = {
      ...(base.hierarchy ?? {}),
      ...(runtime.hierarchy ?? {}),
    };

    return {
      runtimeWorld: {
        ...base,
        ...runtime,
        entities: mergedEntities,
        hierarchy: this.filterHierarchy(mergedHierarchy, allowedIds),
      },
      newEntityIds,
    };
  }

  private filterHierarchy(
    hierarchy: SavedWorldState['hierarchy'] | undefined,
    allowedIds: Set<string>,
  ): SavedWorldState['hierarchy'] {
    if (!hierarchy) {
      return hierarchy;
    }

    const filtered: NonNullable<SavedWorldState['hierarchy']> = {};
    for (const [entityId, node] of Object.entries(hierarchy)) {
      if (!allowedIds.has(entityId)) {
        continue;
      }
      filtered[entityId] = {
        parentId: node.parentId && allowedIds.has(node.parentId) ? node.parentId : null,
        children: (node.children ?? []).filter((childId) => allowedIds.has(childId)),
      };
    }
    return filtered;
  }

  validateExportPayload(json: string): { success: boolean; reason?: string } {
    if (!json.trim()) {
      return { success: false, reason: 'Export payload is empty.' };
    }

    try {
      const parsed = JSON.parse(json) as Partial<SavedWorldState> | Record<string, unknown>;
      const record = parsed as Record<string, unknown>;
      const entities = Array.isArray((parsed as SavedWorldState).entities);
      const settings = typeof (parsed as SavedWorldState).settings === 'object' && (parsed as SavedWorldState).settings !== null;
      const titanFormat = typeof record.format === 'string' && Array.isArray(record.chunkManifest);

      if (!titanFormat && (!entities || !settings)) {
        return { success: false, reason: 'Export JSON does not match a supported world schema.' };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'Export JSON is invalid.',
      };
    }
  }

  private pruneTransientEditorNodes(): string[] {
    if (!this.sceneGraph || !this.entityManager) {
      return [];
    }

    const prunedNodeIds: string[] = [];
    for (const [entityId] of this.sceneGraph.getAllNodes()) {
      const entity = this.entityManager.getEntity(entityId);
      // Only prune truly orphaned graph nodes.
      // Inactive entities can still be valid editor prefabs and must survive build/apply.
      if (entity) {
        continue;
      }

      this.sceneGraph.unregisterEntity(entityId);
      prunedNodeIds.push(entityId);
    }

    return prunedNodeIds;
  }

  private async waitForWorldStabilization(expectedEntityCount: number): Promise<void> {
    const targetCount = Math.max(0, expectedEntityCount);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await this.nextFrame();
      const liveCount = this.entityManager?.getEntities?.().length;
      if (typeof liveCount !== 'number' || liveCount >= targetCount) {
        return;
      }
    }
  }

  private async nextFrame(): Promise<void> {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      return;
    }

    await Promise.resolve();
  }

  private rebindWorldVisuals(): void {
    if (this.entityRenderer?.rebindSceneMeshes) {
      this.entityRenderer.rebindSceneMeshes();
      return;
    }

    if (!this.entityRenderer || !this.entityManager?.getEntities) {
      return;
    }

    for (const entity of this.entityManager.getEntities()) {
      if (!entity?.hasComponent?.('render')) {
        continue;
      }
      this.entityRenderer.syncEntity(entity);
    }
  }

  private purgeRuntimeEntitiesForEditorRestore(): void {
    const entities = this.entityManager?.getEntities?.() ?? [];
    const destroyEntity = this.entityManager?.destroyEntity;
    if (!destroyEntity || entities.length === 0) {
      return;
    }

    let removed = 0;
    for (const entity of entities) {
      const typeLower = (entity.type ?? '').toLowerCase();
      const isRuntimePlayerType = typeLower === 'localplayer'
        || typeLower === 'player'
        || typeLower === 'remoteplayer'
        || typeLower === 'editorplayermarker'
        || typeLower === 'staticcolliderdebug';
      const hasRuntimeMarker = entity.hasComponent?.('localPlayer')
        || entity.hasComponent?.('dodPlayerAvatar')
        || entity.hasComponent?.('editorPlayerMarker');
      if (!isRuntimePlayerType && !hasRuntimeMarker) {
        continue;
      }

      if (destroyEntity.call(this.entityManager, entity.id)) {
        removed += 1;
      }
    }

    if (removed > 0) {
      gameBus.emit('stateMutation', {
        source: 'WorldBuildService',
        path: 'entities.runtimeCleanup',
        changedCount: removed,
      });
    }
  }
}