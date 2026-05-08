/**
 * hydrateStateManager.ts
 *
 * Pre-emptive State Hydrator — schema-first boot initialization.
 *
 * DESIGN PRINCIPLES:
 *  1. Schema-First   : INITIAL_STATE_SCHEMA is the single source of truth for
 *                      every state path the engine will ever read or write.
 *  2. Zero Crash     : No consumer may receive `undefined` for a known path;
 *                      unknown paths return their schema default.
 *  3. Boot-Lock      : StateManager.isHydrated must be true before
 *                      LifecycleOrchestrator can advance to PLAY_ACTIVE.
 *  4. No Magic Strings: Boot flow code must reference SCHEMA_PATHS constants
 *                      rather than inlining raw dot-notation strings.
 */

import { gameBus } from '@engine/1-kernel/core/public-api';
import { normalizeAvatarAppearance } from '../../../2-systems/gameplay/game/AvatarBuilder';
import {
  cloneTropicalHorrorArchetypeAppearance,
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
} from '../../../2-systems/ArchetypeDefinitions';
import type { StateManager } from './StateManager';

// ─────────────────────────────────────────────────────────────────────────────
// 1. INITIAL STATE SCHEMA
//    Each leaf value is the authoritative default for that path.
//    Non-leaf objects are also reachable as defaults for subtree reads.
// ─────────────────────────────────────────────────────────────────────────────

export type InitialStateSchema = typeof INITIAL_STATE_SCHEMA;

