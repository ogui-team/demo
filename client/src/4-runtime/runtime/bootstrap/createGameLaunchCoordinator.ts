import * as Engine from '../../../0-foundation/foundation/Engine';
import { FeatureManager } from '@engine/1-kernel/core/public-api';
import { type GameModeManager } from '../../../2-systems/gameplay/game/GameModeManager';
import { type GameModeSystem } from '../../../2-systems/gameplay/game/GameModeSystem';
import { GameLaunchCoordinator } from '../../../2-systems/gameplay/game/GameLaunchCoordinator';
import { type PlayerModelSystem } from '../../../2-systems/gameplay/game/PlayerModelSystem';
import { type ScriptedLevelSystem } from '../../../2-systems/gameplay/game/ScriptedLevelSystem';
import { type SessionLifecycleCoordinator } from '../../../2-systems/gameplay/game/SessionLifecycleCoordinator';
import { type WorldObjectAuthorityService } from '../../../2-systems/gameplay/game/WorldObjectAuthorityService';
import { setRuntimePlayerIdInState } from './hydrateStateManager';
import { type MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import { type HUDSystem } from '../../../2-systems/gameplay/systems/HUDSystem';
import { type GameAudioManager } from '../../../2-systems/gameplay/systems/GameAudioManager';
import { type SpawnSystem } from '../../../2-systems/gameplay/systems/SpawnSystem';
import { type ClientWorldRuntimeCoordinator } from '../coordinators/ClientWorldRuntimeCoordinator';
import { type MultiplayerRuntimeCoordinator } from '../coordinators/MultiplayerRuntimeCoordinator';
import { type StateManager } from '../../../0-foundation/foundation/state/StateManager';

interface CreateGameLaunchCoordinatorOptions {
  engineController: NonNullable<ReturnType<typeof Engine.getEngineController>>;
  mpClient: MultiplayerClient;
  stateManager: StateManager;
  worldRuntime: ClientWorldRuntimeCoordinator;
  playerModelSystem: PlayerModelSystem;
  worldObjectAuthorityService: WorldObjectAuthorityService;
  spawnSystem: SpawnSystem;
  gameHUD: HUDSystem;
  engineGameModes: GameModeSystem;
  gameModeManager: GameModeManager;
  sessionLifecycleCoordinator: SessionLifecycleCoordinator;
  scriptedLevelSystem: ScriptedLevelSystem | null;
  multiplayerRuntime: MultiplayerRuntimeCoordinator;
  audioManager: GameAudioManager;
  setPendingMatchResetMode: (mode: 'soft' | 'full') => void;
}

export function createGameLaunchCoordinator(options: CreateGameLaunchCoordinatorOptions): GameLaunchCoordinator {
  return new GameLaunchCoordinator({
    getAvailableScriptedLevels: () => options.scriptedLevelSystem?.listLevels() ?? [],
    getCurrentPlayerId: () => options.mpClient.playerId || null,
    setActiveMapCollisionLayout: (mapId, sessionId) => {
      options.worldRuntime.setActiveMapCollisionLayout(mapId, sessionId);
    },
    setPendingMatchResetMode: (mode) => {
      options.setPendingMatchResetMode(mode);
    },
    configureFeatures: (config) => {
      FeatureManager.configure(config);
    },
    enableMultiplayerFeature: () => {
      FeatureManager.enable('multiplayer');
    },
    stopMusic: () => {
      options.audioManager.stopMusic();
    },
    isInGame: () => options.engineController.is('in_game'),
    isMultiplayerConnected: () => options.mpClient.connected,
    disconnectMultiplayerSession: () => {
      options.mpClient.disconnect();
    },
    transitionState: (state, reason) => {
      options.multiplayerRuntime.transitionEngineState(state, reason);
    },
    hardResetRuntimeState: (reason, resetOptions) => {
      options.worldRuntime.hardResetRuntimeState(reason, resetOptions);
    },
    resetGameplayWorld: () => {
      options.worldRuntime.resetGameplayWorld();
    },
    clearPlayerModels: () => {
      options.playerModelSystem.clearAll();
    },
    clearWorldObjects: () => {
      options.worldObjectAuthorityService.clear();
    },
    buildScriptedLevel: (levelId) => options.scriptedLevelSystem?.buildLevel(levelId) ?? null,
    buildHordeArena: (sessionId) => options.worldRuntime.buildHordeArena(sessionId),
    buildFlatTestMap: (mapId) => options.worldRuntime.buildFlatTestMap(mapId),
    buildMatchLevel: (sessionId, mapId) => options.worldRuntime.buildMatchLevel(sessionId, mapId),
    setActiveLevelGroup: (group) => {
      options.worldRuntime.setActiveLevelGroup(group);
    },
    registerStaticLevelGeometryForCulling: (group) => {
      options.worldRuntime.registerStaticLevelGeometryForCulling(group);
    },
    registerScriptedSpawnPoints: (levelId) => options.worldRuntime.registerScriptedSpawnPoints(levelId),
    registerArenaSpawnPoints: (kind) => options.worldRuntime.registerArenaSpawnPoints(kind),
    findFreeplaySpawnPosition: () => options.spawnSystem.findSpawnPosition({ tag: 'player', clearance: 2 }),
    getSpawnLoadoutWeapons: (playerId) => options.engineGameModes.getSpawnLoadout(playerId).weapons,
    initOfflineInventoryGrid: (playerId, weaponIds) => {
      const offlineItemIds = weaponIds.map((weaponId) =>
        weaponId.startsWith('weapon_') || weaponId.startsWith('debug_') || weaponId === 'physgun_tool'
          ? weaponId
          : `weapon_${weaponId}`,
      );
      return Engine.getInventoryGridManager()?.initOffline(playerId, offlineItemIds);
    },
    setRuntimePlayerId: (playerId) => {
      Engine.setRuntimePlayerId(playerId);
    },
    ensurePlayerRuntimeState: (playerId) => options.worldRuntime.ensurePlayerRuntimeState(playerId),
    bindNetworkSyncLocalPlayer: (playerId, authorityMode) => options.worldRuntime.bindNetworkSyncLocalPlayer(playerId, authorityMode),
    showGameplayUi: () => {
      options.engineController.setRuntimeMode('play', 'game-launch:show-gameplay-ui');
    },
    setHudMode: (mode) => {
      options.engineController.setHudMode(mode, 'game-launch');
    },
    ensureGameplayUiActive: () => {
      Engine.ensureGameplayUiActive();
    },
    activateGameMode: (modeName) => {
      options.engineController.setGameMode(modeName, 'game-launch');
    },
    syncLocalPlayerToAuthoritativeSpawn: (position, rotation) => {
      options.worldRuntime.syncLocalPlayerToAuthoritativeSpawn(position, rotation);
    },
    setRuntimeMetricsSession: (kind, identifier) => {
      options.sessionLifecycleCoordinator.setRuntimeMetricsSession(kind, identifier);
    },
    showNotification: (text, durationSeconds) => {
      options.gameHUD.showNotification(text, durationSeconds);
    },
    setRuntimePlayerIdInState: (playerId) => {
      setRuntimePlayerIdInState(options.stateManager, playerId);
    },
    getLocalFreeplayPlayerId: () => options.worldRuntime.getLocalFreeplayPlayerId(),
    getCachedLobbyState: () => options.mpClient.getLastLobbyState(),
    getCachedRoundState: () => options.mpClient.getLastRoundState(),
    getNextRoundNumber: () => Math.max(1, options.gameModeManager.getRound().roundNumber + 1),
    startRound: (round) => {
      options.gameModeManager.startRound(round);
    },
    prepareRoundInitialization: (reason, phase) => {
      options.sessionLifecycleCoordinator.prepareRoundInitialization(reason, phase);
    },
    setLocalPlayerDead: (dead) => {
      options.worldRuntime.getLocalPlayerBootstrapCoordinator().setLocalPlayerDead(dead);
    },
    syncFreeplayWorldObjects: (mapId) => {
      // Load static colliders from map and spawn them as world objects in freeplay
      try {
        const collisionAuthority = options.worldRuntime.getCollisionAuthoritySystem();
        const staticLayout = collisionAuthority.getStaticLayout();
        
        // Convert static boxes to world object format
        const worldObjects = staticLayout.boxes.map((box: any) => ({
          id: box.id,
          entityType: 'static_collider',
          position: { ...box.position },
          rotation: { x: 0, y: 0, z: 0 },
          renderData: {
            meshType: 'box',
            color: 0x999999,
            geometry: {},
          },
          metadata: {
            colliderHalfExtents: { ...box.halfExtents },
            isStaticCollider: true,
          },
        }));
        
        console.log(`[GameLaunch] Syncing ${worldObjects.length} static colliders for freeplay map "${mapId}"`);
        console.log('[GameLaunch] Sample collider:', worldObjects[0]);
        options.worldObjectAuthorityService.syncRemoteWorldState(worldObjects as any);
      } catch (error) {
        console.error('[GameLaunch] Failed to sync freeplay world objects', error);
      }
    },
    disablePhysGun: () => {
      Engine.getPhysGunSystem()?.disable();
      Engine.getToolbarSystem()?.clearPhysGunSlot();
    },
  });
}
