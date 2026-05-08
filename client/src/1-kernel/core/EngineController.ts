/**
 * EngineController
 *
 * Deterministic runtime orchestration for the PS1 engine.
 * Single source of truth for what state the application is in
 * and which systems are active at any given time.
 *
 * ─── State Machine ───────────────────────────────────────────────
 *
 *  boot ──► menu ──► lobby ──► starting ──► in_game ──► post_game
 *            ▲                                │              │
 *            └──────────────────────────────── ┘              │
 *            ◄─────────────────────────────────── lobby ◄────┘
 *
 *  Additional exit paths to 'menu': in_game, post_game (quit/forfeit).
 *  'menu → in_game': singleplayer / freeplay shortcut (existing feature).
 *
 * ─── Responsibilities ───────────────────────────────────────────
 *  - Guard all state transitions (invalid transitions are rejected)
 *  - Activate / deactivate registered systems on state entry / exit
 *  - Route per-frame update(dt) calls to only the systems that
 *    are relevant for the current state
 *  - Fire lifecycle hooks (onMatchStart, onMatchEnd) for app-layer code
 *
 * ─── Design principle ───────────────────────────────────────────
 *  All concrete types are avoided here. ControllerSystems uses only
 *  minimal structural (duck-typed) interfaces to prevent circular imports.
 *  Systems are registered externally (Engine.ts for core, index.ts for app).
 */

// ─── App state ───────────────────────────────────────────────────────────────

import { setInputContext, disableSystem, markSystemError, markSystemUpdated, registerSystem, logEvent, gameBus } from './ControlRuntime';
import { runtimeFrameCostProfiler } from '../../4-runtime/diagnostics/debug/FrameCostProfiler';
import { getRuntimePerformanceMode, RuntimePerformanceMode } from './RuntimePerformanceMode';
import type { SystemCapabilities, SystemContext } from './types';
import { getCameraAuthority, setCameraAuthority as applyCameraAuthority, type CameraAuthority } from '../../2-systems/camera/CameraStateAdapter';
import type { PlayerHUDMode } from '../../2-systems/gameplay/systems/HUDSystem';
import * as Engine from '../../0-foundation/foundation/Engine';

export type AppState =
  | 'boot'       // Engine initialising — nothing is active
  | 'menu'       // Main menu visible; engine in editor mode
  | 'lobby'      // Browsing / waiting in a multiplayer lobby
  | 'starting'   // Countdown in progress before a match
  | 'in_game'    // Match running
  | 'post_game'; // Match ended; results visible

export type SessionAuthorityIntent =
  | 'restore-local-gameplay'
  | 'disconnect-cleanup'
  | 'round-ended';

// ─── Allowed transitions ─────────────────────────────────────────────────────

/**
 * Only the transitions listed here are permitted.
 * Any attempt to transition outside this table is silently rejected
 * and returns false.
 */
const TRANSITIONS: Readonly<Record<AppState, ReadonlyArray<AppState>>> = {
  boot:      ['menu'],
  menu:      ['lobby', 'in_game'],     // in_game: freeplay / singleplayer bypass
  lobby:     ['starting', 'menu'],     // menu: disconnect / back button
  starting:  ['in_game', 'lobby'],     // lobby: countdown aborted
  in_game:   ['post_game', 'menu', 'lobby'],
  post_game: ['lobby', 'menu', 'in_game'],
};

// ─── System registry ─────────────────────────────────────────────────────────

/**
 * Structural (duck-typed) interfaces for each registerable system.
 * No concrete imports — callers hold the real instances.
 */

interface IUpdatable  { update(dt: number): void; }
interface IToggleable { enable(): void; disable(): void; }
interface IVisible    { show(): void; hide(): void; }
interface IModeManager {
  syncFromController(m: 'editor' | 'play', options?: { cameraAuthority?: 'menu' | 'game' | 'editor' }): void | Promise<void>;
  isEditorMode(): boolean;
  isPlayMode(): boolean;
}
interface IGameplayRuntime extends IUpdatable, IToggleable {}
interface IGameModeSystem extends IUpdatable {
  syncFromController(modeName: string | null): void;
  getActiveName(): string | null;
  getMode(modeName: string): unknown;
}

export interface ControllerSystems {
  // ── Core systems (registered from Engine.ts) ─────────────────────────────
  entityManager?:     IUpdatable;
  networkManager?:    IUpdatable;
  renderingPipeline?: IUpdatable;
  modeManager?:       IModeManager;
  editorController?:  IUpdatable & IToggleable;
  playController?:    IUpdatable & IToggleable;
  selectionSystem?:   IToggleable;
  gizmoSystem?:       IToggleable;
  editorToolCoordinator?: unknown;
  componentInspector?: unknown;

