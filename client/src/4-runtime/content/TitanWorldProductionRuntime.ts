import * as THREE from 'three';
import { gameBus, type Entity, type EntityManager, type Vector3 } from '@engine/1-kernel/core/public-api';
import type { EntityRenderer } from '../../1-kernel/core/EntityRenderer';
import type { SerializedSceneEntity } from '../editor/SceneSerializationSystem';
import type { PrefabDefinition, PrefabSystem } from '../../2-systems/gameplay/systems/PrefabSystem';
import type { SpawnSystem } from '../../2-systems/gameplay/systems/SpawnSystem';
import type { MaterialManager } from '../../2-systems/gameplay/systems/MaterialManager';
import type { GameAudioManager } from '../../2-systems/gameplay/systems/GameAudioManager';
import type { PathfindingSystem } from '../../2-systems/gameplay/systems/PathfindingSystem';
import type { SpatialCellBounds } from '../../2-systems/gameplay/systems/SpatialGridSystem';
import {
  WORLD_PRODUCTION_SCHEMA_VERSION,
  buildWorldProductionBundleDependencyGraph,
  computeWorldProductionContentHash,
  createDefaultProductionAuthorityPolicy,
  createEmptyWorldProductionGeneratedState,
  createEmptyWorldProductionReplayJournal,
  createEmptyWorldProductionTransientState,
  createDeterministicRandom,
  createDeterministicSeed,
  pickWeightedEntry,
  type BiomeEncounterDefinition,
  type BiomeRegionDefinition,
  type BiomeSpawnTableEntry,
  type CinematicCueDefinition,
  type CinematicSequenceDefinition,
  type CoopRuntimeDefinition,
  type MaterialLayerDefinition,
  type PrefabEditorMetadata,
  type PrefabRuntimeMetadata,
  type ProductionAuthorityRole,
  type RuntimeAuthoringDefinition,
  type RuntimePrefabVariantDefinition,
  type WorldBounds2D,
  type WorldEventGraphDefinition,
  type WorldEventGraphNodeDefinition,
  type WorldProductionGeneratedState,
  type WorldEventGraphRuntimeState,
  type WorldModManifest,
  type WorldProductionBundle,
  type WorldProductionRuntimeState,
  type WorldProductionSyncPayload,
  type WorldProductionTransientState,
  validateWorldProductionSyncPayload,
} from '@shared/contracts';
import { TitanProductionQueryLayer, type TitanWorldProductionQueries } from './TitanProductionQueryLayer';

export interface TitanEnvironmentController {
  setFogDensity?(density: number): void;
  setFogColor?(color: number): void;
  setFogEnabled?(enabled: boolean): void;
}

export type TitanWorldProductionState = WorldProductionRuntimeState;
export type TitanWorldProductionSnapshot = WorldProductionSyncPayload;

export interface TitanGeneratedChunkData {
  cellId: string;
  bounds: SpatialCellBounds;
  entities: SerializedSceneEntity[];
}

export interface TitanPrefabBatchPatch {
  assetKey?: string;
  color?: number;
  networked?: boolean;
  spawnWeight?: number;
  minSpacing?: number;
  maxDrawDistance?: number;
  tags?: string[];
  appendTags?: string[];
}

export interface TitanAssignChunkOwnersOptions {
  playerIds: string[];
  playerPositions?: Record<string, Vector3>;
  cellIds?: string[];
}

export interface TitanWorldProductionRuntimeConfig {
  prefabSystem: PrefabSystem;
  spawnSystem: SpawnSystem;
  entityManager: EntityManager;
  getFocusPosition: () => Vector3 | null;
  authorityRole?: ProductionAuthorityRole;
  materialManager?: MaterialManager | null;
  audioManager?: GameAudioManager | null;
  pathfindingSystem?: PathfindingSystem | null;
  entityRenderer?: Pick<EntityRenderer, 'getMeshForEntity'> | null;
  environmentController?: TitanEnvironmentController | null;
}

interface ActiveCinematicPlayback {
  sequenceId: string;
  elapsedMs: number;
  firedCueIds: Set<string>;
}

export class TitanWorldProductionRuntime {
  private readonly bundles = new Map<string, WorldProductionBundle>();
  private readonly biomeIndex = new Map<string, BiomeRegionDefinition>();
  private readonly encounterIndex = new Map<string, BiomeEncounterDefinition>();
  private readonly eventGraphIndex = new Map<string, WorldEventGraphDefinition>();
  private readonly cinematicIndex = new Map<string, CinematicSequenceDefinition>();
  private readonly modIndex = new Map<string, WorldModManifest>();
  private readonly materialBindings = new Map<string, MaterialLayerDefinition[]>();
  private readonly activeCinematics = new Map<string, ActiveCinematicPlayback>();
  private readonly queries: TitanProductionQueryLayer;
  private generatedState: WorldProductionGeneratedState = createEmptyGeneratedState();
  private runtimeState: WorldProductionTransientState = createEmptyRuntimeState();
  private runtimeAuthoringOverlay: RuntimeAuthoringDefinition = {};
  private coopRuntimeDefinition: CoopRuntimeDefinition | null = null;
  private animationTime = 0;

  constructor(private readonly config: TitanWorldProductionRuntimeConfig) {
    this.queries = new TitanProductionQueryLayer(() => ({
      authoredBundles: this.getBundles(),
      generatedState: this.generatedState,
      runtimeState: this.runtimeState,
      biomeIndex: this.biomeIndex,
    }));
  }

  update(dt: number): void {
    this.animationTime += dt;
    const biome = this.resolveBiomeAtPosition(this.config.getFocusPosition());
    if (biome && biome.id !== this.runtimeState.activeBiomeId) {
      this.setActiveBiome(biome.id);
    }
    this.updateCinematics(dt * 1000);
    this.updateAnimatedMaterials();
  }

  getState(): TitanWorldProductionState {
    return clonePlain(this.runtimeState);
  }

  getGeneratedState(): WorldProductionGeneratedState {
    return clonePlain(this.generatedState);
  }

  getSnapshot(): TitanWorldProductionSnapshot {
    this.refreshCompatibilityEnvelope();
    return {
      schemaVersion: WORLD_PRODUCTION_SCHEMA_VERSION,
      contentHash: this.generatedState.contentHash,
      deterministicGenerationSeed: this.generatedState.deterministicGenerationSeed,
      bundleDependencyGraph: clonePlain(this.generatedState.bundleDependencyGraph),
      authoritativeEpoch: this.generatedState.authoritativeEpoch,
      reconciliation: {
        mode: this.generatedState.reconciliationMode,
        stages: ['authored', 'generated', 'replicated'],
        allowRollback: true,
      },
      authoredBundles: this.getBundles(),
      generatedState: this.getGeneratedState(),
      runtimeState: this.getState(),
    };
  }

  getQueries(): TitanWorldProductionQueries {
    return this.queries;
  }

  hydrate(state: TitanWorldProductionState | null | undefined): void {
    this.runtimeState = state ? clonePlain(state) : createEmptyRuntimeState();
    this.runtimeState.bundleIds = [...this.generatedState.loadedBundleIds];
    this.runtimeState.modIds = this.listMods();
    if (this.runtimeState.activeBiomeId) {
      this.applyBiomeState(this.runtimeState.activeBiomeId);
    }
    this.applyActiveMaterialLayers();
  }

