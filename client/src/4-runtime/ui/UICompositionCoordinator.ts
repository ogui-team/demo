import type { Group } from 'three';
import type { DevAutostartActions } from '../diagnostics/debug/devAutostart';
import type { MultiplayerClient } from '../../3-network/network/MultiplayerClient';
import type { InGamePlayerMode } from './InGameModePanel';
import type { AudioMenuChannel, AudioMenuState, GameModeMenuEntry, LevelMenuEntry, MainMenu } from './MainMenu';
import type { ServerBrowser } from './ServerBrowser';

type RuntimeAppState = 'menu' | 'lobby' | 'starting' | 'in_game' | 'post_game';
type EngineMode = 'editor' | 'play';

interface ModeListenerRegistration {
  onEnterPlay: () => void;
  onEnterEditor: () => void;
}

interface MultiplayerGameStartPayload {
  map: string;
  mode: string;
  sessionId: string;
  late?: boolean;
}

interface UICompositionCoordinatorConfig {
  registerModeListener?: (listener: ModeListenerRegistration) => void;
  keyboard: {
    isInGame: () => boolean;
    canSwitchModes: () => boolean;
    setEngineMode: (mode: EngineMode) => void;
  };
  inGamePanel: {
    client: MultiplayerClient;
  };
  mainMenu: {
    onFreeplay: () => void;
    onHorde: () => void;
    onDriftBomb: () => void;
    onQuickStart: () => void;
    onStartLevel: (levelId: string) => void;
    onExit: () => void;
    builtInMaps: readonly string[];
    configureEditorFeatures: () => void;
    stopMusic: () => void;
    getHasActiveLevel: () => boolean;
    buildEditorPreviewLevel: () => Group | null;
    clearActiveLevel: () => void;
    buildBuiltInMap: (mapId: string) => Group | null;
    setActiveLevelGroup: (group: Group | null) => void;
    loadSavedMap: (name: string) => void;
    saveMap: (name: string) => void;
    setEngineMode: (mode: EngineMode) => void;
    enableMultiplayerFeature: () => void;
    transitionState: (state: RuntimeAppState, reason: string) => void;
    getLevels: () => LevelMenuEntry[];
    getMaps: () => string[];
    getFeatures: () => { key: string; label: string; enabled: boolean }[];
    toggleFeature: (key: string) => void;
    configureFeatures: (config: Record<string, boolean>) => void;
    getAudioState: () => AudioMenuState;
    adjustAudio: (channel: AudioMenuChannel, delta: number) => void;
    toggleAudioMute: () => void;
    openDebug: () => void;
    onCustomize: () => void;
    onCustomizeExit: () => void;
    getCurrentMode: () => string;
    getCurrentGameMode: () => string | null;
    getGameModes: () => GameModeMenuEntry[];
    activateGameMode: (modeId: string) => void;
    getIdentityPanel: () => HTMLElement | null;
    log: (message: string) => void;
  };
  serverBrowser: {
    httpUrl: string;
    wsUrl: string;
    client: MultiplayerClient;
    getMaps: () => string[];
    onClose: () => void;
    onGameStart: (data: MultiplayerGameStartPayload) => void;
    onHostGame: (payload: { playerName: string; config: import('../../3-network/network/MultiplayerClient').HostedRoomConfig }) => void;
    onJoinGame: (payload: { playerName: string; roomId: string | null }) => void;
  };
}

export class UICompositionCoordinator {
  private readonly config: UICompositionCoordinatorConfig;
  private readonly builtInMaps: Set<string>;
  private mainMenu: MainMenu | null = null;
  private mainMenuPromise: Promise<MainMenu> | null = null;
  private wantsMainMenuVisible = false;
  private serverBrowser: ServerBrowser | null = null;
  private serverBrowserPromise: Promise<ServerBrowser> | null = null;
  private inGameModePanelPromise: Promise<{ toggle(): void; destroy(): void; setCurrentMode(mode: InGamePlayerMode): void; attachClient(client: MultiplayerClient, isHost?: boolean): void; }> | null = null;
  private pendingInGameMode: InGamePlayerMode = 'play';
  private pendingHostStatus = false;
  private suppressNextEscapeKeyupOpen = false;
  private readonly keyboardHandler: (event: KeyboardEvent) => void;
  private readonly keyupHandler: (event: KeyboardEvent) => void;

