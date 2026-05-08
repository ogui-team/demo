import type { Group } from 'three';
import type { RoundState } from './PlayerState';

type Vector3Like = { x: number; y: number; z: number };
type ResetPhase = 'soft' | 'full';

interface ScriptedLevelListEntry {
  id: string;
}

interface CachedLobbyState {
  roundDurationSec?: number;
  killLimit?: number;
}

interface CachedRoundState {
  status?: string | null;
  timeRemainingMs?: number | null;
}

export interface MultiplayerGameStartPayload {
  map: string;
  mode: string;
  sessionId: string;
  late?: boolean;
}

export interface GameLaunchCoordinatorConfig {
  getAvailableScriptedLevels: () => ScriptedLevelListEntry[];
  getCurrentPlayerId: () => string | null;
  setActiveMapCollisionLayout: (mapId: string, sessionId: string) => void;
  setPendingMatchResetMode: (mode: ResetPhase) => void;
  configureFeatures: (config: Record<string, boolean>) => void;
  enableMultiplayerFeature: () => void;
  stopMusic: () => void;
  isInGame: () => boolean;
  isMultiplayerConnected: () => boolean;
  disconnectMultiplayerSession: () => void;
  transitionState: (state: 'menu' | 'lobby' | 'starting' | 'in_game' | 'post_game', reason: string) => void;
  hardResetRuntimeState: (reason: string, options?: { allowInGame?: boolean }) => void;
  resetGameplayWorld: () => void;
  clearPlayerModels: () => void;
  clearWorldObjects: () => void;
  buildScriptedLevel: (levelId: string) => Group | null;
  buildFlatTestMap: (mapId: string) => Group | null;
  buildMatchLevel: (sessionId: string, mapId: string) => Group | null;
  setActiveLevelGroup: (group: Group | null) => void;
  registerStaticLevelGeometryForCulling: (group: Group) => void;
  registerScriptedSpawnPoints: (levelId: string) => Vector3Like;
  buildHordeArena: (sessionId: string) => Group | null;
  registerArenaSpawnPoints: (kind: 'default' | 'test' | 'forest') => void;
  findFreeplaySpawnPosition: () => Vector3Like;
  getSpawnLoadoutWeapons: (playerId: string) => string[];
  showNotification: (text: string, durationSeconds: number) => void;
  initOfflineInventoryGrid: (playerId: string, weaponIds: string[]) => Promise<void> | void;
  setRuntimePlayerId: (playerId: string | null) => void;
  ensurePlayerRuntimeState: (playerId: string) => void;
  bindNetworkSyncLocalPlayer: (playerId: string, authorityMode: 'local' | 'remote') => void;
  showGameplayUi: () => void;
  setHudMode: (mode: 'play' | 'spectator' | 'editor' | 'hidden' | 'loading') => void;
  ensureGameplayUiActive: () => void;
  activateGameMode: (modeName: string) => void;
  syncLocalPlayerToAuthoritativeSpawn: (position: Vector3Like, rotation: Vector3Like) => void;
  setRuntimeMetricsSession: (kind: 'multiplayer' | 'scripted' | 'freeplay', identifier: string) => void;
  setRuntimePlayerIdInState: (playerId: string | null) => void;
  getLocalFreeplayPlayerId: () => string;
  getCachedLobbyState: () => CachedLobbyState | null;
  getCachedRoundState: () => CachedRoundState | null;
  getNextRoundNumber: () => number;
  startRound: (round: RoundState) => void;
  prepareRoundInitialization: (reason: string, phase: ResetPhase) => void;
  setLocalPlayerDead: (dead: boolean) => void;
  syncFreeplayWorldObjects: (mapId: string) => void;
  disablePhysGun: () => void;
}

export class GameLaunchCoordinator {
  private readonly config: GameLaunchCoordinatorConfig;

  constructor(config: GameLaunchCoordinatorConfig) {
    this.config = config;
  }

  private getRuntimeMetricsIdentifier(fallback: string): string {
    if (typeof window === 'undefined') return fallback;
    try {
      return new URLSearchParams(window.location.search).get('metricsSessionId') ?? fallback;
    } catch {
      return fallback;
    }
  }