  hydrateSnapshot(snapshot: TitanWorldProductionSnapshot | null | undefined): { accepted: boolean; reason?: string } {
    if (!snapshot) {
      this.reset();
      return { accepted: true };
    }

    const compatibility = validateWorldProductionSyncPayload(snapshot);
    if (!compatibility.compatible) {
      this.runtimeState.compatibilityError = compatibility.reason ?? 'Unknown production compatibility failure';
      return { accepted: false, reason: this.runtimeState.compatibilityError ?? undefined };
    }

    const rollbackBundles = this.getBundles();
    const rollbackGenerated = this.getGeneratedState();
    const rollbackRuntime = this.getState();
    const rollbackAuthoringOverlay = clonePlain(this.runtimeAuthoringOverlay);
    const rollbackCoopRuntime = clonePlain(this.coopRuntimeDefinition);

    try {
      this.runtimeState.reconciliationStage = 'authoring';
      this.reset();
      for (const bundle of snapshot.authoredBundles) {
        this.registerBundle(bundle);
      }

      this.runtimeState.reconciliationStage = 'generated';
      this.generatedState = clonePlain(snapshot.generatedState);
      this.generatedState.loadedBundleIds = [...this.generatedState.loadedBundleIds].sort();

      this.runtimeState.reconciliationStage = 'runtime';
      this.runtimeState = snapshot.runtimeState ? clonePlain(snapshot.runtimeState) : createEmptyRuntimeState();
      this.runtimeState.bundleIds = [...this.generatedState.loadedBundleIds];
      this.runtimeState.modIds = this.listMods();
      this.runtimeState.lastAppliedEpoch = snapshot.authoritativeEpoch;
      this.runtimeState.reconciliationStage = 'idle';
      this.runtimeState.compatibilityError = null;
      if (this.runtimeState.activeBiomeId) {
        this.applyBiomeState(this.runtimeState.activeBiomeId);
      }
      this.applyActiveMaterialLayers();
      return { accepted: true };
    } catch (error) {
      this.runtimeState.reconciliationStage = 'rollback';
      this.reset();
      for (const bundle of rollbackBundles) {
        this.registerBundle(bundle);
      }
      this.generatedState = rollbackGenerated;
      this.runtimeState = rollbackRuntime;
      this.runtimeAuthoringOverlay = rollbackAuthoringOverlay;
      this.coopRuntimeDefinition = rollbackCoopRuntime;
      this.runtimeState.compatibilityError = error instanceof Error ? error.message : 'Unknown rollback failure';
      this.runtimeState.reconciliationStage = 'idle';
      return { accepted: false, reason: this.runtimeState.compatibilityError ?? undefined };
    }
  }

  reset(): void {
    this.bundles.clear();
    this.biomeIndex.clear();
    this.encounterIndex.clear();
    this.eventGraphIndex.clear();
    this.cinematicIndex.clear();
    this.modIndex.clear();
    this.materialBindings.clear();
    this.activeCinematics.clear();
    this.generatedState = createEmptyGeneratedState();
    this.runtimeState = createEmptyRuntimeState();
    this.runtimeAuthoringOverlay = {};
    this.coopRuntimeDefinition = null;
    this.animationTime = 0;
  }

  replaceSync(snapshot: TitanWorldProductionSnapshot | null | undefined): { accepted: boolean; reason?: string } {
    return this.hydrateSnapshot(snapshot);
  }

  getDebugMetrics(): Record<string, unknown> {
    return {
      bundleCount: this.bundles.size,
      biomeCount: this.biomeIndex.size,
      encounterCount: this.encounterIndex.size,
      graphCount: this.eventGraphIndex.size,
      cinematicCount: this.cinematicIndex.size,
      modCount: this.modIndex.size,
      activeBiomeId: this.runtimeState.activeBiomeId,
      activeQuestGraphs: Object.values(this.generatedState.graphStates).filter((graph) => graph.status === 'running').length,
      activeCinematics: this.activeCinematics.size,
      taggedAssets: Object.keys(this.runtimeAuthoringOverlay.assetTags ?? {}).length,
      authoritativeEpoch: this.generatedState.authoritativeEpoch,
      productionHash: this.generatedState.contentHash,
    };
  }

  registerBundle(bundle: WorldProductionBundle): void {
    const next = clonePlain(bundle);
    this.bundles.set(next.id, next);
    if (!this.generatedState.loadedBundleIds.includes(next.id)) {
      this.generatedState.loadedBundleIds.push(next.id);
      this.generatedState.loadedBundleIds.sort();
    }

    for (const biome of next.biomeRegions ?? []) {
      this.biomeIndex.set(biome.id, clonePlain(biome));
      for (const encounter of biome.encounters ?? []) {
        this.encounterIndex.set(encounter.id, clonePlain(encounter));
      }
    }
    for (const graph of next.eventGraphs ?? []) {
      this.eventGraphIndex.set(graph.id, clonePlain(graph));
    }
    for (const sequence of next.cinematicSequences ?? []) {
      this.cinematicIndex.set(sequence.id, clonePlain(sequence));
    }
    for (const manifest of next.mods ?? []) {
      this.registerMod(manifest);
    }
    this.coopRuntimeDefinition = next.coopRuntime ? clonePlain(next.coopRuntime) : this.coopRuntimeDefinition;
    if (next.authoring) {
      for (const variant of next.authoring.prefabVariants ?? []) {
        this.registerPrefabVariant(variant);
      }
    }
    for (const track of next.audioTracks ?? []) {
      this.config.audioManager?.registerTrack?.(track as Parameters<GameAudioManager['registerTrack']>[0]);
    }
    for (const trigger of next.audioTriggers ?? []) {
      this.config.audioManager?.registerTrigger?.(trigger as Parameters<GameAudioManager['registerTrigger']>[0]);
    }

    if (!this.runtimeState.activeBiomeId) {
      const firstBiome = next.biomeRegions?.[0];
      if (firstBiome) {
        this.setActiveBiome(firstBiome.id);
      }
    }

    this.runtimeState.bundleIds = [...this.generatedState.loadedBundleIds];
    this.refreshCompatibilityEnvelope();
    this.markLifecyclePhase(next.id, 'authored');

    gameBus.emit('stateMutation', {
      source: 'titanWorldProductionRuntime',
      path: `content.production.bundles.${next.id}`,
      changedCount: 1,
    });
  }

  getBundle(bundleId: string): WorldProductionBundle | null {
    const bundle = this.bundles.get(bundleId);
    return bundle ? clonePlain(bundle) : null;
  }

  getBundles(): WorldProductionBundle[] {
    return [...this.bundles.values()].map((bundle) => clonePlain(bundle));
  }

  listBundles(): string[] {
    return [...this.bundles.keys()].sort();
  }

