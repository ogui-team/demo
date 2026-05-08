import * as Engine from '../../../0-foundation/foundation/Engine';
import { FeatureManager, FeatureKey, FEATURE_META } from '@engine/1-kernel/core/public-api';
import type { DebugManager } from './DebugManager';
import type { RuntimeDiagnosticsCoordinator } from './RuntimeDiagnosticsCoordinator';
import { registerRuntimeDiagnosticsDebugBindings } from './registerRuntimeDiagnosticsDebugBindings';

type HudPlayerMode = 'hidden' | 'play' | 'editor' | 'spectator';

interface EngineControllerDebugAdapter {
  is(state: string): boolean;
}

interface EngineGameModesDebugAdapter {
  getActiveName(): string | null;
  listModes(): string[];
  getMode(name: string): unknown;
  activate(name: string): void;
}

interface MultiplayerClientDebugAdapter {
  connected: boolean;
  playerId: string;
  sendLobbyAction(type: string, payload: Record<string, unknown>): void;
}

interface HudDebugAdapter {
  isVisible(): boolean;
  show(): void;
  hide(): void;
  getPlayerMode(): HudPlayerMode;
  setPlayerMode(mode: HudPlayerMode): void;
  setTeam(team: 'none' | 'red' | 'blue'): void;
}

interface NetGraphDebugAdapter {
  toggle(): void;
}

