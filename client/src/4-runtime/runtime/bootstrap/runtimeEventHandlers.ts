import type { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import type { GameModeManager } from '../../../2-systems/gameplay/game/GameModeManager';
import type { ReplaySystem } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { ClientWorldRuntimeCoordinator } from '../coordinators/ClientWorldRuntimeCoordinator';
import * as Engine from '../../../0-foundation/foundation/Engine';
import type { WeaponSystem } from '../../../2-systems/gameplay/systems/WeaponSystem';
import type { RuntimeOverlayCoordinator } from '../coordinators/RuntimeOverlayCoordinator';

function resolveEquippedCombatItemId(itemId: string | undefined): string | null {
  if (!itemId) return null;
  if (itemId === 'debug_fireball') return itemId;
  return itemId.startsWith('weapon_') ? itemId.replace(/^weapon_/, '') : null;
}

export interface BootstrapRuntimeEventHandlersOptions {
  worldRuntime: ClientWorldRuntimeCoordinator;
  weaponSystem: WeaponSystem;
  stateManager: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  };
  networkSyncSystem: unknown;
  mpClient: MultiplayerClient;
  gameModeManager: GameModeManager;
  replaySystem: ReplaySystem;
  debugManager: unknown;
  runtimeOverlayCoordinator: RuntimeOverlayCoordinator;
  gasBridge: {
    onPickup: (playerId: string, itemId: string, quantity: number) => void;
  };
}

/**
 * Bootstrap all runtime event listeners (gameBus, mpClient, gameModeManager)
 */
export function bootstrapRuntimeEventHandlers(options: BootstrapRuntimeEventHandlersOptions): void {
  const {
    worldRuntime,
    weaponSystem,
    stateManager,
    networkSyncSystem,
    mpClient,
    gameModeManager,
    replaySystem,
    debugManager,
    runtimeOverlayCoordinator,
    gasBridge,
  } = options;

  // ────────────────────────────────────────────────────────────────────
  // GAS/Inventory Event Listeners
  // ────────────────────────────────────────────────────────────────────

  gameBus.on('itemPicked', ({ itemId, quantity }) => {
    const playerId = worldRuntime.getActiveRuntimePlayerId() ?? worldRuntime.getLocalFreeplayPlayerId();
    if (!playerId) return;
    if (itemId === 'debug_fireball') {
      worldRuntime.grantFireball(playerId);
      gasBridge.onPickup(playerId, itemId, quantity);
      worldRuntime.syncHealthChannelsFromGAS(playerId);
      return;
    }
    gasBridge.onPickup(playerId, itemId, quantity);
    worldRuntime.syncHealthChannelsFromGAS(playerId);
  });

  // ────────────────────────────────────────────────────────────────────
  // Player Initialization Contract
  // ────────────────────────────────────────────────────────────────────
  // INVENTORY_READY fires after InventoryGridManager.init() fully resolves.
  // Bridge the equipped weapon and mark the 'inventory' phase on EntityManager
  // so NetworkSyncSystem can open its commandSink gate once all four phases
  // are confirmed (via the subsequent PLAYER_INIT_COMPLETE event).

  gameBus.on('INVENTORY_READY', ({ playerId, equippedWeapon, equippedArmor, items }) => {
    const equippedWeaponItem = typeof equippedWeapon === 'string'
      ? items.find((item: { instanceId?: string }) => item.instanceId === equippedWeapon)
      : null;
    const equippedWeaponId = resolveEquippedCombatItemId(
      typeof equippedWeaponItem?.itemId === 'string' ? equippedWeaponItem.itemId : undefined,
    );

    if (equippedWeaponId) {
      weaponSystem.equip(playerId, equippedWeaponId);
    }
    stateManager.set(`player.${playerId}.inventory`, { items, equippedWeapon, equippedArmor });
    Engine.getEntityManager()?.markPlayerPhaseReady(playerId, 'inventory');
  });

  // PLAYER_INIT_COMPLETE fires from EntityManager once all required phases
  // have been marked. Open the NetworkSyncSystem commandSink gate so input
  // commands can flow to the server.
  gameBus.on('PLAYER_INIT_COMPLETE', ({ playerId }) => {
    const activePlayerId = worldRuntime.getActiveRuntimePlayerId();
    if (playerId === activePlayerId) {
      (networkSyncSystem as any).setPlayerInitReady(true);
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Game Mode Events
  // ────────────────────────────────────────────────────────────────────

  gameBus.on('gameModeStarted', ({ modeName }) => {
    if (!mpClient.connected) return;
    mpClient.sendLobbyAction('GAME_MODE_SET', { mode: modeName });
  });

  // ────────────────────────────────────────────────────────────────────
  // Multiplayer Client Events
  // ────────────────────────────────────────────────────────────────────

  mpClient.on('authoritative_snapshot', (payload: any) => {
    replaySystem.recordEvent('authoritative_snapshot', { entityCount: payload.entities.length });
  });

  // ────────────────────────────────────────────────────────────────────
  // Game Mode Manager Events
  // ────────────────────────────────────────────────────────────────────

  gameModeManager.on('round_start', () => {
    (debugManager as any).refreshUI?.();
  });

  gameModeManager.on('score_update', () => {
    (debugManager as any).refreshUI?.();
  });

  // ────────────────────────────────────────────────────────────────────
  // Page Lifecycle
  // ────────────────────────────────────────────────────────────────────

  window.addEventListener('beforeunload', () => {
    gameModeManager.destroy();
    runtimeOverlayCoordinator.destroy();
  });
}

/**
 * Bootstrap debug test entities if enabled via URL query parameter
 */
export function bootstrapDebugTestEntitiesIfEnabled(): void {
  const enableBootstrapTestEntities = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('debugBootstrapPrimitives') === '1';

  if (!enableBootstrapTestEntities) {
    return;
  }

  void import('../../diagnostics/debug/bootstrapTestEntities')
    .then(({ bootstrapTestEntities }) => {
      bootstrapTestEntities();
    })
    .catch((error) => {
      console.warn('[App] Failed to bootstrap test entities', error);
    });
}
