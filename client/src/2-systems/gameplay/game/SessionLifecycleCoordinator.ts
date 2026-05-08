import { gameBus } from '@engine/1-kernel/core/public-api';
import type { LocalPlayerActualizationState } from './LocalPlayerBootstrapCoordinator';
import type { SessionAuthorityIntent } from '../../../1-kernel/core/EngineController';

type ResetPhase = 'soft' | 'full';
type RuntimeMetricsSessionKind = 'multiplayer' | 'scripted' | 'freeplay';
type RuntimeAppState = 'lobby' | 'starting' | 'in_game' | 'post_game';
type InGamePlayerMode = 'play' | 'spectator' | 'editor';

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

interface LocalTransformState {
  position: Vector3Like;
  rotation: Vector3Like;
}

interface ConnectedPayload {
  playerId: string;
  roomId: string;
  hosted?: boolean;
}

interface PlayerDeathPayload {
  playerId: string;
}

interface PlayerRespawnPayload {
  playerId: string;
  position: Vector3Like;
}

interface LocalPlayerActualizedPayload {
  playerId: string | null;
  entityId: string | null;
  tick: number | null;
  forced: boolean;
  latencyMs: number | null;
  source: string;
}

export interface SessionLifecycleCoordinatorConfig {
  getLifecycleState: () => string;
  getRoundNumber: () => number;
  getActiveRuntimePlayerId: () => string | null;
  setPendingMatchResetMode: (mode: ResetPhase) => void;
  isState: (state: RuntimeAppState) => boolean;
  transitionEngineState: (target: RuntimeAppState, reason: string) => boolean;
  setInGameModePanelMode: (mode: InGamePlayerMode) => void;
  setHudPlayerId: (playerId: string) => void;
  requestRuntimeAuthorityIntent: (intent: SessionAuthorityIntent, reason: string) => void;
  ensureGameplayUiActive: () => void;
  cancelInteractionTools: (reason: string) => void;
  bindPlayController: (entityId: string | null) => void;
  isInputGateReady: (playerId: string | null) => boolean;
  enablePlayController: () => void;
  resetPlayController: () => void;
  setLocalPlayerDead: (dead: boolean) => void;
  getLocalPlayerActualizationState: () => LocalPlayerActualizationState;
  resetLocalPlayerBootstrap: () => void;
  requestAuthoritativeSpawnSync: () => void;
  startInputSending: () => void;
  stopInputSending: () => void;
  syncPlayControllerToLocalRotation: () => void;
  syncCameraToLocalPlayerEntity: () => void;
  logSpawnDiagnostic: (message: string, details?: Record<string, unknown>) => void;
  ensurePlayerRuntimeState: (playerId: string) => void;
  initInventoryGrid: (playerId: string) => Promise<void> | void;
  setRuntimePlayerId: (playerId: string | null) => void;
  bindNetworkSyncLocalPlayer: (playerId: string, authorityMode: 'local' | 'remote') => void;
  attachInGameModePanelClient: (hosted: boolean) => void;
  setCommandSink: (sink: null) => void;
  setAuthorityMode: (mode: 'local' | 'remote') => void;
  clearPendingInputs: (playerId?: string) => void;
  resetNetworkSyncRuntime: () => void;
  getLocalTransform: () => LocalTransformState | null;
  forceLocalState: (position: Vector3Like, rotation: Vector3Like, velocity: Vector3Like) => void;
  cancelReload: (playerId: string) => void;
  resetPlayerState: (playerId: string, position: Vector3Like) => void;
  handleRemoteRespawn: (playerId: string, position: Vector3Like) => void;
  syncLocalPlayerToAuthoritativeSpawn: (position: Vector3Like, rotation: Vector3Like) => void;
  clearRemotePlayers: () => void;
  clearReplicatedWorldObjects: () => void;
  resetGameplayWorld: () => void;
  showServerBrowser: () => void;
  refreshServerList: () => void;
  isConnected: () => boolean;
  resetSessionTimestamps: () => void;
  markRoundStart: () => void;
  getRuntimeAppStateLabel: () => string;
  isGameplaySessionActive: () => boolean;
  isDebugEnabled: () => boolean;
}

