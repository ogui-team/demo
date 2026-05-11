import type { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import type { GameModeManager } from '../../../2-systems/gameplay/game/GameModeManager';
import type { GameModeSystem } from '../../../2-systems/gameplay/game/GameModeSystem';
import type { PlayerModelSystem } from '../../../2-systems/gameplay/game/PlayerModelSystem';
import type { HUDSystem } from '../../../2-systems/gameplay/systems/HUDSystem';
import type { WeaponSystem } from '../../../2-systems/gameplay/systems/WeaponSystem';
import type { HealthSystem } from '../../../2-systems/gameplay/systems/HealthSystem';
import type { InventorySystem } from '../../../2-systems/gameplay/systems/InventorySystem';
import type { PrefabSystem } from '../../../2-systems/gameplay/systems/PrefabSystem';
import type { ObjectCreatorSystem } from '../../../2-systems/gameplay/game/ObjectCreatorSystem';
import type { AudioSystem } from '../../../2-systems/gameplay/systems/AudioSystem';
import type { AbilitySystem } from '../../../2-systems/gameplay/systems/gas/AbilitySystem';
import type { PathfindingSystem } from '../../../2-systems/gameplay/systems/PathfindingSystem';
import type { VFXSystem } from '../../../2-systems/gameplay/systems/VFXSystem';
import type { WorldObjectAuthorityService } from '../../../2-systems/gameplay/game/WorldObjectAuthorityService';
import type { CollisionAuthoritySystem } from '../../../3-network/network/CollisionAuthoritySystem';
import type { CharacterActorSystem } from '../../../2-systems/gameplay/game/CharacterActorSystem';
import type { PhysicsSystem } from '../../../2-systems/gameplay/systems/PhysicsSystem';
import type { WeaponPresentationSystem } from '../../../2-systems/gameplay/game/WeaponPresentationSystem';
import type { HordeSystem } from '../../../2-systems/gameplay/systems/HordeSystem';
import type { SpawnSystem } from '../../../2-systems/gameplay/systems/SpawnSystem';
import type { SaveLoadManager } from '@engine/1-kernel/core/public-api';
import { orchestrateCorridorManifest } from '../../../0-foundation/foundation/CorridorOrchestrator';
import { registerSystemMetadata } from '@engine/1-kernel/core/public-api';
import { getContextDeps } from './support';

export interface RegisterSystemMetadataOptions {
  mpClient: MultiplayerClient;
  gameModeManager: GameModeManager;
  gameHUD: HUDSystem;
  stateManager: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
    update: (updates: Record<string, unknown>) => void;
  };
  systemContext: unknown; // SystemContext type
  collisionAuthoritySystem: CollisionAuthoritySystem;
  worldObjectAuthorityService: WorldObjectAuthorityService;
  characterActorSystem: CharacterActorSystem;
  physicsSystem: PhysicsSystem;
  spriteAtlasSystem: unknown;
  camera2DSystem: unknown;
  featureManager: unknown;
  gameModeSystem: GameModeSystem;
  playerModelSystem: PlayerModelSystem;
  weaponSystem: WeaponSystem;
  healthSystem: HealthSystem;
  physics2DSystem: unknown;
  input2DAdapterSystem: unknown;
  spriteAnimationSystem: unknown;
  objectCreator: ObjectCreatorSystem;
  prefabSystem: PrefabSystem;
  abilitySystem: AbilitySystem;
  weaponPresentationSystem: WeaponPresentationSystem;
  spawnSystem: SpawnSystem;
  undoRedoSystem: unknown;
  inventorySystem: InventorySystem;
  tilemapSystem: unknown;
  parallax2DSystem: unknown;
  spriteRenderSystem: unknown;
  ui2DSystem: unknown;
  adaptiveRuntime: unknown;
  materialManager: unknown;
  audioManager: unknown;
  audioSystem: AudioSystem;
  vfxSystem: VFXSystem;
  pathfindingSystem: PathfindingSystem;
  debugManager: unknown;
  dodInspectorPlugin: unknown;
  editorShellPlugin: unknown;
  scriptedLevelSystem: unknown | null;
  hordeSystem: HordeSystem;
}

export interface RegisterGameModeContextOptions {
  engineGameModes: GameModeSystem;
}

export interface RegisterSaveLoadHandlersOptions {
  saveLoadManager: SaveLoadManager | null | undefined;
  weaponSystem: WeaponSystem;
  inventorySystem: InventorySystem;
  prefabSystem: PrefabSystem;
  spawnSystem: SpawnSystem;
  engineGameModes: GameModeSystem;
}

/**
 * Register all system metadata and corridor manifests for runtime systems
 */