  // ── App-layer systems (registered from index.ts) ─────────────────────────
  mainMenu?:          IVisible;
  scoreboard?:        IVisible;
  combatSystem?:      IUpdatable & IToggleable;
  gameplayRuntime?:   IGameplayRuntime;
  gameModeSystem?:    IGameModeSystem;
  auxiliarySystems?:  Record<string, IUpdatable>;
}

// ─── EngineController ─────────────────────────────────────────────────────────

export class EngineController {
  private _state: AppState = 'boot';
  private _runtimeMode: 'editor' | 'play' = 'editor';
  private _gameMode: string | null = null;
  private _systems: ControllerSystems = {};
  private _systemContext: SystemContext | null = null;
  private _cachedAuxEntries: Array<[string, IUpdatable]> = [];
  private _cameraAuthorityStack: CameraAuthority[] = [];

  /** Called when the engine enters in_game — use for map load / entity clear. */
  private _onMatchStart: (() => void) | null = null;
  /** Called when the engine enters post_game — use for freezing gameplay. */
  private _onMatchEnd:   (() => void) | null = null;

  // ─── System registration ──────────────────────────────────────────────────

  /**
   * Register one or more systems.
   * Safe to call multiple times — later registrations overwrite earlier ones
   * for the same key.
   */
  registerSystems(systems: Partial<ControllerSystems>): void {
    const next = { ...systems };
    if (systems.auxiliarySystems) {
      this._systems.auxiliarySystems = {
        ...(this._systems.auxiliarySystems ?? {}),
        ...systems.auxiliarySystems,
      };
      delete next.auxiliarySystems;
    }

    Object.assign(this._systems, next);

    // Rebuild cached auxiliary entries so the per-frame loop avoids Object.entries()
    this._cachedAuxEntries = Object.entries(this._systems.auxiliarySystems ?? {}) as Array<[string, IUpdatable]>;

    for (const [name, system] of Object.entries(systems)) {
      if (!system || name === 'auxiliarySystems') continue;
      registerSystem(name, system);
    }

    for (const [name, system] of Object.entries(systems.auxiliarySystems ?? {})) {
      registerSystem(name, system);
    }
  }

  /** Register a callback invoked when `in_game` is entered. */
  onMatchStart(cb: () => void): void { this._onMatchStart = cb; }

  /** Register a callback invoked when `post_game` is entered. */
  onMatchEnd(cb: () => void): void { this._onMatchEnd = cb; }

