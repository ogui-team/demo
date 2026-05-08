import * as THREE from 'three';
import { initScene, getScene } from '../../2-systems/render/Scene';
import { initCamera, updateCameraAspect, getCamera } from '../../2-systems/render/Camera';
import { initRenderer, render, setRendererSize, getRenderer } from '../../2-systems/render/Renderer';
import { initLights, updateGlobalSunlight } from '../../2-systems/render/Lights';
import { initFog, setFogDensity, setFogColor } from '../../2-systems/render/Fog';
import { startGameLoop, stopGameLoop, onUpdate, onRender } from './GameLoop';
import { initAtmosphericEffects, getAtmosphereManager } from '../../2-systems/render/AtmosphericEffects';
import { getCameraAuthority, getCameraStateAdapter, initCameraStateAdapter, setCameraAuthority, setCameraAuthorityController } from '../../2-systems/camera/CameraStateAdapter';
import { PS1RenderingPipeline } from '../../2-systems/render/PS1RenderingPipeline';
import { CrunchyModernPipeline } from '../../2-systems/render/CrunchyModernPipeline';
import { runtimeFrameCostProfiler } from '../../4-runtime/diagnostics/debug/FrameCostProfiler';
import { LocalNetworkTransport } from '../../3-network/network/NetworkTransport';
import { initGameConsole, getGameConsole, GameConsole } from '../../4-runtime/editor/Console';
import { InputRouter } from '@engine/1-kernel/core/public-api';
import { EngineDiagnostics } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { orchestrateCorridorManifest } from './CorridorOrchestrator';
import { DebugOverlay } from '../../4-runtime/ui/DebugOverlay';
import { ControlTower } from '../../4-runtime/runtime/ControlTower';
import { InventoryGridUI } from '../../4-runtime/ui/InventoryGridUI';
import { logEvent } from '@engine/1-kernel/core/public-api';
import { normalizeAvatarAppearance } from '../../2-systems/gameplay/game/AvatarBuilder';
import {
  initModeManager,
  getModeManager,
  EditorController,
  ComponentInspector,
  PlayController,
  initStateManager,
  getStateManager,
  EntityManager,
  EntityRenderer,
  SaveLoadManager,
  TransformSystem,
  SceneGraph,
  EditorMenu,
  SelectionSystem,
  GizmoSystem,
  EditorToolCoordinator,
  PrefabPlacementSystem,
  EditorPainterSystem,
  TriggerVolumeTool,
  NetworkManager,
  NetworkSyncSystem,
  ReplicationSystem,
  FeatureManager,
  EngineController,
  AppState,
  InputManager,
  SystemWatchdog,
  getSystem,
  registerSystemMetadata,
  bindSystemContext,
  createNetworkFacade,
  createReplicationFacade,
  createSystemAccessProxy,
  type SystemContext,
  type SystemCapabilities,
  PhysGunSystem,
  InteractionManager,
  PickupSystem,
  InventoryGridManager,
  ToolbarSystem,
  DataRegistry,
  EntityAttributeStore,
  EffectSystem,
  ItemInstanceSystem,
  ResourceManager,
  SpatialPartitionSystem,
  CullingSystem,
  SpatialGridSystem,
  VisibilitySystem,
  SimulationActivationSystem,
} from '../../4-runtime/runtime/BootstrapKit';
import { LightingSystem } from '../../2-systems/gameplay/systems/LightingSystem';
import { createCapsuleCollider } from '../../2-systems/gameplay/game/components/ColliderComponent';
import { createSpotLightComponent } from '../../2-systems/gameplay/systems/components/LightComponent';
import { runRuntimeCapabilityAuditHook } from '../../4-runtime/audit/RuntimeCapabilityAudit';
import { SpatialRuntimeDebugHud } from '../../4-runtime/runtime/SpatialRuntimeDebugHud';
import type { SavedWorldState } from '../../1-kernel/core/SaveLoadManager';
import { initRuntimePerformanceMode, getRuntimePerformanceMode, RuntimePerformanceMode } from '@engine/1-kernel/core/public-api';
import { createInitialEngineState } from './state/engineInitialState';
import { SystemRegistry } from '../../1-kernel/kernel/SystemRegistry';

/*
 * Audit bootstrap markers for singleton or indirectly bootstrapped systems.
 * new Engine()
 * new ModeManager()
 * new StateManager()
 * new FeatureManagerClass()
 * new MetadataStore()
 * new HighlightSystem()
 */

/**
 * Engine module
 * Main orchestration of all engine systems
 */

export interface EngineConfig {
  fogDensity?: number;
  fogColor?: number;
  ambientLightIntensity?: number;
  directionalLightIntensity?: number;
}

export interface EngineInstance {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
}

interface ContentPipelineAdapter {
  saveMap(name: string): boolean;
  loadMap(name: string): { success: boolean; entitiesCreated: number; settingsApplied: number };
  listMaps(): string[];
  deleteMap(name: string): boolean;
  exportMap(name?: string): string;
  importMap(json: string, name?: string): { success: boolean; entitiesCreated: number; settingsApplied: number };
  getMapInfo?(name: string): SavedWorldState | null;
  getDebugState?(): Record<string, unknown>;
}

let isInitialized = false;
let isStarted = false;
const config: Required<EngineConfig> = {
  fogDensity: 0.08,
  fogColor: 0x1a1a1a,
  ambientLightIntensity: 0.6,
  directionalLightIntensity: 1.0,
};

// Mode system instances
let modeManager: ReturnType<typeof initModeManager> | null = null;
let editorController: EditorController | null = null;
let playController: PlayController | null = null;
let renderingPipeline: PS1RenderingPipeline | null = null;
let crunchyModernPipeline: CrunchyModernPipeline | null = null;
let baseSceneRenderTarget: THREE.WebGLRenderTarget | null = null;
let useCrunchyModernPipeline: boolean = false; // Toggle between pipelines

// Entity system instances
let entityManager: EntityManager | null = null;
let entityRenderer: EntityRenderer | null = null;
let selectionSystem: SelectionSystem | null = null;
let gizmoSystem: GizmoSystem | null = null;
let componentInspector: ComponentInspector | null = null;
let editorToolCoordinator: EditorToolCoordinator | null = null;
let prefabPlacementSystem: PrefabPlacementSystem | null = null;
let editorPainterSystem: EditorPainterSystem | null = null;
let triggerVolumeTool: TriggerVolumeTool | null = null;
let sceneGraph: SceneGraph | null = null;

// Network system instances
let networkManager: NetworkManager | null = null;
let networkSyncSystem: NetworkSyncSystem | null = null;
let replicationSystem: ReplicationSystem | null = null;
let resourceManager: ResourceManager | null = null;
let spatialPartitionSystem: SpatialPartitionSystem | null = null;
let cullingSystem: CullingSystem | null = null;
let spatialGridSystem: SpatialGridSystem | null = null;
let visibilitySystem: VisibilitySystem | null = null;
let simulationActivationSystem: SimulationActivationSystem | null = null;
let lightingSystem: LightingSystem | null = null;
let spatialRuntimeDebugHud: SpatialRuntimeDebugHud | null = null;

// Save/Load system instances
let saveLoadManager: SaveLoadManager | null = null;
let contentPipeline: ContentPipelineAdapter | null = null;

// Transform system instances
let transformSystem: TransformSystem | null = null;

// Editor system instances
let editorMenu: EditorMenu | null = null;

// Console instance
let gameConsole: GameConsole | null = null;

// PhysGun system instance
let physGunSystem: PhysGunSystem | null = null;

// Local player entity ID for debug features (torch toggle)
let localPlayerEntityId: string = '';

// Interaction + pickup system instances
let interactionManager: InteractionManager | null = null;
let pickupSystem: PickupSystem | null = null;

// Frame counter for debugging
let frameCount = 0;

// Inventory system instances
let inventoryGridManager: InventoryGridManager | null = null;
let inventoryGridUI: InventoryGridUI | null = null;
let toolbarSystem: ToolbarSystem | null = null;
let preferredRuntimePlayerId: string | null = null;

// GAS (Gameplay Ability System) instances
let gasDataRegistry: DataRegistry | null = null;
let gasAttributes: EntityAttributeStore | null = null;

function suspendRuntimeLifecycle(): void {
  inputManager?.disable();
  disablePlayRuntimeLifecycle();
  disableEditorRuntimeLifecycle();
}

function resumeRuntimeLifecycle(): void {
  inputManager?.enable();
  if (getEngineMode() === 'play') {
    enablePlayRuntimeLifecycle(false);
    return;
  }
  enableEditorRuntimeLifecycle();
}

function enableEditorRuntimeLifecycle(): void {
  editorController?.enable();
  playController?.disable();
  selectionSystem?.enable();
}

function disableEditorRuntimeLifecycle(resetReason?: string): void {
  editorController?.disable();
  selectionSystem?.disable();
  if (resetReason) {
    editorToolCoordinator?.reset(resetReason);
  }
  editorPainterSystem?.disable();
  triggerVolumeTool?.disable();
}

