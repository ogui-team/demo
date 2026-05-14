import * as THREE from 'three';
import * as Engine from '../../../0-foundation/foundation/Engine';
import { getContext } from '../../../1-kernel/core/InputContext';
import { gameBus } from '../../../1-kernel/core/EventBus';
import { logEvent } from '../../../1-kernel/core/EventLogger';
import type { AuthoritativeSnapshotSummaryPayload } from '../../../2-systems/gameplay/game/LocalPlayerBootstrapCoordinator';
import { RuntimeDiagnosticsCoordinator } from '../../diagnostics/debug/RuntimeDiagnosticsCoordinator';
import { NetworkConnectionResolver } from '../../../3-network/network/NetworkConnectionResolver';
import type { StatusMovementModifier } from '../../../3-network/network/MovementModifierContracts';
import type { RuntimeMetricsReporter } from '../../diagnostics/debug/RuntimeMetricsReporter';
import type { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import type { NetworkMovementIntent, NetworkSyncSystem } from '../../../3-network/network/NetworkSyncSystem';
import type { PlayerModelSystem } from '../../../2-systems/gameplay/game/PlayerModelSystem';
import type { WeaponSystem } from '../../../2-systems/gameplay/systems/WeaponSystem';
import type { HealthSystem } from '../../../2-systems/gameplay/systems/HealthSystem';
import type { GameModeManager } from '../../../2-systems/gameplay/game/GameModeManager';
import type { HUDSystem } from '../../../2-systems/gameplay/systems/HUDSystem';
import type { RuntimeIssueSnapshot, RuntimeAppState } from '../RuntimeTypes';
import type { ClientWorldRuntimeCoordinator } from './ClientWorldRuntimeCoordinator';
import type { EngineController, SessionAuthorityIntent } from '../../../1-kernel/core/EngineController';
import { normalizeAvatarAppearance } from '../../../2-systems/gameplay/game/AvatarBuilder';
import {
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  resolveTropicalHorrorArchetypeId,
  type TropicalHorrorArchetypeId,
} from '../../../2-systems/ArchetypeDefinitions';

function getDefaultServerHttpUrl(): string {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return '';
  }
  const location = window.location;
  const currentPort = location.port;
  const targetPort = !currentPort || currentPort === '80' || currentPort === '443' || currentPort === '8080'
    ? currentPort
    : '8080';
  const suffix = targetPort ? `:${targetPort}` : '';
  return `${location.protocol}//${location.hostname}${suffix}`.replace(/\/$/, '');
}

function getDefaultServerWsUrl(): string {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return '';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const currentPort = window.location.port;
  const targetPort = !currentPort || currentPort === '80' || currentPort === '443' || currentPort === '8080'
    ? currentPort
    : '8080';
  const suffix = targetPort ? `:${targetPort}` : '';
  return `${protocol}//${window.location.hostname}${suffix}`;
}

interface SessionLifecycleAdapter {
  handleLocalPlayerActualized(payload: {
    playerId: string | null;
    entityId: string | null;
    tick: number | null;
    forced: boolean;
    latencyMs: number | null;
    source: string;
  }): void;
  handleConnected(payload: { playerId: string; roomId: string; hosted?: boolean }): void;
  handleDisconnected(): void;
  handleLocalPlayerDeath(payload: { playerId: string }, localPlayerId: string | null): void;
  handlePlayerRespawn(payload: { playerId: string; position: { x: number; y: number; z: number } }, localPlayerId: string | null): void;
  handleRoundEnd(): void;
  handleInitializeRound(reason: string): void;
  setRuntimeMetricsSession(kind: 'multiplayer' | 'scripted' | 'freeplay', identifier: string): void;
  getRuntimeMetricsSessionId(): string | null;
  shouldCaptureRuntimeMetrics(): boolean;
}

interface GameLaunchAdapter {
  startMultiplayerMatch(data: { map: string; mode: string; sessionId: string; late?: boolean }): void;
}

interface OverlayRuntimeAdapter {
  setInGameMode(mode: 'play' | 'editor' | 'spectator'): void;
  attachInGameModePanelClient(hosted: boolean): void;
  showServerBrowser(): void;
  buildRuntimeIssueSnapshot(): Record<string, unknown>;
}

interface HitFeedbackAdapter {
  showHitMarker(isKill: boolean): void;
  showDamageTaken(amount: number, options?: { direction?: 'front' | 'back' | 'left' | 'right' | null }): void;
  showKillConfirm(targetId: string): void;
}

/**
 * Narrow runtime authority capability exposed to multiplayer coordinators.
 * Keeps the controller boundary limited to state transitions, mode control, and session intent.
 */
export type MultiplayerEngineControllerAuthority = Pick<EngineController,
  | 'is'
  | 'transition'
  | 'setAppState'
  | 'getRuntimeMode'
  | 'setRuntimeMode'
  | 'requestSessionAuthorityIntent'
  | 'state'
>;

interface MultiplayerRuntimeCoordinatorConfig {
  engineController: MultiplayerEngineControllerAuthority;
  mpClient: MultiplayerClient;
  networkSyncSystem: NetworkSyncSystem;
  playerModelSystem: PlayerModelSystem;
  weaponSystem: WeaponSystem;
  healthSystem: HealthSystem;
  gameModeManager: GameModeManager;
  gameHUD: HUDSystem;
  worldRuntime: ClientWorldRuntimeCoordinator;
  runtimeDiagnosticsCoordinator: RuntimeDiagnosticsCoordinator;
  liveCullingSystem: { getDiagnostics(): Record<string, unknown> };
  hitFeedback: HitFeedbackAdapter;
  overlayRuntime: OverlayRuntimeAdapter;
}