  unloadBundle(bundleId: string): { success: boolean; reason?: string } {
    const dependents = this.generatedState.bundleDependencyGraph
      .filter((entry) => entry.dependsOn.includes(bundleId) && this.generatedState.loadedBundleIds.includes(entry.bundleId))
      .map((entry) => entry.bundleId);
    if (dependents.length > 0) {
      return {
        success: false,
        reason: `Bundle '${bundleId}' is still required by ${dependents.join(', ')}`,
      };
    }

    this.bundles.delete(bundleId);
    this.generatedState.loadedBundleIds = this.generatedState.loadedBundleIds.filter((loadedBundleId) => loadedBundleId !== bundleId);
    this.runtimeState.bundleIds = [...this.generatedState.loadedBundleIds];
    this.markLifecyclePhase(`bundle:${bundleId}`, 'unloaded');
    this.refreshCompatibilityEnvelope();
    return { success: true };
  }

  getReplayJournal() {
    return clonePlain(this.generatedState.replayJournal);
  }

  registerMod(manifest: WorldModManifest): void {
    const next = clonePlain(manifest);
    this.modIndex.set(next.id, next);
    if (!this.runtimeState.modIds.includes(next.id)) {
      this.runtimeState.modIds.push(next.id);
      this.runtimeState.modIds.sort();
    }
  }

  listMods(): string[] {
    return [...this.modIndex.keys()].sort();
  }

  resolveBiomeAtPosition(position: Vector3 | null): BiomeRegionDefinition | null {
    return this.queries.resolveBiomeAtPosition(position);
  }

  setActiveBiome(biomeId: string | null): boolean {
    if (biomeId === this.runtimeState.activeBiomeId) {
      return false;
    }
    this.runtimeState.activeBiomeId = biomeId;
    if (biomeId) {
      this.markLifecyclePhase(`biome:${biomeId}`, 'simulated');
    }
    if (biomeId) {
      this.applyBiomeState(biomeId);
    }
    this.applyActiveMaterialLayers();
    gameBus.emit('stateMutation', {
      source: 'titanWorldProductionRuntime',
      path: 'content.production.activeBiomeId',
      changedCount: 1,
    });
    return true;
  }

  startEventGraph(graphId: string): WorldEventGraphRuntimeState | null {
    if (!this.canMutateAuthoritativeState()) {
      return null;
    }
    const graph = this.eventGraphIndex.get(graphId);
    if (!graph) {
      return null;
    }

    const state: WorldEventGraphRuntimeState = {
      graphId,
      status: 'running',
      activeNodeIds: [graph.entryNodeId],
      completedNodeIds: [],
      values: this.generatedState.graphStates[graphId]?.values ?? {},
      lastEventId: null,
      updatedAt: Date.now(),
    };

    this.generatedState.graphStates[graphId] = state;
    this.generatedState.authoritativeEpoch += 1;
    this.processGraphNode(graph, graph.entryNodeId, state, undefined);
    this.appendGraphTransition(graphId, null, graph.entryNodeId, 'graph_start');
    this.recordGeneratedDiff(`graphs.${graphId}`, state);
    this.refreshCompatibilityEnvelope();
    this.markLifecyclePhase(`graph:${graphId}`, 'simulated');
    return clonePlain(this.generatedState.graphStates[graphId]);
  }

