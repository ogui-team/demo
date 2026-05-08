import * as THREE from 'three';
import * as Engine from '../../0-foundation/foundation/Engine';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { getRuntimePerformanceMode, RuntimePerformanceMode } from '@engine/1-kernel/core/public-api';
import type { MultiplayerClient } from '../../3-network/network/MultiplayerClient';
import type { MovementAuthorityDebugState, NetworkMovementIntent, NetworkSyncSystem } from '../../3-network/network/NetworkSyncSystem';
import { DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG, type MovementFeelDebugConfig, type ResolvedMovementTuningConfig } from '../../3-network/network/MovementTuningConfig';
import type { GameModeManager } from '../../2-systems/gameplay/game/GameModeManager';
import type { GameModeSystem } from '../../2-systems/gameplay/game/GameModeSystem';
import type { PlayerModelSystem } from '../../2-systems/gameplay/game/PlayerModelSystem';
import type { ViewModelSystem } from '../../2-systems/gameplay/game/ViewModelSystem';
import type { WeaponPresentationSystem } from '../../2-systems/gameplay/game/WeaponPresentationSystem';
import type { CharacterActorSystem } from '../../2-systems/gameplay/game/CharacterActorSystem';
import type { RuntimeDiagnosticsCoordinator } from '../diagnostics/debug/RuntimeDiagnosticsCoordinator';
import type { RuntimeMetricsReporter } from '../diagnostics/debug/RuntimeMetricsReporter';
import type { HUDSystem } from '../../2-systems/gameplay/systems/HUDSystem';
import type { HealthSystem } from '../../2-systems/gameplay/systems/HealthSystem';
import type { WeaponSystem } from '../../2-systems/gameplay/systems/WeaponSystem';
import type { InventorySystem } from '../../2-systems/gameplay/systems/InventorySystem';
import type { PrefabSystem } from '../../2-systems/gameplay/systems/PrefabSystem';
import type { AdaptiveRuntimeLayer } from '../../2-systems/gameplay/systems/AdaptiveRuntimeLayer';
import type { GameAudioManager } from '../../2-systems/gameplay/systems/GameAudioManager';
import type { AudioSystem } from '../../2-systems/gameplay/systems/AudioSystem';
import type { HordeSystem } from '../../2-systems/gameplay/systems/HordeSystem';
import type { PathfindingSystem } from '../../2-systems/gameplay/systems/PathfindingSystem';
import type { VFXSystem } from '../../2-systems/gameplay/systems/VFXSystem';
import type { VFXMaker } from '../../2-systems/gameplay/systems/VFXMaker';
import type { AbilityMovementIntent, AbilitySystem } from '../../2-systems/gameplay/systems/gas/AbilitySystem';
import type { StateManager } from '../../0-foundation/foundation/state/StateManager';
import type { ReplaySystem } from '../../1-kernel/core/ReplaySystem';
import type { SpatialGridSystem } from '../../2-systems/gameplay/systems/SpatialGridSystem';
import type { VisibilitySystem } from '../../2-systems/gameplay/systems/VisibilitySystem';
import type { ClientWorldRuntimeCoordinator } from './coordinators/ClientWorldRuntimeCoordinator';
import type { MultiplayerRuntimeCoordinator } from './coordinators/MultiplayerRuntimeCoordinator';
import type { StatusMovementModifier } from '../../3-network/network/MovementModifierContracts';
import type { TitanContentPipeline } from '../content/TitanContentPipeline';
import { RuntimeEventQueue } from './RuntimeEventQueue';
import { RuntimeSimulationDirector } from './RuntimeSimulationDirector';
import { HordeEncounterRuntime } from './HordeEncounterRuntime';
import { DriftBombLocalController } from '../gameplay/modes/DriftBombLocalController';
import { RuntimeDeterminismTrace } from './RuntimeDeterminismTrace';
import type { IChunkRuntimeView, ISpatialRuntimeView } from './RuntimeSimulationContracts';

interface UpdatableBridge {
  update(dt: number): void;
}

interface NetGraphBridge extends UpdatableBridge {
  toggle(): void;
  isVisible(): boolean;
  destroy(): void;
}

interface HitFeedbackBridge extends UpdatableBridge {
  showHitMarker(isKill: boolean): void;
  showDamageTaken(amount: number, options?: { direction?: 'front' | 'back' | 'left' | 'right' | null }): void;
  showKillConfirm(targetId: string): void;
  showDeathScreen(killedById: string): void;
  setDeathActions(actions: { onRespawnWaveOne?: () => void; onMainMenu?: () => void } | null): void;
  hideDeathScreen(): void;
  destroy(): void;
}

interface RuntimeIssueInspectorBridge {
  update(): void;
}

interface RuntimeAuxiliaryAssemblyConfig {
  engineController: { registerSystems(systems: unknown): void };
  stateManager: StateManager;
  replaySystem: ReplaySystem;
  mpClient: MultiplayerClient;
  networkSyncSystem: NetworkSyncSystem;
  gameHUD: HUDSystem;
  gameModeManager: GameModeManager;
  engineGameModes: GameModeSystem;
  playerModelSystem: PlayerModelSystem;
  viewModelSystem: ViewModelSystem;
  weaponPresentationSystem: WeaponPresentationSystem;
  characterActorSystem: CharacterActorSystem;
  runtimeDiagnosticsCoordinator: RuntimeDiagnosticsCoordinator;
  worldRuntime: ClientWorldRuntimeCoordinator;
  multiplayerRuntime: MultiplayerRuntimeCoordinator;
  healthSystem: HealthSystem;
  weaponSystem: WeaponSystem;
  inventorySystem: InventorySystem;
  prefabSystem: PrefabSystem;
  adaptiveRuntime: AdaptiveRuntimeLayer;
  audioManager: GameAudioManager;
  audioSystem: AudioSystem;
  vfxMaker: VFXMaker;
  vfxSystem: VFXSystem;
  abilitySystem: AbilitySystem;
  hordeSystem: HordeSystem;
  pathfindingSystem: PathfindingSystem;
  spatialGridSystem: SpatialGridSystem;
  visibilitySystem: VisibilitySystem;
  contentPipeline: TitanContentPipeline | null;
  getFocusPosition: () => { x: number; y: number; z: number } | null;
  netGraphBridge: NetGraphBridge;
  hitFeedbackBridge: HitFeedbackBridge;
  runtimeIssueInspectorBridge: RuntimeIssueInspectorBridge;
  runtimeMetricsReporterRef: () => RuntimeMetricsReporter | null;
  worldObjectAuthorityDiagnostics: () => Record<string, unknown>;
  spriteSystems: Record<string, UpdatableBridge>;
}

interface StatusMovementDebugConfig {
  rooted: boolean;
  chilled: boolean;
  electrocuted: boolean;
  speedMultiplier: number;
  impulseMagnitude: number;
  feelSpeedMultiplier: number;
  feelAccelerationMultiplier: number;
  feelFrictionMultiplier: number;
  feelFloatiness: number;
  feelAirControlEnabled: boolean;
  networkSimulation: boolean;
  logEachFrame: boolean;
}

export interface MovementFeelDebugState {
  authorityLabel: string;
  live: ResolvedMovementTuningConfig | null;
  hasDebugOverride: boolean;
  hooks: {
    jumpPrepared: boolean;
    sprintPrepared: boolean;
    airControlPrepared: boolean;
    jumpRequested: boolean;
    sprintRequested: boolean;
    airborne: boolean;
    airControlEnabled: boolean;
    lastJumpImpulse: number;
  } | null;
}

interface StatusMovementDebugSourceState {
  playerId: string | null;
  entityId: string | null;
  networkEntityId: string | null;
  currentPosition: { x: number; y: number; z: number } | null;
  movementIntent: NetworkMovementIntent | null;
  statusMovementModifier: StatusMovementModifier | null;
  derivedStatusMovementModifier: StatusMovementModifier | null;
  debugStatusMovementModifier: StatusMovementModifier | null;
  effectiveStatusMovementModifier: StatusMovementModifier | null;
}

const OFFLINE_LOCAL_PLAYER_ID = 'local_freeplay_player';

