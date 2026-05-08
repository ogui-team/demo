import * as Engine from '../../../0-foundation/foundation/Engine';
import { FeatureManager, FeatureKey, FEATURE_META } from '@engine/1-kernel/core/public-api';
import { logEvent } from '@engine/1-kernel/core/public-api';
import { getSavedLevelNames, loadLevelFromStorage, runWithLoading } from '../../ui/LevelPersistence';
import type { GameModeSystem } from '../../../2-systems/gameplay/game/GameModeSystem';
import type { GameLaunchCoordinator } from '../../../2-systems/gameplay/game/GameLaunchCoordinator';
import type { ScriptedLevelSystem } from '../../../2-systems/gameplay/game/ScriptedLevelSystem';
import type { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import type { GameAudioManager } from '../../../2-systems/gameplay/systems/GameAudioManager';
import type { MenuIdentitySystem } from '../../ui/MenuIdentitySystem';
import type { UICompositionCoordinator } from '../../ui/UICompositionCoordinator';
import type { ClientWorldRuntimeCoordinator } from '../coordinators/ClientWorldRuntimeCoordinator';
import type { MultiplayerRuntimeCoordinator } from '../coordinators/MultiplayerRuntimeCoordinator';

interface CreateRuntimeUiCompositionCoordinatorOptions {
  modeManager: ReturnType<typeof Engine.getModeManger> | null;
  engineController: NonNullable<ReturnType<typeof Engine.getEngineController>>;
  mpClient: MultiplayerClient;
  gameLaunchCoordinator: GameLaunchCoordinator;
  audioManager: GameAudioManager;
  worldRuntime: ClientWorldRuntimeCoordinator;
  multiplayerRuntime: MultiplayerRuntimeCoordinator;
  scriptedLevelSystem: ScriptedLevelSystem | null;
  engineGameModes: GameModeSystem;
  menuIdentitySystem: MenuIdentitySystem;
  debugManager: { enable: () => void };
}

export async function createRuntimeUiCompositionCoordinator(
  options: CreateRuntimeUiCompositionCoordinatorOptions,
): Promise<UICompositionCoordinator> {
  const { UICompositionCoordinator } = await import('../../ui/UICompositionCoordinator');

  return new UICompositionCoordinator({
    registerModeListener: (listener) => {
      options.modeManager?.registerListener(listener);
    },
    keyboard: {
      isInGame: () => options.engineController.is('in_game'),
      canSwitchModes: () => !options.engineController.is('in_game')
        && !options.engineController.is('starting')
        && !options.engineController.is('post_game'),
      setEngineMode: (mode) => {
        options.engineController.setRuntimeMode(mode, 'ui-keyboard');
      },
    },
    inGamePanel: {
      client: options.mpClient,
    },
    mainMenu: {
      onFreeplay: () => options.gameLaunchCoordinator.startLocalFreeplay(),
      onHorde: () => options.gameLaunchCoordinator.startHorde(),
      onDriftBomb: () => options.gameLaunchCoordinator.startDriftBomb(),
      onQuickStart: () => options.gameLaunchCoordinator.startEngineShowcase(),
      onStartLevel: (levelId) => options.gameLaunchCoordinator.startScriptedLevel(levelId),
      onExit: () => {
        options.gameLaunchCoordinator.closeSessionToMainMenu();
        if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
          window.location.reload();
        }
      },
      builtInMaps: ['forest_arena', 'map_default'],
      configureEditorFeatures: () => {
        FeatureManager.configure({ debugTools: true });
      },
      stopMusic: () => {
        options.audioManager.stopMusic();
      },
      getHasActiveLevel: () => !!options.worldRuntime.getActiveLevelGroup(),
      buildEditorPreviewLevel: () => options.worldRuntime.buildFlatTestMap('editor_preview'),
      clearActiveLevel: () => options.worldRuntime.clearActiveLevel(),
      buildBuiltInMap: (mapId) => options.worldRuntime.buildMatchLevel(mapId, mapId),
      setActiveLevelGroup: (group) => {
        options.worldRuntime.setActiveLevelGroup(group);
      },
      loadSavedMap: (name) => {
        if (getSavedLevelNames().includes(name)) {
          void runWithLoading(() => {
            if (!loadLevelFromStorage(name)) {
              console.warn(`[RuntimeUiCompositionCoordinator] Failed to load saved level: ${name}`);
            }
          });
          return;
        }

        void runWithLoading(() => {
          Engine.loadMap(name);
        });
      },
      saveMap: (name) => {
        Engine.saveMap(name);
      },
      setEngineMode: (mode) => {
        options.engineController.setRuntimeMode(mode, 'main-menu');
      },
      enableMultiplayerFeature: () => {
        FeatureManager.enable('multiplayer');
      },
      transitionState: (state, reason) => {
        if (state === 'lobby' && reason === 'open_multiplayer') {
          options.multiplayerRuntime.prepareMultiplayerLobby(reason);
        }
        options.multiplayerRuntime.transitionEngineState(state as 'menu' | 'lobby' | 'starting' | 'in_game' | 'post_game', reason);
      },
      getLevels: () => (options.scriptedLevelSystem?.listLevels() ?? []).map((level) => ({
        id: level.id,
        label: level.label,
        description: level.description,
      })),
      getMaps: () => {
        const engineMaps = Engine.listMaps();
        const savedMaps = getSavedLevelNames();
        return Array.from(new Set([...engineMaps, ...savedMaps]));
      },
      getFeatures: () => {
        return (Object.keys(FEATURE_META) as FeatureKey[]).map((key) => ({
          key,
          label: FEATURE_META[key].label,
          enabled: FeatureManager.isEnabled(key),
        }));
      },
      toggleFeature: (key) => {
        FeatureManager.toggle(key as FeatureKey);
      },
      configureFeatures: (config) => {
        FeatureManager.configure(config as Partial<Record<FeatureKey, boolean>>);
        FeatureManager.save();
      },
      getAudioState: () => options.audioManager.getMixerState(),
      adjustAudio: (channel, delta) => {
        options.audioManager.adjustChannelVolume(channel, delta);
      },
      toggleAudioMute: () => {
        options.audioManager.toggleMute();
      },
      openDebug: () => {
        options.debugManager.enable();
      },
      onCustomize: () => {
        options.engineController.setRuntimeMode('editor', 'main-menu:customize');
      },
      onCustomizeExit: () => {
      },
      getCurrentMode: () => Engine.getEngineMode(),
      getCurrentGameMode: () => options.engineController.getGameMode(),
      getGameModes: () => options.engineGameModes.listModes().map((id) => {
        const mode = options.engineGameModes.getMode(id);
        return {
          id,
          label: mode?.displayName ?? id.toUpperCase(),
          description: `Internal id: ${id}`,
        };
      }),
      activateGameMode: (modeId) => {
        if (!options.engineGameModes.getMode(modeId)) return;
        options.engineController.setGameMode(modeId, 'main-menu');
        logEvent('engine', `Gamemode set to ${modeId} (menu)`);
        if (options.mpClient.connected) {
          options.mpClient.sendLobbyAction('GAME_MODE_SET', { mode: modeId });
        }
      },
      getIdentityPanel: () => options.menuIdentitySystem.getElement(),
      log: (message) => {
        console.log(message);
      },
    },
    serverBrowser: {
      httpUrl: options.multiplayerRuntime.getServerHttpUrl(),
      wsUrl: options.multiplayerRuntime.getServerWsUrl(),
      client: options.mpClient,
      getMaps: () => {
        const builtIn = ['forest_arena', 'map_default'];
        const saved = Engine.listMaps().filter((map) => !builtIn.includes(map));
        return [...builtIn, ...saved];
      },
      onClose: () => {
        options.multiplayerRuntime.transitionEngineState('menu', 'server_browser_close');
      },
      onGameStart: (data) => {
        options.multiplayerRuntime.handleGameStart(data);
      },
      onHostGame: ({ playerName, config }) => {
        options.multiplayerRuntime.hostAutostartMultiplayer({
          playerName,
          roomName: config.name,
          map: config.map,
          mode: config.mode,
          killLimit: config.killLimit,
          roundDurationSec: config.roundDurationSec,
          maxPlayers: config.maxPlayers,
          forceStart: false,
        });
      },
      onJoinGame: ({ playerName, roomId }) => {
        options.multiplayerRuntime.joinAutostartMultiplayer({
          playerName,
          roomId,
          autoReady: false,
        });
      },
    },
  });
}
