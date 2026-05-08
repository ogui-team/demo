import type { Entity, Vector3 } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { LocalPlayerAuthorityCoordinator } from './LocalPlayerAuthorityCoordinator';

export interface AuthoritativeSnapshotEntity {
  id: string;
  networkEntityId?: string;
  position?: Vector3;
  rotation?: Vector3;
  velocity?: Vector3;
  type?: string;
}

export interface AuthoritativeSnapshotSummaryPayload {
  tick: number;
  ack: number;
  timestamp?: number;
  entities: AuthoritativeSnapshotEntity[];
  round?: {
    status?: string | null;
    timeRemainingMs?: number | null;
  };
  events: Array<{ type: string }>;
}

export interface AuthoritativeSnapshotSummary {
  tick: number;
  ack: number;
  entityCount: number;
  containsLocalPlayer: boolean;
  localPlayerEntityId: string | null;
  localPlayerHasPosition: boolean;
  roundStatus: string | null;
  roundTimeRemainingMs: number | null;
  eventTypes: string[];
}

export type LocalPlayerActualizationState = 'idle' | 'awaiting_snapshot' | 'snapshot_received' | 'actualized' | 'forced';

export interface LocalPlayerActualizedPayload {
  playerId: string | null;
  entityId: string | null;
  tick: number | null;
  forced: boolean;
  latencyMs: number | null;
  source: string;
}

interface LocalBindingStatus {
  isBound: boolean;
  entityId?: string | null;
  playerId?: string | null;
  networkEntityId?: string | null;
}

interface LocalTransformState {
  position: Vector3;
  rotation: Vector3;
}

interface LocalPlayerActualizationTriggerOptions {
  playerId?: string | null;
  entityId?: string | null;
  tick?: number | null;
  forced?: boolean;
  source: string;
}

export interface LocalPlayerBootstrapCoordinatorConfig {
  authorityCoordinator: LocalPlayerAuthorityCoordinator;
  getMultiplayerState: () => {
    connected: boolean;
    playerId: string | null;
    lastSnapshot: AuthoritativeSnapshotSummaryPayload | null;
  };
  getActiveRuntimePlayerId: () => string | null;
  getLocalPlayerEntity: () => Entity | null;
  getLocalBindingStatus: () => LocalBindingStatus;
  getLocalTransform: () => LocalTransformState | null;
  getLastLocalSnapshotTick: () => number | null | undefined;
  getLastAppliedSnapshotTick: () => number | null | undefined;
  resetPlayController: () => void;
  stopInputSending: () => void;
  logDiagnostic: (message: string, details?: Record<string, unknown>) => void;
  emitActualized: (payload: LocalPlayerActualizedPayload) => void;
  actualizationTimeoutMs?: number;
}

export class LocalPlayerBootstrapCoordinator {
  private readonly config: LocalPlayerBootstrapCoordinatorConfig;
  private awaitingAuthoritativeSpawn = false;
  private localPlayerDead = false;
  private actualizationState: LocalPlayerActualizationState = 'idle';
  private lastAuthoritativeSnapshotSummary: AuthoritativeSnapshotSummary | null = null;
  private localPlayerFoundInSnapshot = false;
  private lastValidSnapshotTick: number | null = null;
  private actualizationLatencyMs: number | null = null;
  private authoritativeSpawnRequestedAt = 0;
  private actualizationTimeoutId: number | null = null;

  constructor(config: LocalPlayerBootstrapCoordinatorConfig) {
    this.config = config;
  }

  isAwaitingAuthoritativeSpawn(): boolean {
    return this.awaitingAuthoritativeSpawn;
  }

  isLocalPlayerDead(): boolean {
    return this.localPlayerDead;
  }

  setLocalPlayerDead(dead: boolean): void {
    this.localPlayerDead = dead;
  }

  getActualizationState(): LocalPlayerActualizationState {
    return this.actualizationState;
  }

  getActualizationLatencyMs(): number | null {
    return this.actualizationLatencyMs;
  }

  getLastValidSnapshotTick(): number | null {
    return this.lastValidSnapshotTick;
  }

  hasLocalPlayerInSnapshot(): boolean {
    return this.localPlayerFoundInSnapshot;
  }

  getLastAuthoritativeSnapshotSummary(): AuthoritativeSnapshotSummary | null {
    return this.lastAuthoritativeSnapshotSummary;
  }