function resolveInventoryPlayerId(): string | null {
  return preferredRuntimePlayerId ?? networkManager?.getLocalPlayerId() ?? null;
}

function enablePlayRuntimeLifecycle(initializeInventory: boolean): void {
  console.log('[Engine] Entering Play mode');
  playController?.enable();
  editorController?.disable();
  selectionSystem?.disable();
  physGunSystem?.enable();
  pickupSystem?.enable();

  if (initializeInventory && inventoryGridManager) {
    const playerId = resolveInventoryPlayerId();
    if (playerId) {
      console.log(`[Engine] Initializing inventory for player: ${playerId}`);
      inventoryGridManager.init(playerId);
    }
  }

  inventoryGridUI?.enable();
  if (toolbarSystem) {
    console.log('[Engine] Enabling toolbar system');
    toolbarSystem.setPhysGunCallbacks(
      () => physGunSystem?.activate(),
      () => physGunSystem?.deactivate(),
    );
    toolbarSystem.enable();
  }
}

function disablePlayRuntimeLifecycle(): void {
  playController?.disable();
  physGunSystem?.disable();
  pickupSystem?.disable();
  inventoryGridUI?.disable();
  toolbarSystem?.disable();
}
let gasEffects: EffectSystem | null = null;
let gasItems: ItemInstanceSystem | null = null;

// Runtime orchestration
let engineController: EngineController | null = null;
let inputRouter: InputRouter | null = null;
let inputManager: InputManager | null = null;
let engineDiagnostics: EngineDiagnostics | null = null;
let systemWatchdog: SystemWatchdog | null = null;
let controlTower: ControlTower | null = null;
let debugOverlay: DebugOverlay | null = null;
let systemContext: SystemContext | null = null;
let systemRegistry: SystemRegistry | null = null;

/**
 * Initialize the engine with a canvas element
 */
