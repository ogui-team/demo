import { gameBus, type Entity, type EntityManager, type SystemCapabilities, type SystemContext, type Vector3 } from '@engine/1-kernel/core/public-api';
import type { EntityRenderer } from '../../1-kernel/core/EntityRenderer';
import type { SaveLoadManager, SavedEntity, SavedWorldState } from '../../1-kernel/core/SaveLoadManager';
import type { EditorMenu, EditorSpawnEntry } from '../editor/EditorMenu';
import type { DeserializeSceneOptions, SceneSerializationSystem, SerializedSceneEntity } from '../editor/SceneSerializationSystem';
import type { PrefabDefinition, PrefabSystem } from '../../2-systems/gameplay/systems/PrefabSystem';
import type { SpawnSystem } from '../../2-systems/gameplay/systems/SpawnSystem';
import type { MaterialManager } from '../../2-systems/gameplay/systems/MaterialManager';
import type { GameAudioManager } from '../../2-systems/gameplay/systems/GameAudioManager';
import type { PathfindingSystem } from '../../2-systems/gameplay/systems/PathfindingSystem';
import type { SpatialCellBounds, SpatialGridSystem } from '../../2-systems/gameplay/systems/SpatialGridSystem';
import { getAsset, listRuntimeAssets, registerAsset } from '../../2-systems/gameplay/systems/AssetRegistry';
import { setEntityRuntimeLifecycleState } from '../../2-systems/gameplay/systems/RuntimeLifecycle';
import { BUILTIN_PREFABS } from '../../assets/prefabs';
import {
  createDefaultModTrustPolicy,
} from '@shared/contracts';
import type {
  BiomeRegionDefinition,
  RuntimePrefabVariantDefinition,
  WorldEventGraphRuntimeState,
  WorldModManifest,
  WorldProductionBundle,
  WorldProductionSyncPayload,
} from '@shared/contracts';
import {
  TitanWorldProductionRuntime,
  type TitanAssignChunkOwnersOptions,
  type TitanEnvironmentController,
  type TitanPrefabBatchPatch,
  type TitanWorldProductionSnapshot,
  type TitanWorldProductionState,
} from './TitanWorldProductionRuntime';
import type { TitanWorldProductionQueries } from './TitanProductionQueryLayer';
import { BUILTIN_MODULAR_CONTENT_BUNDLE } from './builtinWorldProductionBundle';
import type { RuntimeEventSink } from '../runtime/RuntimeEventQueue';
import { NullRuntimeDeterminismTraceSink, type RuntimeDeterminismTraceSink } from '../runtime/RuntimeSimulationContracts';

const TITAN_WORLD_STORAGE_PREFIX = 'titan_world_';
const TITAN_WORLD_FORMAT = 'titan-world-v1';
const TITAN_CHUNK_FORMAT = 'titan-chunk-v1';
const TITAN_PREFAB_FORMAT = 'titan-prefab-v1';

export interface TitanPrefabAsset {
  format: typeof TITAN_PREFAB_FORMAT;
  version: 1;
  id: string;
  savedAt: number;
  source: 'builtin' | 'runtime';
  definition: PrefabDefinition;
}

export interface TitanChunkAsset {
  format: typeof TITAN_CHUNK_FORMAT;
  version: 1;
  id: string;
  worldId: string;
  cellId: string;
  savedAt: number;
  bounds: SpatialCellBounds;
  entities: SerializedSceneEntity[];
}

export interface TitanChunkManifestEntry {
  id: string;
  cellId: string;
  path: string;
  bounds: SpatialCellBounds;
  entityCount: number;
}

export interface TitanWorldAsset {
  format: typeof TITAN_WORLD_FORMAT;
  version: 1;
  id: string;
  savedAt: number;
  settings: SavedWorldState['settings'];
  engineState?: Record<string, any>;
  systemData?: Record<string, unknown>;
  unassignedEntities: SerializedSceneEntity[];
  chunkManifest: TitanChunkManifestEntry[];
  chunks: TitanChunkAsset[];
  productionSync?: TitanWorldProductionSnapshot;
  productionBundles?: WorldProductionBundle[];
  productionBundleIds?: string[];
  productionState?: TitanWorldProductionState;
}

export interface TitanModPackage {
  manifest: WorldModManifest;
  prefabs?: TitanPrefabAsset[];
  bundles?: WorldProductionBundle[];
}

interface TitanChunkLoadResult {
  recreated: number;
  entityIds: string[];
}

interface TitanContentPipelineConfig {
  saveLoadManager: SaveLoadManager;
  sceneSerializationSystem: SceneSerializationSystem | null;
  prefabSystem: PrefabSystem;
  spawnSystem: SpawnSystem;
  spatialGridSystem: SpatialGridSystem | null;
  entityManager: EntityManager;
  entityRenderer?: EntityRenderer | null;
  materialManager?: MaterialManager | null;
  audioManager?: GameAudioManager | null;
  pathfindingSystem?: PathfindingSystem | null;
  environmentController?: TitanEnvironmentController | null;
  editorMenu?: EditorMenu | null;
  getFocusPosition: () => Vector3 | null;
  loadRadiusCells?: number;
  streamingInterval?: number;
}

class TitanChunkSerializer {
  constructor(
    private readonly sceneSerializationSystem: SceneSerializationSystem,
    private readonly spatialGridSystem: SpatialGridSystem | null,
  ) {}