export function registerRuntimeSystems(options: RegisterSystemMetadataOptions): void {
  const {
    mpClient,
    gameModeManager,
    stateManager,
    systemContext,
    collisionAuthoritySystem,
    worldObjectAuthorityService,
    characterActorSystem,
    physicsSystem,
    spriteAtlasSystem,
    camera2DSystem,
    featureManager,
    gameModeSystem,
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
    undoRedoSystem,
    inventorySystem,
    tilemapSystem,
    parallax2DSystem,
    spriteRenderSystem,
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
    scriptedLevelSystem,
    hordeSystem,
  } = options;

  // Primary system registration (collision authority, characters, physics, etc.)
  orchestrateCorridorManifest({
    manifest: [
      {
        id: 'collisionAuthoritySystem',
        system: collisionAuthoritySystem,
        metadata: { displayName: 'Collision Authority System', category: 'Networking', order: 4 },
        capabilities: { exposesDebug: true, deterministic: true },
      },
      {
        id: 'worldObjectAuthorityService',
        system: worldObjectAuthorityService,
        metadata: { displayName: 'World Object Authority Service', category: 'Networking', order: 4 },
        capabilities: { usesEventBus: true, usesReplication: true, exposesDebug: true, deterministic: false },
      },
      {
        id: 'characterActorSystem',
        system: characterActorSystem,
        metadata: { displayName: 'Character Actor System', category: 'Gameplay', order: 9 },
        capabilities: { usesEventBus: true, usesReplication: true, exposesDebug: true, deterministic: false },
      },
      {
        id: 'multiplayerClient',
        system: mpClient,
        metadata: {
          displayName: 'Multiplayer Client',
          category: 'Networking',
          order: 5,
          properties: [
            {
              key: 'disconnect',
              label: 'Disconnect Socket',
              type: 'action',
              description: 'Force-close the live multiplayer connection and return to the browser.',
              action: (system) => { (system as MultiplayerClient).disconnect(); },
            },
          ],
        },
        capabilities: { exposesDebug: true, usesNetworkFacade: true, deterministic: false },
      },
      {
        id: 'physicsSystem',
        system: physicsSystem,
        metadata: { displayName: 'Physics System', category: 'Simulation', order: 10 },
        capabilities: { exposesDebug: true, deterministic: true },
      },
      {
        id: 'spriteAtlasSystem',
        system: spriteAtlasSystem,
        metadata: { displayName: 'Sprite Atlas System', category: 'Rendering', order: 11 },
        capabilities: { exposesDebug: true, deterministic: true },
      },
      {
        id: 'camera2DSystem',
        system: camera2DSystem,
        metadata: { displayName: '2D Camera System', category: 'Rendering', order: 12 },
        capabilities: { exposesDebug: true, deterministic: true },
      },
      {
        id: 'featureManager',
        system: featureManager,
        metadata: { displayName: 'Feature Manager', category: 'Core', order: 13 },
        capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true },
      },
      {
        id: 'gameModeManager',
        system: gameModeManager,
        metadata: {
          displayName: 'Game Mode Manager',
          category: 'Gameplay',
          order: 10,
          getState: (system) => {
            const manager = system as GameModeManager;
            const round = manager.getRound();
            return {
              lifecycleState: manager.getLifecycleState(),
              playerCount: manager.getPlayers().length,
              roundStatus: round.status,
              roundNumber: round.roundNumber,
              roundWinner: round.winnerId ?? null,
            };
          },
        },
        capabilities: { usesEventBus: true, exposesDebug: true, usesNetworkFacade: true, deterministic: false },
      },
      {
        id: 'healthSystem',
        system: healthSystem,
        metadata: { displayName: 'Health System', category: 'Gameplay', order: 20 },
        capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true },
      },
      {
        id: 'physics2DSystem',
        system: physics2DSystem,
        metadata: { displayName: 'Physics 2D System', category: 'Gameplay', order: 21 },
        capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true },
      },
      {
        id: 'input2DAdapterSystem',
        system: input2DAdapterSystem,
        metadata: { displayName: 'Input 2D Adapter System', category: 'Gameplay', order: 22 },
        capabilities: { usesEventBus: true, exposesDebug: true, deterministic: false },
      },
      {
        id: 'spriteAnimationSystem',
        system: spriteAnimationSystem,
        metadata: { displayName: 'Sprite Animation System', category: 'Gameplay', order: 23 },
        capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true },
      },
      {
        id: 'objectCreatorSystem',
        system: objectCreator,
        metadata: {
          displayName: 'Object Creator System',
          category: 'Gameplay',
          order: 24,
          getState: (system) => {
            const debugState = (system as ObjectCreatorSystem).getDebugState();
            const metrics = (debugState.metrics ?? {}) as Record<string, unknown>;
            return {
              objectCount: metrics.objectCount,
              prefabCount: metrics.prefabCount,
            };
          },
        },
        capabilities: { usesReplication: true, exposesDebug: true, usesNetworkFacade: true, deterministic: false },
      },
      {
        id: 'playerModelSystem',
        system: playerModelSystem,
        metadata: {
          displayName: 'Player Model System',
          category: 'Gameplay',
          order: 25,
          getState: (system) => ({
            playerCount: (system as PlayerModelSystem).getPlayerCount(),
            playerIds: (system as PlayerModelSystem).getPlayerIds().slice(0, 8),
          }),
        },
        capabilities: { usesEventBus: true, usesReplication: true, exposesDebug: true, deterministic: false },
      },
      {
        id: 'weaponSystem',
        system: weaponSystem,
        metadata: { displayName: 'Weapon System', category: 'Gameplay', order: 30 },
        capabilities: { usesEventBus: true, exposesDebug: true, usesNetworkFacade: true, deterministic: false },
      },
      {
        id: 'undoRedoSystem',
        system: undoRedoSystem,
        metadata: { displayName: 'Undo / Redo System', category: 'Editor', order: 31 },
        capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true },
      },
      {
        id: 'abilitySystem',
        system: abilitySystem,
        metadata: {
          displayName: 'Ability System',
          category: 'Gameplay',
          order: 32,
          getState: (system) => {
            const debugState = (system as AbilitySystem).getDebugState();
            const metrics = (debugState.metrics ?? {}) as Record<string, unknown>;
            return {
              cooldowns: metrics.cooldownCount,
              projectiles: metrics.projectileCount,
              aoeZones: metrics.aoeZoneCount,
            };
          },
        },
        capabilities: { usesEventBus: true, exposesDebug: true, usesNetworkFacade: true, deterministic: false },
      },
      {
        id: 'pathfindingSystem',
        system: pathfindingSystem,
        metadata: { displayName: 'Pathfinding System', category: 'Gameplay', order: 33 },
        capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true },
      },
      {
        id: 'prefabSystem',
        system: prefabSystem,
        metadata: {
          displayName: 'Prefab System',
          category: 'Gameplay',
          order: 35,
          getState: (system) => {
            const prefab = system as PrefabSystem;
            const debugState = typeof prefab.getDebugState === 'function' ? prefab.getDebugState() : {};
            const metrics = ((debugState as Record<string, unknown>).metrics ?? {}) as Record<string, unknown>;
            return {
              prefabCount: prefab.listPrefabs().length,
              liveInstances: typeof metrics.liveInstances === 'number' ? metrics.liveInstances : undefined,
            };
          },
        },
        capabilities: { usesEventBus: true, usesReplication: true, exposesDebug: true, usesNetworkFacade: true, deterministic: false },
      },
      {
        id: 'tilemapSystem',
        system: tilemapSystem,
        metadata: { displayName: 'Tilemap System', category: 'World', order: 37 },
        capabilities: { usesEventBus: true, usesReplication: true, exposesDebug: true, usesNetworkFacade: true, deterministic: true },
      },
      {
        id: 'spriteRenderSystem',
        system: spriteRenderSystem,
        metadata: { displayName: 'Sprite Render System', category: 'Rendering', order: 38 },
        capabilities: { usesEventBus: true, usesReplication: true, exposesDebug: true, usesNetworkFacade: true, deterministic: false },
      },
      {
        id: 'parallax2DSystem',
        system: parallax2DSystem,
        metadata: { displayName: 'Parallax 2D System', category: 'Rendering', order: 39 },
        capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true },
      },
      {
        id: 'ui2DSystem',
        system: ui2DSystem,
        metadata: { displayName: 'UI 2D System', category: 'UI', order: 40 },
        capabilities: { usesEventBus: true, usesReplication: true, exposesDebug: true, usesNetworkFacade: true, deterministic: false },
      },
      {
        id: 'adaptiveRuntime',
        system: adaptiveRuntime,
        metadata: { displayName: 'Adaptive Runtime Layer', category: 'Gameplay', order: 40 },
        capabilities: { usesEventBus: true, exposesDebug: true, deterministic: true },
      },
      {
        id: 'materialManager',
        system: materialManager,
        metadata: { displayName: 'Material Manager', category: 'Rendering', order: 14 },
        capabilities: { exposesDebug: true, deterministic: true },
      },
      {
        id: 'vfxSystem',
        system: vfxSystem,
        metadata: { displayName: 'VFX System', category: 'Rendering', order: 15 },
        capabilities: { exposesDebug: true, deterministic: false },
      },
      {
        id: 'gameAudioManager',
        system: audioManager,
        metadata: { displayName: 'Audio Manager', category: 'Audio', order: 16 },
        capabilities: { exposesDebug: true, deterministic: false },
      },
      {
        id: 'audioSystem',
        system: audioSystem,
        metadata: { displayName: 'Audio System', category: 'Audio', order: 17 },
        capabilities: { exposesDebug: true, deterministic: false },
      },
      ...(scriptedLevelSystem
        ? [{
            id: 'scriptedLevelSystem',
            system: scriptedLevelSystem,
            metadata: { displayName: 'Scripted Level System', category: 'Gameplay', order: 34 },
            capabilities: { exposesDebug: true, deterministic: false },
          }]
        : []),
      {
        id: 'spawnSystem',
        system: spawnSystem,
        metadata: { displayName: 'Spawn System', category: 'Gameplay', order: 35 },
        capabilities: { exposesDebug: true, deterministic: false },
      },
      {
        id: 'hordeSystem',
        system: hordeSystem,
        metadata: { displayName: 'Horde System', category: 'Gameplay', order: 36 },
        capabilities: { usesEventBus: true, exposesDebug: true, deterministic: false },
      },
      {
        id: 'weaponPresentationSystem',
        system: weaponPresentationSystem,
        metadata: { displayName: 'Weapon Presentation System', category: 'Rendering', order: 38 },
        capabilities: { exposesDebug: true, deterministic: false },
      },
      {
        id: 'debugManager',
        system: debugManager,
        metadata: { displayName: 'Debug Manager', category: 'Debug', order: 2 },
        capabilities: { exposesDebug: true, deterministic: false },
      },
      {
        id: 'dodInspectorPlugin',
        system: dodInspectorPlugin,
        metadata: { displayName: 'DOD Inspector Plugin', category: 'Debug', order: 3 },
        capabilities: { exposesDebug: true, deterministic: false },
      },
      {
        id: 'editorShellPlugin',
        system: editorShellPlugin,
        metadata: { displayName: 'Editor Shell Plugin', category: 'Debug', order: 4 },
        capabilities: { exposesDebug: true, deterministic: false },
      },
    ],
    contextDeps: getContextDeps(mpClient),
    systemContext: systemContext as any,
    strictDependencies: true,
  });

  // Secondary system registration (inventory and HUD)
  registerSecondarySystemsForCorridor(
    { inventorySystem },
    { mpClient, stateManager, systemContext }
  );

  // Register multiplayer client metadata
  registerSystemMetadata('multiplayerClient', {
    getState: (system: any) => ({
      connected: (system as MultiplayerClient).connected,
      ...(system as MultiplayerClient).getDebugStats(),
      protocol: (system as MultiplayerClient).getProtocolDiagnostics(),
    }),
  });
}