  triggerEvent(eventId: string, payload?: Record<string, unknown>): WorldEventGraphRuntimeState[] {
    if (!this.canMutateAuthoritativeState()) {
      return [];
    }
    const changed: WorldEventGraphRuntimeState[] = [];
    for (const graph of this.eventGraphIndex.values()) {
      const runtimeState = this.generatedState.graphStates[graph.id];
      if (!runtimeState || runtimeState.status !== 'running') {
        continue;
      }

      for (const nodeId of [...runtimeState.activeNodeIds]) {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) {
          continue;
        }
        const matches = node.eventId === eventId
          || node.id === eventId
          || node.metadata?.completeEventId === eventId;
        if (!matches) {
          continue;
        }
        this.completeGraphNode(graph, node, runtimeState, payload);
        runtimeState.lastEventId = eventId;
        runtimeState.updatedAt = Date.now();
        this.appendGraphTransition(graph.id, node.id, runtimeState.activeNodeIds[0] ?? null, eventId);
        this.recordGeneratedDiff(`graphs.${graph.id}`, runtimeState);
        changed.push(clonePlain(runtimeState));
      }
    }
    if (changed.length > 0) {
      this.generatedState.authoritativeEpoch += 1;
      this.refreshCompatibilityEnvelope();
    }
    return changed;
  }

  playCinematic(sequenceId: string): boolean {
    const sequence = this.cinematicIndex.get(sequenceId);
    if (!sequence) {
      return false;
    }

    this.runtimeState.activeSequenceId = sequenceId;
    this.runtimeState.predictedSequenceIds = mergeUniqueStrings(this.runtimeState.predictedSequenceIds, [sequenceId]) ?? [sequenceId];
    this.markLifecyclePhase(`cinematic:${sequenceId}`, 'replicated');
    this.activeCinematics.set(sequenceId, {
      sequenceId,
      elapsedMs: 0,
      firedCueIds: new Set<string>(),
    });
    gameBus.emit('stateMutation', {
      source: 'titanWorldProductionRuntime',
      path: `content.production.cinematics.${sequenceId}`,
      changedCount: 1,
    });
    return true;
  }

  assignChunkOwners(options: TitanAssignChunkOwnersOptions): Record<string, string> {
    if (!this.canMutateAuthoritativeState()) {
      return {};
    }
    const playerIds = [...options.playerIds].sort();
    if (playerIds.length === 0) {
      return { ...this.generatedState.chunkOwnership };
    }

    const policy = this.coopRuntimeDefinition?.chunkOwnerPolicy ?? 'host';
    const cellIds = options.cellIds ?? Object.keys(this.generatedState.chunkOwnership);
    const nextAssignments: Record<string, string> = {};
    const now = Date.now();

    cellIds.forEach((cellId, index) => {
      nextAssignments[cellId] = resolveChunkOwner(policy, cellId, index, playerIds, options.playerPositions);
      this.generatedState.generatedChunks[cellId] = {
        cellId,
        seed: this.resolveChunkSeed(cellId),
        ownerId: nextAssignments[cellId],
        phase: 'replicated',
        operationCount: (this.generatedState.generatedChunks[cellId]?.operationCount ?? 0) + 1,
        mutationHash: computeWorldProductionContentHash({ cellId, ownerId: nextAssignments[cellId], epoch: this.generatedState.authoritativeEpoch + 1 }),
        updatedAt: now,
      };
      this.appendChunkMutation(cellId, nextAssignments[cellId], 'assign_owner', this.generatedState.generatedChunks[cellId].mutationHash, now);
      this.markLifecyclePhase(`chunk:${cellId}`, 'replicated');
    });

    this.generatedState.chunkOwnership = {
      ...this.generatedState.chunkOwnership,
      ...nextAssignments,
    };
    this.generatedState.authoritativeEpoch += 1;
    this.recordGeneratedDiff('chunkOwnership', this.generatedState.chunkOwnership);
    this.refreshCompatibilityEnvelope();

    return { ...nextAssignments };
  }

  applyPersistentBiomeMutation(biomeId: string, mutation: Record<string, unknown>): boolean {
    if (!this.canMutateAuthoritativeState() || !this.biomeIndex.has(biomeId)) {
      return false;
    }
    this.generatedState.persistentBiomeMutations[biomeId] = {
      ...(this.generatedState.persistentBiomeMutations[biomeId] ?? {}),
      ...clonePlain(mutation),
    };
    this.generatedState.authoritativeEpoch += 1;
    this.recordGeneratedDiff(`biomeMutations.${biomeId}`, this.generatedState.persistentBiomeMutations[biomeId]);
    this.refreshCompatibilityEnvelope();
    this.markLifecyclePhase(`biome:${biomeId}`, 'persisted');
    return true;
  }

  buildProceduralChunk(bundleId: string, cellId: string, bounds: SpatialCellBounds): TitanGeneratedChunkData | null {
    const bundle = this.bundles.get(bundleId);
    const procedural = bundle?.proceduralWorld;
    if (!bundle || !procedural) {
      return null;
    }

    const override = procedural.chunkOverrides?.find((entry) => entry.cellId === cellId) ?? null;
    const biome = (override?.biomeId ? this.biomeIndex.get(override.biomeId) : null)
      ?? this.resolveBiomeAtPosition(getBoundsCenter(bounds))
      ?? (procedural.defaultBiomeId ? this.biomeIndex.get(procedural.defaultBiomeId) ?? null : null);

    const spawnEntries = [
      ...(biome?.spawnTable ?? []),
      ...(override?.spawnTable ?? []),
    ];
    if (spawnEntries.length === 0) {
      return {
        cellId,
        bounds: { ...bounds },
        entities: [],
      };
    }

    const seed = override?.seed ?? createDeterministicSeed(procedural.baseSeed, `${bundleId}:${cellId}`);
    const random = createDeterministicRandom(seed);
    const targetEntries = Math.max(1, Math.round(12 * (procedural.spawnDensity ?? 0.25) * (override?.densityScale ?? 1)));
    const entities: SerializedSceneEntity[] = [];

    if (!this.generatedState.replayJournal.generationSeeds.some((entry) => entry.scope === `${bundleId}:${cellId}`)) {
      this.generatedState.replayJournal.generationSeeds.push({ scope: `${bundleId}:${cellId}`, seed });
    }

    for (let index = 0; index < targetEntries; index += 1) {
      const entry = pickWeightedEntry(spawnEntries, random);
      if (!entry?.prefabId) {
        continue;
      }
      const count = randomInt(entry.minCount ?? 1, entry.maxCount ?? entry.minCount ?? 1, random);
      for (let countIndex = 0; countIndex < count; countIndex += 1) {
        entities.push(createProceduralPrefabEntity(cellId, index, countIndex, entry, bounds, random));
      }
    }

    if (override?.blockedAreas?.length) {
      this.config.pathfindingSystem?.rebuildNavMesh();
    }

    const now = Date.now();
    const ownerId = this.generatedState.chunkOwnership[cellId] ?? 'unassigned';
    this.generatedState.generatedChunks[cellId] = {
      cellId,
      seed,
      ownerId,
      phase: this.canMutateAuthoritativeState() ? 'generated' : 'replicated',
      operationCount: entities.length,
      mutationHash: computeWorldProductionContentHash({ cellId, seed, entityIds: entities.map((entity) => entity.sourceEntityId ?? '') }),
      updatedAt: now,
    };
    this.markLifecyclePhase(`chunk:${cellId}`, this.canMutateAuthoritativeState() ? 'generated' : 'replicated');

    return {
      cellId,
      bounds: { ...bounds },
      entities: entities.sort(compareSerializedEntities),
    };
  }

  registerPrefabVariant(variant: RuntimePrefabVariantDefinition): PrefabDefinition | null {
    const basePrefab = this.config.prefabSystem.getPrefab(variant.basePrefabId);
    if (!basePrefab) {
      return null;
    }

    const migratedMetadata = migrateLegacyVariantMetadata(variant.metadata ?? {});
    const structuralConflicts: string[] = [];
    if (variant.entityType && variant.entityType !== basePrefab.entityType) {
      structuralConflicts.push('entityType');
    }
    if (variant.assetKey && variant.assetKey !== basePrefab.assetKey) {
      structuralConflicts.push('assetKey');
    }
    if (variant.networked !== undefined && variant.networked !== basePrefab.networked) {
      structuralConflicts.push('networked');
    }
    if (structuralConflicts.length > 0) {
      console.warn('[TitanWorldProductionRuntime] Variant registration rejected due to structural conflicts', {
        variantId: variant.id,
        conflicts: structuralConflicts,
      });
      return null;
    }

    const nextPrefab: PrefabDefinition = {
      ...basePrefab,
      name: variant.id,
      entityType: variant.entityType ?? basePrefab.entityType,
      assetKey: variant.assetKey ?? basePrefab.assetKey,
      color: variant.color ?? basePrefab.color,
      networked: variant.networked ?? basePrefab.networked,
      spawnWeight: variant.spawnWeight ?? basePrefab.spawnWeight,
      minSpacing: variant.minSpacing ?? basePrefab.minSpacing,
      maxDrawDistance: variant.maxDrawDistance ?? basePrefab.maxDrawDistance,
      tags: normalizeTags(mergeUniqueStrings(basePrefab.tags, variant.tags)),
      metadata: {
        runtimeMetadata: mergeRuntimeMetadata(basePrefab.metadata?.runtimeMetadata, migratedMetadata.runtimeMetadata),
        editorMetadata: mergeEditorMetadata(basePrefab.metadata?.editorMetadata, migratedMetadata.editorMetadata),
      },
      components: mergePrefabComponents(basePrefab.components, variant.components),
    };
    nextPrefab.contentHash = computePrefabHash(nextPrefab);

    this.config.prefabSystem.registerPrefab(variant.id, nextPrefab);
    this.runtimeAuthoringOverlay.prefabVariants = mergePrefabVariants(this.runtimeAuthoringOverlay.prefabVariants, [variant]);
    return this.config.prefabSystem.getPrefab(variant.id) ?? nextPrefab;
  }

  batchUpdatePrefabs(prefabIds: string[], patch: TitanPrefabBatchPatch): number {
    let updated = 0;
    for (const prefabId of prefabIds) {
      const prefab = this.config.prefabSystem.getPrefab(prefabId);
      if (!prefab) {
        continue;
      }

      const nextPrefab: PrefabDefinition = {
        ...prefab,
        assetKey: patch.assetKey ?? prefab.assetKey,
        color: patch.color ?? prefab.color,
        networked: patch.networked ?? prefab.networked,
        spawnWeight: patch.spawnWeight ?? prefab.spawnWeight,
        minSpacing: patch.minSpacing ?? prefab.minSpacing,
        maxDrawDistance: patch.maxDrawDistance ?? prefab.maxDrawDistance,
        tags: mergeUniqueStrings(patch.tags ?? prefab.tags, patch.appendTags),
      };
      this.config.prefabSystem.registerPrefab(prefabId, nextPrefab);
      updated += 1;
    }
    if (updated > 0) {
      this.recordGeneratedDiff('prefabOverlays', { prefabIds, patch });
    }
    return updated;
  }

  tagAssets(assetIds: string[], tags: string[]): number {
    if (assetIds.length === 0 || tags.length === 0) {
      return 0;
    }

    const nextAuthoring = mergeAuthoring(this.runtimeAuthoringOverlay, { assetTags: {} });
    for (const assetId of assetIds) {
      nextAuthoring.assetTags = nextAuthoring.assetTags ?? {};
      nextAuthoring.assetTags[assetId] = mergeUniqueStrings(nextAuthoring.assetTags[assetId], tags) ?? [];
    }
    this.runtimeAuthoringOverlay = nextAuthoring;
    return assetIds.length;
  }

  applyActiveMaterialLayers(): void {
    this.materialBindings.clear();
    const entityRenderer = this.config.entityRenderer;
    const materialManager = this.config.materialManager;
    if (!entityRenderer || !materialManager) {
      return;
    }

    const activeBiomeId = this.runtimeState.activeBiomeId;
    const layers = this.queries.getMaterialLayers(activeBiomeId);
    if (layers.length === 0) {
      return;
    }

    for (const entity of this.config.entityManager.getEntities()) {
      const mesh = entityRenderer.getMeshForEntity(entity.id);
      if (!mesh) {
        continue;
      }
      const matchingLayers = layers.filter((layer) => matchesMaterialLayer(entity, layer));
      if (matchingLayers.length === 0) {
        continue;
      }
      for (const layer of matchingLayers) {
        applyMaterialLayer(mesh, layer, materialManager);
      }
      this.materialBindings.set(entity.id, matchingLayers);
    }
  }

  private applyBiomeState(biomeId: string): void {
    const biome = this.biomeIndex.get(biomeId);
    if (!biome) {
      return;
    }

    const atmosphere = biome.atmosphere ?? {};
    if (atmosphere.fogDensity !== undefined || atmosphere.fogColor !== undefined) {
      this.config.environmentController?.setFogEnabled?.(true);
    }
    if (atmosphere.fogDensity !== undefined) {
      this.config.environmentController?.setFogDensity?.(atmosphere.fogDensity);
    }
    if (atmosphere.fogColor !== undefined) {
      this.config.environmentController?.setFogColor?.(atmosphere.fogColor);
    }
    if (atmosphere.ambientTrackId) {
      this.config.audioManager?.playMusic(atmosphere.ambientTrackId);
    }
    if (atmosphere.ambientTriggerId) {
      const focus = this.config.getFocusPosition() ?? undefined;
      this.config.audioManager?.playTrigger(atmosphere.ambientTriggerId, focus);
    }
    if (biome.metadata?.rebuildNavMesh === true) {
      this.config.pathfindingSystem?.rebuildNavMesh();
    }
  }

  private processGraphNode(
    graph: WorldEventGraphDefinition,
    nodeId: string,
    runtimeState: WorldEventGraphRuntimeState,
    payload?: Record<string, unknown>,
  ): void {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      return;
    }

    runtimeState.activeNodeIds = [node.id];
    runtimeState.updatedAt = Date.now();
    this.markLifecyclePhase(`graph:${graph.id}`, 'simulated');
    gameBus.emit('stateMutation', {
      source: 'titanWorldProductionRuntime',
      path: `content.production.graphs.${graph.id}.activeNode`,
      changedCount: 1,
    });

    switch (node.kind) {
      case 'dialogue_hook':
        runtimeState.values[`dialogue:${node.id}`] = payload ?? node.metadata ?? {};
        if (node.autoAdvance !== false) {
          this.completeGraphNode(graph, node, runtimeState, payload);
        }
        break;
      case 'cinematic_trigger':
        if (node.cinematicSequenceId) {
          this.playCinematic(node.cinematicSequenceId);
        }
        if (node.autoAdvance !== false) {
          this.completeGraphNode(graph, node, runtimeState, payload);
        }
        break;
      case 'wave_event':
      case 'boss_encounter':
      case 'extraction_event':
        if (node.encounterId) {
          this.activateEncounter(node.encounterId);
        }
        if (node.autoAdvance !== false) {
          this.completeGraphNode(graph, node, runtimeState, payload);
        }
        break;
      case 'state_gate':
        if (!node.stateKey || this.generatedState.values[node.stateKey] === node.expectedValue) {
          this.completeGraphNode(graph, node, runtimeState, payload);
        }
        break;
      case 'complete':
        runtimeState.status = 'completed';
        runtimeState.activeNodeIds = [];
        break;
      default:
        break;
    }
  }

  private completeGraphNode(
    graph: WorldEventGraphDefinition,
    node: WorldEventGraphNodeDefinition,
    runtimeState: WorldEventGraphRuntimeState,
    payload?: Record<string, unknown>,
  ): void {
    if (!runtimeState.completedNodeIds.includes(node.id)) {
      runtimeState.completedNodeIds.push(node.id);
    }
    if (node.stateKey) {
      runtimeState.values[node.stateKey] = payload?.value ?? true;
      this.generatedState.values[node.stateKey] = payload?.value ?? true;
    }

    const nextNodeId = node.nextNodeIds?.[0];
    if (!nextNodeId) {
      runtimeState.status = 'completed';
      runtimeState.activeNodeIds = [];
      runtimeState.updatedAt = Date.now();
      return;
    }

    this.processGraphNode(graph, nextNodeId, runtimeState, payload);
  }

  private activateEncounter(encounterId: string): void {
    const encounter = this.encounterIndex.get(encounterId);
    if (!encounter) {
      return;
    }

    const anchor = this.config.getFocusPosition() ?? { x: 0, y: 0, z: 0 };
    if (encounter.musicTrackId) {
      this.config.audioManager?.playMusic(encounter.musicTrackId);
    }
    if (encounter.triggerId) {
      this.config.audioManager?.playTrigger(encounter.triggerId, anchor);
    }
    if (encounter.cinematicSequenceId) {
      this.playCinematic(encounter.cinematicSequenceId);
    }

    const seed = this.resolveChunkSeed(`encounter:${encounter.id}`);
    const random = createDeterministicRandom(seed);
    for (const spawnEntry of encounter.spawnEntries) {
      const count = randomInt(spawnEntry.minCount ?? 1, spawnEntry.maxCount ?? spawnEntry.minCount ?? 1, random);
      for (let index = 0; index < count; index += 1) {
        const position = jitterAround(anchor, spawnEntry.minSpacing ?? 2, spawnEntry.maxSpacing ?? 7, random);
        if (spawnEntry.prefabId) {
          this.config.spawnSystem.spawnPrefab(spawnEntry.prefabId, { position });
          continue;
        }
        if (spawnEntry.enemyType) {
          this.config.spawnSystem.spawnEnemy({
            position,
            enemyType: spawnEntry.enemyType,
            variantId: spawnEntry.enemyVariantId as any,
          });
        }
      }
    }

    this.runtimeState.lastEncounterId = encounter.id;
    this.generatedState.encounterStates[encounter.id] = {
      encounterId: encounter.id,
      status: 'active',
      resolvedBy: null,
      updatedAt: Date.now(),
    };
    this.recordGeneratedDiff(`encounters.${encounter.id}`, this.generatedState.encounterStates[encounter.id]);
    gameBus.emit('stateMutation', {
      source: 'titanWorldProductionRuntime',
      path: `content.production.encounters.${encounter.id}`,
      changedCount: 1,
    });
  }

  resolveEncounter(encounterId: string, resolvedBy: string): boolean {
    if (!this.canMutateAuthoritativeState()) {
      return false;
    }
    const encounter = this.generatedState.encounterStates[encounterId];
    if (!encounter) {
      return false;
    }
    encounter.status = 'resolved';
    encounter.resolvedBy = resolvedBy;
    encounter.updatedAt = Date.now();
    this.generatedState.authoritativeEpoch += 1;
    this.recordGeneratedDiff(`encounters.${encounterId}`, encounter);
    this.refreshCompatibilityEnvelope();
    this.markLifecyclePhase(`encounter:${encounterId}`, 'persisted');
    return true;
  }

  private updateCinematics(dtMs: number): void {
    for (const playback of [...this.activeCinematics.values()]) {
      const sequence = this.cinematicIndex.get(playback.sequenceId);
      if (!sequence) {
        this.activeCinematics.delete(playback.sequenceId);
        continue;
      }

      playback.elapsedMs += dtMs;
      for (const cue of sequence.cues) {
        if (playback.firedCueIds.has(cue.id) || cue.atMs > playback.elapsedMs) {
          continue;
        }
        this.fireCinematicCue(cue);
        playback.firedCueIds.add(cue.id);
      }

      if (playback.elapsedMs < sequence.durationMs) {
        continue;
      }

      this.activeCinematics.delete(playback.sequenceId);
      if (this.runtimeState.activeSequenceId === playback.sequenceId) {
        this.runtimeState.activeSequenceId = null;
      }
      gameBus.emit('stateMutation', {
        source: 'titanWorldProductionRuntime',
        path: `content.production.cinematics.${playback.sequenceId}.completed`,
        changedCount: 1,
      });
    }
  }

  private fireCinematicCue(cue: CinematicCueDefinition): void {
    switch (cue.action) {
      case 'play_music':
        if (cue.trackId) {
          this.config.audioManager?.playMusic(cue.trackId);
        }
        break;
      case 'play_trigger':
        if (cue.triggerId) {
          this.config.audioManager?.playTrigger(cue.triggerId, cue.position);
        }
        break;
      case 'emit_event':
        if (cue.eventId) {
          gameBus.emit(cue.eventId as never, (cue.payload ?? {}) as never);
        }
        break;
      case 'set_fog':
        if (cue.fogDensity !== undefined || cue.fogColor !== undefined) {
          this.config.environmentController?.setFogEnabled?.(true);
        }
        if (cue.fogDensity !== undefined) {
          this.config.environmentController?.setFogDensity?.(cue.fogDensity);
        }
        if (cue.fogColor !== undefined) {
          this.config.environmentController?.setFogColor?.(cue.fogColor);
        }
        break;
      case 'set_biome':
        if (cue.biomeId) {
          this.setActiveBiome(cue.biomeId);
        }
        break;
      case 'spawn_prefab': {
        if (!cue.prefabId) {
          break;
        }
        const position = cue.position ?? this.config.getFocusPosition() ?? { x: 0, y: 0, z: 0 };
        this.config.spawnSystem.spawnPrefab(cue.prefabId, { position });
        break;
      }
      case 'set_state':
        if (cue.stateKey && this.canMutateAuthoritativeState()) {
          this.generatedState.values[cue.stateKey] = cue.value ?? true;
          this.recordGeneratedDiff(`values.${cue.stateKey}`, this.generatedState.values[cue.stateKey]);
          this.refreshCompatibilityEnvelope();
        }
        break;
      case 'start_graph':
        if (cue.graphId && this.canMutateAuthoritativeState()) {
          this.startEventGraph(cue.graphId);
        }
        break;
      default:
        break;
    }
  }

  private updateAnimatedMaterials(): void {
    if (!this.config.entityRenderer || this.materialBindings.size === 0) {
      return;
    }

    for (const [entityId, layers] of this.materialBindings.entries()) {
      const mesh = this.config.entityRenderer.getMeshForEntity(entityId);
      if (!mesh) {
        this.materialBindings.delete(entityId);
        continue;
      }
      for (const layer of layers) {
        animateMaterialLayer(mesh, layer, this.animationTime);
      }
    }
  }

  private getApplicableMaterialLayers(activeBiomeId: string | null): MaterialLayerDefinition[] {
    return this.queries.getMaterialLayers(activeBiomeId);
  }

  private canMutateAuthoritativeState(): boolean {
    return (this.config.authorityRole ?? 'client-presentation') === 'server';
  }

  private resolveChunkSeed(scopeId: string): number {
    return createDeterministicSeed(this.generatedState.deterministicGenerationSeed || Date.now(), scopeId);
  }

  private appendGraphTransition(
    graphId: string,
    fromNodeId: string | null,
    toNodeId: string | null,
    eventId?: string | null,
  ): void {
    this.generatedState.replayJournal.graphTransitions.push({
      graphId,
      fromNodeId,
      toNodeId,
      eventId: eventId ?? null,
      timestamp: Date.now(),
    });
  }

  private appendChunkMutation(
    cellId: string,
    ownerId: string,
    operation: string,
    mutationHash: string,
    timestamp: number,
  ): void {
    this.generatedState.replayJournal.chunkMutations.push({
      cellId,
      ownerId,
      operation,
      mutationHash,
      timestamp,
    });
  }

  private recordGeneratedDiff(path: string, value: unknown): void {
    this.generatedState.replayJournal.productionStateDiffs.push({
      id: `${path}:${this.generatedState.replayJournal.productionStateDiffs.length + 1}`,
      path,
      valueHash: computeWorldProductionContentHash(value),
      appliedAt: Date.now(),
    });
  }

  private markLifecyclePhase(scopeId: string, phase: 'authored' | 'generated' | 'replicated' | 'simulated' | 'persisted' | 'unloaded'): void {
    this.runtimeState.lifecyclePhases = this.runtimeState.lifecyclePhases ?? {};
    this.runtimeState.lifecyclePhases[scopeId] = phase;
  }

  private refreshCompatibilityEnvelope(): void {
    const dependencyGraph = buildWorldProductionBundleDependencyGraph(this.getBundles());
    const deterministicGenerationSeed = this.resolveDeterministicGenerationSeed();
    this.generatedState.schemaVersion = WORLD_PRODUCTION_SCHEMA_VERSION;
    this.generatedState.bundleDependencyGraph = dependencyGraph;
    this.generatedState.deterministicGenerationSeed = deterministicGenerationSeed;
    this.generatedState.contentHash = computeWorldProductionContentHash({
      authoredBundles: this.getBundles(),
      deterministicGenerationSeed,
      bundleDependencyGraph: dependencyGraph,
      generatedState: {
        ...this.generatedState,
        schemaVersion: undefined,
        contentHash: undefined,
        bundleDependencyGraph: undefined,
      },
    });
  }

  private resolveDeterministicGenerationSeed(): number {
    const proceduralSeeds = this.getBundles()
      .map((bundle) => bundle.proceduralWorld?.baseSeed)
      .filter((seed): seed is number => typeof seed === 'number');
    if (proceduralSeeds.length === 0) {
      return this.generatedState.deterministicGenerationSeed || 0;
    }
    return proceduralSeeds.reduce((seed, nextSeed, index) => createDeterministicSeed(seed + index, `${nextSeed}`), 0);
  }
}