export class SessionLifecycleCoordinator {
  private readonly config: SessionLifecycleCoordinatorConfig;
  private runtimeMetricsSessionId: string | null = null;

  /**
   * Tracks the player for whom inventory init has already been fired in
   * this session.  Prevents the double fire-and-forget that caused the
   * inventory initialization failure (handleConnected fires it, then
   * handleLocalPlayerActualized fires it again before the first resolves).
   * Cleared in handleDisconnected so reconnects get a fresh init.
   */
  private inventoryInitiatedForPlayerId: string | null = null;

  constructor(config: SessionLifecycleCoordinatorConfig) {
    this.config = config;
  }

  setRuntimeMetricsSession(kind: RuntimeMetricsSessionKind, identifier: string): void {
    this.runtimeMetricsSessionId = `${kind}:${identifier}`;
  }

  clearRuntimeMetricsSession(): void {
    this.runtimeMetricsSessionId = null;
  }

  getRuntimeMetricsSessionId(): string | null {
    if (this.runtimeMetricsSessionId) return this.runtimeMetricsSessionId;
    if (this.config.isDebugEnabled()) {
      return `debug:${this.config.getRuntimeAppStateLabel()}`;
    }
    return null;
  }

  shouldCaptureRuntimeMetrics(): boolean {
    return this.config.isGameplaySessionActive() || this.config.isDebugEnabled();
  }

  prepareRoundInitialization(reason: string, phase: ResetPhase = 'soft'): void {
    const runtimePlayerId = this.config.getActiveRuntimePlayerId();
    const actualizationState = this.config.getLocalPlayerActualizationState();
    const localPlayerAlreadyLive = !!runtimePlayerId && (
      actualizationState === 'actualized'
      || actualizationState === 'forced'
      || this.config.isInputGateReady(runtimePlayerId)
    );

    if (localPlayerAlreadyLive) {
      this.config.setLocalPlayerDead(false);
      this.config.ensurePlayerRuntimeState(runtimePlayerId);
      this.restoreLocalGameplayState(`prepare_round:${reason}`);
      this.config.logSpawnDiagnostic('PLAYER SPAWN REQUEST skipped', {
        reason,
        phase,
        playerId: runtimePlayerId,
        actualizationState,
      });
      return;
    }

    this.emitEngineReset(reason, phase);
    this.config.cancelInteractionTools(reason);
    this.config.bindPlayController(null);
    this.config.setLocalPlayerDead(false);
    this.config.stopInputSending();
    this.config.requestAuthoritativeSpawnSync();
    if (runtimePlayerId) {
      this.config.ensurePlayerRuntimeState(runtimePlayerId);
    }
    this.restoreLocalGameplayState(`prepare_round:${reason}`);
  }

  restoreLocalGameplayState(reason = 'session_restore'): void {
    const runtimePlayerId = this.config.getActiveRuntimePlayerId();
    if (runtimePlayerId) {
      this.config.setHudPlayerId(runtimePlayerId);
    }
    this.config.requestRuntimeAuthorityIntent('restore-local-gameplay', reason);
    this.config.ensureGameplayUiActive();
  }

  handleLocalPlayerActualized(payload: LocalPlayerActualizedPayload): void {
    if (payload.playerId) {
      this.config.setHudPlayerId(payload.playerId);
      this.config.ensurePlayerRuntimeState(payload.playerId);
      if (this.inventoryInitiatedForPlayerId !== payload.playerId) {
        this.inventoryInitiatedForPlayerId = payload.playerId;
        void this.config.initInventoryGrid(payload.playerId);
      }
    }
    this.restoreLocalGameplayState('local_player_actualized');
    this.config.bindPlayController(payload.entityId);
    const inputGateReady = this.config.isInputGateReady(payload.playerId);
    if (!inputGateReady) {
      this.config.logSpawnDiagnostic('DEBUG_MESH_BINDING_MISSING', {
        playerId: payload.playerId,
        entityId: payload.entityId,
        source: payload.source,
      });
    }
    this.config.syncPlayControllerToLocalRotation();
    this.config.syncCameraToLocalPlayerEntity();
    this.config.logSpawnDiagnostic('CAMERA ATTACHED', {
      playerId: payload.playerId,
      entityId: payload.entityId,
      tick: payload.tick,
      forced: payload.forced,
      source: payload.source,
    });
    this.config.logSpawnDiagnostic('INPUT ENABLED', {
      playerId: payload.playerId,
      entityId: payload.entityId,
      tick: payload.tick,
      forced: payload.forced,
      latencyMs: payload.latencyMs,
      source: payload.source,
      degradedMeshBinding: !inputGateReady,
    });

    // Ensure multiplayer input starts even if higher-level listeners race.
    this.config.startInputSending();
  }

