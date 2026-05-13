/**
 * MainMenu (NEXUS ENGINE v0.1.4)
 *
 * Central hub for the game engine — now featuring:
 * • Transactional DOD Kernel (Enterprise-grade determinism)
 * • Multiplayer with state hashing + corruption detection
 * • Real-time PvP combat with authoritative validation
 *
 * CS 1.6-inspired UI with modern game information display.
 *
 * Screens: root, freeplay, editor, load, save, options, presets, multiplayer.
 *
 * Integration:
 *   - Transactional Kernel (v0.1.4+) state management
 *   - Multiplayer lobby + server browser
 *   - Game mode system (FFA, Team, Survival)
 *   - Audio mixer + feature toggles
 */

import * as Engine from '../../0-foundation/foundation/Engine';
import * as THREE from 'three';
import { MainMenuRenderer, SubMenuDef } from './MainMenuRenderer';
import { setContext, type Entity } from '@engine/1-kernel/core/public-api';

// ─── Types ────────────────────────────────────────────────────────────

export interface MenuAction {
  id: string;
  label: string;
  action: () => void;
  header?: boolean;
  getToggle?: () => boolean;
  description?: string;
}

export interface FeaturePreset {
  name: string;
  description: string;
  config: Record<string, boolean>;
}

export interface LevelMenuEntry {
  id: string;
  label: string;
  description?: string;
}

export interface AudioMenuState {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  toneAvailable: boolean;
}

export type MenuUiSoundKind = 'navigate' | 'confirm';

export interface GameModeMenuEntry {
  id: string;
  label: string;
  description?: string;
}

export type AudioMenuChannel = 'master' | 'music' | 'sfx';

export interface MainMenuConfig {
  showOnCreate?: boolean;
}

export type MenuScreen =
  | 'root'
  | 'play'
  | 'customize'
  | 'levels'
  | 'modes'
  | 'tools'
  | 'load'
  | 'save'
  | 'audio'
  | 'options'
  | 'presets'
  | 'multiplayer';

// ─── Built-in presets ─────────────────────────────────────────────────

const BUILT_IN_PRESETS: FeaturePreset[] = [
  {
    name: 'Horror',
    description: 'Full PS1 horror experience — fog, effects, AI, audio',
    config: {
      fog: true,
      visualEffects: true,
      enemyAI: true,
      audio: true,
      weapons: true,
      multiplayer: false,
      proceduralLevels: false,
      debugTools: false,
    },
  },
  {
    name: 'Gritty',
    description: 'Stripped-down grit — fog + weapons, no AI or audio',
    config: {
      fog: true,
      visualEffects: true,
      enemyAI: false,
      audio: false,
      weapons: true,
      multiplayer: false,
      proceduralLevels: false,
      debugTools: false,
    },
  },
  {
    name: 'PS1 Classic',
    description: 'Visual effects only — pure PS1 rendering showcase',
    config: {
      fog: true,
      visualEffects: true,
      enemyAI: false,
      audio: false,
      weapons: false,
      multiplayer: false,
      proceduralLevels: false,
      debugTools: false,
    },
  },
  {
    name: 'Full Sandbox',
    description: 'Everything enabled — all features active',
    config: {
      fog: true,
      visualEffects: true,
      enemyAI: true,
      audio: true,
      weapons: true,
      multiplayer: true,
      proceduralLevels: true,
      debugTools: true,
    },
  },
  {
    name: 'Minimal',
    description: 'All features off — clean empty scene',
    config: {
      fog: false,
      visualEffects: false,
      enemyAI: false,
      audio: false,
      weapons: false,
      multiplayer: false,
      proceduralLevels: false,
      debugTools: false,
    },
  },
];

// ─── MainMenu ─────────────────────────────────────────────────────────

import { getModeManager } from '../../2-systems/gameplay/modes/ModeManager';

export class MainMenu {
  private renderer: MainMenuRenderer;
  private screen: MenuScreen = 'root';
  private items: MenuAction[] = [];
  private selectedIndex: number = 0;
  private _visible: boolean = false;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _menuCameraFrame: number | null = null;
  private _menuCameraAngle = 0;
  private _menuCameraCurrent = new THREE.Vector3();
  private _menuCameraTarget = new THREE.Vector3();
  private _menuCameraOriginalPosition: { x: number; y: number; z: number } | null = null;
  private _menuCameraOriginalRotation: { x: number; y: number; z: number } | null = null;
  private _menuPlayerEntity: Entity | null = null;
  private _menuPlayerOriginalRotation: { x: number; y: number; z: number } | null = null;
  private _menuMenuLightingKey: THREE.DirectionalLight | null = null;
  private _menuMenuLightingRim: THREE.HemisphereLight | null = null;
  private _menuPedestal: THREE.Mesh | null = null;
  private _menuDebugMarker: THREE.Mesh | null = null;
  private _menuOriginalBackground: THREE.Color | null = null;
  private _menuOriginalFog: THREE.FogBase | null = null;

