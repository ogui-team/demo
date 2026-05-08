/**
 * config.ts
 *
 * Game-project config for "My Looter Shooter".
 *
 * Pass this to `GameEngine.boot()` instead of touching any file inside
 * `client/src/engine/`.
 *
 * ─── Wire-up pattern ────────────────────────────────────────────────────────
 *
 *   // client/src/games/looter_shooter/bootstrap.ts  (create per game)
 *
 *   import { GameEngine }      from '../../engine/GameEngine';
 *   import { LOOTER_CONFIG }   from './config';
 *   import { LooterFreeplayMode } from './LooterGameMode';
 *   import { GameModeSystem }  from '../../engine/game/GameModeSystem';
 *   import { WeaponSystem }    from '../../engine/systems/WeaponSystem';
 *
 *   const canvas = document.getElementById('canvas') as HTMLCanvasElement;
 *
 *   // 1. Boot the engine — applies theme, GAS pack, default mode.
 *   const game = new GameEngine();
 *   game.boot(canvas, {
 *     ...LOOTER_CONFIG,
 *     onEngineReady(weaponSystem?: WeaponSystem, gameModes?: GameModeSystem) {
 *       // 2. Inject game-specific weapon defs.
 *       weaponSystem?.registerDefinitions(LOOTER_CONFIG.weapons ?? {});
 *
 *       // 3. Register game modes.
 *       gameModes?.registerMode(new LooterFreeplayMode());
 *       gameModes?.activate(LOOTER_CONFIG.defaultGameMode!);
 *     },
 *   });
 */

import type { ProjectConfig } from '../../1-kernel/core/ProjectConfig';
import { LooterFreeplayMode } from './LooterGameMode';

export const LOOTER_CONFIG: ProjectConfig = {
  // ── Identity ───────────────────────────────────────────────────────────────
  gameName: 'My Looter Shooter',
  version:  '0.1.0',

  // ── Server endpoints ───────────────────────────────────────────────────────
  serverUrl:     'ws://localhost:8080',
  serverHttpUrl: 'http://localhost:8080',

  // ── Mode defaults ──────────────────────────────────────────────────────────
  defaultMode:     'play',
  defaultGameMode: 'looter_freeplay',
  gameModes:       [new LooterFreeplayMode()],

  // ── HUD theme override ────────────────────────────────────────────────────
  uiTheme: {
    hpFull:      '#4caf50',   // green when healthy
    hpLow:       '#f44336',   // red when critical
    ammoActive:  '#ffb300',   // amber ammo counter
    accentColor: '#00bcd4',   // cyan action highlight
  },

  // ── Extra weapon definitions ───────────────────────────────────────────────
  // These are merged with WEAPON_PRESETS inside WeaponSystem via
  // weaponSystem.registerDefinitions() (called in onEngineReady).
  weapons: {
    plasma_rifle: {
      name:          'Plasma Rifle',
      type:          'hitscan',
      fireMode:      'hitscan',
      damage:        28,
      fireRate:      5,
      magazineSize:  25,
      reserveAmmoCap: 125,
      autoReload:    true,
      reloadTime:    1.8,
    },
  },

  // ── GAS data pack ──────────────────────────────────────────────────────────
  // Extra items/abilities/effects merged into DataRegistry at boot.
  gasDataPack: {
    items: [
      {
        id:        'rare_loot_crate',
        label:     'Rare Crate',
        category:  'Consumable',
        equipSlot: 'None',
        dropWeight: 2,
        minLevel:   5,
      },
      {
        id:        'energy_cell',
        label:     'Energy Cell',
        category:  'Ammo',
        equipSlot: 'None',
        dropWeight: 8,
        minLevel:   1,
      },
    ],
    effects: [
      {
        id:       'plasma_burn',
        label:    'Plasma Burn',
        duration: 3,
        tick:     0.5,
        modifiers: [
          { stat: 'health', value: -5, mode: 'flat' as const },
        ],
      },
    ],
  },

  // ── Engine ready callback ─────────────────────────────────────────────────
  onEngineReady() {
    console.log('[LooterGame] Engine ready — game is running.');
  },
};