  reset(): void {
    this.awaitingAuthoritativeSpawn = false;
    this.localPlayerDead = false;
    this.actualizationState = 'idle';
    this.lastAuthoritativeSnapshotSummary = null;
    this.localPlayerFoundInSnapshot = false;
    this.lastValidSnapshotTick = null;
    this.actualizationLatencyMs = null;
    this.authoritativeSpawnRequestedAt = 0;
    this.cancelActualizationFailsafe();
  }

  summarizeAuthoritativeSnapshot(payload: AuthoritativeSnapshotSummaryPayload): AuthoritativeSnapshotSummary {
    const localEntity = this.findLocalAuthoritativeSnapshotEntity(payload.entities);

    return {
      tick: payload.tick,
      ack: payload.ack,
      entityCount: payload.entities.length,
      containsLocalPlayer: !!localEntity,
      localPlayerEntityId: localEntity?.id ?? null,
      localPlayerHasPosition: !!localEntity?.position,
      roundStatus: payload.round?.status ?? null,
      roundTimeRemainingMs: payload.round?.timeRemainingMs ?? null,
      eventTypes: payload.events.map((event) => event.type),
    };
  }

  findLocalAuthoritativeSnapshotEntity(
    entities: AuthoritativeSnapshotEntity[],
    playerId: string | null = this.config.getMultiplayerState().playerId,
  ): AuthoritativeSnapshotEntity | null {
    const expectedIds = new Set(this.getExpectedLocalSnapshotIds(playerId));

    return entities.find((entity) => {
      const maybeNetworkEntityId = typeof entity.networkEntityId === 'string' ? entity.networkEntityId : null;
      return expectedIds.has(entity.id) || (!!maybeNetworkEntityId && expectedIds.has(maybeNetworkEntityId));
    }) ?? null;
  }

  updateAuthoritativeSnapshotTracking(payload: AuthoritativeSnapshotSummaryPayload): void {
    const localEntity = this.findLocalAuthoritativeSnapshotEntity(payload.entities);
    const previouslyFound = this.localPlayerFoundInSnapshot;

    this.lastValidSnapshotTick = payload.tick;
    this.lastAuthoritativeSnapshotSummary = this.summarizeAuthoritativeSnapshot(payload);
    this.localPlayerFoundInSnapshot = !!localEntity;

    if (this.localPlayerFoundInSnapshot && (!previouslyFound || this.awaitingAuthoritativeSpawn)) {
      this.config.logDiagnostic('LOCAL PLAYER FOUND', {
        tick: payload.tick,
        playerId: this.config.getMultiplayerState().playerId,
        entityId: localEntity?.id ?? null,
        expectedIds: this.getExpectedLocalSnapshotIds(this.config.getMultiplayerState().playerId),
        hasPosition: !!localEntity?.position,
      });
    }

    if (this.awaitingAuthoritativeSpawn && this.localPlayerFoundInSnapshot) {
      this.actualizationState = 'snapshot_received';
    }
  }

  syncLocalPlayerToAuthoritativeSpawn(
    position: Vector3,
    rotation?: Vector3,
    options: { source?: string; tick?: number | null; forced?: boolean } = {},
  ): void {
    const multiplayerState = this.config.getMultiplayerState();
    const runtimePlayerId = this.config.getActiveRuntimePlayerId() ?? multiplayerState.playerId ?? 'LocalPlayer';
    const binding = this.config.getLocalBindingStatus();
    const liveEntityId = binding.entityId ?? this.config.getLocalPlayerEntity()?.id ?? null;
    const localTransform = this.config.getLocalTransform();
    const correctionDistance = localTransform
      ? Math.hypot(
          position.x - localTransform.position.x,
          position.y - localTransform.position.y,
          position.z - localTransform.position.z,
        )
      : null;
    const alreadyActualized = this.actualizationState === 'actualized' || this.actualizationState === 'forced';
    const canReuseLiveBinding = !this.awaitingAuthoritativeSpawn
      && !this.localPlayerDead
      && !options.forced
      && alreadyActualized
      && binding.isBound
      && !!liveEntityId;

    if (canReuseLiveBinding) {
      this.config.authorityCoordinator.forceAuthoritativeState(
        runtimePlayerId,
        multiplayerState.connected ? 'remote' : 'local',
        position,
        rotation ?? { x: 0, y: 0, z: 0 },
      );
      this.config.logDiagnostic('ACTUALIZATION SKIPPED', {
        playerId: runtimePlayerId,
        entityId: liveEntityId,
        tick: options.tick ?? this.lastValidSnapshotTick,
        forced: false,
        source: options.source ?? 'sync_local_player_to_authoritative_spawn',
        correctionDistance,
        actualizationState: this.actualizationState,
      });
      return;
    }

    this.config.resetPlayController();

    this.config.authorityCoordinator.forceAuthoritativeState(
      runtimePlayerId,
      multiplayerState.connected ? 'remote' : 'local',
      position,
      rotation ?? { x: 0, y: 0, z: 0 },
    );

    this.triggerLocalPlayerActualization({
      playerId: runtimePlayerId,
      entityId: this.config.getLocalPlayerEntity()?.id ?? null,
      tick: options.tick ?? this.lastValidSnapshotTick,
      forced: options.forced ?? false,
      source: options.source ?? 'sync_local_player_to_authoritative_spawn',
    });
  }