  /* ── External callbacks ────────────────────────────────────────── */
  private _onFreeplay: (() => void) | null = null;
  private _onQuickStart: (() => void) | null = null;
  private _onStartLevel: ((levelId: string) => void) | null = null;
  private _onOpenEditor: (() => void) | null = null;
  private _onOpenMultiplayer: (() => void) | null = null;
  private _onHorde: (() => void) | null = null;
  private _onDriftBomb: (() => void) | null = null;
  private _onLoadMap: ((name: string) => void) | null = null;
  private _onSaveMap: ((name: string) => void) | null = null;
  private _onExit: (() => void) | null = null;
  private _onCustomize: (() => void) | null = null;
  private _onCustomizeExit: (() => void) | null = null;
  private _levelProvider: (() => LevelMenuEntry[]) | null = null;
  private _mapListProvider: (() => string[]) | null = null;
  private _featureProvider: (() => { key: string; label: string; enabled: boolean }[]) | null = null;
  private _featureToggle: ((key: string) => void) | null = null;
  private _featureConfigure: ((config: Record<string, boolean>) => void) | null = null;
  private _audioStateProvider: (() => AudioMenuState) | null = null;
  private _audioAdjust: ((channel: AudioMenuChannel, delta: number) => void) | null = null;
  private _audioToggleMute: (() => void) | null = null;
  private _playUiSound: ((kind: MenuUiSoundKind) => void) | null = null;
  private _openDebug: (() => void) | null = null;
  private _getCurrentMode: (() => string) | null = null;
  private _gameModeProvider: (() => GameModeMenuEntry[]) | null = null;
  private _gameModeActivate: ((modeId: string) => void) | null = null;
  private _gameModeCurrent: (() => string | null) | null = null;
  private _identityPanel: HTMLElement | null = null;
  private _identityActionPanel: HTMLElement | null = null;

  constructor(cfg: MainMenuConfig = {}) {
    this.renderer = new MainMenuRenderer();
    this.renderer.onHover = (i: number) => this.hoverIndex(i);
    this.renderer.onClick = (i: number) => this.clickIndex(i);
    this._attachKeyboard();
    this.buildRootMenu();
    if (cfg.showOnCreate !== false) this.show();
  }

  // ─── Registration hooks ──────────────────────────────────────────

  /** "Start Test Level / Freeplay" — set play mode, activate features, load level */
  onFreeplay(cb: () => void): void { this._onFreeplay = cb; }
  onHorde(cb: () => void): void { this._onHorde = cb; }
  onDriftBomb(cb: () => void): void { this._onDriftBomb = cb; }
  onQuickStart(cb: () => void): void { this._onQuickStart = cb; }
  onStartLevel(cb: (levelId: string) => void): void { this._onStartLevel = cb; }
  /** "Editor" — enter editor mode */
  onOpenEditor(cb: () => void): void { this._onOpenEditor = cb; }
  onOpenMultiplayer(cb: () => void): void { this._onOpenMultiplayer = cb; }
  onCustomize(cb: () => void): void { this._onCustomize = cb; }
  onCustomizeExit(cb: () => void): void { this._onCustomizeExit = cb; }
  onLoadMap(cb: (name: string) => void): void { this._onLoadMap = cb; }
  onSaveMap(cb: (name: string) => void): void { this._onSaveMap = cb; }
  onExit(cb: () => void): void { this._onExit = cb; }