  init(ctx: SystemContext): void {
    this._systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this._systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        state: this._state,
        runtimeMode: this._runtimeMode,
        gameMode: this._gameMode,
        hasSystemContext: this._systemContext !== null,
        registeredSystems: Object.keys(this._systems).length + Object.keys(this._systems.auxiliarySystems ?? {}).length,
        auxiliarySystems: Object.keys(this._systems.auxiliarySystems ?? {}).length,
      },
    };
  }

  // ─── State accessors ──────────────────────────────────────────────────────

  /** Current AppState. Read-only from the outside. */
  get state(): AppState { return this._state; }

  getRuntimeMode(): 'editor' | 'play' {
    return this._runtimeMode;
  }

  getGameMode(): string | null {
    return this._gameMode;
  }

  /** Convenience predicate. */
  is(s: AppState): boolean { return this._state === s; }

  getCameraAuthority(): CameraAuthority {
    return getCameraAuthority();
  }

  setCameraAuthority(authority: CameraAuthority): void {
    const currentAuthority = getCameraAuthority();
    if (authority === 'snapshot' && currentAuthority !== 'snapshot') {
      this._cameraAuthorityStack.push(currentAuthority);
    }
    applyCameraAuthority(authority);
  }

  restorePreviousCameraAuthority(): void {
    const previousAuthority = this._cameraAuthorityStack.pop();
    if (!previousAuthority) return;
    applyCameraAuthority(previousAuthority);
  }

  canWriteCamera(source: CameraAuthority): boolean {
    return getCameraAuthority() === source;
  }

  requestSessionAuthorityIntent(intent: SessionAuthorityIntent, reason = 'session'): void {
    switch (intent) {
      case 'restore-local-gameplay':
        this.setRuntimeMode('play', `${reason}:restore-local-gameplay`);
        this.setHudMode('play', `${reason}:restore-local-gameplay`);
        this.setHudVisible(true, `${reason}:restore-local-gameplay`);
        Engine.ensureGameplayUiActive();
        return;
      case 'disconnect-cleanup':
        this.setHudMode('hidden', `${reason}:disconnect-cleanup`);
        this.setHudVisible(false, `${reason}:disconnect-cleanup`);
        this.setRuntimeMode('editor', `${reason}:disconnect-cleanup`);
        return;
      case 'round-ended':
        this.setRuntimeMode('play', `${reason}:round-ended`);
        this.setHudMode('play', `${reason}:round-ended`);
        this.setHudVisible(true, `${reason}:round-ended`);
        Engine.ensureGameplayUiActive();
        return;
    }
  }

  setRuntimeMode(next: 'editor' | 'play', reason = 'external'): boolean {
    const previous = this._runtimeMode;
    if (previous === next) {
      this.syncRuntimeMode(reason);
      return false;
    }
    this._runtimeMode = next;
    this.writeStateValue('mode', next);
    console.log(`[Mode] resolved: ${previous} -> ${next} (${reason})`);
    this.syncRuntimeMode(reason);
    return true;
  }

  setGameMode(next: string | null, reason = 'external'): boolean {
    const normalized = typeof next === 'string' && next.trim().length > 0 ? next.trim() : null;
    if (normalized && this._systems.gameModeSystem && !this._systems.gameModeSystem.getMode(normalized)) {
      throw new Error(`[EngineController] Unknown game mode "${normalized}"`);
    }
    if (this._gameMode === normalized) {
      this.syncGameMode(reason);
      return false;
    }
    const previous = this._gameMode;
    this._gameMode = normalized;
    this.writeStateValue('game.mode', normalized);
    console.log(`[Mode] game mode: ${previous ?? 'none'} -> ${normalized ?? 'none'} (${reason})`);
    this.syncGameMode(reason);
    return true;
  }

  setHudMode(mode: PlayerHUDMode, reason = 'external'): void {
    this.writeStateValue('ui.hud.mode', mode);
    console.log(`[HUD] mode: ${mode} (${reason})`);
  }

  setHudVisible(visible: boolean, reason = 'external'): void {
    this.writeStateValue('hud.visible', visible);
    console.log(`[HUD] visible: ${visible ? 'shown' : 'hidden'} (${reason})`);
  }

  // ─── State transitions ────────────────────────────────────────────────────

  /**
   * Request a state transition.
   *
   * Returns `true` if the transition was applied; `false` if it was blocked
   * because it is not in the allowed-transitions table for the current state.
   */
  transition(next: AppState): boolean {
    if (next === this._state) {
      return false;
    }

    const allowed = TRANSITIONS[this._state] as ReadonlyArray<string>;
    if (!allowed.includes(next)) {
      console.warn(`[EngineController] Blocked: ${this._state} → ${next}`);
      return false;
    }

    const prev = this._state;
    this._onExit(prev);
    this._state = next;
    this.writeStateValue('engine.appState', next);
    this._onEnter(next);
    this.syncGameMode(`app-state:${next}`);
    gameBus.emit('stateMutation', {
      source: 'engineController',
      path: 'engine.appState',
      changedCount: 1,
    });
    console.log(`[AppState] transition: ${prev} -> ${next}`);
    logEvent('engine', `App state ${prev} → ${next}`);
    return true;
  }

  setAppState(next: AppState): boolean {
    return this.transition(next);
  }

  // ─── Per-frame update ─────────────────────────────────────────────────────

  /**
   * Single entry point for all per-frame system updates.
   *
   * Called once per frame from the game loop via Engine.ts.
   * No system should tick itself independently of this method.
   */
  update(dt: number): void {
    const s = this._systems;

    // ── Always active systems ──────────────────────────────────────
    // These are fundamental; they run in every state.
    this._safeUpdate('entityManager', s.entityManager, dt);
    this._safeUpdate('renderingPipeline', s.renderingPipeline, dt);

    // ── State-dependent updates ────────────────────────────────────
    switch (this._state) {
      case 'boot':
        // Nothing additional — engine is still initialising.
        break;

      case 'menu':
        // Editor is active while browsing the main menu.
        if (this._runtimeMode === 'editor') {
          this._safeUpdate('editorController', s.editorController, dt);
        }
        break;

      case 'lobby':
      case 'starting':
        // Network is live (server browser / lobby). Editor still usable.
        this._safeUpdate('networkManager', s.networkManager, dt);
        if (this._runtimeMode === 'editor') {
          this._safeUpdate('editorController', s.editorController, dt);
        }
        break;

      case 'in_game':
        this._safeUpdate('networkManager', s.networkManager, dt);
        this._safeUpdate('gameModeSystem', s.gameModeSystem, dt);
        this._safeUpdate('combatSystem', s.combatSystem, dt);
        if (this._runtimeMode === 'play') {
          this._safeUpdate('playController', s.playController, dt);
        }
        // Allow editor mode while in-game (freeplay / in-game editing).
        if (this._runtimeMode === 'editor') {
          this._safeUpdate('editorController', s.editorController, dt);
        }
        this._safeUpdate('gameplayRuntime', s.gameplayRuntime, dt);
        break;

      case 'post_game':
        // Gameplay is frozen. Network stays live for final score sync.
        this._safeUpdate('networkManager', s.networkManager, dt);
        break;
    }

    const aux = this._cachedAuxEntries;
    for (let i = 0, len = aux.length; i < len; i++) {
      this._safeUpdate(aux[i][0], aux[i][1], dt);
    }
  }

  // ─── State entry / exit ──────────────────────────────────────────────────

  private _onEnter(state: AppState): void {
    const s = this._systems;

    switch (state) {
      case 'boot':
        // Nothing to activate — waiting for explicit transition to 'menu'.
        break;

      case 'menu':
        // Editor mode: full editor controls, main menu overlay on top.
        this.setRuntimeMode('editor', 'app-state:menu');
        s.mainMenu?.show();
        s.scoreboard?.hide();
        break;

      case 'lobby':
        // Stay in editor mode so the world is visible behind the lobby UI.
        // MainMenu is hidden; ServerBrowser / LobbyUI manage their own overlay.
        this.setRuntimeMode('editor', 'app-state:lobby');
        s.mainMenu?.hide();
        s.scoreboard?.hide();
        break;

      case 'starting':
        // Countdown started server-side. No engine-mode change needed;
        // the lobby UI renders the countdown. Stay in editor mode.
        this.setRuntimeMode('editor', 'app-state:starting');
        s.mainMenu?.hide();
        s.scoreboard?.hide();
        break;

      case 'in_game': {
        // Switch to play mode — modeManager listeners will enable playController
        // and disable editorController / selectionSystem automatically.
        this.setRuntimeMode('play', 'app-state:in_game');
        // Scoreboard stays hidden until explicit TAB input.
        s.scoreboard?.hide();
        // Fire match-start hook (entity clear, map load, player reset).
        this._onMatchStart?.();
        break;
      }

      case 'post_game':
        this.setRuntimeMode('editor', 'app-state:post_game');
        s.scoreboard?.show();
        this._onMatchEnd?.();
        break;
    }
  }

  private _onExit(state: AppState): void {
    const s = this._systems;

    switch (state) {
      case 'menu':
        s.mainMenu?.hide();
        break;

      case 'in_game':
        s.scoreboard?.hide();
        break;

      default:
        break;
    }
  }

  private _safeUpdate(name: string, system: IUpdatable | undefined, dt: number): void {
    if (!system) return;
    try {
      const mode = getRuntimePerformanceMode();
      if (mode === RuntimePerformanceMode.DEV || runtimeFrameCostProfiler.isSamplingFrame()) {
        runtimeFrameCostProfiler.measure(`update:${name}`, () => {
          system.update(dt);
        });
      } else {
        system.update(dt);
      }
      markSystemUpdated(name);
    } catch (error) {
      console.error(`[EngineController] Disabled system "${name}" after update failure`, error);
      markSystemError(name, error);
      logEvent('engine', `System ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      disableSystem(name, 'update failure');
    }
  }

  private syncRuntimeMode(reason: string): void {
    const s = this._systems;
    const cameraAuthority =
      this._state === 'in_game'
        ? this._runtimeMode === 'play' ? 'game' : 'editor'
        : 'menu';

    setInputContext(this._state === 'in_game' && this._runtimeMode === 'play' ? 'game' : 'ui');
    this.writeStateValue('mode', this._runtimeMode);
    void s.modeManager?.syncFromController(this._runtimeMode, { cameraAuthority });
    this.syncGameplayActivation(reason);
    this.syncHudVisibility(reason);
  }

  private syncGameMode(reason: string): void {
    const activeGameMode = this._state === 'in_game' ? this._gameMode : null;
    this.writeStateValue('game.mode', this._gameMode);
    this._systems.gameModeSystem?.syncFromController(activeGameMode);
    console.log(`[Mode] resolved game mode: ${activeGameMode ?? 'none'} (${reason})`);
  }

  private syncGameplayActivation(reason: string): void {
    const gameplayActive = this._state === 'in_game';
    const combatActive = gameplayActive && this._runtimeMode === 'play';
    this.writeStateValue('gameplay.active', gameplayActive);

    if (gameplayActive) {
      this._systems.gameplayRuntime?.enable();
    } else {
      this._systems.gameplayRuntime?.disable();
    }

    if (combatActive) {
      this._systems.combatSystem?.enable();
    } else {
      this._systems.combatSystem?.disable();
      this._systems.playController?.disable();
    }

    console.log(`[Systems] gameplay ${gameplayActive ? 'enabled' : 'disabled'} (${reason})`);
  }

  private syncHudVisibility(reason: string): void {
    if (this._state !== 'in_game') {
      this.setHudMode('hidden', reason);
      this.setHudVisible(false, reason);
      return;
    }

    this.setHudMode(this._runtimeMode === 'play' ? 'play' : 'editor', reason);
    this.setHudVisible(true, reason);
  }

  private writeStateValue(path: string, value: unknown): void {
    Engine.getStateManagerInstance()?.set(path, value);
  }
}