  serializeWorldChunks(worldId: string): { chunks: TitanChunkAsset[]; unassigned: SerializedSceneEntity[] } {
    const entries = this.sceneSerializationSystem.serializeEntities();
    if (!this.spatialGridSystem) {
      return { chunks: [], unassigned: entries };
    }

    const chunkEntries = new Map<string, SerializedSceneEntity[]>();
    const unassigned: SerializedSceneEntity[] = [];

    for (const entry of entries) {
      const cellId = this.spatialGridSystem.getCellForEntity(entry.sourceEntityId);
      if (!cellId) {
        unassigned.push(entry);
        continue;
      }
      const bucket = chunkEntries.get(cellId) ?? [];
      bucket.push(entry);
      chunkEntries.set(cellId, bucket);
    }

    const savedAt = Date.now();
    const chunks: TitanChunkAsset[] = [];
    for (const [cellId, serializedEntities] of chunkEntries.entries()) {
      const cell = this.spatialGridSystem.getCell(cellId);
      if (!cell) {
        unassigned.push(...serializedEntities);
        continue;
      }
      chunks.push({
        format: TITAN_CHUNK_FORMAT,
        version: 1,
        id: buildChunkAssetId(worldId, cellId),
        worldId,
        cellId,
        savedAt,
        bounds: { ...cell.bounds },
        entities: [...serializedEntities].sort(compareSerializedEntities),
      });
    }

    chunks.sort((left, right) => left.cellId.localeCompare(right.cellId));
    unassigned.sort(compareSerializedEntities);
    return { chunks, unassigned };
  }

  loadChunk(chunk: TitanChunkAsset, options: DeserializeSceneOptions): TitanChunkLoadResult {
    return this.sceneSerializationSystem.deserializeEntities(chunk.entities, options);
  }
}

class TitanStreamingSystem {
  private readonly loadedChunks = new Map<string, string[]>();
  private world: TitanWorldAsset | null = null;
  private timer = 0;
  private lastQueueSize = 0;
  private runtimeEventSink: RuntimeEventSink | null = null;
  private runtimeTraceSink: RuntimeDeterminismTraceSink = NullRuntimeDeterminismTraceSink;

  constructor(
    private readonly chunkSerializer: TitanChunkSerializer,
    private readonly entityManager: EntityManager,
    private readonly getFocusPosition: () => Vector3 | null,
    private readonly spatialGridSystem: SpatialGridSystem | null,
    private readonly prefabSystem: PrefabSystem,
    private readonly loadRadiusCells: number,
    private readonly streamingInterval: number,
  ) {}

  setWorld(world: TitanWorldAsset | null, options: DeserializeSceneOptions = {}): TitanChunkLoadResult {
    this.unloadAll();
    this.world = world;
    if (!world) {
      return { recreated: 0, entityIds: [] };
    }
    return this.loadVisibleChunks(options);
  }

  update(dt: number, options: DeserializeSceneOptions = {}): void {
    if (!this.world) return;
    this.timer += dt;
    if (this.timer < this.streamingInterval) return;
    this.timer = 0;
    this.loadVisibleChunks(options);
  }

  getLoadedChunkIds(): string[] {
    return [...this.loadedChunks.keys()].sort();
  }

  setRuntimeEventSink(runtimeEventSink: RuntimeEventSink | null): void {
    this.runtimeEventSink = runtimeEventSink;
  }

  setRuntimeDeterminismTraceSink(runtimeTraceSink: RuntimeDeterminismTraceSink): void {
    this.runtimeTraceSink = runtimeTraceSink;
  }

  forEachLoadedChunkCell(visitor: (cellId: string, chunkId: string) => void): void {
    for (const chunkId of this.loadedChunks.keys()) {
      const chunkCellId = parseChunkCellId(chunkId);
      if (!chunkCellId) {
        continue;
      }
      visitor(chunkCellId, chunkId);
    }
  }

  getQueueSize(): number {
    return this.lastQueueSize;
  }

  getDebugState(): Record<string, unknown> {
    return {
      loadedChunks: this.loadedChunks.size,
      worldId: this.world?.id ?? null,
      loadRadiusCells: this.loadRadiusCells,
      queueSize: this.lastQueueSize,
    };
  }

  unloadAll(): void {
    for (const chunkId of [...this.loadedChunks.keys()]) {
      this.unloadChunk(chunkId);
    }
    this.loadedChunks.clear();
  }

  private loadVisibleChunks(options: DeserializeSceneOptions): TitanChunkLoadResult {
    if (!this.world || !this.spatialGridSystem) {
      return { recreated: 0, entityIds: [] };
    }

    const focus = this.getFocusPosition();
    if (!focus) {
      return { recreated: 0, entityIds: [] };
    }

    const cellSize = this.spatialGridSystem.getCellSize();
    const baseX = Math.floor(focus.x / cellSize);
    const baseZ = Math.floor(focus.z / cellSize);
    const desiredCells = new Set<string>();

    for (let offsetX = -this.loadRadiusCells; offsetX <= this.loadRadiusCells; offsetX += 1) {
      for (let offsetZ = -this.loadRadiusCells; offsetZ <= this.loadRadiusCells; offsetZ += 1) {
        desiredCells.add(`${baseX + offsetX}:${baseZ + offsetZ}`);
      }
    }

    let recreated = 0;
    const entityIds: string[] = [];
    let pendingTransitions = 0;
    for (const chunkInfo of this.world.chunkManifest) {
      const shouldBeLoaded = desiredCells.has(chunkInfo.cellId);
      const isLoaded = this.loadedChunks.has(chunkInfo.id);
      if (shouldBeLoaded !== isLoaded) {
        pendingTransitions += 1;
      }

      if (!desiredCells.has(chunkInfo.cellId)) {
        this.unloadChunk(chunkInfo.id);
        continue;
      }
      if (this.loadedChunks.has(chunkInfo.id)) {
        continue;
      }

      const chunk = getAsset<TitanChunkAsset>(chunkInfo.id);
      if (!chunk) {
        continue;
      }
      const result = this.chunkSerializer.loadChunk(chunk, options);
      this.loadedChunks.set(chunkInfo.id, result.entityIds);
      for (const entityId of result.entityIds) {
        const entity = this.entityManager.getEntity(entityId);
        if (!entity) continue;
        setEntityRuntimeLifecycleState(entity, 'loaded', {
          chunkId: chunkInfo.cellId,
          reason: 'chunk_loaded',
        });
      }
      recreated += result.recreated;
      entityIds.push(...result.entityIds);
      gameBus.emit('stateMutation', {
        source: 'titanStreamingSystem',
        path: `content.chunks.${chunkInfo.cellId}`,
        changedCount: result.recreated,
      });
      this.emitRuntimeEvent('CHUNK_LOADED', {
        worldId: chunk.worldId,
        chunkId: chunk.id,
        cellId: chunk.cellId,
        entityIds: [...result.entityIds],
        recreated: result.recreated,
        timestamp: Date.now(),
      }, { chunkId: chunk.cellId });
      this.runtimeTraceSink.recordChunkLifecycle('loaded', {
        worldId: chunk.worldId,
        chunkId: chunk.id,
        cellId: chunk.cellId,
        entityCount: result.entityIds.length,
      });
    }

    this.lastQueueSize = pendingTransitions;

    for (const chunkId of [...this.loadedChunks.keys()]) {
      const manifest = this.world.chunkManifest.find((entry) => entry.id === chunkId);
      if (manifest && !desiredCells.has(manifest.cellId)) {
        this.unloadChunk(chunkId);
      }
    }

    return { recreated, entityIds };
  }

