import { gameBus } from '@engine/1-kernel/core/public-api';
import { listSystems } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext, EngineSystem } from '@engine/1-kernel/core/public-api';
import type { EntityManager } from '@engine/1-kernel/core/public-api';
import type { MultiplayerClient } from '../../3-network/network/MultiplayerClient';
import type { NetworkSyncSystem, MovementAuthorityDebugState } from '../../3-network/network/NetworkSyncSystem';
import type { PlayerModelSystem } from '../../2-systems/gameplay/game/PlayerModelSystem';
import type { StatusMovementModifier } from '../../3-network/network/MovementModifierContracts';

type Vector3Like = { x: number; y: number; z: number };

export interface ControlTowerInsight {
  id: string;
  severity: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

export interface ControlTowerPlayerState {
  id: string;
  clientPosition: Vector3Like | null;
  serverPosition: Vector3Like | null;
  velocity: Vector3Like | null;
  movementIntent: MovementAuthorityDebugState['movementIntent'] | null;
  statusModifier: StatusMovementModifier | null;
  animationState: {
    crouching: boolean;
    airborne: boolean;
    source: 'local' | 'remote' | 'missing';
  };
  desyncDelta: number;
}

export interface ControlTowerReplicationState {
  snapshotRate: number;
  packetIn: number;
  packetOut: number;
  desyncDelta: number;
  lastAppliedSnapshotTick: number | null;
  lastLocalSnapshotTick: number | null;
  snapshotAgeMs: number | null;
  ackInputSeq: number | null;
}

export interface ControlTowerSystemEntry {
  id: string;
  status: 'active' | 'disabled' | 'error';
  lastError: string | null;
}

export interface ControlTowerSystemState {
  status: 'active' | 'degraded' | 'recovering';
  activeCount: number;
  degradedCount: number;
  recoveringCount: number;
  entries: ControlTowerSystemEntry[];
}

export interface ControlTowerEntityState {
  active: number;
  tracked: number;
  worldObjects: number;
  orphanCandidates: number;
  physicsBodies: number;
}

export interface ControlTowerState {
  /**
   * Index signature required so `ControlTowerState` is assignable to
   * `Record<string, unknown>` — the type expected by `RuntimeIssueSnapshot.controlTower`
   * and any generic StateManager or debug-serialisation path.
   * Every named property below is a subtype of `unknown`, so no named-field
   * conflicts arise and `StateManager.deepFreeze` is unaffected (it iterates
   * runtime keys, not compile-time index signatures).
   */
  [key: string]: unknown;
  generatedAt: number;
  players: ControlTowerPlayerState[];
  replication: ControlTowerReplicationState;
  systems: ControlTowerSystemState;
  entities: ControlTowerEntityState;
  insights: ControlTowerInsight[];
}

interface LocalCorrectionSample {
  timestamp: number;
  correctionDistance: number;
}

interface LocalInputSample {
  timestamp: number;
  jump: boolean;
  crouch: boolean;
}

const CONTROL_TOWER_SAMPLE_INTERVAL_MS = 250;
const REPLICATION_STALE_MS = 250;
const INSIGHT_HISTORY_LIMIT = 8;

function vectorDistance(left: Vector3Like | null | undefined, right: Vector3Like | null | undefined): number {
  if (!left || !right) return 0;
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalizeModifier(modifier: StatusMovementModifier | null | undefined): StatusMovementModifier | null {
  if (!modifier) return null;
  const normalized: StatusMovementModifier = {};
  if (typeof modifier.speedMultiplier === 'number') {
    normalized.speedMultiplier = modifier.speedMultiplier;
  }
  if (modifier.blockMovement === true) {
    normalized.blockMovement = true;
  }
  if (modifier.impulseOverride) {
    normalized.impulseOverride = {
      x: modifier.impulseOverride.x,
      y: modifier.impulseOverride.y,
      z: modifier.impulseOverride.z,
    };
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function formatVector3(value: Vector3Like | null | undefined): Vector3Like | null {
  if (!value) return null;
  return { x: Number(value.x.toFixed(2)), y: Number(value.y.toFixed(2)), z: Number(value.z.toFixed(2)) };
}

export class ControlTower implements EngineSystem {
  id = 'controlTower';

  private systemContext: SystemContext | null = null;
  private snapshot: ControlTowerState = this.createEmptySnapshot();
  private lastSampleAt = 0;
  private readonly snapshotTimes: number[] = [];
  private readonly recentInputs = new Map<string, LocalInputSample>();
  private readonly recentCorrections = new Map<string, LocalCorrectionSample>();
  private readonly eventDisposers: Array<() => void> = [];

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    this.disposeEventListeners();
    this.installEventListeners();
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
      status: 'ok',
      active: true,
      metrics: {
        players: this.snapshot.players.length,
        snapshotsTracked: this.snapshotTimes.length,
        lastSampleAt: this.lastSampleAt,
        insights: this.snapshot.insights.length,
        systems: this.snapshot.systems.status,
      },
      snapshot: this.snapshot,
    };
  }

  update(): void {
    if (!this.systemContext) return;
    const now = Engine.time.now();
    if (now - this.lastSampleAt < CONTROL_TOWER_SAMPLE_INTERVAL_MS) return;
    this.lastSampleAt = now;
    this.pruneSnapshotWindow(now);
    this.snapshot = this.sampleState(now);
  }

  getSnapshot(): ControlTowerState {
    return this.snapshot;
  }

  dispose(): void {
    this.disposeEventListeners();
  }

  private installEventListeners(): void {
    this.eventDisposers.push(
      gameBus.on('SNAPSHOT_RECEIVED', (payload) => {
        this.snapshotTimes.push(payload.timestamp);
        this.pruneSnapshotWindow(payload.timestamp);
      }),
    );

    this.eventDisposers.push(
      gameBus.on('ENTITY_RECONCILED', (payload) => {
        this.recentCorrections.set(payload.playerId, {
          timestamp: Engine.time.now(),
          correctionDistance: payload.correctionDistance,
        });
      }),
    );

    this.eventDisposers.push(
      gameBus.on('playerInput', (payload) => {
        this.recentInputs.set(payload.playerId, {
          timestamp: payload.timestamp,
          jump: Boolean(payload.input.jump),
          crouch: Boolean(payload.input.crouch),
        });
      }),
    );

    this.eventDisposers.push(
      gameBus.on('COMMAND_SENT', (payload) => {
        this.recentInputs.set(payload.playerId, {
          timestamp: payload.timestamp,
          jump: Boolean(payload.input.jump),
          crouch: Boolean(payload.input.crouch),
        });
      }),
    );
  }

  private disposeEventListeners(): void {
    while (this.eventDisposers.length > 0) {
      this.eventDisposers.pop()?.();
    }
  }

  private sampleState(now: number): ControlTowerState {
    const networkSync = this.resolveSystem('networkSyncSystem') as NetworkSyncSystem | null;
    const playerModel = this.resolveSystem('playerModelSystem') as PlayerModelSystem | null;
    const entityManager = this.systemContext?.entityManager ?? null;
    const worldObjectAuthority = this.resolveSystem('worldObjectAuthorityService') as { getDiagnostics?: () => Record<string, unknown> } | null;
    const physicsSystem = this.resolveSystem('physicsSystem') as { getBodyIds?: () => string[] } | null;
    const multiplayerClient = this.systemContext?.network.getClient() ?? null;
    const networkSnapshot = this.systemContext?.network.getSnapshot() ?? null;

    const networkDiagnostics = (networkSync?.getDiagnostics() ?? {}) as {
      localBinding?: { playerId: string | null };
      lastAppliedSnapshotTick?: number | null;
      lastLocalSnapshotTick?: number | null;
      bindings?: Array<{
        playerId: string;
        entityId: string;
        networkEntityId?: string | null;
        position?: Vector3Like;
        velocity?: Vector3Like;
        correctionDistance?: number;
        statusMovementModifier?: StatusMovementModifier | null;
        effectiveStatusMovementModifier?: StatusMovementModifier | null;
      }>;
    };

    const clientMovementState = networkSync?.getLocalResolvedMovementState();
    const playerModelDebug = (playerModel?.getDebugState() ?? {}) as {
      localPresentationMovementState?: { isCrouching: boolean; isAirborne: boolean };
    };
    const playerModelStates = playerModel?.getMovementDebugStates?.() ?? [];
    const playerModelStateById = new Map(playerModelStates.map((state) => [state.playerId, state]));

    const snapshotByEntityId = new Map<string, Vector3Like>();
    if (networkSnapshot) {
      for (const entity of networkSnapshot.entities) {
        if (entity.transform?.position) {
          snapshotByEntityId.set(entity.entityId, entity.transform.position);
        }
      }
    }

    const players: ControlTowerPlayerState[] = [];
    const bindings = networkDiagnostics.bindings ?? [];
    for (const binding of bindings) {
      const authoritativePosition = snapshotByEntityId.get(binding.networkEntityId ?? binding.entityId) ?? null;
      const movementDebug = networkSync?.getMovementAuthorityDebugState(binding.playerId) ?? null;
      const animationState = binding.playerId === networkDiagnostics.localBinding?.playerId
        ? {
            crouching: playerModelDebug.localPresentationMovementState?.isCrouching ?? clientMovementState?.isCrouching ?? false,
            airborne: playerModelDebug.localPresentationMovementState?.isAirborne ?? clientMovementState?.isAirborne ?? false,
            source: 'local' as const,
          }
        : (() => {
            const remoteModelState = playerModelStateById.get(binding.playerId);
            if (!remoteModelState) {
              return { crouching: false, airborne: false, source: 'missing' as const };
            }
            return {
              crouching: remoteModelState.isCrouching,
              airborne: remoteModelState.isAirborne,
              source: 'remote' as const,
            };
          })();

      players.push({
        id: binding.playerId,
        clientPosition: formatVector3(binding.position ?? null),
        serverPosition: formatVector3(authoritativePosition),
        velocity: formatVector3(binding.velocity ?? null),
        movementIntent: movementDebug?.movementIntent ?? null,
        statusModifier: normalizeModifier(binding.effectiveStatusMovementModifier ?? binding.statusMovementModifier ?? null),
        animationState,
        desyncDelta: typeof binding.correctionDistance === 'number' ? binding.correctionDistance : vectorDistance(binding.position ?? null, authoritativePosition),
      });
    }

    players.sort((left, right) => {
      const localPlayerId = networkDiagnostics.localBinding?.playerId;
      if (left.id === localPlayerId) return -1;
      if (right.id === localPlayerId) return 1;
      return left.id.localeCompare(right.id);
    });

    const replication = this.buildReplicationState(networkSync, multiplayerClient, networkSnapshot, networkDiagnostics);
    const entities = this.buildEntityState(entityManager, worldObjectAuthority, physicsSystem, players.length);
    const systems = this.buildSystemState(replication, entities);
    const insights = this.buildInsights(players, replication, systems, networkSync);

    return {
      generatedAt: now,
      players,
      replication,
      systems,
      entities,
      insights,
    };
  }

  private buildReplicationState(
    networkSync: NetworkSyncSystem | null,
    multiplayerClient: MultiplayerClient | null,
    networkSnapshot: { ackInputSeq: number; timestamp: number } | null,
    diagnostics: {
      lastAppliedSnapshotTick?: number | null;
      lastLocalSnapshotTick?: number | null;
    },
  ): ControlTowerReplicationState {
    const now = Engine.time.now();
    const localCorrection = networkSync?.getDiagnostics?.() as { bindings?: Array<{ playerId: string; correctionDistance?: number }> } | undefined;
    const localPlayerId = networkSync?.getLocalBindingStatus?.().playerId ?? null;
    const localBinding = localPlayerId && localCorrection?.bindings
      ? localCorrection.bindings.find((binding) => binding.playerId === localPlayerId)
      : null;
    const correctionDistance = localBinding?.correctionDistance ?? 0;
    const snapshotRate = this.snapshotTimes.length;
    const debugStats = multiplayerClient?.getDebugStats?.() ?? null;

    return {
      snapshotRate,
      packetIn: debugStats?.packetsInPerSec ?? 0,
      packetOut: debugStats?.packetsOutPerSec ?? 0,
      desyncDelta: correctionDistance,
      lastAppliedSnapshotTick: diagnostics.lastAppliedSnapshotTick ?? null,
      lastLocalSnapshotTick: diagnostics.lastLocalSnapshotTick ?? null,
      snapshotAgeMs: this.snapshotTimes.length > 0 ? now - this.snapshotTimes[this.snapshotTimes.length - 1] : null,
      ackInputSeq: networkSnapshot?.ackInputSeq ?? null,
    };
  }

  private buildEntityState(
    entityManager: EntityManager | null,
    worldObjectAuthority: { getDiagnostics?: () => Record<string, unknown> } | null,
    physicsSystem: { getBodyIds?: () => string[] } | null,
    playerCount: number,
  ): ControlTowerEntityState {
    const entityDiagnostics = (entityManager?.getDiagnostics?.() ?? {}) as { metrics?: { count?: number; totalTrackedEntities?: number } };
    const worldObjectDiagnostics = (worldObjectAuthority?.getDiagnostics?.() ?? {}) as { mappedWorldObjects?: number };
    const active = entityDiagnostics.metrics?.count ?? 0;
    const tracked = entityDiagnostics.metrics?.totalTrackedEntities ?? active;
    const worldObjects = worldObjectDiagnostics.mappedWorldObjects ?? 0;
    const physicsBodies = physicsSystem?.getBodyIds?.().length ?? 0;
    const orphanCandidates = Math.max(0, active - worldObjects - playerCount);

    return {
      active,
      tracked,
      worldObjects,
      orphanCandidates,
      physicsBodies,
    };
  }

  private buildSystemState(replication: ControlTowerReplicationState, entities: ControlTowerEntityState): ControlTowerSystemState {
    const entries = listSystems()
      .map((entry) => ({
        id: entry.name,
        status: entry.status,
        lastError: entry.lastError,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    const degradedCount = entries.filter((entry) => entry.status === 'error').length;
    const activeCount = entries.filter((entry) => entry.status === 'active').length;
    const recoveringCount = replication.desyncDelta > 0.15 || (replication.snapshotAgeMs !== null && replication.snapshotAgeMs < REPLICATION_STALE_MS && replication.desyncDelta > 0.05)
      ? 1
      : 0;

    let status: ControlTowerSystemState['status'] = 'active';
    if (degradedCount > 0 || replication.snapshotAgeMs !== null && replication.snapshotAgeMs > REPLICATION_STALE_MS || entities.orphanCandidates > 0) {
      status = 'degraded';
    } else if (recoveringCount > 0) {
      status = 'recovering';
    }

    return {
      status,
      activeCount,
      degradedCount,
      recoveringCount,
      entries: entries.slice(0, 12),
    };
  }

  private buildInsights(
    players: ControlTowerPlayerState[],
    replication: ControlTowerReplicationState,
    systems: ControlTowerSystemState,
    networkSync: NetworkSyncSystem | null,
  ): ControlTowerInsight[] {
    const insights: ControlTowerInsight[] = [];
    const localPlayerId = networkSync?.getLocalBindingStatus?.().playerId ?? null;
    const localPlayer = localPlayerId ? players.find((player) => player.id === localPlayerId) ?? null : null;
    const localMovementState = networkSync?.getLocalResolvedMovementState?.() ?? null;
    const recentInput = localPlayerId ? this.recentInputs.get(localPlayerId) ?? null : null;
    const recentCorrection = localPlayerId ? this.recentCorrections.get(localPlayerId) ?? null : null;

    if (replication.snapshotAgeMs !== null && replication.snapshotAgeMs > REPLICATION_STALE_MS) {
      insights.push({
        id: 'replication-stale',
        severity: 'warn',
        source: 'replication',
        message: `Replication stale for ${Math.round(replication.snapshotAgeMs)} ms`,
      });
    }

    if (localPlayer && recentInput?.jump && recentCorrection && recentCorrection.correctionDistance > 0.2 && localMovementState && !localMovementState.isAirborne) {
      insights.push({
        id: 'jump-overridden',
        severity: 'warn',
        source: 'movement',
        message: 'Jump overridden by server reconciliation',
      });
    }

    if (localPlayer && localMovementState && (localPlayer.animationState.airborne !== localMovementState.isAirborne || localPlayer.animationState.crouching !== localMovementState.isCrouching)) {
      insights.push({
        id: 'animation-mismatch',
        severity: 'warn',
        source: 'animation',
        message: 'Animation mismatch detected between movement truth and presentation state',
      });
    }

    if (systems.degradedCount > 0) {
      insights.push({
        id: 'system-degraded',
        severity: 'error',
        source: 'systems',
        message: `${systems.degradedCount} system(s) reported errors`,
      });
    }

    if (insights.length === 0) {
      insights.push({
        id: 'tower-healthy',
        severity: 'info',
        source: 'controlTower',
        message: 'Control tower sampling is healthy',
      });
    }

    if (insights.length > INSIGHT_HISTORY_LIMIT) {
      return insights.slice(0, INSIGHT_HISTORY_LIMIT);
    }

    return insights;
  }

  private pruneSnapshotWindow(now: number): void {
    while (this.snapshotTimes.length > 0 && now - this.snapshotTimes[0] > 1000) {
      this.snapshotTimes.shift();
    }
  }

  private resolveSystem<T = unknown>(name: string): T | null {
    return this.systemContext?.resolveSystem ? this.systemContext.resolveSystem<T>(name) : (this.systemContext?.systems?.[name] as T | null | undefined) ?? null;
  }

  private createEmptySnapshot(): ControlTowerState {
    return {
      generatedAt: Engine.time.now(),
      players: [],
      replication: {
        snapshotRate: 0,
        packetIn: 0,
        packetOut: 0,
        desyncDelta: 0,
        lastAppliedSnapshotTick: null,
        lastLocalSnapshotTick: null,
        snapshotAgeMs: null,
        ackInputSeq: null,
      },
      systems: {
        status: 'active',
        activeCount: 0,
        degradedCount: 0,
        recoveringCount: 0,
        entries: [],
      },
      entities: {
        active: 0,
        tracked: 0,
        worldObjects: 0,
        orphanCandidates: 0,
        physicsBodies: 0,
      },
      insights: [],
    };
  }
}