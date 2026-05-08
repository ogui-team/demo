import * as Engine from '../../../0-foundation/foundation/Engine';
import { type GameModeManager } from '../../../2-systems/gameplay/game/GameModeManager';
import { type GameModeSystem } from '../../../2-systems/gameplay/game/GameModeSystem';
import { type PlayerModelSystem } from '../../../2-systems/gameplay/game/PlayerModelSystem';
import { SessionLifecycleCoordinator } from '../../../2-systems/gameplay/game/SessionLifecycleCoordinator';
import { type WorldObjectAuthorityService } from '../../../2-systems/gameplay/game/WorldObjectAuthorityService';
import { type MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import { type HUDSystem } from '../../../2-systems/gameplay/systems/HUDSystem';
import { type WeaponSystem } from '../../../2-systems/gameplay/systems/WeaponSystem';
import { setRuntimePlayerIdInState } from './hydrateStateManager';
import { type ClientWorldRuntimeCoordinator } from '../coordinators/ClientWorldRuntimeCoordinator';
import { type MultiplayerRuntimeCoordinator } from '../coordinators/MultiplayerRuntimeCoordinator';
import { type RuntimeOverlayCoordinator } from '../coordinators/RuntimeOverlayCoordinator';
import { type RuntimeAuxiliaryAssembly } from '../RuntimeAuxiliaryAssembly';
import type { EngineController, SessionAuthorityIntent } from '../../../1-kernel/core/EngineController';

interface CreateSessionLifecycleCoordinatorOptions {
  engineController: EngineController;
  stateManager: NonNullable<ReturnType<typeof Engine.getStateManagerInstance>>;
  gameModeManager: GameModeManager;
  gameHUD: HUDSystem;
  worldRuntime: ClientWorldRuntimeCoordinator;
  multiplayerRuntime: MultiplayerRuntimeCoordinator;
  runtimeOverlayCoordinator: RuntimeOverlayCoordinator;
  auxiliaryAssembly: RuntimeAuxiliaryAssembly;
  networkSyncSystem: NonNullable<ReturnType<typeof Engine.getNetworkSyncSystem>>;
  weaponSystem: WeaponSystem;
  playerModelSystem: PlayerModelSystem;
  worldObjectAuthorityService: WorldObjectAuthorityService;
  engineGameModes: GameModeSystem;
  mpClient: MultiplayerClient;
  debugManager: { isEnabled: () => boolean };
  setPendingMatchResetMode: (mode: 'soft' | 'full') => void;
}

export function createSessionLifecycleCoordinator(
  options: CreateSessionLifecycleCoordinatorOptions,
): SessionLifecycleCoordinator {
  return new SessionLifecycleCoordinator({
    getLifecycleState: () => options.gameModeManager.getLifecycleState(),
    getRoundNumber: () => options.gameModeManager.getRound().roundNumber,
    getActiveRuntimePlayerId: () => options.worldRuntime.getActiveRuntimePlayerId(),
    setPendingMatchResetMode: (mode) => {
      options.setPendingMatchResetMode(mode);
    },
    isState: (state) => options.engineController.is(state),
    transitionEngineState: (target, reason) => options.multiplayerRuntime.transitionEngineState(target, reason),
    setInGameModePanelMode: (mode) => options.runtimeOverlayCoordinator.setInGameMode(mode),
    setHudPlayerId: (playerId) => {
      options.gameHUD.setPlayerId(playerId);
    },
    requestRuntimeAuthorityIntent: (intent: SessionAuthorityIntent, reason) => {
      options.engineController.requestSessionAuthorityIntent(intent, `session-lifecycle:${reason}`);
    },
    ensureGameplayUiActive: () => {
      Engine.ensureGameplayUiActive();
    },
    cancelInteractionTools: (reason) => {
      Engine.getGizmoSystem()?.cancelInteraction(reason);
      Engine.getPhysGunSystem()?.deactivate();
    },
    bindPlayController: (entityId) => {
      Engine.getPlayController()?.bind(entityId);
    },
    isInputGateReady: (playerId) => {
      return playerId ? options.worldRuntime.isLocalPlayerInputMeshReady(playerId) : false;
    },
    enablePlayController: () => {
      Engine.getPlayController()?.enable();
    },
    resetPlayController: () => {
      Engine.getPlayController()?.reset();
    },
    setLocalPlayerDead: (dead) => {
      options.worldRuntime.getLocalPlayerBootstrapCoordinator().setLocalPlayerDead(dead);
    },
    getLocalPlayerActualizationState: () => {
      return options.worldRuntime.getLocalPlayerBootstrapCoordinator().getActualizationState();
    },
    resetLocalPlayerBootstrap: () => {
      options.worldRuntime.getLocalPlayerBootstrapCoordinator().reset();
    },
    requestAuthoritativeSpawnSync: () => {
      options.worldRuntime.requestAuthoritativeSpawnSync();
    },
    startInputSending: () => options.multiplayerRuntime.startInputSending(),
    stopInputSending: () => options.multiplayerRuntime.stopInputSending(),
    syncPlayControllerToLocalRotation: () => {
      options.worldRuntime.syncPlayControllerToLocalRotation();
    },
    syncCameraToLocalPlayerEntity: () => {
      options.worldRuntime.syncCameraToLocalPlayerEntity();
    },
    logSpawnDiagnostic: (message, details) => {
      options.worldRuntime.logSpawnDiagnostic(message, details);
    },
    ensurePlayerRuntimeState: (playerId) => {
      options.worldRuntime.ensurePlayerRuntimeState(playerId);
    },
    initInventoryGrid: (playerId) => Engine.getInventoryGridManager()?.init(playerId),
    setRuntimePlayerId: (playerId) => {
      Engine.setRuntimePlayerId(playerId);
      setRuntimePlayerIdInState(options.stateManager, playerId);
    },
    bindNetworkSyncLocalPlayer: (playerId, authorityMode) => {
      options.worldRuntime.bindNetworkSyncLocalPlayer(playerId, authorityMode);
    },
    attachInGameModePanelClient: (hosted) => {
      options.runtimeOverlayCoordinator.attachInGameModePanelClient(hosted);
    },
    setCommandSink: (sink) => {
      options.networkSyncSystem.setCommandSink(sink);
    },
    setAuthorityMode: (mode) => {
      options.networkSyncSystem.setAuthorityMode(mode);
    },
    clearPendingInputs: () => {
      options.networkSyncSystem.clearPendingInputs();
    },
    resetNetworkSyncRuntime: () => {
      options.networkSyncSystem.resetRuntimeState();
    },
    getLocalTransform: () => options.networkSyncSystem.getLocalPlayerTransform(),
    forceLocalState: (position, rotation, velocity) => {
      options.networkSyncSystem.forceLocalState(position, rotation, velocity);
    },
    cancelReload: (playerId) => {
      options.weaponSystem.cancelReload(playerId);
    },
    resetPlayerState: (playerId, position) => {
      options.weaponSystem.resetPlayerState(playerId, position);
    },
    handleRemoteRespawn: (playerId, position) => {
      options.playerModelSystem.handleRespawn(playerId, position);
    },
    syncLocalPlayerToAuthoritativeSpawn: (position, rotation) => {
      options.worldRuntime.syncLocalPlayerToAuthoritativeSpawn(position, rotation);
    },
    clearRemotePlayers: () => {
      options.playerModelSystem.clearAll();
    },
    clearReplicatedWorldObjects: () => {
      options.worldObjectAuthorityService.clear();
    },
    resetGameplayWorld: () => {
      options.worldRuntime.resetGameplayWorld();
    },
    showServerBrowser: () => {
      options.runtimeOverlayCoordinator.showServerBrowser();
    },
    refreshServerList: () => {
      options.runtimeOverlayCoordinator.reopenServerBrowserToList('Disconnected');
      options.stateManager.set('lobby.status', 'searching');
    },
    isConnected: () => options.mpClient.connected,
    resetSessionTimestamps: () => options.multiplayerRuntime.resetSessionTimestamps(),
    markRoundStart: () => options.multiplayerRuntime.markRoundStart(),
    getRuntimeAppStateLabel: () => options.multiplayerRuntime.getRuntimeAppStateLabel(),
    isGameplaySessionActive: () => options.multiplayerRuntime.isGameplaySessionActive(),
    isDebugEnabled: () => options.debugManager.isEnabled(),
  });
}