  setLevelProvider(fn: () => LevelMenuEntry[]): void { this._levelProvider = fn; }
  setMapListProvider(fn: () => string[]): void { this._mapListProvider = fn; }
  setFeatureProvider(fn: () => { key: string; label: string; enabled: boolean }[]): void { this._featureProvider = fn; }
  setFeatureToggle(fn: (key: string) => void): void { this._featureToggle = fn; }
  /** Bulk-apply a feature preset config. */
  setFeatureConfigure(fn: (config: Record<string, boolean>) => void): void { this._featureConfigure = fn; }
  setAudioStateProvider(fn: () => AudioMenuState): void { this._audioStateProvider = fn; }
  setAudioAdjust(fn: (channel: AudioMenuChannel, delta: number) => void): void { this._audioAdjust = fn; }
  setAudioToggleMute(fn: () => void): void { this._audioToggleMute = fn; }
  setUiSoundPlayer(fn: (kind: MenuUiSoundKind) => void): void { this._playUiSound = fn; }
  setOpenDebug(fn: () => void): void { this._openDebug = fn; }
  setCurrentModeProvider(fn: () => string): void { this._getCurrentMode = fn; }
  setGameModeProvider(fn: () => GameModeMenuEntry[]): void { this._gameModeProvider = fn; }
  setGameModeActivate(fn: (modeId: string) => void): void { this._gameModeActivate = fn; }
  setCurrentGameModeProvider(fn: () => string | null): void { this._gameModeCurrent = fn; }
  setIdentityPanel(element: HTMLElement | null): void {
    this._identityPanel = element;
    this._identityActionPanel = null;
    this.renderer.setAccessoryPanel(element);
  }

  // ─── Visibility ──────────────────────────────────────────────────

  show(): void {
    // Idempotency guard: never re-enter show() while already visible.
    // Without this, returning from a sub-screen or a redundant coordinator call would
    // reset the active screen back to root and restart the camera orbit loop.
    if (this._visible) return;
    console.log('[MainMenu] show() called, engine mode:', Engine.getEngineController()?.state);
    this._visible = true;
    this.screen = 'root';
    setContext('ui');
    getModeManager()?.setMenuPreviewActive(true);
    this.setCustomizeActive(false);
    this.buildRootMenu();
    this.renderer.show();
    // Reset orbit angle so returning from gameplay always starts from a consistent
    // front-facing position rather than a random mid-orbit angle.
    this._menuCameraAngle = 0;
    this.startMenuCameraMotion();
    this.renderCurrent();
  }

  hide(): void {
    console.log('[MainMenu] hide() called, engine mode:', Engine.getEngineController()?.state);
    this._visible = false;
    this.renderer.hide();
    this.setCustomizeActive(false);
    const modeManager = getModeManager();
    modeManager?.setMenuPreviewActive(false);
    setContext(Engine.getAuthoritativeInputContext());
    this.stopMenuCameraMotion();
  }

  toggle(): void {
    this._visible ? this.hide() : this.show();
  }

  isVisible(): boolean { return this._visible; }

  // ─── Screen builders ─────────────────────────────────────────────

  private buildRootMenu(): void {
    this.screen = 'root';
    this.setCustomizeActive(false);
    this.items = [
      {
        id: 'play',
        label: 'PLAY',
        description: 'Jump into multiplayer or solo freeplay.',
        action: () => this.openPlayScreen(),
      },
      {
        id: 'customize',
        label: 'CUSTOMIZE',
        description: 'Tune the scene and avatar with live gizmo controls.',
        action: () => this.openCustomizeScreen(),
      },
      {
        id: 'editor',
        label: 'EDITOR',
        description: 'Open the full editor workspace with live preview.',
        action: () => { this.hide(); this._onOpenEditor?.(); },
      },
      {
        id: 'exit',
        label: 'EXIT',
        description: 'Close active session state and reload the engine runtime.',
        action: () => { this._onExit?.(); },
      },
    ];
    this.selectedIndex = 0; // Default to PLAY
  }

  private openToolsScreen(): void {
    this.screen = 'tools';
    this.items = [
      {
        id: 'audio',
        label: 'Audio Mixer',
        description: 'Master, music, and SFX levels for quick test balancing.',
        action: () => this.openAudioScreen(),
      },
      {
        id: 'options',
        label: 'Feature Toggles',
        description: 'Enable or disable major runtime systems immediately.',
        action: () => this.openOptionsScreen(),
      },
      {
        id: 'presets',
        label: 'Feature Presets',
        description: 'Apply curated engine presets such as Full Sandbox or PS1 Classic.',
        action: () => this.openPresetsScreen(),
      },
      {
        id: 'load',
        label: 'Load Level',
        description: 'Open a saved or built-in level into the current runtime.',
        action: () => this.openLoadScreen(),
      },
      {
        id: 'save',
        label: 'Save Level',
        description: 'Write the current scene state back out through the save system.',
        action: () => this.openSaveScreen(),
      },
      {
        id: 'debug',
        label: 'Debug Tools [F3]',
        description: 'Open the live debug and system inspection UI.',
        action: () => { this.hide(); this._openDebug?.(); },
      },
      { id: 'back', label: '← Back', action: () => this.goRoot() },
    ];
    this.selectedIndex = 0;
    this.renderCurrent();
  }