  private unloadChunk(chunkId: string): void {
    const entityIds = this.loadedChunks.get(chunkId);
    if (!entityIds) {
      return;
    }

    const worldId = parseChunkWorldId(chunkId);
    const cellId = parseChunkCellId(chunkId) ?? chunkId;
    this.runtimeEventSink?.clearChunk(cellId);

    for (const entityId of entityIds) {
      const entity = this.entityManager.getEntity(entityId);
      if (!entity) {
        continue;
      }
      setEntityRuntimeLifecycleState(entity, 'streamingOut', {
        chunkId,
        reason: 'chunk_unload',
      });
      if (entity.hasComponent('prefab')) {
        this.prefabSystem.remove(entity.id);
        continue;
      }
      this.entityManager.destroyEntity(entity);
    }

    this.loadedChunks.delete(chunkId);
    this.emitRuntimeEvent('CHUNK_UNLOADED', {
      worldId,
      chunkId,
      cellId,
      entityCount: entityIds.length,
      timestamp: Date.now(),
    }, { chunkId: cellId });
    this.runtimeTraceSink.recordChunkLifecycle('unloaded', {
      worldId,
      chunkId,
      cellId,
      entityCount: entityIds.length,
    });
  }

  private emitRuntimeEvent(
    type: 'CHUNK_LOADED',
    payload: { worldId: string; chunkId: string; cellId: string; entityIds: string[]; recreated: number; timestamp: number },
    options?: { chunkId?: string | null },
  ): void;
  private emitRuntimeEvent(
    type: 'CHUNK_UNLOADED',
    payload: { worldId: string; chunkId: string; cellId: string; entityCount: number; timestamp: number },
    options?: { chunkId?: string | null },
  ): void;
  private emitRuntimeEvent(
    type: 'CHUNK_LOADED' | 'CHUNK_UNLOADED',
    payload:
      | { worldId: string; chunkId: string; cellId: string; entityIds: string[]; recreated: number; timestamp: number }
      | { worldId: string; chunkId: string; cellId: string; entityCount: number; timestamp: number },
    options: { chunkId?: string | null } = {},
  ): void {
    if (this.runtimeEventSink) {
      this.runtimeEventSink.enqueue(type as 'CHUNK_LOADED' | 'CHUNK_UNLOADED', payload as any, options);
      return;
    }

    gameBus.emit(type as 'CHUNK_LOADED' | 'CHUNK_UNLOADED', payload as any);
  }
}

export class TitanContentPipeline {
  private readonly chunkSerializer: TitanChunkSerializer | null;
  private readonly streamingSystem: TitanStreamingSystem | null;
  private readonly productionRuntime: TitanWorldProductionRuntime;
  private systemContext: SystemContext | null = null;
  private currentWorldId: string | null = null;
  private materialSyncTimer = 0;