export class MultiplayerRuntimeCoordinator {
  private readonly engineController: MultiplayerEngineControllerAuthority;
  private readonly mpClient: MultiplayerClient;
  private readonly networkSyncSystem: NetworkSyncSystem;
  private readonly playerModelSystem: PlayerModelSystem;
  private readonly weaponSystem: WeaponSystem;
  private readonly healthSystem: HealthSystem;
  private readonly gameModeManager: GameModeManager;
  private readonly gameHUD: HUDSystem;
  private readonly worldRuntime: ClientWorldRuntimeCoordinator;
  private readonly runtimeDiagnosticsCoordinator: RuntimeDiagnosticsCoordinator;
  private readonly liveCullingSystem: { getDiagnostics(): Record<string, unknown> };
  private readonly hitFeedback: HitFeedbackAdapter;
  private readonly overlayRuntime: OverlayRuntimeAdapter;

  private readonly runtimeQueryParams: URLSearchParams | null;
  private readonly serverHttpUrl: string;
  private readonly serverWsUrl: string;
  private readonly metricsBaseUrlOverride: string | null;

  private sessionLifecycleCoordinator: SessionLifecycleAdapter | null = null;
  private gameLaunchCoordinator: GameLaunchAdapter | null = null;
  private runtimeMetricsReporter: RuntimeMetricsReporter | null = null;

  private inputSendEnabled = false;
  private inputSendAccumulator = 0;
  private lastLoggedMovementIntent = { jump: false, crouch: false };
  private lastLobbyUpdateAt = 0;
  private lastGameStartAt = 0;
  private lastGameStartSessionId: string | null = null;
  private lastRoundStartAt = 0;
  private readonly busDisposers: Array<() => void> = [];
  private readonly mpClientDisposers: Array<() => void> = [];
  private readonly gameModeDisposers: Array<() => void> = [];
  private wired = false;

  constructor(config: MultiplayerRuntimeCoordinatorConfig) {
    this.engineController = config.engineController;
    this.mpClient = config.mpClient;
    this.networkSyncSystem = config.networkSyncSystem;
    this.playerModelSystem = config.playerModelSystem;
    this.weaponSystem = config.weaponSystem;
    this.healthSystem = config.healthSystem;
    this.gameModeManager = config.gameModeManager;
    this.gameHUD = config.gameHUD;
    this.worldRuntime = config.worldRuntime;
    this.runtimeDiagnosticsCoordinator = config.runtimeDiagnosticsCoordinator;
    this.liveCullingSystem = config.liveCullingSystem;
    this.hitFeedback = config.hitFeedback;
    this.overlayRuntime = config.overlayRuntime;

    this.runtimeQueryParams = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : null;
    this.serverHttpUrl = this.runtimeQueryParams?.get('serverHttpUrl') ?? getDefaultServerHttpUrl();
    this.serverWsUrl = this.runtimeQueryParams?.get('serverWsUrl') ?? getDefaultServerWsUrl();
    this.metricsBaseUrlOverride = this.runtimeQueryParams?.get('metricsBaseUrl') ?? null;
  }

  getServerHttpUrl(): string {
    return this.serverHttpUrl;
  }

  getServerWsUrl(): string {
    return this.serverWsUrl;
  }

  getMetricsBaseUrlOverride(): string | null {
    return this.metricsBaseUrlOverride;
  }

  setSessionLifecycleCoordinator(coordinator: SessionLifecycleAdapter): void {
    this.sessionLifecycleCoordinator = coordinator;
  }

  setGameLaunchCoordinator(coordinator: GameLaunchAdapter): void {
    this.gameLaunchCoordinator = coordinator;
  }

  setRuntimeMetricsReporter(runtimeMetricsReporter: RuntimeMetricsReporter | null): void {
    this.runtimeMetricsReporter = runtimeMetricsReporter;
  }

  isInputSendingEnabled(): boolean {
    return this.inputSendEnabled;
  }

  transitionEngineState(target: RuntimeAppState, reason: string): boolean {
    const attempt = (next: RuntimeAppState): boolean => {
      if (this.engineController.is(next)) return true;
      if (typeof this.engineController.setAppState === 'function') {
        return this.engineController.setAppState(next);
      }
      return this.engineController.transition(next);
    };

    switch (target) {
      case 'menu':
        return attempt('menu');
      case 'lobby':
        if (this.engineController.is('boot') && !attempt('menu')) return false;
        return attempt('lobby');
      case 'starting':
        if (this.engineController.is('boot') && !attempt('menu')) return false;
        if (this.engineController.is('menu') && !attempt('lobby')) return false;
        return attempt('starting');
      case 'in_game':
        if (this.engineController.is('boot') && !attempt('menu')) return false;
        if (this.engineController.is('lobby') && !attempt('starting')) return false;
        return attempt('in_game');
      case 'post_game':
        if (!this.engineController.is('in_game') && !this.transitionEngineState('in_game', `${reason}:pre_post_game`)) return false;
        return attempt('post_game');
    }
  }

  isGameplaySessionActive(): boolean {
    const stateManager = Engine.getStateManagerInstance();
    const gameplayActive = stateManager?.getRaw('gameplay.active');
    if (typeof gameplayActive === 'boolean') {
      if (gameplayActive) {
        return true;
      }
      // Multiplayer fallback: allow input while an active network session is running
      // even if gameplay.active briefly lags behind engine state transitions.
      if (this.mpClient.connected && this.mpClient.inGame && this.engineController.is('in_game')) {
        return true;
      }
      return false;
    }
    return this.engineController.is('in_game') || (this.mpClient.connected && this.mpClient.inGame);
  }

