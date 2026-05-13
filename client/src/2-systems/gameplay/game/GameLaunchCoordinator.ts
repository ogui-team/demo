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
  possessLocalPlayerFromEditorCamera?: () => boolean;
  releasePossessedPlayerToEditor?: () => boolean;
  getCameraPosition?: () => Vector3Like | null;
  getCameraRotation?: () => Vector3Like | null;
  getPinnedPlayerSpawnPosition?: () => Vector3Like | null;
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
  resetLifecycle: () => void;
  suppressNextMenuShow: () => void;
  getEngineMode: () => 'editor' | 'play';
  buildActiveWorldBuffer: (reason: string) => Promise<{ success: boolean; reason?: string }>;
  applyActiveWorldBuffer: () => Promise<{ success: boolean; entitiesCreated: number; settingsApplied: number }>;
  rehydrateEditorPlacedColliders?: () => void;
  mergeRuntimeWorldIntoActiveBuffer?: (reason: string) => { success: boolean; mergedEntities: number; newEntityIds: string[] };
  onSceneLoadComplete?: (reason: string) => void;
}

export class GameLaunchCoordinator {
  private readonly config: GameLaunchCoordinatorConfig;
  private isFirstPlay: boolean = true;
  private pendingEditorSpawnPosition: Vector3Like | null = null;
  private pendingEditorSpawnRotation: Vector3Like | null = null;

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

  private syncOrPossessLocalPlayer(spawnPosition: Vector3Like): void {
    // Always sync to the calculated spawn position, not possession offset
    // This ensures editor→play toggle respects the selected spawn position
    // Use the editor camera rotation captured before play startup mutates runtime state.
    const spawnRotation = this.pendingEditorSpawnRotation
      ?? this.config.getCameraRotation?.()
      ?? { x: 0, y: 0, z: 0 };
    this.config.syncLocalPlayerToAuthoritativeSpawn(spawnPosition, spawnRotation);
    this.pendingEditorSpawnPosition = null;
    this.pendingEditorSpawnRotation = null;
  }

  private getForceSpawnPosition(): Vector3Like | null {
    const pinnedSpawn = this.config.getPinnedPlayerSpawnPosition?.() ?? null;
    if (pinnedSpawn) {
      console.log('[GameLaunch] HARD PRIORITY: using pinned player spawn position:', pinnedSpawn);
      return pinnedSpawn;
    }

    // Priority 1: Editor Camera World Position (always)
    const editorCameraPos = this.pendingEditorSpawnPosition ?? this.config.getCameraPosition?.() ?? null;
    if (editorCameraPos) {
      // Spawn slightly above the camera so physics can settle the player naturally.
      const cameraSpawnPos = { x: editorCameraPos.x, y: editorCameraPos.y + 0.2, z: editorCameraPos.z };
      console.log('[GameLaunch] HARD PRIORITY: using editor camera position (gravity-settled):', cameraSpawnPos);
      return cameraSpawnPos;
    }

    // Priority 2: Map spawn point (fallback only if Priority 1 fails)
    console.log('[GameLaunch] HARD PRIORITY: camera position unavailable, will use map default');
    return null;
  }

