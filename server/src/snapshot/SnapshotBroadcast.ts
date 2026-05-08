import { type Vec3 } from '../sessionContracts';
import { calculatePositionHash, shouldIncludeDeterminismHash, type PositionHashData } from './DeterminismHash'; // MILESTONE 4

export interface SnapshotDiagnostics {
  samples: number;
  tick: number;
  playerCount: number;
  entityCount: number;
  eventCount: number;
  lastSnapshotBytes: number;
  averageSnapshotBytes: number;
  peakSnapshotBytes: number;
  lastBytesPerSnapshot: number;
  averageBytesPerSnapshot: number;
  peakBytesPerSnapshot: number;
  lastDeltaEntities: number;
  averageDeltaEntities: number;
  peakDeltaEntities: number;
  lastFanoutDurationMs: number;
  averageFanoutDurationMs: number;
  peakFanoutDurationMs: number;
  forcedRefreshes: number;
  snapshotsSent: number;
  lastUpdatedAt: number;
}

interface SnapshotPlayer {
  id: string;
  position: Vec3;
}

interface SnapshotEntity {
  id: string;
  position: Vec3;
  rotation: Vec3;
  velocity?: Vec3;
  equipment?: unknown[];
  statusMovementModifier?: unknown;
  [key: string]: unknown;
}

function isEntityControlledByPlayer<TEntity extends SnapshotEntity>(entity: TEntity, playerId: string): boolean {
  if (entity.id === playerId) {
    return true;
  }

  const candidateIds = [
    (entity as { playerId?: unknown }).playerId,
    (entity as { ownerId?: unknown }).ownerId,
    (entity as { controllerId?: unknown }).controllerId,
    (entity as { networkEntityId?: unknown }).networkEntityId,
  ];

  return candidateIds.some((candidateId) => typeof candidateId === 'string' && candidateId === playerId);
}

interface BroadcastWorldDeltaOptions<TPlayer extends SnapshotPlayer, TEntity extends SnapshotEntity> {
  tick: number;
  timestamp: number;
  round: unknown;
  events: ReadonlyArray<unknown>;
  players: Iterable<TPlayer>;
  entities: Iterable<TEntity>;
  snapshots: Map<string, Map<string, Record<string, unknown>>>;
  snapshotDiagnostics: SnapshotDiagnostics;
  relevanceRadius: number;
  canSendToPlayer: (player: TPlayer) => boolean;
  sendToPlayer: (player: TPlayer, payload: string) => void;
  lastProcessedInputSeqForPlayer: (player: TPlayer) => number;
  lastProcessedInputTickForPlayer: (player: TPlayer) => number;
  cloneStatusMovementModifier: (modifier: unknown) => unknown;
  statusMovementModifiersEqual: (left: unknown, right: unknown) => boolean;
  cloneEntitySnapshot?: (entity: TEntity, cloneStatusMovementModifier: (modifier: unknown) => unknown) => Record<string, unknown> | null | undefined;
  includeEntityInSnapshot?: (entity: TEntity) => boolean;
}

export function createInitialSnapshotDiagnostics(): SnapshotDiagnostics {
  return {
    samples: 0,
    tick: 0,
    playerCount: 0,
    entityCount: 0,
    eventCount: 0,
    lastSnapshotBytes: 0,
    averageSnapshotBytes: 0,
    peakSnapshotBytes: 0,
    lastBytesPerSnapshot: 0,
    averageBytesPerSnapshot: 0,
    peakBytesPerSnapshot: 0,
    lastDeltaEntities: 0,
    averageDeltaEntities: 0,
    peakDeltaEntities: 0,
    lastFanoutDurationMs: 0,
    averageFanoutDurationMs: 0,
    peakFanoutDurationMs: 0,
    forcedRefreshes: 0,
    snapshotsSent: 0,
    lastUpdatedAt: 0,
  };
}