  constructor(private readonly config: TitanContentPipelineConfig) {
    this.chunkSerializer = config.sceneSerializationSystem
      ? new TitanChunkSerializer(config.sceneSerializationSystem, config.spatialGridSystem)
      : null;
    this.streamingSystem = this.chunkSerializer
      ? new TitanStreamingSystem(
          this.chunkSerializer,
          config.entityManager,
          config.getFocusPosition,
          config.spatialGridSystem,
          config.prefabSystem,
          Math.max(1, config.loadRadiusCells ?? 1),
          Math.max(0.05, config.streamingInterval ?? 0.2),
        )
      : null;
    this.productionRuntime = new TitanWorldProductionRuntime({
      prefabSystem: config.prefabSystem,
      spawnSystem: config.spawnSystem,
      entityManager: config.entityManager,
      getFocusPosition: config.getFocusPosition,
      materialManager: config.materialManager,
      audioManager: config.audioManager,
      pathfindingSystem: config.pathfindingSystem,
      entityRenderer: config.entityRenderer,
      environmentController: config.environmentController,
    });

    this.productionRuntime.registerBundle(BUILTIN_MODULAR_CONTENT_BUNDLE);
    this.refreshAssetRegistry();
    config.editorMenu?.setSpawnLibrary(this.buildEditorSpawnLibrary());
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  update(dt: number): void {
    this.streamingSystem?.update(dt, {
      authority: 'local',
      skipAuthoritySync: true,
    });
    this.productionRuntime.update(dt);
    this.materialSyncTimer += dt;
    if (this.materialSyncTimer >= 0.5) {
      this.materialSyncTimer = 0;
      this.productionRuntime.applyActiveMaterialLayers();
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
    const productionMetrics = this.productionRuntime.getDebugMetrics();
    return {
      status: 'active',
      active: true,
      metrics: {
        currentWorldId: this.currentWorldId,
        prefabAssets: listRuntimeAssets('prefab').length,
        worldAssets: listRuntimeAssets('world').length,
        chunkAssets: listRuntimeAssets('chunk').length,
        loadedChunks: this.streamingSystem?.getLoadedChunkIds().length ?? 0,
        streamingQueueSize: this.streamingSystem?.getQueueSize() ?? 0,
        ...productionMetrics,
      },
    };
  }

  setRuntimeEventSink(runtimeEventSink: RuntimeEventSink | null): void {
    this.streamingSystem?.setRuntimeEventSink(runtimeEventSink);
  }

  setRuntimeDeterminismTraceSink(runtimeTraceSink: RuntimeDeterminismTraceSink): void {
    this.streamingSystem?.setRuntimeDeterminismTraceSink(runtimeTraceSink);
  }

  registerProductionBundle(bundle: WorldProductionBundle): void {
    this.productionRuntime.registerBundle(bundle);
    this.refreshAssetRegistry();
    this.config.editorMenu?.setSpawnLibrary(this.buildEditorSpawnLibrary());
  }

  importProductionBundle(json: string): boolean {
    try {
      const parsed = JSON.parse(json) as WorldProductionBundle;
      this.registerProductionBundle(parsed);
      return true;
    } catch (error) {
      console.error('[TitanContentPipeline] Failed to import production bundle', error);
      return false;
    }
  }

  exportProductionBundle(bundleId?: string): string {
    const bundles = bundleId
      ? [this.productionRuntime.getBundle(bundleId)].filter((bundle): bundle is WorldProductionBundle => bundle !== null)
      : this.productionRuntime.getBundles();
    return JSON.stringify(bundleId ? bundles[0] ?? null : bundles, null, 2);
  }

  listProductionBundles(): string[] {
    return this.productionRuntime.listBundles();
  }

  unloadProductionBundle(bundleId: string): { success: boolean; reason?: string } {
    return this.productionRuntime.unloadBundle(bundleId);
  }

  getWorldProductionState(): TitanWorldProductionSnapshot {
    return this.productionRuntime.getSnapshot();
  }

  getProductionQueries(): TitanWorldProductionQueries {
    return this.productionRuntime.getQueries();
  }

  applyNetworkProductionSync(payload: WorldProductionSyncPayload | null | undefined): { accepted: boolean; reason?: string } {
    return this.productionRuntime.replaceSync(payload ?? null);
  }

  resolveBiomeAtPosition(position?: Vector3 | null): BiomeRegionDefinition | null {
    return this.productionRuntime.resolveBiomeAtPosition(position ?? this.config.getFocusPosition());
  }

  materializeProceduralChunk(bundleId: string, cellId: string, worldId: string = this.currentWorldId ?? 'runtime_world'): TitanChunkAsset | null {
    const bounds = resolveCellBounds(this.config.spatialGridSystem, cellId, bundleId);
    const generated = this.productionRuntime.buildProceduralChunk(bundleId, cellId, bounds);
    if (!generated) {
      return null;
    }

    const chunk: TitanChunkAsset = {
      format: TITAN_CHUNK_FORMAT,
      version: 1,
      id: buildChunkAssetId(worldId, generated.cellId),
      worldId,
      cellId: generated.cellId,
      savedAt: Date.now(),
      bounds: { ...generated.bounds },
      entities: [...generated.entities],
    };
    registerAsset({
      id: chunk.id,
      type: 'chunk',
      path: `/assets/worlds/${worldId}/${sanitizeChunkCellId(chunk.cellId)}.titanchunk`,
      data: chunk,
      metadata: {
        worldId,
        cellId: chunk.cellId,
        entityCount: chunk.entities.length,
        procedural: true,
      },
    });
    return chunk;
  }

  startEventGraph(graphId: string): WorldEventGraphRuntimeState | null {
    return this.productionRuntime.startEventGraph(graphId);
  }

  triggerProductionEvent(eventId: string, payload?: Record<string, unknown>): WorldEventGraphRuntimeState[] {
    return this.productionRuntime.triggerEvent(eventId, payload);
  }

  playCinematic(sequenceId: string): boolean {
    return this.productionRuntime.playCinematic(sequenceId);
  }

  registerPrefabVariant(variant: RuntimePrefabVariantDefinition): PrefabDefinition | null {
    const prefab = this.productionRuntime.registerPrefabVariant(variant);
    if (prefab) {
      this.refreshAssetRegistry();
      this.config.editorMenu?.setSpawnLibrary(this.buildEditorSpawnLibrary());
    }
    return prefab;
  }

  batchUpdatePrefabs(prefabIds: string[], patch: TitanPrefabBatchPatch): number {
    const updated = this.productionRuntime.batchUpdatePrefabs(prefabIds, patch);
    if (updated > 0) {
      this.refreshAssetRegistry();
      this.config.editorMenu?.setSpawnLibrary(this.buildEditorSpawnLibrary());
    }
    return updated;
  }

  tagAssets(assetIds: string[], tags: string[]): number {
    return this.productionRuntime.tagAssets(assetIds, tags);
  }

  assignChunkOwners(options: TitanAssignChunkOwnersOptions): Record<string, string> {
    return this.productionRuntime.assignChunkOwners(options);
  }

  applyPersistentBiomeMutation(biomeId: string, mutation: Record<string, unknown>): boolean {
    return this.productionRuntime.applyPersistentBiomeMutation(biomeId, mutation);
  }

  resolveEncounter(encounterId: string, resolvedBy: string): boolean {
    return this.productionRuntime.resolveEncounter(encounterId, resolvedBy);
  }

  getProductionReplayJournal() {
    return this.productionRuntime.getReplayJournal();
  }

  exportModPackage(modId: string): string | null {
    const manifest = this.productionRuntime.listMods().includes(modId)
      ? this.productionRuntime.getBundles().flatMap((bundle) => bundle.mods ?? []).find((entry) => entry.id === modId) ?? null
      : null;
    if (!manifest) {
      return null;
    }

    const prefabs = (manifest.prefabIds ?? [])
      .map((prefabId) => this.createPrefabAsset(prefabId))
      .filter((asset): asset is TitanPrefabAsset => asset !== null);
    const bundles = (manifest.bundleIds ?? [])
      .map((bundleId) => this.productionRuntime.getBundle(bundleId))
      .filter((bundle): bundle is WorldProductionBundle => bundle !== null);

    return JSON.stringify({ manifest, prefabs, bundles } satisfies TitanModPackage, null, 2);
  }

  importModPackage(json: string): { success: boolean; prefabCount: number; bundleCount: number } {
    try {
      const parsed = JSON.parse(json) as TitanModPackage;
      const trustPolicy = createDefaultModTrustPolicy();
      const rawBytes = new TextEncoder().encode(json).byteLength;
      if (rawBytes > trustPolicy.replicationSafePayloadRules.maxPayloadBytes) {
        throw new Error(`Mod package exceeds replication-safe payload budget (${rawBytes} bytes)`);
      }

      let prefabCount = 0;
      for (const prefab of parsed.prefabs ?? []) {
        this.config.prefabSystem.registerPrefab(prefab.id, prefab.definition);
        prefabCount += 1;
      }
      for (const bundle of parsed.bundles ?? []) {
        const bundleBytes = new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
        const bundleTrustPolicy = bundle.trustPolicy ?? trustPolicy;
        if (bundleBytes > bundleTrustPolicy.sandboxLimits.maxBundleBytes) {
          throw new Error(`Bundle '${bundle.id}' exceeds sandbox budget (${bundleBytes} bytes)`);
        }
        for (const forbiddenHook of bundleTrustPolicy.forbiddenRuntimeHooks) {
          if (JSON.stringify(bundle).includes(forbiddenHook)) {
            throw new Error(`Bundle '${bundle.id}' violates trust boundary via '${forbiddenHook}'`);
          }
        }
        this.registerProductionBundle(bundle);
      }
      if (parsed.manifest) {
        this.productionRuntime.registerMod(parsed.manifest);
      }
      this.refreshAssetRegistry();
      this.config.editorMenu?.setSpawnLibrary(this.buildEditorSpawnLibrary());
      return {
        success: true,
        prefabCount,
        bundleCount: parsed.bundles?.length ?? 0,
      };
    } catch (error) {
      console.error('[TitanContentPipeline] Failed to import mod package', error);
      return {
        success: false,
        prefabCount: 0,
        bundleCount: 0,
      };
    }
  }

  forEachLoadedChunkCell(visitor: (cellId: string, chunkId: string) => void): void {
    this.streamingSystem?.forEachLoadedChunkCell(visitor);
  }

  getStreamingQueueSize(): number {
    return this.streamingSystem?.getQueueSize() ?? 0;
  }

  refreshAssetRegistry(): void {
    const savedAt = Date.now();
    for (const prefabName of this.config.prefabSystem.listPrefabs()) {
      const definition = this.config.prefabSystem.getPrefab(prefabName);
      if (!definition) continue;

      const runtimeMetadata = definition.metadata?.runtimeMetadata ?? {};
      const asset: TitanPrefabAsset = {
        format: TITAN_PREFAB_FORMAT,
        version: 1,
        id: prefabName,
        savedAt,
        source: prefabName in BUILTIN_PREFABS ? 'builtin' : 'runtime',
        definition,
      };
      registerAsset({
        id: prefabName,
        type: 'prefab',
        path: `/assets/prefabs/${prefabName}.prefab`,
        data: asset,
        metadata: {
          entityType: definition.entityType,
          assetKey: definition.assetKey ?? null,
          category: derivePrefabCategory(definition),
          builtin: prefabName in BUILTIN_PREFABS,
          affinities: runtimeMetadata.affinities ?? null,
          surfaceType: runtimeMetadata.audioSurfaceType ?? null,
          streamingCost: runtimeMetadata.streamingCost ?? null,
          gpuInstancing: runtimeMetadata.gpuInstancing ?? null,
          buildMetadata: definition.metadata ?? {},
        },
      });
    }
  }

  buildEditorSpawnLibrary(): EditorSpawnEntry[] {
    this.refreshAssetRegistry();
    const entries: EditorSpawnEntry[] = [];

    for (const asset of listRuntimeAssets('prefab')) {
      const prefabAsset = getAsset<TitanPrefabAsset>(asset.id);
      if (!prefabAsset) continue;
      entries.push({
        id: prefabAsset.id,
        label: humanizeId(prefabAsset.id),
        category: `Prefabs/${derivePrefabCategory(prefabAsset.definition)}`,
        glyph: derivePrefabGlyph(prefabAsset.definition),
        accentColor: derivePrefabColor(prefabAsset.definition),
        description: buildPrefabDescription(prefabAsset.definition),
        spawn: (position) => this.spawnPrefab(prefabAsset.id, position),
        buildSpawnRequest: (position) => ({
          entityType: prefabAsset.id,
          position,
          rotation: { x: 0, y: 0, z: 0 },
          renderData: buildPrefabRenderData(prefabAsset.definition),
        }),
      });
    }

    entries.sort((left, right) => left.label.localeCompare(right.label));
    return entries;
  }

  spawnPrefab(prefabId: string, position: Vector3): Entity | null {
    try {
      return this.config.spawnSystem.spawnPrefab(prefabId, { position });
    } catch (error) {
      console.error('[TitanContentPipeline] Failed to spawn prefab', { prefabId, position, error });
      return null;
    }
  }

  saveMap(name: string): boolean {
    try {
      const world = this.serializeWorld(name);
      localStorage.setItem(buildWorldStorageKey(name), JSON.stringify(world));
      registerAsset({
        id: buildWorldAssetId(name),
        type: 'world',
        path: `/assets/worlds/${name}.titanworld`,
        data: world,
        metadata: {
          entityCount: countWorldEntities(world),
          chunkCount: world.chunkManifest.length,
        },
      });
      this.currentWorldId = name;
      return true;
    } catch (error) {
      console.error('[TitanContentPipeline] Failed to save world', error);
      return false;
    }
  }

  loadMap(name: string): { success: boolean; entitiesCreated: number; settingsApplied: number } {
    const json = localStorage.getItem(buildWorldStorageKey(name));
    if (!json) {
      return this.config.saveLoadManager.loadMap(name);
    }

    try {
      const parsed = JSON.parse(json) as TitanWorldAsset;
      return this.loadWorld(parsed, name);
    } catch (error) {
      console.error('[TitanContentPipeline] Failed to parse titan world, falling back to legacy loader', error);
      return this.config.saveLoadManager.loadMap(name);
    }
  }

  listMaps(): string[] {
    const maps = new Set<string>(this.config.saveLoadManager.listMaps());
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(TITAN_WORLD_STORAGE_PREFIX)) {
        continue;
      }
      maps.add(key.slice(TITAN_WORLD_STORAGE_PREFIX.length));
    }
    return [...maps].sort();
  }