  private shouldProcessAuthoritativeSnapshots(): boolean {
    return this.worldRuntime.getLocalPlayerBootstrapCoordinator().isAwaitingAuthoritativeSpawn()
      || this.engineController.is('starting')
      || this.engineController.is('in_game')
      || this.engineController.is('post_game')
      || this.mpClient.inGame
      || !this.mpClient.connected;
  }

  resetRoundPlayerMode(): void {
    this.engineController.requestSessionAuthorityIntent?.('round-ended', 'multiplayer:reset-round-player-mode');
    if (this.mpClient.connected) {
      (this.mpClient as unknown as { _send?: (payload: unknown) => void })._send?.({
        type: 'ACTION',
        action: 'PLAYER_MODE_CHANGE',
        data: { mode: 'play' },
      });
    }
  }

  startInputSending(): void {
    if (this.worldRuntime.getLocalPlayerBootstrapCoordinator().isAwaitingAuthoritativeSpawn()) return;
    this.inputSendEnabled = true;
    this.inputSendAccumulator = 0;
  }

  stopInputSending(): void {
    this.inputSendEnabled = false;
    this.inputSendAccumulator = 0;
  }

  updateInput(dt: number): void {
    if (
      !this.inputSendEnabled
      || this.worldRuntime.getLocalPlayerBootstrapCoordinator().isLocalPlayerDead()
      || this.worldRuntime.getLocalPlayerBootstrapCoordinator().isAwaitingAuthoritativeSpawn()
      || !this.isGameplaySessionActive()
    ) {
      this.networkSyncSystem.clearLiveLocalInput();
      return;
    }

    const movementInput = Engine.getPlayController()?.getMovementInput();
    if (!movementInput) {
      this.networkSyncSystem.clearLiveLocalInput();
      return;
    }

    const movementIntent = movementInput.movementIntent ?? {
      jump: movementInput.jump === true,
      crouch: movementInput.crouch === true,
    };
    if (
      movementIntent.jump !== this.lastLoggedMovementIntent.jump
      || movementIntent.crouch !== this.lastLoggedMovementIntent.crouch
    ) {
      console.log('[MovementIntent] jump/crouch set', {
        jump: movementIntent.jump,
        crouch: movementIntent.crouch,
        connected: this.mpClient.connected,
      });
      this.lastLoggedMovementIntent = {
        jump: movementIntent.jump,
        crouch: movementIntent.crouch,
      };
    }

    this.networkSyncSystem.setLiveLocalInput(movementInput);

    if (!this.mpClient.connected) {
      this.networkSyncSystem.stepLocalInput(movementInput, dt);
      this.worldRuntime.syncCameraToLocalPlayerEntity();
      return;
    }

    this.inputSendAccumulator += dt;
    while (this.inputSendAccumulator >= 0.05) {
      this.inputSendAccumulator -= 0.05;
      this.networkSyncSystem.queueLocalInput(movementInput);
      this.worldRuntime.syncCameraToLocalPlayerEntity();
    }
  }

  resetSessionTimestamps(): void {
    this.lastLobbyUpdateAt = 0;
    this.lastGameStartAt = 0;
    this.lastGameStartSessionId = null;
    this.lastRoundStartAt = 0;
  }

  markRoundStart(): void {
    this.lastRoundStartAt = Engine.time.now();
  }

  getRuntimeAppStateLabel(): RuntimeAppState | 'menu' {
    if (this.engineController.is('post_game')) return 'post_game';
    if (this.engineController.is('in_game')) return 'in_game';
    if (this.engineController.is('starting')) return 'starting';
    if (this.engineController.is('lobby')) return 'lobby';
    return 'menu';
  }

  prepareMultiplayerLobby(reason: string): void {
    this.stopInputSending();
    if (this.mpClient.connected) {
      this.mpClient.disconnect();
    }
    this.worldRuntime.hardResetRuntimeState(`multiplayer_lobby:${reason}`, { allowInGame: true });
    this.resetSessionTimestamps();
  }

  hostAutostartMultiplayer(config: {
    playerName: string;
    roomName: string;
    map: string;
    mode?: 'ffa' | 'horde' | 'drift_bomb';
    killLimit: number;
    roundDurationSec: number;
    maxPlayers: number;
    forceStart: boolean;
  }): void {
    void this.runAfterAuthLock('host', () => {
      this.mpClient.setPendingJoinAppearance(this.getLobbyJoinAppearance());
      this.mpClient.setPendingJoinArchetypeId(this.getLobbyJoinArchetypeId());
      this.prepareMultiplayerLobby('host');
      this.transitionEngineState('lobby', 'autostart_host');
      const handleLobbyUpdate = (lobby: { roomId?: string; status?: string }) => {
        if (!this.mpClient.roomId || lobby.roomId !== this.mpClient.roomId) return;
        if (lobby.status !== 'waiting') return;
        this.mpClient.setReady(true);
        if (config.forceStart) {
          this.mpClient.sendLobbyAction('LOBBY_FORCE_START', {});
          this.mpClient.off('lobby_update', handleLobbyUpdate);
        }
      };

      this.onMpClient('lobby_update', handleLobbyUpdate);
      this.mpClient.hostRoom(this.serverWsUrl, config.playerName, {
        name: config.roomName,
        map: config.map,
        mode: config.mode ?? 'ffa',
        killLimit: config.killLimit,
        roundDurationSec: config.roundDurationSec,
        maxPlayers: config.maxPlayers,
      });
    });
  }

