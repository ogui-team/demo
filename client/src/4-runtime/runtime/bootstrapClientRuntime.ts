import * as THREE from 'three';
import * as Engine from '../../0-foundation/foundation/Engine';
import { initDebugManager } from '../diagnostics/debug';
import { FeatureManager } from '../../1-kernel/core/FeatureManager';
import { MultiplayerClient } from '../../3-network/network/MultiplayerClient';
import { GameModeManager } from '../../2-systems/gameplay/game/GameModeManager';
import { GameModeSystem, FFAMode, FreeplayMode, RoundBasedMode, SandboxMode } from '../../2-systems/gameplay/game/GameModeSystem';
import { PlayerModelSystem } from '../../2-systems/gameplay/game/PlayerModelSystem';
import { ViewModelSystem } from '../../2-systems/gameplay/game/ViewModelSystem';
import { MenuIdentitySystem } from '../ui/MenuIdentitySystem';
import { CharacterActorSystem } from '../../2-systems/gameplay/game/CharacterActorSystem';
import { GameLaunchCoordinator } from '../../2-systems/gameplay/game/GameLaunchCoordinator';
import { SessionLifecycleCoordinator } from '../../2-systems/gameplay/game/SessionLifecycleCoordinator';
import { WorldObjectAuthorityService } from '../../2-systems/gameplay/game/WorldObjectAuthorityService';
import { RuntimeDiagnosticsCoordinator } from '../diagnostics/debug/RuntimeDiagnosticsCoordinator';
import type { RuntimeMetricsReporter } from '../diagnostics/debug/RuntimeMetricsReporter';
import { WeaponPresentationSystem } from '../../2-systems/gameplay/game/WeaponPresentationSystem';
import { HUDSystem } from '../../2-systems/gameplay/systems/HUDSystem';
import { PhysicsSystem } from '../../2-systems/gameplay/systems/PhysicsSystem';
import { HealthSystem } from '../../2-systems/gameplay/systems/HealthSystem';
import { WeaponSystem } from '../../2-systems/gameplay/systems/WeaponSystem';
import { InventorySystem } from '../../2-systems/gameplay/systems/InventorySystem';
import { PrefabSystem } from '../../2-systems/gameplay/systems/PrefabSystem';
import { MaterialManager } from '../../2-systems/gameplay/systems/MaterialManager';
import { AudioSystem } from '../../2-systems/gameplay/systems/AudioSystem';
import { PathfindingSystem } from '../../2-systems/gameplay/systems/PathfindingSystem';
import { VFXMaker } from '../../2-systems/gameplay/systems/VFXMaker';
import { VFXSystem } from '../../2-systems/gameplay/systems/VFXSystem';
import { AdaptiveRuntimeLayer, type AdaptiveContentPack } from '../../2-systems/gameplay/systems/AdaptiveRuntimeLayer';
import { GameAudioManager } from '../../2-systems/gameplay/systems/GameAudioManager';
import { SpriteAtlasSystem } from '../../2-systems/gameplay/systems/2d/SpriteAtlasSystem';
import { Camera2DSystem } from '../../2-systems/gameplay/systems/2d/Camera2DSystem';
import { SpriteAnimationSystem } from '../../2-systems/gameplay/systems/2d/SpriteAnimationSystem';
import { Physics2DSystem } from '../../2-systems/gameplay/systems/2d/Physics2DSystem';
import { Input2DAdapterSystem } from '../../2-systems/gameplay/systems/2d/Input2DAdapterSystem';
import { TilemapSystem } from '../../2-systems/gameplay/systems/2d/TilemapSystem';
import { ParallaxSystem } from '../../2-systems/gameplay/systems/2d/ParallaxSystem';
import { SpriteRenderSystem } from '../../2-systems/gameplay/systems/2d/SpriteRenderSystem';
import { UI2DSystem } from '../../2-systems/gameplay/systems/2d/UI2DSystem';
import { SpritePrefabExtension } from '../../2-systems/gameplay/systems/2d/SpritePrefabExtension';
import type { FoliageSystem } from '../../2-systems/gameplay/systems/2d/FoliageSystem';
import { UndoRedoSystem } from '../../1-kernel/core/UndoRedoSystem';
import { SpawnSystem } from '../../2-systems/gameplay/systems/SpawnSystem';
import { HordeSystem } from '../../2-systems/gameplay/systems/HordeSystem';
import { ReplaySystem } from '../../1-kernel/core/ReplaySystem';
import { ObjectCreatorSystem } from '../../2-systems/gameplay/game/ObjectCreatorSystem';
import { ScriptedLevelSystem } from '../../2-systems/gameplay/game/ScriptedLevelSystem';
import { V010_LEVELS } from '../../2-systems/gameplay/game/levels/v010Levels';
import { logEvent } from '../../1-kernel/core/EventLogger';
import { gameBus } from '../../1-kernel/core/EventBus';
import { EventListenerRegistry } from '../../1-kernel/core/EventListenerRegistry';
import { TeardownRegistry } from '../../1-kernel/core/TeardownRegistry';
import { CollisionAuthoritySystem } from '../../3-network/network/CollisionAuthoritySystem';
import { AbilitySystem } from '../../2-systems/gameplay/systems/gas/AbilitySystem';
import { GASBridge } from '../../2-systems/gameplay/systems/gas/GASBridge';
import { runDOD_HealthBufferTest } from '../tests/DOD_HealthBufferTest';
import { registerRuntimeSystems, registerSaveLoadHandlers } from './bootstrap/systemRegistration';
import { bootstrapRuntimeEventHandlers, bootstrapDebugTestEntitiesIfEnabled } from './bootstrap/runtimeEventHandlers';
import { initDebugMenu } from './DebugMenu';
import adaptiveRuntimePack from '../../2-systems/gameplay/game/data/adaptiveRuntimePack.json';
import { createGameLaunchCoordinator } from './bootstrap/createGameLaunchCoordinator';
import { createSessionLifecycleCoordinator } from './bootstrap/createSessionLifecycleCoordinator';
import { createRuntimeUiCompositionCoordinator } from './bootstrap/createRuntimeUiCompositionCoordinator';
import { createMultiplayerRuntimeCoordinator, createRuntimeAuxiliaryAssembly } from './bootstrap/runtimeAssemblies';
import { bootstrapRuntimeMetricsReporter } from './bootstrap/runtimeMetrics';
import { Phase3_GameplayRuntime, Phase4_NetworkingRuntime, Phase5_UIRuntime, bootstrapPhase6_CoordinatorWiring } from './bootstrap/phases';
import { completePhase6CoordinatorWiring } from './bootstrap/phase6CoordinatorWiring';
import { setupGameModeContext } from './bootstrap/gameModeContextSetup';
import { ClientWorldRuntimeCoordinator } from './coordinators/ClientWorldRuntimeCoordinator';
import { MultiplayerRuntimeCoordinator } from './coordinators/MultiplayerRuntimeCoordinator';
import { EditorAuthorityCoordinator } from './EditorAuthorityCoordinator';
import { SceneSerializationSystem } from '../editor/SceneSerializationSystem';
import { WorldBuildService } from './WorldBuildService';
import { RendererRebindService } from './RendererRebindService';
import { TitanContentPipeline } from '../content/TitanContentPipeline';
import { RuntimeAuxiliaryAssembly } from './RuntimeAuxiliaryAssembly';
import { RuntimeOverlayCoordinator } from './coordinators/RuntimeOverlayCoordinator';
import { LifecycleOrchestrator } from '../debug/LifecycleOrchestrator';
import { KernelMovementIntegration } from './bootstrap/KernelMovementIntegration';
import { InventoryHudSyncHub } from './bootstrap/InventoryHudSyncHub';
import { DODStateBridge } from './bootstrap/DODStateBridge';
import { TitanBenchmarkOverlay } from '../diagnostics/debug/TitanBenchmarkOverlay';
import { createEditorAuthorityCoordinator, createRuntimeDiagnosticsCoordinator } from './bootstrap/coordinatorFactories';
import { PublicSystemRegistry } from '../../1-kernel/core/PublicSystemRegistry';
import { PublicEventBus } from '../../1-kernel/core/PublicEventBus';
import { PluginRegistry } from './PluginRegistry';
import { GameEngineSDKImpl, createPluginLogger, exposeGameEngineSDK } from './GameEngineSdk';
import { SettingsPlugin } from './SettingsPlugin';
import { AudioPlugin } from './AudioPlugin';
import { DODInspectorPlugin } from './DODInspectorPlugin';
import { EditorShellPlugin } from './EditorShellPlugin';
import { AuthPlugin } from './AuthPlugin';
import { RuntimeMixerPlugin } from './RuntimeMixerPlugin';
import {
  cloneTropicalHorrorArchetypeAppearance,
  getTropicalHorrorArchetype,
  listTropicalHorrorArchetypes,
  mergeSpawnLoadoutWithArchetype,
  persistTropicalHorrorArchetypeSelection,
  resolveTropicalHorrorArchetypeId,
  resolveTropicalHorrorArchetypeSelection,
  type TropicalHorrorArchetypeId,
} from '../../2-systems/ArchetypeDefinitions';
import {
  SCHEMA_PATHS,
  StateHydrationGuard,
  STATE_LOADING,
} from '../../0-foundation/foundation/state/hydrateStateManager';
import {
  getContextDeps,
  getDefaultServerHttpUrl,
  getDefaultServerWsUrl,
  getHalfExtentsFromRenderData,
  readNumber,
} from './bootstrap/support';