  handleConnected(payload: ConnectedPayload): void {
    this.config.setRuntimePlayerId(payload.playerId);
    this.config.setHudPlayerId(payload.playerId);
    this.config.attachInGameModePanelClient(!!payload.hosted);
    this.setRuntimeMetricsSession('multiplayer', payload.roomId);
  }

  handleDisconnected(): void {
    // Clear dedup guard so the next connection issues a fresh inventory init.
    this.inventoryInitiatedForPlayerId = null;
    this.emitEngineReset('disconnect_cleanup', 'soft');
    this.config.cancelInteractionTools('disconnect_cleanup');
    this.config.bindPlayController(null);
    this.config.stopInputSending();
    this.config.resetNetworkSyncRuntime();
    this.config.clearRemotePlayers();
    this.config.clearReplicatedWorldObjects();
    this.config.resetGameplayWorld();
    this.config.setRuntimePlayerId(null);
    this.config.setCommandSink(null);
    this.config.setAuthorityMode('local');
    this.config.clearPendingInputs();
    this.config.resetLocalPlayerBootstrap();
    this.config.resetSessionTimestamps();
    this.config.requestRuntimeAuthorityIntent('disconnect-cleanup', 'disconnect_cleanup');
    this.clearRuntimeMetricsSession();

    if (this.config.isState('in_game') || this.config.isState('post_game') || this.config.isState('starting')) {
      this.config.transitionEngineState('lobby', 'disconnect_cleanup');
    }
    this.config.showServerBrowser();
    this.config.refreshServerList();
  }

  handleLocalPlayerDeath(payload: PlayerDeathPayload, localPlayerId: string | null): void {
    if (payload.playerId !== localPlayerId) return;

    this.config.setLocalPlayerDead(true);
    this.config.stopInputSending();
    this.config.cancelReload(payload.playerId);
    const localTransform = this.config.getLocalTransform();
    if (localTransform) {
      this.config.forceLocalState(localTransform.position, localTransform.rotation, { x: 0, y: 0, z: 0 });
    } else {
      this.config.clearPendingInputs();
    }
    this.config.resetPlayController();
  }

  handlePlayerRespawn(payload: PlayerRespawnPayload, localPlayerId: string | null): void {
    this.config.resetPlayerState(payload.playerId, payload.position);
    if (payload.playerId !== localPlayerId) {
      this.config.handleRemoteRespawn(payload.playerId, payload.position);
      return;
    }

    this.config.ensurePlayerRuntimeState(payload.playerId);
    this.restoreLocalGameplayState('player_respawn');
    // Respawn always needs a fresh inventory init (player slots may have changed).
    this.inventoryInitiatedForPlayerId = null;
    void this.config.initInventoryGrid(payload.playerId);
    this.config.clearPendingInputs(payload.playerId);
    this.config.syncLocalPlayerToAuthoritativeSpawn(payload.position, { x: 0, y: 0, z: 0 });
  }

  handleRoundEnd(): void {
    this.config.requestRuntimeAuthorityIntent('round-ended', 'round_end');
  }

  handleInitializeRound(reason: string): void {
    this.config.markRoundStart();
    if (this.config.isState('post_game')) {
      this.config.setPendingMatchResetMode('soft');
      this.config.transitionEngineState('in_game', `initialize_round:${reason}`);
    }
    this.prepareRoundInitialization(`initialize_round:${reason}`, 'soft');
  }

  private emitEngineReset(reason: string, phase: ResetPhase): void {
    gameBus.emit('ENGINE_RESET', {
      reason,
      phase,
      lifecycleState: this.config.getLifecycleState(),
      roundNumber: this.config.getRoundNumber(),
      playerId: this.config.getActiveRuntimePlayerId(),
    });
  }
}