export const INITIAL_STATE_SCHEMA = {
  mode: 'editor' as string,

  camera: {
    position: { x: 0, y: 5, z: 10 },
    rotation: { x: -0.4636476090008061, y: 0, z: 0 },
    fov: 75,
  },

  fog: {
    density: 0.02,
    color: 0x334444,
    enabled: true,
  },

  lighting: {
    ambientIntensity: 0.4,
    directionalIntensity: 0.8,
  },

  atmosphericEffects: {
    fogPulsing: true,
    lightingFlicker: true,
    postProcessing: true,
    cameraEffects: true,
  },

  debug: {
    enabled: false,
    visible: false,
  },

  lobby: {
    status: 'idle' as string,
    servers: [] as unknown[],
    localPlayer: {
      archetype: DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID as string,
      appearance: null as Record<string, unknown> | null,
    },
  },

  /** Static per-player namespaced appearance/inventory slots.
   *  Dynamic player IDs are merged at hydration time. */
  player: {
    local: {
      archetype: DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID as string,
      appearance: null as Record<string, unknown> | null,
      inventory: null as Record<string, unknown> | null,
    },
  },

  /** Flat players map — local mirror + sparse remote slots. */
  players: {
    local: {
      id: null as string | null,
      name: '' as string,
      archetype: DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID as string,
      health: 100,
      maxHealth: 100,
      armor: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      isAlive: true,
      weapons: [] as string[],
      currentWeapon: null as string | null,
    },
  },

  /** Per-player health records (keyed by playerId at runtime). */
  health: {
    player: {
      hp: 100,
      maxHp: 100,
      shield: 0,
      maxShield: 0,
      armor: 0,
      isAlive: true,
    },
  } as Record<string, {
    hp: number;
    maxHp: number;
    shield: number;
    maxShield: number;
    armor: number;
    isAlive: boolean;
  }>,

  /** Per-player weapon records (keyed by playerId at runtime). */
  weapons: {
    player: {
      equipped: null,
      inventory: [],
      currentAmmo: 0,
      reserveAmmo: 0,
      isReloading: false,
    },
  } as Record<string, unknown>,

  hud: {
    visible: false,
    healthBarVisible: true,
    ammoCounterVisible: true,
    radarVisible: false,
    notifications: [] as unknown[],
  },

  ui: {
    hud: {
      visible: false,
      mode: 'hidden' as string,
    },
    inventory: { open: false },
    menu: { open: false },
    settings: { open: false },
    modal: null as unknown,
  },

  game: {
    mode: 'none' as string,
    isPaused: false,
    difficulty: 'normal' as string,
    level: null as string | null,
    seed: 0,
    players: {} as Record<string, unknown>,
    round: null as unknown,
    localScores: {} as Record<string, number>,
    modeRuntime: {
      lastEvent: null as unknown,
    },
  },

  multiplayer: {
    isConnected: false,
    playerId: null as string | null,
    playerCount: 0,
    remoteEntities: {} as Record<string, unknown>,
  },

  entities: {
    local: null as unknown,
    remote: {} as Record<string, unknown>,
    count: 0,
  },

  prefabInstances: {} as Record<string, unknown>,
  prefabRegistry: {} as Record<string, unknown>,
  prefabRegistryValidation: {} as Record<string, unknown>,
  prefabs: {} as Record<string, unknown>,
  objects: {} as Record<string, unknown>,

  physics: {
    gravity: -9.81,
    isSimulating: false,
  },

  rendering: {
    fogDensity: 0.02,
    fogColor: 0x334444,
    ambientLight: 0.4,
    directionalLight: 0.8,
  },

  diagnostics: {
    ammo: {
      current: 0,
      itemId: 0,
    },
    weapons: {
      equipped: null as string | null,
      available: [] as string[],
    },
    health: {
      current: 100,
      max: 100,
    },
    characters: {} as Record<string, unknown>,
    adaptiveRuntime: {} as Record<string, unknown>,
    network: {
      serverStatus: null as unknown,
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. SCHEMA PATH CONSTANTS
//    Boot-flow code must use these instead of raw strings.
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEMA_PATHS = {
  MODE: 'mode',
  ENGINE_APP_STATE: 'engine.appState',
  GAMEPLAY_ACTIVE: 'gameplay.active',
  CAMERA_FOV: 'camera.fov',
  CAMERA_POSITION: 'camera.position',
  CAMERA_ROTATION: 'camera.rotation',
  FOG_DENSITY: 'fog.density',
  FOG_COLOR: 'fog.color',
  FOG_ENABLED: 'fog.enabled',
  LOBBY_STATUS: 'lobby.status',
  LOBBY_LOCAL_PLAYER_ARCHETYPE: 'lobby.localPlayer.archetype',
  LOBBY_LOCAL_PLAYER_APPEARANCE: 'lobby.localPlayer.appearance',
  PLAYER_LOCAL_ARCHETYPE: 'player.local.archetype',
  PLAYER_LOCAL_APPEARANCE: 'player.local.appearance',
  PLAYER_LOCAL_INVENTORY: 'player.local.inventory',
  PLAYERS_LOCAL_ID: 'players.local.id',
  PLAYERS_LOCAL_NAME: 'players.local.name',
  PLAYERS_LOCAL_ARCHETYPE: 'players.local.archetype',
  PLAYERS_LOCAL_HEALTH: 'players.local.health',
  PLAYERS_LOCAL_MAX_HEALTH: 'players.local.maxHealth',
  PLAYERS_LOCAL_IS_ALIVE: 'players.local.isAlive',
  PLAYERS_LOCAL_CURRENT_WEAPON: 'players.local.currentWeapon',
  HUD_VISIBLE: 'hud.visible',
  UI_HUD_MODE: 'ui.hud.mode',
  GAME_MODE: 'game.mode',
  GAME_IS_PAUSED: 'game.isPaused',
  MULTIPLAYER_IS_CONNECTED: 'multiplayer.isConnected',
  MULTIPLAYER_PLAYER_ID: 'multiplayer.playerId',
  DIAGNOSTICS_AMMO_CURRENT: 'diagnostics.ammo.current',
  DIAGNOSTICS_AMMO_ITEM_ID: 'diagnostics.ammo.itemId',
  DEBUG_ENABLED: 'debug.enabled',
  DEBUG_VISIBLE: 'debug.visible',
  /** Dynamic helpers — call as functions */
  playerAppearance: (id: string) => `player.${id}.appearance` as const,
  playerInventory: (id: string) => `player.${id}.inventory` as const,
  playerInventoryKernel: (id: string) => `player.${id}.inventoryKernel` as const,
  healthRecord: (id: string) => `health.${id}` as const,
  healthHp: (id: string) => `health.${id}.hp` as const,
  healthMaxHp: (id: string) => `health.${id}.maxHp` as const,
  healthIsAlive: (id: string) => `health.${id}.isAlive` as const,
  playersRecord: (id: string) => `players.${id}` as const,
  playersEntityId: (id: string) => `players.${id}.entityId` as const,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 3. SCHEMA DEFAULT CACHE
//    A flat lookup built at module load time.
//    Used by StateManager.get() for safe fallback — no fatal crashes.
// ─────────────────────────────────────────────────────────────────────────────

const _schemaDefaultCache: Map<string, unknown> = new Map();

function _buildCache(obj: unknown, prefix: string): void {
  if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) {
    _schemaDefaultCache.set(prefix, obj);
    return;
  }
  // Store the branch node itself (so subtree gets work too)
  if (prefix) {
    _schemaDefaultCache.set(prefix, obj);
  }
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    _buildCache((obj as Record<string, unknown>)[key], fullPath);
  }
}

_buildCache(INITIAL_STATE_SCHEMA, '');

/**
 * Looks up the schema default for `path`.
 * Returns `{ found: true, value }` when the path is in the schema tree,
 * or `{ found: false, value: undefined }` for fully unknown paths.
 */
export function getSchemaDefault(path: string): { found: boolean; value: unknown } {
  if (_schemaDefaultCache.has(path)) {
    return { found: true, value: _schemaDefaultCache.get(path) };
  }
  return { found: false, value: undefined };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. HYDRATION FUNCTION
//    Call once, immediately after Engine.init() returns the stateManager.
//    Sets every path defined by INITIAL_STATE_SCHEMA that is not already set,
//    then marks stateManager.isHydrated = true.
// ─────────────────────────────────────────────────────────────────────────────

function _collectLeafPaths(obj: unknown, prefix: string, out: Array<[string, unknown]>): void {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    out.push([prefix, obj]);
    return;
  }
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    _collectLeafPaths((obj as Record<string, unknown>)[key], fullPath, out);
  }
}

/**
 * Pre-fill the StateManager with every path defined in INITIAL_STATE_SCHEMA.
 * Paths already present in the state (set by Engine.init) are NOT overwritten —
 * the schema acts as a "fill-if-missing" default layer.
 *
 * After this call, `stateManager.isHydrated` becomes `true` and the
 * `STATE_HYDRATION_COMPLETE` event fires on the gameBus.
 */
export function hydrateStateManager(stateManager: StateManager): void {
  if (stateManager.isHydrated) {
    console.warn('[StateHydrator] hydrateStateManager() called more than once — skipped.');
    return;
  }

  // ─ REENTRANCY GUARD: Signal that we're in hydration mode
  // This prevents set() from firing events during the fill pass
  stateManager.beginHydration();

  // Inject dynamic default: lobby.localPlayer.appearance needs to be the
  // normalised appearance object, which is runtime-computed.
  const defaultArchetypeAppearance = cloneTropicalHorrorArchetypeAppearance(DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID);
  const runtimeSchema: Record<string, unknown> = {
    ...(INITIAL_STATE_SCHEMA as Record<string, unknown>),
    lobby: {
      ...(INITIAL_STATE_SCHEMA.lobby as Record<string, unknown>),
      localPlayer: {
        archetype: DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
        appearance: defaultArchetypeAppearance,
      },
    },
    player: {
      ...(INITIAL_STATE_SCHEMA.player as Record<string, unknown>),
      local: {
        archetype: DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
        appearance: cloneTropicalHorrorArchetypeAppearance(DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID),
        inventory: null,
      },
    },
    players: {
      ...(INITIAL_STATE_SCHEMA.players as Record<string, unknown>),
      local: {
        ...((INITIAL_STATE_SCHEMA.players as Record<string, unknown>).local as Record<string, unknown>),
        archetype: DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
      },
    },
  };

  const leaves: Array<[string, unknown]> = [];
  _collectLeafPaths(runtimeSchema, '', leaves);

  let filledCount = 0;

  for (const [path, defaultValue] of leaves) {
    const existing = stateManager.getRaw(path);
    if (existing === undefined) {
      stateManager.set(path, defaultValue as any);
      filledCount++;
    }
  }

  // ─ HYDRATION COMPLETE: Re-enable event firing
  stateManager.endHydration();
  stateManager.markHydrated();

  if ((globalThis as any).DEBUG_STATE) {
    console.log(
      `[StateHydrator] Hydration complete — ${filledCount} paths pre-filled, schema has ${leaves.length} leaves.`
    );
  }

  gameBus.emit('STATE_HYDRATION_COMPLETE', {
    source: 'hydrateStateManager',
    pathCount: leaves.length,
    filledCount,
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. STATE HYDRATION GUARD
//    Wraps state reads for UI components.
//    Returns LOADING_SENTINEL when state is not yet hydrated or path is missing.
//    Consumers test: `value === STATE_LOADING` before rendering.
// ─────────────────────────────────────────────────────────────────────────────

export const STATE_LOADING = Symbol('STATE_LOADING');
export type StateLoadingSentinel = typeof STATE_LOADING;

export class StateHydrationGuard {
  constructor(private readonly stateManager: StateManager) {}

  /**
   * Read `path` from state.
   * – If the StateManager is not yet hydrated, returns `STATE_LOADING` and
   *   emits `UI_LOADING_STATE` so the caller can show a loading indicator.
   * – If the path exists, returns the value normally.
   * – If the path is missing post-hydration (dynamic player ID etc.),
   *   returns the schema default and emits `LOG_STATE_MISSING_WARNING`.
   */
  read<T = unknown>(path: string): T | StateLoadingSentinel {
    if (!this.stateManager.isHydrated) {
      gameBus.emit('UI_LOADING_STATE', {
        reason: 'STATE_NOT_HYDRATED',
        path,
        timestamp: Date.now(),
      });
      return STATE_LOADING;
    }

    const value = this.stateManager.getRaw(path);
    if (value !== undefined) {
      return value as T;
    }

    // Schema fallback for dynamic paths (e.g. player.{id}.appearance)
    const { found, value: schemaValue } = getSchemaDefault(path);
    if (found) {
      return schemaValue as T;
    }

    gameBus.emit('UI_LOADING_STATE', {
      reason: 'STATE_PATH_NOT_IN_SCHEMA',
      path,
      timestamp: Date.now(),
    });
    return STATE_LOADING;
  }

  /** Convenience: return `true` when the guard is in loading state for `path`. */
  isLoading(path: string): boolean {
    return this.read(path) === STATE_LOADING;
  }
}
