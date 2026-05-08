/**
 * config.ts
 *
 * Project config for Horde Mode.
 *
 * Pass this to `GameEngine.boot()` to launch the game in horde mode instead
 * of the default engine config.
 *
 * ─── Wire-up pattern ────────────────────────────────────────────────────────
 *
 *   import { GameEngine }    from '../../engine/GameEngine';
 *   import { HORDE_CONFIG }  from './config';
 *
 *   const canvas = document.getElementById('canvas') as HTMLCanvasElement;
 *   const game = new GameEngine();
 *   game.boot(canvas, HORDE_CONFIG);
 */

import type { ProjectConfig } from '../../1-kernel/core/ProjectConfig';
import { HordeGameMode } from './HordeGameMode';

export const HORDE_CONFIG: ProjectConfig = {
  // ── Identity ───────────────────────────────────────────────────────────────
  gameName: 'Horde Mode',
  version:  '0.3.0',

  // ── Server endpoints ───────────────────────────────────────────────────────
  // Horde is offline-first; the server URL is kept for future co-op support.
  serverUrl:     'ws://localhost:8080',
  serverHttpUrl: 'http://localhost:8080',

  // ── Mode defaults ──────────────────────────────────────────────────────────
  defaultMode:     'play',
  defaultGameMode: 'horde',
  gameModes:       [new HordeGameMode()],

  // ── HUD theme — dark, tense, horror palette ───────────────────────────────
  uiTheme: {
    hpFull:      '#388e3c',   // muted green — you're barely alive
    hpLow:       '#b71c1c',   // deep red — critically low
    ammoActive:  '#e65100',   // orange ember — ammo is precious
    accentColor: '#4a148c',   // dark violet — eerie accent
  },

  // ── No extra weapon definitions needed ────────────────────────────────────
  // `debug_fireball` is a built-in engine item registered in DataRegistry.
  // Shotgun and pistol are WEAPON_PRESETS in WeaponSystem.
};