export interface ResolvedDebugMovementState {
  playerId: string;
  entityId: string;
  networkEntityId: string;
  movementDelta: number;
  hasMovementDelta: boolean;
  authoritative: StatusMovementModifier;
  local: StatusMovementModifier;
  debug: StatusMovementModifier;
  resolved: StatusMovementModifier;
  hasAuthoritative: boolean;
  hasLocal: boolean;
  hasDebug: boolean;
  hasResolved: boolean;
  movementIntent: NetworkMovementIntent | Record<string, never>;
  hasMovementIntent: boolean;
}

export interface StatusMovementDebugState {
  config: StatusMovementDebugConfig;
  mode: 'disabled' | 'local' | 'authoritative';
  connected: boolean;
  gameplayActive: boolean;
  selectedPlayerId: string;
  movementFeel: MovementFeelDebugState;
  players: ResolvedDebugMovementState[];
}

export class RuntimeAuxiliaryAssembly {
  private readonly engineController: { registerSystems(systems: unknown): void };
  private readonly stateManager: StateManager;
  private readonly mpClient: MultiplayerClient;
  private readonly networkSyncSystem: NetworkSyncSystem;
  private readonly gameHUD: HUDSystem;
  private readonly gameModeManager: GameModeManager;
  private readonly engineGameModes: GameModeSystem;
  private readonly playerModelSystem: PlayerModelSystem;
  private readonly viewModelSystem: ViewModelSystem;
  private readonly weaponPresentationSystem: WeaponPresentationSystem;
  private readonly characterActorSystem: CharacterActorSystem;
  private readonly runtimeDiagnosticsCoordinator: RuntimeDiagnosticsCoordinator;
  private readonly worldRuntime: ClientWorldRuntimeCoordinator;
  private readonly multiplayerRuntime: MultiplayerRuntimeCoordinator;
  private readonly healthSystem: HealthSystem;
  private readonly weaponSystem: WeaponSystem;
  private readonly inventorySystem: InventorySystem;
  private readonly prefabSystem: PrefabSystem;
  private readonly adaptiveRuntime: AdaptiveRuntimeLayer;
  private readonly audioManager: GameAudioManager;
  private readonly audioSystem: AudioSystem;
  private readonly vfxMaker: VFXMaker;
  private readonly vfxSystem: VFXSystem;
  private readonly abilitySystem: AbilitySystem;
  private readonly hordeSystem: HordeSystem;
  private readonly pathfindingSystem: PathfindingSystem;
  private readonly runtimeEventQueue: RuntimeEventQueue;
  private readonly runtimeSimulationDirector: RuntimeSimulationDirector;
  private readonly runtimeDeterminismTrace: RuntimeDeterminismTrace;
  private readonly netGraphBridge: NetGraphBridge;
  private readonly hitFeedbackBridge: HitFeedbackBridge;
  private readonly runtimeIssueInspectorBridge: RuntimeIssueInspectorBridge;
  private readonly runtimeMetricsReporterRef: () => RuntimeMetricsReporter | null;
  private readonly worldObjectAuthorityDiagnostics: () => Record<string, unknown>;
  private readonly spriteSystems: Record<string, UpdatableBridge>;

  private driftBombController: DriftBombLocalController | null = null;
  private combatEnabled = false;
  private gameplayRuntimeActive = false;
  private autoHealthChannelSync = true;
  private gameplayDiagnosticsAccumulator = 0;
  private lastWeaponDiagnosticsWriteAt = 0;
  private audioUpdateAccumulator = 0;
  private hudSyncAccumulator = 0;
  private lastHudEntityCount = -1;
  private serverStatusAccumulator = 0;
  private offlineRespawnTimeoutId: number | null = null;
  private readonly statusMovementDebugConfig: StatusMovementDebugConfig = {
    rooted: false,
    chilled: false,
    electrocuted: false,
    speedMultiplier: 0.5,
    impulseMagnitude: 0,
    feelSpeedMultiplier: DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.speedMultiplier,
    feelAccelerationMultiplier: DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.accelerationMultiplier,
    feelFrictionMultiplier: DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.frictionMultiplier,
    feelFloatiness: DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.floatiness,
    feelAirControlEnabled: DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.airControlEnabled,
    networkSimulation: false,
    logEachFrame: true,
  };
  private statusMovementTrackedPlayerId: string | null = null;
  private statusMovementDebugLastNetworkSignature: string | null = null;
  private statusMovementDebugSnapshot: StatusMovementDebugState = this.createEmptyStatusMovementDebugState();
  private readonly statusMovementDebugLastPositions = new Map<string, { x: number; y: number; z: number }>();

  // ── Reusable per-frame collections (avoid GC pressure) ────────────────
  private readonly _entityPositions = new Map<string, { x: number; y: number; z: number }>();
  private readonly _playerIds = new Set<string>();
  private readonly _hudPlayerScratch: Array<{ name: string; hp: number }> = [];
  private readonly _audioEntityPositions = new Map<string, { x: number; y: number; z: number }>();

  constructor(config: RuntimeAuxiliaryAssemblyConfig) {
    this.engineController = config.engineController;
    this.stateManager = config.stateManager;
    this.mpClient = config.mpClient;
    this.networkSyncSystem = config.networkSyncSystem;
    this.gameHUD = config.gameHUD;
    this.gameModeManager = config.gameModeManager;
    this.engineGameModes = config.engineGameModes;
    this.playerModelSystem = config.playerModelSystem;
    this.viewModelSystem = config.viewModelSystem;
    this.weaponPresentationSystem = config.weaponPresentationSystem;
    this.characterActorSystem = config.characterActorSystem;
    this.runtimeDiagnosticsCoordinator = config.runtimeDiagnosticsCoordinator;
    this.worldRuntime = config.worldRuntime;
    this.multiplayerRuntime = config.multiplayerRuntime;
    this.healthSystem = config.healthSystem;
    this.weaponSystem = config.weaponSystem;
    this.inventorySystem = config.inventorySystem;
    this.prefabSystem = config.prefabSystem;
    this.adaptiveRuntime = config.adaptiveRuntime;
    this.audioManager = config.audioManager;
    this.audioSystem = config.audioSystem;
    this.vfxMaker = config.vfxMaker;
    this.vfxSystem = config.vfxSystem;
    this.abilitySystem = config.abilitySystem;
    this.hordeSystem = config.hordeSystem;
    this.pathfindingSystem = config.pathfindingSystem;
    this.runtimeEventQueue = new RuntimeEventQueue();
    this.runtimeDeterminismTrace = new RuntimeDeterminismTrace(config.replaySystem);
    const spatialRuntimeView: ISpatialRuntimeView = {
      getFocusPosition: () => {
        const focusPosition = config.getFocusPosition();
        return focusPosition ? { x: focusPosition.x, y: focusPosition.y, z: focusPosition.z } : null;
      },
      getFocusCellId: () => {
        const focusPosition = config.getFocusPosition();
        return focusPosition
          ? config.spatialGridSystem.getCellFromWorldPosition(focusPosition.x, focusPosition.z)
          : null;
      },
      forEachCell: (visitor) => {
        for (const cell of config.spatialGridSystem.getCells()) {
          visitor({
            id: cell.id,
            bounds: cell.bounds,
            visible: cell.visible,
            active: cell.active,
          });
        }
      },
    };
    const chunkRuntimeView = (config.contentPipeline as IChunkRuntimeView | null) ?? null;
    this.runtimeSimulationDirector = new RuntimeSimulationDirector({
      spatialRuntimeView,
      chunkRuntimeView,
      encounterRuntime: new HordeEncounterRuntime(config.hordeSystem),
      runtimeEventSink: this.runtimeEventQueue,
      runtimeTrace: this.runtimeDeterminismTrace,
    });
    config.contentPipeline?.setRuntimeEventSink(this.runtimeEventQueue);
    config.contentPipeline?.setRuntimeDeterminismTraceSink(this.runtimeDeterminismTrace);
    this.netGraphBridge = config.netGraphBridge;
    this.hitFeedbackBridge = config.hitFeedbackBridge;
    this.runtimeIssueInspectorBridge = config.runtimeIssueInspectorBridge;
    this.runtimeMetricsReporterRef = config.runtimeMetricsReporterRef;
    this.worldObjectAuthorityDiagnostics = config.worldObjectAuthorityDiagnostics;
    this.spriteSystems = config.spriteSystems;

    this.configureOfflineDeathFlow();
      this.driftBombController = new DriftBombLocalController({
        engineGameModes: config.engineGameModes,
        stateManager: config.stateManager,
        gameHUD: config.gameHUD,
        localPlayerId: OFFLINE_LOCAL_PLAYER_ID,
      });
  }