  private selectSpawnPosition(defaultSpawn: Vector3Like, context: 'scripted' | 'freeplay' | 'horde', isEditorToggle: boolean = false): Vector3Like {
    // If in EDITOR_TOGGLE mode, use hard spawn priority
    if (isEditorToggle) {
      const forceSpawn = this.getForceSpawnPosition();
      if (forceSpawn) {
        console.log(`[GameLaunch] ${context}: using forced editor camera position`);
        return forceSpawn;
      }
    }

    // Standard priority (non-EDITOR_TOGGLE or fallback)
    const pinnedSpawn = this.config.getPinnedPlayerSpawnPosition?.() ?? null;
    if (pinnedSpawn) {
      console.log(`[GameLaunch] ${context}: using pinned PlayerSpawnPoint prefab position:`, pinnedSpawn);
      return pinnedSpawn;
    }

    return defaultSpawn;
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

    const spawnPosition = this.selectSpawnPosition(this.config.registerScriptedSpawnPoints(levelId), 'scripted', false);

    const playerId = this.config.getLocalFreeplayPlayerId();
    this.config.setRuntimePlayerId(playerId);
    this.config.setRuntimePlayerIdInState(playerId);
    
    this.config.ensurePlayerRuntimeState(playerId);
    this.config.bindNetworkSyncLocalPlayer(playerId, 'local');
    this.config.showGameplayUi();
    this.config.activateGameMode('freeplay');
    void this.config.initOfflineInventoryGrid(playerId, this.config.getSpawnLoadoutWeapons(playerId));
    this.syncOrPossessLocalPlayer(spawnPosition);
    this.config.onSceneLoadComplete?.(`scripted:${levelId}`);
  }

  async startLocalFreeplay(fromEditor = false): Promise<void> {
    console.log(`[GameLaunch] Starting LOCAL FREEPLAY (isFirstPlay=${this.isFirstPlay})`);
    const isEditorToggle = fromEditor;

    if (isEditorToggle) {
      this.pendingEditorSpawnPosition = this.config.getCameraPosition?.() ?? null;
      this.pendingEditorSpawnRotation = this.config.getCameraRotation?.() ?? null;
    } else {
      this.pendingEditorSpawnPosition = null;
      this.pendingEditorSpawnRotation = null;
    }

    // Dirty-State-Reset: If first play, create clean snap of editor world
    if (this.isFirstPlay && isEditorToggle) {
      console.log('[GameLaunch] First play detected: clearing active world buffer for clean snap');
      this.isFirstPlay = false;
    }

    const buildResult = await this.config.buildActiveWorldBuffer('play');
    if (!buildResult.success) {
      this.config.showNotification(buildResult.reason ?? 'Build World failed.', 4);
      return;
    }
    
    this.config.setActiveMapCollisionLayout('freeplay_test', 'freeplay_test');
    this.config.setPendingMatchResetMode('full');
    this.config.setRuntimeMetricsSession('freeplay', this.getRuntimeMetricsIdentifier('freeplay_test'));

    if (this.config.isMultiplayerConnected()) {
      this.config.disconnectMultiplayerSession();
    }

    console.log(`[GameLaunch] Calling hardResetRuntimeState()`);
    this.config.hardResetRuntimeState('freeplay', { allowInGame: true });

    const worldApplyResult = await this.config.applyActiveWorldBuffer();
    if (worldApplyResult.success) {
      console.log('[GameLaunch] Applied active world buffer for freeplay');
      this.config.rehydrateEditorPlacedColliders?.();
      this.config.setActiveLevelGroup(null);
    } else {
      console.log(`[GameLaunch] Building flat test map`);
      const levelGroup = this.config.buildFlatTestMap('freeplay_test');
      this.config.setActiveLevelGroup(levelGroup);
      this.config.registerArenaSpawnPoints('test');
      this.config.syncFreeplayWorldObjects('freeplay_test');
    }

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
      console.log(`[GameLaunch] Transitioning state to 'in_game'`);
      this.config.transitionState('in_game', 'freeplay');
    }

    const playerId = this.config.getLocalFreeplayPlayerId();
    console.log(`[GameLaunch] Local freeplay player ID: ${playerId}`);
    this.config.setRuntimePlayerId(playerId);
    this.config.setRuntimePlayerIdInState(playerId);
    
    this.config.ensurePlayerRuntimeState(playerId);
    this.config.bindNetworkSyncLocalPlayer(playerId, 'local');
    this.config.showGameplayUi();
    console.log(`[GameLaunch] Calling activateGameMode('freeplay')`);
    this.config.activateGameMode('freeplay');
    void this.config.initOfflineInventoryGrid(playerId, this.config.getSpawnLoadoutWeapons(playerId));