export function init(canvasElement: HTMLCanvasElement, options: EngineConfig = {}): EngineInstance {
  if (isInitialized) {
    console.warn('Engine already initialized');
    throw new Error('Engine already initialized');
  }

  // Resolve runtime performance mode from URL / global override (before any system boots)
  initRuntimePerformanceMode();

  // Merge custom config
  Object.assign(config, options);

  // Initialize State Manager FIRST
  const initialState = createInitialEngineState(config);
  const stateManager = initStateManager(initialState);

  // Initialize core systems
  const scene = initScene();
  const camera = initCamera();
  const renderer = initRenderer(canvasElement, scene, camera);

  // Initialize additional systems
  initLights();
  initFog({
    color: config.fogColor,
    density: config.fogDensity,
  });

  // Initialize atmospheric effects
  initAtmosphericEffects({
    enableDynamicFog: false,
    enableLightingEffects: false,
    enablePostProcessing: false,
    enableCameraEffects: false,
    enableRenderingEffects: false,
  });

  // Initialize rendering pipelines (PS1 is always created for fallback)
  renderingPipeline = new PS1RenderingPipeline(renderer, scene, camera, {
    enableResolutionScaling: true,
    internalResolutionScale: 0.6,
    enableColorQuantization: true,
    colorBits: 5,
    enableDithering: true,
    ditheringIntensity: 0.25,
    enableVertexJitter: true,
    jitterAmount: 0.001,
    enableDepthFog: true,
    fogIntensity: 0.3,
    enableFilmGrain: false,
    filmGrainIntensity: 0.0,
    enableVignette: false,
    vignetteIntensity: 0.0,
  });

  // Initialize CrunchyModern pipeline
  crunchyModernPipeline = new CrunchyModernPipeline(renderer, window.innerWidth, window.innerHeight);
  console.log('[Engine] CrunchyModernPipeline instantiated');
  baseSceneRenderTarget = new THREE.WebGLRenderTarget(
    window.innerWidth,
    window.innerHeight,
    {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
    }
  );
  console.log('[Engine] Base scene render target created');
  crunchyModernPipeline.setBaseSceneRenderTarget(baseSceneRenderTarget);
  console.log('[Engine] Base scene render target set on pipeline');

  // Initialize entity system
  entityManager = new EntityManager({
    enableLogging: false,
    maxEntities: 10000,
  });

  lightingSystem = new LightingSystem(entityManager, scene, camera, {
    shadowCastDistance: 50,
    visibilityDistance: 100,
  });
  lightingSystem.start();

  // Initialize transform system
  transformSystem = new TransformSystem(stateManager);
  entityManager.setTransformSystem(transformSystem);

  // Initialize scene graph
  sceneGraph = new SceneGraph(stateManager, false);
  entityManager.setSceneGraph(sceneGraph);

  entityRenderer = new EntityRenderer(entityManager, scene, false, stateManager, null);
  cullingSystem = new CullingSystem(camera, scene, 0.1);
  cullingSystem.setEnabled(false);
  entityRenderer.setCullingSystem(cullingSystem);

  // Initialize inventory grid system
  inventoryGridManager = new InventoryGridManager();
  inventoryGridUI = new InventoryGridUI(inventoryGridManager);
  toolbarSystem = new ToolbarSystem(inventoryGridManager);

  // Initialize GAS (Gameplay Ability System) subsystems
  gasDataRegistry = new DataRegistry();
  gasAttributes   = new EntityAttributeStore();
  gasEffects      = new EffectSystem(gasDataRegistry, gasAttributes);
  gasItems        = new ItemInstanceSystem(gasDataRegistry, gasEffects, null);

  // Initialize physics gun (play-mode object manipulation)
  physGunSystem = new PhysGunSystem({
    camera,
    scene,
    entityManager: entityManager!,
    entityRenderer: entityRenderer!,
    stateManager,
    // interactionManager injected below after construction
  });

  // Initialize modular interaction + highlight system
  interactionManager = new InteractionManager({
    scene,
    camera,
    entityManager: entityManager!,
    entityRenderer: entityRenderer!,
  });

  // Wire InteractionManager into PhysGun (late-inject so both are fully constructed)
  physGunSystem.setInteractionManager(interactionManager);

  // Initialize pickup system (E key — proximity-based pick-ups)
  pickupSystem = new PickupSystem({
    entityManager: entityManager!,
    interactionManager,
  });
  // Wire pickup callback to the grid inventory (server-persisted)
  pickupSystem.onPickup = (result) => {
    console.log('[Engine] Pickup callback fired:', result);
    const itemId = result.interactable.itemId;
    if (!itemId) {
      console.warn('[Engine] Pickup item has no itemId:', result.interactable);
      return;
    }

    console.log(`[Engine] Calling giveItem with: ${itemId}, quantity: ${result.interactable.quantity ?? 1}`);
    inventoryGridManager?.giveItem(itemId, result.interactable.quantity ?? 1).then((success) => {
      console.log(`[Engine] giveItem returned: ${success}`);
    });
  };

  // Wire drop event handler - spawn dropped items in the world
  // @ts-ignore - custom event not in GameEvents type
  gameBus.on('ITEM_DROPPED_FROM_INVENTORY', (data: Record<string, unknown>) => {
    console.log('[Engine] Drop event received:', data);
    const itemId = data.itemId as string;
    const quantity = (data.quantity as number) ?? 1;

    // Get player position from camera
    let dropPos = camera.position.clone();
    dropPos.y = 0;  // Drop on the ground

    // Try to get actual player position from local player entity
    if (localPlayerEntityId) {
      const localPlayer = entityManager?.getEntity(localPlayerEntityId);
      if (localPlayer) {
        const posComp = localPlayer.getComponent('position');
        if (posComp && posComp.data && typeof posComp.data === 'object') {
          const pos = posComp.data as Record<string, number>;
          dropPos.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
          console.log(`[Engine] Using local player position for drop: ${dropPos.x.toFixed(1)}, ${dropPos.y.toFixed(1)}, ${dropPos.z.toFixed(1)}`);
        }
      } else {
        console.warn(`[Engine] Local player entity not found (ID: ${localPlayerEntityId})`);
      }
    } else {
      console.warn('[Engine] Local player entity ID not set, using camera position');
    }

    // Offset the drop position slightly in front of the player
    dropPos.x += 1;
    dropPos.z += 1;

    // Spawn the dropped item as an interactable entity
    if (entityManager) {
      console.log('[Engine] Creating ground_item entity...');
      const droppedItemEntity = entityManager.createEntity('ground_item');
      console.log('[Engine] Entity created:', droppedItemEntity);
      
      if (droppedItemEntity) {
        console.log(`[Engine] Adding position component to entity ${droppedItemEntity.id}`);
        droppedItemEntity.addComponent({
          name: 'position',
          data: { x: dropPos.x, y: dropPos.y, z: dropPos.z },
        });
        
        console.log(`[Engine] Adding shape component to entity ${droppedItemEntity.id}`);
        droppedItemEntity.addComponent({
          name: 'shape',
          data: { meshType: 'box', color: 0xaabbcc, geometry: { width: 0.3, height: 0.3, depth: 0.3 } },
        });
        
        console.log(`[Engine] Adding interactable component to entity ${droppedItemEntity.id}`);
        droppedItemEntity.addComponent({
          name: 'interactable',
          data: {
            type: 'interactable',
            interactionType: 'item',
            pickupable: true,
            highlightable: true,
            itemId,
            quantity,
            prompt: `[ITEM: ${itemId}]`,
          },
        });
        console.log(`[Engine] Dropped item entity spawned successfully at (${dropPos.x.toFixed(1)}, ${dropPos.y.toFixed(1)}, ${dropPos.z.toFixed(1)}) - ${itemId} x${quantity}`);
      } else {
        console.error('[Engine] Failed to create ground_item entity - createEntity returned null');
      }
    } else {
      console.error('[Engine] entityManager is not available');
    }
  });

  // Initialize editor menu
  editorMenu = new EditorMenu({
    enableLogging: false,
    hotkey: 'q',
  });

  // Initialize save/load system
  saveLoadManager = new SaveLoadManager(entityManager, stateManager, sceneGraph, {
    enableLogging: false,
  });

  // Initialize network system
  const localPlayerId = `player_${Math.random().toString(36).substr(2, 9)}`;
  const networkTransport = new LocalNetworkTransport(50, false); // 50ms simulated latency
  networkManager = new NetworkManager(entityManager, networkTransport, localPlayerId, false);
  spatialPartitionSystem = new SpatialPartitionSystem(16);
  spatialPartitionSystem.bindEntityManager(entityManager!);
  spatialGridSystem = new SpatialGridSystem({ cellSize: 64, verticalExtent: 320 });
  spatialGridSystem.bindEntityManager(entityManager!);
  spatialGridSystem.bindEntityRenderer(entityRenderer!);
  spatialGridSystem.bindDebugScene(scene);
  visibilitySystem = new VisibilitySystem(spatialGridSystem, camera, { cullInterval: 0.08, cellPadding: 2 });
  simulationActivationSystem = new SimulationActivationSystem({
    spatialGrid: spatialGridSystem,
    entityManager: entityManager!,
    entityRenderer: entityRenderer!,
    getFocusPosition: () => {
      if (localPlayerEntityId) {
        const local = entityManager?.getEntity(localPlayerEntityId);
        if (local) return local.getPosition();
      }
      return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    },
    activationRadius: 50,
    updateInterval: 0.1,
  });
  let lastKernelTickMs = 0;
  (gameBus as any).on('KERNEL_TICK_TIME', (payload: { ms?: number } | undefined) => {
    lastKernelTickMs = Number(payload?.ms ?? 0);
  });
  spatialRuntimeDebugHud = new SpatialRuntimeDebugHud({
    updateIntervalMs: 250,
    readSnapshot: () => {
      const gridDiagnostics = spatialGridSystem?.getDiagnostics() ?? {};
      const visibilityDiagnostics = visibilitySystem?.getDiagnostics() ?? {};
      const activationDiagnostics = simulationActivationSystem?.getDiagnostics() ?? {};
      const aiSystem = getSystem('characterActorSystem') as { getDiagnostics?: () => Record<string, unknown> } | null;
      const aiDiagnostics = aiSystem?.getDiagnostics?.() ?? {};
      const pathfindingSystem = getSystem('pathfindingSystem') as { getDebugState?: () => Record<string, unknown> } | null;
      const pathfindingDebug = pathfindingSystem?.getDebugState?.() ?? {};
      const pathfindingMetrics = (pathfindingDebug.metrics ?? {}) as Record<string, unknown>;
      const runtimeEventQueue = getSystem('runtimeEventQueue') as { getDebugState?: () => Record<string, unknown> } | null;
      const runtimeEventQueueDebug = runtimeEventQueue?.getDebugState?.() ?? {};
      const runtimeEventQueueMetrics = (runtimeEventQueueDebug.metrics ?? {}) as Record<string, unknown>;
      const runtimeSimulationDirector = getSystem('runtimeSimulationDirector') as { getDebugState?: () => Record<string, unknown> } | null;
      const runtimeSimulationDirectorDebug = runtimeSimulationDirector?.getDebugState?.() ?? {};
      const runtimeSimulationDirectorMetrics = (runtimeSimulationDirectorDebug.metrics ?? {}) as Record<string, unknown>;
      const contentPipelineDebug = contentPipeline?.getDebugState?.() ?? {};
      const contentPipelineMetrics = (contentPipelineDebug.metrics ?? {}) as Record<string, unknown>;
      const renderDiagnostics = engineDiagnostics?.getDiagnostics() ?? { frameTimeMs: 0 };

      let renderedMeshes = 0;
      for (const mesh of entityRenderer?.getAllMeshes().values() ?? []) {
        if (mesh.visible) renderedMeshes += 1;
      }

      return {
        fps: frameCount > 0 ? 60 : 0,
        renderTickMs: Number(renderDiagnostics.frameTimeMs ?? 0),
        simulationTickMs: lastKernelTickMs,
        totalEntities: entityManager?.getEntityCount() ?? 0,
        loadedChunks: Number(contentPipelineMetrics.loadedChunks ?? 0),
        visibleCells: Number(visibilityDiagnostics.visibleCells ?? 0),
        activeCells: Number(gridDiagnostics.activeCells ?? 0),
        sleepingEntities: Number(activationDiagnostics.sleepingEntities ?? 0),
        dormantAiEntities: Number(activationDiagnostics.sleepingAiEntities ?? 0),
        renderedMeshes,
        activeAiEntities: Number(activationDiagnostics.aiTickCount ?? aiDiagnostics.lastUpdatedActors ?? 0),
        visibleMeshes: Number(visibilityDiagnostics.visibleMeshes ?? 0),
        culledMeshes: Number(visibilityDiagnostics.culledMeshes ?? 0),
        activePathJobs: Number(pathfindingMetrics.activePathJobs ?? 0),
        streamingQueueSize: Number(contentPipelineMetrics.streamingQueueSize ?? 0),
        eventQueueSize: Number(runtimeEventQueueMetrics.queueSize ?? 0),
        asyncJobs: Number(runtimeSimulationDirectorMetrics.backgroundQueueSize ?? runtimeSimulationDirectorMetrics.asyncJobsLastPump ?? 0),
        activeEncounters: Number(runtimeSimulationDirectorMetrics.activeEncounters ?? 0),
        migrations: Number(gridDiagnostics.lastMigratedEntities ?? 0),
        cellAllocations: Number(gridDiagnostics.cellAllocations ?? 0),
      };
    },
  });
  replicationSystem = new ReplicationSystem();
  resourceManager = new ResourceManager();
  networkSyncSystem = new NetworkSyncSystem({
    networkManager,
    entityManager: entityManager!,
    replicationSystem,
    spatialPartition: spatialPartitionSystem,
    tickRate: 60,
    historySeconds: 1,
    relevanceRadius: 64,
    simulateAuthority: true,
  });

  const networkFacade = createNetworkFacade({
    networkManager,
    networkSyncSystem,
    replicationSystem,
  });
  const replicationFacade = createReplicationFacade(replicationSystem);
  systemContext = {
    eventBus: gameBus,
    entityManager,
    network: networkFacade,
    replication: replicationFacade,
    resources: resourceManager,
    systems: createSystemAccessProxy((name) => getSystem(name)),
    resolveSystem: (name) => getSystem(name),
  };

  // Initialize system registry for Phase 3+ management
  systemRegistry = new SystemRegistry();

  controlTower = new ControlTower();

  // Initialize camera state adapter
  const cameraAdapter = initCameraStateAdapter();
  cameraAdapter.initializeFromState();

  // Initialize mode management system
  modeManager = initModeManager();

  // Initialize selection system
  selectionSystem = new SelectionSystem(scene, entityManager, modeManager, camera, {
    enableLogging: false,
    raycastDistance: 10000,
  });

  // Initialize gizmo system
  gizmoSystem = new GizmoSystem(scene, stateManager, modeManager, camera, {
    enableLogging: false,
    gizmoSize: 1,
    axisLength: 2,
  });
  editorToolCoordinator = new EditorToolCoordinator();
  gizmoSystem.setEntityManager(entityManager!);
  gizmoSystem.setToolCoordinator(editorToolCoordinator);
  if (sceneGraph) gizmoSystem.setSceneGraph(sceneGraph);
  if (sceneGraph && selectionSystem) selectionSystem.setSceneGraph(sceneGraph);
  selectionSystem.setToolCoordinator(editorToolCoordinator);

  componentInspector = new ComponentInspector({
    selectionSystem,
    entityManager,
    enableLogging: false,
  });

  prefabPlacementSystem = new PrefabPlacementSystem({
    selectionSystem,
    toolCoordinator: editorToolCoordinator,
    entityManager,
    entityRenderer: entityRenderer!,
    camera,
    enableLogging: false,
  });
  editorPainterSystem = new EditorPainterSystem({
    toolCoordinator: editorToolCoordinator,
    placementSystem: prefabPlacementSystem,
    enableLogging: false,
  });
  triggerVolumeTool = new TriggerVolumeTool({
    scene,
    toolCoordinator: editorToolCoordinator,
    placementSystem: prefabPlacementSystem,
    entityManager,
    entityRenderer: entityRenderer!,
    enableLogging: false,
  });

  // Connect selection system to gizmo system
  if (selectionSystem && gizmoSystem) {
    selectionSystem.onSelect((entityId: string) => {
      gizmoSystem!.attachEntity(entityId);
    });

    selectionSystem.onDeselect(() => {
      gizmoSystem!.detachEntity();
    });
  }

  // Create controllers
  editorController = new EditorController({ moveSpeed: 8 });
  playController = new PlayController({ moveSpeed: 6 });
  playController.setScene(scene);

  // Register controllers with mode manager
  modeManager.registerListener({
    onEnterEditor: () => {
      enableEditorRuntimeLifecycle();
    },
    onExitEditor: () => {
      disableEditorRuntimeLifecycle('exit_editor');
    },
    onEnterPlay: () => {
      enablePlayRuntimeLifecycle(true);
    },
    onExitPlay: () => {
      disablePlayRuntimeLifecycle();
    },
  });

  // Mode listeners only fire on *transitions* — explicitly activate the startup mode (editor)
  if (getEngineMode() === 'editor') {
    enableEditorRuntimeLifecycle();
    gizmoSystem?.enable();
  } else if (getEngineMode() === 'play') {
    enablePlayRuntimeLifecycle(true);
  }

  inputRouter = new InputRouter({
    canvas: canvasElement,
    editorTool: {
      handleKeyDown: (event) => prefabPlacementSystem?.handleKeyDown?.(event),
      handleKeyUp: (event) => prefabPlacementSystem?.handleKeyUp?.(event),
      handlePointerDown: (event) => triggerVolumeTool?.handlePointerDown?.(event)
        || editorPainterSystem?.handlePointerDown?.(event),
      handlePointerMove: (event) => triggerVolumeTool?.handlePointerMove?.(event)
        || editorPainterSystem?.handlePointerMove?.(event),
      handlePointerUp: (event) => triggerVolumeTool?.handlePointerUp?.(event)
        || editorPainterSystem?.handlePointerUp?.(event),
      handleDoubleClick: (event) => triggerVolumeTool?.handleDoubleClick?.(event)
        || editorPainterSystem?.handleDoubleClick?.(event),
      handleWheel: (event) => triggerVolumeTool?.handleWheel?.(event)
        || editorPainterSystem?.handleWheel?.(event),
    },
    editorSelection:   selectionSystem   ?? undefined,
    editorGizmo:       gizmoSystem        ?? undefined,
    editorController:  editorController   ?? undefined,
    playController:    playController     ?? undefined,
    physGun:           physGunSystem      ?? undefined,
    interactionSystem: pickupSystem       ?? undefined,
    toolbarSystem:     toolbarSystem      ?? undefined,
    enableDebugOverlay: false,
  });
  inputManager = new InputManager(inputRouter);
  inputManager.enable();

  // Initialize console — must be after modeManager, editorController, playController
  gameConsole = initGameConsole();

  // ── Create EngineController and register all core systems ──────────────
  engineController = new EngineController();
  setCameraAuthorityController(engineController);
  engineController.registerSystems({
    entityManager,
    networkManager,
    renderingPipeline,
    modeManager,
    editorController,
    playController,
    selectionSystem,
    gizmoSystem,
    editorToolCoordinator,
    componentInspector,
  });

  engineDiagnostics = new EngineDiagnostics(renderer, entityManager);
  systemWatchdog = new SystemWatchdog(entityManager);
  debugOverlay = new DebugOverlay({
    diagnostics: engineDiagnostics,
    getEngineState: () => engineController?.state ?? 'boot',
    getPointerLock: () => inputRouter?.isPointerLocked() ?? false,
    getSelectedEntity: () => selectionSystem?.getSelected() ?? null,
    getControlTowerSnapshot: () => controlTower?.getSnapshot() ?? null,
  });

  engineController.registerSystems({
    auxiliarySystems: {
      gizmoSystem,
      editorToolCoordinator,
      componentInspector,
      prefabPlacementSystem,
      editorPainterSystem,
      triggerVolumeTool,
      engineDiagnostics,
      systemWatchdog,
      debugOverlay,
      cullingSystem,
      spatialPartitionSystem,
      spatialGridSystem,
      visibilitySystem,
      simulationActivationSystem,
      spatialRuntimeDebugHud,
      replicationSystem,
      resourceManager,
      networkSyncSystem,
      physGunSystem,      // must be before interactionManager (sets overrides)
      pickupSystem,
      interactionManager, // resolves priorities after physgun override is set
      inventoryGridManager,
      inventoryGridUI,
      toolbarSystem,
      lightingSystem,
    },
  });

  orchestrateCorridorManifest({
    manifest: [
      { id: 'entityManager', system: entityManager, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'stateManager', system: stateManager, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true } },
      { id: 'featureManager', system: FeatureManager, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true } },
      { id: 'saveLoadManager', system: saveLoadManager, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: false } },
      { id: 'engineController', system: engineController, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'networkManager', system: networkManager, capabilities: { usesEventBus: true, exposesDebug: true, usesNetworkFacade: true, deterministic: false } },
      { id: 'renderingPipeline', system: renderingPipeline, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'modeManager', system: modeManager, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true } },
      { id: 'editorController', system: editorController, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'playController', system: playController, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true } },
      { id: 'selectionSystem', system: selectionSystem, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true } },
      { id: 'gizmoSystem', system: gizmoSystem, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true } },
      { id: 'engineDiagnostics', system: engineDiagnostics, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'systemWatchdog', system: systemWatchdog, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'controlTower', system: controlTower, capabilities: { usesEventBus: true, usesReplication: true, exposesDebug: true, deterministic: false, usesSystemContext: true, usesNetworkFacade: true } },
      { id: 'debugOverlay', system: debugOverlay, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'cullingSystem', system: cullingSystem, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true } },
      { id: 'spatialPartitionSystem', system: spatialPartitionSystem, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'spatialGridSystem', system: spatialGridSystem, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true } },
      { id: 'visibilitySystem', system: visibilitySystem, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true } },
      { id: 'simulationActivationSystem', system: simulationActivationSystem, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true } },
      { id: 'spatialRuntimeDebugHud', system: spatialRuntimeDebugHud, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'replicationSystem', system: replicationSystem, capabilities: { usesEventBus: true, usesReplication: true, exposesDebug: true, usesNetworkFacade: true, deterministic: true } },
      { id: 'resourceManager', system: resourceManager, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'networkSyncSystem', system: networkSyncSystem, capabilities: { usesEventBus: true, usesReplication: true, exposesDebug: true, usesNetworkFacade: true, deterministic: false } },
      { id: 'physGunSystem', system: physGunSystem, capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true } },
      { id: 'pickupSystem', system: pickupSystem, capabilities: { usesEventBus: true, deterministic: true } },
      { id: 'interactionManager', system: interactionManager, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'inventoryGridManager', system: inventoryGridManager, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'inventoryGridUI', system: inventoryGridUI, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'toolbarSystem', system: toolbarSystem, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'dataRegistry', system: gasDataRegistry, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'attributeStore', system: gasAttributes, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'effectSystem', system: gasEffects, capabilities: { exposesDebug: true, deterministic: true } },
      { id: 'itemInstanceSystem', system: gasItems, capabilities: { exposesDebug: true, deterministic: true } },
    ],
    contextDeps: {
      eventBus: gameBus,
      entityManager,
      networkManager,
      networkSyncSystem,
      replicationSystem,
      resourceManager,
    },
    systemContext,
    strictDependencies: true,
  });

  registerSystemMetadata('entityManager', {
    displayName: 'Entity Manager',
    category: 'Core',
    order: 10,
    getState: (system) => ({
      entityCount: (system as EntityManager).getEntities().length,
    }),
  });
  registerSystemMetadata('stateManager', {
    displayName: 'State Manager',
    category: 'Core',
    order: 12,
  });
  registerSystemMetadata('featureManager', {
    displayName: 'Feature Manager',
    category: 'Core',
    order: 13,
  });
  registerSystemMetadata('saveLoadManager', {
    displayName: 'Save / Load Manager',
    category: 'Core',
    order: 14,
  });
  registerSystemMetadata('selectionSystem', {
    displayName: 'Selection System',
    category: 'Editor',
    order: 20,
    getState: (system) => ({
      selectedEntityId: (system as SelectionSystem).getSelected(),
    }),
  });
  registerSystemMetadata('gizmoSystem', {
    displayName: 'Gizmo System',
    category: 'Editor',
    order: 30,
  });
  registerSystemMetadata('playController', {
    displayName: 'Play Controller',
    category: 'Gameplay',
    order: 20,
    getState: (system) => ({
      boundEntityId: (system as PlayController).getBoundEntityId(),
      enabled: (system as PlayController).isEnabled?.() ?? false,
    }),
  });
  registerSystemMetadata('networkSyncSystem', {
    displayName: 'Network Sync System',
    category: 'Networking',
    order: 10,
    properties: [
      {
        key: 'predictionEnabled',
        label: 'Prediction Enabled',
        type: 'boolean',
        description: 'Toggle client-side prediction while inspecting reconciliation behavior.',
      },
      {
        key: 'reconciliationThreshold',
        label: 'Reconciliation Threshold',
        type: 'number',
        min: 0,
        max: 3,
        step: 0.01,
        description: 'Ignore tiny corrections to reduce visible snapping.',
      },
    ],
  });
  registerSystemMetadata('replicationSystem', {
    displayName: 'Replication System',
    category: 'Networking',
    order: 20,
  });
  registerSystemMetadata('resourceManager', {
    displayName: 'Resource Manager',
    category: 'Streaming',
    order: 10,
    properties: [
      {
        key: 'streamingEnabled',
        label: 'Streaming Enabled',
        type: 'boolean',
        description: 'Toggle runtime asset streaming without replacing the resource manager instance.',
      },
    ],
  });
  registerSystemMetadata('spatialPartitionSystem', {
    displayName: 'Spatial Partition System',
    category: 'Streaming',
    order: 20,
    properties: [
      {
        key: 'debugDrawEnabled',
        label: 'Debug Draw',
        type: 'boolean',
        description: 'Show or hide spatial partition debug visualization.',
      },
    ],
  });
  registerSystemMetadata('spatialGridSystem', {
    displayName: 'Spatial Grid System',
    category: 'Streaming',
    order: 21,
    properties: [
      {
        key: 'debugOverlayEnabled',
        label: 'Debug Overlay',
        type: 'boolean',
        description: 'Show or hide world partition cell boundaries.',
        get: (system) => (system as SpatialGridSystem).isDebugOverlayEnabled(),
        set: (system, value) => (system as SpatialGridSystem).setDebugOverlayEnabled(Boolean(value)),
      },
    ],
  });
  registerSystemMetadata('visibilitySystem', {
    displayName: 'Visibility System',
    category: 'Rendering',
    order: 16,
    properties: [
      {
        key: 'enabled',
        label: 'Enabled',
        type: 'boolean',
        description: 'Toggle cell-based frustum culling.',
        get: (system) => (system as VisibilitySystem).isEnabled(),
        set: (system, value) => (system as VisibilitySystem).setEnabled(Boolean(value)),
      },
    ],
  });
  registerSystemMetadata('simulationActivationSystem', {
    displayName: 'Simulation Activation System',
    category: 'Simulation',
    order: 16,
    properties: [
      {
        key: 'enabled',
        label: 'Enabled',
        type: 'boolean',
        description: 'Toggle distance-based activation for AI and expensive simulation.',
        get: (system) => (system as SimulationActivationSystem).isEnabled(),
        set: (system, value) => (system as SimulationActivationSystem).setEnabled(Boolean(value)),
      },
    ],
  });
  registerSystemMetadata('spatialRuntimeDebugHud', {
    displayName: 'Spatial Runtime Debug HUD',
    category: 'Diagnostics',
    order: 21,
    properties: [
      {
        key: 'enabled',
        label: 'Enabled',
        type: 'boolean',
        description: 'Toggle lightweight spatial runtime debug HUD.',
        get: (system) => (system as SpatialRuntimeDebugHud).isEnabled(),
        set: (system, value) => (system as SpatialRuntimeDebugHud).setEnabled(Boolean(value)),
      },
    ],
  });
  registerSystemMetadata('cullingSystem', {
    displayName: 'Culling System',
    category: 'Rendering',
    order: 15,
    properties: [
      {
        key: 'enabled',
        label: 'Enabled',
        type: 'boolean',
        description: 'Toggle frustum culling and LOD updates without removing the runtime service.',
        get: (system) => (system as CullingSystem).isEnabled(),
        set: (system, value) => (system as CullingSystem).setEnabled(Boolean(value)),
      },
    ],
  });
  registerSystemMetadata('engineDiagnostics', {
    displayName: 'Engine Diagnostics',
    category: 'Diagnostics',
    order: 10,
  });
  registerSystemMetadata('debugOverlay', {
    displayName: 'Debug Overlay',
    category: 'Diagnostics',
    order: 20,
  });

  // Wire real console commands
  gameConsole.register('mode', 'Switch engine mode: mode editor | mode play', (args) => {
    const target = (args[0] ?? '').toLowerCase();
    if (target !== 'editor' && target !== 'play') return 'Usage: mode <editor|play>';
    setEngineMode(target as 'editor' | 'play');
    return `→ Mode set to "${target}"`;
  });

  gameConsole.register('setpos', 'Teleport camera: setpos <x> <y> <z>', (args) => {
    if (args.length < 3) return 'Usage: setpos <x> <y> <z>';
    const [x, y, z] = args.map(Number);
    if ([x, y, z].some(isNaN)) return 'Error: x/y/z must be numbers';
    const cam = getCamera();
    if (!cam) return 'Error: camera not available';
    cam.position.set(x, y, z);
    return `→ Camera moved to (${x}, ${y}, ${z})`;
  });

  gameConsole.register('speed', 'Set camera move speed: speed <value>', (args) => {
    const s = Number(args[0]);
    if (isNaN(s) || s <= 0) return 'Usage: speed <positive number>';
    editorController?.setMoveSpeed(s);
    playController?.setMoveSpeed(s);
    return `→ Move speed set to ${s} u/s`;
  });

  gameConsole.register('list', 'List engine info: list entities | list mode', (args) => {
    const sub = (args[0] ?? '').toLowerCase();
    if (sub === 'entities') {
      return `Entities: ${entityManager?.getEntityCount() ?? 0}`;
    }
    if (sub === 'mode') {
      return `Current mode: ${engineController?.getRuntimeMode() ?? 'unknown'}`;
    }
    return 'Usage: list <entities|mode>';
  });

  gameConsole.register('fog', 'Set fog density: fog <0..1>', (args) => {
    const d = Number(args[0]);
    if (isNaN(d)) return 'Usage: fog <density 0..1>';
    setEngineFogDensity(d);
    return `→ Fog density set to ${d}`;
  });

  gameConsole.register('give', 'Give item: give <itemId> [qty]', (args) => {
    if (!args[0]) return 'Usage: give <itemId> [quantity]';
    const qty = parseInt(args[1] ?? '1', 10) || 1;
    const itemId = args[0];
    inventoryGridManager?.giveItem(itemId, qty).then((ok) => {
      gameConsole!.log(ok ? `→ Gave ${qty}× ${itemId}` : '✕ Failed – unknown item or inventory full');
    });
    return `Requesting ${qty}× ${itemId}…`;
  });

  gameConsole.register('inv', 'Inventory: inv open | inv close | inv info', (args) => {
    const sub = (args[0] ?? '').toLowerCase();
    if (sub === 'open')  { inventoryGridUI?.open();  return 'Inventory opened'; }
    if (sub === 'close') { inventoryGridUI?.close(); return 'Inventory closed'; }
    const count = inventoryGridManager?.getInventory()?.items.length ?? 0;
    return `Inventory: ${count} item(s) in backpack`;
  });

  gameConsole.register('feature', 'Toggle feature: feature <key>', (args) => {
    const key = args[0];
    if (!key) return 'Usage: feature <multiplayer|enemyAI|weapons|fog|audio|visualEffects|proceduralLevels|debugTools>';
    try {
      const state = FeatureManager.toggle(key as any);
      return `→ ${key}: ${state ? 'ON' : 'OFF'}`;
    } catch {
      return `Error: unknown feature key '${key}'`;
    }
  });

  // Keep FeatureManager in sync with mode changes
  modeManager.registerListener({
    onEnterEditor: () => FeatureManager.onEnterEditor(),
    onEnterPlay:   () => FeatureManager.onEnterPlay(),
  });

  // Setup State -> System subscriptions
  // These update Three.js systems when engine state changes
  
  // Fog subscriptions
  stateManager.subscribe('fog.density', (value: any) => {
    setFogDensity(value);
  });

  stateManager.subscribe('fog.color', (value: any) => {
    setFogColor(value);
  });

  // Setup event listeners
  window.addEventListener('resize', handleWindowResize);

  // Listen for player spawn events to track local player ID for torch toggle
  // Hook into EntityManager's entity creation to detect local player
  if (entityManager) {
    entityManager.onEntityCreated((entity) => {
      if (entity.getComponent('localPlayer')) {
        if (entity.id && entity.id !== localPlayerEntityId) {
          localPlayerEntityId = entity.id;
          console.log(`[Engine] Local player entity registered for torch: ${localPlayerEntityId}`);
        }
      }
    });
  }

  // Setup keyboard listener for graphics pipeline toggle (Press 'G')
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'g' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      console.log('[Engine] G key pressed - toggling graphics pipeline');
      toggleGraphicsPipeline();
      event.preventDefault();
    }
    // Debug: Toggle player torch with 'T' key
    if (event.key.toLowerCase() === 't' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      console.log(`[Engine] T key pressed - torch toggle requested (localPlayerEntityId: ${localPlayerEntityId})`);
      const localPlayer = localPlayerEntityId ? entityManager?.getEntity(localPlayerEntityId) : null;
      if (localPlayer) {
        const lightComp = localPlayer.getComponent('light');
        if (lightComp) {
          lightComp.data.visible = !(lightComp.data.visible ?? true);
          console.log(`[Engine] Player torch ${lightComp.data.visible ? 'ON' : 'OFF'}`);
        } else {
          console.warn(`[Engine] Local player has no light component`);
        }
      } else {
        console.warn(`[Engine] Local player not found (ID: ${localPlayerEntityId})`);
      }
      event.preventDefault();
    }
    if ((event.key === 'F9' || event.code === 'F9') && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      const grid = spatialGridSystem;
      if (grid) {
        const next = !grid.isDebugOverlayEnabled();
        grid.setDebugOverlayEnabled(next);
      }
      event.preventDefault();
    }
    if ((event.key === 'F10' || event.code === 'F10') && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      spawnSpatialDebugEnemies(100);
      event.preventDefault();
    }
  });

  (window as any).__spawnStressTest = (count: number) => {
    const parsed = Number.isFinite(count) ? Math.floor(count) : 0;
    const spawnCount = Math.max(0, Math.min(10000, parsed));
    return spawnSpatialDebugEnemies(spawnCount);
  };

  (window as any).__spatialDebug = {
    dumpCells: () => spatialGridSystem?.getCellSnapshots() ?? [],
    playerCell: () => {
      const position = localPlayerEntityId
        ? entityManager?.getEntity(localPlayerEntityId)?.getPosition()
        : null;
      if (!position || !spatialGridSystem) {
        return null;
      }
      const cellId = spatialGridSystem.getCellFromWorldPosition(position.x, position.z);
      return {
        cellId,
        position,
        cell: spatialGridSystem.getCell(cellId) ?? null,
      };
    },
    findEntity: (entityId: string) => {
      if (!spatialGridSystem) return null;
      const entity = entityManager?.getEntity(entityId) ?? null;
      const cellId = spatialGridSystem.getCellForEntity(entityId);
      return {
        entityId,
        exists: Boolean(entity),
        cellId: cellId ?? null,
        cell: cellId ? spatialGridSystem.getCell(cellId) ?? null : null,
        position: entity?.getPosition() ?? null,
        active: entity?.isActive ?? null,
      };
    },
    memoryMetrics: () => ({
      spatialGrid: spatialGridSystem?.getDiagnostics() ?? null,
      visibility: visibilitySystem?.getDiagnostics() ?? null,
      activation: simulationActivationSystem?.getDiagnostics() ?? null,
      totalEntities: entityManager?.getEntityCount() ?? 0,
      renderedMeshes: (() => {
        let visible = 0;
        let total = 0;
        for (const mesh of entityRenderer?.getAllMeshes().values() ?? []) {
          total += 1;
          if (mesh.visible) visible += 1;
        }
        return { total, visible };
      })(),
    }),
    validateHotReload: () => {
      const registry = getSystemRegistry();
      const cells = spatialGridSystem?.getCellSnapshots() ?? [];
      const uniqueCellIds = new Set(cells.map((cell) => cell.id));
      return {
        overlayEnabled: spatialGridSystem?.isDebugOverlayEnabled() ?? false,
        duplicateCellIds: cells.length - uniqueCellIds.size,
        hasDuplicateSystems: registry ? !registry.validateNoDuplicates() : null,
        cellCount: cells.length,
      };
    },
  };

  // Setup game loop with rendering pipeline
  let kernelInjected = false;
  
  onRender(() => {
    // One-time kernel injection on first render
    if (!kernelInjected && entityRenderer) {
      try {
        const dummyEnemySystem = getSystem('dummy_enemy_system');
        if (dummyEnemySystem && (dummyEnemySystem as any).kernel && !entityRenderer.kernel) {
          entityRenderer.setKernel((dummyEnemySystem as any).kernel);
          kernelInjected = true;
        }
      } catch (error) {
        // DummyEnemySystem not yet available, will try again next frame
      }
    }

    // Per-frame sync: Update fallback DOD meshes from kernel buffers
    if (entityRenderer) {
      entityRenderer.update();
    }

    const mode = getRuntimePerformanceMode();
    const shouldProfile = mode === RuntimePerformanceMode.DEV || runtimeFrameCostProfiler.isSamplingFrame();

    if (shouldProfile) {
      runtimeFrameCostProfiler.measure('render:frame', () => {
        if (useCrunchyModernPipeline && crunchyModernPipeline && baseSceneRenderTarget) {
          // CrunchyModern: render scene to intermediate FBO
          if (frameCount % 60 === 0) {
            console.log('[Engine] Rendering with CrunchyModern pipeline (profiled)');
          }
          try {
            renderer.setRenderTarget(baseSceneRenderTarget);
            renderer.clear(true, true, true);
            renderer.render(scene, camera);
            renderer.setRenderTarget(null);
            
            crunchyModernPipeline.update();
          } catch (error) {
            console.error('[Engine] Error in CrunchyModern render', error);
            renderingPipeline?.render();
          }
        } else if (renderingPipeline) {
          // PS1 Pipeline (fallback)
          renderingPipeline.render();
        } else {
          render();
        }
      });
    } else {
      if (useCrunchyModernPipeline && crunchyModernPipeline && baseSceneRenderTarget) {
        // CrunchyModern: render scene to intermediate FBO
        if (frameCount % 60 === 0) {
          console.log('[Engine] Rendering with CrunchyModern pipeline');
        }
        try {
          renderer.setRenderTarget(baseSceneRenderTarget);
          renderer.clear(true, true, true);
          renderer.render(scene, camera);
          renderer.setRenderTarget(null);
          
          crunchyModernPipeline.update();
        } catch (error) {
          console.error('[Engine] Error in CrunchyModern render', error);
          renderingPipeline?.render();
        }
      } else if (renderingPipeline) {
        // PS1 Pipeline (fallback)
        renderingPipeline.render();
      } else {
        render();
      }
    }
  });

  // ── Route all per-frame updates through the EngineController ────────────
  // No system ticks itself. Everything is dispatched from here.
  onUpdate((dt: number) => {
    updateGlobalSunlight(camera.position);
    engineController!.update(dt);
  });

  isInitialized = true;

  // Expose DummyEnemySystem globally for EntityRenderer to access kernel
  try {
    const dummyEnemySystem = getSystem('dummy_enemy_system');
    if (dummyEnemySystem && (dummyEnemySystem as any).kernel) {
      (globalThis as any).__dummyEnemySystem = dummyEnemySystem;
      if (entityRenderer) {
        entityRenderer.setKernel((dummyEnemySystem as any).kernel);
      }
    }
  } catch (error) {
    // DummyEnemySystem might not be registered yet, will inject on first render
  }

  runRuntimeCapabilityAuditHook();

  console.log('Engine initialized');
  logEvent('engine', 'Engine bootstrap complete');
  gameConsole?.log('System bootstrap complete');

  return {
    scene,
    camera,
    renderer,
  };
}