  getAutoHealthChannelSync(): boolean {
    return this.autoHealthChannelSync;
  }

  setAutoHealthChannelSync(enabled: boolean): void {
    this.autoHealthChannelSync = enabled;
  }

  setStatusMovementDebugConfig(patch: Partial<StatusMovementDebugConfig>): StatusMovementDebugState {
    if (typeof patch.rooted === 'boolean') this.statusMovementDebugConfig.rooted = patch.rooted;
    if (typeof patch.chilled === 'boolean') this.statusMovementDebugConfig.chilled = patch.chilled;
    if (typeof patch.electrocuted === 'boolean') this.statusMovementDebugConfig.electrocuted = patch.electrocuted;
    if (typeof patch.networkSimulation === 'boolean') this.statusMovementDebugConfig.networkSimulation = patch.networkSimulation;
    if (typeof patch.logEachFrame === 'boolean') this.statusMovementDebugConfig.logEachFrame = patch.logEachFrame;
    if (typeof patch.speedMultiplier === 'number' && Number.isFinite(patch.speedMultiplier)) {
      this.statusMovementDebugConfig.speedMultiplier = THREE.MathUtils.clamp(patch.speedMultiplier, 0, 1);
    }
    if (typeof patch.impulseMagnitude === 'number' && Number.isFinite(patch.impulseMagnitude)) {
      this.statusMovementDebugConfig.impulseMagnitude = Math.max(0, patch.impulseMagnitude);
    }
    if (typeof patch.feelSpeedMultiplier === 'number' && Number.isFinite(patch.feelSpeedMultiplier)) {
      this.statusMovementDebugConfig.feelSpeedMultiplier = patch.feelSpeedMultiplier;
    }
    if (typeof patch.feelAccelerationMultiplier === 'number' && Number.isFinite(patch.feelAccelerationMultiplier)) {
      this.statusMovementDebugConfig.feelAccelerationMultiplier = patch.feelAccelerationMultiplier;
    }
    if (typeof patch.feelFrictionMultiplier === 'number' && Number.isFinite(patch.feelFrictionMultiplier)) {
      this.statusMovementDebugConfig.feelFrictionMultiplier = patch.feelFrictionMultiplier;
    }
    if (typeof patch.feelFloatiness === 'number' && Number.isFinite(patch.feelFloatiness)) {
      this.statusMovementDebugConfig.feelFloatiness = patch.feelFloatiness;
    }
    if (typeof patch.feelAirControlEnabled === 'boolean') {
      this.statusMovementDebugConfig.feelAirControlEnabled = patch.feelAirControlEnabled;
    }
    this.flushStatusMovementDebugState();
    return this.getStatusMovementDebugState();
  }

  resetStatusMovementDebugConfig(): StatusMovementDebugState {
    this.statusMovementDebugConfig.rooted = false;
    this.statusMovementDebugConfig.chilled = false;
    this.statusMovementDebugConfig.electrocuted = false;
    this.statusMovementDebugConfig.speedMultiplier = 0.5;
    this.statusMovementDebugConfig.impulseMagnitude = 0;
    this.statusMovementDebugConfig.feelSpeedMultiplier = DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.speedMultiplier;
    this.statusMovementDebugConfig.feelAccelerationMultiplier = DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.accelerationMultiplier;
    this.statusMovementDebugConfig.feelFrictionMultiplier = DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.frictionMultiplier;
    this.statusMovementDebugConfig.feelFloatiness = DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.floatiness;
    this.statusMovementDebugConfig.feelAirControlEnabled = DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.airControlEnabled;
    this.statusMovementDebugConfig.networkSimulation = false;
    this.statusMovementDebugConfig.logEachFrame = true;
    this.flushStatusMovementDebugState();
    return this.getStatusMovementDebugState();
  }

  getStatusMovementDebugState(): StatusMovementDebugState {
    if (!this.statusMovementDebugSnapshot) {
      this.statusMovementDebugSnapshot = this.buildStatusMovementDebugState(this.worldRuntime.getActiveRuntimePlayerId());
    }
    return this.statusMovementDebugSnapshot;
  }

  syncHealthChannels(): void {
    this.worldRuntime.syncActiveHealthChannels();
  }

  enableCombat(): void {
    console.warn('[RuntimeAuxiliaryAssembly] Direct combat enabling is deprecated. EngineController owns gameplay activation.');
    this.combatEnabled = true;
  }

  disableCombat(): void {
    console.warn('[RuntimeAuxiliaryAssembly] Direct combat disabling is deprecated. EngineController owns gameplay activation.');
    this.combatEnabled = false;
  }

  enableGameplayRuntime(): void {
    this.gameplayRuntimeActive = true;
  }

  disableGameplayRuntime(): void {
    this.gameplayRuntimeActive = false;
    this.runtimeSimulationDirector.resetRuntimeState();
  }

  register(kernelMovementIntegration: any): void {
    this.configureWeaponPresentation();
    this.configureToolbar();
    this.configureCombatResolvers();
    this.configureAbilityMovementIntegration();

    const systemContext = Engine.getSystemContext();
    if (systemContext) {
      this.runtimeEventQueue.setSystemContext(systemContext);
      this.runtimeSimulationDirector.setSystemContext(systemContext);
    }

    const combatSystem = this.createCombatSystem();
    Engine.getInputRouter()?.setCombatSystem(combatSystem);

    this.engineController.registerSystems({
      gameplayRuntime: {
        enable: () => this.enableGameplayRuntime(),
        disable: () => this.disableGameplayRuntime(),
        update: (dt: number) => this.updateGameplaySystems(dt),
      },
      gameModeSystem: this.engineGameModes,
      auxiliarySystems: {
        runtimeEventQueue: {
          update: (dt: number) => this.runtimeEventQueue.update(dt),
          getDebugState: () => this.runtimeEventQueue.getDebugState(),
        },
        runtimeSimulationDirector: {
          update: () => undefined,
          getDebugState: () => this.runtimeSimulationDirector.getDebugState(),
        },
        runtimeDeterminismTrace: {
          update: () => undefined,
          getDebugState: () => this.runtimeDeterminismTrace.getDebugState(),
        },
        // ─ v0.1.5: DOD Kernel integration - advance kernel simulation each frame ─
        kernelTick: { update: (dt: number) => kernelMovementIntegration.tick(dt) },
        pathfindingSystem: { update: (dt: number) => this.pathfindingSystem.update(dt) },
        dummyEnemySystem: { update: (dt: number) => kernelMovementIntegration.getDummyEnemySystem().update(dt) },
        weaponOversight: { update: () => this.updateWeaponOversight() },
        playerModelSystem: { update: (dt: number) => this.updatePlayerModelSystem(dt) },
        serverStatusMonitor: { update: (dt: number) => this.updateServerStatusMonitor(dt) },
        characterActorSystem: { update: (dt: number) => this.updateCharacterSystems(dt) },
        hudSystem: { update: (dt: number) => this.updateHud(dt) },
        hitFeedback: this.hitFeedbackBridge,
        netGraph: { update: () => { if (this.netGraphBridge.isVisible()) this.netGraphBridge.update(0); } },
        multiplayerInput: { update: (dt: number) => this.multiplayerRuntime.updateInput(dt) },
        runtimeIssueInspector: { update: () => { if (getRuntimePerformanceMode() === RuntimePerformanceMode.DEV) this.runtimeIssueInspectorBridge.update(); } },
        fireballViewModel: { update: (dt: number) => this.viewModelSystem.update(dt) },
        weaponPresentation: { update: (dt: number) => this.weaponPresentationSystem.update(dt) },
        vfxMaker: this.vfxMaker,
        vfxSystem: { update: (dt: number) => this.updateVfx(dt) },
        audioSystem: { update: (dt: number) => this.audioSystem.update(dt) },
        gameAudio: { update: (dt: number) => this.updateAudio(dt) },
        // MILESTONE 3: Camera sync as Order 99 (last), after kernel physics update completes
        // This ensures camera reads the latest position from the kernel WriteBuffer
        localCamera: { update: () => this.updateLocalCamera() },
        ...this.spriteSystems,
      },
      combatSystem,
    });
  }