function createEmptyProductionState(): TitanWorldProductionState {
  return createEmptyRuntimeState();
}

function createEmptyGeneratedState(): WorldProductionGeneratedState {
  return {
    ...createEmptyWorldProductionGeneratedState(),
    authorityRole: 'server',
    authorityPolicy: createDefaultProductionAuthorityPolicy(),
    replayJournal: createEmptyWorldProductionReplayJournal(),
  };
}

function createEmptyRuntimeState(): WorldProductionTransientState {
  return createEmptyWorldProductionTransientState();
}

function mergeAuthoring(
  current: RuntimeAuthoringDefinition | null,
  next: RuntimeAuthoringDefinition,
): RuntimeAuthoringDefinition {
  const merged: RuntimeAuthoringDefinition = {
    ...(current ?? {}),
    ...clonePlain(next),
    liveEditableChunkIds: mergeUniqueStrings(current?.liveEditableChunkIds, next.liveEditableChunkIds),
    prefabVariants: mergePrefabVariants(current?.prefabVariants, next.prefabVariants),
    batchProfiles: mergeBatchProfiles(current?.batchProfiles, next.batchProfiles),
    assetTags: { ...(current?.assetTags ?? {}), ...(next.assetTags ?? {}) },
  };
  return merged;
}

function mergePrefabVariants(
  current: RuntimeAuthoringDefinition['prefabVariants'],
  next: RuntimeAuthoringDefinition['prefabVariants'],
): RuntimeAuthoringDefinition['prefabVariants'] {
  const variants = new Map<string, RuntimePrefabVariantDefinition>();
  for (const variant of current ?? []) {
    variants.set(variant.id, clonePlain(variant));
  }
  for (const variant of next ?? []) {
    variants.set(variant.id, clonePlain(variant));
  }
  return [...variants.values()];
}

