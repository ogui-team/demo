/**
 * GameEngine.ts
 *
 * Top-level bootstrapper for game projects.
 *
 * Accepts a `ProjectConfig` payload and applies it to the engine subsystems
 * so that every game project can boot the same engine core with different
 * data, modes, and settings — without touching any file inside `engine/`.
 *
 * ─── Source-Engine analogy ───────────────────────────────────────────────────
 *
 *   GameEngine.boot()  ≈  running  engine.exe +gameinfo.txt
 *   Engine.ts          ≈  engine.dll            (leave unchanged)
 *   ProjectConfig      ≈  gameinfo.txt + mod/   (one per game)
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 *   // client/src/games/my_game/bootstrap.ts
 *   import { GameEngine } from '../../engine/GameEngine';
 *   import { MY_GAME_CONFIG } from './config';
 *
 *   const canvas = document.getElementById('canvas') as HTMLCanvasElement;
 *   const game = new GameEngine();
 *   game.boot(canvas, MY_GAME_CONFIG);
 */

import * as Engine from '../../0-foundation/foundation/Engine';
import type { ProjectConfig } from '@engine/1-kernel/core/public-api';

export class GameEngine {
  private booted = false;

  /**
   * Initialise the engine and apply `config`.
   *
   * Preserves every existing rendering loop and system initialisation inside
   * `Engine.init()`.  Config is applied **after** the engine is ready so no
   * system ordering has to change.
   *
   * Steps
   * ─────
   *   1. Call `Engine.init(canvas)` — sets up renderer, camera, game loop.
   *   2. Apply `config.defaultMode` via `Engine.setEngineMode()`.
   *   3. Register `config.gameModes` into the existing `GameModeSystem` (if
   *      the app layer has wired one in via `EngineController`).
   *   4. Inject `config.weapons` into `WeaponSystem` (if one is registered).
   *   5. Hot-patch `config.gasDataPack` into `DataRegistry`.
   *   6. Apply `config.uiTheme` to the HUD root element as CSS variables.
   *   7. Invoke `config.onEngineReady()` callback.
   *   8. Start the game loop.
   *
   * @param canvas  The `<canvas>` element to render into.
   * @param config  Game-project configuration.
   */
  boot(canvas: HTMLCanvasElement, config: ProjectConfig): void {
    if (this.booted) {
      console.warn('[GameEngine] boot() called more than once — ignoring.');
      return;
    }
    this.booted = true;

    console.log(`[GameEngine] Booting "${config.gameName}" v${config.version}`);
    document.title = config.gameName;

    // ── 1. Core engine init ────────────────────────────────────────────────
    Engine.init(canvas);

    // ── 2. Default mode ────────────────────────────────────────────────────
    if (config.defaultMode && config.defaultMode !== 'editor') {
      // 'editor' is the default — only switch if the game wants play mode.
      void Engine.setEngineMode(config.defaultMode);
    }

    // ── 3. Game modes ──────────────────────────────────────────────────────
    // GameModeSystem is owned by the app layer (index.ts / bootstrap.ts) and
    // registered into EngineController.  We can't reach it from here directly,
    // so we expose it via the onEngineReady callback where the caller has a
    // reference to their GameModeSystem instance.
    // -- The recommended pattern is shown in the LooterGame example below. --

    // ── 4. Weapon definitions ──────────────────────────────────────────────
    // WeaponSystem is also app-layer-owned. Same pattern: use onEngineReady.

    // ── 5. GAS data pack ───────────────────────────────────────────────────
    if (config.gasDataPack) {
      const dataRegistry = Engine.getGasDataRegistry();
      if (dataRegistry) {
        dataRegistry.loadPack(config.gasDataPack as Parameters<typeof dataRegistry.loadPack>[0]);
        console.log('[GameEngine] GAS data pack loaded.');
      }
    }

    // ── 6. UI theme (CSS custom properties on <html>) ──────────────────────
    if (config.uiTheme) {
      this._applyTheme(config.uiTheme);
    }

    // ── 7. Ready callback ──────────────────────────────────────────────────
    config.onEngineReady?.();

    // ── 8. Start the game loop ─────────────────────────────────────────────
    Engine.start();

    console.log(`[GameEngine] "${config.gameName}" is running.`);
  }

  // ── Theme application ──────────────────────────────────────────────────────

  private _applyTheme(theme: ProjectConfig['uiTheme']): void {
    if (!theme) return;
    const root = document.documentElement;

    if (theme.bgBase)      root.style.setProperty('--ogui-bg-base',      theme.bgBase);
    if (theme.accentColor) root.style.setProperty('--ogui-accent',       theme.accentColor);
    if (theme.fontFamily)  root.style.setProperty('--ogui-font-family',  theme.fontFamily);
    if (theme.hudScale)    root.style.setProperty('--ogui-hud-scale',    String(theme.hudScale));
    if (theme.hpFull)      root.style.setProperty('--ogui-hp-full',      theme.hpFull);
    if (theme.hpLow)       root.style.setProperty('--ogui-hp-low',       theme.hpLow);
    if (theme.ammoActive)  root.style.setProperty('--ogui-ammo-active',  theme.ammoActive);
  }
}