  deleteMap(name: string): boolean {
    const titanKey = buildWorldStorageKey(name);
    const hadTitanMap = localStorage.getItem(titanKey) !== null;
    if (hadTitanMap) {
      localStorage.removeItem(titanKey);
    }
    const deletedLegacy = this.config.saveLoadManager.deleteMap(name);
    return hadTitanMap || deletedLegacy;
  }

  exportMap(name?: string): string {
    if (!name) {
      return JSON.stringify(this.serializeWorld(this.currentWorldId ?? 'runtime_world'), null, 2);
    }

    const json = localStorage.getItem(buildWorldStorageKey(name));
    if (json) {
      return json;
    }
    return this.config.saveLoadManager.exportMap(name);
  }

  importMap(json: string, name?: string): { success: boolean; entitiesCreated: number; settingsApplied: number } {
    try {
      const parsed = JSON.parse(json) as TitanWorldAsset | SavedWorldState;
      if (isTitanWorldAsset(parsed)) {
        if (name) {
          localStorage.setItem(buildWorldStorageKey(name), JSON.stringify(parsed));
        }
        return this.loadWorld(parsed, name ?? parsed.id);
      }
    } catch {
      // Fall back to legacy import below.
    }

    return this.config.saveLoadManager.importMap(json, name);
  }