// Guard against multiple calls to bootstrapRuntime
let isRuntimeInitialized = false;

function parseGameplayDebugAutostart(): {
  enabled: boolean;
  backend: 'legacy' | 'rapier' | null;
  seed: string | null;
} {
  try {
    const query = new URLSearchParams(window.location.search);
    const autostart = query.get('autostart');
    const enabled = autostart === 'driftbomb' || autostart === 'driftbomb_debug';
    const backendRaw = (query.get('physicsBackend') ?? '').toLowerCase();
    const backend = backendRaw === 'rapier' || backendRaw === 'legacy'
      ? backendRaw
      : null;
    const seed = query.get('seed');
    return { enabled, backend, seed };
  } catch {
    return { enabled: false, backend: null, seed: null };
  }
}

export function bootstrapRuntime(): void {
  // Only initialize once
  if (isRuntimeInitialized) {
    console.log('[Titan Engine] Runtime already initialized, skipping bootstrap');
    return;
  }
  
  isRuntimeInitialized = true;
  
  const defaultServerHttpUrl = getDefaultServerHttpUrl();
  const defaultServerWsUrl = getDefaultServerWsUrl();

  // Engine is already initialized by bootstrapMinimalRuntime during kernel bootstrap
  // Do NOT call Engine.init() again or it will throw "Engine already initialized"
  const stateManager = Engine.getStateManagerInstance();
  if (!stateManager) {
    throw new Error('State manager not initialized - kernel may not be initialized');
  }

  // StateManager hydration is performed inside initStateManager() during
  // Engine.init(). At this point we only need a read guard for UI bindings.
  const stateHydrationGuard = new StateHydrationGuard(stateManager);
  const storage = typeof window !== 'undefined' ? window.localStorage : null;
  const applyLocalArchetypeSelection = (rawArchetypeId: unknown): TropicalHorrorArchetypeId => {
    const archetypeId = resolveTropicalHorrorArchetypeId(rawArchetypeId)
      ?? resolveTropicalHorrorArchetypeId(stateManager.getRaw(SCHEMA_PATHS.PLAYER_LOCAL_ARCHETYPE))
      ?? resolveTropicalHorrorArchetypeSelection(typeof window !== 'undefined' ? window.location.search : '', storage);

    persistTropicalHorrorArchetypeSelection(storage, archetypeId);
    stateManager.set(SCHEMA_PATHS.LOBBY_LOCAL_PLAYER_ARCHETYPE, archetypeId);
    stateManager.set(SCHEMA_PATHS.PLAYER_LOCAL_ARCHETYPE, archetypeId);
    stateManager.set(SCHEMA_PATHS.PLAYERS_LOCAL_ARCHETYPE, archetypeId);
    stateManager.set(SCHEMA_PATHS.LOBBY_LOCAL_PLAYER_APPEARANCE, cloneTropicalHorrorArchetypeAppearance(archetypeId));
    stateManager.set(SCHEMA_PATHS.PLAYER_LOCAL_APPEARANCE, cloneTropicalHorrorArchetypeAppearance(archetypeId));
    return archetypeId;
  };
  let selectedArchetypeId = applyLocalArchetypeSelection(
    resolveTropicalHorrorArchetypeSelection(typeof window !== 'undefined' ? window.location.search : '', storage),
  );

  (window as any).__tropicalHorrorArchetypes = listTropicalHorrorArchetypes().map((archetype) => ({
    id: archetype.id,
    displayName: archetype.displayName,
    title: archetype.title,
    subtitle: archetype.subtitle,
    weaponIds: [...archetype.spawn.weapons],
  }));
  (window as any).__selectTropicalHorrorArchetype = (rawArchetypeId: unknown) => {
    selectedArchetypeId = applyLocalArchetypeSelection(rawArchetypeId);
    return getTropicalHorrorArchetype(selectedArchetypeId);
  };

  const engineController = Engine.getEngineController();
  if (!engineController) {
    throw new Error('EngineController not initialized');
  }

  const networkSyncSystem = Engine.getNetworkSyncSystem();
  if (!networkSyncSystem) {
    throw new Error('NetworkSyncSystem not initialized');
  }

  const liveCullingSystem = Engine.getCullingSystem();
  if (!liveCullingSystem) {
    throw new Error('CullingSystem not initialized');
  }

  const appSystemContext = Engine.getSystemContext();
  if (!appSystemContext) {
    throw new Error('Engine system context not initialized');
  }

  const debugManager = initDebugManager();
  const replaySystem = new ReplaySystem();
  const undoRedoSystem = new UndoRedoSystem();
  const modeManager = Engine.getModeManger?.() ?? null;
  // gameHUD will be created by Phase 5
  const gameModeManager = new GameModeManager(stateManager);
  const engineGameModes = new GameModeSystem();
  const saveLoadManager = Engine.getSaveLoadManager();

  // ─ DEBUG MENU: Initialize F6-toggled debug UI
  initDebugMenu();
  
  // ─ EXPOSE ENGINE: Make Engine available to debug menu and global scope
  (window as any).__Engine = Engine;

  // gameHUD will be mounted by Phase 5

  let pendingMatchResetMode: 'soft' | 'full' = 'full';
  let runtimeMetricsReporter: RuntimeMetricsReporter | null = null;
  let prefabSystem!: PrefabSystem;
  let hordeSystem!: HordeSystem;
  let spawnSystem!: SpawnSystem;
  let scriptedLevelSystem: ScriptedLevelSystem | null = null;
  let sessionLifecycleCoordinator!: SessionLifecycleCoordinator;
  let gameLaunchCoordinator!: GameLaunchCoordinator;
  let multiplayerRuntime!: MultiplayerRuntimeCoordinator;
  let auxiliaryAssembly!: RuntimeAuxiliaryAssembly;
  let worldRuntime!: ClientWorldRuntimeCoordinator;
  let lifecycleOrchestrator: LifecycleOrchestrator | null = null;
  let gameHUD!: HUDSystem;
  let inventorySystem!: InventorySystem;
  const runtimeTeardownRegistry = new TeardownRegistry();

  // Create minimal Phase context for phases
  const phaseCtx = {
    stateManager,
    systemContext: Engine.getSystemContext()!,
    engineController: Engine.getEngineController(),
    listenerRegistry: new EventListenerRegistry(),
  };
  runtimeTeardownRegistry.register(phaseCtx.listenerRegistry);

  // Store phase results for hot reload capability
  const phaseResults = new Map<string, any>();

  // Execute Phase 4: Networking Runtime FIRST (Phase 3 needs mpClient)
  const phase4Result = Phase4_NetworkingRuntime(phaseCtx);
  phaseResults.set('phase4', phase4Result);
  runtimeTeardownRegistry.register(phase4Result);
  
  // Register Phase 4 systems
  const systemRegistry = Engine.getSystemRegistry();
  (window as any).__engine = {
    registry: systemRegistry,
    eventBus: gameBus,
    getSystemRegistry: () => Engine.getSystemRegistry(),
    getBootstrapState: () => (window as any).__bootstrapState ?? null,
  };

  (window as any).__runTier0Tests = async function() {
    const { tier0ValidationSuite } = await import('../testing/Tier0ValidationSuite');
    return tier0ValidationSuite.runAllTests();
  };

  console.log('[Titan Engine] __runTier0Tests exposed to window');

  if (systemRegistry) {
    Object.entries(phase4Result.systems).forEach(([id, system]) => {
      Engine.registerRuntimeSystem(id, system, 'phase4');
    });
    console.log('[Phase 4] ✓ Registered Phase 4 systems via registry');
  }

  // Extract networking systems for use in bootstrap
  const mpClient = phase4Result.systems.multiplayerClient as MultiplayerClient;
  const collisionAuthoritySystem = phase4Result.systems.collisionAuthority as CollisionAuthoritySystem;
  engineGameModes.setSpawnLoadoutResolver((playerId, baseLoadout) => {
    const activeMode = typeof stateManager.getRaw === 'function'
      ? stateManager.getRaw('game.mode')
      : stateManager.get('game.mode');
    const localRuntimePlayerId = worldRuntime?.getActiveRuntimePlayerId()
      ?? mpClient.playerId
      ?? ClientWorldRuntimeCoordinator.LOCAL_FREEPLAY_PLAYER_ID;
    const shouldApplyArchetype = !mpClient.connected
      ? true
      : playerId === localRuntimePlayerId;

    // Freeplay should keep its base dummy/default loadout and not inherit the
    // last selected Horde/class archetype from persisted menu state.
    if (!mpClient.connected && activeMode === 'freeplay') {
      return baseLoadout;
    }

    if (!shouldApplyArchetype) {
      return baseLoadout;
    }

    const resolvedArchetypeId = resolveTropicalHorrorArchetypeId(stateManager.getRaw(SCHEMA_PATHS.PLAYER_LOCAL_ARCHETYPE))
      ?? selectedArchetypeId;
    return mergeSpawnLoadoutWithArchetype(baseLoadout, resolvedArchetypeId);
  });

  // Wire multiplayer client into system context
  Engine.attachMultiplayerClientToSystemContext(mpClient);
  mpClient.setCollisionAuthoritySystem(collisionAuthoritySystem);

  // Execute Phase 3: Gameplay Runtime (with mpClient dependency)
  const phase3Result = Phase3_GameplayRuntime(phaseCtx, mpClient);
  phaseResults.set('phase3', phase3Result);
  runtimeTeardownRegistry.register(phase3Result);
  
  // Register Phase 3 systems
  if (systemRegistry) {
    Object.entries(phase3Result.systems).forEach(([id, system]) => {
      Engine.registerRuntimeSystem(id, system, 'phase3');
    });
    console.log('[Phase 3] ✓ Registered Phase 3 systems via registry');
  }

  // Extract systems for use in rest of bootstrap (backwards compatibility)
  const playerModelSystem = phase3Result.systems.playerModel as PlayerModelSystem;
  const menuIdentitySystem = phase3Result.systems.menuIdentity as MenuIdentitySystem;
  const characterActorSystem = phase3Result.systems.characterActor as CharacterActorSystem;
  const physicsSystem = phase3Result.systems.physics as PhysicsSystem;
  const healthSystem = phase3Result.systems.health as HealthSystem;
  const objectCreator = phase3Result.systems.objectCreator as ObjectCreatorSystem;
  prefabSystem = phase3Result.systems.prefab as PrefabSystem;
  spawnSystem = phase3Result.systems.spawn as SpawnSystem;
  const weaponSystem = phase3Result.systems.weapon as WeaponSystem;
  const abilitySystem = phase3Result.systems.ability as AbilitySystem;
  const foliageSystem = phase3Result.systems.foliage as FoliageSystem;
  
  // Additional setup for extracted systems
  weaponSystem.registerPresets();

  // Execute Phase 5: UI Runtime (with Phase 3 dependencies)
  const phase5Result = Phase5_UIRuntime(phaseCtx, healthSystem, weaponSystem, prefabSystem);
  phaseResults.set('phase5', phase5Result);
  runtimeTeardownRegistry.register(phase5Result);
  
  // Register Phase 5 systems
  if (systemRegistry) {
    Object.entries(phase5Result.systems).forEach(([id, system]) => {
      Engine.registerRuntimeSystem(id, system, 'phase5');
    });
    console.log('[Phase 5] ✓ Registered Phase 5 systems via registry');
  }

  // Extract UI systems for use in rest of bootstrap
  gameHUD = phase5Result.systems.hud as HUDSystem;
  inventorySystem = phase5Result.systems.inventory as InventorySystem;
  
  // Create materialization and level systems (not part of Phase 3 pure gameplay)
  const materialManager = new MaterialManager();
  const vfxMaker = new VFXMaker(Engine.getEngineScene()!, Engine.getEngineCamera());
  const vfxSystem = new VFXSystem(Engine.getEngineScene()!, Engine.getEngineCamera());
  const audioManager = new GameAudioManager();
  const audioSystem = new AudioSystem();
  const pathfindingSystem = new PathfindingSystem({
    cellSize: 1,
    width: 128,
    height: 128,
  });
  audioManager.registerDefaults();
  audioManager.attachCamera(Engine.getEngineCamera());
  vfxSystem.setSystemContext(appSystemContext);
  audioSystem.setSystemContext(appSystemContext);
  pathfindingSystem.setSystemContext(appSystemContext);
  scriptedLevelSystem = new ScriptedLevelSystem({
    scene: Engine.getEngineScene()!,
    prefabSystem,
    materialManager,
    vfxMaker,
    audioManager,
  });
  scriptedLevelSystem.registerLevels(V010_LEVELS);
  
  const worldObjectAuthorityService = new WorldObjectAuthorityService({
    entityManager: Engine.getEntityManager()!,
    entityRenderer: Engine.getEntityRenderer()!,
    prefabSystem: {
      createByEntityType: (...args) => prefabSystem.createByEntityType(...args),
    },
    collisionAuthority: collisionAuthoritySystem,
    stateStore: stateManager,
    readHalfExtents: (entity) => {
      const colliderData = entity.getComponent('collider')?.data as Record<string, unknown> | undefined;
      const halfExtentsData = colliderData?.halfExtents as { x?: unknown; y?: unknown; z?: unknown } | undefined;
      const colliderSize = colliderData?.size as { width?: unknown; height?: unknown; depth?: unknown; radius?: unknown; capsuleRadius?: unknown; capsuleHeight?: unknown } | undefined;
      const colliderShape = typeof colliderData?.shape === 'string' ? colliderData.shape : null;
      return halfExtentsData
        ? {
            x: readNumber(halfExtentsData.x, 0.5),
            y: readNumber(halfExtentsData.y, 0.5),
            z: readNumber(halfExtentsData.z, 0.5),
          }
        : colliderSize
          ? colliderShape === 'sphere'
            ? {
                x: readNumber(colliderSize.radius, 0.5),
                y: readNumber(colliderSize.radius, 0.5),
                z: readNumber(colliderSize.radius, 0.5),
              }
            : colliderShape === 'capsule'
              ? {
                  x: readNumber(colliderSize.capsuleRadius, 0.4),
                  y: readNumber(colliderSize.capsuleHeight, 1.2) * 0.5,
                  z: readNumber(colliderSize.capsuleRadius, 0.4),
                }
              : {
                  x: readNumber(colliderSize.width, 1) * 0.5,
                  y: readNumber(colliderSize.height, 1) * 0.5,
                  z: readNumber(colliderSize.depth, 1) * 0.5,
                }
        : getHalfExtentsFromRenderData(entity.getComponent('render')?.data as Record<string, unknown> | undefined);
    },
  });

  // Note: CharacterActorSystem needs worldRuntime which isn't available yet
  // It will need to be finalized after worldRuntime is created
  
  const weaponPresentationSystem = new WeaponPresentationSystem({
    scene: Engine.getEngineScene()!,
    getCamera: () => Engine.getEngineCamera(),
    getLocalPlayerId: () => worldRuntime.getActiveRuntimePlayerId(),
    weaponSystem,
    playerModels: playerModelSystem,
    vfxMaker,
  });
  const viewModelSystem = new ViewModelSystem({
    getCamera: () => Engine.getEngineCamera(),
    getScene: () => Engine.getEngineScene(),
    getLocalPlayerId: () => worldRuntime.getActiveRuntimePlayerId(),
  });
  const adaptiveRuntime = new AdaptiveRuntimeLayer(stateManager, Engine.getGasDataRegistry()!);
  adaptiveRuntime.loadContentPack(adaptiveRuntimePack as AdaptiveContentPack);
  adaptiveRuntime.attachDebugControls(debugManager);

  const spriteAtlasSystem = new SpriteAtlasSystem();
  const camera2DSystem = new Camera2DSystem(Engine.getEngineRenderer()!);
  const spriteAnimationSystem = new SpriteAnimationSystem(Engine.getEntityManager()!);
  const physics2DSystem = new Physics2DSystem(Engine.getEntityManager()!);
  const input2DAdapterSystem = new Input2DAdapterSystem(Engine.getEntityManager()!);
  const tilemapSystem = new TilemapSystem(Engine.getEntityManager()!);
  const parallax2DSystem = new ParallaxSystem();
  const spriteRenderSystem = new SpriteRenderSystem(Engine.getEntityManager()!);
  const ui2DSystem = new UI2DSystem(Engine.getEntityManager()!, Engine.getEngineRenderer()!);
  gameBus.emit('UI_READY', { source: 'bootstrapRuntime', systemId: 'ui2DSystem' });
  const spritePrefabExtension = new SpritePrefabExtension();

  // inventorySystem created by Phase 5
  // inventorySystem.defineDefaults() already called in Phase 5
  gameHUD.setGameplaySystems(healthSystem, weaponSystem);

  let gasBridge = new GASBridge(
    Engine.getGasDataRegistry()!,
    Engine.getGasItemSystem()!,
    Engine.getGasAttributeStore()!,
    (text, duration) => gameHUD.showNotification(text, duration),
  );

  // Kernel bridge: keep network entity IDs mapped into DOD handles for snapshot reconciliation.
  const kernelMovementIntegration = new KernelMovementIntegration();
  kernelMovementIntegration.getDamageNumberUISystem().setCamera(Engine.getEngineCamera());
  networkSyncSystem.setNetworkEntityIdRegistrar(kernelMovementIntegration.getNetworkEntityIdRegistrar());
  const dummyEnemySystem = kernelMovementIntegration.getDummyEnemySystem();
  dummyEnemySystem.setEntityManager(Engine.getEntityManager());
  dummyEnemySystem.setHealthSystem(healthSystem);
  dummyEnemySystem.setPhysicsSystem(physicsSystem);
  dummyEnemySystem.setCollisionAuthoritySystem(collisionAuthoritySystem);
  dummyEnemySystem.setPathfindingSystem(pathfindingSystem);
  spawnSystem.setEnemySpawner({
    spawnEnemy: (position, enemyType, variantId) => (
      enemyType === 'flyingMask'
        ? dummyEnemySystem.spawnFlyingMask(position.x, position.y, position.z, variantId)
        : dummyEnemySystem.spawnDummy(position.x, position.y, position.z, enemyType, variantId)
    ),
  });
  hordeSystem = new HordeSystem({
    spawnSystem,
    gameModeSystem: engineGameModes,
  });
  console.log('[RuntimeBootstrap] Active enemy runtime path: DummyEnemySystem + PathfindingSystem');

  const applyArchetypePresentation = (rawArchetypeId: unknown, options: { announce?: boolean } = {}) => {
    selectedArchetypeId = applyLocalArchetypeSelection(rawArchetypeId);
    const archetype = getTropicalHorrorArchetype(selectedArchetypeId);
    gameHUD.setArchetypePresentation(archetype);
    kernelMovementIntegration.getDamageNumberUISystem().setTheme(archetype.damageTheme);
    if (options.announce) {
      gameHUD.showNotification(`${archetype.displayName.toUpperCase()}  ·  ${archetype.title.toUpperCase()}`, 4);
    }
    return archetype;
  };

  applyArchetypePresentation(selectedArchetypeId);
  (window as any).__selectTropicalHorrorArchetype = (rawArchetypeId: unknown) => {
    const archetype = applyArchetypePresentation(rawArchetypeId, { announce: true });
    return archetype;
  };

  worldRuntime = new ClientWorldRuntimeCoordinator({
    stateManager,
    engineController,
    networkSyncSystem,
    collisionAuthoritySystem,
    worldObjectAuthorityService,
    mpClient,
    playerModelSystem,
    characterActorSystem,
    prefabSystem,
    gameHUD,
    spawnSystem,
    scriptedLevelSystem,
    camera2DSystem,
    healthSystem,
    weaponSystem,
    inventorySystem,
    gasBridge,
    abilitySystem,
    adaptiveRuntime,
    engineGameModes,
    gameModeManager,
    saveLoadManager,
    vfxMaker,
    kernelBridge: kernelMovementIntegration,
    dummyEnemySystem,
    pathfindingSystem,
  });
  runtimeTeardownRegistry.register(worldRuntime);
  worldRuntime.attachCollisionResolver();

  const inventoryHudSyncHub = new InventoryHudSyncHub({
    kernel: kernelMovementIntegration,
    getPlayerId: () => worldRuntime.getActiveRuntimePlayerId(),
    getActivePhase: () => lifecycleOrchestrator?.getPhase() ?? 'BOOT',
  });
  const dodStateBridge = new DODStateBridge({
    kernelBridge: kernelMovementIntegration,
    stateManager,
    getPlayerId: () => worldRuntime.getActiveRuntimePlayerId(),
    getActivePhase: () => lifecycleOrchestrator?.getPhase() ?? 'BOOT',
  });

  const runtimeDiagnosticsCoordinator = createRuntimeDiagnosticsCoordinator({
    defaultBaseUrl: defaultServerHttpUrl,
    search: typeof window !== 'undefined' ? window.location.search : '',
    multiplayerClient: mpClient,
    stateManager,
    renderingDiagnostics: liveCullingSystem,
    isDebugEnabled: () => debugManager.isEnabled(),
    isDebugOverlayVisible: () => Engine.getDebugOverlay()?.isVisible() === true,
  });

  const editorMenu = Engine.getEditorMenu();
  const gizmoSystem = Engine.getGizmoSystem();
  const componentInspector = Engine.getComponentInspector();
  const editorToolCoordinator = Engine.getEditorToolCoordinator();
  const prefabPlacementSystem = Engine.getPrefabPlacementSystem();
  const editorPainterSystem = Engine.getEditorPainterSystem();
  const triggerVolumeTool = Engine.getTriggerVolumeTool();
  const sceneSerializationSystem = prefabPlacementSystem
    ? new SceneSerializationSystem({
        entityManager: Engine.getEntityManager()!,
        entityRenderer: Engine.getEntityRenderer()!,
        prefabPlacementSystem,
        prefabSystem,
        worldObjectAuthorityService,
      })
    : null;
  const titanContentPipeline = saveLoadManager
    ? new TitanContentPipeline({
        saveLoadManager,
        sceneSerializationSystem,
        prefabSystem,
        spawnSystem,
        spatialGridSystem: Engine.getSpatialGridSystem(),
        entityManager: Engine.getEntityManager()!,
        entityRenderer: Engine.getEntityRenderer(),
        materialManager,
        audioManager,
        pathfindingSystem,
        environmentController: {
          setFogDensity: Engine.setEngineFogDensity,
          setFogColor: Engine.setEngineFogColor,
          setFogEnabled: Engine.setEngineFogEnabled,
        },
        editorMenu,
        getFocusPosition: () => worldRuntime?.getLocalPlayerEntity()?.getPosition()
          ?? Engine.getEngineCamera()?.position
          ?? null,
        loadRadiusCells: 1,
        streamingInterval: 0.2,
      })
    : null;
  const worldBuildService = new WorldBuildService({
    sceneSerializationSystem,
    saveLoadManager,
    sceneGraph: Engine.getSceneGraph(),
    entityManager: Engine.getEntityManager(),
    entityRenderer: Engine.getEntityRenderer(),
    snapshotSceneRoot: () => Engine.snapshotEngineSceneRoot((object) => {
      const name = object.name.toLowerCase();
      if (object.userData?.isGizmo || object.userData?.isSelectionOutline || object.userData?.editorTransient) {
        return false;
      }
      if (name.includes('gizmo') || name.includes('selection')) {
        return false;
      }
      return true;
    }),
    setSceneRoot: (root) => Engine.setSceneRoot(root),
    onWorldApplied: () => worldRuntime.onWorldBufferApplied(),
  });
  const rendererRebindService = new RendererRebindService({
    getScene: () => Engine.getEngineScene(),
    getRenderer: () => Engine.getEngineRenderer(),
  });

  prefabPlacementSystem?.setRuntimeServices({
    prefabSystem,
    physicsSystem,
    worldObjectAuthorityService,
    isMultiplayerConnected: () => mpClient.connected,
  });

  Engine.bindExternalSystemContext('componentInspector', componentInspector);
  Engine.bindExternalSystemContext('editorToolCoordinator', editorToolCoordinator);
  Engine.bindExternalSystemContext('prefabPlacementSystem', prefabPlacementSystem);
  Engine.bindExternalSystemContext('editorPainterSystem', editorPainterSystem);
  Engine.bindExternalSystemContext('triggerVolumeTool', triggerVolumeTool);
  Engine.bindExternalSystemContext('sceneSerializationSystem', sceneSerializationSystem);
  Engine.bindExternalSystemContext('worldBuildService', worldBuildService);
  Engine.bindExternalSystemContext('titanContentPipeline', titanContentPipeline);
  Engine.bindExternalSystemContext('pathfindingSystem', pathfindingSystem);
  Engine.bindExternalSystemContext('vfxSystem', vfxSystem);
  Engine.bindExternalSystemContext('audioSystem', audioSystem);
  Engine.setContentPipeline(titanContentPipeline);
  if (titanContentPipeline) {
    Engine.registerRuntimeSystem('titanContentPipeline', titanContentPipeline, 'phase5');
  }

  const onInitialMapSync = ({ mapData }: { mapData: any }) => {
    const productionResult = titanContentPipeline?.applyNetworkProductionSync(mapData.productionSync ?? null);
    if (productionResult && !productionResult.accepted) {
      console.error('[bootstrapClientRuntime] Rejected world production sync', productionResult.reason);
      return;
    }
    sceneSerializationSystem?.deserializeScene(mapData, {
      authority: 'replicated',
      skipAuthoritySync: true,
    });
  };
  mpClient.on('initial_map_sync', onInitialMapSync);
  runtimeTeardownRegistry.register(() => {
    mpClient.off('initial_map_sync', onInitialMapSync);
  });

  runtimeTeardownRegistry.register(gameBus.on('ABILITY_PROJECTILE_SPAWNED', (payload: { abilityId?: string; position?: { x: number; y: number; z: number } }) => {
    if (payload.abilityId !== 'ability_fireball' || !payload.position) {
      return;
    }

    vfxSystem.playPreset('spawnBurst', payload.position);
  }));

  runtimeTeardownRegistry.register(gameBus.on('ABILITY_PROJECTILE_IMPACT', (payload: { abilityId?: string; position?: { x: number; y: number; z: number } }) => {
    if (payload.abilityId !== 'ability_fireball' || !payload.position) {
      return;
    }

    vfxSystem.playPreset('fireballImpactBurst', payload.position);
    audioSystem.playOneShotAt('fireball_impact', payload.position, {
      category: 'weapon',
      volume: 0.18,
      maxDist: 28,
      toneHz: 220,
      toneDurationMs: 220,
      waveform: 'sawtooth',
    });
  }));

  const runtimeOverlayCoordinator = new RuntimeOverlayCoordinator({
    debugManager,
    engineController,
    modeManager,
    mpClient,
    runtimeDiagnosticsCoordinator,
    liveCullingSystem,
    gameHUD,
    audioManager,
    gameModeManager,
    engineGameModes,
    runtimeMetricsReporterRef: () => runtimeMetricsReporter,
    buildRuntimeIssueSnapshot: () => multiplayerRuntime.buildRuntimeIssueSnapshot() as unknown as Record<string, unknown>,
    physicsSystem,
    getActiveRuntimePlayerId: () => worldRuntime.getActiveRuntimePlayerId(),
    syncLocalPlayerToAuthoritativeSpawn: (position, rotation) => {
      worldRuntime.syncLocalPlayerToAuthoritativeSpawn(position, rotation);
    },
    worldObjectAuthorityService,
    spawnSystem,
    inventorySystem,
    weaponSystem,
    undoRedoSystem,
    prefabSystem,
    saveLoadManager,
    replaySystem,
    networkSyncSystem,
    editorMenu,
    syncEditorPrefabLibrary: () => editorAuthorityCoordinator.syncEditorPrefabLibrary(),
    setLastEditorSnapshot: (snapshot) => editorAuthorityCoordinator.setLastEditorSnapshot(snapshot),
    search: typeof window !== 'undefined' ? window.location.search : '',
    serverHttpUrl: multiplayerRuntime?.getServerHttpUrl?.() ?? defaultServerHttpUrl,
    serverWsUrl: defaultServerWsUrl,
    launchActions: {
      startLocalFreeplay: () => gameLaunchCoordinator.startLocalFreeplay(),
      startEngineShowcase: () => gameLaunchCoordinator.startEngineShowcase(),
      startScriptedLevel: (levelId) => gameLaunchCoordinator.startScriptedLevel(levelId),
      hostMultiplayer: (config) => multiplayerRuntime.hostLobby(config),
      joinMultiplayer: (config) => multiplayerRuntime.joinLobby(config),
    },
    createUiCompositionCoordinator: () => createRuntimeUiCompositionCoordinator({
      modeManager,
      engineController,
      mpClient,
      gameLaunchCoordinator,
      audioManager,
      worldRuntime,
      multiplayerRuntime,
      scriptedLevelSystem,
      engineGameModes,
      menuIdentitySystem,
      debugManager,
      lifecycleOrchestrator: lifecycleOrchestrator!,
      worldBuildService,
      rendererRebindService,
      undoRedoSystem,
    }),
    auxiliaryAssemblyRef: () => auxiliaryAssembly,
    worldRuntime,
  });
  runtimeTeardownRegistry.register(() => runtimeOverlayCoordinator.destroy());

  const hitFeedbackBridge = runtimeOverlayCoordinator.getHitFeedbackBridge();
  hitFeedbackBridge.setCrosshairVisible(false);

  multiplayerRuntime = createMultiplayerRuntimeCoordinator({
    engineController,
    mpClient,
    networkSyncSystem,
    playerModelSystem,
    weaponSystem,
    healthSystem,
    gameModeManager,
    gameHUD,
    worldRuntime,
    runtimeDiagnosticsCoordinator,
    liveCullingSystem,
    hitFeedback: hitFeedbackBridge,
    overlayRuntime: runtimeOverlayCoordinator,
  });
  runtimeTeardownRegistry.register(multiplayerRuntime);
  worldRuntime.setStopInputSending(() => multiplayerRuntime.stopInputSending());

  lifecycleOrchestrator = new LifecycleOrchestrator({
    getLocalPlayerId: () => worldRuntime.getActiveRuntimePlayerId() ?? mpClient.playerId ?? null,
    getLocalPlayerEntity: () => worldRuntime.getLocalPlayerEntity(),
    hasFullNetworkSync: () => {
      if (!mpClient.connected) return true;
      return networkSyncSystem.getLastAppliedSnapshotTick() !== null;
    },
    // Boot-lock: SPAWN_READY and PLAY_ACTIVE are blocked until the state tree
    // has been pre-filled by hydrateStateManager().
    isStateHydrated: () => stateManager.isHydrated,
  });
  runtimeTeardownRegistry.register(lifecycleOrchestrator);
  lifecycleOrchestrator.tryTransitionTo('NETWORK_SYNC');
  (window as any).lifecycleOrchestrator = lifecycleOrchestrator;

  // ─ SAFE-INPUT-GATING: Link orchestrator and canvas to PlayController ─
  {
    const pc = Engine.getPlayController();
    if (pc) {
      pc.setOrchestrator(lifecycleOrchestrator);
      const rendererCanvas = Engine.getEngineRenderer()?.domElement as HTMLCanvasElement | undefined;
      if (rendererCanvas) {
        pc.setCanvas(rendererCanvas);
      }
      console.debug('[bootstrapClientRuntime] PlayController linked with LifecycleOrchestrator and canvas');
    }
  }
  runtimeTeardownRegistry.register(gameBus.on('LIFECYCLE_CHANGED', ({ to }) => {
    if (to !== 'PLAY_ACTIVE' && to !== 'LOBBY') {
      return;
    }
    const isLobbyRefresh = to === 'LOBBY';
    const runtimeLocalPlayerId = worldRuntime.getActiveRuntimePlayerId() ?? mpClient.playerId ?? null;
    const scopedPath = runtimeLocalPlayerId ? SCHEMA_PATHS.playerAppearance(runtimeLocalPlayerId) : null;
    const scopedAppearance = scopedPath ? stateHydrationGuard.read(scopedPath) : undefined;
    const localAppearance = stateHydrationGuard.read(SCHEMA_PATHS.PLAYER_LOCAL_APPEARANCE);

    if (localAppearance === STATE_LOADING || scopedAppearance === STATE_LOADING) {
      if (!isLobbyRefresh) {
        Engine.getEngineController()?.setHudMode('loading', 'state-loading');
        Engine.getEngineController()?.setHudVisible(false, 'state-loading');
      }
      return;
    }

    selectedArchetypeId = applyLocalArchetypeSelection(stateManager.getRaw(SCHEMA_PATHS.PLAYER_LOCAL_ARCHETYPE));
    applyArchetypePresentation(selectedArchetypeId, { announce: true });

    const resolvedAppearance = (localAppearance
      ?? scopedAppearance
      ?? cloneTropicalHorrorArchetypeAppearance(selectedArchetypeId)) as unknown;

    if (resolvedAppearance !== undefined && resolvedAppearance !== null) {
      stateManager.set(SCHEMA_PATHS.LOBBY_LOCAL_PLAYER_APPEARANCE, resolvedAppearance);
      stateManager.set(SCHEMA_PATHS.PLAYER_LOCAL_APPEARANCE, resolvedAppearance);
      if (!isLobbyRefresh) {
        Engine.getEngineController()?.setHudMode('play', 'state-ready');
      }
    } else {
      // RECOVERY_WARNING: appearance was not set despite hydration — hydrateStateManager
      // should have pre-filled this path. Log and continue rather than crashing.
      gameBus.emit('LOG_STATE_MISSING_WARNING', {
        path: SCHEMA_PATHS.PLAYER_LOCAL_APPEARANCE,
        usedSchemaDefault: false,
        recoveryValue: null,
        timestamp: Engine.time.now(),
      });
      console.warn('[BootstrapRuntime] RECOVERY_WARNING: player.local.appearance missing at PLAY_ACTIVE.', {
        playerId: runtimeLocalPlayerId,
        scopedPath,
        phase: to,
      });
    }
  }));
  runtimeTeardownRegistry.register(gameBus.on('UI_LOADING_STATE', ({ reason, path }) => {
    Engine.getEngineController()?.setHudMode('loading', 'state-loading');
    Engine.getEngineController()?.setHudVisible(false, 'state-loading');
    console.warn('[StateHydrationGuard] UI in loading state', { reason, path });
  }));
  runtimeTeardownRegistry.register(gameBus.on('LIFECYCLE_PLAY_ACTIVE', ({ playerId, entityId, timestamp }) => {
    console.log('[LifecycleTrace] PLAY_ACTIVE reached', {
      playerId,
      entityId,
      eventTimestamp: timestamp,
      receivedAt: Engine.time.now(),
      perfNow: typeof performance !== 'undefined' ? performance.now() : null,
    });
  }));

  auxiliaryAssembly = createRuntimeAuxiliaryAssembly({
    engineController,
    stateManager,
    replaySystem,
    mpClient,
    networkSyncSystem,
    gameHUD,
    gameModeManager,
    engineGameModes,
    playerModelSystem,
    viewModelSystem,
    weaponPresentationSystem,
    characterActorSystem,
    runtimeDiagnosticsCoordinator,
    worldRuntime,
    multiplayerRuntime,
    healthSystem,
    weaponSystem,
    inventorySystem,
    prefabSystem,
    adaptiveRuntime,
    audioManager,
    audioSystem,
    vfxMaker,
    vfxSystem,
    abilitySystem,
    hordeSystem,
    pathfindingSystem,
    spatialGridSystem: Engine.getSpatialGridSystem()!,
    visibilitySystem: Engine.getVisibilitySystem()!,
    contentPipeline: titanContentPipeline,
    getFocusPosition: () => {
      const localPlayerPosition = worldRuntime?.getLocalPlayerEntity()?.getPosition();
      if (localPlayerPosition) {
        return localPlayerPosition;
      }
      const camera = Engine.getEngineCamera();
      return camera
        ? { x: camera.position.x, y: camera.position.y, z: camera.position.z }
        : null;
    },
    netGraphBridge: runtimeOverlayCoordinator.getNetGraphBridge(),
    hitFeedbackBridge,
    runtimeIssueInspectorBridge: runtimeOverlayCoordinator.getRuntimeIssueInspectorBridge(),
    runtimeMetricsReporterRef: () => runtimeMetricsReporter,
    worldObjectAuthorityDiagnostics: () => worldRuntime.getWorldObjectAuthorityDiagnostics(),
    spriteSystems: {
      spriteAtlasSystem: { update: () => spriteAtlasSystem.update() },
      camera2DSystem,
      spriteAnimationSystem,
      physics2DSystem,
      input2DAdapterSystem,
      tilemapSystem,
      parallax2DSystem,
      spriteRenderSystem,
      ui2DSystem,
    },
  });

  const editorAuthorityCoordinator = createEditorAuthorityCoordinator({
    prefabSystem,
    spawnSystem,
    mpClient,
    undoRedoSystem,
    saveLoadManager,
    worldObjectAuthorityService,
    worldRuntime,
    editorMenu,
    gizmoSystem,
  });

  sessionLifecycleCoordinator = createSessionLifecycleCoordinator({
    engineController,
    stateManager,
    gameModeManager,
    gameHUD,
    worldRuntime,
    multiplayerRuntime,
    runtimeOverlayCoordinator,
    auxiliaryAssembly,
    networkSyncSystem,
    weaponSystem,
    playerModelSystem,
    worldObjectAuthorityService,
    engineGameModes,
    mpClient,
    debugManager,
    setPendingMatchResetMode: (mode) => {
      pendingMatchResetMode = mode;
    },
  });

  gameLaunchCoordinator = createGameLaunchCoordinator({
    engineController,
    mpClient,
    stateManager,
    worldRuntime,
    playerModelSystem,
    worldObjectAuthorityService,
    spawnSystem,
    gameHUD,
    engineGameModes,
    gameModeManager,
    sessionLifecycleCoordinator,
    scriptedLevelSystem,
    multiplayerRuntime,
    audioManager,
    setPendingMatchResetMode: (mode) => {
      pendingMatchResetMode = mode;
    },
    lifecycleOrchestrator,
    worldBuildService,
  });

  const phase6Result = bootstrapPhase6_CoordinatorWiring(
    phaseCtx,
    {
      multiplayerRuntime,
      sessionLifecycleCoordinator,
      gameLaunchCoordinator,
      editorAuthorityCoordinator,
      auxiliaryAssembly,
    },
    () => {
      completePhase6CoordinatorWiring({
        gameLaunchCoordinator,
        multiplayerRuntime,
        prefabSystem,
        inventorySystem,
        phaseResults,
        phaseCtx,
        systemRegistry,
        healthSystem,
        weaponSystem,
        mpClient,
        gameHUD,
        gasBridge,
        sessionLifecycleCoordinator,
        editorAuthorityCoordinator,
        auxiliaryAssembly,
        worldObjectAuthorityService,
        kernelMovementIntegration,
      });
    },
  );
  phaseResults.set('phase6', phase6Result);

  const dodInspectorPlugin = new DODInspectorPlugin();
  const editorShellPlugin = new EditorShellPlugin();
  const authPlugin = new AuthPlugin();
  const runtimeMixerPlugin = new RuntimeMixerPlugin();

  registerRuntimeSystems({
    mpClient,
    gameModeManager,
    gameHUD,
    stateManager,
    systemContext: appSystemContext,
    collisionAuthoritySystem,
    worldObjectAuthorityService,
    characterActorSystem,
    physicsSystem,
    spriteAtlasSystem,
    camera2DSystem,
    featureManager: FeatureManager,
    gameModeSystem: engineGameModes,
    playerModelSystem,
    weaponSystem,
    healthSystem,
    physics2DSystem,
    input2DAdapterSystem,
    spriteAnimationSystem,
    objectCreator,
    prefabSystem,
    abilitySystem,
    weaponPresentationSystem,
    spawnSystem,
    hordeSystem,
    undoRedoSystem,
    inventorySystem,
    tilemapSystem,
    parallax2DSystem,
    spriteRenderSystem,
    foliageSystem,
    ui2DSystem,
    adaptiveRuntime,
    materialManager,
    audioManager,
    audioSystem,
    vfxSystem,
    pathfindingSystem,
    debugManager,
    dodInspectorPlugin,
    editorShellPlugin,
    authPlugin,
    runtimeMixerPlugin,
    scriptedLevelSystem,
  });

  setupGameModeContext({
    engineGameModes,
    gameModeManager,
    worldRuntime,
    healthSystem,
    spawnSystem,
    playerModelSystem,
    stateManager,
  });

  registerSaveLoadHandlers({
    saveLoadManager,
    weaponSystem,
    inventorySystem,
    prefabSystem,
    spawnSystem,
    engineGameModes,
  });

  engineController.registerSystems({
    scoreboard: runtimeOverlayCoordinator.getScoreboardBridge(),
    auxiliarySystems: {
      inventoryHudSyncHub,
      dodStateBridge,
    },
  });

  gameModeManager.attachClient(mpClient);
  runtimeOverlayCoordinator.installIssueInspectorHotkey();
  runtimeOverlayCoordinator.installValidationHook();
  runtimeOverlayCoordinator.installMemoryValidationHook();
  runtimeOverlayCoordinator.installStatusMovementDebugHook();
  runtimeOverlayCoordinator.registerLazyBindings();
  runtimeOverlayCoordinator.prewarmPersistedServerBrowser();
  runtimeOverlayCoordinator.startRuntimeUi();

  bootstrapRuntimeMetricsReporter({
    runtimeDiagnosticsCoordinator,
    sessionLifecycleCoordinator,
    liveCullingSystem,
    worldRuntime,
    multiplayerRuntime,
    setRuntimeMetricsReporter: (reporter: RuntimeMetricsReporter) => {
      runtimeMetricsReporter = reporter;
    },
  });

  bootstrapRuntimeEventHandlers({
    worldRuntime,
    weaponSystem,
    stateManager,
    networkSyncSystem,
    mpClient,
    gameModeManager,
    replaySystem,
    debugManager,
    runtimeOverlayCoordinator,
    gasBridge,
  });

  bootstrapDebugTestEntitiesIfEnabled();

  // TODO: Temporarily disabled TITAN Benchmark Overlay for Phase 5 gameplay
  // const benchmarkOverlay = new TitanBenchmarkOverlay();
  // const kernel = kernelMovementIntegration.getKernel();
  // const dummyEnemySystem = kernelMovementIntegration.getDummyEnemySystem();
  // benchmarkOverlay.setKernel(kernel);
  // benchmarkOverlay.setDummyEnemySystem(dummyEnemySystem);
  // kernel.setDummyEnemySystem(dummyEnemySystem);
  // Re-enable with: window.__benchmarkOverlay = benchmarkOverlay;

  // v0.1.4 Kernel Validation Test - DOD_HealthBufferTest.ts auto-registers global __DODHealthBufferTest
  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    Engine.timer.setTimeout(() => {
      if ((window as any).__DODHealthBufferTest?.runAllSteps) {
        console.log('[Titan Engine] ▶️ Starting v0.1.4 kernel validation...');
        (window as any).__DODHealthBufferTest.runAllSteps();
      }
    }, 500);
  }

  const teardownRuntimeForMemoryAudit = (): void => {
    runtimeTeardownRegistry.dispose();
  };

  (window as any).__teardownRuntimeForMemoryAudit = teardownRuntimeForMemoryAudit;

  (window as any).__validateReloadMemoryGate = async (
    options?: {
      phaseId?: string;
      reloadCount?: number;
      settleMs?: number;
      sampleCount?: number;
      sampleGapMs?: number;
      thresholdBytes?: number;
    },
  ) => {
    const perf = performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };
    if (!perf.memory || typeof perf.memory.usedJSHeapSize !== 'number') {
      throw new Error('performance.memory.usedJSHeapSize is unavailable in this browser context');
    }

    const phaseId = options?.phaseId ?? 'phase3';
    const reloadCount = Math.max(2, options?.reloadCount ?? 5);
    const settleMs = Math.max(50, options?.settleMs ?? 350);
    const sampleCount = Math.max(1, options?.sampleCount ?? 3);
    const sampleGapMs = Math.max(10, options?.sampleGapMs ?? 75);
    const thresholdBytes = Math.max(1, options?.thresholdBytes ?? (2 * 1024 * 1024));
    const delay = (ms: number) => new Promise<void>((resolve) => Engine.timer.setTimeout(resolve, ms));

    const samples: Array<{ reload: number; usedJSHeapSize: number }> = [];

    const sampleHeap = async (reload: number): Promise<void> => {
      let total = 0;
      for (let i = 0; i < sampleCount; i++) {
        if (typeof (window as any).gc === 'function') {
          (window as any).gc();
        }
        total += perf.memory!.usedJSHeapSize;
        if (i < sampleCount - 1) {
          await delay(sampleGapMs);
        }
      }
      samples.push({
        reload,
        usedJSHeapSize: Math.round(total / sampleCount),
      });
    };

    for (let reload = 1; reload <= reloadCount; reload++) {
      await (window as any).__reloadPhase?.(phaseId);
      await delay(settleMs);
      await sampleHeap(reload);
    }

    const first = samples[0]?.usedJSHeapSize ?? 0;
    const last = samples[samples.length - 1]?.usedJSHeapSize ?? 0;
    const deltaBytes = last - first;
    const gatePassed = deltaBytes < thresholdBytes;
    const report = {
      phaseId,
      thresholdBytes,
      gatePassed,
      firstBytes: first,
      lastBytes: last,
      deltaBytes,
      deltaMb: Number((deltaBytes / (1024 * 1024)).toFixed(3)),
      samples,
      generatedAt: Engine.time.date().toISOString(),
    };

    console.table(samples.map((sample) => ({
      reload: sample.reload,
      usedMB: Number((sample.usedJSHeapSize / (1024 * 1024)).toFixed(3)),
    })));
    console.log('[MemoryGate]', report);
    return report;
  };

  Engine.start();

  const gameplayDebugAutostart = parseGameplayDebugAutostart();
  if (gameplayDebugAutostart.enabled) {
    if (gameplayDebugAutostart.backend) {
      (globalThis as any).__physicsBackend = gameplayDebugAutostart.backend;
      const physicsSystemRef = Engine.getSystemRegistry()?.getSystem<any>('physicsSystem');
      if (physicsSystemRef && typeof physicsSystemRef.switchBackend === 'function') {
        physicsSystemRef.switchBackend(gameplayDebugAutostart.backend);
      }
    }

    const seedLabel = gameplayDebugAutostart.seed ?? 'driftbomb-debug-seed-001';
    stateManager.set('runtime.debugSeed', seedLabel);
    gameHUD.showNotification('Drift Bomb debug autostart engaged...', 2);

    Engine.timer.setTimeout(() => {
      console.log('[DriftBombDebug] Autostart launch', {
        backend: (globalThis as any).__physicsBackend ?? 'legacy',
        seed: seedLabel,
      });
      gameLaunchCoordinator.startDriftBomb();
    }, 80);
  }

  // ===== DETERMINISM SHIM INJECTION =====
  // Injects determinism shims so Engine.time.now() and Engine.random.next() work throughout codebase
  try {
    const { injectDeterminismShim, DeterministicTimeImpl, DeterministicRandomImpl } = require('@shared/contracts');
    const deterministicTime = new DeterministicTimeImpl(undefined);
    const deterministicRandom = new DeterministicRandomImpl();
    
    injectDeterminismShim({
      time: deterministicTime,
      random: deterministicRandom,
      timer: { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis), setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis) },
    });
    
    console.log('[Determinism] Shim active - Engine.time.now() and Engine.random.next() are deterministic');
  } catch (err) {
    console.warn('[Determinism] Shim injection failed:', err);
  }

  // ===== TIER 2 SDK SETUP =====
  // Create the public-facing SDK interfaces for plugin system
  try {
    const internalSystemRegistry = Engine.getSystemRegistry();
    if (!internalSystemRegistry) {
      throw new Error('SystemRegistry not initialized');
    }

    // Create public SDK components
    const publicSystemRegistry = new PublicSystemRegistry(internalSystemRegistry as any);
    const publicEventBus = new PublicEventBus(gameBus as any);
    const pluginRegistry = new PluginRegistry();
    const gameEngineSdk = exposeGameEngineSDK(
      new GameEngineSDKImpl(pluginRegistry, publicSystemRegistry, publicEventBus),
    );
    pluginRegistry.register(dodInspectorPlugin);
    pluginRegistry.register(editorShellPlugin);
    pluginRegistry.register(authPlugin);
    pluginRegistry.register(runtimeMixerPlugin);
    pluginRegistry.register(new AudioPlugin());
    pluginRegistry.register(new SettingsPlugin());

    // Create plugin initialization context
    // Note: Engine.time.now() and Engine.random.next() are already shimmed to be deterministic
    const pluginContext = {
      sdk: gameEngineSdk,
      gameLoop: Engine,
      systemContext: publicSystemRegistry,
      systemRegistry: publicSystemRegistry,
      gameBus: publicEventBus,
      eventBus: publicEventBus,
      stateManager,
      mpClient,
      features: {
        isEnabled: (feature: string) => gameEngineSdk.features.isEnabled(feature),
        enable: (feature: string) => FeatureManager.enable(feature as never),
        disable: (feature: string) => FeatureManager.disable(feature as never),
      },
      config: gameEngineSdk.config,
      logger: createPluginLogger('SDK'),
    };

    void pluginRegistry.initializeAll(pluginContext).then(() => {
      console.log('[SDK] Built-in plugins initialized', pluginRegistry.getLoadedPlugins());
    });

    // Store on window for plugin access
    (window as any).__gameEngineSdk = {
      ...gameEngineSdk,
      pluginRegistry,
      systemRegistry: publicSystemRegistry,
      eventBus: publicEventBus,
      pluginContext,
    };

    // Register for cleanup
    runtimeTeardownRegistry.register(async () => {
      console.log('[SDK] Shutting down plugin system...');
      await pluginRegistry.unloadAll();
      gameEngineSdk.dispose?.();
      pluginRegistry.dispose();
      publicSystemRegistry.dispose();
      publicEventBus.dispose();
    });

    console.log('[SDK] Tier 2 SDK initialized - Plugin system ready');
  } catch (err) {
    console.error('[SDK] Failed to initialize plugin system:', err);
  }

  void pendingMatchResetMode;
  console.log('[App] Application ready for authoritative multiplayer');
}
