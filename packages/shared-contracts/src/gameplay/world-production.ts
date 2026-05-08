export interface WorldBounds2D {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface PrefabRuntimeMetadata {
  surfaceTypes?: string[];
  affinities?: string[];
  traits?: string[];
  navigationFlags?: string[];
  streamingCost?: number;
  encounterAffinity?: string[];
  materialAffinity?: string[];
  audioSurfaceType?: string;
  gpuInstancing?: boolean;
  renderCompatibility?: string[];
  destruction?: {
    state?: string;
    variants?: string[];
  };
  traversal?: {
    walkable?: boolean;
    climbable?: boolean;
    jumpable?: boolean;
    occludesSight?: boolean;
  };
  collisionClass?: string;
  aiMetadata?: Record<string, unknown>;
  gameplay?: Record<string, unknown>;
}

export interface PrefabEditorMetadata {
  category?: string;
  displayName?: string;
  description?: string;
  iconKey?: string;
  tags?: string[];
}

export interface SharedMusicTrackDefinition {
  id: string;
  label: string;
  description?: string;
  soundKey?: string;
  soundUrl?: string;
  loop?: boolean;
  volume?: number;
  toneSequence?: {
    bpm?: number;
    loopEnd?: string;
    reverb?: number;
    steps: Array<{
      time: string;
      note: string;
      duration: string;
      velocity?: number;
    }>;
  };
}

export interface SharedAudioTriggerDefinition {
  id: string;
  label: string;
  soundKey?: string;
  soundUrl?: string;
  category?: 'music' | 'ambient' | 'weapon' | 'ui' | 'footstep' | 'voice' | 'system';
  volume?: number;
  loop?: boolean;
}

export interface BiomeAtmosphereDefinition {
  fogColor?: number;
  fogDensity?: number;
  ambientTrackId?: string;
  ambientTriggerId?: string;
  materialProfileId?: string;
  weatherPreset?: string;
  lightingPreset?: string;
  metadata?: Record<string, unknown>;
}

export interface BiomeSpawnTableEntry {
  id: string;
  weight: number;
  prefabId?: string;
  enemyType?: 'default' | 'flyingMask';
  enemyVariantId?: string;
  minCount?: number;
  maxCount?: number;
  minSpacing?: number;
  maxSpacing?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface BiomeEncounterDefinition {
  id: string;
  label: string;
  description?: string;
  zoneIds?: string[];
  musicTrackId?: string;
  triggerId?: string;
  cinematicSequenceId?: string;
  questGraphId?: string;
  spawnEntries: BiomeSpawnTableEntry[];
  metadata?: Record<string, unknown>;
}

export interface BiomeRegionDefinition {
  id: string;
  label: string;
  bounds?: WorldBounds2D | null;
  climate?: string;
  tags?: string[];
  atmosphere?: BiomeAtmosphereDefinition;
  spawnTable?: BiomeSpawnTableEntry[];
  encounters?: BiomeEncounterDefinition[];
  metadata?: Record<string, unknown>;
}

export interface ProceduralChunkDefinition {
  cellId: string;
  biomeId?: string;
  seed?: number;
  densityScale?: number;
  spawnTable?: BiomeSpawnTableEntry[];
  blockedAreas?: WorldBounds2D[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProceduralWorldDefinition {
  id: string;
  baseSeed: number;
  chunkSize?: number;
  defaultBiomeId?: string;
  spawnDensity?: number;
  generatedCellIds?: string[];
  chunkOverrides?: ProceduralChunkDefinition[];
  metadata?: Record<string, unknown>;
  runtimePolicy?: {
    navRebuildOnGenerate?: boolean;
    chunkOwnerPolicy?: ChunkOwnerPolicy;
    encounterAuthority?: EncounterAuthorityPolicy;
    metadata?: Record<string, unknown>;
  };
}

export interface MaterialLayerDefinition {
  id: string;
  label?: string;
  profileId?: string;
  biomeIds?: string[];
  entityTypes?: string[];
  prefabIds?: string[];
  tags?: string[];
  tint?: number;
  emissive?: number;
  opacity?: number;
  emissivePulseHz?: number;
  dissolveAmount?: number;
  wireframe?: boolean;
  doubleSided?: boolean;
  metadata?: Record<string, unknown>;
}

export type WorldEventGraphNodeKind =
  | 'trigger'
  | 'objective'
  | 'wave_event'
  | 'dialogue_hook'
  | 'cinematic_trigger'
  | 'boss_encounter'
  | 'extraction_event'
  | 'state_gate'
  | 'complete';

export interface WorldEventGraphNodeDefinition {
  id: string;
  kind: WorldEventGraphNodeKind;
  label: string;
  nextNodeIds?: string[];
  eventId?: string;
  encounterId?: string;
  cinematicSequenceId?: string;
  objectiveText?: string;
  stateKey?: string;
  expectedValue?: string | number | boolean;
  autoAdvance?: boolean;
  metadata?: Record<string, unknown>;
}

export interface WorldEventGraphDefinition {
  id: string;
  label: string;
  entryNodeId: string;
  nodes: WorldEventGraphNodeDefinition[];
  metadata?: Record<string, unknown>;
}

export interface WorldEventGraphRuntimeState {
  graphId: string;
  status: 'idle' | 'running' | 'completed';
  activeNodeIds: string[];
  completedNodeIds: string[];
  values: Record<string, unknown>;
  lastEventId?: string | null;
  updatedAt: number;
}

export type CinematicCueAction =
  | 'play_music'
  | 'play_trigger'
  | 'emit_event'
  | 'set_fog'
  | 'set_biome'
  | 'spawn_prefab'
  | 'set_state'
  | 'start_graph';

export interface CinematicCueDefinition {
  id: string;
  atMs: number;
  action: CinematicCueAction;
  trackId?: string;
  triggerId?: string;
  eventId?: string;
  payload?: Record<string, unknown>;
  prefabId?: string;
  position?: { x: number; y: number; z: number };
  fogColor?: number;
  fogDensity?: number;
  biomeId?: string;
  stateKey?: string;
  value?: unknown;
  graphId?: string;
}

export interface CinematicSequenceDefinition {
  id: string;
  label: string;
  durationMs: number;
  cues: CinematicCueDefinition[];
  skippable?: boolean;
  blocksInput?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface RuntimePrefabVariantDefinition {
  id: string;
  basePrefabId: string;
  entityType?: string;
  assetKey?: string;
  color?: number;
  networked?: boolean;
  spawnWeight?: number;
  minSpacing?: number;
  maxDrawDistance?: number;
  tags?: string[];
  components?: Array<{ name: string; data: Record<string, unknown> }>;
  metadata?: {
    runtimeMetadata?: PrefabRuntimeMetadata;
    editorMetadata?: PrefabEditorMetadata;
  };
}

export interface RuntimePrefabBatchProfile {
  id: string;
  label: string;
  prefabIds?: string[];
  tags?: string[];
  color?: number;
  materialProfileId?: string;
  metadata?: Record<string, unknown>;
}

export interface WorldModManifest {
  id: string;
  label: string;
  version: string;
  author?: string;
  description?: string;
  hotReloadable?: boolean;
  dependencies?: string[];
  prefabIds?: string[];
  bundleIds?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export type ChunkOwnerPolicy = 'host' | 'nearest-player' | 'lowest-player-id' | 'round-robin';
export type EncounterAuthorityPolicy = 'host' | 'zone-owner' | 'instigator';

export interface CoopRuntimeDefinition {
  maxPlayers?: number;
  chunkOwnerPolicy?: ChunkOwnerPolicy;
  encounterAuthority?: EncounterAuthorityPolicy;
  deterministicSeeds?: boolean;
  syncQuestState?: boolean;
  syncCinematics?: boolean;
  streamingBudgetPerPlayer?: number;
  sharedObjectives?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RuntimeAuthoringDefinition {
  sdkVersion?: string;
  liveEditableChunkIds?: string[];
  assetTags?: Record<string, string[]>;
  prefabVariants?: RuntimePrefabVariantDefinition[];
  batchProfiles?: RuntimePrefabBatchProfile[];
  metadata?: Record<string, unknown>;
}

export const WORLD_PRODUCTION_SCHEMA_VERSION = 2 as const;

export type ProductionLifecyclePhase = 'authored' | 'generated' | 'replicated' | 'simulated' | 'persisted' | 'unloaded';
export type ProductionAuthorityRole = 'server' | 'client-presentation';
export type ProductionReconciliationMode = 'full_replace' | 'staged_diff';

export interface WorldProductionBundleDependencyNode {
  bundleId: string;
  dependsOn: string[];
}

export interface WorldProductionAuthorityPolicy {
  proceduralChunkMutationAuthority: 'server';
  conflictResolver: 'server';
  graphAdvanceAuthority: 'server';
  worldEventCompletionAuthority: 'server';
  persistentBiomeMutationAuthority: 'server';
  encounterResolutionAuthority: 'server';
  persistentCommitAuthority: 'server';
  clientPrediction: 'presentation_only';
}

export interface WorldProductionModTrustPolicy {
  deterministicSafeMetadataOnly: boolean;
  forbiddenRuntimeHooks: string[];
  sandboxLimits: {
    maxPrefabCount: number;
    maxBundleBytes: number;
    maxAudioTrackCount: number;
    maxTextureBudgetMb: number;
    maxGeometryBudgetMb: number;
  };
  replicationSafePayloadRules: {
    maxPayloadBytes: number;
    allowFunctions: false;
    allowDynamicCode: false;
    allowAuthorityHooks: false;
  };
}

export interface WorldProductionGeneratedChunkState {
  cellId: string;
  seed: number;
  ownerId: string;
  phase: ProductionLifecyclePhase;
  operationCount: number;
  mutationHash: string;
  updatedAt: number;
}

export interface WorldProductionEncounterState {
  encounterId: string;
  status: 'idle' | 'active' | 'resolved';
  resolvedBy: string | null;
  updatedAt: number;
}

export interface WorldProductionStateDiff {
  id: string;
  path: string;
  valueHash: string;
  appliedAt: number;
}

export interface WorldProductionReplayGenerationSeedRecord {
  scope: string;
  seed: number;
}

export interface WorldProductionReplayGraphTransitionRecord {
  graphId: string;
  fromNodeId: string | null;
  toNodeId: string | null;
  eventId?: string | null;
  timestamp: number;
}

export interface WorldProductionReplayChunkMutationRecord {
  cellId: string;
  ownerId: string;
  operation: string;
  mutationHash: string;
  timestamp: number;
}

export interface WorldProductionReplayJournal {
  generationSeeds: WorldProductionReplayGenerationSeedRecord[];
  graphTransitions: WorldProductionReplayGraphTransitionRecord[];
  chunkMutations: WorldProductionReplayChunkMutationRecord[];
  productionStateDiffs: WorldProductionStateDiff[];
}

export interface WorldProductionCompatibilityEnvelope {
  schemaVersion: number;
  contentHash: string;
  deterministicGenerationSeed: number;
  bundleDependencyGraph: WorldProductionBundleDependencyNode[];
}

export interface WorldProductionGeneratedState extends WorldProductionCompatibilityEnvelope {
  authoritativeEpoch: number;
  authorityRole: ProductionAuthorityRole;
  authorityPolicy: WorldProductionAuthorityPolicy;
  reconciliationMode: ProductionReconciliationMode;
  loadedBundleIds: string[];
  chunkOwnership: Record<string, string>;
  graphStates: Record<string, WorldEventGraphRuntimeState>;
  generatedChunks: Record<string, WorldProductionGeneratedChunkState>;
  persistentBiomeMutations: Record<string, Record<string, unknown>>;
  encounterStates: Record<string, WorldProductionEncounterState>;
  values: Record<string, unknown>;
  replayJournal: WorldProductionReplayJournal;
}

export interface WorldProductionTransientState {
  bundleIds: string[];
  activeBiomeId: string | null;
  activeSequenceId: string | null;
  modIds: string[];
  predictedBiomeId?: string | null;
  predictedSequenceIds?: string[];
  reconciliationStage?: 'idle' | 'authoring' | 'generated' | 'runtime' | 'rollback';
  lastAppliedEpoch?: number;
  lifecyclePhases?: Record<string, ProductionLifecyclePhase>;
  compatibilityError?: string | null;
  lastEncounterId: string | null;
}

export interface WorldProductionRuntimeState extends WorldProductionTransientState {}

export interface WorldProductionBundle {
  id: string;
  label: string;
  version: number;
  dependencies?: string[];
  biomeRegions?: BiomeRegionDefinition[];
  proceduralWorld?: ProceduralWorldDefinition;
  eventGraphs?: WorldEventGraphDefinition[];
  cinematicSequences?: CinematicSequenceDefinition[];
  materialLayers?: MaterialLayerDefinition[];
  audioTracks?: SharedMusicTrackDefinition[];
  audioTriggers?: SharedAudioTriggerDefinition[];
  mods?: WorldModManifest[];
  coopRuntime?: CoopRuntimeDefinition;
  authoring?: RuntimeAuthoringDefinition;
  trustPolicy?: WorldProductionModTrustPolicy;
  metadata?: Record<string, unknown>;
}

export interface WorldProductionSyncPayload {
  schemaVersion: number;
  contentHash: string;
  deterministicGenerationSeed: number;
  bundleDependencyGraph: WorldProductionBundleDependencyNode[];
  authoritativeEpoch: number;
  reconciliation: {
    mode: ProductionReconciliationMode;
    stages: ProductionLifecyclePhase[];
    allowRollback: boolean;
  };
  authoredBundles: WorldProductionBundle[];
  generatedState: WorldProductionGeneratedState;
  runtimeState?: WorldProductionTransientState | null;
}

export function createDeterministicSeed(baseSeed: number, scope: string): number {
  let hash = baseSeed >>> 0;
  for (let index = 0; index < scope.length; index += 1) {
    hash = Math.imul(hash ^ scope.charCodeAt(index), 0x45d9f3b) >>> 0;
    hash = (hash ^ (hash >>> 16)) >>> 0;
  }
  return hash >>> 0;
}

export function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeightedEntry<T extends { weight: number }>(entries: T[], random: () => number): T | null {
  const eligible = entries.filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
  if (eligible.length === 0) {
    return null;
  }

  const totalWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = random() * totalWeight;
  for (const entry of eligible) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry;
    }
  }

  return eligible[eligible.length - 1] ?? null;
}

export function createDefaultProductionAuthorityPolicy(): WorldProductionAuthorityPolicy {
  return {
    proceduralChunkMutationAuthority: 'server',
    conflictResolver: 'server',
    graphAdvanceAuthority: 'server',
    worldEventCompletionAuthority: 'server',
    persistentBiomeMutationAuthority: 'server',
    encounterResolutionAuthority: 'server',
    persistentCommitAuthority: 'server',
    clientPrediction: 'presentation_only',
  };
}

export function createDefaultModTrustPolicy(): WorldProductionModTrustPolicy {
  return {
    deterministicSafeMetadataOnly: true,
    forbiddenRuntimeHooks: ['eval', 'Function', 'systemContext', 'networkFacade', 'replicationFacade', 'authoritativeMutation'],
    sandboxLimits: {
      maxPrefabCount: 128,
      maxBundleBytes: 512 * 1024,
      maxAudioTrackCount: 32,
      maxTextureBudgetMb: 32,
      maxGeometryBudgetMb: 32,
    },
    replicationSafePayloadRules: {
      maxPayloadBytes: 256 * 1024,
      allowFunctions: false,
      allowDynamicCode: false,
      allowAuthorityHooks: false,
    },
  };
}

export function createEmptyWorldProductionReplayJournal(): WorldProductionReplayJournal {
  return {
    generationSeeds: [],
    graphTransitions: [],
    chunkMutations: [],
    productionStateDiffs: [],
  };
}

export function createEmptyWorldProductionGeneratedState(): WorldProductionGeneratedState {
  return {
    schemaVersion: WORLD_PRODUCTION_SCHEMA_VERSION,
    contentHash: computeWorldProductionContentHash([]),
    deterministicGenerationSeed: 0,
    bundleDependencyGraph: [],
    authoritativeEpoch: 0,
    authorityRole: 'server',
    authorityPolicy: createDefaultProductionAuthorityPolicy(),
    reconciliationMode: 'staged_diff',
    loadedBundleIds: [],
    chunkOwnership: {},
    graphStates: {},
    generatedChunks: {},
    persistentBiomeMutations: {},
    encounterStates: {},
    values: {},
    replayJournal: createEmptyWorldProductionReplayJournal(),
  };
}

export function createEmptyWorldProductionTransientState(): WorldProductionTransientState {
  return {
    bundleIds: [],
    activeBiomeId: null,
    activeSequenceId: null,
    modIds: [],
    predictedBiomeId: null,
    predictedSequenceIds: [],
    reconciliationStage: 'idle',
    lastAppliedEpoch: 0,
    lifecyclePhases: {},
    compatibilityError: null,
    lastEncounterId: null,
  };
}

export function buildWorldProductionBundleDependencyGraph(
  bundles: ReadonlyArray<Pick<WorldProductionBundle, 'id' | 'dependencies'>>,
): WorldProductionBundleDependencyNode[] {
  return bundles
    .map((bundle) => ({
      bundleId: bundle.id,
      dependsOn: [...(bundle.dependencies ?? [])].sort(),
    }))
    .sort((left, right) => left.bundleId.localeCompare(right.bundleId));
}

export function computeWorldProductionContentHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function validateWorldProductionSyncPayload(
  payload: WorldProductionSyncPayload,
): { compatible: boolean; reason?: string } {
  if (payload.schemaVersion !== WORLD_PRODUCTION_SCHEMA_VERSION) {
    return {
      compatible: false,
      reason: `Unsupported world-production schema version ${payload.schemaVersion}`,
    };
  }

  const expectedDependencyGraph = buildWorldProductionBundleDependencyGraph(payload.authoredBundles);
  const expectedContentHash = computeWorldProductionContentHash({
    authoredBundles: payload.authoredBundles,
    deterministicGenerationSeed: payload.deterministicGenerationSeed,
    bundleDependencyGraph: expectedDependencyGraph,
    generatedState: {
      ...payload.generatedState,
      contentHash: undefined,
      bundleDependencyGraph: undefined,
      schemaVersion: undefined,
    },
  });

  if (payload.contentHash !== expectedContentHash) {
    return {
      compatible: false,
      reason: `Content hash mismatch (${payload.contentHash} !== ${expectedContentHash})`,
    };
  }

  if (stableStringify(payload.bundleDependencyGraph) !== stableStringify(expectedDependencyGraph)) {
    return {
      compatible: false,
      reason: 'Bundle dependency graph mismatch',
    };
  }

  if (payload.generatedState.schemaVersion !== payload.schemaVersion) {
    return {
      compatible: false,
      reason: 'Generated production state schema version mismatch',
    };
  }

  if (payload.generatedState.contentHash !== payload.contentHash) {
    return {
      compatible: false,
      reason: 'Generated production state content hash mismatch',
    };
  }

  if (payload.generatedState.deterministicGenerationSeed !== payload.deterministicGenerationSeed) {
    return {
      compatible: false,
      reason: 'Deterministic generation seed mismatch',
    };
  }

  for (const dependency of payload.bundleDependencyGraph.flatMap((entry) => entry.dependsOn)) {
    if (!payload.authoredBundles.some((bundle) => bundle.id === dependency)) {
      return {
        compatible: false,
        reason: `Missing dependency bundle '${dependency}'`,
      };
    }
  }

  return { compatible: true };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((left, right) => left.localeCompare(right));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}