  getMapInfo(name: string): SavedWorldState | null {
    const json = localStorage.getItem(buildWorldStorageKey(name));
    if (!json) {
      return this.config.saveLoadManager.getMapInfo(name);
    }

    try {
      const parsed = JSON.parse(json) as TitanWorldAsset;
      return createSavedWorldInfo(parsed);
    } catch {
      return null;
    }
  }

  private serializeWorld(name: string): TitanWorldAsset {
    this.refreshAssetRegistry();
    const legacyWorld = this.config.saveLoadManager.serializeWorld();
    if (!this.config.sceneSerializationSystem || !this.chunkSerializer) {
      return this.appendProceduralChunks(name, {
        format: TITAN_WORLD_FORMAT,
        version: 1,
        id: name,
        savedAt: Date.now(),
        settings: legacyWorld.settings,
        engineState: legacyWorld.engineState,
        systemData: legacyWorld.systemData,
        unassignedEntities: [],
        chunkManifest: [],
        chunks: [],
        productionSync: this.productionRuntime.getSnapshot(),
        productionBundles: this.productionRuntime.getBundles(),
        productionBundleIds: this.productionRuntime.listBundles(),
        productionState: this.productionRuntime.getState(),
      });
    }

    const { chunks, unassigned } = this.chunkSerializer.serializeWorldChunks(name);
    for (const chunk of chunks) {
      registerAsset({
        id: chunk.id,
        type: 'chunk',
        path: `/assets/worlds/${name}/${sanitizeChunkCellId(chunk.cellId)}.titanchunk`,
        data: chunk,
        metadata: {
          worldId: name,
          cellId: chunk.cellId,
          entityCount: chunk.entities.length,
        },
      });
    }

    return this.appendProceduralChunks(name, {
      format: TITAN_WORLD_FORMAT,
      version: 1,
      id: name,
      savedAt: Date.now(),
      settings: legacyWorld.settings,
      engineState: legacyWorld.engineState,
      systemData: legacyWorld.systemData,
      unassignedEntities: unassigned,
      chunkManifest: chunks.map((chunk) => ({
        id: chunk.id,
        cellId: chunk.cellId,
        path: `/assets/worlds/${name}/${sanitizeChunkCellId(chunk.cellId)}.titanchunk`,
        bounds: { ...chunk.bounds },
        entityCount: chunk.entities.length,
      })),
      chunks,
      productionSync: this.productionRuntime.getSnapshot(),
      productionBundles: this.productionRuntime.getBundles(),
      productionBundleIds: this.productionRuntime.listBundles(),
      productionState: this.productionRuntime.getState(),
    });
  }