  private configureOfflineDeathFlow(): void {
    this.hitFeedbackBridge.setDeathActions({
      onRespawnWaveOne: () => this.handleOfflineRespawnWaveOneRequest(),
      onMainMenu: () => this.handleOfflineReturnToMainMenuRequest(),
    });

    this.healthSystem.onDeath((event) => {
      this.handleOfflineLocalPlayerDeath(event);
    });

    (gameBus as any).on('LOCAL_PLAYER_ACTUALIZED', ({ playerId }: { playerId?: string | null }) => {
      const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
      if (!playerId || !runtimePlayerId || playerId !== runtimePlayerId) {
        return;
      }

      if (this.offlineRespawnTimeoutId !== null) {
        window.clearTimeout(this.offlineRespawnTimeoutId);
        this.offlineRespawnTimeoutId = null;
      }

      this.hitFeedbackBridge.hideDeathScreen();
      this.multiplayerRuntime.startInputSending();
    });
  }

  private handleOfflineLocalPlayerDeath(event: { entityId: string; killedBy?: string }): void {
    if (this.mpClient.connected) {
      return;
    }

    const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
    if (!runtimePlayerId || event.entityId !== runtimePlayerId) {
      return;
    }

    const bootstrap = this.worldRuntime.getLocalPlayerBootstrapCoordinator();
    if (bootstrap.isLocalPlayerDead()) {
      return;
    }

    bootstrap.setLocalPlayerDead(true);
    this.multiplayerRuntime.stopInputSending();
    Engine.getPlayController()?.reset();
    Engine.getPlayController()?.bind(null);

    this.hitFeedbackBridge.showDeathScreen(event.killedBy ?? 'THE HORDE');
  }

  private handleOfflineRespawnWaveOneRequest(): void {
    if (this.mpClient.connected) {
      return;
    }

    const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
    if (!runtimePlayerId) {
      return;
    }

    if (this.offlineRespawnTimeoutId !== null) {
      window.clearTimeout(this.offlineRespawnTimeoutId);
      this.offlineRespawnTimeoutId = null;
    }

    if (this.stateManager.getRaw('game.mode') === 'horde') {
      this.hordeSystem.restartFromWaveOne();
    }

    this.worldRuntime.getLocalPlayerBootstrapCoordinator().setLocalPlayerDead(false);
    this.hitFeedbackBridge.hideDeathScreen();
    this.engineGameModes.notifyPlayerDeath(runtimePlayerId, 'THE HORDE');
    this.multiplayerRuntime.startInputSending();
  }

  private handleOfflineReturnToMainMenuRequest(): void {
    if (this.mpClient.connected) {
      return;
    }

    if (this.offlineRespawnTimeoutId !== null) {
      window.clearTimeout(this.offlineRespawnTimeoutId);
      this.offlineRespawnTimeoutId = null;
    }

    this.worldRuntime.getLocalPlayerBootstrapCoordinator().setLocalPlayerDead(false);
    this.hitFeedbackBridge.hideDeathScreen();
    this.multiplayerRuntime.stopInputSending();
    (gameBus as any).emit('offline_return_to_main_menu_requested');
  }

  private configureWeaponPresentation(): void {
    this.weaponSystem.onFire((event) => {
      this.weaponPresentationSystem.handleFire(event);
    });

    this.healthSystem.onDamage((event) => {
      const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
      if (!runtimePlayerId || event.targetId !== runtimePlayerId) {
        return;
      }

      const sourcePosition = this.resolveDamageSourcePosition(event.sourceId);
      const direction = sourcePosition ? this.resolveDamageDirection(sourcePosition) : null;
      this.hitFeedbackBridge.showDamageTaken(event.effectiveDamage, { direction });
    });

    this.weaponSystem.onHit((event) => {
      this.weaponPresentationSystem.handleImpact(event);
      if (event.damage <= 0) {
        return;
      }
      const targetPlayer = this.gameModeManager.getPlayer(event.targetId);
      if (targetPlayer && event.targetId !== this.worldRuntime.getActiveRuntimePlayerId() && this.mpClient.connected) {
        this.hitFeedbackBridge.showHitMarker(false);
      } else if (!targetPlayer && event.targetId) {
        // Hit an NPC/enemy — show hit marker in offline/horde mode too.
        this.hitFeedbackBridge.showHitMarker(false);
      }
    });

    // Show kill confirm when a dummy enemy is destroyed (pistol / shotgun kills in horde).
    (gameBus as any).on('DUMMY_DIED', (event: any) => {
      this.hitFeedbackBridge.showKillConfirm(event?.handle?.toString?.() ?? 'enemy');
    });

    (gameBus as any).on('ENTITY_HIT', (event: any) => {
      if (event?.abilityId !== 'ability_fireball') {
        return;
      }
      if (event.sourceId !== this.worldRuntime.getActiveRuntimePlayerId()) {
        return;
      }
      this.hitFeedbackBridge.showHitMarker(Boolean(event.killed));
    });

    (gameBus as any).on('ENTITY_KILLED', (event: any) => {
      if (event?.abilityId !== 'ability_fireball') {
        return;
      }
      if (event.killedBy !== this.worldRuntime.getActiveRuntimePlayerId()) {
        return;
      }
      this.hitFeedbackBridge.showKillConfirm(event.targetId);
    });
  }

  private configureToolbar(): void {
    const toolbarSystem = Engine.getToolbarSystem();
    if (!toolbarSystem) return;

    toolbarSystem.onActiveSlotChange((slot) => {
      const runtimeId = this.worldRuntime.getActiveRuntimePlayerId();
      if (!runtimeId) return;
      const combatKey = this.resolveToolbarCombatKey(slot.itemId);
      if (!combatKey) return;
      this.weaponSystem.equip(runtimeId, combatKey);
    });

    toolbarSystem.setCooldownProvider((slot) => {
      if (slot.itemId !== 'debug_fireball') return 0;
      const runtimeId = this.worldRuntime.getActiveRuntimePlayerId();
      if (!runtimeId) return 0;
      return this.abilitySystem.getCooldownFraction(runtimeId, 'ability_fireball');
    });
  }

  private configureCombatResolvers(): void {
    this.weaponSystem.setFireContextResolver((playerId) => {
      if (playerId !== this.worldRuntime.getActiveRuntimePlayerId()) return null;
      const camera = Engine.getEngineCamera();
      if (!camera) return null;
      const forward = camera.getWorldDirection(new THREE.Vector3()).normalize();
      return {
        origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        direction: { x: forward.x, y: forward.y, z: forward.z },
        layerMask: ['player', 'world', 'environment'],
      };
    });

    this.weaponSystem.setHitscanResolver((playerId, _weaponId, origin, direction, range) => {
      if (playerId !== this.worldRuntime.getActiveRuntimePlayerId()) return null;

      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(origin.x, origin.y, origin.z),
        new THREE.Vector3(direction.x, direction.y, direction.z).normalize(),
        0,
        range,
      );

      const targets: THREE.Object3D[] = [];
      Engine.getEngineScene()?.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const stampedPlayerId = object.userData.playerId ?? object.parent?.userData?.playerId;
        if (stampedPlayerId === this.worldRuntime.getActiveRuntimePlayerId()) return;
        targets.push(object);
      });

      const intersections = raycaster.intersectObjects(targets, true);
      for (const hit of intersections) {
        const entityId = this.resolveCombatTargetId(hit.object);
        if (!entityId || entityId === this.worldRuntime.getActiveRuntimePlayerId()) continue;
        return {
          entityId,
          point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
        };
      }