function mergeBatchProfiles(
  current: RuntimeAuthoringDefinition['batchProfiles'],
  next: RuntimeAuthoringDefinition['batchProfiles'],
): RuntimeAuthoringDefinition['batchProfiles'] {
  const profiles = new Map<string, NonNullable<RuntimeAuthoringDefinition['batchProfiles']>[number]>();
  for (const profile of current ?? []) {
    profiles.set(profile.id, clonePlain(profile));
  }
  for (const profile of next ?? []) {
    profiles.set(profile.id, clonePlain(profile));
  }
  return [...profiles.values()];
}

function matchesMaterialLayer(entity: Entity, layer: MaterialLayerDefinition): boolean {
  if (layer.entityTypes?.length && !layer.entityTypes.includes(entity.type)) {
    return false;
  }
  const prefabName = resolveEntityPrefabName(entity);
  if (layer.prefabIds?.length && (!prefabName || !layer.prefabIds.includes(prefabName))) {
    return false;
  }
  if (layer.tags?.length) {
    const tags = resolveEntityTags(entity, prefabName);
    return layer.tags.some((tag) => tags.has(tag));
  }
  return true;
}

function resolveEntityPrefabName(entity: Entity): string | null {
  const prefabData = entity.getComponent('prefab')?.data as { prefabName?: string } | undefined;
  return typeof prefabData?.prefabName === 'string' ? prefabData.prefabName : null;
}