/**
 * Start the game loop
 */
export function start(): void {
  if (!isInitialized) {
    console.error('Engine must be initialized before starting');
    return;
  }
  if (isStarted) {
    return;
  }

  resumeRuntimeLifecycle();
  startGameLoop();
  isStarted = true;
}

/**
 * Stop the game loop
 */
export function stop(): void {
  if (!isStarted) {
    return;
  }

  suspendRuntimeLifecycle();
  stopGameLoop();
  isStarted = false;
}

/**
 * Subscribe to update events
 */
export function onEngineUpdate(callback: (deltaTime: number) => void): () => void {
  return onUpdate(callback);
}

/**
 * Handle window resize
 */
function handleWindowResize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;

  updateCameraAspect(width, height);
  setRendererSize(width, height);

  // Resize FBOs if using CrunchyModern pipeline
  if (baseSceneRenderTarget) {
    baseSceneRenderTarget.setSize(width, height);
  }

  renderingPipeline?.onWindowResize();
}

/**
 * Get current configuration
 */
export function getConfig(): EngineConfig {
  return { ...config };
}

/**
 * Update configuration
 */
export function setConfig(newConfig: Partial<EngineConfig>): void {
  Object.assign(config, newConfig);
}

/**
 * Get a reference to internal systems
 */