      return null;
    });
  }

  private createCombatSystem() {
    return {
      enable: () => {
        this.combatEnabled = true;
      },
      disable: () => {
        this.combatEnabled = false;
      },
      update: () => {},
      handlePointerDown: (event: MouseEvent): boolean => {
        const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
        if (event.button !== 0 || !this.combatEnabled || !runtimePlayerId || this.worldRuntime.getLocalPlayerBootstrapCoordinator().isLocalPlayerDead()) return false;
        const toolbarSystem = Engine.getToolbarSystem();
        const activeSlot = toolbarSystem?.getActiveSlot();
        if (activeSlot?.itemId === 'debug_fireball') {
          const camera = Engine.getEngineCamera();
          if (!camera) return false;
          const direction = new THREE.Vector3();
          camera.getWorldDirection(direction);
          return this.abilitySystem.activateAbility(
            runtimePlayerId,
            'ability_fireball',
            { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            { x: direction.x, y: direction.y, z: direction.z },
            ['player', 'world', 'environment'],
          );
        }
        if (!this.syncToolbarWeaponSelection(runtimePlayerId)) return false;
        return this.weaponSystem.fire(runtimePlayerId);
      },
      handleKeyDown: (event: KeyboardEvent): boolean => {
        const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
        if (!this.combatEnabled || !runtimePlayerId) return false;
        if (event.code === 'KeyR') {
          return this.tryManualReload(runtimePlayerId);
        }
        if (/^Digit[1-9]$/.test(event.code)) {
          const slotIndex = Number(event.code.slice(5)) - 1;
          return this.inventorySystem.equipSlot(runtimePlayerId, slotIndex);
        }
        return false;
      },
      handleWheel: (event: WheelEvent): boolean => {
        const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
        if (!this.combatEnabled || !runtimePlayerId) return false;
        const direction = event.deltaY > 0 ? 1 : -1;
        return this.inventorySystem.quickSwap(runtimePlayerId, direction);
      },
    };
  }

  private updateServerStatusMonitor(dt: number): void {
    const mode = getRuntimePerformanceMode();
    if (mode === RuntimePerformanceMode.RELEASE) return;
    this.serverStatusAccumulator += dt;
    const interval = mode === RuntimePerformanceMode.DEV ? 0 : 2;
    if (this.serverStatusAccumulator < interval) return;
    this.serverStatusAccumulator = 0;
    this.runtimeDiagnosticsCoordinator.update(dt);
  }

  private updateWeaponOversight(): void {
    const mode = getRuntimePerformanceMode();
    if (mode === RuntimePerformanceMode.RELEASE) return;
    const now = performance.now();
    const interval = mode === RuntimePerformanceMode.DEV ? 250 : 1000;
    if (now - this.lastWeaponDiagnosticsWriteAt < interval) return;
    this.lastWeaponDiagnosticsWriteAt = now;
    this.stateManager.set('diagnostics.weapons', {
      ...this.weaponSystem.getDiagnostics(),
      presentation: this.weaponPresentationSystem.getDiagnostics(),
    });
  }

  private configureAbilityMovementIntegration(): void {
    this.abilitySystem.setMovementIntentSink((casterId, _abilityId, intent) => {
      const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
      if (!runtimePlayerId || casterId !== runtimePlayerId) return;
      if (this.mpClient.connected && this.multiplayerRuntime.isGameplaySessionActive()) return;
      this.networkSyncSystem.queueMovementIntent(casterId, this.toNetworkMovementIntent(intent));
    });
  }

  private toNetworkMovementIntent(intent: AbilityMovementIntent) {
    return {
      horizontalImpulse: intent.horizontalImpulse,
      direction: {
        x: intent.direction.x,
        y: 0,
        z: intent.direction.z,
      },
      jump: false,
      crouch: false,
    };
  }

  private updateCharacterSystems(dt: number): void {
    try {
      this.characterActorSystem.update(dt);
    } catch (error) {
      console.error('[RuntimeAuxiliaryAssembly] Character actor update bridge failed', error);
    }

    try {
      this.runtimeMetricsReporterRef()?.update(dt);
    } catch (error) {
      console.error('[RuntimeAuxiliaryAssembly] Character runtime metrics update failed', error);
    }

    const mode = getRuntimePerformanceMode();
    if (mode === RuntimePerformanceMode.RELEASE) return;
    const interval = mode === RuntimePerformanceMode.DEV ? 0.25 : 1.0;
    this.gameplayDiagnosticsAccumulator += dt;
    if (this.gameplayDiagnosticsAccumulator >= interval) {
      this.gameplayDiagnosticsAccumulator = 0;
      try {
        this.stateManager.set('diagnostics.characters', {
          actorRuntime: this.characterActorSystem.getDiagnostics(),
          worldObjectAuthority: this.worldObjectAuthorityDiagnostics(),
          runtimeMetrics: this.runtimeMetricsReporterRef()?.getLastSample() ?? null,
        });
      } catch (error) {
        console.error('[RuntimeAuxiliaryAssembly] Character diagnostics update failed', error);
      }
    }
  }

  private updatePlayerModelSystem(dt: number): void {
    try {
      this.playerModelSystem.update(dt);
    } catch (error) {
      console.error('[RuntimeAuxiliaryAssembly] Player model update bridge failed', error);
    }
  }

  private updateHud(dt: number): void {
    const mode = getRuntimePerformanceMode();
    const hudInterval = mode === RuntimePerformanceMode.DEV ? 0.1 : 0.2;
    this.hudSyncAccumulator += dt;
    if (this.multiplayerRuntime.isGameplaySessionActive()) {
      if (this.hudSyncAccumulator >= hudInterval) {
        this.hudSyncAccumulator = 0;
        const activeGameMode = this.getActiveGameModeName();
        if (this.shouldRenderGenericRoundHud(activeGameMode)) {
          const round = this.gameModeManager.getRound();
          const local = this.gameModeManager.getPlayer(this.worldRuntime.getActiveRuntimePlayerId() ?? '');
          this.gameHUD.setRoundState(
            round.timeRemainingMs,
            round.killLimit,
            local?.kills ?? 0,
            local?.deaths ?? 0,
            round.roundNumber,
          );
        } else {
          this.gameHUD.setRoundState(0, 0, 0, 0, 0);
        }

        // Reuse scratch array to avoid per-update allocation
        const players = this.gameModeManager.getPlayers();
        const scratch = this._hudPlayerScratch;
        scratch.length = players.length;
        for (let i = 0; i < players.length; i++) {
          const p = players[i];
          const displayName = this.getHudDisplayName(p.id, p.name, activeGameMode);
          if (scratch[i]) {
            scratch[i].name = displayName;
            scratch[i].hp = p.health;
          } else {
            scratch[i] = { name: displayName, hp: p.health };
          }
        }
        this.gameHUD.setPlayerList(scratch);
      }
    }

    if (this.stateManager.getRaw('ui.hud.mode') === 'editor') {
      const entityCount = Engine.getEntityManager()?.getEntityCount() ?? 0;
      if (entityCount !== this.lastHudEntityCount) {
        this.lastHudEntityCount = entityCount;
        this.gameHUD.setEntityCount(entityCount);
      }
    }

    this.gameHUD.update(dt);
    this.driftBombController?.update(dt);
  }

  private updateGameplaySystems(dt: number): void {
    if (!this.gameplayRuntimeActive) {
      return;
    }
    this.worldRuntime.update(dt);
    this.runtimeSimulationDirector.beginFrame(dt);
    // Reuse collections instead of allocating fresh Map / Set every frame
    const entityPositions = this._entityPositions;
    const playerIds = this._playerIds;
    entityPositions.clear();
    playerIds.clear();

    const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
    const localTransform = this.networkSyncSystem.getLocalPlayerTransform();
    if (localTransform && runtimePlayerId) {
      const existing = entityPositions.get(runtimePlayerId);
      if (existing) {
        existing.x = localTransform.position.x;
        existing.y = localTransform.position.y;
        existing.z = localTransform.position.z;
      } else {
        entityPositions.set(runtimePlayerId, {
          x: localTransform.position.x,
          y: localTransform.position.y,
          z: localTransform.position.z,
        });
      }
      playerIds.add(runtimePlayerId);
    }

    const entityManager = Engine.getEntityManager();
    for (const entity of entityManager?.getEntities() ?? []) {
      entityPositions.set(entity.id, entity.getPosition());
    }

    for (const playerId of this.playerModelSystem.getPlayerIds()) {
      const group = this.playerModelSystem.getGroup(playerId);
      if (group) {
        const existing = entityPositions.get(playerId);
        if (existing) {
          existing.x = group.position.x;
          existing.y = group.position.y;
          existing.z = group.position.z;
        } else {
          entityPositions.set(playerId, { x: group.position.x, y: group.position.y, z: group.position.z });
        }
        playerIds.add(playerId);
      }
    }

    this.healthSystem.update(dt);
    this.weaponSystem.update(dt, entityPositions);
    this.abilitySystem.update(dt, entityPositions);
    this.updateStatusMovementAuthority(runtimePlayerId);
    this.inventorySystem.update(dt, entityPositions, playerIds);
    this.prefabSystem.update(dt);
    this.runtimeSimulationDirector.drainQueuedWork();

    if (runtimePlayerId && this.autoHealthChannelSync && !this.mpClient.connected) {
      this.worldRuntime.syncGasVitalsFromHealth(runtimePlayerId);
    }

    if (runtimePlayerId) {
      this.worldRuntime.syncAdaptiveRuntime();
    }
  }

  private getActiveGameModeName(): string | null {
    const activeGameMode = this.stateManager.getRaw('game.mode');
    return typeof activeGameMode === 'string' && activeGameMode.length > 0 ? activeGameMode : null;
  }

  private shouldRenderGenericRoundHud(activeGameMode: string | null): boolean {
    return activeGameMode === 'ffa' || activeGameMode === 'round';
  }

  private getHudDisplayName(playerId: string, fallbackName: string, activeGameMode: string | null): string {
    if (playerId !== OFFLINE_LOCAL_PLAYER_ID) {
      return fallbackName;
    }

    switch (activeGameMode) {
      case 'drift_bomb':
        return 'Drift Bomb';
      case 'sandbox':
        return 'Sandbox';
      case 'horde':
        return 'Horde';
      case 'freeplay':
        return 'Freeplay';
      default:
        return fallbackName;
    }
  }

  private updateStatusMovementAuthority(runtimePlayerId: string | null): void {
    if (this.statusMovementTrackedPlayerId && this.statusMovementTrackedPlayerId !== runtimePlayerId) {
      this.networkSyncSystem.setDerivedStatusMovementModifier(this.statusMovementTrackedPlayerId, null);
      this.networkSyncSystem.setDebugStatusMovementModifier(this.statusMovementTrackedPlayerId, null);
    }
    this.statusMovementTrackedPlayerId = runtimePlayerId;
    if (!runtimePlayerId) {
      if (this.statusMovementTrackedPlayerId) {
        this.networkSyncSystem.setMovementFeelDebugConfig(this.statusMovementTrackedPlayerId, null);
      }
      this.statusMovementDebugSnapshot = this.buildStatusMovementDebugState(null);
      return;
    }

    this.syncMovementFeelDebugOverride(runtimePlayerId);

    const gameplayActive = this.multiplayerRuntime.isGameplaySessionActive();
    if (this.mpClient.connected && gameplayActive) {
      this.networkSyncSystem.setDerivedStatusMovementModifier(runtimePlayerId, null);
      this.syncNetworkStatusMovementDebugOverride(runtimePlayerId);
    } else {
      this.syncLocalDerivedStatusMovementModifier(runtimePlayerId);
      this.syncLocalDebugStatusMovementOverride(runtimePlayerId);
      this.clearNetworkStatusMovementDebugOverride();
    }

    this.statusMovementDebugSnapshot = this.buildStatusMovementDebugState(runtimePlayerId);
    this.logStatusMovementDebugFrame(runtimePlayerId);
  }

  private flushStatusMovementDebugState(): void {
    const runtimePlayerId = this.worldRuntime.getActiveRuntimePlayerId();
    if (!runtimePlayerId) {
      if (this.statusMovementTrackedPlayerId) {
        this.networkSyncSystem.setMovementFeelDebugConfig(this.statusMovementTrackedPlayerId, null);
      }
      this.statusMovementDebugSnapshot = this.buildStatusMovementDebugState(null);
      return;
    }

    this.syncMovementFeelDebugOverride(runtimePlayerId);

    const gameplayActive = this.multiplayerRuntime.isGameplaySessionActive();
    if (this.mpClient.connected && gameplayActive) {
      this.networkSyncSystem.setDerivedStatusMovementModifier(runtimePlayerId, null);
      this.syncNetworkStatusMovementDebugOverride(runtimePlayerId);
    } else {
      this.syncLocalDerivedStatusMovementModifier(runtimePlayerId);
      this.syncLocalDebugStatusMovementOverride(runtimePlayerId);
      this.clearNetworkStatusMovementDebugOverride();
    }

    this.statusMovementDebugSnapshot = this.buildStatusMovementDebugState(runtimePlayerId);
    this.logStatusMovementDebugFrame(runtimePlayerId);
  }

  private syncLocalDerivedStatusMovementModifier(runtimePlayerId: string): void {
    this.networkSyncSystem.setDerivedStatusMovementModifier(
      runtimePlayerId,
      this.buildLocalStatusMovementModifier(runtimePlayerId),
    );
  }

  private syncLocalDebugStatusMovementOverride(runtimePlayerId: string): void {
    this.networkSyncSystem.setDebugStatusMovementModifier(
      runtimePlayerId,
      this.buildDebugStatusMovementModifier(runtimePlayerId),
    );
  }

  private syncNetworkStatusMovementDebugOverride(runtimePlayerId: string): void {
    this.networkSyncSystem.setDebugStatusMovementModifier(runtimePlayerId, null);

    if (!this.shouldUseAuthoritativeStatusMovementDebugMode()) {
      this.clearNetworkStatusMovementDebugOverride();
      return;
    }

    const payload = {
      rooted: this.statusMovementDebugConfig.rooted,
      chilled: this.statusMovementDebugConfig.chilled,
      electrocuted: this.statusMovementDebugConfig.electrocuted,
      speedMultiplier: this.statusMovementDebugConfig.speedMultiplier,
      impulseMagnitude: this.statusMovementDebugConfig.impulseMagnitude,
    };
    const signature = JSON.stringify(payload);
    if (signature === this.statusMovementDebugLastNetworkSignature) {
      return;
    }

    this.mpClient.sendGameplayCommand('debug_set_status_movement', payload);
    this.statusMovementDebugLastNetworkSignature = signature;
  }

  private clearNetworkStatusMovementDebugOverride(): void {
    if (!this.statusMovementDebugLastNetworkSignature || !this.mpClient.connected) {
      this.statusMovementDebugLastNetworkSignature = null;
      return;
    }

    this.mpClient.sendGameplayCommand('debug_set_status_movement', {
      rooted: false,
      chilled: false,
      electrocuted: false,
      speedMultiplier: this.statusMovementDebugConfig.speedMultiplier,
      impulseMagnitude: 0,
    });
    this.statusMovementDebugLastNetworkSignature = null;
  }

  private buildLocalStatusMovementModifier(runtimePlayerId: string): StatusMovementModifier | null {
    const effectSystem = Engine.getGasEffectSystem();
    if (!effectSystem) return null;

    let blockMovement = false;
    let speedMultiplier = 1;
    for (const effect of effectSystem.getActiveEffects(runtimePlayerId)) {
      switch (effect.templateId) {
        case 'status_rooted':
          blockMovement = true;
          speedMultiplier = 0;
          break;
        case 'status_chilled':
          speedMultiplier = Math.min(speedMultiplier, 0.5);
          break;
        case 'status_electrocuted':
          blockMovement = true;
          speedMultiplier = 0;
          break;
        default:
          break;
      }
    }

    if (!blockMovement && speedMultiplier >= 0.999) {
      return null;
    }

    return {
      blockMovement: blockMovement || undefined,
      speedMultiplier,
    };
  }

  private buildDebugStatusMovementModifier(runtimePlayerId: string): StatusMovementModifier | null {
    if (!this.hasAnyStatusMovementDebugFlags() || !this.isStatusMovementDebugRuntimeAllowed()) {
      return null;
    }

    const modifier: StatusMovementModifier = {};
    if (this.statusMovementDebugConfig.rooted) {
      modifier.blockMovement = true;
      modifier.speedMultiplier = 0;
    }
    if (this.statusMovementDebugConfig.chilled) {
      modifier.speedMultiplier = modifier.speedMultiplier === undefined
        ? this.statusMovementDebugConfig.speedMultiplier
        : Math.min(modifier.speedMultiplier, this.statusMovementDebugConfig.speedMultiplier);
    }
    if (this.statusMovementDebugConfig.electrocuted) {
      modifier.blockMovement = true;
      modifier.speedMultiplier = 0;
      if (this.statusMovementDebugConfig.impulseMagnitude > 0) {
        modifier.impulseOverride = this.buildDebugImpulseOverride(runtimePlayerId, this.statusMovementDebugConfig.impulseMagnitude);
      }
    }

    return modifier.blockMovement || modifier.speedMultiplier !== undefined || modifier.impulseOverride
      ? modifier
      : null;
  }

  private buildDebugImpulseOverride(runtimePlayerId: string, magnitude: number) {
    const localTransform = this.networkSyncSystem.getLocalPlayerTransform();
    const fallbackRotation = this.worldRuntime.getLocalPlayerEntity()?.getRotation();
    const yaw = runtimePlayerId === this.worldRuntime.getActiveRuntimePlayerId()
      ? localTransform?.rotation.y ?? fallbackRotation?.y ?? 0
      : fallbackRotation?.y ?? 0;
    return {
      x: Math.sin(yaw) * magnitude,
      y: 0,
      z: Math.cos(yaw) * magnitude,
    };
  }

  private shouldUseAuthoritativeStatusMovementDebugMode(): boolean {
    return this.statusMovementDebugConfig.networkSimulation
      && this.hasAnyStatusMovementDebugFlags()
      && this.isStatusMovementDebugRuntimeAllowed()
      && this.mpClient.connected
      && this.multiplayerRuntime.isGameplaySessionActive();
  }

  private getStatusMovementDebugMode(): 'disabled' | 'local' | 'authoritative' {
    if (!this.hasAnyStatusMovementDebugFlags() || !this.isStatusMovementDebugRuntimeAllowed()) {
      return 'disabled';
    }
    return this.shouldUseAuthoritativeStatusMovementDebugMode() ? 'authoritative' : 'local';
  }

  private hasAnyStatusMovementDebugFlags(): boolean {
    return this.statusMovementDebugConfig.rooted
      || this.statusMovementDebugConfig.chilled
      || this.statusMovementDebugConfig.electrocuted;
  }

  private isStatusMovementDebugRuntimeAllowed(): boolean {
    const mode = getRuntimePerformanceMode();
    return mode !== RuntimePerformanceMode.RELEASE && mode !== RuntimePerformanceMode.CAPTURE;
  }

  private logStatusMovementDebugFrame(runtimePlayerId: string): void {
    if (!this.statusMovementDebugConfig.logEachFrame || !this.isStatusMovementDebugRuntimeAllowed()) return;

    const snapshot = this.statusMovementDebugSnapshot ?? this.buildStatusMovementDebugState(runtimePlayerId);

    for (const playerState of snapshot.players) {
      if (!this.hasAnyStatusMovementDebugFlags()
        && !playerState.hasResolved
        && !playerState.hasMovementIntent) {
        continue;
      }

      console.log([
        '[MovementDebug]',
        `player=${playerState.playerId}`,
        `entity=${playerState.entityId || 'n/a'}`,
        `network=${playerState.networkEntityId || 'n/a'}`,
        `movementDelta=${playerState.hasMovementDelta ? playerState.movementDelta.toFixed(3) : 'initial'}`,
        `mode=${snapshot.mode}`,
        `hasAuthoritative=${playerState.hasAuthoritative}`,
        `hasLocal=${playerState.hasLocal}`,
        `hasDebug=${playerState.hasDebug}`,
        `hasResolved=${playerState.hasResolved}`,
        `Authoritative Snapshot=${JSON.stringify(playerState.authoritative)}`,
        `Local Derived=${JSON.stringify(playerState.local)}`,
        `Debug Override=${JSON.stringify(playerState.debug)}`,
        `Resolved Output=${JSON.stringify(playerState.resolved)}`,
        `movementIntent=${JSON.stringify(playerState.movementIntent)}`,
      ].join('\n'));
    }
  }

  private collectStatusMovementDebugSourceStates(runtimePlayerId: string | null): StatusMovementDebugSourceState[] {
    const localStates = this.networkSyncSystem.getAllMovementAuthorityDebugStates();
    const seenPlayerIds = new Set(localStates.map((state) => state.playerId).filter((playerId): playerId is string => typeof playerId === 'string'));
    const remoteStates = this.playerModelSystem.getMovementDebugStates()
      .filter((state) => !seenPlayerIds.has(state.playerId));
    return [...localStates, ...remoteStates].sort((left, right) => {
      if (left.playerId === runtimePlayerId) return -1;
      if (right.playerId === runtimePlayerId) return 1;
      return String(left.playerId ?? '').localeCompare(String(right.playerId ?? ''));
    });
  }

  private buildStatusMovementDebugState(runtimePlayerId: string | null): StatusMovementDebugState {
    const sourceStates = this.collectStatusMovementDebugSourceStates(runtimePlayerId);
    const players = sourceStates
      .map((state) => this.toResolvedDebugMovementState(state, this.computeMovementDelta(state)));
    this.recordMovementDeltaPositions(sourceStates);
    return {
      config: { ...this.statusMovementDebugConfig },
      mode: this.getStatusMovementDebugMode(),
      connected: this.mpClient.connected,
      gameplayActive: this.multiplayerRuntime.isGameplaySessionActive(),
      selectedPlayerId: players.find((player) => player.playerId === (runtimePlayerId ?? ''))?.playerId
        ?? players[0]?.playerId
        ?? '',
      movementFeel: this.buildMovementFeelDebugState(runtimePlayerId),
      players,
    };
  }

  private syncMovementFeelDebugOverride(runtimePlayerId: string): void {
    this.networkSyncSystem.setMovementFeelDebugConfig(runtimePlayerId, this.buildMovementFeelDebugConfig());
  }

  private buildMovementFeelDebugConfig(): MovementFeelDebugConfig | null {
    const config: MovementFeelDebugConfig = {
      speedMultiplier: this.statusMovementDebugConfig.feelSpeedMultiplier,
      accelerationMultiplier: this.statusMovementDebugConfig.feelAccelerationMultiplier,
      frictionMultiplier: this.statusMovementDebugConfig.feelFrictionMultiplier,
      floatiness: this.statusMovementDebugConfig.feelFloatiness,
      airControlEnabled: this.statusMovementDebugConfig.feelAirControlEnabled,
    };

    return config.speedMultiplier === DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.speedMultiplier
      && config.accelerationMultiplier === DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.accelerationMultiplier
      && config.frictionMultiplier === DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.frictionMultiplier
      && config.floatiness === DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.floatiness
      && config.airControlEnabled === DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.airControlEnabled
      ? null
      : config;
  }

  private buildMovementFeelDebugState(runtimePlayerId: string | null): MovementFeelDebugState {
    const tuningState = this.networkSyncSystem.getMovementTuningDebugState(runtimePlayerId ?? undefined);
    const nonAuthoritative = this.mpClient.connected && this.multiplayerRuntime.isGameplaySessionActive();
    return {
      authorityLabel: tuningState.hasDebugOverride
        ? (nonAuthoritative ? 'local debug override [non-authoritative multiplayer preview]' : 'local debug override [authoritative local runtime]')
        : 'locked baseline [authoritative defaults]',
      live: tuningState.live,
      hasDebugOverride: tuningState.hasDebugOverride,
      hooks: tuningState.hooks,
    };
  }

  private toResolvedDebugMovementState(
    state: StatusMovementDebugSourceState,
    movementDelta: { value: number; active: boolean },
  ): ResolvedDebugMovementState {
    const authoritative = this.normalizeDebugModifier(state.statusMovementModifier);
    const local = this.normalizeDebugModifier(state.derivedStatusMovementModifier);
    const debug = this.normalizeDebugModifier(state.debugStatusMovementModifier);
    const resolved = this.normalizeDebugModifier(state.effectiveStatusMovementModifier);
    return {
      playerId: state.playerId ?? '',
      entityId: state.entityId ?? '',
      networkEntityId: state.networkEntityId ?? '',
      movementDelta: movementDelta.value,
      hasMovementDelta: movementDelta.active,
      authoritative,
      local,
      debug,
      resolved,
      hasAuthoritative: this.hasModifierValues(authoritative),
      hasLocal: this.hasModifierValues(local),
      hasDebug: this.hasModifierValues(debug),
      hasResolved: this.hasModifierValues(resolved),
      movementIntent: this.normalizeDebugMovementIntent(state.movementIntent),
      hasMovementIntent: this.hasMovementIntentValues(state.movementIntent),
    };
  }

  private computeMovementDelta(state: StatusMovementDebugSourceState): { value: number; active: boolean } {
    if (!state.playerId || !state.currentPosition) {
      return { value: 0, active: false };
    }

    const previous = this.statusMovementDebugLastPositions.get(state.playerId);
    if (!previous) {
      return { value: 0, active: false };
    }

    return {
      value: Math.hypot(
        state.currentPosition.x - previous.x,
        state.currentPosition.z - previous.z,
      ),
      active: true,
    };
  }

  private recordMovementDeltaPositions(sourceStates: StatusMovementDebugSourceState[]): void {
    const livePlayerIds = new Set<string>();
    for (const state of sourceStates) {
      if (!state.playerId || !state.currentPosition) continue;
      livePlayerIds.add(state.playerId);
      this.statusMovementDebugLastPositions.set(state.playerId, {
        x: state.currentPosition.x,
        y: state.currentPosition.y,
        z: state.currentPosition.z,
      });
    }

    for (const playerId of [...this.statusMovementDebugLastPositions.keys()]) {
      if (!livePlayerIds.has(playerId)) {
        this.statusMovementDebugLastPositions.delete(playerId);
      }
    }
  }

  private normalizeDebugModifier(modifier: StatusMovementModifier | null | undefined): StatusMovementModifier {
    if (!modifier) return {};
    return {
      ...(typeof modifier.speedMultiplier === 'number' ? { speedMultiplier: modifier.speedMultiplier } : {}),
      ...(modifier.blockMovement === true ? { blockMovement: true } : {}),
      ...(modifier.impulseOverride
        ? {
            impulseOverride: {
              x: modifier.impulseOverride.x,
              y: modifier.impulseOverride.y,
              z: modifier.impulseOverride.z,
            },
          }
        : {}),
    };
  }

  private hasModifierValues(modifier: StatusMovementModifier): boolean {
    return Object.keys(modifier).length > 0;
  }

  private normalizeDebugMovementIntent(movementIntent: NetworkMovementIntent | null): NetworkMovementIntent | Record<string, never> {
    if (!movementIntent) return {};
    return {
      horizontalImpulse: movementIntent.horizontalImpulse,
      direction: {
        x: movementIntent.direction.x,
        y: movementIntent.direction.y,
        z: movementIntent.direction.z,
      },
      jump: movementIntent.jump === true,
      crouch: movementIntent.crouch === true,
      ...(typeof movementIntent.verticalImpulse === 'number'
        ? { verticalImpulse: movementIntent.verticalImpulse }
        : {}),
    };
  }

  private hasMovementIntentValues(movementIntent: NetworkMovementIntent | null): boolean {
    return !!movementIntent
      && (movementIntent.horizontalImpulse > 0
        || movementIntent.jump === true
        || movementIntent.crouch === true);
  }

  private createEmptyStatusMovementDebugState(): StatusMovementDebugState {
    return {
      config: { ...this.statusMovementDebugConfig },
      mode: 'disabled',
      connected: false,
      gameplayActive: false,
      selectedPlayerId: '',
      movementFeel: {
        authorityLabel: 'locked baseline [authoritative defaults]',
        live: null,
        hasDebugOverride: false,
        hooks: null,
      },
      players: [],
    };
  }

  private updateLocalCamera(): void {
    if (!this.multiplayerRuntime.isGameplaySessionActive()) return;
    this.playerModelSystem.setLocalPresentationMovementState(this.networkSyncSystem.getLocalResolvedMovementState());
    this.worldRuntime.syncCameraToLocalPlayerEntity();
  }

  private updateVfx(dt: number): void {
    const camera = Engine.getEngineCamera();
    this.vfxMaker.setCamera(camera);
    this.vfxSystem.setCamera(camera);
    this.vfxSystem.update(dt);
  }

  private updateAudio(dt: number): void {
    const camera = Engine.getEngineCamera();
    this.audioManager.attachCamera(camera);
    this.audioUpdateAccumulator += dt;
    const updateInterval = this.runtimeSimulationDirector.getRecommendedAudioInterval();
    if (this.audioUpdateAccumulator < updateInterval) return;

    // Get entity positions for spatial audio
    const entityPositions = this._audioEntityPositions;
    entityPositions.clear();
    const localTransform = this.networkSyncSystem.getLocalPlayerTransform();
    if (localTransform?.position) {
      const playerId = this.worldRuntime.getActiveRuntimePlayerId();
      if (playerId) {
        entityPositions.set(playerId, localTransform.position);
      }
    }

    this.audioManager.update(this.audioUpdateAccumulator, entityPositions);
    this.audioUpdateAccumulator = 0;
  }

  private getSelectedToolbarWeaponKey(): string | null {
    const toolbarSystem = Engine.getToolbarSystem();
    const slot = toolbarSystem?.getActiveSlot();
    if (!slot) return null;
    return this.resolveToolbarCombatKey(slot.itemId);
  }

  private resolveToolbarCombatKey(itemId: string | null | undefined): string | null {
    if (!itemId) return null;
    if (itemId === 'debug_fireball') return itemId;

    const candidates = itemId.startsWith('weapon_')
      ? [itemId.replace(/^weapon_/, ''), itemId]
      : [itemId, `weapon_${itemId}`];

    for (const candidate of candidates) {
      if (this.weaponSystem.getDefinition(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private syncToolbarWeaponSelection(playerId: string): string | null {
    const weaponKey = this.getSelectedToolbarWeaponKey();
    if (!weaponKey) return null;
    if (this.weaponSystem.getEquipped(playerId) !== weaponKey) {
      this.weaponSystem.equip(playerId, weaponKey);
    }
    return weaponKey;
  }

  private tryManualReload(playerId: string): boolean {
    const weaponKey = this.syncToolbarWeaponSelection(playerId);
    if (weaponKey) {
      return this.weaponSystem.reload(playerId);
    }

    const slot = Engine.getToolbarSystem()?.getActiveSlot();
    if (!slot?.itemId) {
      return false;
    }

    gameBus.emit('manual_reload_requested', {
      playerId,
      itemId: slot.itemId,
      instanceId: slot.instanceId,
    });
    return true;
  }

  private resolveCombatTargetId(object: THREE.Object3D | null): string | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (typeof current.userData.playerId === 'string') return current.userData.playerId as string;
      if (typeof current.userData.entityId === 'string') return current.userData.entityId as string;
      current = current.parent;
    }
    return null;
  }

  private resolveDamageSourcePosition(sourceId: string | undefined): THREE.Vector3 | null {
    if (!sourceId) {
      return null;
    }

    const fromPlayerModel = this.playerModelSystem.getPlayerWorldPosition(sourceId);
    if (fromPlayerModel) {
      return new THREE.Vector3(fromPlayerModel.x, fromPlayerModel.y, fromPlayerModel.z);
    }

    const sourceEntity = Engine.getEntityManager()?.getEntity(sourceId);
    if (sourceEntity) {
      const position = sourceEntity.getPosition();
      return new THREE.Vector3(position.x, position.y, position.z);
    }

    return null;
  }

  private resolveDamageDirection(sourcePosition: THREE.Vector3): 'front' | 'back' | 'left' | 'right' | null {
    const camera = Engine.getEngineCamera();
    if (!camera) {
      return null;
    }

    const localEntity = this.worldRuntime.getLocalPlayerEntity();
    const localPosition = localEntity ? localEntity.getPosition() : camera.position;
    const toSource = new THREE.Vector3(
      sourcePosition.x - localPosition.x,
      0,
      sourcePosition.z - localPosition.z,
    );
    if (toSource.lengthSq() < 0.0001) {
      return null;
    }
    toSource.normalize();

    const forward = camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) {
      return null;
    }
    forward.normalize();

    const dot = forward.dot(toSource);
    const crossY = forward.x * toSource.z - forward.z * toSource.x;
    if (Math.abs(dot) >= Math.abs(crossY)) {
      return dot >= 0 ? 'front' : 'back';
    }
    return crossY >= 0 ? 'right' : 'left';
  }
}
