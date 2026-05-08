import { WebSocket } from 'ws';
import {
  WORLD_PRODUCTION_SCHEMA_VERSION,
  buildWorldProductionBundleDependencyGraph,
  computeWorldProductionContentHash,
  createDefaultProductionAuthorityPolicy,
  createEmptyWorldProductionReplayJournal,
  createEmptyWorldProductionTransientState,
  createDeterministicSeed,
  type WorldProductionBundle,
  type WorldProductionGeneratedState,
  type WorldProductionSyncPayload,
} from '@shared/contracts';
import type { PlayerState } from '../core/GameSession';
import type { WorldObjectState } from '../world/WorldObjects';

interface SerializedSceneEntity {
  sourceEntityId: string;
  kind: 'entity';
  entityType: string;
  prefabId: null;
  authority: 'replicated';
  transform: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
  };
  components: Record<string, Record<string, unknown>>;
}

interface SerializedSceneMap {
  version: 'editor-scene-v1';
  savedAt: number;
  entityCount: number;
  entities: SerializedSceneEntity[];
  productionSync?: WorldProductionSyncPayload | null;
}

interface SyncJoinedPlayerOptions {
  ws: WebSocket;
  playerId: string;
  hostPlayerId: string;
  mapId: string;
  sessionId: string;
  spawnPosition: { x: number; y: number; z: number };
  playerAppearance: Record<string, unknown> | null | undefined;
  worldObjects: Iterable<WorldObjectState>;
  players: Iterable<PlayerState>;
  broadcastOthers: (excludePlayerId: string, message: unknown) => void;
}