  joinAutostartMultiplayer(config: {
    playerName: string;
    roomId: string | null;
    autoReady: boolean;
  }): void {
    void this.runAfterAuthLock('join', () => {
      this.mpClient.setPendingJoinAppearance(this.getLobbyJoinAppearance());
      this.mpClient.setPendingJoinArchetypeId(this.getLobbyJoinArchetypeId());
      this.prepareMultiplayerLobby('join');
      this.transitionEngineState('lobby', 'autostart_join');
      const handleLobbyUpdate = (lobby: { roomId?: string; players?: Array<{ id: string; ready: boolean }> }) => {
        if (!config.autoReady) return;
        if (!this.mpClient.playerId || lobby.roomId !== this.mpClient.roomId) return;
        const localPlayer = Array.isArray(lobby.players)
          ? lobby.players.find((player) => player.id === this.mpClient.playerId)
          : null;
        if (!localPlayer || localPlayer.ready) return;
        this.mpClient.setReady(true);
      };

      this.onMpClient('lobby_update', handleLobbyUpdate);
      if (config.roomId) {
        this.mpClient.joinRoom(this.serverWsUrl, config.playerName, config.roomId);
        return;
      }

      const resolver = new NetworkConnectionResolver();
      const httpUrl = resolver.resolveHttpUrl();
      void this.mpClient.fetchServers(httpUrl).then((servers) => {
        const target = servers.find((server) => server.id !== 'auto');
        if (!target) return;
        this.mpClient.joinRoom(this.serverWsUrl, config.playerName, target.id);
      });
    });
  }

  dispose(): void {
    while (this.busDisposers.length > 0) { this.busDisposers.pop()?.(); }
    while (this.mpClientDisposers.length > 0) { this.mpClientDisposers.pop()?.(); }
    while (this.gameModeDisposers.length > 0) { this.gameModeDisposers.pop()?.(); }
    this.wired = false;
    this.stopInputSending();
  }

  private onMpClient(event: string, handler: (...args: any[]) => void): void {
    this.mpClient.on(event as never, handler as never);
    this.mpClientDisposers.push(() => {
      this.mpClient.off(event as never, handler as never);
    });
  }

  private onGameMode(eventName: string, handler: (...args: any[]) => void): void {
    this.gameModeManager.on(eventName as never, handler as never);
    this.gameModeDisposers.push(() => {
      this.gameModeManager.off(eventName as never, handler as never);
    });
  }

  private async runAfterAuthLock(action: 'host' | 'join', callback: () => void): Promise<void> {
    const globalAuthLock = this.getGlobalAuthLockPromise();
    if (globalAuthLock) {
      try {
        await this.withTimeout(globalAuthLock, 3000);
      } catch (error) {
        console.warn(`[MultiplayerRuntimeCoordinator] Auth lock timeout before ${action}, continuing with guest fallback`, error);
      }
    }

    callback();
  }

  private getGlobalAuthLockPromise(): Promise<unknown> | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const candidate = (window as any).__authLockReady;
    if (!candidate || typeof candidate.then !== 'function') {
      return null;
    }