  constructor(config: UICompositionCoordinatorConfig) {
    this.config = config;
    this.builtInMaps = new Set(config.mainMenu.builtInMaps);
    this.keyboardHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.isMenuVisible()) {
        // Let MainMenu process Escape (back/hide), but do not reopen on keyup.
        this.suppressNextEscapeKeyupOpen = true;
        return;
      }
      if (event.key === 'Escape' && !this.isMenuVisible()) {
        event.preventDefault();
        event.stopPropagation();
        this.show();
        return;
      }
      if (event.key === 'F1') {
        event.preventDefault();
        this.toggleMainMenu();
      }
      if ((event.key === 'o' || event.key === 'O') && this.config.keyboard.isInGame()) {
        event.preventDefault();
        void this.toggleInGameModePanel();
      }
      if (!this.isMenuVisible() && this.config.keyboard.canSwitchModes()) {
        if (event.key === 'e' || event.key === 'E') {
          this.config.keyboard.setEngineMode('editor');
        }
        if (event.key === 'p' || event.key === 'P') {
          this.config.keyboard.setEngineMode('play');
        }
      }
    };

    this.keyupHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (this.suppressNextEscapeKeyupOpen) {
        this.suppressNextEscapeKeyupOpen = false;
        return;
      }
      // ESC can first release pointer lock at browser level; open menu on keyup
      // if gameplay is active and no menu is visible yet.
      if (!this.config.keyboard.isInGame()) return;
      if (this.isMenuVisible()) return;
      if (typeof document !== 'undefined' && document.pointerLockElement) return;
      this.show();
    };

    window.addEventListener('keydown', this.keyboardHandler, true);
    window.addEventListener('keyup', this.keyupHandler, true);
    this.renderHotkeyHint();
    this.config.registerModeListener?.({
      onEnterPlay: () => this.hide(),
      onEnterEditor: () => {},
    });
  }

  startRuntimeUi(search: string, actions: Pick<DevAutostartActions, 'startLocalFreeplay' | 'startEngineShowcase' | 'startScriptedLevel' | 'hostMultiplayer' | 'joinMultiplayer'>): void {
    this.prewarmPersistedServerBrowser();
    this.preloadMainMenu();
    this.config.mainMenu.transitionState('menu', 'app_start');

    if (!search.includes('autostart=')) {
      return;
    }

    void import('../diagnostics/debug/devAutostart').then(({ runAutostartFromQuery }) => {
      runAutostartFromQuery(search, {
        hideMenu: () => this.hide(),
        showMenu: () => this.show(),
        startLocalFreeplay: actions.startLocalFreeplay,
        startEngineShowcase: actions.startEngineShowcase,
        startScriptedLevel: actions.startScriptedLevel,
        hostMultiplayer: actions.hostMultiplayer,
        joinMultiplayer: actions.joinMultiplayer,
      });
    }).catch((error) => {
      console.error('[UICompositionCoordinator] Failed to load autostart helpers', error);
    });
  }

  show(): void {
    // If the menu is already visible, avoid pushing a redundant show() that would
    // flash the DOM or confuse the state machine.
    if (this.mainMenu?.isVisible()) return;
    this.wantsMainMenuVisible = true;
    void this.ensureMainMenu().then((menu) => {
      if (this.wantsMainMenuVisible) {
        menu.show();
      }
    }).catch((error) => {
      console.error('[UICompositionCoordinator] Failed to load MainMenu', error);
    });
  }

  preloadMainMenu(): void {
    void this.ensureMainMenu().catch((error) => {
      console.error('[UICompositionCoordinator] Failed to preload MainMenu', error);
    });
  }

  hide(): void {
    this.wantsMainMenuVisible = false;
    this.mainMenu?.hide();
  }

  toggleMainMenu(): void {
    if (!this.mainMenu) {
      if (this.wantsMainMenuVisible) {
        this.hide();
      } else {
        this.show();
      }
      return;
    }

    this.mainMenu.toggle();
    this.wantsMainMenuVisible = this.mainMenu.isVisible();
  }

  isMenuVisible(): boolean {
    return this.mainMenu?.isVisible() ?? this.wantsMainMenuVisible;
  }

  async showServerBrowser(): Promise<void> {
    const browser = await this.ensureServerBrowser();
    await browser.show();
  }

  async reopenServerBrowserToList(status: string): Promise<void> {
    const browser = await this.ensureServerBrowser();
    await browser.reopenToServerList(status);
  }

  prewarmPersistedServerBrowser(): void {
    if (window.localStorage.getItem('ps1-engine.serverBrowser.visible') === '1') {
      void this.ensureServerBrowser();
    }
  }

  getAutostartActions(): { hideMenu: () => void; showMenu: () => void } {
    return {
      hideMenu: () => this.hide(),
      showMenu: () => this.show(),
    };
  }

  setInGameMode(mode: InGamePlayerMode): void {
    this.pendingInGameMode = mode;
    void this.ensureInGameModePanel().then((panel) => {
      panel.setCurrentMode(mode);
    }).catch((error) => {
      console.error('[UICompositionCoordinator] Failed to update in-game mode panel state', error);
    });
  }

  attachInGameModePanelClient(hosted: boolean): void {
    this.pendingHostStatus = hosted;
    void this.ensureInGameModePanel().then((panel) => {
      panel.attachClient(this.config.inGamePanel.client, hosted);
    }).catch((error) => {
      console.error('[UICompositionCoordinator] Failed to attach multiplayer client to in-game mode panel', error);
    });
  }

  toggleInGameModePanel(): Promise<void> {
    return this.ensureInGameModePanel().then((panel) => {
      panel.toggle();
    }).catch((error) => {
      console.error('[UICompositionCoordinator] Failed to toggle in-game mode panel', error);
    });
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyboardHandler, true);
    window.removeEventListener('keyup', this.keyupHandler, true);
    this.mainMenu?.destroy();
    this.serverBrowser?.destroy();
    void this.ensureInGameModePanel().then((panel) => {
      panel.destroy();
    }).catch(() => {
      // Ignore lazy panel teardown failures during unload.
    });
  }

  private async ensureMainMenu(): Promise<MainMenu> {
    if (this.mainMenu) return this.mainMenu;
    if (!this.mainMenuPromise) {
      this.mainMenuPromise = import('./MainMenu').then(({ MainMenu }) => {
        const menu = new MainMenu({ showOnCreate: false });
        this.configureMainMenu(menu);
        this.mainMenu = menu;
        if (this.wantsMainMenuVisible) {
          menu.show();
        }
        return menu;
      }).catch((error) => {
        this.mainMenuPromise = null;
        throw error;
      });
    }
    return this.mainMenuPromise;
  }

  private configureMainMenu(menu: MainMenu): void {
    menu.onFreeplay(() => {
      this.config.mainMenu.onFreeplay();
    });
    menu.onHorde(() => {
      this.config.mainMenu.onHorde();
    });
    menu.onDriftBomb(() => {
      this.config.mainMenu.onDriftBomb();
    });
    menu.onQuickStart(() => {
      this.config.mainMenu.onQuickStart();
    });
    menu.onStartLevel((levelId) => {
      this.config.mainMenu.onStartLevel(levelId);
    });
    menu.onOpenEditor(() => {
      this.openEditor();
    });
    menu.onOpenMultiplayer(() => {
      this.openMultiplayer();
    });
    menu.onLoadMap((name) => {
      this.loadMap(name);
    });
    menu.onSaveMap((name) => {
      this.config.mainMenu.saveMap(name);
      this.config.mainMenu.log(`[App] Saved map: ${name}`);
    });
    menu.onExit(() => {
      this.config.mainMenu.onExit();
    });
    menu.setLevelProvider(this.config.mainMenu.getLevels);
    menu.setMapListProvider(this.config.mainMenu.getMaps);
    menu.setFeatureProvider(this.config.mainMenu.getFeatures);
    menu.setFeatureToggle(this.config.mainMenu.toggleFeature);
    menu.setFeatureConfigure((config) => {
      this.config.mainMenu.configureFeatures(config);
      this.config.mainMenu.log('[App] Feature preset applied & saved');
    });
    menu.setAudioStateProvider(this.config.mainMenu.getAudioState);
    menu.setAudioAdjust(this.config.mainMenu.adjustAudio);
    menu.setAudioToggleMute(this.config.mainMenu.toggleAudioMute);
    menu.setOpenDebug(this.config.mainMenu.openDebug);
    menu.setCurrentModeProvider(this.config.mainMenu.getCurrentMode);
    menu.setCurrentGameModeProvider(this.config.mainMenu.getCurrentGameMode);
    menu.setGameModeProvider(this.config.mainMenu.getGameModes);
    menu.setGameModeActivate(this.config.mainMenu.activateGameMode);
    menu.setIdentityPanel(this.config.mainMenu.getIdentityPanel());
  }

  private openEditor(): void {
    // Coming from live gameplay, clear runtime session first so editor opens with a clean state.
    if (this.config.keyboard.isInGame()) {
      this.config.mainMenu.onExit();
    }
    this.config.mainMenu.configureEditorFeatures();
    this.config.mainMenu.stopMusic();
    if (!this.config.mainMenu.getHasActiveLevel()) {
      this.config.mainMenu.setActiveLevelGroup(this.config.mainMenu.buildEditorPreviewLevel());
    }
    this.config.mainMenu.setEngineMode('editor');
    this.config.mainMenu.log('[App] Editor mode entered');
  }

  private loadMap(name: string): void {
    if (this.builtInMaps.has(name)) {
      this.config.mainMenu.clearActiveLevel();
      this.config.mainMenu.stopMusic();
      this.config.mainMenu.setActiveLevelGroup(this.config.mainMenu.buildBuiltInMap(name));
      this.config.mainMenu.setEngineMode('editor');
      this.config.mainMenu.log(`[App] Built-in map loaded: ${name}`);
      return;
    }

    this.config.mainMenu.loadSavedMap(name);
    this.config.mainMenu.setEngineMode('editor');
    this.config.mainMenu.log(`[App] Loaded map: ${name}`);
  }

  private openMultiplayer(): void {
    // Hide MainMenu FIRST to ensure clean transition
    this.mainMenu?.hide();
    
    // Initialize game world for multiplayer lobby display
    this.config.mainMenu.enableMultiplayerFeature();
    this.config.mainMenu.stopMusic();
    
    // Transition to lobby state for multiplayer
    this.config.mainMenu.transitionState('lobby', 'open_multiplayer');
    
    // Now show the server browser with initialized game world behind it
    void this.showServerBrowser();
  }

  private async ensureServerBrowser(): Promise<ServerBrowser> {
    if (this.serverBrowser) return this.serverBrowser;
    if (!this.serverBrowserPromise) {
      this.serverBrowserPromise = import('./ServerBrowser').then(({ ServerBrowser }) => {
        const browser = new ServerBrowser(
          {
            httpUrl: this.config.serverBrowser.httpUrl,
            wsUrl: this.config.serverBrowser.wsUrl,
            hostGame: this.config.serverBrowser.onHostGame,
            joinGame: this.config.serverBrowser.onJoinGame,
          },
          this.config.serverBrowser.client,
        );
        browser.setMapsProvider(this.config.serverBrowser.getMaps);
        browser.onClose(() => {
          this.config.serverBrowser.onClose();
        });
        browser.onGameStart((data) => {
          this.config.serverBrowser.onGameStart(data);
        });
        this.serverBrowser = browser;
        return browser;
      }).catch((error) => {
        this.serverBrowserPromise = null;
        throw error;
      });
    }
    return this.serverBrowserPromise;
  }

  private async ensureInGameModePanel(): Promise<{ toggle(): void; destroy(): void; setCurrentMode(mode: InGamePlayerMode): void; attachClient(client: MultiplayerClient, isHost?: boolean): void; }> {
    if (!this.inGameModePanelPromise) {
      this.inGameModePanelPromise = import('./InGameModePanel').then(({ InGameModePanel }) => {
        const panel = new InGameModePanel();
        panel.setCurrentMode(this.pendingInGameMode);
        panel.attachClient(this.config.inGamePanel.client, this.pendingHostStatus);
        return panel;
      }).catch((error) => {
        this.inGameModePanelPromise = null;
        throw error;
      });
    }
    return this.inGameModePanelPromise;
  }

  private renderHotkeyHint(): void {
    const uiElement = document.getElementById('ui');
    if (!uiElement) return;
    uiElement.innerHTML = `
      <p style="color: #888; font-size: 11px; font-family: sans-serif;">
        F1 / ESC: Main Menu &nbsp;|&nbsp; F2: Control Tower &nbsp;|&nbsp; F3: Debug Panel &nbsp;|&nbsp; E: Editor &nbsp;|&nbsp; P: Play
      </p>
    `;
  }
}