function resolveEntityTags(entity: Entity, prefabName: string | null): Set<string> {
  const tags = new Set<string>();
  const entityTags = entity.getComponent('tags')?.data as { values?: unknown } | undefined;
  const rawValues = entityTags?.values;
  const values: unknown[] = Array.isArray(rawValues) ? rawValues : [];
  for (const tag of values) {
    if (typeof tag === 'string') {
      tags.add(tag);
    }
  }
  const prefabTags = entity.getComponent('prefab')?.data?.tags as string[] | undefined;
  if (Array.isArray(prefabTags)) {
    for (const tag of prefabTags) {
      if (typeof tag === 'string') {
        tags.add(tag);
      }
    }
  }
  if (prefabName) {
    tags.add(prefabName);
  }
  tags.add(entity.type);
  return tags;
}

function applyMaterialLayer(mesh: THREE.Object3D, layer: MaterialLayerDefinition, materialManager: MaterialManager): void {
  if (layer.profileId) {
    materialManager.applyProfile(mesh, layer.profileId);
  }
  mesh.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if ('color' in material && layer.tint !== undefined) {
        (material as THREE.MeshStandardMaterial).color.setHex(layer.tint);
      }
      if ('emissive' in material && layer.emissive !== undefined) {
        (material as THREE.MeshStandardMaterial).emissive.setHex(layer.emissive);
      }
      if ('opacity' in material && layer.opacity !== undefined) {
        material.transparent = layer.opacity < 1;
        material.opacity = layer.opacity;
      }
      if ('wireframe' in material && layer.wireframe !== undefined) {
        material.wireframe = layer.wireframe;
      }
      if ('side' in material && layer.doubleSided) {
        material.side = THREE.DoubleSide;
      }
      material.needsUpdate = true;
    }
  });
}

function animateMaterialLayer(mesh: THREE.Object3D, layer: MaterialLayerDefinition, timeSeconds: number): void {
  if (layer.emissivePulseHz === undefined && layer.dissolveAmount === undefined) {
    return;
  }

  mesh.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const pulse = layer.emissivePulseHz !== undefined
        ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(timeSeconds * Math.PI * 2 * layer.emissivePulseHz))
        : 1;
      if ('emissiveIntensity' in material && layer.emissivePulseHz !== undefined) {
        (material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
      }
      if ('opacity' in material && layer.dissolveAmount !== undefined) {
        material.transparent = true;
        material.opacity = Math.max(0.08, 1 - layer.dissolveAmount * (0.5 + 0.5 * Math.sin(timeSeconds * Math.PI)));
      }
      material.needsUpdate = true;
    }
  });
}

function createProceduralPrefabEntity(
  cellId: string,
  index: number,
  countIndex: number,
  entry: BiomeSpawnTableEntry,
  bounds: SpatialCellBounds,
  random: () => number,
): SerializedSceneEntity {
  const position = randomPosition(bounds, random);
  return {
    sourceEntityId: `procedural:${cellId}:${index}:${countIndex}`,
    kind: 'prefab',
    entityType: entry.prefabId ?? 'procedural_prefab',
    prefabId: entry.prefabId ?? null,
    authority: 'local',
    transform: {
      position,
      rotation: {
        x: 0,
        y: random() * Math.PI * 2,
        z: 0,
      },
      scale: { x: 1, y: 1, z: 1 },
    },
    components: {},
  };
}

function randomPosition(bounds: SpatialCellBounds, random: () => number): Vector3 {
  return {
    x: lerp(bounds.minX, bounds.maxX, random()),
    y: 0,
    z: lerp(bounds.minZ, bounds.maxZ, random()),
  };
}

function jitterAround(anchor: Vector3, minDistance: number, maxDistance: number, random: () => number): Vector3 {
  const angle = random() * Math.PI * 2;
  const distance = lerp(minDistance, maxDistance, random());
  return {
    x: anchor.x + Math.cos(angle) * distance,
    y: anchor.y,
    z: anchor.z + Math.sin(angle) * distance,
  };
}