export function syncJoinedPlayerState(options: SyncJoinedPlayerOptions): void {
  if (options.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  // ─ AUTHORITY-BASED BINDING: Send SPAWN_AUTHORITY to confirm this player controls their entity
  // This prevents authority-mismatch when the Entity ID might not match the Player ID
  options.ws.send(JSON.stringify({
    type: 'SPAWN_AUTHORITY',
    playerId: options.playerId,
    entityId: options.playerId,
    authority: 'local',
    timestamp: Date.now(),
  }));

  const worldObjects = Array.from(options.worldObjects);
  const productionSync = buildWorldProductionSync(options.mapId, options.sessionId, options.hostPlayerId, worldObjects);
  if (worldObjects.length > 0 || productionSync.authoredBundles.length) {
    options.ws.send(JSON.stringify({
      type: 'INITIAL_MAP_SYNC',
      mapData: serializeWorldObjectsAsSceneMap(worldObjects, productionSync),
      timestamp: Date.now(),
    }));
  }

  if (worldObjects.length > 0) {
    options.ws.send(JSON.stringify({
      type: 'WORLD_STATE',
      objects: worldObjects,
    }));
  }

  if (options.playerAppearance) {
    options.ws.send(JSON.stringify({
      type: 'PLAYER_APPEARANCE',
      playerId: options.playerId,
      appearance: options.playerAppearance,
    }));
  }

  for (const other of options.players) {
    if (other.id === options.playerId || !other.appearance) continue;
    options.ws.send(JSON.stringify({
      type: 'PLAYER_APPEARANCE',
      playerId: other.id,
      appearance: other.appearance,
    }));
  }

  if (options.playerAppearance) {
    options.broadcastOthers(options.playerId, {
      type: 'PLAYER_APPEARANCE',
      playerId: options.playerId,
      appearance: options.playerAppearance,
    });
  }

  const joinerSpawnEvent = {
    type: 'ENTITY_SPAWNED',
    entityId: options.playerId,
    playerId: options.playerId,
    position: options.spawnPosition,
    isPlayerControlled: true,
    timestamp: Date.now(),
  };

  const peerSpawnEvent = {
    ...joinerSpawnEvent,
    isPlayerControlled: false,
  };

  // Send to the joiner as well so the first spawn state is never delayed by snapshot timing.
  options.ws.send(JSON.stringify(joinerSpawnEvent));
  // Broadcast to all other peers immediately.
  options.broadcastOthers(options.playerId, peerSpawnEvent);
}

function serializeWorldObjectsAsSceneMap(
  worldObjects: WorldObjectState[],
  productionSync?: WorldProductionSyncPayload | null,
): SerializedSceneMap {
  const entities = worldObjects
    .map((worldObject) => ({
      sourceEntityId: worldObject.id,
      kind: 'entity' as const,
      entityType: worldObject.entityType,
      prefabId: null,
      authority: 'replicated' as const,
      transform: {
        position: { ...worldObject.position },
        rotation: { ...worldObject.rotation },
        scale: readScaleFromGeometry(worldObject.renderData?.geometry),
      },
      components: {
        render: worldObject.renderData != null ? cloneData(worldObject.renderData) : {} as Record<string, unknown>,
      },
    }))
    .sort((left, right) => left.sourceEntityId.localeCompare(right.sourceEntityId));

  return {
    version: 'editor-scene-v1',
    savedAt: Date.now(),
    entityCount: entities.length,
    entities,
    productionSync: productionSync ?? null,
  };
}

function buildWorldProductionSync(
  mapId: string,
  sessionId: string,
  hostPlayerId: string,
  worldObjects: WorldObjectState[],
): WorldProductionSyncPayload {
  const bounds = computeWorldBounds(worldObjects);
  const cellIds = collectCellIds(worldObjects, 64);
  const biomeId = deriveBiomeId(mapId);
  const bundleId = `server:${sessionId}:${mapId}`;
  const deterministicGenerationSeed = createDeterministicSeed(0x41c64e6d, `${mapId}:${sessionId}`);

  const bundle: WorldProductionBundle = {
    id: bundleId,
    label: `${humanizeId(mapId)} Session`,
    version: 1,
    biomeRegions: [{
      id: biomeId,
      label: humanizeId(biomeId),
      bounds,
      climate: mapId.includes('forest') ? 'humid' : 'industrial',
      atmosphere: deriveBiomeAtmosphere(mapId),
      metadata: {
        source: 'server_initial_map_sync',
        mapId,
        sessionId,
      },
    }],
    proceduralWorld: {
      id: `procedural:${sessionId}`,
      baseSeed: deterministicGenerationSeed,
      chunkSize: 64,
      defaultBiomeId: biomeId,
      spawnDensity: Math.max(0.05, Math.min(0.35, worldObjects.length / 64)),
      generatedCellIds: cellIds,
      metadata: {
        source: 'server_initial_map_sync',
        mapId,
        sessionId,
      },
    },
    coopRuntime: {
      maxPlayers: 4,
      chunkOwnerPolicy: 'host',
      encounterAuthority: 'host',
      deterministicSeeds: true,
      syncQuestState: true,
      syncCinematics: true,
      sharedObjectives: true,
      metadata: {
        source: 'server_initial_map_sync',
        mapId,
        sessionId,
      },
    },
    authoring: {
      sdkVersion: 'server-sync-v1',
      liveEditableChunkIds: cellIds,
      assetTags: {},
      metadata: {
        source: 'server_initial_map_sync',
      },
    },
    metadata: {
      source: 'server_initial_map_sync',
      mapId,
      sessionId,
      worldObjectCount: worldObjects.length,
    },
  };

  const bundleDependencyGraph = buildWorldProductionBundleDependencyGraph([bundle]);

  const generatedState: WorldProductionGeneratedState = {
    schemaVersion: WORLD_PRODUCTION_SCHEMA_VERSION,
    contentHash: '',
    deterministicGenerationSeed,
    bundleDependencyGraph,
    authoritativeEpoch: 1,
    authorityRole: 'server',
    authorityPolicy: createDefaultProductionAuthorityPolicy(),
    reconciliationMode: 'staged_diff',
    loadedBundleIds: [bundleId],
    chunkOwnership: Object.fromEntries(cellIds.map((cellId) => [cellId, hostPlayerId || 'server'])),
    graphStates: {},
    generatedChunks: Object.fromEntries(cellIds.map((cellId) => [cellId, {
      cellId,
      seed: createDeterministicSeed(deterministicGenerationSeed, cellId),
      ownerId: hostPlayerId || 'server',
      phase: 'replicated',
      operationCount: 1,
      mutationHash: computeWorldProductionContentHash({ cellId, ownerId: hostPlayerId || 'server' }),
      updatedAt: Date.now(),
    }])),
    persistentBiomeMutations: {},
    encounterStates: {},
    values: {
      mapId,
      sessionId,
      hostPlayerId,
      source: 'server_initial_map_sync',
    },
    replayJournal: createEmptyWorldProductionReplayJournal(),
  };

  const contentHash = computeWorldProductionContentHash({
    authoredBundles: [bundle],
    deterministicGenerationSeed,
    bundleDependencyGraph,
    generatedState: {
      ...generatedState,
      schemaVersion: undefined,
      contentHash: undefined,
      bundleDependencyGraph: undefined,
    },
  });
  generatedState.contentHash = contentHash;

  const runtimeState = createEmptyWorldProductionTransientState();
  runtimeState.bundleIds = [bundleId];
  runtimeState.modIds = [];
  runtimeState.activeBiomeId = biomeId;
  runtimeState.lastAppliedEpoch = generatedState.authoritativeEpoch;
  runtimeState.lifecyclePhases = Object.fromEntries([
    ...cellIds.map((cellId) => [`chunk:${cellId}`, 'replicated' as const]),
    [`bundle:${bundleId}`, 'authored' as const],
  ]);

  return {
    schemaVersion: WORLD_PRODUCTION_SCHEMA_VERSION,
    contentHash,
    deterministicGenerationSeed,
    bundleDependencyGraph,
    authoritativeEpoch: generatedState.authoritativeEpoch,
    reconciliation: {
      mode: 'staged_diff',
      stages: ['authored', 'generated', 'replicated'],
      allowRollback: true,
    },
    authoredBundles: [bundle],
    generatedState,
    runtimeState: {
      ...runtimeState,
      activeSequenceId: null,
      predictedBiomeId: null,
      predictedSequenceIds: [],
      reconciliationStage: 'idle',
      compatibilityError: null,
    },
  };
}

function readScaleFromGeometry(geometry: Record<string, unknown> | undefined): { x: number; y: number; z: number } {
  const size = readFiniteNumber(geometry?.size);
  const width = readFiniteNumber(geometry?.width) ?? size ?? 1;
  const height = readFiniteNumber(geometry?.height) ?? readFiniteNumber(geometry?.length) ?? size ?? 1;
  const depth = readFiniteNumber(geometry?.depth) ?? size ?? 1;
  return { x: width, y: height, z: depth };
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function computeWorldBounds(worldObjects: WorldObjectState[]): { minX: number; minZ: number; maxX: number; maxZ: number } {
  if (worldObjects.length === 0) {
    return { minX: -64, minZ: -64, maxX: 64, maxZ: 64 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const worldObject of worldObjects) {
    const halfExtents = readHalfExtents(worldObject.renderData?.geometry);
    minX = Math.min(minX, worldObject.position.x - halfExtents.x);
    minZ = Math.min(minZ, worldObject.position.z - halfExtents.z);
    maxX = Math.max(maxX, worldObject.position.x + halfExtents.x);
    maxZ = Math.max(maxZ, worldObject.position.z + halfExtents.z);
  }

  return { minX, minZ, maxX, maxZ };
}

function collectCellIds(worldObjects: WorldObjectState[], cellSize: number): string[] {
  const cellIds = new Set<string>();
  for (const worldObject of worldObjects) {
    const cellX = Math.floor(worldObject.position.x / cellSize);
    const cellZ = Math.floor(worldObject.position.z / cellSize);
    cellIds.add(`${cellX}:${cellZ}`);
  }
  if (cellIds.size === 0) {
    cellIds.add('0:0');
  }
  return [...cellIds].sort();
}

function deriveBiomeId(mapId: string): string {
  if (mapId.includes('forest')) {
    return 'tropical_horror_forest';
  }
  if (mapId.includes('default')) {
    return 'industrial_arena';
  }
  return `biome_${mapId.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
}

function deriveBiomeAtmosphere(mapId: string): { fogColor?: number; fogDensity?: number; weatherPreset?: string } {
  if (mapId.includes('forest')) {
    return {
      fogColor: 0x35583a,
      fogDensity: 0.042,
      weatherPreset: 'mist_canopy',
    };
  }
  return {
    fogColor: 0x4a4f59,
    fogDensity: 0.022,
    weatherPreset: 'dry_haze',
  };
}

function readHalfExtents(geometry: Record<string, unknown> | undefined): { x: number; z: number } {
  const size = readFiniteNumber(geometry?.size) ?? 1;
  const width = readFiniteNumber(geometry?.width) ?? size;
  const depth = readFiniteNumber(geometry?.depth) ?? size;
  return {
    x: width * 0.5,
    z: depth * 0.5,
  };
}

function humanizeId(value: string): string {
  return value
    .split(/[_\-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}