  startScriptedLevel(levelId: string): void {
    console.log(`[GameLaunch] Starting SCRIPTED level: ${levelId}`);
    this.config.setActiveMapCollisionLayout(`scripted:${levelId}`, levelId);
    this.config.setPendingMatchResetMode('full');
    this.config.setRuntimeMetricsSession('scripted', this.getRuntimeMetricsIdentifier(levelId));

    if (this.config.isMultiplayerConnected()) {
      this.config.disconnectMultiplayerSession();
    }
    this.config.hardResetRuntimeState(`scripted_level:${levelId}`, { allowInGame: true });

    this.config.configureFeatures({
      fog: true,
      visualEffects: true,
      enemyAI: true,
      audio: true,
      weapons: true,
      proceduralLevels: true,
      debugTools: true,
    });

    if (!this.config.isInGame()) {
      this.config.transitionState('in_game', `scripted_level:${levelId}`);
    }

    const levelGroup = this.config.buildScriptedLevel(levelId);
    this.config.setActiveLevelGroup(levelGroup);
    if (levelGroup) {
      this.config.registerStaticLevelGeometryForCulling(levelGroup);
    }

    const spawnPosition = this.config.registerScriptedSpawnPoints(levelId);

    const playerId = this.config.getLocalFreeplayPlayerId();
    this.config.setRuntimePlayerId(playerId);
    this.config.setRuntimePlayerIdInState(playerId);
    
    this.config.ensurePlayerRuntimeState(playerId);
    this.config.bindNetworkSyncLocalPlayer(playerId, 'local');
    this.config.showGameplayUi();
    this.config.activateGameMode('freeplay');
    void this.config.initOfflineInventoryGrid(playerId, this.config.getSpawnLoadoutWeapons(playerId));
    this.config.syncLocalPlayerToAuthoritativeSpawn(spawnPosition, { x: 0, y: 0, z: 0 });
  }

  startLocalFreeplay(): void {
    console.log(`[GameLaunch] Starting LOCAL FREEPLAY`);
    this.config.setActiveMapCollisionLayout('freeplay_test', 'freeplay_test');
    this.config.setPendingMatchResetMode('full');
    this.config.setRuntimeMetricsSession('freeplay', this.getRuntimeMetricsIdentifier('freeplay_test'));

    if (this.config.isMultiplayerConnected()) {
      this.config.disconnectMultiplayerSession();
    }
    this.config.hardResetRuntimeState('freeplay', { allowInGame: true });

    this.config.configureFeatures({
      fog: true,
      visualEffects: true,
      enemyAI: true,
      audio: true,
      weapons: true,
      debugTools: true,
    });
    this.config.stopMusic();

    if (!this.config.isInGame()) {
      this.config.transitionState('in_game', 'freeplay');
    }

    const levelGroup = this.config.buildFlatTestMap('freeplay_test');
    this.config.setActiveLevelGroup(levelGroup);
    this.config.registerArenaSpawnPoints('test');
    this.config.syncFreeplayWorldObjects('freeplay_test');

    const playerId = this.config.getLocalFreeplayPlayerId();
    this.config.setRuntimePlayerId(playerId);
    this.config.setRuntimePlayerIdInState(playerId);
    
    this.config.ensurePlayerRuntimeState(playerId);
    this.config.bindNetworkSyncLocalPlayer(playerId, 'local');
    this.config.showGameplayUi();
    this.config.activateGameMode('freeplay');
    void this.config.initOfflineInventoryGrid(playerId, this.config.getSpawnLoadoutWeapons(playerId));

    const spawnPosition = this.config.findFreeplaySpawnPosition();
    this.config.syncLocalPlayerToAuthoritativeSpawn(spawnPosition, { x: 0, y: 0, z: 0 });
  }