  private openLevelsScreen(): void {
    this.screen = 'levels';
    const levels = this._levelProvider?.() ?? [];
    this.items = [];

    if (levels.length === 0) {
      this.items.push({ id: '_empty_levels', label: '  ( no scripted levels registered )', action: () => {}, header: true });
    } else {
      for (const level of levels) {
        this.items.push({
          id: `level_${level.id}`,
          label: level.label,
          description: level.description,
          action: () => { this.hide(); this._onStartLevel?.(level.id); },
        });
      }
    }

    this.items.push({ id: 'back', label: '← Back', action: () => this.goRoot() });
    this.selectedIndex = 0;
    this.renderCurrent();
  }

  private openLoadScreen(): void {
    this.screen = 'load';
    const maps = this._mapListProvider?.() ?? [];
    this.items = [];

    if (maps.length === 0) {
      this.items.push({ id: '_empty', label: '  ( no saved levels )', action: () => {}, header: true });
    } else {
      for (const m of maps) {
        this.items.push({
          id: `load_${m}`,
          label: m,
          action: () => { this._onLoadMap?.(m); this.hide(); },
        });
      }
    }
    this.items.push({ id: 'back', label: '← Back', action: () => this.goRoot() });
    this.selectedIndex = 0;
    this.renderCurrent();
  }

  private openModesScreen(): void {
    this.screen = 'modes';
    const modes = this._gameModeProvider?.() ?? [];
    const activeMode = this._gameModeCurrent?.();
    this.items = [];

    if (modes.length === 0) {
      this.items.push({
        id: '_empty_modes',
        label: '  ( no game modes registered )',
        action: () => {},
        header: true,
      });
    } else {
      for (const mode of modes) {
        const isActive = activeMode === mode.id;
        this.items.push({
          id: `mode_${mode.id}`,
          label: isActive ? `${mode.label}  [ACTIVE]` : mode.label,
          description: mode.description,
          action: () => {
            this._gameModeActivate?.(mode.id);
            this.openModesScreen();
          },
        });
      }
    }

    this.items.push({ id: 'back', label: '← Back', action: () => this.goRoot() });
    this.selectedIndex = 0;
    this.renderCurrent();
  }

  private openSaveScreen(): void {
    this.screen = 'save';
    const maps = this._mapListProvider?.() ?? [];
    this.items = [];

    for (const m of maps) {
      this.items.push({
        id: `save_${m}`,
        label: `Overwrite: ${m}`,
        action: () => { this._onSaveMap?.(m); this.hide(); },
      });
    }

    this.items.push({ id: 'save_new', label: '+ Save as new level…', action: () => this.promptSaveName() });
    this.items.push({ id: 'back', label: '← Back', action: () => this.goRoot() });
    this.selectedIndex = 0;
    this.renderCurrent();
  }

  private openCustomizeScreen(): void {
    this.screen = 'customize';
    this.setCustomizeActive(true);
    this.items = [
      {
        id: 'customize_header',
        label: 'Customize Mode',
        header: true,
        action: () => {},
      },
      {
        id: 'customize_desc',
        label: 'Editor gizmo and selection tools are enabled for scene tweaks.',
        description: 'Use mouse + keyboard to inspect objects, then return to Play when ready.',
        action: () => {},
        header: true,
      },
      {
        id: 'customize_exit',
        label: 'Exit Customize',
        description: 'Return to the main menu and disable gizmo interaction.',
        action: () => this.goRoot(),
      },
      {
        id: 'customize_back',
        label: '← Back',
        action: () => this.goRoot(),
      },
    ];
    this.selectedIndex = 2;
    this.renderCurrent();
  }

  private openPlayScreen(): void {
    this.screen = 'play';
    this.setCustomizeActive(false);
    this.items = [
      {
        id: 'play_header',
        label: 'Play',
        header: true,
        action: () => {},
      },
      {
        id: 'ritual_select',
        label: 'Choose Ritual',
        description: 'Pick your class loadout and appearance before entering solo play.',
        action: () => this.openCustomizeScreen(),
      },
      {
        id: 'horde',
        label: 'Horde Mode',
        description: 'Fight endless waves of enemies with your selected ritual loadout.',
        action: () => { this.hide(); this._onHorde?.(); },
      },
      {
        id: 'freeplay',
        label: 'Solo Sandbox',
        description: 'Test movement, physics, prefabs, and gameplay without network overhead.',
        action: () => { this.hide(); this._onFreeplay?.(); },
      },
      {
        id: 'drift_bomb',
        label: 'Drift Bomb',
        description: 'Counter-Strike inspired bomb defusal mode.',
        action: () => { this.hide(); this._onDriftBomb?.(); },
      },
      {
        id: 'multiplayer',
        label: 'Multiplayer Lobby',
        description: 'Join or host a networked match with deterministic sync and validation.',
        action: () => { this.hide(); this._onOpenMultiplayer?.(); },
      },
      {
        id: 'close_session',
        label: 'Close Session + Reload',
        description: 'Clear active entities and fully reload the engine runtime.',
        action: () => { this._onExit?.(); },
      },
      {
        id: 'back',
        label: '← Back',
        action: () => this.goRoot(),
      },
    ];
    this.selectedIndex = 1;
    this.renderCurrent();
  }