function resolveChunkOwner(
  policy: NonNullable<CoopRuntimeDefinition['chunkOwnerPolicy']>,
  cellId: string,
  index: number,
  playerIds: string[],
  playerPositions?: Record<string, Vector3>,
): string {
  switch (policy) {
    case 'lowest-player-id':
      return playerIds[0] ?? 'host';
    case 'round-robin':
      return playerIds[index % playerIds.length] ?? playerIds[0] ?? 'host';
    case 'nearest-player': {
      const center = parseCellCenter(cellId);
      let bestPlayerId = playerIds[0] ?? 'host';
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const playerId of playerIds) {
        const position = playerPositions?.[playerId];
        if (!position) {
          continue;
        }
        const distance = squaredDistanceXZ(position, center);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPlayerId = playerId;
        }
      }
      return bestPlayerId;
    }
    case 'host':
    default:
      return playerIds[0] ?? 'host';
  }
}

function parseCellCenter(cellId: string): Vector3 {
  const [rawX, rawZ] = cellId.split(':');
  const x = Number(rawX);
  const z = Number(rawZ);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: 0,
    z: Number.isFinite(z) ? z : 0,
  };
}

function pointInBounds(position: Vector3, bounds: WorldBounds2D): boolean {
  return position.x >= bounds.minX
    && position.x <= bounds.maxX
    && position.z >= bounds.minZ
    && position.z <= bounds.maxZ;
}

function getBoundsCenter(bounds: SpatialCellBounds): Vector3 {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: 0,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
}

function squaredDistanceXZ(left: Vector3, right: Vector3): number {
  const dx = left.x - right.x;
  const dz = left.z - right.z;
  return dx * dx + dz * dz;
}

function migrateLegacyVariantMetadata(metadata: Record<string, unknown>): {
  runtimeMetadata: Partial<PrefabRuntimeMetadata>;
  editorMetadata: Partial<PrefabEditorMetadata>;
} {
  const runtimeMetadata: Record<string, unknown> = {};
  const editorMetadata: Record<string, unknown> = {};
  const legacyRuntimeKeys = new Set([
    'biomeCompatibility',
    'audioSurfaceType',
    'streamingCost',
    'gpuInstancing',
    'renderCompatibility',
    'destruction',
    'traversal',
    'collisionClass',
    'aiMetadata',
    'gameplay',
    'materialAffinity',
    'encounterAffinity',
    'surfaceTypes',
    'affinities',
    'traits',
    'navigationFlags',
  ]);
  const legacyEditorKeys = new Set(['category', 'displayName', 'description', 'iconKey', 'tags']);

  for (const key of Object.keys(metadata)) {
    const value = metadata[key];
    if (legacyRuntimeKeys.has(key)) {
      runtimeMetadata[key] = value;
      continue;
    }
    if (legacyEditorKeys.has(key)) {
      editorMetadata[key] = value;
      continue;
    }
    if (key === 'runtimeMetadata' && typeof value === 'object' && value !== null) {
      Object.assign(runtimeMetadata, value as Record<string, unknown>);
      continue;
    }
    if (key === 'editorMetadata' && typeof value === 'object' && value !== null) {
      Object.assign(editorMetadata, value as Record<string, unknown>);
      continue;
    }
  }

  return {
    runtimeMetadata: runtimeMetadata as Partial<PrefabRuntimeMetadata>,
    editorMetadata: editorMetadata as Partial<PrefabEditorMetadata>,
  };
}

function computeHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function mergeRuntimeMetadata(
  base?: PrefabRuntimeMetadata | null,
  variant?: Partial<PrefabRuntimeMetadata> | null,
): PrefabRuntimeMetadata | undefined {
  if (!base && !variant) return undefined;
  return {
    surfaceTypes: mergeUniqueStrings(base?.surfaceTypes, variant?.surfaceTypes),
    affinities: mergeUniqueStrings(base?.affinities, variant?.affinities),
    traits: mergeUniqueStrings(base?.traits, variant?.traits),
    navigationFlags: mergeUniqueStrings(base?.navigationFlags, variant?.navigationFlags),
    streamingCost: variant?.streamingCost ?? base?.streamingCost,
    encounterAffinity: mergeUniqueStrings(base?.encounterAffinity, variant?.encounterAffinity),
    materialAffinity: mergeUniqueStrings(base?.materialAffinity, variant?.materialAffinity),
    audioSurfaceType: variant?.audioSurfaceType ?? base?.audioSurfaceType,
    gpuInstancing: variant?.gpuInstancing ?? base?.gpuInstancing,
    renderCompatibility: mergeUniqueStrings(base?.renderCompatibility, variant?.renderCompatibility),
    destruction: variant?.destruction ?? base?.destruction,
    traversal: variant?.traversal ?? base?.traversal,
    collisionClass: variant?.collisionClass ?? base?.collisionClass,
    aiMetadata: variant?.aiMetadata ?? base?.aiMetadata,
    gameplay: variant?.gameplay ?? base?.gameplay,
  };
}

function mergeEditorMetadata(
  base?: PrefabEditorMetadata | null,
  variant?: Partial<PrefabEditorMetadata> | null,
): PrefabEditorMetadata | undefined {
  if (!base && !variant) return undefined;
  return {
    category: variant?.category ?? base?.category,
    displayName: variant?.displayName ?? base?.displayName,
    description: variant?.description ?? base?.description,
    iconKey: variant?.iconKey ?? base?.iconKey,
    tags: mergeUniqueStrings(base?.tags, variant?.tags),
  };
}

function normalizeTags(tags: (string | undefined | null)[] | undefined): string[] {
  const normalized: Set<string> = new Set();
  for (const tag of tags ?? []) {
    if (typeof tag !== 'string') continue;
    const clean = tag.trim().toLowerCase().replace(/\s+/g, '_');
    if (clean) normalized.add(clean);
  }
  return [...normalized].sort();
}

function computePrefabHash(prefab: PrefabDefinition): string {
  const payload = {
    name: prefab.name,
    entityType: prefab.entityType,
    assetKey: prefab.assetKey,
    color: prefab.color,
    networked: prefab.networked,
    spawnWeight: prefab.spawnWeight,
    minSpacing: prefab.minSpacing,
    maxDrawDistance: prefab.maxDrawDistance,
    collider: prefab.collider,
    pickup: prefab.pickup,
    interactable: prefab.interactable,
    components: prefab.components,
    tags: normalizeTags(prefab.tags),
    metadata: prefab.metadata?.runtimeMetadata ?? {},
    children: prefab.children?.map((child) => ({ ...child, contentHash: undefined })),
  };
  return computeHash(stableStringify(payload));
}

function mergePrefabComponents(
  current: PrefabDefinition['components'],
  next: RuntimePrefabVariantDefinition['components'],
): PrefabDefinition['components'] {
  const components = new Map<string, { name: string; data: Record<string, unknown> }>();
  for (const component of current ?? []) {
    components.set(component.name, clonePlain(component));
  }
  for (const component of next ?? []) {
    const previous = components.get(component.name);
    components.set(component.name, {
      name: component.name,
      data: {
        ...(previous?.data ?? {}),
        ...clonePlain(component.data),
      },
    });
  }
  return [...components.values()];
}

function mergeUniqueStrings(current?: string[] | null, next?: string[] | null): string[] | undefined {
  const values = new Set<string>();
  for (const value of current ?? []) {
    values.add(value);
  }
  for (const value of next ?? []) {
    values.add(value);
  }
  return values.size > 0 ? [...values].sort() : undefined;
}

function randomInt(min: number, max: number, random: () => number): number {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.floor(lerp(safeMin, safeMax + 1, random()));
}

function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

function clonePlain<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
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