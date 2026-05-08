import type { EventBus } from '@engine/1-kernel/core/public-api';
import type { EntityManager } from '@engine/1-kernel/core/public-api';
import type { GameEvents } from '@engine/1-kernel/core/public-api';
import {
  getSystem,
  getSystemStateSnapshot,
  listSystems,
  markSystemError,
  registerSystem,
  type SystemDebugMetadata,
} from '@engine/1-kernel/core/public-api';
import {
  bindSystemContext,
  createNetworkFacade,
  createReplicationFacade,
  createSystemAccessProxy,
  type EngineSystem,
  type SystemCapabilities,
  type SystemContext,
} from '@engine/1-kernel/core/public-api';
import type { NetworkManager } from '../../3-network/network/NetworkManager';
import type { MultiplayerClient } from '../../3-network/network/MultiplayerClient';
import type { NetworkSyncSystem } from '../../3-network/network/NetworkSyncSystem';
import type { ReplicationSystem } from '../../3-network/network/ReplicationSystem';
import type { ResourceManager } from '../../2-systems/gameplay/systems/ResourceManager';
import {
  validateEngineRuntime,
  type SystemValidationReport,
  type SystemValidatorDeps,
} from '../../4-runtime/diagnostics/debug/SystemValidator';
import { runRuntimeCapabilityAuditHook } from '../../4-runtime/audit/RuntimeCapabilityAudit';

const boundSystems = new WeakSet<object>();
const initializedSystems = new WeakSet<object>();

export type OrchestratorScope = 'client' | 'server';

export type BootstrapTarget = 'Engine.ts' | 'index.ts' | 'server' | 'shared' | 'unbound';

export type OrchestratorCategory =
  | 'Core'
  | 'Networking'
  | 'Gameplay'
  | 'World'
  | 'Editor'
  | 'UI'
  | 'Diagnostics'
  | 'Rendering'
  | 'Server';

export interface FullEngineAuditTemplateEntry {
  id: string;
  auditName: string;
  scope: OrchestratorScope;
  bootstrapTarget: BootstrapTarget;
  category: OrchestratorCategory;
  order: number;
  fileHint: string;
  dependencies?: readonly string[];
}