/**
 * Register secondary systems (inventory, HUD) in the corridor
 */
function registerSecondarySystemsForCorridor(
  systems: { inventorySystem: InventorySystem },
  options: { mpClient: MultiplayerClient; stateManager: any; systemContext: any }
): void {
  orchestrateCorridorManifest({
    manifest: [
      {
        id: 'inventorySystem',
        system: systems.inventorySystem,
        metadata: { displayName: 'Inventory System', category: 'Gameplay', order: 36 },
        capabilities: { usesReplication: true, exposesDebug: true, deterministic: false },
      },
    ],
    contextDeps: getContextDeps(options.mpClient),
    systemContext: options.systemContext,
    strictDependencies: true,
  });
}



/**
 * Register save/load handlers for various game systems
 */
export function registerSaveLoadHandlers(options: RegisterSaveLoadHandlersOptions): void {
  const { saveLoadManager, weaponSystem, inventorySystem, prefabSystem, spawnSystem, engineGameModes } = options;

  saveLoadManager?.registerSystemDataHandler('weapons', () => weaponSystem.exportState(), (data) => weaponSystem.importState(data as never));
  saveLoadManager?.registerSystemDataHandler('inventories', () => inventorySystem.exportState(), (data) => inventorySystem.importState(data as never));
  saveLoadManager?.registerSystemDataHandler('prefabs', () => prefabSystem.exportState(), (data) => prefabSystem.importState(data as never));
  saveLoadManager?.registerSystemDataHandler('spawns', () => spawnSystem.exportState(), (data) => spawnSystem.importState(data as never));
  saveLoadManager?.registerSystemDataHandler('gameModes', () => engineGameModes.captureSnapshot(), (data) => {
    if (data) engineGameModes.restoreSnapshot(data as never);
  });
}
