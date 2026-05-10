import type { StateManager } from '../../../0-foundation/foundation/state/StateManager';

/**
 * PHASE 2: StateManager Hydration
 * Pre-populate StateManager with default state tree before any system initialization
 * This prevents "Path not found" warnings and ensures systems can safely read state
 */
export function hydrateStateManager(stateManager: StateManager): void {
  console.info('[Bootstrap Phase 2] Starting StateManager hydration with default state tree...');

  try {
    // Initialize non-authoritative game state defaults.
    // Runtime authority paths like game.mode / hud.visible are owned by EngineController.
    stateManager.set('game.isPaused', false);
    stateManager.set('game.difficulty', 1);
    stateManager.set('game.level', 0);
    stateManager.set('game.seed', 0);

    // Initialize player state defaults
    stateManager.set('players.local.id', null);
    stateManager.set('players.local.name', 'Player');
    stateManager.set('players.local.health', 100);
    stateManager.set('players.local.maxHealth', 100);
    stateManager.set('players.local.armor', 0);
    stateManager.set('players.local.position', { x: 0, y: 0, z: 0 });
    stateManager.set('players.local.rotation', { x: 0, y: 0, z: 0 });
    stateManager.set('players.local.isAlive', true);

    // Initialize weapon/inventory state defaults
    stateManager.set('players.local.weapons', []);
    stateManager.set('players.local.currentWeapon', null);

    // Initialize non-authoritative HUD data defaults.
    stateManager.set('hud.healthBarVisible', true);
    stateManager.set('hud.ammoCounterVisible', true);
    stateManager.set('hud.radarVisible', true);
    stateManager.set('hud.notifications', []);

    // Initialize diagnostics state defaults
    stateManager.set('diagnostics.weapons.equipped', []);
    stateManager.set('diagnostics.weapons.available', []);
    stateManager.set('diagnostics.health.current', 100);
    stateManager.set('diagnostics.health.max', 100);
    stateManager.set('diagnostics.ammo', {});

    // Initialize UI state defaults
    stateManager.set('ui.inventory.open', false);
    stateManager.set('ui.menu.open', false);
    stateManager.set('ui.settings.open', false);
    stateManager.set('ui.modal', null);

    // Initialize multiplayer state defaults
    stateManager.set('multiplayer.isConnected', false);
    stateManager.set('multiplayer.playerId', null);
    stateManager.set('multiplayer.playerCount', 0);
    stateManager.set('multiplayer.remoteEntities', []);

    // Initialize entity state defaults
    stateManager.set('entities.local', {});
    stateManager.set('entities.remote', {});
    stateManager.set('entities.count', 0);

    // Initialize physics state defaults
    stateManager.set('physics.gravity', 9.81);
    stateManager.set('physics.isSimulating', true);

    // Initialize rendering state defaults
    stateManager.set('rendering.fogDensity', 0.02);
    stateManager.set('rendering.fogColor', 0x334444);
    stateManager.set('rendering.ambientLight', 0.4);
    stateManager.set('rendering.directionalLight', 0.8);

    console.info('[Bootstrap Phase 2] StateManager hydration complete ✓');
  } catch (error) {
    console.error('[Bootstrap Phase 2] StateManager hydration failed:', error);
    throw new Error(`StateManager hydration failed: ${error}`);
  }
}

/**
 * DYNAMIC PLAYER ID HYDRATION
 * Update multiplayer.playerId in state manager when game mode starts.
 * This ensures all UI/systems have the current player ID available.
 */
export function setRuntimePlayerIdInState(stateManager: StateManager, playerId: string | null): void {
  if (!stateManager) {
    console.error('[StateManager] Cannot set runtime player ID: StateManager not initialized');
    return;
  }
  
  const currentId = stateManager.getRaw('multiplayer.playerId');
  if (currentId === playerId) {
    return; // No change needed
  }
  
  stateManager.set('multiplayer.playerId', playerId);
  
  // Also update players.local.id if this is a local player ID
  if (playerId) {
    stateManager.set('players.local.id', playerId);
    console.log('[StateManager] Runtime player ID set:', {
      playerId,
      timestamp: Engine.time.now(),
    });
  } else {
    stateManager.set('players.local.id', null);
    console.log('[StateManager] Runtime player ID cleared:', {
      timestamp: Engine.time.now(),
    });
  }
}