export function broadcastWorldDelta<TPlayer extends SnapshotPlayer, TEntity extends SnapshotEntity>(
  options: BroadcastWorldDeltaOptions<TPlayer, TEntity>,
): SnapshotDiagnostics {
  const players = Array.from(options.players);
  
  // ─ SERVER EXORCISM: Hard-filter Grunts BEFORE snapshot processing ─
  let snapshotEntities = Array.from(options.entities).filter((entity) => (
    options.includeEntityInSnapshot ? options.includeEntityInSnapshot(entity) : true
  ));
  
  // Hard-block any grunt-like entities
  const beforeGruntFilter = snapshotEntities.length;
  snapshotEntities = snapshotEntities.filter((entity) => {
    const normalizedType = ((entity as any).type ?? '').toLowerCase();
    const isGrunt = normalizedType === 'prefab_enemygrunt' 
      || normalizedType.includes('grunt')
      || (entity as any).type === 'Prefab_EnemyGrunt'
      || (entity as any).id?.includes?.('npc_enemy_grunt');
    
    if (isGrunt) {
      console.warn('[SERVER_EXORCISM] Grunt filtered from snapshot broadcast', {
        entityId: (entity as any).id,
        entityType: (entity as any).type,
        normalizedType,
        tick: options.tick,
      });
    }
    return !isGrunt;
  });
  
  if (beforeGruntFilter !== snapshotEntities.length) {
    console.log('[SERVER_EXORCISM] Grunts removed from snapshot', {
      before: beforeGruntFilter,
      after: snapshotEntities.length,
      removed: beforeGruntFilter - snapshotEntities.length,
    });
  }
  
  const fanoutStartedAt = Date.now();
  let tickSnapshotBytes = 0;
  let tickDeltaEntities = 0;
  let snapshotsSent = 0;
  let forcedRefreshes = options.snapshotDiagnostics.forcedRefreshes;
  let peakBytesPerSnapshot = options.snapshotDiagnostics.peakBytesPerSnapshot;

  for (const player of players) {
    if (!options.canSendToPlayer(player)) continue;

    let snapshotStore = options.snapshots.get(player.id);
    if (!snapshotStore) {
      snapshotStore = new Map<string, Record<string, unknown>>();
      options.snapshots.set(player.id, snapshotStore);
    }

    const relevantEntityIds = new Set<string>();
    const payloadEntities: Array<Record<string, unknown>> = [];
    const forceFull = true;
    if (forceFull) {
      forcedRefreshes += 1;
    }

    for (const entity of snapshotEntities) {
      // ─ SERVER AUTHORITY HARDENING: Force-include local player ALWAYS ─
      // CRITICAL: localPlayerId entity MUST be included regardless of distance
      const isLocalPlayer = (entity as any).type === 'player' && isEntityControlledByPlayer(entity, player.id);
      
      // Include if: (1) is local player, OR (2) is within relevance radius
      const shouldInclude = isLocalPlayer || isEntityRelevantToPlayer(player, entity, options.relevanceRadius);
      if (!shouldInclude) continue;
      
      relevantEntityIds.add(entity.id);

      const nextSnapshot = options.cloneEntitySnapshot
        ? options.cloneEntitySnapshot(entity, options.cloneStatusMovementModifier)
        : cloneEntitySnapshot(entity, options.cloneStatusMovementModifier);
      if (!nextSnapshot) continue;
      const previousSnapshot = snapshotStore.get(entity.id);
      if (previousSnapshot && options.statusMovementModifiersEqual(
        nextSnapshot.statusMovementModifier ?? null,
        previousSnapshot.statusMovementModifier ?? null,
      )) {
        nextSnapshot.statusMovementModifier = previousSnapshot.statusMovementModifier;
      }
      nextSnapshot.isPlayerControlled = entity.type === 'player' && isEntityControlledByPlayer(entity, player.id);
      nextSnapshot.IS_PLAYER_CONTROLLED = entity.type === 'player' && isEntityControlledByPlayer(entity, player.id);
      const payload = nextSnapshot;

      snapshotStore.set(entity.id, nextSnapshot);
      if (!payload) continue;
      payloadEntities.push({ id: entity.id, ...payload });
      
      // ─ SERVER SNAPSHOT DEBUG: Log local player inclusion ─
      if (isLocalPlayer) {
        console.log('[SERVER_SNAPSHOT_PREPARE] Local player entity included in snapshot', {
          playerId: player.id,
          entityId: entity.id,
          tick: options.tick,
          position: entity.position,
          timestamp: Date.now(),
        });
      }
    }

    for (const entityId of Array.from(snapshotStore.keys())) {
      if (!relevantEntityIds.has(entityId)) {
        snapshotStore.delete(entityId);
      }
    }

    // ─ SERVER AUTHORITY HARDENING: Snapshot Integrity Check ─
    // CRITICAL: Never send empty snapshots when player exists in snapshotEntities
    if (payloadEntities.length === 0) {
      // Check if local player should be in payload
      const localPlayerInSnapshot = snapshotEntities.some((e) => (e as any).type === 'player' && isEntityControlledByPlayer(e, player.id));
      
      if (localPlayerInSnapshot) {
        // ASSERTION FAILURE: Player is in snapshot data but missing from payload
        console.error('[SERVER_ASSERTION_ERROR] LOCAL PLAYER MISSING FROM SNAPSHOT PAYLOAD - INFINITE LOOP RISK', {
          playerId: player.id,
          tick: options.tick,
          snapshotEntitiesCount: snapshotEntities.length,
          payloadEntitiesCount: payloadEntities.length,
          playerId_matches: snapshotEntities
            .filter((e) => (e as any).type === 'player' && isEntityControlledByPlayer(e, player.id))
            .map((e) => ({ id: e.id, type: e.type })),
          timestamp: Date.now(),
        });
        // FALLBACK: Create emergency payload with local player
        const localPlayer = snapshotEntities.find((e) => (e as any).type === 'player' && isEntityControlledByPlayer(e, player.id));
        if (localPlayer) {
          const emergencySnapshot = options.cloneEntitySnapshot
            ? options.cloneEntitySnapshot(localPlayer, options.cloneStatusMovementModifier)
            : cloneEntitySnapshot(localPlayer, options.cloneStatusMovementModifier);
          if (emergencySnapshot) {
            emergencySnapshot.isPlayerControlled = true;
            emergencySnapshot.IS_PLAYER_CONTROLLED = true;
            payloadEntities.push({ id: localPlayer.id, ...emergencySnapshot });
            console.error('[SERVER_RECOVERY] Emergency player entity added to payload', {
              playerId: player.id,
              tick: options.tick,
              timestamp: Date.now(),
            });
          }
        }
      } else {
        // Empty snapshot is acceptable - player simply not in relevant range
        // ─ SERVER HEARTBEAT: Send empty WORLD_DELTA instead of skipping ─
        // This prevents client from incorrectly detecting disconnection during spawning or cutscenes
        console.debug('[SnapshotIntegrity] Sending HEARTBEAT empty snapshot', {
          playerId: player.id,
          tick: options.tick,
          allEntitiesCount: snapshotEntities.length,
          reason: 'player_out_of_relevance_range',
          timestamp: Date.now(),
        });
        // Will send empty payloadEntities array below (heartbeat packet)
      }
    }
    
    // ─ HEARTBEAT: Always send WORLD_DELTA (even if empty) ─
    // Empty snapshots prevent false disconnection detection by client
    // Client interprets empty payloadEntities[] as "I'm still here, but nothing relevant near you"
    // Skip only if we couldn't construct even a heartbeat (shouldn't happen)
    if (payloadEntities.length === 0 && !snapshotEntities.some((e) => (e as any).type === 'player' && isEntityControlledByPlayer(e, player.id))) {
      // Only skip if payload is empty AND player doesn't exist in world at all
      // Otherwise send heartbeat
      if (snapshotEntities.length === 0) {
        // No entities at all - safe to skip this tick
        continue;
      }
    }

    const message = {
      type: 'WORLD_DELTA',
      schemaVersion: 2,
      deltaMode: 'sparse-entity-delta-v1',
      tick: options.tick,
      localPlayerId: player.id,  // ─ SERVER IDENTITY: Explicit client identity in snapshot header ─
      ack: options.lastProcessedInputSeqForPlayer(player),
      lastProcessedInput: options.lastProcessedInputSeqForPlayer(player),
      lastProcessedInputTick: options.lastProcessedInputTickForPlayer(player),
      timestamp: options.timestamp,
      entities: payloadEntities,
      round: options.round,
      events: options.events,
      // MILESTONE 4: Determinism hash every 100 ticks for collision desync detection
      positionHash: shouldIncludeDeterminismHash(options.tick) 
        ? calculatePositionHash(payloadEntities
            .filter((e) => (e as any).type === 'player')
            .map((e) => ({
              playerId: e.id,
              x: (e as any).position?.x ?? 0,
              y: (e as any).position?.y ?? 0,
              z: (e as any).position?.z ?? 0,
            } as PositionHashData)))
        : undefined,
    };
    
    const encoded = JSON.stringify(message);
    
    // ─ PAYLOAD VALIDATION: Check serialized snapshot ─
    const parsed = JSON.parse(encoded);
    if (!parsed.entities || parsed.entities.length === 0) {
      console.error('[SERVER_PAYLOAD_VALIDATION_FAILED] Serialized snapshot has zero entities', {
        playerId: player.id,
        tick: options.tick,
        preSerializedCount: message.entities.length,
        postSerializedCount: parsed.entities?.length ?? 0,
        timestamp: Date.now(),
      });
      continue;
    }
    options.sendToPlayer(player, encoded);

    const bytes = Buffer.byteLength(encoded, 'utf8');
    tickSnapshotBytes += bytes;
    tickDeltaEntities += payloadEntities.length;
    snapshotsSent += 1;
    peakBytesPerSnapshot = Math.max(peakBytesPerSnapshot, bytes);
  }

  const sampleCount = options.snapshotDiagnostics.samples + 1;
  const fanoutDurationMs = Date.now() - fanoutStartedAt;
  const averageSnapshotBytes = ((options.snapshotDiagnostics.averageSnapshotBytes * options.snapshotDiagnostics.samples) + tickSnapshotBytes) / sampleCount;
  const averageDeltaEntities = ((options.snapshotDiagnostics.averageDeltaEntities * options.snapshotDiagnostics.samples) + tickDeltaEntities) / sampleCount;
  const averageFanoutDurationMs = ((options.snapshotDiagnostics.averageFanoutDurationMs * options.snapshotDiagnostics.samples) + fanoutDurationMs) / sampleCount;
  const bytesPerSnapshot = snapshotsSent > 0 ? tickSnapshotBytes / snapshotsSent : 0;
  const averageBytesPerSnapshot = ((options.snapshotDiagnostics.averageBytesPerSnapshot * options.snapshotDiagnostics.samples) + bytesPerSnapshot) / sampleCount;

  return {
    ...options.snapshotDiagnostics,
    samples: sampleCount,
    tick: options.tick,
    playerCount: players.length,
    entityCount: snapshotEntities.length,
    eventCount: options.events.length,
    lastSnapshotBytes: tickSnapshotBytes,
    averageSnapshotBytes,
    peakSnapshotBytes: Math.max(options.snapshotDiagnostics.peakSnapshotBytes, tickSnapshotBytes),
    lastBytesPerSnapshot: bytesPerSnapshot,
    averageBytesPerSnapshot,
    peakBytesPerSnapshot,
    lastDeltaEntities: tickDeltaEntities,
    averageDeltaEntities,
    peakDeltaEntities: Math.max(options.snapshotDiagnostics.peakDeltaEntities, tickDeltaEntities),
    lastFanoutDurationMs: fanoutDurationMs,
    averageFanoutDurationMs,
    peakFanoutDurationMs: Math.max(options.snapshotDiagnostics.peakFanoutDurationMs, fanoutDurationMs),
    forcedRefreshes,
    snapshotsSent: options.snapshotDiagnostics.snapshotsSent + snapshotsSent,
    lastUpdatedAt: options.timestamp,
  };
}