export function getEngineScene(): THREE.Scene | null {
  return getScene();
}

export function getEngineCamera(): THREE.PerspectiveCamera | null {
  return getCamera();
}

export function getEngineRenderer(): THREE.WebGLRenderer | null {
  return getRenderer();
}

/**
 * Get atmospheric effects manager
 * Used by debug system to access and control effects
 */
export function getAtmosphericEffectsManager() {
  return getAtmosphereManager();
}

/**
 * Set fog density
 */
export function setEngineFogDensity(density: number): void {
  setFogDensity(density);
}

/**
 * Set fog color (as hex number)
 */
export function setEngineFogColor(color: number): void {
  setFogColor(color);
}

/**
 * Get camera FOV
 */
export function getEngineCameraFOV(): number {
  const camera = getCamera();
  return camera?.fov ?? 75;
}

/**
 * Set camera FOV
 */
export function setEngineCameraFOV(fov: number): void {
  const cameraAdapter = getCameraStateAdapter();
  if (!cameraAdapter) {
    console.error('[Engine] CameraStateAdapter not initialized');
    return;
  }
  const applied = cameraAdapter.applySnapshot({ fov }, engineController?.getCameraAuthority() ?? getCameraAuthority());
  if (!applied) {
    console.warn('[Engine] Camera FOV update was blocked by authority gating');
  }
}