  requestAuthoritativeSpawnSync(): void {
    this.awaitingAuthoritativeSpawn = true;
    this.localPlayerDead = false;
    this.actualizationState = 'awaiting_snapshot';
    this.localPlayerFoundInSnapshot = false;
    this.lastValidSnapshotTick = null;
    this.actualizationLatencyMs = null;
    this.authoritativeSpawnRequestedAt = Date.now();
    this.cancelActualizationFailsafe();
    this.scheduleActualizationFailsafe('request_authoritative_spawn_sync');
    this.config.stopInputSending();
  }

  private triggerLocalPlayerActualization(options: LocalPlayerActualizationTriggerOptions): void {
    const binding = this.config.getLocalBindingStatus();
    const playerId = options.playerId ?? this.config.getActiveRuntimePlayerId() ?? this.config.getMultiplayerState().playerId ?? binding.playerId ?? null;
    const entityId = options.entityId ?? binding.entityId ?? this.config.getLocalPlayerEntity()?.id ?? null;
    const tick = options.tick ?? this.lastValidSnapshotTick ?? this.config.getLastLocalSnapshotTick() ?? this.config.getLastAppliedSnapshotTick() ?? null;
    const forced = options.forced ?? false;
    const latencyMs = this.authoritativeSpawnRequestedAt > 0 ? Date.now() - this.authoritativeSpawnRequestedAt : null;

    this.actualizationLatencyMs = latencyMs;
    this.actualizationState = forced ? 'forced' : 'actualized';
    this.awaitingAuthoritativeSpawn = false;
    this.localPlayerDead = false;
    this.authoritativeSpawnRequestedAt = 0;
    this.cancelActualizationFailsafe();

    this.config.logDiagnostic('ACTUALIZATION TRIGGERED', {
      playerId,
      entityId,
      tick,
      forced,
      latencyMs,
      source: options.source,
    });

    this.config.emitActualized({
      playerId,
      entityId,
      tick,
      forced,
      latencyMs,
      source: options.source,
    });

    if (playerId && entityId) {
      gameBus.emit('ENTITY_SPAWNED', {
        entityId,
        playerId,
        source: 'local_player_actualization',
        timestamp: Date.now(),
      });
    }
  }

  scheduleActualizationFailsafe(source: string): void {
    this.cancelActualizationFailsafe();
    const multiplayerState = this.config.getMultiplayerState();
    if (!this.awaitingAuthoritativeSpawn || !multiplayerState.connected) return;

    this.actualizationTimeoutId = window.setTimeout(() => {
      this.actualizationTimeoutId = null;
      const currentMultiplayerState = this.config.getMultiplayerState();
      if (!this.awaitingAuthoritativeSpawn || !currentMultiplayerState.connected) return;

      const snapshot = currentMultiplayerState.lastSnapshot;
      const binding = this.config.getLocalBindingStatus();
      const localTransform = this.config.getLocalTransform();
      if (!snapshot || !binding.isBound || !binding.entityId || !localTransform) return;

      this.syncLocalPlayerToAuthoritativeSpawn(localTransform.position, localTransform.rotation, {
        source: `${source}:timeout`,
        tick: snapshot.tick,
        forced: true,
      });
    }, this.config.actualizationTimeoutMs ?? 500);
  }

  private cancelActualizationFailsafe(): void {
    if (this.actualizationTimeoutId !== null) {
      window.clearTimeout(this.actualizationTimeoutId);
      this.actualizationTimeoutId = null;
    }
  }

  private getExpectedLocalSnapshotIds(playerId: string | null): string[] {
    const binding = this.config.getLocalBindingStatus();
    const ids = new Set<string>();

    const addId = (value: unknown): void => {
      if (typeof value === 'string' && value.trim().length > 0) {
        ids.add(value);
      }
    };

    addId(playerId);
    addId(binding.playerId);
    addId(binding.networkEntityId);

    return [...ids];
  }
}