export function countIterable<TValue>(values: Iterable<TValue>): number {
  let count = 0;
  for (const _value of values) {
    count += 1;
  }
  return count;
}

export function isEntityRelevantToPlayer<TPlayer extends SnapshotPlayer, TEntity extends SnapshotEntity>(
  player: TPlayer,
  entity: TEntity,
  radius: number,
): boolean {
  const dx = entity.position.x - player.position.x;
  const dy = entity.position.y - player.position.y;
  const dz = entity.position.z - player.position.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

export function cloneEntitySnapshot<TEntity extends SnapshotEntity>(
  entity: TEntity,
  cloneStatusMovementModifier: (modifier: unknown) => unknown,
): Record<string, unknown> {
  return {
    ...entity,
    position: { ...entity.position },
    rotation: { ...entity.rotation },
    velocity: entity.velocity ? { ...entity.velocity } : undefined,
    equipment: entity.equipment ? [...entity.equipment] : undefined,
    statusMovementModifier: entity.statusMovementModifier
      ? cloneStatusMovementModifier(entity.statusMovementModifier)
      : undefined,
  };
}

export function computeDelta<TEntity extends SnapshotEntity>(
  curr: TEntity,
  prev: Record<string, unknown> | undefined,
  statusMovementModifiersEqual: (left: unknown, right: unknown) => boolean,
): Record<string, unknown> | null {
  if (!prev) return { ...curr };

  const delta: Record<string, unknown> = {};
  let changed = false;

  const compareVec3 = (key: string, a: Vec3, b: Vec3 | undefined): void => {
    if (!b || Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) > 0.001 || Math.abs(a.z - b.z) > 0.001) {
      delta[key] = a;
      changed = true;
    }
  };

  compareVec3('position', curr.position, prev.position as Vec3 | undefined);
  compareVec3('rotation', curr.rotation, prev.rotation as Vec3 | undefined);
  if (curr.velocity) {
    compareVec3('velocity', curr.velocity, prev.velocity as Vec3 | undefined);
  }

  const comparableFields = [
    'health',
    'maxHealth',
    'shield',
    'maxShield',
    'mana',
    'maxMana',
    'state',
    'isCrouching',
    'isGrounded',
    'isAirborne',
    'dead',
    'name',
    'kills',
    'deaths',
    'level',
    'exp',
    'ping',
    'equipment',
    'activeWeaponId',
    'currentAmmo',
    'reserveAmmo',
    'isReloading',
    'isPlayerControlled',
  ] as const;

  for (const key of comparableFields) {
    const currentValue = curr[key];
    const previousValue = prev[key];
    const same = Array.isArray(currentValue)
      ? arraysEqual(currentValue, previousValue)
      : currentValue === previousValue;
    if (!same) {
      delta[key] = currentValue;
      changed = true;
    }
  }

  if (!statusMovementModifiersEqual(curr.statusMovementModifier ?? null, prev.statusMovementModifier ?? null)) {
    delta.statusMovementModifier = curr.statusMovementModifier;
    changed = true;
  }

  return changed ? delta : null;
}

export function arraysEqual(currentValue: unknown, previousValue: unknown): boolean {
  if (!Array.isArray(currentValue) || !Array.isArray(previousValue)) {
    return false;
  }
  if (currentValue.length !== previousValue.length) {
    return false;
  }
  for (let index = 0; index < currentValue.length; index += 1) {
    if (currentValue[index] !== previousValue[index]) {
      return false;
    }
  }
  return true;
}