/**
 * Visual effects toggle helpers
 */
export function setEnginePostProcessingEnabled(enabled: boolean): void {
  getAtmosphereManager()?.setPostProcessingEnabled(enabled);
}

export function setEngineFogEnabled(enabled: boolean): void {
  getAtmosphereManager()?.setFogEnabled(enabled);
}

export function setEngineLightingEnabled(enabled: boolean): void {
  getAtmosphereManager()?.setLightingEnabled(enabled);
}

export function setEngineFilmGrainIntensity(intensity: number): void {
  getAtmosphereManager()?.setFilmGrainIntensity(intensity);
}

export function setEngineVignetteIntensity(intensity: number): void {
  getAtmosphereManager()?.setVignetteIntensity(intensity);
}

export function setEngineCameraEffectsEnabled(enabled: boolean): void {
  getAtmosphereManager()?.setCameraEffectsEnabled(enabled);
}

export function setEnginePipelineEnabled(enabled: boolean): void {
  renderingPipeline?.setEnabled(enabled);
}

export function isEnginePipelineEnabled(): boolean {
  return renderingPipeline?.isEnabled() ?? false;
}

export function setEnginePipelineFilmGrain(intensity: number): void {
  renderingPipeline?.setFilmGrainIntensity(intensity);
}

export function setEnginePipelineVignette(intensity: number): void {
  renderingPipeline?.setVignetteIntensity(intensity);
}