  private openAudioScreen(): void {
    this.screen = 'audio';
    const state = this._audioStateProvider?.() ?? { master: 0.8, music: 0.5, sfx: 0.7, muted: false, toneAvailable: false };
    const fmt = (value: number) => `${Math.round(value * 100)}%`;
    this.items = [
      {
        id: 'audio_header',
        label: state.toneAvailable ? '  Tone.js detected: synth music active' : '  Tone.js not detected: positional SFX still use Web Audio',
        action: () => {},
        header: true,
      },
      { id: 'master_up', label: `Master +10 (${fmt(state.master)})`, action: () => { this._audioAdjust?.('master', 0.1); this.openAudioScreen(); } },
      { id: 'master_down', label: `Master -10 (${fmt(state.master)})`, action: () => { this._audioAdjust?.('master', -0.1); this.openAudioScreen(); } },
      { id: 'music_up', label: `Music +10 (${fmt(state.music)})`, action: () => { this._audioAdjust?.('music', 0.1); this.openAudioScreen(); } },
      { id: 'music_down', label: `Music -10 (${fmt(state.music)})`, action: () => { this._audioAdjust?.('music', -0.1); this.openAudioScreen(); } },
      { id: 'sfx_up', label: `SFX +10 (${fmt(state.sfx)})`, action: () => { this._audioAdjust?.('sfx', 0.1); this.openAudioScreen(); } },
      { id: 'sfx_down', label: `SFX -10 (${fmt(state.sfx)})`, action: () => { this._audioAdjust?.('sfx', -0.1); this.openAudioScreen(); } },
      { id: 'mute', label: state.muted ? 'Unmute Audio' : 'Mute Audio', action: () => { this._audioToggleMute?.(); this.openAudioScreen(); } },
      { id: 'back', label: '← Back', action: () => this.goRoot() },
    ];
    this.selectedIndex = 1;
    this.renderCurrent();
  }

  private openOptionsScreen(): void {
    this.screen = 'options';
    this.items = [];

    const features = this._featureProvider?.() ?? [];
    for (const f of features) {
      this.items.push({
        id: `feat_${f.key}`,
        label: f.label,
        getToggle: () => {
          const all = this._featureProvider?.() ?? [];
          return all.find((x) => x.key === f.key)?.enabled ?? false;
        },
        action: () => {
          this._featureToggle?.(f.key);
          this.renderCurrent();
        },
      });
    }
    this.items.push({ id: 'back', label: '← Back', action: () => this.goRoot() });
    this.selectedIndex = 0;
    this.renderCurrent();
  }

  private openPresetsScreen(): void {
    this.screen = 'presets';
    this.items = [];

    for (const preset of BUILT_IN_PRESETS) {
      this.items.push({
        id: `preset_${preset.name}`,
        label: preset.name,
        description: preset.description,
        action: () => {
          this._featureConfigure?.(preset.config);
          // Flash feedback and stay on screen so user can pick another
          this.renderCurrent();
        },
      });
    }
    this.items.push({ id: 'back', label: '← Back', action: () => this.goRoot() });
    this.selectedIndex = 0;
    this.renderCurrent();
  }

  private setCustomizeActive(active: boolean): void {
    if (active) {
      this._onCustomize?.();
    } else {
      this._onCustomizeExit?.();
    }
  }

  private goRoot(): void {
    this.buildRootMenu();
    this.renderCurrent();
  }

  private enableIdentityPanel(compact: boolean): void {
    if (!this._identityPanel) return;
    const anyPanel = this._identityPanel as unknown as { setCompactMode?: (compact: boolean) => void };
    if (typeof anyPanel.setCompactMode === 'function') {
      anyPanel.setCompactMode(compact);
    }
    this._identityPanel.style.display = 'flex';
  }