  startHorde(): void {
    console.log(`[GameLaunch] Starting HORDE MODE`);
    this.config.setActiveMapCollisionLayout('horde_arena', 'horde_mode');
    this.config.setPendingMatchResetMode('full');
    this.config.setRuntimeMetricsSession('freeplay', this.getRuntimeMetricsIdentifier('horde_mode'));

    if (this.config.isMultiplayerConnected()) {
      this.config.disconnectMultiplayerSession();
    }
    this.config.hardResetRuntimeState('horde', { allowInGame: true });

    this.config.configureFeatures({
      fog: true,
      visualEffects: true,
      enemyAI: true,
      audio: true,
      weapons: true,
      debugTools: true,
    });
    this.config.stopMusic();

    if (!this.config.isInGame()) {
      this.config.transitionState('in_game', 'horde');
    }

    const levelGroup = this.config.buildHordeArena('horde_mode');
    this.config.setActiveLevelGroup(levelGroup);
    this.config.registerArenaSpawnPoints('test');
    this.config.syncFreeplayWorldObjects('horde_arena');

    const playerId = this.config.getLocalFreeplayPlayerId();
    this.config.setRuntimePlayerId(playerId);
    this.config.setRuntimePlayerIdInState(playerId);
    
    this.config.ensurePlayerRuntimeState(playerId);
    this.config.bindNetworkSyncLocalPlayer(playerId, 'local');
    this.config.showGameplayUi();
    this.config.activateGameMode('horde');
    this.config.showNotification('Z = Zombie mode', 60);
    this.config.disablePhysGun();
    void this.config.initOfflineInventoryGrid(playerId, this.config.getSpawnLoadoutWeapons(playerId));

    const spawnPosition = this.config.findFreeplaySpawnPosition();
    this.config.syncLocalPlayerToAuthoritativeSpawn(spawnPosition, { x: 0, y: 0, z: 0 });
  }

  startDriftBomb(): void {
    console.log('[GameLaunch] Starting DRIFT BOMB MODE (debug-fast path)');
    this.config.setHudMode('loading');
    this.config.showNotification('Loading Drift Bomb debug map...', 2);
    this.config.setActiveMapCollisionLayout('freeplay_test', 'drift_bomb_debug_map');
    this.config.setPendingMatchResetMode('full');
    this.config.setRuntimeMetricsSession('freeplay', this.getRuntimeMetricsIdentifier('drift_bomb_debug_map'));

    if (this.config.isMultiplayerConnected()) {
      this.config.disconnectMultiplayerSession();
    }
    this.config.hardResetRuntimeState('drift_bomb', { allowInGame: true });

    this.config.configureFeatures({
      fog: true,
      visualEffects: true,
      enemyAI: false,
      audio: true,
      weapons: true,
      debugTools: true,
    });
    this.config.stopMusic();

    if (!this.config.isInGame()) {
      this.config.transitionState('in_game', 'drift_bomb');
    }

    // Use compact debug map path for fast startup and deterministic validation.
    const levelGroup = this.config.buildFlatTestMap('drift_bomb_debug_map');
    this.config.setActiveLevelGroup(levelGroup);
    this.config.registerArenaSpawnPoints('test');
    this.config.syncFreeplayWorldObjects('drift_bomb_debug_map');

    const playerId = this.config.getLocalFreeplayPlayerId();
    this.config.setRuntimePlayerId(playerId);
    this.config.setRuntimePlayerIdInState(playerId);

    this.config.ensurePlayerRuntimeState(playerId);
    this.config.bindNetworkSyncLocalPlayer(playerId, 'local');
    this.config.showGameplayUi();
    this.config.disablePhysGun();
    this.config.setHudMode('spectator');
    this.config.activateGameMode('drift_bomb');
    this.config.showNotification('Drift Bomb ready. Choose team or auto-join debug flow.', 30);
  }

  startEngineShowcase(): void {
    const availableLevels = this.config.getAvailableScriptedLevels();
    const preferredLevelId = availableLevels.find((level) => level.id === 'quarry_outpost')?.id
      ?? availableLevels.find((level) => level.id === 'dead_pines')?.id
      ?? availableLevels[0]?.id
      ?? null;

    if (preferredLevelId) {
      this.startScriptedLevel(preferredLevelId);
      return;
    }

    this.startLocalFreeplay();
  }