export function setEnginePipelineFog(intensity: number): void {
  renderingPipeline?.setFogIntensity(intensity);
}

export function setEnginePipelineDithering(intensity: number): void {
  renderingPipeline?.setDitheringIntensity(intensity);
}

export function setEnginePipelineColorBits(bits: number): void {
  renderingPipeline?.setColorBits(bits);
}

/**
 * Graphics Pipeline Toggle
 * Switch between CrunchyModern (new) and PS1 (legacy) rendering pipelines
 */
export function toggleGraphicsPipeline(): void {
  useCrunchyModernPipeline = !useCrunchyModernPipeline;
  const pipelineName = useCrunchyModernPipeline ? 'CrunchyModern' : 'PS1';
  console.log(`[Engine] Switched to ${pipelineName} pipeline`);
  console.log('[Engine] useCrunchyModernPipeline:', useCrunchyModernPipeline);
  console.log('[Engine] crunchyModernPipeline exists:', !!crunchyModernPipeline);
  console.log('[Engine] baseSceneRenderTarget exists:', !!baseSceneRenderTarget);
}

export function setGraphicsPipeline(useCrunchy: boolean): void {
  useCrunchyModernPipeline = useCrunchy;
  const pipelineName = useCrunchy ? 'CrunchyModern' : 'PS1';
  console.log(`[Engine] Set graphics pipeline to ${pipelineName}`);
}

export function getGraphicsPipeline(): 'CrunchyModern' | 'PS1' {
  return useCrunchyModernPipeline ? 'CrunchyModern' : 'PS1';
}

/**
 * State Management API
 */

export function getEngineState(path?: string) {
  const sm = getStateManager();
  if (!sm) {
    console.error('[Engine] State manager not initialized');
    return null;
  }
  return sm.getState(path);
}

export function setEngineState(path: string, value: any): boolean {
  const sm = getStateManager();
  if (!sm) {
    console.error('[Engine] State manager not initialized');
    return false;
  }
  return sm.set(path, value);
}

export function updateEngineState(updates: Record<string, any>) {
  const sm = getStateManager();
  if (!sm) {
    console.error('[Engine] State manager not initialized');
    return {};
  }
  return sm.update(updates);
}

export function subscribeToEngineState(path: string, callback: (value: any) => void) {
  const sm = getStateManager();
  if (!sm) {
    console.error('[Engine] State manager not initialized');
    return () => {};
  }
  return sm.subscribe(path, callback);
}

/**
 * Mode Management API
 */

export async function setEngineMode(mode: 'editor' | 'play'): Promise<void> {
  if (!engineController) {
    console.error('[Engine] Engine controller not initialized');
    return;
  }
  engineController.setRuntimeMode(mode, 'engine-api');
}

export function getEngineMode(): 'editor' | 'play' {
  if (engineController) {
    return engineController.getRuntimeMode();
  }
  return modeManager?.isPlayMode() ? 'play' : 'editor';
}

export function isEngineInEditorMode(): boolean {
  return getEngineMode() === 'editor';
}

export function isEngineInPlayMode(): boolean {
  return getEngineMode() === 'play';
}

export function getAuthoritativeInputContext(): 'game' | 'editor' {
  return engineController?.state === 'in_game' && getEngineMode() === 'play' ? 'game' : 'editor';
}

export function getModeManger() {
  return modeManager;
}

export function getPlayController(): PlayController | null {
  return playController;
}

/**
 * Entity Management API
 */

export function getEntityManager(): EntityManager | null {
  return entityManager;
}

export function isEntityAlive(entityId: string | null | undefined): boolean {
  if (!entityId || !entityManager) {
    return false;
  }
  return entityManager.isEntityAlive(entityId);
}

export function getEntityRenderer(): EntityRenderer | null {
  return entityRenderer;
}

export function getTransformSystem(): TransformSystem | null {
  return transformSystem;
}

export function getSceneGraph(): SceneGraph | null {
  return sceneGraph;
}

export function getEditorMenu(): EditorMenu | null {
  return editorMenu;
}

export function getSelectionSystem(): SelectionSystem | null {
  return selectionSystem;
}

export function getGizmoSystem(): GizmoSystem | null {
  return gizmoSystem;
}

export function getComponentInspector(): ComponentInspector | null {
  return componentInspector;
}

export function getEditorToolCoordinator(): EditorToolCoordinator | null {
  return editorToolCoordinator;
}

export function getPrefabPlacementSystem(): PrefabPlacementSystem | null {
  return prefabPlacementSystem;
}

export function getEditorPainterSystem(): EditorPainterSystem | null {
  return editorPainterSystem;
}

export function getTriggerVolumeTool(): TriggerVolumeTool | null {
  return triggerVolumeTool;
}

/**
 * Network Management API
 */

export function getNetworkManager(): NetworkManager | null {
  return networkManager;
}

export function getNetworkSyncSystem(): NetworkSyncSystem | null {
  return networkSyncSystem;
}

export function getReplicationSystem(): ReplicationSystem | null {
  return replicationSystem;
}

export function getResourceManager(): ResourceManager | null {
  return resourceManager;
}

export function getSpatialPartitionSystem(): SpatialPartitionSystem | null {
  return spatialPartitionSystem;
}

export function getSpatialGridSystem(): SpatialGridSystem | null {
  return spatialGridSystem;
}

export function getCullingSystem(): CullingSystem | null {
  return cullingSystem;
}

export function getVisibilitySystem(): VisibilitySystem | null {
  return visibilitySystem;
}

export function getSimulationActivationSystem(): SimulationActivationSystem | null {
  return simulationActivationSystem;
}

function spawnSpatialDebugEnemies(count: number): { requested: number; spawned: number } {
  if (!entityManager || count <= 0) {
    return { requested: count, spawned: 0 };
  }

  const referencePosition = localPlayerEntityId
    ? entityManager.getEntity(localPlayerEntityId)?.getPosition()
    : null;
  const origin = referencePosition ?? {
    x: getEngineCamera()?.position.x ?? 0,
    y: 0,
    z: getEngineCamera()?.position.z ?? 0,
  };

  let spawned = 0;
  const y = Math.max(0.5, origin.y);
  for (let i = 0; i < count; i += 1) {
    const radius = 8 + (Math.sqrt(i + 1) * 1.7);
    const angle = (i * 0.61803398875) * Math.PI * 2;
    const x = origin.x + (Math.cos(angle) * radius);
    const z = origin.z + (Math.sin(angle) * radius);

    const entity = entityManager.createEntity('SpatialDummyEnemy', {
      position: { x, y, z },
      rotation: { x: 0, y: angle, z: 0 },
    });
    entity.addComponent({
      name: 'render',
      data: {
        meshType: 'box',
        color: 0xb95f46,
        geometry: { width: 0.55, height: 1.35, depth: 0.55 },
      },
    });
    entity.addComponent({
      name: 'aiController',
      data: {
        state: 'idle',
        active: true,
      },
    });
    entity.addComponent({
      name: 'enemyAI',
      data: {
        active: true,
        sleeping: false,
      },
    });
    entityRenderer?.syncEntity(entity);
    spawned += 1;
  }

  return { requested: count, spawned };
}

export function getConsole(): GameConsole | null {
  return gameConsole ?? getGameConsole();
}