export const FULL_ENGINE_AUDIT_TEMPLATE = [
  { id: 'abilitySystem', auditName: 'AbilitySystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 310, fileHint: 'client/src/engine/systems/gas/AbilitySystem.ts', dependencies: ['dataRegistry', 'attributeStore', 'effectSystem', 'healthSystem'] },
  { id: 'clientCollisionAuthoritySystem', auditName: 'CollisionAuthoritySystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Networking', order: 250, fileHint: 'client/src/engine/network/CollisionAuthoritySystem.ts' },
  { id: 'serverCollisionAuthoritySystem', auditName: 'CollisionAuthoritySystem', scope: 'server', bootstrapTarget: 'server', category: 'Server', order: 1000, fileHint: 'server/src/CollisionAuthoritySystem.ts' },
  { id: 'combatSystem', auditName: 'CombatSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 320, fileHint: 'client/src/engine/game/CombatSystem.ts', dependencies: ['weaponSystem', 'networkManager'] },
  { id: 'cullingSystem', auditName: 'CullingSystem', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Rendering', order: 610, fileHint: 'client/src/engine/systems/CullingSystem.ts', dependencies: ['entityManager'] },
  { id: 'camera2DSystem', auditName: 'Camera2DSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Rendering', order: 605, fileHint: 'client/src/engine/systems/2d/Camera2DSystem.ts' },
  { id: 'debugManager', auditName: 'DebugManager', scope: 'client', bootstrapTarget: 'index.ts', category: 'Diagnostics', order: 710, fileHint: 'client/src/engine/debug/DebugManager.ts', dependencies: ['modeManager'] },
  { id: 'editorController', auditName: 'EditorController', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Editor', order: 210, fileHint: 'client/src/engine/EditorController.ts' },
  { id: 'effectSystem', auditName: 'EffectSystem', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Gameplay', order: 130, fileHint: 'client/src/engine/systems/gas/EffectSystem.ts', dependencies: ['dataRegistry', 'attributeStore'] },
  { id: 'engine', auditName: 'Engine', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Core', order: 10, fileHint: 'client/src/engine/Engine.ts' },
  { id: 'engineController', auditName: 'EngineController', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Core', order: 80, fileHint: 'client/src/engine/core/EngineController.ts', dependencies: ['entityManager', 'modeManager'] },
  { id: 'entityManager', auditName: 'EntityManager', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Core', order: 40, fileHint: 'client/src/engine/core/EntityManager.ts' },
  { id: 'featureManager', auditName: 'FeatureManagerClass', scope: 'client', bootstrapTarget: 'shared', category: 'Core', order: 90, fileHint: 'client/src/engine/core/FeatureManager.ts' },
  { id: 'gameAudioManager', auditName: 'GameAudioManager', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 420, fileHint: 'client/src/engine/systems/GameAudioManager.ts' },
  { id: 'replaySystem', auditName: 'ReplaySystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Core', order: 75, fileHint: 'client/src/engine/core/ReplaySystem.ts' },
  { id: 'gameModeManager', auditName: 'GameModeManager', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 260, fileHint: 'client/src/engine/game/GameModeManager.ts', dependencies: ['stateManager'] },
  { id: 'gameModeSystem', auditName: 'GameModeSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 270, fileHint: 'client/src/engine/game/GameModeSystem.ts', dependencies: ['gameModeManager'] },
  { id: 'gizmoSystem', auditName: 'GizmoSystem', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Editor', order: 220, fileHint: 'client/src/engine/GizmoSystem.ts', dependencies: ['selectionSystem', 'stateManager', 'entityManager'] },
  { id: 'characterActorSystem', auditName: 'CharacterActorSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 275, fileHint: 'client/src/engine/game/CharacterActorSystem.ts', dependencies: ['entityManager', 'spatialPartitionSystem', 'worldObjectAuthorityService'] },
  { id: 'healthSystem', auditName: 'HealthSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 280, fileHint: 'client/src/engine/systems/HealthSystem.ts', dependencies: ['stateManager'] },
  { id: 'highlightSystem', auditName: 'HighlightSystem', scope: 'client', bootstrapTarget: 'unbound', category: 'Editor', order: 230, fileHint: 'client/src/engine/systems/HighlightSystem.ts' },
  { id: 'hudSystem', auditName: 'HUDSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'UI', order: 720, fileHint: 'client/src/engine/systems/HUDSystem.ts', dependencies: ['stateManager'] },
  { id: 'input2DAdapterSystem', auditName: 'Input2DAdapterSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 345, fileHint: 'client/src/engine/systems/2d/Input2DAdapterSystem.ts', dependencies: ['physics2DSystem'] },
  { id: 'inputManager', auditName: 'InputManager', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Core', order: 110, fileHint: 'client/src/engine/core/InputManager.ts', dependencies: ['engineController'] },
  { id: 'interactionManager', auditName: 'InteractionManager', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Gameplay', order: 330, fileHint: 'client/src/engine/systems/InteractionManager.ts', dependencies: ['entityManager'] },
  { id: 'inventoryGridManager', auditName: 'InventoryGridManager', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'UI', order: 730, fileHint: 'client/src/engine/systems/InventoryGridManager.ts' },
  { id: 'inventoryManager', auditName: 'InventoryManager', scope: 'server', bootstrapTarget: 'server', category: 'Server', order: 1010, fileHint: 'server/src/inventoryManager.ts' },
  { id: 'inventorySystem', auditName: 'InventorySystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 340, fileHint: 'client/src/engine/systems/InventorySystem.ts', dependencies: ['healthSystem', 'weaponSystem', 'stateManager'] },
  { id: 'itemInstanceSystem', auditName: 'ItemInstanceSystem', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Gameplay', order: 140, fileHint: 'client/src/engine/systems/gas/ItemInstanceSystem.ts', dependencies: ['dataRegistry', 'effectSystem'] },
  { id: 'lobbyManager', auditName: 'LobbyManager', scope: 'client', bootstrapTarget: 'index.ts', category: 'Networking', order: 520, fileHint: 'client/src/engine/network/LobbyManager.ts', dependencies: ['multiplayerClient'] },
  { id: 'materialManager', auditName: 'MaterialManager', scope: 'client', bootstrapTarget: 'index.ts', category: 'World', order: 430, fileHint: 'client/src/engine/systems/MaterialManager.ts' },
  { id: 'metadataStore', auditName: 'MetadataStore', scope: 'client', bootstrapTarget: 'unbound', category: 'Core', order: 150, fileHint: 'client/src/engine/reflection/ReflectionSystem.ts' },
  { id: 'modeManager', auditName: 'ModeManager', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Editor', order: 200, fileHint: 'client/src/engine/ModeManager.ts' },
  { id: 'multiplayerClient', auditName: 'MultiplayerClient', scope: 'client', bootstrapTarget: 'index.ts', category: 'Networking', order: 500, fileHint: 'client/src/engine/network/MultiplayerClient.ts', dependencies: ['networkSyncSystem'] },
  { id: 'networkManager', auditName: 'NetworkManager', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Networking', order: 160, fileHint: 'client/src/engine/network/NetworkManager.ts', dependencies: ['entityManager'] },
  { id: 'networkSyncSystem', auditName: 'NetworkSyncSystem', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Networking', order: 170, fileHint: 'client/src/engine/network/NetworkSyncSystem.ts', dependencies: ['networkManager', 'replicationSystem', 'entityManager', 'spatialPartitionSystem'] },
  { id: 'objectCreatorSystem', auditName: 'ObjectCreatorSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'World', order: 440, fileHint: 'client/src/engine/game/ObjectCreatorSystem.ts', dependencies: ['entityManager', 'stateManager'] },
  { id: 'worldObjectAuthorityService', auditName: 'WorldObjectAuthorityService', scope: 'client', bootstrapTarget: 'index.ts', category: 'World', order: 442, fileHint: 'client/src/engine/game/WorldObjectAuthorityService.ts', dependencies: ['entityManager', 'prefabSystem', 'clientCollisionAuthoritySystem'] },
  { id: 'pathfindingSystem', auditName: 'PathfindingSystem', scope: 'client', bootstrapTarget: 'unbound', category: 'World', order: 450, fileHint: 'client/src/engine/systems/PathfindingSystem.ts' },
  { id: 'parallax2DSystem', auditName: 'ParallaxSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Rendering', order: 608, fileHint: 'client/src/engine/systems/2d/ParallaxSystem.ts', dependencies: ['camera2DSystem', 'spriteAtlasSystem'] },
  { id: 'physGunSystem', auditName: 'PhysGunSystem', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Gameplay', order: 350, fileHint: 'client/src/engine/systems/PhysGunSystem.ts', dependencies: ['interactionManager', 'entityManager', 'stateManager'] },
  { id: 'physics2DSystem', auditName: 'Physics2DSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 295, fileHint: 'client/src/engine/systems/2d/Physics2DSystem.ts', dependencies: ['tilemapSystem'] },
  { id: 'physicsSystem', auditName: 'PhysicsSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 290, fileHint: 'client/src/engine/systems/PhysicsSystem.ts' },
  { id: 'pickupSystem', auditName: 'PickupSystem', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Gameplay', order: 360, fileHint: 'client/src/engine/systems/PickupSystem.ts', dependencies: ['interactionManager', 'entityManager'] },
  { id: 'playController', auditName: 'PlayController', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Gameplay', order: 240, fileHint: 'client/src/engine/PlayController.ts' },
  { id: 'playerModelSystem', auditName: 'PlayerModelSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 370, fileHint: 'client/src/engine/game/PlayerModelSystem.ts', dependencies: ['entityManager', 'stateManager'] },
  { id: 'prefabSystem', auditName: 'PrefabSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'World', order: 460, fileHint: 'client/src/engine/systems/PrefabSystem.ts', dependencies: ['stateManager', 'objectCreatorSystem'] },
  { id: 'ps1ShaderSystem', auditName: 'PS1ShaderSystem', scope: 'client', bootstrapTarget: 'unbound', category: 'Rendering', order: 620, fileHint: 'client/src/engine/systems/PS1ShaderSystem.ts' },
  { id: 'spriteAnimationSystem', auditName: 'SpriteAnimationSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 346, fileHint: 'client/src/engine/systems/2d/SpriteAnimationSystem.ts', dependencies: ['spriteRenderSystem'] },
  { id: 'spriteAtlasSystem', auditName: 'SpriteAtlasSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Rendering', order: 600, fileHint: 'client/src/engine/systems/2d/SpriteAtlasSystem.ts' },
  { id: 'spritePrefabExtension', auditName: 'SpritePrefabExtension', scope: 'client', bootstrapTarget: 'index.ts', category: 'World', order: 465, fileHint: 'client/src/engine/systems/2d/SpritePrefabExtension.ts', dependencies: ['prefabSystem', 'spriteAtlasSystem'] },
  { id: 'spriteRenderSystem', auditName: 'SpriteRenderSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Rendering', order: 606, fileHint: 'client/src/engine/systems/2d/SpriteRenderSystem.ts', dependencies: ['camera2DSystem', 'spriteAtlasSystem', 'spriteAnimationSystem'] },
  { id: 'replicationSystem', auditName: 'ReplicationSystem', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Networking', order: 180, fileHint: 'client/src/engine/network/ReplicationSystem.ts', dependencies: ['entityManager'] },
  { id: 'resourceManager', auditName: 'ResourceManager', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'World', order: 470, fileHint: 'client/src/engine/systems/ResourceManager.ts' },
  { id: 'saveLoadManager', auditName: 'SaveLoadManager', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Core', order: 70, fileHint: 'client/src/engine/core/SaveLoadManager.ts', dependencies: ['entityManager', 'stateManager'] },
  { id: 'scriptedLevelSystem', auditName: 'ScriptedLevelSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'World', order: 480, fileHint: 'client/src/engine/game/ScriptedLevelSystem.ts', dependencies: ['prefabSystem', 'materialManager', 'gameAudioManager'] },
  { id: 'scriptingSystem', auditName: 'ScriptingSystem', scope: 'client', bootstrapTarget: 'unbound', category: 'Core', order: 120, fileHint: 'client/src/engine/core/ScriptingSystem.ts' },
  { id: 'selectionSystem', auditName: 'SelectionSystem', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Editor', order: 215, fileHint: 'client/src/engine/SelectionSystem.ts', dependencies: ['entityManager', 'modeManager'] },
  { id: 'spatialPartitionSystem', auditName: 'SpatialPartitionSystem', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'World', order: 490, fileHint: 'client/src/engine/systems/SpatialPartitionSystem.ts', dependencies: ['entityManager'] },
  { id: 'spawnSystem', auditName: 'SpawnSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'World', order: 500, fileHint: 'client/src/engine/systems/SpawnSystem.ts', dependencies: ['entityManager', 'prefabSystem'] },
  { id: 'stateManager', auditName: 'StateManager', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'Core', order: 30, fileHint: 'client/src/engine/StateManager.ts' },
  { id: 'toolbarSystem', auditName: 'ToolbarSystem', scope: 'client', bootstrapTarget: 'Engine.ts', category: 'UI', order: 740, fileHint: 'client/src/engine/systems/ToolbarSystem.ts', dependencies: ['inventoryGridManager'] },
  { id: 'tilemapSystem', auditName: 'TilemapSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'World', order: 461, fileHint: 'client/src/engine/systems/2d/TilemapSystem.ts', dependencies: ['spriteAtlasSystem', 'camera2DSystem'] },
  { id: 'undoRedoSystem', auditName: 'UndoRedoSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Editor', order: 225, fileHint: 'client/src/engine/core/UndoRedoSystem.ts' },
  { id: 'ui2DSystem', auditName: 'UI2DSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'UI', order: 721, fileHint: 'client/src/engine/systems/2d/UI2DSystem.ts', dependencies: ['camera2DSystem'] },
  { id: 'weaponPresentationSystem', auditName: 'WeaponPresentationSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 380, fileHint: 'client/src/engine/game/WeaponPresentationSystem.ts', dependencies: ['weaponSystem', 'playerModelSystem'] },
  { id: 'weaponSystem', auditName: 'WeaponSystem', scope: 'client', bootstrapTarget: 'index.ts', category: 'Gameplay', order: 300, fileHint: 'client/src/engine/systems/WeaponSystem.ts', dependencies: ['healthSystem', 'physicsSystem', 'stateManager'] },
] as const satisfies readonly FullEngineAuditTemplateEntry[];

export type AuditTemplateId = typeof FULL_ENGINE_AUDIT_TEMPLATE[number]['id'];

export interface OrchestrationContextDeps {
  eventBus: EventBus<GameEvents>;
  entityManager: EntityManager | null;
  networkManager: NetworkManager | null;
  networkSyncSystem: NetworkSyncSystem | null;
  replicationSystem: ReplicationSystem | null;
  multiplayerClient?: MultiplayerClient | null;
  resourceManager: ResourceManager | null;
  resolveSystem?: <T = unknown>(name: string) => T | null;
}

export interface CorridorManifestEntry {
  id: string;
  system: unknown;
  enabled?: boolean;
  order?: number;
  dependencies?: readonly string[];
  metadata?: SystemDebugMetadata;
  capabilities?: Partial<SystemCapabilities>;
  beforeInit?: (entry: CorridorManifestEntry, ctx: SystemContext) => void;
  afterInit?: (entry: CorridorManifestEntry, ctx: SystemContext) => void;
}

export interface CorridorManifestOverride {
  enabled?: boolean;
  order?: number;
  dependencies?: readonly string[];
  metadata?: SystemDebugMetadata;
  capabilities?: Partial<SystemCapabilities>;
  beforeInit?: (entry: CorridorManifestEntry, ctx: SystemContext) => void;
  afterInit?: (entry: CorridorManifestEntry, ctx: SystemContext) => void;
}

export interface AuditPlaceholderOptions {
  enableRuntimeHook?: boolean;
  command?: string;
  reportPath?: string;
}

export interface RuntimeValidationOptions {
  label?: string;
  run: () => unknown;
}

export interface CorridorOrchestrationOptions {
  manifest: readonly CorridorManifestEntry[];
  contextDeps: OrchestrationContextDeps;
  systemContext?: SystemContext;
  strictDependencies?: boolean;
  runtimeValidation?: RuntimeValidationOptions;
  audit?: AuditPlaceholderOptions;
}

export interface CorridorOrchestrationReport {
  context: SystemContext;
  registeredIds: string[];
  skippedIds: string[];
  failedIds: string[];
  missingDependencies: Record<string, string[]>;
  registrySnapshots: Record<string, Record<string, unknown>>;
  runtimeValidationResult?: unknown;
  registrySize: number;
}

export function createCorridorSystemContext(deps: OrchestrationContextDeps): SystemContext {
  const resolveSystem = deps.resolveSystem ?? getSystem;
  const network = createNetworkFacade({
    networkManager: deps.networkManager,
    networkSyncSystem: deps.networkSyncSystem,
    replicationSystem: deps.replicationSystem,
    multiplayerClient: deps.multiplayerClient,
  });
  const replication = createReplicationFacade(deps.replicationSystem);

  return {
    eventBus: deps.eventBus,
    entityManager: deps.entityManager,
    network,
    replication,
    resources: deps.resourceManager,
    systems: createSystemAccessProxy((name) => resolveSystem(name)),
    resolveSystem,
  };
}

export function createAuditAlignedManifest(
  instances: Partial<Record<AuditTemplateId, unknown>>,
  overrides: Partial<Record<AuditTemplateId, CorridorManifestOverride>> = {},
): CorridorManifestEntry[] {
  return FULL_ENGINE_AUDIT_TEMPLATE.map((template) => {
    const override = overrides[template.id];
    const templateDependencies = 'dependencies' in template ? template.dependencies : undefined;
    return {
      id: template.id,
      system: instances[template.id] ?? null,
      enabled: override?.enabled ?? instances[template.id] != null,
      order: override?.order ?? template.order,
      dependencies: override?.dependencies ?? templateDependencies ?? [],
      metadata: {
        displayName: template.auditName,
        category: template.category,
        order: template.order,
        ...(override?.metadata ?? {}),
      },
      capabilities: override?.capabilities,
      beforeInit: override?.beforeInit,
      afterInit: override?.afterInit,
    };
  });
}

export function orchestrateCorridorManifest(options: CorridorOrchestrationOptions): CorridorOrchestrationReport {
  const resolveSystem = options.contextDeps.resolveSystem ?? getSystem;
  const context = options.systemContext ?? createCorridorSystemContext({
    ...options.contextDeps,
    resolveSystem,
  });
  const strictDependencies = options.strictDependencies ?? false;
  const registeredIds: string[] = [];
  const skippedIds: string[] = [];
  const failedIds: string[] = [];
  const missingDependencies: Record<string, string[]> = {};

  const activeEntries = [...options.manifest]
    .filter((entry) => {
      if (entry.enabled === false) {
        skippedIds.push(entry.id);
        return false;
      }
      if (!entry.system) {
        skippedIds.push(entry.id);
        return false;
      }
      return true;
    })
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));

  for (const entry of activeEntries) {
    registerSystem(entry.id, entry.system, entry.metadata ?? {});
    registeredIds.push(entry.id);
  }

  for (const entry of activeEntries) {
    if (isBindableSystem(entry.system)) {
      if (boundSystems.has(entry.system)) {
        console.debug(`[CorridorOrchestrator] Skipping duplicate context injection for "${entry.id}".`);
      } else {
        try {
          bindSystemContext(entry.system, entry.id, context, entry.capabilities);
          boundSystems.add(entry.system);
        } catch (error) {
          console.error(`[CorridorOrchestrator] Failed to inject SystemContext into "${entry.id}".`, error);
          markSystemError(entry.id, error);
          failedIds.push(entry.id);
          continue;
        }
      }
    } else {
      console.warn(`[CorridorOrchestrator] System "${entry.id}" is not bindable; skipping context injection.`);
    }
  }

  for (const entry of activeEntries) {
    const missing = [...(entry.dependencies ?? [])].filter((dependency) => !resolveSystem(dependency));
    if (missing.length > 0) {
      missingDependencies[entry.id] = missing;
      console.warn(`[CorridorOrchestrator] "${entry.id}" is missing dependencies: ${missing.join(', ')}`);
      if (strictDependencies) {
        markSystemError(entry.id, new Error(`Missing dependencies: ${missing.join(', ')}`));
        failedIds.push(entry.id);
      }
    }
  }

  for (const entry of activeEntries) {
    if (strictDependencies && missingDependencies[entry.id]) {
      continue;
    }

    try {
      if (isBindableSystem(entry.system) && initializedSystems.has(entry.system)) {
        console.debug(`[CorridorOrchestrator] Skipping duplicate init for "${entry.id}".`);
        continue;
      }
      entry.beforeInit?.(entry, context);
      const candidate = entry.system as EngineSystem;
      candidate.init?.(context);
      if (isBindableSystem(entry.system)) {
        initializedSystems.add(entry.system);
      }
      entry.afterInit?.(entry, context);
    } catch (error) {
      markSystemError(entry.id, error);
      failedIds.push(entry.id);
    }
  }

  const runtimeValidationResult = options.runtimeValidation?.run();
  if (options.runtimeValidation?.label) {
    console.info(`[CorridorOrchestrator] ${options.runtimeValidation.label}`);
  }

  if (options.audit) {
    runEngineAuditPlaceholder(options.audit);
  }

  const registrySnapshots = Object.fromEntries(
    registeredIds.map((id) => [id, getSystemStateSnapshot(id)]),
  );

  console.groupCollapsed('[CorridorOrchestrator] Bootstrap summary');
  console.table({
    registered: registeredIds.length,
    skipped: skippedIds.length,
    failed: failedIds.length,
    missingDependencySets: Object.keys(missingDependencies).length,
    registrySize: listSystems().length,
  });
  if (Object.keys(missingDependencies).length > 0) {
    console.warn('[CorridorOrchestrator] Missing dependencies', missingDependencies);
  }
  console.groupEnd();

  return {
    context,
    registeredIds,
    skippedIds,
    failedIds,
    missingDependencies,
    registrySnapshots,
    runtimeValidationResult,
    registrySize: listSystems().length,
  };
}

export function runDefaultRuntimeValidation(deps: SystemValidatorDeps): SystemValidationReport {
  return validateEngineRuntime(deps);
}

export function runEngineAuditPlaceholder(options: AuditPlaceholderOptions = {}): void {
  if (options.enableRuntimeHook) {
    runRuntimeCapabilityAuditHook();
    return;
  }

  const command = options.command ?? 'npm --prefix client run audit:engine';
  const reportPath = options.reportPath ?? 'engine/reports/ENGINE_CAPABILITY_LATEST.json';
  console.info(
    `[CorridorOrchestrator] Audit placeholder: run "${command}" and inspect "${reportPath}" for the latest capability snapshot.`,
  );
}

function isBindableSystem(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}