  closeSessionToMainMenu(): void {
    console.log('[GameLaunch] Closing active session and returning to main menu');
    if (this.config.isMultiplayerConnected()) {
      this.config.disconnectMultiplayerSession();
    }
    this.config.hardResetRuntimeState('close_session', { allowInGame: true });
    this.config.setRuntimePlayerId(null);
    this.config.setRuntimePlayerIdInState(null);
    this.config.transitionState('menu', 'close_session');
  }

  startMultiplayerMatch(data: MultiplayerGameStartPayload): void {
    console.log(`[GameLaunch] Starting MULTIPLAYER: map=${data.map}, mode=${data.mode}, sessionId=${data.sessionId}`);
    // Gate 1A: MODE-SCOPED COLLISION - Load collision for multiplayer mode immediately
    this.config.setActiveMapCollisionLayout(data.map, data.sessionId);
    
    this.config.enableMultiplayerFeature();
    this.config.setPendingMatchResetMode('full');
    this.config.setRuntimeMetricsSession('multiplayer', this.getRuntimeMetricsIdentifier(data.sessionId));
    this.config.hardResetRuntimeState(`multiplayer_match:${data.sessionId}`);

    if (!data.late) {
      this.config.transitionState('starting', 'multiplayer_game_start');
      this.config.transitionState('in_game', 'multiplayer_game_start');
    } else if (!this.config.isInGame()) {
      this.config.transitionState('starting', 'multiplayer_game_start_late');
      this.config.transitionState('in_game', 'multiplayer_game_start_late');
    }
    const levelGroup = this.config.buildMatchLevel(data.sessionId, data.map);
    this.config.setActiveLevelGroup(levelGroup);
    this.config.ensureGameplayUiActive();
    this.config.registerArenaSpawnPoints(data.map === 'forest_arena' ? 'forest' : 'default');
    this.config.setLocalPlayerDead(false);

    // Ensure spawn loadout resolution uses the selected multiplayer mode.
    const selectedMode = data.mode === 'horde'
      ? 'horde'
      : data.mode === 'drift_bomb'
        ? 'drift_bomb'
        : 'round';
    this.config.activateGameMode(selectedMode);

    const playerId = this.config.getCurrentPlayerId();
    if (playerId) {
      this.config.setRuntimePlayerId(playerId);
      // ─ DYNAMIC-PLAYER-ID-HYDRATION: Update state manager with current player ID
      this.config.setRuntimePlayerIdInState(playerId);
      
      this.config.ensurePlayerRuntimeState(playerId);
      // Multiplayer inventory can be empty/late; seed local grid from mode loadout.
      // Server sync can still overwrite later when authoritative inventory arrives.
      void this.config.initOfflineInventoryGrid(playerId, this.config.getSpawnLoadoutWeapons(playerId));
      this.config.bindNetworkSyncLocalPlayer(playerId, 'remote');
    }

    const cachedLobby = this.config.getCachedLobbyState();
    const cachedRound = this.config.getCachedRoundState();
    if (!cachedRound || cachedRound.status !== 'active' || (cachedRound.timeRemainingMs ?? 0) <= 0) {
      const startedAt = Date.now();
      const durationMs = (cachedLobby?.roundDurationSec ?? 180) * 1000;
      this.config.startRound({
        mode: data.mode === 'horde'
          ? 'horde'
          : data.mode === 'drift_bomb'
            ? 'drift_bomb'
            : 'ffa',
        status: 'active',
        phase: 'in_round',
        roundNumber: this.config.getNextRoundNumber(),
        killLimit: cachedLobby?.killLimit ?? 10,
        timeRemainingMs: durationMs,
        startedAt,
        endsAt: startedAt + durationMs,
        winnerId: null,
        reason: null,
      });
    }

    this.config.prepareRoundInitialization('game_start', 'full');
  }

  private clearCurrentGameplay(): void {
    this.config.clearPlayerModels();
    this.config.clearWorldObjects();
    this.config.resetGameplayWorld();
  }
}