  private loadWorld(world: TitanWorldAsset, name: string): { success: boolean; entitiesCreated: number; settingsApplied: number } {
    const productionSync = world.productionSync ?? this.buildLegacyProductionSync(world);
    if (productionSync) {
      const hydration = this.productionRuntime.hydrateSnapshot(productionSync);
      if (!hydration.accepted) {
        console.error('[TitanContentPipeline] Rejected production snapshot during world load', hydration.reason);
      }
    } else {
      for (const bundle of world.productionBundles ?? []) {
        this.productionRuntime.registerBundle(bundle);
      }
      this.productionRuntime.hydrate(world.productionState);
    }
    const hydratedWorld = this.appendProceduralChunks(name, world);

    const baseWorld: SavedWorldState = {
      version: '2.0',
      timestamp: hydratedWorld.savedAt,
      entities: [],
      engineState: hydratedWorld.engineState,
      hierarchy: undefined,
      systemData: hydratedWorld.systemData,
      settings: hydratedWorld.settings,
    };

    const baseResult = this.config.saveLoadManager.deserializeWorld(baseWorld);
    for (const chunk of hydratedWorld.chunks) {
      registerAsset({
        id: chunk.id,
        type: 'chunk',
        path: `/assets/worlds/${name}/${sanitizeChunkCellId(chunk.cellId)}.titanchunk`,
        data: chunk,
        metadata: {
          worldId: name,
          cellId: chunk.cellId,
          entityCount: chunk.entities.length,
        },
      });
    }

    let created = 0;
    if (this.config.sceneSerializationSystem) {
      const unassigned = this.config.sceneSerializationSystem.deserializeEntities(hydratedWorld.unassignedEntities, {
        authority: 'local',
        skipAuthoritySync: true,
      });
      for (const entityId of unassigned.entityIds) {
        const entity = this.config.entityManager.getEntity(entityId);
        if (!entity) continue;
        setEntityRuntimeLifecycleState(entity, 'loaded', {
          chunkId: null,
          reason: 'world_loaded',
        });
      }
      created += unassigned.recreated;
    }

    if (this.streamingSystem && hydratedWorld.chunkManifest.length > 0) {
      const streamResult = this.streamingSystem.setWorld(hydratedWorld, {
        authority: 'local',
        skipAuthoritySync: true,
      });
      created += streamResult.recreated;
    } else if (this.chunkSerializer) {
      for (const chunk of hydratedWorld.chunks) {
        const result = this.chunkSerializer.loadChunk(chunk, {
          authority: 'local',
          skipAuthoritySync: true,
        });
        created += result.recreated;
      }
    }

    this.currentWorldId = name;
    registerAsset({
      id: buildWorldAssetId(name),
      type: 'world',
      path: `/assets/worlds/${name}.titanworld`,
      data: hydratedWorld,
      metadata: {
        entityCount: countWorldEntities(hydratedWorld),
        chunkCount: hydratedWorld.chunkManifest.length,
        loaded: true,
      },
    });
    this.productionRuntime.applyActiveMaterialLayers();

    gameBus.emit('persistenceLifecycle', {
      action: 'load',
      name,
      success: true,
      entitiesCreated: created,
      settingsApplied: baseResult.settingsApplied,
    });

    return {
      success: true,
      entitiesCreated: created,
      settingsApplied: baseResult.settingsApplied,
    };
  }

  private appendProceduralChunks(worldId: string, world: TitanWorldAsset): TitanWorldAsset {
    const nextWorld: TitanWorldAsset = {
      ...world,
      chunkManifest: [...world.chunkManifest],
      chunks: [...world.chunks],
      productionSync: world.productionSync ? cloneJson(world.productionSync) : undefined,
      productionBundles: world.productionBundles ? [...world.productionBundles] : undefined,
      productionBundleIds: world.productionBundleIds ? [...world.productionBundleIds] : undefined,
      productionState: world.productionState ? { ...world.productionState } : undefined,
    };
    const bundleIds = nextWorld.productionSync?.authoredBundles.map((bundle) => bundle.id)
      ?? nextWorld.productionBundleIds
      ?? nextWorld.productionBundles?.map((bundle) => bundle.id)
      ?? [];
    for (const bundleId of bundleIds) {
      const bundle = this.productionRuntime.getBundle(bundleId);
      const cellIds = collectProceduralCellIds(bundle);
      for (const cellId of cellIds) {
        if (nextWorld.chunkManifest.some((entry) => entry.cellId === cellId)) {
          continue;
        }
        const chunk = this.materializeProceduralChunk(bundleId, cellId, worldId);
        if (!chunk) {
          continue;
        }
        nextWorld.chunks.push(chunk);
        nextWorld.chunkManifest.push({
          id: chunk.id,
          cellId: chunk.cellId,
          path: `/assets/worlds/${worldId}/${sanitizeChunkCellId(chunk.cellId)}.titanchunk`,
          bounds: { ...chunk.bounds },
          entityCount: chunk.entities.length,
        });
      }
    }
    return nextWorld;
  }

  private buildLegacyProductionSync(world: TitanWorldAsset): TitanWorldProductionSnapshot | null {
    if (!world.productionBundles?.length) {
      return null;
    }

    for (const bundle of world.productionBundles) {
      this.productionRuntime.registerBundle(bundle);
    }
    if (world.productionState) {
      this.productionRuntime.hydrate(world.productionState);
    }
    return this.productionRuntime.getSnapshot();
  }

  private createPrefabAsset(prefabId: string): TitanPrefabAsset | null {
    const definition = this.config.prefabSystem.getPrefab(prefabId);
    if (!definition) {
      return null;
    }
    return {
      format: TITAN_PREFAB_FORMAT,
      version: 1,
      id: prefabId,
      savedAt: Date.now(),
      source: prefabId in BUILTIN_PREFABS ? 'builtin' : 'runtime',
      definition,
    };
  }
}

function buildWorldStorageKey(name: string): string {
  return `${TITAN_WORLD_STORAGE_PREFIX}${name}`;
}

function buildWorldAssetId(name: string): string {
  return `world:${name}`;
}

function buildChunkAssetId(worldId: string, cellId: string): string {
  return `chunk:${worldId}:${cellId}`;
}

