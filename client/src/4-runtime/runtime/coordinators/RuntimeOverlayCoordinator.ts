import * as Engine from '../../../0-foundation/foundation/Engine';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { DebugManager } from '../../diagnostics/debug/DebugManager';
import type { RuntimeDiagnosticsCoordinator } from '../../diagnostics/debug/RuntimeDiagnosticsCoordinator';
import type { RuntimeMetricsReporter } from '../../diagnostics/debug/RuntimeMetricsReporter';
import type { GameAudioManager } from '../../../2-systems/gameplay/systems/GameAudioManager';
import type { HUDSystem } from '../../../2-systems/gameplay/systems/HUDSystem';
import type { SpawnSystem } from '../../../2-systems/gameplay/systems/SpawnSystem';
import type { InventorySystem } from '../../../2-systems/gameplay/systems/InventorySystem';
import type { WeaponSystem } from '../../../2-systems/gameplay/systems/WeaponSystem';
import type { PrefabSystem } from '../../../2-systems/gameplay/systems/PrefabSystem';
import type { WorldObjectAuthorityService } from '../../../2-systems/gameplay/game/WorldObjectAuthorityService';
import type { UndoRedoSystem } from '@engine/1-kernel/core/public-api';
import type { SaveLoadManager } from '@engine/1-kernel/core/public-api';
import type { ReplaySystem } from '@engine/1-kernel/core/public-api';
import type { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import type { NetworkSyncSystem } from '../../../3-network/network/NetworkSyncSystem';
import type { GameModeManager } from '../../../2-systems/gameplay/game/GameModeManager';
import type { GameModeSystem } from '../../../2-systems/gameplay/game/GameModeSystem';
import type { UICompositionCoordinator } from '../../ui/UICompositionCoordinator';
import type { RuntimeIssueInspector } from '../../ui/RuntimeIssueInspector';
import type { Scoreboard } from '../../ui/Scoreboard';
import type { NetGraph } from '../../ui/NetGraph';
import type { DeathScreenActions, HitFeedback } from '../../ui/HitFeedback';
import type { StatusMovementDebugPanel } from '../../diagnostics/debug/StatusMovementDebugPanel';
import type { EditorMenu } from '../../editor/EditorMenu';
import type { RuntimeAuxiliaryAssembly } from '../RuntimeAuxiliaryAssembly';
import type { ClientWorldRuntimeCoordinator } from './ClientWorldRuntimeCoordinator';

interface RuntimeLaunchActions {
  startLocalFreeplay(): void;
  startEngineShowcase(): void;
  startScriptedLevel(levelId: string): void;
  hostMultiplayer(config: {
    playerName: string;
    roomName: string;
    map: string;
    mode?: 'ffa' | 'horde' | 'drift_bomb';
    killLimit: number;
    roundDurationSec: number;
    maxPlayers: number;
    forceStart: boolean;
  }): void;
  joinMultiplayer(config: { playerName: string; roomId: string | null; autoReady: boolean }): void;
}

interface RuntimeOverlayCoordinatorConfig {
  debugManager: DebugManager;
  engineController: { registerSystems(systems: unknown): void; is(state: string): boolean };
  modeManager: { registerListener(listener: { onEnterPlay(): void; onEnterEditor(): void }): void } | null;
  mpClient: MultiplayerClient;
  runtimeDiagnosticsCoordinator: RuntimeDiagnosticsCoordinator;
  liveCullingSystem: {
    getDiagnostics(): Record<string, unknown>;
    isEnabled(): boolean;
    setEnabled(enabled: boolean): void;
  };
  gameHUD: HUDSystem;
  audioManager: GameAudioManager;
  gameModeManager: GameModeManager;
  engineGameModes: GameModeSystem;
  runtimeMetricsReporterRef: () => RuntimeMetricsReporter | null;
  buildRuntimeIssueSnapshot: () => Record<string, unknown>;
  physicsSystem: {
    getBodyIds(): string[];
  };
  getActiveRuntimePlayerId: () => string | null;
  syncLocalPlayerToAuthoritativeSpawn: (position: { x: number; y: number; z: number }, rotation?: { x: number; y: number; z: number }) => void;
  worldObjectAuthorityService: WorldObjectAuthorityService;
  spawnSystem: SpawnSystem;
  inventorySystem: InventorySystem;
  weaponSystem: WeaponSystem;
  undoRedoSystem: UndoRedoSystem;
  prefabSystem: PrefabSystem;
  saveLoadManager: SaveLoadManager | null;
  replaySystem: ReplaySystem;
  networkSyncSystem: NetworkSyncSystem;
  editorMenu: EditorMenu | null;
  syncEditorPrefabLibrary: () => void;
  setLastEditorSnapshot: (snapshot: unknown) => void;
  search: string;
  serverHttpUrl: string;
  serverWsUrl: string;
  launchActions: RuntimeLaunchActions;
  createUiCompositionCoordinator: () => UICompositionCoordinator | Promise<UICompositionCoordinator>;
  auxiliaryAssemblyRef: () => RuntimeAuxiliaryAssembly;
  worldRuntime: ClientWorldRuntimeCoordinator;
}

export class RuntimeOverlayCoordinator {
  private readonly config: RuntimeOverlayCoordinatorConfig;
  private scoreboard: Scoreboard | null = null;
  private scoreboardPromise: Promise<Scoreboard> | null = null;
  private netGraph: NetGraph | null = null;
  private netGraphPromise: Promise<NetGraph> | null = null;
  private hitFeedbackInstance: HitFeedback | null = null;
  private hitFeedbackPromise: Promise<HitFeedback> | null = null;
  private hitFeedbackCrosshairVisible = false;
  private uiCompositionCoordinator: UICompositionCoordinator | null = null;
  private uiCompositionCoordinatorPromise: Promise<UICompositionCoordinator> | null = null;
  private runtimeIssueInspector: RuntimeIssueInspector | null = null;
  private runtimeIssueInspectorPromise: Promise<RuntimeIssueInspector> | null = null;
  private statusMovementDebugPanel: StatusMovementDebugPanel | null = null;
  private statusMovementDebugPanelPromise: Promise<StatusMovementDebugPanel> | null = null;
  private roundPhaseBannerEl: HTMLDivElement | null = null;
  private roundPhaseBannerHideTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly roundPhaseDisposers: Array<() => void> = [];
  private deathScreenActions: DeathScreenActions | null = null;

  constructor(config: RuntimeOverlayCoordinatorConfig) {
    this.config = config;

    (gameBus as any).on('offline_return_to_main_menu_requested', () => {
      Engine.setAppState('menu');
      this.withUiCompositionCoordinator((coordinator) => {
        coordinator.show();
      }, 'offline_return_to_main_menu_requested');
    });
  }

  getScoreboardBridge() {
    return {
      show: (): void => {
        void this.ensureScoreboard().then((instance) => {
          instance.show();
        });
      },
      hide: (): void => {
        this.scoreboard?.hide();
      },
      destroy: (): void => {
        this.scoreboard?.destroy();
      },
    };
  }

  getNetGraphBridge() {
    return {
      toggle: (): void => {
        void this.ensureNetGraph().then((instance) => {
          instance.toggle();
        });
      },
      isVisible: (): boolean => this.netGraph?.isVisible() ?? false,
      update: (): void => {
        this.netGraph?.update();
      },
      destroy: (): void => {
        this.netGraph?.destroy();
      },
    };
  }

  getHitFeedbackBridge() {
    return {
      showHitMarker: (isKill: boolean): void => {
        void this.ensureHitFeedback().then((instance) => {
          instance.showHitMarker(isKill);
        });
      },
      showDamageTaken: (amount: number, options?: { direction?: 'front' | 'back' | 'left' | 'right' | null }): void => {
        void this.ensureHitFeedback().then((instance) => {
          instance.showDamageTaken(amount, options);
        });
      },
      showKillConfirm: (targetId: string): void => {
        void this.ensureHitFeedback().then((instance) => {
          instance.showKillConfirm(targetId);
        });
      },
      showDeathScreen: (killedById: string): void => {
        void this.ensureHitFeedback().then((instance) => {
          instance.showDeathScreen(killedById);
        });
      },
      setDeathActions: (actions: DeathScreenActions | null): void => {
        this.deathScreenActions = actions;
        if (this.hitFeedbackInstance) {
          this.hitFeedbackInstance.setDeathActions(actions);
        }
      },
      hideDeathScreen: (): void => {
        this.hitFeedbackInstance?.hideDeathScreen();
      },
      setCrosshairVisible: (visible: boolean): void => {
        this.hitFeedbackCrosshairVisible = visible;
        this.hitFeedbackInstance?.setCrosshairVisible(visible);
      },
      update: (dt: number): void => {
        this.hitFeedbackInstance?.update(dt);
      },
      destroy: (): void => {
        this.hitFeedbackInstance?.destroy();
      },
    };
  }

  getRuntimeIssueInspectorBridge() {
    return {
      update: (): void => {
        this.runtimeIssueInspector?.update();
      },
    };
  }

  setInGameMode(mode: 'play' | 'editor' | 'spectator'): void {
    this.withUiCompositionCoordinator((coordinator) => {
      coordinator.setInGameMode(mode);
    }, 'setInGameMode');
  }

  attachInGameModePanelClient(hosted: boolean): void {
    this.withUiCompositionCoordinator((coordinator) => {
      coordinator.attachInGameModePanelClient(hosted);
    }, 'attachInGameModePanelClient');
  }

  showServerBrowser(): void {
    this.withUiCompositionCoordinator((coordinator) => coordinator.showServerBrowser(), 'showServerBrowser');
  }

  reopenServerBrowserToList(status: string): void {
    this.withUiCompositionCoordinator(
      (coordinator) => void coordinator.reopenServerBrowserToList(status),
      'reopenServerBrowserToList',
    );
  }

  prewarmPersistedServerBrowser(): void {
    this.withUiCompositionCoordinator((coordinator) => {
      coordinator.prewarmPersistedServerBrowser();
    }, 'prewarmPersistedServerBrowser');
  }

  buildRuntimeIssueSnapshot(): Record<string, unknown> {
    return this.config.buildRuntimeIssueSnapshot();
  }

  startRuntimeUi(): void {
    this.installRoundPhaseBanner();
    void this.ensureScoreboard().then((instance) => {
      instance.hide();
    }).catch((error) => {
      console.error('[RuntimeOverlayCoordinator] Failed to preload scoreboard', error);
    });

    this.withUiCompositionCoordinator((coordinator) => {
      coordinator.startRuntimeUi(this.config.search, this.config.launchActions);
      Engine.setAppState('menu');
      // Auto-show the menu so the player sees NEXUS ENGINE immediately after the
      // TITAN bootloader fades out — no ESC press required on first load.
      coordinator.show();
    }, 'startRuntimeUi');
  }

  registerLazyBindings(): void {
    void this.ensureStatusMovementDebugPanel().catch((error) => {
      console.error('[App] Failed to load status movement debug panel', error);
    });

    void import('../../diagnostics/debug/registerMainDebugBindings')
      .then(({ registerMainDebugBindings }) => {
        registerMainDebugBindings({
          debugManager: this.config.debugManager,
          engineController: this.config.engineController,
          engineGameModes: this.config.engineGameModes,
          mpClient: this.config.mpClient,
          gameHUD: this.config.gameHUD,
          netGraph: this.getNetGraphBridge(),
          runtimeDiagnosticsCoordinator: this.config.runtimeDiagnosticsCoordinator,
          liveCullingSystem: this.config.liveCullingSystem,
          getAutoHealthChannelSync: () => this.config.auxiliaryAssemblyRef().getAutoHealthChannelSync(),
          setAutoHealthChannelSync: (enabled: boolean) => {
            this.config.auxiliaryAssemblyRef().setAutoHealthChannelSync(enabled);
          },
          syncHealthChannels: () => {
            this.config.auxiliaryAssemblyRef().syncHealthChannels();
          },
          getHealthChannelHpSummary: () => this.config.worldRuntime.getHealthChannelHpSummary(),
          getHealthChannelShieldSummary: () => this.config.worldRuntime.getHealthChannelShieldSummary(),
          getHealthChannelGasSummary: () => this.config.worldRuntime.getHealthChannelGasSummary(),
          getRuntimeReplicationSampleSummary: () => {
            const sample = this.config.runtimeMetricsReporterRef()?.getLastSample();
            if (!sample) return 'no sample';
            return `${sample.sessionId ?? 'n/a'} | WO ${sample.worldObjectCount} | VR ${sample.visibleRenderables} | ${sample.replicationUpdatesPerTick} upd/tick`;
          },
          getRuntimeReplicationCorrelationSummary: () => {
            const sample = this.config.runtimeMetricsReporterRef()?.getLastSample();
            if (!sample) return 'no sample';
            const bytesPerWorldObject = sample.worldObjectCount > 0 ? Math.round(sample.snapshotBytesPerSnapshot / sample.worldObjectCount) : null;
            const bytesPerRenderable = sample.visibleRenderables > 0 ? Math.round(sample.snapshotBytesPerSnapshot / sample.visibleRenderables) : null;
            const updatesPerActor = sample.actorReplicationCount > 0 ? (sample.replicationUpdatesPerTick / sample.actorReplicationCount).toFixed(2) : null;
            return `B/WO ${bytesPerWorldObject ?? 'n/a'} | B/VR ${bytesPerRenderable ?? 'n/a'} | Upd/Actor ${updatesPerActor ?? 'n/a'}`;
          },
          audioManager: this.config.audioManager,
          gameModeManager: this.config.gameModeManager,
        });
      })
      .catch((error) => {
        console.error('[App] Failed to load main debug bindings', error);
      });

    void import('../../diagnostics/debug/registerDeveloperConsoleCommands')
      .then(({ registerDeveloperConsoleCommands }) => {
        registerDeveloperConsoleCommands({
          spawnSystem: this.config.spawnSystem,
          worldObjectAuthorityService: this.config.worldObjectAuthorityService,
          inventorySystem: this.config.inventorySystem,
          weaponSystem: this.config.weaponSystem,
          undoRedoSystem: this.config.undoRedoSystem,
          prefabSystem: this.config.prefabSystem,
          saveLoadManager: this.config.saveLoadManager,
          setLastEditorSnapshot: this.config.setLastEditorSnapshot,
          syncEditorPrefabLibrary: this.config.syncEditorPrefabLibrary,
          getActiveRuntimePlayerId: this.config.getActiveRuntimePlayerId,
          syncLocalPlayerToAuthoritativeSpawn: this.config.syncLocalPlayerToAuthoritativeSpawn,
          editorMenu: this.config.editorMenu,
          netGraph: this.getNetGraphBridge(),
          runtimeIssueInspector: {
            toggle: () => {
              this.withRuntimeIssueInspector((inspector) => {
                inspector.toggle();
              }, 'toggleIssueInspector');
            },
          },
          buildRuntimeIssueSnapshot: this.config.buildRuntimeIssueSnapshot,
          replaySystem: this.config.replaySystem,
          getReplaySessionId: () => this.config.mpClient.roomId || `session_${Date.now()}`,
          engineGameModes: this.config.engineGameModes,
          networkSyncSystem: this.config.networkSyncSystem,
          statusMovementDebug: {
            togglePanel: () => {
              void this.ensureStatusMovementDebugPanel().then((panel) => {
                panel.toggle();
              });
            },
            getState: () => this.config.auxiliaryAssemblyRef().getStatusMovementDebugState(),
            setConfig: (patch) => this.config.auxiliaryAssemblyRef().setStatusMovementDebugConfig(patch),
            reset: () => this.config.auxiliaryAssemblyRef().resetStatusMovementDebugConfig(),
          },
        });
      })
      .catch((error) => {
        console.error('[App] Failed to load developer console commands', error);
      });
  }

  installIssueInspectorHotkey(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'F8' || this.runtimeIssueInspector) return;
      event.preventDefault();
      this.withRuntimeIssueInspector((inspector) => {
        inspector.toggle();
      }, 'issueInspectorHotkey');
    });
  }

  installValidationHook(): void {
    (window as unknown as { validateEngine?: () => Promise<unknown> }).validateEngine = () => import('../../diagnostics/debug/SystemValidator')
      .then(({ validateEngineRuntime }) => validateEngineRuntime({
        getPlayControllerBoundEntityId: () => Engine.getPlayController()?.getBoundEntityId() ?? null,
        hasEntity: (entityId: string) => !!Engine.getEntityManager()?.getEntity(entityId),
        getHudPlayerId: () => this.config.gameHUD.getPlayerId() ?? null,
        getMultiplayerPlayerId: () => this.config.mpClient.playerId || null,
        getSelectionEntityId: () => Engine.getSelectionSystem()?.getSelected() ?? null,
        clearSelection: () => Engine.getSelectionSystem()?.clearSelection(),
      }));
  }

  installMemoryValidationHook(): void {
    (window as unknown as { validateEngineMemory?: () => Promise<unknown> }).validateEngineMemory = () => import('../../diagnostics/debug/SystemValidator')
      .then(({ validateEngineMemory }) => validateEngineMemory({
        getActiveEntityIds: () => Engine.getEntityManager()?.getActiveEntityIds() ?? [],
        getEntityDiagnostics: () => Engine.getEntityManager()?.getDiagnostics() ?? null,
        getEntityLeakMetadata: (entityId: string) => Engine.getEntityManager()?.getLeakMetadata(entityId) ?? null,
        getPhysicsBodyIds: () => this.config.physicsSystem.getBodyIds(),
      }));
  }

  installStatusMovementDebugHook(): void {
    (window as unknown as {
      statusMovementDebug?: {
        getState: () => unknown;
        probe: () => Record<string, unknown>;
        setConfig: (patch: Record<string, unknown>) => unknown;
        reset: () => unknown;
        togglePanel: () => void;
      };
    }).statusMovementDebug = {
      getState: () => this.config.auxiliaryAssemblyRef().getStatusMovementDebugState(),
      probe: () => ({
        localPlayer: this.config.buildRuntimeIssueSnapshot()['localPlayer'] ?? null,
        networkSync: this.config.buildRuntimeIssueSnapshot()['networkSync'] ?? null,
        statusMovement: this.config.auxiliaryAssemblyRef().getStatusMovementDebugState(),
      }),
      setConfig: (patch) => this.config.auxiliaryAssemblyRef().setStatusMovementDebugConfig(patch),
      reset: () => this.config.auxiliaryAssemblyRef().resetStatusMovementDebugConfig(),
      togglePanel: () => {
        void this.ensureStatusMovementDebugPanel().then((panel) => {
          panel.toggle();
        });
      },
    };
  }

  destroy(): void {
    if (this.roundPhaseBannerHideTimer) {
      clearTimeout(this.roundPhaseBannerHideTimer);
      this.roundPhaseBannerHideTimer = null;
    }
    while (this.roundPhaseDisposers.length > 0) {
      this.roundPhaseDisposers.pop()?.();
    }
    this.roundPhaseBannerEl?.remove();
    this.roundPhaseBannerEl = null;
    this.scoreboard?.destroy();
    this.hitFeedbackInstance?.destroy();
    this.uiCompositionCoordinator?.destroy();
    this.netGraph?.destroy();
    this.runtimeIssueInspector?.destroy();
    this.statusMovementDebugPanel?.destroy();
  }

  private ensureScoreboard(): Promise<Scoreboard> {
    if (this.scoreboard) return Promise.resolve(this.scoreboard);
    if (!this.scoreboardPromise) {
      this.scoreboardPromise = import('../../ui/Scoreboard').then(({ Scoreboard }) => {
        const instance = new Scoreboard(Engine.getStateManagerInstance()!);
        this.scoreboard = instance;
        return instance;
      });
    }
    return this.scoreboardPromise;
  }

  private ensureNetGraph(): Promise<NetGraph> {
    if (this.netGraph) return Promise.resolve(this.netGraph);
    if (!this.netGraphPromise) {
      this.netGraphPromise = import('../../ui/NetGraph').then(({ NetGraph }) => {
        const instance = new NetGraph(() => this.config.mpClient.getDebugStats());
        this.netGraph = instance;
        return instance;
      });
    }
    return this.netGraphPromise;
  }

  private ensureHitFeedback(): Promise<HitFeedback> {
    if (this.hitFeedbackInstance) return Promise.resolve(this.hitFeedbackInstance);
    if (!this.hitFeedbackPromise) {
      this.hitFeedbackPromise = import('../../ui/HitFeedback').then(({ HitFeedback }) => {
        const instance = new HitFeedback({ enableLogging: false });
        instance.mount(Engine.getEngineCamera()!);
        instance.setCrosshairVisible(this.hitFeedbackCrosshairVisible);
        instance.setDeathActions(this.deathScreenActions);
        this.hitFeedbackInstance = instance;
        return instance;
      });
    }
    return this.hitFeedbackPromise;
  }

  private ensureUiCompositionCoordinator(): Promise<UICompositionCoordinator> {
    if (this.uiCompositionCoordinator) {
      return Promise.resolve(this.uiCompositionCoordinator);
    }
    // Cache the in-flight promise so concurrent callers (e.g. prewarmPersistedServerBrowser
    // and startRuntimeUi both called synchronously from bootstrapRuntime) share a single
    // instantiation and never produce two coordinators, two DOM trees, or two keyboard handlers.
    if (!this.uiCompositionCoordinatorPromise) {
      this.uiCompositionCoordinatorPromise = Promise.resolve(this.config.createUiCompositionCoordinator())
        .then((coordinator) => {
          this.uiCompositionCoordinator = coordinator;
          this.uiCompositionCoordinatorPromise = null;
          this.config.engineController.registerSystems({ mainMenu: coordinator });
          return coordinator;
        })
        .catch((error) => {
          this.uiCompositionCoordinatorPromise = null;
          throw error;
        });
    }
    return this.uiCompositionCoordinatorPromise;
  }

  private ensureRuntimeIssueInspector(): Promise<RuntimeIssueInspector> {
    if (this.runtimeIssueInspector) {
      return Promise.resolve(this.runtimeIssueInspector);
    }
    if (!this.runtimeIssueInspectorPromise) {
      this.runtimeIssueInspectorPromise = import('../../ui/RuntimeIssueInspector')
        .then(({ RuntimeIssueInspector }) => {
          const inspector = new RuntimeIssueInspector({
            hotkey: 'F8',
            getSnapshot: this.config.buildRuntimeIssueSnapshot,
          });
          this.runtimeIssueInspector = inspector;
          return inspector;
        })
        .catch((error) => {
          this.runtimeIssueInspectorPromise = null;
          throw error;
        });
    }
    return this.runtimeIssueInspectorPromise;
  }

  private ensureStatusMovementDebugPanel(): Promise<StatusMovementDebugPanel> {
    if (this.statusMovementDebugPanel) {
      return Promise.resolve(this.statusMovementDebugPanel);
    }
    if (!this.statusMovementDebugPanelPromise) {
      this.statusMovementDebugPanelPromise = import('../../diagnostics/debug/StatusMovementDebugPanel')
        .then(({ StatusMovementDebugPanel }) => {
          const panel = new StatusMovementDebugPanel({
            getState: () => this.config.auxiliaryAssemblyRef().getStatusMovementDebugState(),
            setConfig: (patch) => this.config.auxiliaryAssemblyRef().setStatusMovementDebugConfig(patch),
            reset: () => this.config.auxiliaryAssemblyRef().resetStatusMovementDebugConfig(),
          });
          this.statusMovementDebugPanel = panel;
          return panel;
        })
        .catch((error) => {
          this.statusMovementDebugPanelPromise = null;
          throw error;
        });
    }
    return this.statusMovementDebugPanelPromise;
  }

  private withUiCompositionCoordinator(
    action: (coordinator: UICompositionCoordinator) => void | Promise<void>,
    context: string,
  ): void {
    void this.ensureUiCompositionCoordinator()
      .then(action)
      .catch((error) => {
        console.error(`[App] Failed to load UICompositionCoordinator during ${context}`, error);
      });
  }

  private withRuntimeIssueInspector(
    action: (inspector: RuntimeIssueInspector) => void | Promise<void>,
    context: string,
  ): void {
    void this.ensureRuntimeIssueInspector()
      .then(action)
      .catch((error) => {
        console.error(`[App] Failed to load RuntimeIssueInspector during ${context}`, error);
      });
  }

  private installRoundPhaseBanner(): void {
    if (typeof document === 'undefined' || this.roundPhaseBannerEl) return;

    const banner = document.createElement('div');
    banner.style.position = 'fixed';
    banner.style.top = '18%';
    banner.style.left = '50%';
    banner.style.transform = 'translate(-50%, -12px)';
    banner.style.padding = '14px 24px';
    banner.style.border = '1px solid rgba(255, 255, 255, 0.55)';
    banner.style.background = 'rgba(18, 24, 30, 0.72)';
    banner.style.backdropFilter = 'blur(10px)';
    banner.style.color = '#f3efe2';
    banner.style.fontFamily = 'Georgia, Times New Roman, serif';
    banner.style.fontSize = '30px';
    banner.style.letterSpacing = '0.18em';
    banner.style.textTransform = 'uppercase';
    banner.style.textShadow = '0 0 18px rgba(255, 240, 180, 0.35)';
    banner.style.opacity = '0';
    banner.style.pointerEvents = 'none';
    banner.style.transition = 'opacity 140ms ease, transform 140ms ease';
    banner.style.zIndex = '2147483646';
    document.body.appendChild(banner);
    this.roundPhaseBannerEl = banner;

    const onRoundPhaseChanged = ({ nextPhase }: { nextPhase: string }): void => {
      if (nextPhase === 'starting') {
        this.showRoundPhaseBanner('GAME START');
      } else if (nextPhase === 'round_end') {
        this.showRoundPhaseBanner('ROUND OVER');
      }
    };

    this.config.gameModeManager.on('round_phase_changed', onRoundPhaseChanged);
    this.roundPhaseDisposers.push(() => {
      this.config.gameModeManager.off('round_phase_changed', onRoundPhaseChanged);
    });
  }

  private showRoundPhaseBanner(message: string): void {
    if (!this.roundPhaseBannerEl) return;
    this.roundPhaseBannerEl.textContent = message;
    this.roundPhaseBannerEl.style.opacity = '1';
    this.roundPhaseBannerEl.style.transform = 'translate(-50%, 0)';
    if (this.roundPhaseBannerHideTimer) {
      clearTimeout(this.roundPhaseBannerHideTimer);
    }
    this.roundPhaseBannerHideTimer = setTimeout(() => {
      if (!this.roundPhaseBannerEl) return;
      this.roundPhaseBannerEl.style.opacity = '0';
      this.roundPhaseBannerEl.style.transform = 'translate(-50%, -12px)';
      this.roundPhaseBannerHideTimer = null;
    }, 1700);
  }
}