interface CullingDiagnosticsBinding {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

interface AudioTrackDefinition {
  id: string;
  label: string;
}

interface AudioMixerState {
  muted: boolean;
  master: number;
  music: number;
  sfx: number;
}

interface AudioManagerDebugAdapter {
  getTrackDefinitions(): AudioTrackDefinition[];
  getTrack(trackId: string): AudioTrackDefinition | null;
  getActiveMusicId(): string | null;
  playMusic(trackId: string): void;
  stopMusic(): void;
  getMixerState(): AudioMixerState;
  setMuted(enabled: boolean): void;
  setChannelVolume(channel: 'master' | 'music' | 'sfx', value: number): void;
}

interface RoundStateDebugAdapter {
  status: string;
  killLimit: number;
  timeRemainingMs: number;
  roundNumber: number;
  winnerId?: string | null;
}

interface PlayerStateDebugAdapter {
  name?: string;
  health?: number;
  kills?: number;
  deaths?: number;
  ping?: number;
}

interface GameModeManagerDebugAdapter {
  getPlayer(playerId: string): PlayerStateDebugAdapter | undefined;
  getRound(): RoundStateDebugAdapter;
}

interface RegisterMainDebugBindingsOptions {
  debugManager: DebugManager;
  engineController: EngineControllerDebugAdapter;
  engineGameModes: EngineGameModesDebugAdapter;
  mpClient: MultiplayerClientDebugAdapter;
  gameHUD: HudDebugAdapter;
  netGraph: NetGraphDebugAdapter;
  runtimeDiagnosticsCoordinator: RuntimeDiagnosticsCoordinator;
  liveCullingSystem: CullingDiagnosticsBinding;
  getAutoHealthChannelSync(): boolean;
  setAutoHealthChannelSync(enabled: boolean): void;
  syncHealthChannels(): void;
  getHealthChannelHpSummary(): string;
  getHealthChannelShieldSummary(): string;
  getHealthChannelGasSummary(): string;
  getRuntimeReplicationSampleSummary(): string;
  getRuntimeReplicationCorrelationSummary(): string;
  audioManager: AudioManagerDebugAdapter;
  gameModeManager: GameModeManagerDebugAdapter;
}

export function registerMainDebugBindings(options: RegisterMainDebugBindingsOptions): void {
  const {
    debugManager,
    engineController,
    engineGameModes,
    mpClient,
    gameHUD,
    netGraph,
    runtimeDiagnosticsCoordinator,
    liveCullingSystem,
    getAutoHealthChannelSync,
    setAutoHealthChannelSync,
    syncHealthChannels,
    getHealthChannelHpSummary,
    getHealthChannelShieldSummary,
    getHealthChannelGasSummary,
    getRuntimeReplicationSampleSummary,
    getRuntimeReplicationCorrelationSummary,
    audioManager,
    gameModeManager,
  } = options;

  const readHudVisible = (): boolean => Engine.getStateManagerInstance()?.getRaw('hud.visible') === true;
  const readHudMode = (): string => {
    const hudMode = Engine.getStateManagerInstance()?.getRaw('ui.hud.mode');
    return hudMode === 'play' || hudMode === 'editor' || hudMode === 'spectator' || hudMode === 'loading'
      ? hudMode
      : 'hidden';
  };
  const readGameMode = (): string | null => {
    const controllerMode = Engine.getEngineController()?.getGameMode();
    if (typeof controllerMode === 'string' && controllerMode.length > 0) {
      return controllerMode;
    }
    const stateMode = Engine.getStateManagerInstance()?.getRaw('game.mode');
    return typeof stateMode === 'string' && stateMode.length > 0 ? stateMode : null;
  };

  debugManager.addParameter('Mode', {
    id: 'mode_editor',
    name: 'Editor Mode [E]',
    type: 'button',
    get: () => Engine.getEngineMode(),
    set: () => {
      if (!engineController.is('in_game') && !engineController.is('starting')) Engine.setEngineMode('editor');
    },
  });

  debugManager.addParameter('Mode', {
    id: 'mode_play',
    name: 'Play Mode [P]',
    type: 'button',
    get: () => Engine.getEngineMode(),
    set: () => {
      if (!engineController.is('in_game') && !engineController.is('starting')) Engine.setEngineMode('play');
    },
  });

  let debugSelectedGameMode = readGameMode() ?? 'freeplay';

  debugManager.addParameter('Gameplay Modes', {
    id: 'game_mode_select',
    name: 'Active Game Mode',
    type: 'select',
    get: () => readGameMode() ?? debugSelectedGameMode,
    getOptions: () => engineGameModes.listModes(),
    set: (value) => {
      debugSelectedGameMode = String(value);
    },
  });

  debugManager.addParameter('Gameplay Modes', {
    id: 'game_mode_apply',
    name: 'Apply Selected Mode',
    type: 'button',
    get: () => '',
    set: () => {
      if (!engineGameModes.getMode(debugSelectedGameMode)) return;
      Engine.getEngineController()?.setGameMode(debugSelectedGameMode, 'debug-ui');
      if (mpClient.connected) {
        mpClient.sendLobbyAction('GAME_MODE_SET', { mode: debugSelectedGameMode });
      }
      debugManager.refreshUI();
    },
  });

  debugManager.addParameter('HUD & Overlay', {
    id: 'hud_visible',
    name: 'HUD Visible',
    type: 'checkbox',
    get: () => readHudVisible(),
    set: (value) => {
      Engine.getEngineController()?.setHudVisible(Boolean(value), 'debug-ui');
    },
  });

  debugManager.addParameter('HUD & Overlay', {
    id: 'hud_mode',
    name: 'HUD Mode',
    type: 'select',
    get: () => readHudMode(),
    getOptions: () => ['hidden', 'play', 'editor', 'spectator'],
    set: (value) => {
      const mode = value as HudPlayerMode;
      Engine.getEngineController()?.setHudMode(mode, 'debug-ui');
      Engine.getEngineController()?.setHudVisible(mode !== 'hidden', 'debug-ui');
    },
  });

  debugManager.addParameter('HUD & Overlay', {
    id: 'hud_debug_overlay',
    name: 'Toggle Debug Overlay [F2]',
    type: 'button',
    get: () => '',
    set: () => {
      Engine.getDebugOverlay()?.toggle();
    },
  });

  debugManager.addParameter('HUD & Overlay', {
    id: 'hud_netgraph',
    name: 'Toggle Netgraph',
    type: 'button',
    get: () => '',
    set: () => {
      netGraph.toggle();
    },
  });

  registerRuntimeDiagnosticsDebugBindings({
    debugManager,
    runtimeDiagnosticsCoordinator,
    liveCullingSystem,
    getAutoHealthChannelSync,
    setAutoHealthChannelSync,
    syncHealthChannels,
    getHealthChannelHpSummary,
    getHealthChannelShieldSummary,
    getHealthChannelGasSummary,
    getRuntimeReplicationSampleSummary,
    getRuntimeReplicationCorrelationSummary,
  });

  debugManager.addParameter('PS1 Pipeline', {
    id: 'pipeline_enabled',
    name: 'PS1 Render Pipeline',
    type: 'checkbox',
    get: () => Engine.isEnginePipelineEnabled(),
    set: (value) => Engine.setEnginePipelineEnabled(Boolean(value)),
  });

  debugManager.addParameter('PS1 Pipeline', {
    id: 'pipeline_grain',
    name: 'Film Grain',
    type: 'slider',
    min: 0,
    max: 0.3,
    step: 0.005,
    get: () => 0.08,
    set: (value) => Engine.setEnginePipelineFilmGrain(Number(value)),
  });

  debugManager.addParameter('PS1 Pipeline', {
    id: 'pipeline_vignette',
    name: 'Vignette',
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    get: () => 0.5,
    set: (value) => Engine.setEnginePipelineVignette(Number(value)),
  });

  debugManager.addParameter('PS1 Pipeline', {
    id: 'pipeline_dither',
    name: 'Dithering',
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.01,
    get: () => 0.25,
    set: (value) => Engine.setEnginePipelineDithering(Number(value)),
  });

  debugManager.addParameter('PS1 Pipeline', {
    id: 'pipeline_colorbits',
    name: 'Color Bits',
    type: 'slider',
    min: 2,
    max: 8,
    step: 1,
    get: () => 5,
    set: (value) => Engine.setEnginePipelineColorBits(Number(value)),
  });

  debugManager.addParameter('PS1 Pipeline', {
    id: 'pipeline_fog',
    name: 'Depth Fog',
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.01,
    get: () => 0.3,
    set: (value) => Engine.setEnginePipelineFog(Number(value)),
  });

  debugManager.addParameter('Atmosphere', {
    id: 'atm_postproc',
    name: 'Post-Processing Overlay',
    type: 'checkbox',
    get: () => Engine.getAtmosphericEffectsManager()?.isPostProcessingEnabled() ?? true,
    set: (value) => Engine.setEnginePostProcessingEnabled(Boolean(value)),
  });

  debugManager.addParameter('Atmosphere', {
    id: 'atm_fog',
    name: 'Dynamic Fog',
    type: 'checkbox',
    get: () => Engine.getAtmosphericEffectsManager()?.isFogEnabled() ?? true,
    set: (value) => Engine.setEngineFogEnabled(Boolean(value)),
  });

  debugManager.addParameter('Atmosphere', {
    id: 'atm_lighting',
    name: 'Lighting Effects',
    type: 'checkbox',
    get: () => Engine.getAtmosphericEffectsManager()?.isLightingEnabled() ?? true,
    set: (value) => Engine.setEngineLightingEnabled(Boolean(value)),
  });

  debugManager.addParameter('Atmosphere', {
    id: 'atm_camera',
    name: 'Camera Sway / Jitter',
    type: 'checkbox',
    get: () => Engine.getAtmosphericEffectsManager()?.isCameraEffectsEnabled() ?? true,
    set: (value) => Engine.setEngineCameraEffectsEnabled(Boolean(value)),
  });

  debugManager.addParameter('Fog', {
    id: 'fog_density',
    name: 'Base Density',
    type: 'slider',
    min: 0,
    max: 0.1,
    step: 0.001,
    get: () => {
      const manager = Engine.getAtmosphericEffectsManager();
      const fog = manager?.getFogEffects();
      return fog?.baseDensity ?? 0.015;
    },
    set: (value) => Engine.setEngineFogDensity(Number(value)),
  });

  debugManager.addParameter('Fog', {
    id: 'fog_color',
    name: 'Color',
    type: 'color',
    get: () => '#334444',
    set: (value) => {
      const hexColor = parseInt(String(value).replace('#', ''), 16);
      Engine.setEngineFogColor(hexColor);
    },
  });

  debugManager.addParameter('Camera', {
    id: 'camera_fov',
    name: 'FOV',
    type: 'slider',
    min: 30,
    max: 120,
    step: 1,
    get: () => Engine.getEngineCameraFOV(),
    set: (value) => Engine.setEngineCameraFOV(Number(value)),
  });

  const featureKeys = Object.keys(FEATURE_META) as FeatureKey[];
  for (const key of featureKeys) {
    const meta = FEATURE_META[key];
    debugManager.addParameter('Features', {
      id: `feature_${key}`,
      name: meta.label,
      type: 'checkbox',
      get: () => FeatureManager.isEnabled(key),
      set: (value) => {
        if (Boolean(value)) FeatureManager.enable(key);
        else FeatureManager.disable(key);
      },
    });
  }

  let debugSelectedAudioTrackId = audioManager.getTrackDefinitions()[0]?.id ?? '';

  const getDebugAudioTracks = (): AudioTrackDefinition[] => {
    return audioManager.getTrackDefinitions();
  };

  const syncDebugAudioTrackSelection = (): string => {
    const tracks = getDebugAudioTracks();
    if (tracks.length === 0) {
      debugSelectedAudioTrackId = '';
      return '';
    }

    if (!tracks.some((track) => track.id === debugSelectedAudioTrackId)) {
      debugSelectedAudioTrackId = audioManager.getActiveMusicId() ?? tracks[0].id;
    }

    return debugSelectedAudioTrackId;
  };

  const getDebugAudioTrackOptionLabel = (trackId: string): string => {
    const track = audioManager.getTrack(trackId);
    return track ? `${track.label} (${track.id})` : trackId;
  };

  const getDebugSelectedAudioTrackLabel = (): string => {
    const trackId = syncDebugAudioTrackSelection();
    return trackId ? getDebugAudioTrackOptionLabel(trackId) : 'No tracks registered';
  };

  const stepDebugAudioTrack = (delta: number): void => {
    const tracks = getDebugAudioTracks();
    if (tracks.length === 0) return;

    const currentId = syncDebugAudioTrackSelection();
    const currentIndex = Math.max(0, tracks.findIndex((track) => track.id === currentId));
    const nextIndex = (currentIndex + delta + tracks.length) % tracks.length;
    debugSelectedAudioTrackId = tracks[nextIndex].id;
    audioManager.playMusic(debugSelectedAudioTrackId);
    debugManager.refreshUI();
  };

  debugManager.addParameter('Audio Manager', {
    id: 'audio_active_track',
    name: 'Now Playing',
    type: 'input',
    get: () => {
      const activeTrackId = audioManager.getActiveMusicId();
      return activeTrackId ? getDebugAudioTrackOptionLabel(activeTrackId) : 'Stopped';
    },
    set: () => {},
  });

  debugManager.addParameter('Audio Manager', {
    id: 'audio_track_select',
    name: 'OST Carousel',
    type: 'select',
    get: () => getDebugSelectedAudioTrackLabel(),
    getOptions: () => getDebugAudioTracks().map((track) => getDebugAudioTrackOptionLabel(track.id)),
    set: (value) => {
      const selected = getDebugAudioTracks().find((track) => getDebugAudioTrackOptionLabel(track.id) === value);
      if (!selected) return;
      debugSelectedAudioTrackId = selected.id;
      debugManager.refreshUI();
    },
  });

  debugManager.addParameter('Audio Manager', {
    id: 'audio_track_prev',
    name: 'Previous Track',
    type: 'button',
    get: () => '',
    set: () => {
      stepDebugAudioTrack(-1);
    },
  });

  debugManager.addParameter('Audio Manager', {
    id: 'audio_track_play',
    name: 'Play Selected Track',
    type: 'button',
    get: () => '',
    set: () => {
      const selectedTrackId = syncDebugAudioTrackSelection();
      if (!selectedTrackId) return;
      audioManager.playMusic(selectedTrackId);
      debugManager.refreshUI();
    },
  });

  debugManager.addParameter('Audio Manager', {
    id: 'audio_track_next',
    name: 'Next Track',
    type: 'button',
    get: () => '',
    set: () => {
      stepDebugAudioTrack(1);
    },
  });

  debugManager.addParameter('Audio Manager', {
    id: 'audio_track_stop',
    name: 'Stop Music',
    type: 'button',
    get: () => '',
    set: () => {
      audioManager.stopMusic();
      debugManager.refreshUI();
    },
  });

  debugManager.addParameter('Audio Manager', {
    id: 'audio_muted',
    name: 'Mute Audio',
    type: 'checkbox',
    get: () => audioManager.getMixerState().muted,
    set: (value) => {
      audioManager.setMuted(Boolean(value));
    },
  });

  debugManager.addParameter('Audio Manager', {
    id: 'audio_master',
    name: 'Master Volume',
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.01,
    get: () => audioManager.getMixerState().master,
    set: (value) => {
      audioManager.setChannelVolume('master', Number(value));
    },
  });

  debugManager.addParameter('Audio Manager', {
    id: 'audio_music',
    name: 'Music Volume',
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.01,
    get: () => audioManager.getMixerState().music,
    set: (value) => {
      audioManager.setChannelVolume('music', Number(value));
    },
  });

  debugManager.addParameter('Audio Manager', {
    id: 'audio_sfx',
    name: 'SFX Volume',
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.01,
    get: () => audioManager.getMixerState().sfx,
    set: (value) => {
      audioManager.setChannelVolume('sfx', Number(value));
    },
  });

  debugManager.addParameter('Character', {
    id: 'char_name',
    name: 'Name',
    type: 'input',
    get: () => {
      const player = gameModeManager.getPlayer(mpClient.playerId);
      return player?.name ?? mpClient.playerId ?? 'â€”';
    },
    set: () => {},
  });

  debugManager.addParameter('Character', {
    id: 'char_health',
    name: 'Health',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    get: () => {
      const player = gameModeManager.getPlayer(mpClient.playerId);
      return player?.health ?? 100;
    },
    set: () => {},
  });

  debugManager.addParameter('Character', {
    id: 'char_team',
    name: 'Team',
    type: 'select',
    get: () => 'none',
    getOptions: () => ['none', 'red', 'blue'],
    set: (value) => {
      gameHUD.setTeam(value as 'none' | 'red' | 'blue');
    },
  });

  debugManager.addParameter('Character', {
    id: 'char_mode',
    name: 'Player Mode',
    type: 'select',
    get: () => readHudMode(),
    getOptions: () => ['hidden', 'play', 'editor', 'spectator'],
    set: (value) => {
      const mode = value as HudPlayerMode;
      Engine.getEngineController()?.setHudMode(mode, 'debug-ui');
      Engine.getEngineController()?.setHudVisible(mode !== 'hidden', 'debug-ui');
    },
  });

  debugManager.addParameter('Character', {
    id: 'char_kills',
    name: 'Kills',
    type: 'input',
    get: () => String(gameModeManager.getPlayer(mpClient.playerId)?.kills ?? 0),
    set: () => {},
  });

  debugManager.addParameter('Character', {
    id: 'char_deaths',
    name: 'Deaths',
    type: 'input',
    get: () => String(gameModeManager.getPlayer(mpClient.playerId)?.deaths ?? 0),
    set: () => {},
  });

  debugManager.addParameter('Character', {
    id: 'char_pos',
    name: 'Position',
    type: 'input',
    get: () => {
      const camera = Engine.getEngineCamera();
      if (!camera) return 'â€”';
      return `${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}`;
    },
    set: () => {},
  });

  debugManager.addParameter('Character', {
    id: 'char_ping',
    name: 'Ping (ms)',
    type: 'input',
    get: () => String(gameModeManager.getPlayer(mpClient.playerId)?.ping ?? 0),
    set: () => {},
  });

  debugManager.addParameter('Match', {
    id: 'match_status',
    name: 'Status',
    type: 'input',
    get: () => gameModeManager.getRound().status,
    set: () => {},
  });

  debugManager.addParameter('Match', {
    id: 'match_kill_limit',
    name: 'Kill Limit',
    type: 'slider',
    min: 1,
    max: 100,
    step: 1,
    get: () => gameModeManager.getRound().killLimit,
    set: () => {
      debugManager.refreshUI();
    },
  });

  debugManager.addParameter('Match', {
    id: 'match_round_time',
    name: 'Time Remaining (s)',
    type: 'slider',
    min: 0,
    max: 1800,
    step: 1,
    get: () => Math.max(0, Math.ceil(gameModeManager.getRound().timeRemainingMs / 1000)),
    set: () => {},
  });

  debugManager.addParameter('Match', {
    id: 'match_round_num',
    name: 'Round #',
    type: 'input',
    get: () => String(gameModeManager.getRound().roundNumber),
    set: () => {},
  });

  debugManager.addParameter('Match', {
    id: 'match_winner',
    name: 'Winner',
    type: 'input',
    get: () => {
      const winnerId = gameModeManager.getRound().winnerId;
      if (!winnerId) return 'â€”';
      return gameModeManager.getPlayer(winnerId)?.name ?? winnerId;
    },
    set: () => {},
  });

  debugManager.addParameter('Match', {
    id: 'match_scoreboard',
    name: 'Show Scores',
    type: 'button',
    get: () => '',
    set: () => {
      debugManager.refreshUI();
    },
  });

  let mapSaveName = '';

  debugManager.addParameter('Map', {
    id: 'map_save_name',
    name: 'Save Name',
    type: 'input',
    get: () => mapSaveName,
    set: (value) => {
      mapSaveName = String(value);
    },
  });

  debugManager.addParameter('Map', {
    id: 'map_save_btn',
    name: 'Save Map',
    type: 'button',
    get: () => '',
    set: () => {
      const name = mapSaveName.trim();
      if (!name) return;
      const ok = Engine.saveMap(name);
      console.log(ok ? `[Map] Saved: "${name}"` : '[Map] Save failed');
      debugManager.refreshUI();
    },
  });

  let mapLoadName = '';

  debugManager.addParameter('Map', {
    id: 'map_load_select',
    name: 'Select Map',
    type: 'select',
    get: () => mapLoadName,
    getOptions: () => Engine.listMaps(),
    set: (value) => {
      mapLoadName = String(value);
    },
  });

  debugManager.addParameter('Map', {
    id: 'map_load_btn',
    name: 'Load Selected Map',
    type: 'button',
    get: () => '',
    set: () => {
      const name = mapLoadName.trim();
      if (!name) {
        console.warn('[Map] No map selected');
        return;
      }
      const result = Engine.loadMap(name);
      if (result.success) {
        Engine.setEngineMode('editor');
        console.log(`[Map] Loaded "${name}" - ${result.entitiesCreated} entities`);
      } else {
        console.warn(`[Map] Failed to load "${name}"`);
      }
      debugManager.refreshUI();
    },
  });
}