    return candidate as Promise<unknown>;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timed out waiting for auth lock after ${timeoutMs}ms`));
      }, timeoutMs);

      void promise.then(
        (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      );
    });
  }

  wire(): void {
    if (!this.sessionLifecycleCoordinator) {
      throw new Error('SessionLifecycleCoordinator must be attached before wiring multiplayer runtime');
    }
    if (this.wired) {
      return;
    }
    this.wired = true;
    this.busDisposers.push(gameBus.on('LOCAL_PLAYER_ACTUALIZED', ({ playerId, entityId, tick, forced, latencyMs, source }) => {
      this.sessionLifecycleCoordinator?.handleLocalPlayerActualized({
        playerId,
        entityId,
        tick,
        forced,
        latencyMs,
        source,
      });
    }));

    this.onMpClient('authoritative_snapshot', (payload) => {
      if (!this.shouldProcessAuthoritativeSnapshots()) return;
      if (!this.worldRuntime.assertSpawnSystemsReady('authoritative_snapshot')) return;
      const snapshotSummary = this.worldRuntime.summarizeAuthoritativeSnapshot(payload);
      if (this.worldRuntime.getLocalPlayerBootstrapCoordinator().isAwaitingAuthoritativeSpawn() || payload.tick <= 1) {
        this.worldRuntime.logSpawnDiagnostic('PLAYER SPAWN REQUEST', {
          source: 'authoritative_snapshot',
          tick: payload.tick,
          containsLocalPlayer: snapshotSummary.containsLocalPlayer,
          localPlayerHasPosition: snapshotSummary.localPlayerHasPosition,
          playerTypes: payload.entities
            .filter((entity: any) => entity.type === 'player')
            .map((entity: any) => ({ id: entity.id, type: entity.type, hasPosition: !!entity.position })),
        });
      }
      this.networkSyncSystem.applyAuthoritativeSnapshot(this.toReplicationSnapshot(payload));
      this.playerModelSystem.syncFromPayload(payload.entities, payload.timestamp ?? Engine.time.now());
      this.worldRuntime.injectAuthoritativeSnapshotBinding(
        this.mpClient.playerId,
        payload.entities.map((entity: any) => ({ id: entity.id, isPlayerControlled: entity.isPlayerControlled })),
      );
      this.worldRuntime.updateAuthoritativeSnapshotTracking(payload);
      const localEntity = this.worldRuntime.findLocalAuthoritativeSnapshotEntity(payload.entities);
      const localTransform = this.networkSyncSystem.getLocalPlayerTransform();
      if (this.worldRuntime.getLocalPlayerBootstrapCoordinator().isAwaitingAuthoritativeSpawn() && (localEntity?.position || localTransform?.position)) {
        this.worldRuntime.syncLocalPlayerToAuthoritativeSpawn(
          localEntity?.position ?? localTransform!.position,
          localEntity?.rotation ?? localTransform?.rotation ?? { x: 0, y: 0, z: 0 },
          {
            source: 'authoritative_snapshot',
            tick: payload.tick,
          },
        );
      } else if (this.worldRuntime.getLocalPlayerBootstrapCoordinator().isAwaitingAuthoritativeSpawn() && payload.round?.status === 'active') {
        this.worldRuntime.getLocalPlayerBootstrapCoordinator().scheduleActualizationFailsafe('authoritative_snapshot');
        this.worldRuntime.warnSpawnDiagnostic('local authoritative player snapshot missing position', {
          playerId: this.mpClient.playerId,
          tick: payload.tick,
          roundStatus: payload.round?.status,
          binding: this.networkSyncSystem.getLocalBindingStatus(),
          localPlayerFoundInSnapshot: this.worldRuntime.getLocalPlayerBootstrapCoordinator().hasLocalPlayerInSnapshot() ?? false,
        });
      }
    });

    this.onMpClient('connected', (data) => {
      logEvent('network', `Connected as ${data.playerId} to ${data.roomId}`);
      // ── Inventory base URL: override the auto-detected origin so REST calls
      // always target the backend port (e.g. :8080) and not the dev-server
      // port (e.g. :3000) that window.location.origin would return.
      Engine.getInventoryGridManager()?.setServerBase(this.runtimeDiagnosticsCoordinator.getBaseUrl());
      // ── Handshake: inject local appearance into the canonical multiplayer
      // state path BEFORE setLocalPlayerId() is called so PlayerModelSystem
      // restores the correct colours/scale without waiting for a round-trip.
      const currentAppearance = normalizeAvatarAppearance(this.getLobbyJoinAppearance());
      Engine.getStateManagerInstance()?.set(
        `player.${data.playerId}.appearance`,
        currentAppearance,
      );
      Engine.getStateManagerInstance()?.set('player.local.appearance', currentAppearance);
      // Broadcast our appearance to any peers already in the room.
      this.mpClient.sendAppearance(currentAppearance);
      this.sessionLifecycleCoordinator?.handleConnected(data);
    });

    // ── Server tick synchronization: calibrate interpolation timing for smooth remote player movement
    this.onMpClient('tick_sync', (data) => {
      this.playerModelSystem?.onServerTickSync(data.tickRate);
    });

    this.onMpClient('game_start', (data) => {
      this.mpClient.requestFullSync();
      this.handleGameStart(data);
    });

    this.onMpClient('disconnected', () => {
      this.sessionLifecycleCoordinator?.handleDisconnected();
    });

    this.onMpClient('player_died', (payload) => {
      this.sessionLifecycleCoordinator?.handleLocalPlayerDeath(payload, this.mpClient.playerId);
    });

    this.onMpClient('player_leave', (payload) => {
      logEvent('network', `Player left: ${payload.playerId}`);
      this.playerModelSystem.removePlayer(payload.playerId);
    });

    // ── Appearance replication ──────────────────────────────────────────────
    // Write incoming peer appearance to StateManager so PlayerModelSystem's
    // subscription rebuilds the remote avatar in real-time.
    this.onMpClient('player_appearance', (payload) => {
      if (payload.playerId === this.mpClient.playerId) return;
      Engine.getStateManagerInstance()?.set(
        `player.${payload.playerId}.appearance`,
        payload.appearance,
      );
    });

    // Re-broadcast our own appearance to peers whenever it changes.
    this.busDisposers.push(gameBus.on('PLAYER_APPEARANCE_CHANGED', ({ playerId, appearance }) => {
      if (playerId !== this.mpClient.playerId) return;
      if (this.mpClient.connected) {
        this.mpClient.sendAppearance(appearance);
      }
    }));

    this.onMpClient('player_equip', (payload) => {
      if (payload.playerId === this.mpClient.playerId) return;
      this.weaponSystem.applyRemoteEquip(payload.playerId, payload.weaponId);
    });

    this.onMpClient('player_reload', (payload) => {
      if (payload.playerId === this.mpClient.playerId) return;
      this.weaponSystem.applyRemoteReload(payload.playerId, payload.weaponId);
    });

    this.onMpClient('player_shoot', (payload) => {
      if (payload.shooterId === this.mpClient.playerId) return;
      this.weaponSystem.recordRemoteShot(payload.shooterId, payload.weapon, payload.origin, payload.direction);
    });

    this.onMpClient('inventory_state_sync', (payload) => {
      if (!payload.activeSlot) return;
      this.weaponSystem.applyRemoteEquip(payload.playerId, payload.activeSlot);
    });

    this.onMpClient('inventory_sync', (payload) => {
      if (this.engineController.is('in_game')) {
        Engine.ensureGameplayUiActive();
      }
      Engine.getInventoryGridManager()?.handleMessage({
        type: 'INVENTORY_SYNC',
        inventory: payload.inventory,
      });
    });

    this.onMpClient('ammo_state_sync', (payload) => {
      this.weaponSystem.syncAuthoritativeAmmoState(payload.playerId, payload.weaponId, {
        currentAmmo: payload.current,
        reserveAmmo: payload.reserve,
        isReloading: payload.isReloading,
      });
    });

    this.onMpClient('attribute_state_sync', (payload) => {
      if (!this.healthSystem.get(payload.playerId)) {
        this.healthSystem.register(payload.playerId, {
          maxHp: payload.maxHealth ?? 100,
          revivable: true,
          maxShield: payload.maxShield ?? 0,
          shield: payload.shield ?? 0,
        });
      }

      this.healthSystem.syncVitals(payload.playerId, {
        hp: payload.health,
        maxHp: payload.maxHealth,
        shield: payload.shield,
        maxShield: payload.maxShield,
      });

      this.worldRuntime.syncKernelHealthChannels(payload.playerId, {
        health: payload.health,
        maxHealth: payload.maxHealth,
      });

      this.syncAuthoritativeVitalsToGas(payload.playerId, {
        health: payload.health,
        maxHealth: payload.maxHealth,
        shield: payload.shield,
        maxShield: payload.maxShield,
      });
    });

    this.onMpClient('ability_state_sync', (payload) => {
      if (payload.playerId !== this.mpClient.playerId || !payload.movementIntent) return;
      this.networkSyncSystem.queueMovementIntent(payload.playerId, payload.movementIntent as NetworkMovementIntent);
    });

    this.onMpClient('world_state', ({ objects }) => {
      this.worldRuntime.assertSpawnSystemsReady('world_state');
      this.worldRuntime.getWorldObjectAuthorityService().syncRemoteWorldState(objects);
    });

    this.onMpClient('player_respawn', (payload) => {
      logEvent('network', `Player respawned: ${payload.playerId}`);
      this.sessionLifecycleCoordinator?.handlePlayerRespawn(payload, this.mpClient.playerId);
    });

    this.onMpClient('lobby_update', (lobby) => {
      this.lastLobbyUpdateAt = Engine.time.now();
      if (this.engineController.is('lobby') && lobby.countdown > 0) {
        this.transitionEngineState('starting', 'lobby_countdown');
      }
    });

    this.onMpClient('damage_taken', (payload) => {
      const direction = this.resolveDamageDirectionFromSource(payload.sourceId);
      this.hitFeedback.showDamageTaken(payload.amount, { direction });
    });

    this.onMpClient('player_killed', (payload) => {
      if (payload.killerId === this.worldRuntime.getActiveRuntimePlayerId()) {
        this.hitFeedback.showHitMarker(true);
        this.hitFeedback.showKillConfirm(payload.targetId);
      }
    });

    this.onGameMode('round_end', () => {
      logEvent('engine', 'Round ended');
      this.sessionLifecycleCoordinator?.handleRoundEnd();
    });

    this.onGameMode('initialize_round', ({ reason }) => {
      logEvent('engine', `Initialize round via ${reason}`);
      this.sessionLifecycleCoordinator?.handleInitializeRound(reason);
    });

    this.onGameMode('round_start', ({ round }) => {
      logEvent('engine', `Round started (${round.roundNumber})`);
    });
  }

  private getLobbyJoinAppearance(): Record<string, unknown> {
    const lobbyAppearance = Engine.getStateManagerInstance()?.get('lobby.localPlayer.appearance');
    if (!lobbyAppearance || typeof lobbyAppearance !== 'object') {
      return { ...this.playerModelSystem.getLocalAppearance() };
    }
    return { ...normalizeAvatarAppearance(lobbyAppearance as Record<string, unknown>) };
  }

  private getLobbyJoinArchetypeId(): TropicalHorrorArchetypeId {
    const stateManager = Engine.getStateManagerInstance();
    const rawArchetypeId = stateManager?.get('lobby.localPlayer.archetype') ?? stateManager?.get('player.local.archetype');
    return resolveTropicalHorrorArchetypeId(rawArchetypeId) ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;
  }

  private resolveDamageDirectionFromSource(sourceId: string | undefined): 'front' | 'back' | 'left' | 'right' | null {
    if (!sourceId) {
      return null;
    }

    const camera = Engine.getEngineCamera();
    if (!camera) {
      return null;
    }

    const localEntity = this.worldRuntime.getLocalPlayerEntity();
    if (!localEntity) {
      return null;
    }

    const sourcePosition = this.playerModelSystem.getPlayerWorldPosition(sourceId)
      ?? Engine.getEntityManager()?.getEntity(sourceId)?.getPosition()
      ?? null;
    if (!sourcePosition) {
      return null;
    }

    const localPosition = localEntity.getPosition();
    const toSource = new THREE.Vector3(
      sourcePosition.x - localPosition.x,
      0,
      sourcePosition.z - localPosition.z,
    );
    if (toSource.lengthSq() < 0.0001) {
      return null;
    }
    toSource.normalize();

    const forward = camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) {
      return null;
    }
    forward.normalize();

    const dot = forward.dot(toSource);
    const crossY = forward.x * toSource.z - forward.z * toSource.x;
    if (Math.abs(dot) >= Math.abs(crossY)) {
      return dot >= 0 ? 'front' : 'back';
    }
    return crossY >= 0 ? 'right' : 'left';
  }

  handleGameStart(data: { map: string; mode: string; sessionId: string; late?: boolean }): void {
    if (this.lastGameStartSessionId === data.sessionId) {
      return;
    }
    logEvent('network', `Game start on ${data.map} (${data.mode})`);
    this.lastGameStartAt = Engine.time.now();
    this.lastGameStartSessionId = data.sessionId;
    this.gameLaunchCoordinator?.startMultiplayerMatch(data);

    const cachedSnapshot = this.mpClient.getLastAuthoritativeSnapshot();
    if (cachedSnapshot && cachedSnapshot.entities.length > 0) {
      this.networkSyncSystem.applyAuthoritativeSnapshot(this.toReplicationSnapshot(cachedSnapshot));
      this.playerModelSystem.syncFromPayload(cachedSnapshot.entities, cachedSnapshot.timestamp ?? Engine.time.now());
      this.worldRuntime.injectAuthoritativeSnapshotBinding(
        this.mpClient.playerId,
        cachedSnapshot.entities.map((entity) => ({ id: entity.id, isPlayerControlled: entity.isPlayerControlled })),
      );
      this.worldRuntime.updateAuthoritativeSnapshotTracking(cachedSnapshot as AuthoritativeSnapshotSummaryPayload);
      const localEntity = this.worldRuntime.findLocalAuthoritativeSnapshotEntity(cachedSnapshot.entities);
      const localTransform = this.networkSyncSystem.getLocalPlayerTransform();
      if (localEntity?.position || localTransform?.position) {
        this.worldRuntime.syncLocalPlayerToAuthoritativeSpawn(
          localEntity?.position ?? localTransform!.position,
          localEntity?.rotation ?? localTransform?.rotation ?? { x: 0, y: 0, z: 0 },
          {
            source: 'game_start_cached_snapshot',
            tick: cachedSnapshot.tick,
          },
        );
      }
    }
  }

  buildRuntimeIssueSnapshot(): RuntimeIssueSnapshot {
    const cachedLobby = this.mpClient.getLastLobbyState();
    const cachedRound = this.mpClient.getLastRoundState();
    const committedSnapshot = this.mpClient.getLastAuthoritativeSnapshot();
    const committedSnapshotSummary = committedSnapshot
      ? this.worldRuntime.summarizeAuthoritativeSnapshot(committedSnapshot as AuthoritativeSnapshotSummaryPayload)
      : this.worldRuntime.getLocalPlayerBootstrapCoordinator().getLastAuthoritativeSnapshotSummary() ?? null;
    const controlTower = Engine.getControlTower?.()?.getSnapshot() ?? null;
    const protocolDiagnostics = this.mpClient.getProtocolDiagnostics();
    const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
    const localEntity = this.worldRuntime.getLocalPlayerEntity();
    const localTransform = this.networkSyncSystem.getLocalPlayerTransform();
    const localBinding = this.networkSyncSystem.getLocalBindingStatus();
    const inventory = Engine.getInventoryGridManager()?.getInventory();
    const gameRound = this.gameModeManager.getRound();
    const gamePlayers = this.gameModeManager.getPlayers();
    const equippedWeapon = runtimePlayerId ? this.weaponSystem.getEquipped(runtimePlayerId) : undefined;
    const cullingDiagnostics = this.liveCullingSystem.getDiagnostics();
    const recentMessageTypes = protocolDiagnostics.recentIncoming.map((entry) => entry.type);
    const hasAuthoritativeTraffic = recentMessageTypes.includes('AUTHORITATIVE_SNAPSHOT') || recentMessageTypes.includes('WORLD_DELTA');

    const suspectedProblems: string[] = [];
    if (this.worldRuntime.getLocalPlayerBootstrapCoordinator().isAwaitingAuthoritativeSpawn()) suspectedProblems.push('Input blocked: awaiting authoritative spawn');
    if (this.mpClient.connected && this.mpClient.inGame && !this.engineController.is('in_game')) {
      suspectedProblems.push(`EngineController state mismatch: expected in_game, got ${this.engineController.state}`);
    }
    if (this.mpClient.connected && !localEntity) suspectedProblems.push('Local player entity missing');
    if (this.mpClient.connected && gameRound.status !== 'active') suspectedProblems.push('GameModeManager round is not active');
    if (this.mpClient.connected && gameRound.timeRemainingMs <= 0) suspectedProblems.push('Client round timer is not initialized');
    if (this.mpClient.connected && (cachedLobby?.players.length ?? 0) === 0) suspectedProblems.push('Lobby roster cache is empty');
    if (this.mpClient.connected && !committedSnapshotSummary && !hasAuthoritativeTraffic) suspectedProblems.push('No authoritative snapshot received yet');
    if (
      this.mpClient.connected
      && protocolDiagnostics.recentIncoming.length > 0
      && !recentMessageTypes.includes('LOBBY_UPDATE')
      && !hasAuthoritativeTraffic
    ) {
      suspectedProblems.push('Incoming packets are not being classified as lobby/snapshot updates');
    }
    if (protocolDiagnostics.recentIncoming.some((entry) => !entry.parseOk)) {
      suspectedProblems.push('Some incoming packets failed JSON parsing');
    }
    suspectedProblems.push(...this.runtimeDiagnosticsCoordinator.getNetworkHealthWarnings());
    suspectedProblems.push(...this.runtimeDiagnosticsCoordinator.getRenderingHealthWarnings());

    const serverStatusDiagnostics = this.runtimeDiagnosticsCoordinator.getServerStatus();

    return {
      suspectedProblems,
      app: {
        hudVisible: Engine.getStateManagerInstance()?.getRaw('hud.visible') === true,
        hudMode: (() => {
          const hudMode = Engine.getStateManagerInstance()?.getRaw('ui.hud.mode');
          return hudMode === 'play' || hudMode === 'editor' || hudMode === 'spectator' || hudMode === 'loading'
            ? hudMode
            : 'hidden';
        })(),
        engineState: this.engineController.state,
        inputContext: getContext(),
        pointerLock: Engine.getInputRouter()?.isPointerLocked() ?? false,
        playControllerEnabled: Engine.getPlayController()?.isEnabled() ?? false,
        playMouseLocked: Engine.getPlayController()?.isMouseLocked() ?? false,
        awaitingAuthoritativeSpawn: this.worldRuntime.getLocalPlayerBootstrapCoordinator().isAwaitingAuthoritativeSpawn(),
        actualizationState: this.worldRuntime.getLocalPlayerBootstrapCoordinator().getActualizationState() ?? 'idle',
        actualizationLatencyMs: this.worldRuntime.getLocalPlayerBootstrapCoordinator().getActualizationLatencyMs() ?? null,
        inputSendEnabled: this.inputSendEnabled,
        localPlayerDead: this.worldRuntime.getLocalPlayerBootstrapCoordinator().isLocalPlayerDead(),
      },
      multiplayer: {
        connected: this.mpClient.connected,
        inGame: this.mpClient.inGame,
        playerId: this.mpClient.playerId,
        roomId: this.mpClient.roomId,
        debugStats: this.mpClient.getDebugStats(),
        lastLobbyUpdateAgeMs: this.lastLobbyUpdateAt > 0 ? Engine.time.now() - this.lastLobbyUpdateAt : null,
        lastGameStartAgeMs: this.lastGameStartAt > 0 ? Engine.time.now() - this.lastGameStartAt : null,
        lastRoundStartAgeMs: this.lastRoundStartAt > 0 ? Engine.time.now() - this.lastRoundStartAt : null,
        lastSnapshotAgeMs: this.mpClient.getLastAuthoritativeSnapshotAgeMs(),
        lastSnapshot: committedSnapshotSummary,
        lastValidSnapshotTick: this.mpClient.getLastValidSnapshotTick() ?? this.worldRuntime.getLocalPlayerBootstrapCoordinator().getLastValidSnapshotTick() ?? null,
        localPlayerFoundInSnapshot: this.worldRuntime.getLocalPlayerBootstrapCoordinator().hasLocalPlayerInSnapshot() ?? false,
        localBinding,
        protocolDiagnostics,
      },
      server: {
        statusBaseUrl: serverStatusDiagnostics.baseUrl,
        clients: serverStatusDiagnostics.clients,
        sessions: serverStatusDiagnostics.sessions,
        transport: serverStatusDiagnostics.transport,
        sessionDiagnostics: serverStatusDiagnostics.session,
        statusAge: this.runtimeDiagnosticsCoordinator.getStatusAgeSummary(),
        error: serverStatusDiagnostics.error,
      },
      lobby: {
        cachedLobby,
        playerNames: cachedLobby?.players.map((player) => player.name) ?? [],
      },
      round: {
        cachedRound,
        gameModeRound: gameRound,
        gameModePlayers: gamePlayers.map((player) => ({
          id: player.id,
          name: player.name,
          health: player.health,
          kills: player.kills,
          deaths: player.deaths,
          equipment: player.equipment,
        })),
      },
      localPlayer: {
        runtimePlayerId,
        localEntityId: localEntity?.id ?? null,
        localEntityPosition: localEntity?.getPosition() ?? null,
        localEntityRotation: localEntity?.getRotation() ?? null,
        reconciledTransform: localTransform,
        equippedWeapon: equippedWeapon ?? null,
        currentAmmo: runtimePlayerId ? this.weaponSystem.getCurrentAmmo(runtimePlayerId) : null,
        reserveAmmo: runtimePlayerId ? this.weaponSystem.getReserveAmmo(runtimePlayerId) : null,
        inventoryPlayerId: Engine.getInventoryGridManager()?.getPlayerId() ?? null,
        inventoryEquippedWeapon: inventory?.equippedWeapon ?? null,
        inventoryItemCount: inventory?.items.length ?? 0,
      },
      rendering: {
        culling: cullingDiagnostics,
        spatialPartition: Engine.getSpatialPartitionSystem()?.getDiagnostics() ?? null,
      },
      networkSync: this.networkSyncSystem.getDiagnostics(),
      controlTower,
    };
  }

  private toReplicationSnapshot(payload: {
    tick: number;
    ack: number;
    lastProcessedInput?: number;
    lastProcessedInputTick?: number;
    timestamp?: number;
    entities: Array<{
      id: string;
      position?: { x: number; y: number; z: number };
      rotation?: { x: number; y: number; z: number };
      velocity?: { x: number; y: number; z: number };
      isCrouching?: boolean;
      isGrounded?: boolean;
      isAirborne?: boolean;
      statusMovementModifier?: StatusMovementModifier;
      isPlayerControlled?: boolean;
    }>;
  }) {
    return {
      tick: payload.tick,
      timestamp: payload.timestamp ?? Engine.time.now(),
      ackInputSeq: payload.ack,
      lastProcessedInput: payload.lastProcessedInput ?? payload.lastProcessedInputTick,
      lastProcessedInputTick: payload.lastProcessedInputTick,
      entities: payload.entities
        .filter((entity) => entity.position && entity.rotation)
        .map((entity) => ({
          entityId: entity.id,
          tick: payload.tick,
          transform: {
            position: entity.position!,
            rotation: entity.rotation!,
          },
          velocity: entity.velocity,
          replicated: entity.statusMovementModifier
            || entity.isCrouching !== undefined
            || entity.isGrounded !== undefined
            || entity.isAirborne !== undefined
            || entity.isPlayerControlled !== undefined
            ? {
                statusMovementModifier: entity.statusMovementModifier,
                isPlayerControlled: entity.isPlayerControlled,
                movementState: {
                  // Only include fields present in the delta — absent fields on
                  // a partial delta must not coerce to false and overwrite the
                  // receiver's current state for isGrounded / isAirborne.
                  ...(entity.isCrouching !== undefined && { isCrouching: entity.isCrouching === true }),
                  ...(entity.isGrounded  !== undefined && { isGrounded:  entity.isGrounded  === true }),
                  ...(entity.isAirborne  !== undefined && { isAirborne:  entity.isAirborne  === true }),
                },
              }
            : undefined,
        })),
    };
  }

      private syncAuthoritativeVitalsToGas(
        playerId: string,
        vitals: {
          health?: number;
          maxHealth?: number;
          shield?: number;
          maxShield?: number;
        },
      ): void {
        const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
        if (playerId !== runtimePlayerId && playerId !== this.mpClient.playerId) {
          return;
        }

        const attrs = Engine.getGasAttributeStore()?.get(playerId);
        if (!attrs) return;

        if (typeof vitals.maxHealth === 'number') {
          attrs.setBase('MaxHealth', vitals.maxHealth);
        }
        if (typeof vitals.health === 'number') {
          attrs.setBase('Health', vitals.health);
        }
        if (typeof vitals.maxShield === 'number') {
          attrs.setBase('MaxShield', vitals.maxShield);
        }
        if (typeof vitals.shield === 'number') {
          attrs.setBase('Shield', vitals.shield);
        }
      }
}