export function getInputRouter(): InputRouter | null {
  return inputRouter;
}

export function getPhysGunSystem(): PhysGunSystem | null {
  return physGunSystem;
}

export function getInventoryGridManager(): InventoryGridManager | null {
  return inventoryGridManager;
}

export function setRuntimePlayerId(playerId: string | null): void {
  preferredRuntimePlayerId = playerId;
  if (playerId && networkManager) {
    networkManager.setLocalPlayerId(playerId);
  }
}

export function getRuntimePlayerId(): string | null {
  return resolveInventoryPlayerId();
}

export function ensureGameplayUiActive(): void {
  inventoryGridUI?.enable();
  if (toolbarSystem) {
    toolbarSystem.setPhysGunCallbacks(
      () => physGunSystem?.activate(),
      () => physGunSystem?.deactivate(),
    );
    toolbarSystem.enable();
  }
}

export function getToolbarSystem(): ToolbarSystem | null {
  return toolbarSystem;
}

export function getInventoryGridUI(): InventoryGridUI | null {
  return inventoryGridUI;
}

export function getInteractionManager(): InteractionManager | null {
  return interactionManager;
}

export function getPickupSystem(): PickupSystem | null {
  return pickupSystem;
}

export function getInputManager(): InputManager | null {
  return inputManager;
}

export function getEngineDiagnostics(): EngineDiagnostics | null {
  return engineDiagnostics;
}

export function getDebugOverlay(): DebugOverlay | null {
  return debugOverlay;
}

export function getControlTower(): ControlTower | null {
  return controlTower;
}

/**
 * Runtime orchestration — EngineController
 */

/** Returns the singleton EngineController. Available after Engine.init(). */
export function getEngineController(): EngineController | null {
  return engineController;
}

export function getSystemContext(): SystemContext | null {
  return systemContext;
}

export function getSystemRegistry(): SystemRegistry | null {
  return systemRegistry;
}

export function bindExternalSystemContext(id: string, system: unknown, capabilities?: Partial<SystemCapabilities>): void {
  if (!systemContext) return;
  bindSystemContext(system, id, systemContext, capabilities);
}

export function attachMultiplayerClientToSystemContext(client: import('../../3-network/network/MultiplayerClient').MultiplayerClient | null): void {
  systemContext?.network.attachClient(client);
}

/**
 * Attempt a guarded AppState transition.
 * Returns true if applied, false if the transition is not allowed.
 */
export function transitionAppState(next: AppState): boolean {
  if (!engineController) {
    console.error('[Engine] EngineController not initialised');
    return false;
  }
  return engineController.setAppState(next);
}

export function setAppState(next: AppState): boolean {
  return transitionAppState(next);
}

export function switchMode(next: AppState): boolean {
  return setAppState(next);
}

export function registerRuntimeSystem(id: string, system: unknown, phaseId?: string, force = false): boolean {
  if (!systemRegistry) {
    console.error('[Engine] Runtime system registry not initialised');
    return false;
  }
  systemRegistry.registerSystem(id, system as any, phaseId, force);
  return true;
}

export function replaceRuntimeSystem(id: string, system: unknown, phaseId?: string): boolean {
  if (!systemRegistry) {
    console.error('[Engine] Runtime system registry not initialised');
    return false;
  }
  systemRegistry.registerSystem(id, system as any, phaseId ?? systemRegistry.getPhaseOwner(id), true);
  return true;
}

export function setMenuCameraAuthority(): void {
  setCameraAuthority('menu');
}

export type { AppState };

export function createLocalPlayerEntity(color: number = 0xffff00): void {
  if (!entityManager) {
    console.warn('[Engine] EntityManager not available');
    return;
  }

  // Create local player entity
  const localPlayer = entityManager.createEntity('LocalPlayer', {
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  });

  // Add local player marker component
  localPlayer.addComponent({
    name: 'localPlayer',
    data: { isLocal: true },
  });

  localPlayer.addComponent({
    name: 'collider',
    data: { ...createCapsuleCollider(0.4, 1.0) },
  });

  // Add render component (yellow capsule)
  localPlayer.addComponent({
    name: 'render',
    data: {
      meshType: 'capsule',
      color,
      geometry: { radius: 0.4, height: 1.0, radialSegments: 8 },
    },
  });

  // Add head torch light (debug/test - toggle with "L" key)
  localPlayer.addComponent({
    name: 'light',
    data: createSpotLightComponent({ castShadow: true }).data,
  });

  // Store localPlayer ID for debug features
  localPlayerEntityId = localPlayer.id;

  // Sync the entity with renderer
  const entityRenderer = getEntityRenderer();
  if (entityRenderer) {
    entityRenderer.syncEntity(localPlayer);
  }

  console.log('[Engine] Created local player entity');
}

/**
 * Save/Load Management API
 */

export function getSaveLoadManager(): SaveLoadManager | null {
  return saveLoadManager;
}

export function setContentPipeline(pipeline: ContentPipelineAdapter | null): void {
  contentPipeline = pipeline;
}

export function getContentPipeline(): ContentPipelineAdapter | null {
  return contentPipeline;
}

export function saveMap(name: string): boolean {
  if (contentPipeline) {
    return contentPipeline.saveMap(name);
  }
  if (!saveLoadManager) {
    console.warn('[Engine] SaveLoadManager not initialized');
    return false;
  }
  return saveLoadManager.saveMap(name);
}

export function loadMap(name: string): { success: boolean; entitiesCreated: number; settingsApplied: number } {
  if (contentPipeline) {
    const result = contentPipeline.loadMap(name);

    if (result.success && entityRenderer && entityManager) {
      const entities = entityManager.getEntities();
      for (const entity of entities) {
        if (!entity.hasComponent('render')) {
          continue;
        }
        entityRenderer.syncEntity(entity);
      }
    }

    return result;
  }
  if (!saveLoadManager) {
    console.warn('[Engine] SaveLoadManager not initialized');
    return { success: false, entitiesCreated: 0, settingsApplied: 0 };
  }

  const result = saveLoadManager.loadMap(name);

  // After loading, sync all entities with renderer
  if (result.success && entityRenderer && entityManager) {
    const entities = entityManager.getEntities();
    for (const entity of entities) {
      // Only sync if it doesn't already have rendering (avoid re-rendering)
      if (!entity.hasComponent('render')) {
        continue;
      }
      entityRenderer.syncEntity(entity);
    }
  }

  return result;
}

export function listMaps(): string[] {
  if (contentPipeline) {
    return contentPipeline.listMaps();
  }
  if (!saveLoadManager) {
    console.warn('[Engine] SaveLoadManager not initialized');
    return [];
  }
  return saveLoadManager.listMaps();
}

export function deleteMap(name: string): boolean {
  if (contentPipeline) {
    return contentPipeline.deleteMap(name);
  }
  if (!saveLoadManager) {
    console.warn('[Engine] SaveLoadManager not initialized');
    return false;
  }
  return saveLoadManager.deleteMap(name);
}

export function exportMap(name?: string): string {
  if (contentPipeline) {
    return contentPipeline.exportMap(name);
  }
  if (!saveLoadManager) {
    console.warn('[Engine] SaveLoadManager not initialized');
    return '';
  }
  return saveLoadManager.exportMap(name);
}

export function importMap(json: string, name?: string): { success: boolean; entitiesCreated: number; settingsApplied: number } {
  if (contentPipeline) {
    const result = contentPipeline.importMap(json, name);

    if (result.success && entityRenderer && entityManager) {
      const entities = entityManager.getEntities();
      for (const entity of entities) {
        if (!entity.hasComponent('render')) {
          continue;
        }
        entityRenderer.syncEntity(entity);
      }
    }

    return result;
  }
  if (!saveLoadManager) {
    console.warn('[Engine] SaveLoadManager not initialized');
    return { success: false, entitiesCreated: 0, settingsApplied: 0 };
  }

  const result = saveLoadManager.importMap(json, name);

  // After importing, sync all entities with renderer
  if (result.success && entityRenderer && entityManager) {
    const entities = entityManager.getEntities();
    for (const entity of entities) {
      // Only sync if it doesn't already have rendering
      if (!entity.hasComponent('render')) {
        continue;
      }
      entityRenderer.syncEntity(entity);
    }
  }

  return result;
}

export function getMapInfo(name: string) {
  if (contentPipeline?.getMapInfo) {
    return contentPipeline.getMapInfo(name);
  }
  if (!saveLoadManager) {
    console.warn('[Engine] SaveLoadManager not initialized');
    return null;
  }
  return saveLoadManager.getMapInfo(name);
}

/**
 * State Management API
 */
export function getStateManagerInstance() {
  return getStateManager();
}

// ── GAS (Gameplay Ability System) getters ─────────────────────────────────────

export function getGasDataRegistry(): DataRegistry | null {
  return gasDataRegistry;
}

export function getGasAttributeStore(): EntityAttributeStore | null {
  return gasAttributes;
}

export function getGasEffectSystem(): EffectSystem | null {
  return gasEffects;
}

export function getGasItemSystem(): ItemInstanceSystem | null {
  return gasItems;
}