function collectProceduralCellIds(bundle: WorldProductionBundle | null): string[] {
  if (!bundle?.proceduralWorld) {
    return [];
  }
  const cellIds = new Set<string>(bundle.proceduralWorld.generatedCellIds ?? []);
  for (const override of bundle.proceduralWorld.chunkOverrides ?? []) {
    cellIds.add(override.cellId);
  }
  return [...cellIds].sort();
}

function resolveCellBounds(
  spatialGridSystem: SpatialGridSystem | null,
  cellId: string,
  bundleId: string,
): SpatialCellBounds {
  const existing = spatialGridSystem?.getCell(cellId);
  if (existing) {
    return { ...existing.bounds };
  }
  const cellSize = spatialGridSystem?.getCellSize() ?? 64;
  const [rawX, rawZ] = cellId.split(':');
  const cellX = Number(rawX);
  const cellZ = Number(rawZ);
  const x = Number.isFinite(cellX) ? cellX : 0;
  const z = Number.isFinite(cellZ) ? cellZ : 0;
  void bundleId;
  return {
    minX: x * cellSize,
    maxX: (x + 1) * cellSize,
    minZ: z * cellSize,
    maxZ: (z + 1) * cellSize,
  };
}

function parseChunkWorldId(chunkId: string): string {
  const match = /^chunk:([^:]+):/.exec(chunkId);
  return match?.[1] ?? 'runtime';
}

function parseChunkCellId(chunkId: string): string | null {
  const match = /^chunk:[^:]+:(.+)$/.exec(chunkId);
  return match?.[1] ?? null;
}

function sanitizeChunkCellId(cellId: string): string {
  return `chunk_${cellId.replace(/:/g, '_')}`;
}

function compareSerializedEntities(left: SerializedSceneEntity, right: SerializedSceneEntity): number {
  return [
    left.kind.localeCompare(right.kind),
    (left.prefabId ?? '').localeCompare(right.prefabId ?? ''),
    left.entityType.localeCompare(right.entityType),
    left.transform.position.x - right.transform.position.x,
    left.transform.position.y - right.transform.position.y,
    left.transform.position.z - right.transform.position.z,
  ].find((value) => value !== 0) ?? 0;
}

function isTitanWorldAsset(value: unknown): value is TitanWorldAsset {
  return typeof value === 'object'
    && value !== null
    && (value as { format?: unknown }).format === TITAN_WORLD_FORMAT;
}

function countWorldEntities(world: TitanWorldAsset): number {
  return world.unassignedEntities.length + world.chunkManifest.reduce((total, chunk) => total + chunk.entityCount, 0);
}

function createSavedWorldInfo(world: TitanWorldAsset): SavedWorldState {
  return {
    version: world.format,
    timestamp: world.savedAt,
    entities: flattenWorldEntities(world),
    engineState: world.engineState,
    systemData: world.systemData,
    settings: world.settings,
  };
}

function flattenWorldEntities(world: TitanWorldAsset): SavedEntity[] {
  const entries = [...world.unassignedEntities, ...world.chunks.flatMap((chunk) => chunk.entities)];
  return entries.map((entry, index) => ({
    id: entry.sourceEntityId || `serialized-${index}`,
    type: entry.entityType,
    active: true,
    transform: {
      position: entry.transform.position,
      rotation: entry.transform.rotation,
      scale: entry.transform.scale,
    },
    components: { ...entry.components },
  }));
}

function derivePrefabCategory(prefab: PrefabDefinition): string {
  const category = prefab.metadata?.editorMetadata?.category as string | undefined;
  if (category) return category;
  if (prefab.pickup) return 'Pickups';
  if (prefab.entityType.includes('player')) return 'Characters';
  if (prefab.entityType.includes('tree') || prefab.entityType.includes('rock') || prefab.entityType.includes('light')) return 'World';
  if (prefab.tags?.includes('castle') || prefab.tags?.includes('dungeon') || prefab.tags?.includes('vegetation')) return 'Environment';
  return 'Gameplay';
}

function derivePrefabGlyph(prefab: PrefabDefinition): string {
  if (prefab.pickup) return '◌';
  if (prefab.entityType.includes('player')) return '▲';
  if (prefab.entityType.includes('tree')) return '♣';
  if (prefab.entityType.includes('rock')) return '◆';
  if (prefab.entityType.includes('light')) return '✦';
  return '□';
}

function derivePrefabColor(prefab: PrefabDefinition): string {
  const color = prefab.color ?? 0x9aa7b3;
  return `#${color.toString(16).padStart(6, '0')}`;
}

function buildPrefabDescription(prefab: PrefabDefinition): string {
  const parts = [prefab.entityType];
  const runtimeMetadata = prefab.metadata?.runtimeMetadata ?? {};
  if (runtimeMetadata.affinities) {
    const biomeList = Array.isArray(runtimeMetadata.affinities)
      ? runtimeMetadata.affinities.join(', ')
      : String(runtimeMetadata.affinities);
    parts.push(`affinities: ${biomeList}`);
  }
  if (prefab.assetKey) {
    parts.push(`asset ${prefab.assetKey}`);
  }
  if (prefab.pickup) {
    parts.push('pickup');
  }
  return parts.join(' · ');
}

function buildPrefabRenderData(prefab: PrefabDefinition): {
  meshType: string;
  color: number;
  geometry: Record<string, unknown>;
} {
  if (prefab.assetKey) {
    return {
      meshType: 'custom',
      color: prefab.color ?? 0xffffff,
      geometry: { assetKey: prefab.assetKey },
    };
  }
  return {
    meshType: 'box',
    color: prefab.color ?? 0xffffff,
    geometry: { width: 1, height: 1, depth: 1 },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function humanizeId(value: string): string {
  return value
    .split(/[_\-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}