  private buildIdentityActionPanel(): HTMLElement | null {
    if (!this._identityPanel) return null;
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '8px';
    wrapper.style.position = 'relative';
    wrapper.style.cursor = 'pointer';
    wrapper.style.width = '100%';
    wrapper.style.flex = '1 1 0';
    wrapper.style.minWidth = '320px';
    wrapper.style.maxWidth = '100%';
    wrapper.style.alignItems = 'stretch';
    wrapper.style.minHeight = '0';
    wrapper.style.height = '100%';

    const overlay = document.createElement('div');
    overlay.textContent = 'OPEN CUSTOMIZE';
    overlay.style.cssText = [
      'position:absolute',
      'inset:0',
      'display:flex',
      'align-items:flex-end',
      'justify-content:center',
      'padding-bottom:18px',
      'background:rgba(0,0,0,0.16)',
      'color:#e5f1ff',
      'font-size:12px',
      'font-weight:700',
      'letter-spacing:1px',
      'text-transform:uppercase',
      'pointer-events:none',
    ].join(';');
    wrapper.appendChild(this._identityPanel);
    wrapper.appendChild(overlay);
    wrapper.addEventListener('click', () => this.openCustomizeScreen());
    return wrapper;
  }

  private promptSaveName(): void {
    const name = prompt('Level name:');
    if (name && name.trim().length > 0) {
      this._onSaveMap?.(name.trim());
      this.hide();
    }
  }

  // ─── Rendering delegation ────────────────────────────────────────

  private renderCurrent(): void {
    const screenTitle: Record<MenuScreen, string> = {
      root: 'NEXUS ENGINE',
      play: 'Play',
      customize: 'Customize',
      levels: 'Scripted Levels',
      modes: 'Game Modes',
      tools: 'Tools & Settings',
      load: 'Load Level',
      save: 'Save Level',
      audio: 'Audio Mixer',
      options: 'Feature Toggles',
      presets: 'Feature Presets',
      multiplayer: 'Multiplayer',
    };

    const sub: SubMenuDef = {
      title: screenTitle[this.screen],
      subtitle: this.screen === 'root'
        ? undefined
        : 'Use ESC to go back',
      items: this.items.map((item, i) => ({
        label: item.label,
        selected: i === this.selectedIndex,
        header: item.header,
        toggleState: item.getToggle?.(),
        description: item.description,
      })),
    };
    this.renderer.render(sub);
    if (this.screen === 'customize' && this._identityPanel instanceof HTMLElement) {
      this.enableIdentityPanel(false);
      this.renderer.setAccessoryPanel(this._identityPanel);
    } else if (this.screen === 'root' && this._identityPanel instanceof HTMLElement) {
      this.enableIdentityPanel(true);
      this.renderer.setAccessoryPanel(this.buildIdentityActionPanel() ?? this._identityPanel);
    } else {
      this.renderer.setAccessoryPanel(null);
      if (this._identityPanel instanceof HTMLElement) {
        this._identityPanel.style.display = 'none';
      }
    }

    // Footer hints
    if (this.screen === 'root') {
      this.renderer.setFooter('F1: Toggle Menu • F3: Debug • F6: Debug Panel');
    } else {
      this.renderer.setFooter('ESC to go back • deterministic multiplayer • editor-ready');
    }
  }

  // ─── Navigation ──────────────────────────────────────────────────

  private selectableIndices(): number[] {
    return this.items.map((it, i) => (it.header ? -1 : i)).filter((i) => i >= 0);
  }

  private moveSelection(dir: -1 | 1): void {
    const selectable = this.selectableIndices();
    if (selectable.length === 0) return;
    const curPos = selectable.indexOf(this.selectedIndex);
    let next = curPos + dir;
    if (next < 0) next = selectable.length - 1;
    if (next >= selectable.length) next = 0;
    this.selectedIndex = selectable[next];
    this._playUiSound?.('navigate');
    this.renderCurrent();
  }

  private activateSelection(): void {
    const item = this.items[this.selectedIndex];
    if (item && !item.header) {
      this._playUiSound?.('confirm');
      item.action();
    }
  }

  // ─── Keyboard ────────────────────────────────────────────────────

  private _attachKeyboard(): void {
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this._visible) return;

