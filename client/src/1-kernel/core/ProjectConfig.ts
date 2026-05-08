/**
 * ProjectConfig.ts
 *
 * The single configuration payload that separates the Engine Core from any
 * specific Game Project.  Pass a `ProjectConfig` to `GameEngine.boot()` and
 * the engine will configure itself entirely from that object — no game logic
 * needs to live inside the engine folder.
 *
 * ─── Source-Engine analogy ───────────────────────────────────────────────────
 *
 *   ProjectConfig  ≈  gameinfo.txt  +  game/ mod folder
 *   Engine.ts      ≈  engine.dll    (never touch for game work)
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 *   // client/src/games/my_looter/config.ts
 *   import { LooterGameMode } from './LooterGameMode';
 *
 *   export const LOOTER_CONFIG: ProjectConfig = {
 *     gameName:        'My Looter Shooter',
 *     version:         '0.1.0',
 *     defaultMode:     'play',
 *     serverUrl:       'ws://localhost:8080',
 *     serverHttpUrl:   'http://localhost:8080',
 *     defaultGameMode: 'looter_freeplay',
 *     gameModes:       [new LooterGameMode()],
 *     weapons: {
 *       plasma_rifle: { name: 'Plasma Rifle', ... }
 *     },
 *   };
 *
 *   // client/src/games/my_looter/index.ts
 *   import * as Engine from '../../engine/Engine';
 *   import { LOOTER_CONFIG } from './config';
 *   import { GameEngine } from '../../engine/GameEngine';
 *
 *   const canvas = document.getElementById('canvas') as HTMLCanvasElement;
 *   const game = new GameEngine();
 *   game.boot(canvas, LOOTER_CONFIG);
 */

import type { GameMode } from '../../2-systems/gameplay/game/GameModeSystem';
import type { WeaponDefinition } from '../../2-systems/gameplay/systems/WeaponContracts';

// ── UI theme overrides ────────────────────────────────────────────────────────

/**
 * Partial override of `OGUITheme` colour tokens and typography.
 * Only the keys you provide will be applied; everything else stays at the
 * engine defaults defined in `OGUITheme.ts`.
 */
export interface UIThemeOverrides {
  /** Primary background colour for panels / widgets. */
  bgBase?:       string;
  /** Accent colour used for health bars, selection highlights, etc. */
  accentColor?:  string;
  /** CSS font-family stack (applied to HUD root element). */
  fontFamily?:   string;
  /** Scale factor for the entire HUD (1.0 = normal). */
  hudScale?:     number;
  /** Overrides the HP-full state colour (default: desaturated green). */
  hpFull?:       string;
  /** Overrides the HP-low state colour. */
  hpLow?:        string;
  /** Overrides the ammo active colour. */
  ammoActive?:   string;
}

// ── GAS data pack ─────────────────────────────────────────────────────────────

/**
 * Raw arrays fed into `DataRegistry.loadPack()` on boot.
 * Provides additional GAS ability, effect, and item templates for this game.
 * All are optional — only provide what your game adds.
 */
export interface GASDataPack {
  abilities?: unknown[];
  effects?:   unknown[];
  items?:     unknown[];
}

// ── ProjectConfig ─────────────────────────────────────────────────────────────

/**
 * Complete configuration contract for a game project.
 *
 * Every field except `gameName` and `version` is optional so you can start
 * minimal and add customisation incrementally.
 */
export interface ProjectConfig {
  // ── Identity ──────────────────────────────────────────────────────────────

  /** The human-readable title shown in the title bar / console. */
  gameName:  string;
  /** Semantic version string e.g. `'1.0.0-alpha'`. */
  version:   string;

  // ── Startup ───────────────────────────────────────────────────────────────

  /**
   * Initial engine mode.
   * - `'editor'` (default) — opens the editor gizmo / camera.
   * - `'play'`            — jumps straight into gameplay.
   */
  defaultMode?: 'editor' | 'play';

  // ── Network ───────────────────────────────────────────────────────────────

  /**
   * WebSocket server address.
   * If omitted the engine stays in offline / freeplay mode.
   */
  serverUrl?:     string;

  /**
   * HTTP base URL for REST endpoints (inventory give, lobby info, etc.).
   * Defaults to the same host as `serverUrl` on port 8080 when not set.
   */
  serverHttpUrl?: string;

  // ── Assets ────────────────────────────────────────────────────────────────

  /**
   * URL or relative path to a JSON asset manifest.
   * The engine will feed this to `MaterialManager`/`PrefabSystem` before
   * the first frame so assets are ready when play starts.
   */
  assetManifestUrl?: string;

  // ── UI / Theming ──────────────────────────────────────────────────────────

  /**
   * Optional colour / typography overrides applied to `OGUITheme` on boot.
   * Only the keys you supply are changed.
   */
  uiTheme?: UIThemeOverrides;

  // ── Weapons ───────────────────────────────────────────────────────────────

  /**
   * Extra weapon definitions merged into `WeaponSystem` on top of the built-in
   * `WEAPON_PRESETS`.  Keys that match existing presets **override** them; new
   * keys extend the roster.
   *
   * @example
   * weapons: {
   *   plasma_pistol: { name: 'Plasma Pistol', fireMode: 'hitscan', damage: 35, fireRate: 3, ... }
   * }
   */
  weapons?: Record<string, WeaponDefinition>;

  // ── GAS (Gameplay Ability System) ─────────────────────────────────────────

  /**
   * Additional GAS templates for this game.
   * Loaded via `DataRegistry.loadPack()` — does not replace built-in templates.
   *
   * @example
   * gasDataPack: {
   *   items: [{ id: 'rare_sword', label: 'Vorpal Blade', category: 'Weapon', ... }]
   * }
   */
  gasDataPack?: GASDataPack;

  // ── Game Modes ────────────────────────────────────────────────────────────

  /**
   * `GameMode` plugins to register with `GameModeSystem` on boot.
   * Create these by extending `BaseGameMode` in your game folder.
   *
   * @example
   * gameModes: [new LooterFreeplayMode(), new LooterRaidMode()]
   */
  gameModes?: GameMode[];

  /**
   * Name of the mode to activate automatically when a match starts.
   * Must match one of the `name` strings in `gameModes`.
   * If omitted the first registered mode is used, falling back to `'freeplay'`.
   */
  defaultGameMode?: string;

  // ── Lifecycle hooks ───────────────────────────────────────────────────────

  /**
   * Called immediately after `Engine.init()` completes but before any mode
   * listener fires.  Use for late registration (e.g. extra console commands,
   * debug overlays) that requires the engine to already be initialised.
   */
  onEngineReady?: () => void;
}