    const spawnPosition = this.selectSpawnPosition(this.config.findFreeplaySpawnPosition(), 'freeplay', isEditorToggle);
    console.log(`[GameLaunch] Syncing player to spawn position:`, spawnPosition);
    this.syncOrPossessLocalPlayer(spawnPosition);
    this.config.onSceneLoadComplete?.('freeplay');
    console.log(`[GameLaunch] Freeplay startup complete`);
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

    const spawnPosition = this.selectSpawnPosition(this.config.findFreeplaySpawnPosition(), 'horde');
    this.syncOrPossessLocalPlayer(spawnPosition);
    this.config.onSceneLoadComplete?.('horde');
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
    this.config.onSceneLoadComplete?.('drift_bomb');
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

    void this.startLocalFreeplay();
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

  closeSessionForEditorTransition(): void {
    console.log('[GameLaunch] Closing active session for editor transition');
    this.onExitPlayMode();
    if (this.config.isMultiplayerConnected()) {
      this.config.disconnectMultiplayerSession();
    }

    this.config.releasePossessedPlayerToEditor?.();
    this.config.setHudMode('spectator');
    this.config.setLocalPlayerDead(false);
    this.config.setRuntimePlayerId(null);
    this.config.setRuntimePlayerIdInState(null);

    // ─ CRITICAL: Reset lifecycle orchestrator phase back to BOOT so editor mode works ─
    this.config.resetLifecycle();
    // ─ CRITICAL: Transition app state back to menu so P-toggle works again ─
    // Suppress the auto-show of MainMenu that _onEnter('menu') would trigger.
    this.config.suppressNextMenuShow();
    console.log('[GameLaunch] Transitioning state back to menu for editor mode');
    this.config.transitionState('menu', 'close_session_editor');
  }

  onExitPlayMode(): void {
    if (this.config.getEngineMode() !== 'play') {
      return;
    }

    // Clear all velocities on all entities before merging back to editor
    // This prevents velocity carryover from play mode affecting editor mode movement
    console.log('[GameLaunch] Clearing all entity velocities before exit...');
    this.clearAllVelocitiesForEditorTransition();

    // Merge play-mode edits back into the editor buffer so moved/edited editor
    // objects persist when returning to the editor.
    const mergeResult = this.config.mergeRuntimeWorldIntoActiveBuffer?.('onExitPlayMode');
    console.log('[GameLaunch] Merged runtime world into editor buffer on exit', mergeResult ?? { success: false });
  }

  private clearAllVelocitiesForEditorTransition(): void {
    try {
      const entityManager = (globalThis as any).__entityManager;
      if (!entityManager || typeof entityManager.getEntities !== 'function') {
        return;
      }

      const physicsSystem = (globalThis as any).__physicsSystem;
      if (!physicsSystem || typeof physicsSystem.setVelocity !== 'function') {
        return;
      }

      const ZERO_VEL = { x: 0, y: 0, z: 0 };
      let clearedCount = 0;

      for (const entity of entityManager.getEntities()) {
        try {
          physicsSystem.setVelocity(entity.id, ZERO_VEL);
          clearedCount++;
        } catch {
          // Silently skip entities without physics bodies
        }
      }

      console.log(`[GameLaunch] Cleared velocities for ${clearedCount} entities on editor transition`);
    } catch (error) {
      console.warn('[GameLaunch] Error clearing velocities:', error);
    }
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

    this.config.onSceneLoadComplete?.(`multiplayer:${data.map}`);

    const cachedLobby = this.config.getCachedLobbyState();
    const cachedRound = this.config.getCachedRoundState();
    if (!cachedRound || cachedRound.status !== 'active' || (cachedRound.timeRemainingMs ?? 0) <= 0) {
      const startedAt = Engine.time.now();
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