      if (document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          this.moveSelection(-1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.moveSelection(1);
          break;
        case 'Enter':
          e.preventDefault();
          this.activateSelection();
          break;
        case 'Escape':
          e.preventDefault();
          if (this.screen !== 'root') {
            this.goRoot();
          } else {
            this.hide();
          }
          break;
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  // ─── Mouse support (delegated from renderer) ────────────────────

  hoverIndex(index: number): void {
    if (index >= 0 && index < this.items.length && !this.items[index].header) {
      if (this.selectedIndex !== index) {
        this._playUiSound?.('navigate');
      }
      this.selectedIndex = index;
      // Update visual selection in-place — no DOM rebuild so clicks still work
      this.renderer.updateSelection(index);
    }
  }

  clickIndex(index: number): void {
    if (index >= 0 && index < this.items.length && !this.items[index].header) {
      this.selectedIndex = index;
      this.activateSelection();
    }
  }

  private findMenuPlayerPosition(): THREE.Vector3 {
    const entityManager = Engine.getEntityManager();
    const localPlayers = entityManager?.getEntitiesWithComponent('localPlayer') ?? [];
    if (localPlayers.length === 0) {
      return new THREE.Vector3(0, 1.35, 0);
    }

    const transform = localPlayers[0].getTransform();
    return new THREE.Vector3(transform.position.x, transform.position.y, transform.position.z);
  }

  private startMenuCameraMotion(): void {
    const engineCamera = Engine.getEngineCamera();
    const scene = Engine.getEngineScene();
    if (!engineCamera || !scene || this._menuCameraFrame !== null) return;

    const entityManager = Engine.getEntityManager();
    const localPlayers = entityManager?.getEntitiesWithComponent('localPlayer') ?? [];
    this._menuPlayerEntity = localPlayers[0] ?? null;
    if (this._menuPlayerEntity) {
      this._menuPlayerOriginalRotation = { ...this._menuPlayerEntity.getTransform().rotation };
    }

    this._menuCameraOriginalPosition = {
      x: engineCamera.position.x,
      y: engineCamera.position.y,
      z: engineCamera.position.z,
    };
    this._menuCameraOriginalRotation = {
      x: engineCamera.rotation.x,
      y: engineCamera.rotation.y,
      z: engineCamera.rotation.z,
    };
    this._menuCameraCurrent.copy(engineCamera.position);

    if (scene.background instanceof THREE.Color) {
      this._menuOriginalBackground = scene.background.clone();
    } else {
      this._menuOriginalBackground = null;
    }
    this._menuOriginalFog = scene.fog ?? null;
    scene.background = new THREE.Color(0x07101d);
    scene.fog = new THREE.Fog(0x07101d, 4, 16);

    this._menuMenuLightingKey = new THREE.DirectionalLight(0xf8f4e0, 0.85);
    this._menuMenuLightingKey.position.set(2.2, 4.5, 1.1);
    this._menuMenuLightingKey.castShadow = false;
    scene.add(this._menuMenuLightingKey);

    this._menuMenuLightingRim = new THREE.HemisphereLight(0x889cff, 0x080820, 0.32);
    scene.add(this._menuMenuLightingRim);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.4, 0.3, 32),
      new THREE.MeshStandardMaterial({ color: 0x10213a, roughness: 0.46, metalness: 0.2 }),
    );
    pedestal.position.set(0, 0.15, 0);
    pedestal.receiveShadow = true;
    scene.add(pedestal);
    this._menuPedestal = pedestal;

    const debugCube = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.65, 0.65),
      new THREE.MeshStandardMaterial({
        color: 0xff9f72,
        emissive: 0xff8c60,
        emissiveIntensity: 1.5,
        roughness: 0.2,
        metalness: 0.24,
      }),
    );
    debugCube.position.set(0, 1.8, 1.2);
    scene.add(debugCube);
    this._menuDebugMarker = debugCube;

    console.log('[MainMenu] startMenuCameraMotion() enabled', {
      position: engineCamera.position.clone(),
      background: scene.background,
      fog: scene.fog instanceof THREE.Fog ? 'Fog enabled' : 'No fog',
      debugMarker: !!this._menuDebugMarker,
    });

    let lastFrameTime = performance.now();
    const tick = () => {
      if (!engineCamera) {
        this._menuCameraFrame = requestAnimationFrame(tick);
        return;
      }

      const now = performance.now();
      const dt = Math.min(0.06, (now - lastFrameTime) * 0.001);
      lastFrameTime = now;
      this._menuCameraAngle += dt * 0.24;

      const playerPosition = this.findMenuPlayerPosition();
      const orbitYaw = this._menuCameraAngle * 1.2;
      const radius = 3.6;
      const height = 1.85 + Math.sin(this._menuCameraAngle * 2.0) * 0.12;
      const zoomOffset = 1.75 + Math.cos(this._menuCameraAngle * 1.6) * 0.18;
      const targetPosition = this._menuCameraTarget;
      targetPosition.set(
        playerPosition.x + Math.sin(orbitYaw) * radius - 0.2,
        playerPosition.y + height,
        playerPosition.z + zoomOffset,
      );
      this._menuCameraCurrent.lerp(targetPosition, 0.14);
      engineCamera.position.copy(this._menuCameraCurrent);

      const lookAtTarget = new THREE.Vector3(playerPosition.x, playerPosition.y + 1.35, playerPosition.z);
      engineCamera.lookAt(lookAtTarget);

      if (this._menuPedestal) {
        this._menuPedestal.position.set(playerPosition.x, 0.15, playerPosition.z + 1.2);
      }

      if (scene.background instanceof THREE.Color) {
        const hue = 0.58 + Math.sin(this._menuCameraAngle * 0.28) * 0.02;
        scene.background.setHSL(hue, 0.42, 0.08);
      }
      if (scene.fog instanceof THREE.Fog) {
        const hue = 0.58 + Math.sin(this._menuCameraAngle * 0.24 + 0.4) * 0.02;
        scene.fog.color.setHSL(hue, 0.46, 0.08);
      }

      if (this._menuMenuLightingKey) {
        this._menuMenuLightingKey.intensity = 0.75 + Math.sin(this._menuCameraAngle * 1.2) * 0.1;
      }

      if (Engine.getEngineController()?.is('menu')) {
        if (this._menuMenuLightingKey) {
          this._menuMenuLightingKey.position.set(
            playerPosition.x + 2.4,
            playerPosition.y + 4.2,
            playerPosition.z + 1.2,
          );
        }

        if (this._menuPlayerEntity) {
          const transform = this._menuPlayerEntity.getTransform();
          this._menuPlayerEntity.setTransform({
            rotation: {
              x: transform.rotation.x,
              y: transform.rotation.y + dt * 0.18,
              z: transform.rotation.z,
            },
          });
        }
      }

      if (this._menuDebugMarker) {
        this._menuDebugMarker.position.set(
          playerPosition.x,
          playerPosition.y + 1.8,
          playerPosition.z + 1.2,
        );
      }

      this._menuCameraFrame = requestAnimationFrame(tick);
    };

    this._menuCameraFrame = requestAnimationFrame(tick);
  }

  private stopMenuCameraMotion(): void {
    if (this._menuCameraFrame !== null) {
      cancelAnimationFrame(this._menuCameraFrame);
      this._menuCameraFrame = null;
    }
    const engineCamera = Engine.getEngineCamera();
    const scene = Engine.getEngineScene();
    if (engineCamera && this._menuCameraOriginalPosition && this._menuCameraOriginalRotation) {
      engineCamera.position.set(
        this._menuCameraOriginalPosition.x,
        this._menuCameraOriginalPosition.y,
        this._menuCameraOriginalPosition.z,
      );
      engineCamera.rotation.set(
        this._menuCameraOriginalRotation.x,
        this._menuCameraOriginalRotation.y,
        this._menuCameraOriginalRotation.z,
      );
    }

    if (scene) {
      if (this._menuOriginalBackground) {
        scene.background = this._menuOriginalBackground;
      } else {
        scene.background = null;
      }
      scene.fog = this._menuOriginalFog;
      if (this._menuMenuLightingKey) {
        scene.remove(this._menuMenuLightingKey);
      }
      if (this._menuMenuLightingRim) {
        scene.remove(this._menuMenuLightingRim);
      }
      if (this._menuPedestal) {
        scene.remove(this._menuPedestal);
      }
      if (this._menuDebugMarker) {
        scene.remove(this._menuDebugMarker);
      }
    }

    if (this._menuPlayerEntity && this._menuPlayerOriginalRotation) {
      this._menuPlayerEntity.setTransform({
        rotation: {
          x: this._menuPlayerOriginalRotation.x,
          y: this._menuPlayerOriginalRotation.y,
          z: this._menuPlayerOriginalRotation.z,
        },
      });
    }

    this._menuPlayerEntity = null;
    this._menuPlayerOriginalRotation = null;
    this._menuCameraOriginalPosition = null;
    this._menuCameraOriginalRotation = null;
    this._menuMenuLightingKey = null;
    this._menuMenuLightingRim = null;
    this._menuOriginalBackground = null;
    this._menuOriginalFog = null;
  }
  // ─── Cleanup ─────────────────────────────────────────────────────

  destroy(): void {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    this.renderer.destroy();
  }
}
