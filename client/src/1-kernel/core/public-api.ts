/**
 * ============================================================================
 * core/public-api.ts
 * ============================================================================
 * 
 * Public API barrel for the Core domain.
 * 
 * All exports from the core domain MUST go through this file.
 * Other domains MUST use:
 *   import { EntityManager, Entity, ... } from '@engine/core/public-api'
 * 
 * NOT:
 *   import { EntityManager } from '@engine/core/EntityManager'
 *   import { Entity } from '@engine/core/Entity'
 * 
 * ============================================================================
 */

// ─── Core Types ──────────────────────────────────────────────────────────────
export type {
  EntityID,
  System,
  Component,
  GameEvents,
  EditorTool,
  EditorComponentPathSegment,
  EditorEntityTransformSnapshot,
  EditorComponentSnapshot,
  EditorEntitySelectionPayload,
} from './types';

// ─── Entity System ───────────────────────────────────────────────────────────
export { Entity } from './Entity';
export type { Vector3, Transform, Component as EntityComponent, EntityData } from './Entity';

export { EntityManager } from './EntityManager';
export type {
  EntityManagerConfig,
  EntityQueryOptions,
  ActiveEntityDebugRecord,
  PlayerInitPhase,
} from './EntityManager';

// ─── Transform System ────────────────────────────────────────────────────────
export { TransformSystem } from './Transform';
export {
  initializeEntityTransform,
  syncEntityTransformFromState,
  getPosition,
  setPosition,
  getRotation,
  setRotation,
  getScale,
  setScale,
  translate,
  rotateAxis,
  scale,
  setPositionVec,
  getTransform,
  setTransform,
  removeEntityTransform,
  subscribeToTransform,
} from './Transform';

// ─── Event System ────────────────────────────────────────────────────────────
export { gameBus } from './EventBus';
export type { EventBus } from './EventBus';

export { logEvent, getRecentEvents } from './EventLogger';

// ─── Teardown Registry ───────────────────────────────────────────────────────
export { TeardownRegistry } from './TeardownRegistry';
export type { DisposableLike, TeardownLike, TeardownTarget } from './TeardownRegistry';

// ─── System Registry ────────────────────────────────────────────────────────
export {
  registerSystem,
  registerSystemMetadata,
  getSystem,
  listSystems,
  markSystemUpdated,
  markSystemError,
  disableSystem,
  getActiveSystemNames,
  getSystemStateSnapshot,
  getSystemCapabilitiesSnapshot,
  getSystemDebugProperties,
  getSystemDebugValue,
  setSystemDebugValue,
} from './SystemRegistry';

export type {
  SystemStatus,
  DebugControlType,
  SystemDebugProperty,
  SystemDebugMetadata,
  RegisteredSystem,
} from './SystemRegistry';

// ─── System Health Corridor (System Contracts) ───────────────────────────────
export {
  ensureEngineSystemContract,
  bindSystemContext,
  getBoundSystemContext,
  deriveSystemCapabilities,
  createSystemAccessProxy,
  deriveSystemDebugState,
  createNetworkFacade,
  createReplicationFacade,
} from './SystemHealthCorridor';

export type {
  EngineEvent,
  SystemCapabilities,
  SystemContextSystems,
  GameplayCommand,
  NetworkFacade,
  ReplicationFacade,
  SystemContext,
  EngineSystem,
} from './SystemHealthCorridor';

// ─── Input System ───────────────────────────────────────────────────────────
export { setContext, getContext, onContextChange } from './InputContext';
export type { InputContext } from './InputContext';

export { InputManager } from './InputManager';

export { InputRouter } from './InputRouter';
export type { RoutedInputHandler } from './InputRouter';

export { InputContextManager } from './InputContextManager';

// ─── Engine Controller ───────────────────────────────────────────────────────
export { EngineController } from './EngineController';
export type { AppState, ControllerSystems } from './EngineController';

// ─── Engine Diagnostics ─────────────────────────────────────────────────────
export { EngineDiagnostics } from './EngineDiagnostics';
export type { EngineStats } from './EngineDiagnostics';

// ─── Runtime Performance ────────────────────────────────────────────────────
export {
  RuntimePerformanceMode,
  getRuntimePerformanceMode,
  setRuntimePerformanceMode,
  isDevMode,
  isReleaseMode,
  initRuntimePerformanceMode,
} from './RuntimePerformanceMode';

// ─── Scene Graph ────────────────────────────────────────────────────────────
export { SceneGraph, registerEntityInSceneGraph, unregisterEntityFromSceneGraph } from './SceneGraph';
export type { SceneNode, HierarchyChangedEvent, HierarchyChangeCallback } from './SceneGraph';

// ─── Save/Load System ──────────────────────────────────────────────────────
export { SaveLoadManager } from './SaveLoadManager';
export type { SavedEntity, SavedWorldState } from './SaveLoadManager';

// ─── Replay System ─────────────────────────────────────────────────────────
export { ReplaySystem } from './ReplaySystem';

// ─── Undo/Redo System ─────────────────────────────────────────────────────
export { UndoRedoSystem } from './UndoRedoSystem';
export type { UndoRedoAction, UndoRedoSnapshot } from './UndoRedoSystem';

// ─── Entity Rendering ────────────────────────────────────────────────────────
export { EntityRenderer } from './EntityRenderer';
export type { RenderComponentData } from './EntityRenderer';

// ─── Scripting System ──────────────────────────────────────────────────────
export { ScriptingSystem, LifetimeScript, SpinScript } from './ScriptingSystem';
export type { SpawnDef, ScriptAPI, ScriptEventType, Script } from './ScriptingSystem';

// ─── Kernel System (Phase 2: DOD Architecture) ──────────────────────────────
export { KernelValidator, kernelValidator } from './kernel/KernelValidator';
export type { KernelValidationReport, KernelValidationError } from './kernel/KernelValidator';

export { CombatSystemDOD, queryEntityHealth } from './kernel/CombatSystemDOD';
export type { CombatConfig, CombatState } from './kernel/CombatSystemDOD';

export {
  KernelCommandType,
  KernelCommands,
  type KernelCommand,
  type ApplyDamageCommand,
  type ApplyHealingCommand,
  type KillEntityCommand,
  type FireWeaponCommand,
  type CreateProjectileCommand,
  type AnyKernelCommand,
} from './kernel/KernelCommandTypes';

// ─── Foundation Interfaces (Temporary - Phase 3: Move to 0-foundation/public-api) ──
// Re-exported here temporarily for SystemRegistry.ts and other files
export type {
  INetworkReplicator,
  IGameplayStateProvider,
  IWeaponRules,
  IPlayerStateManager,
  IKernelEntity,
  IPhysicsSystem,
  IMeshBinding,
  IEngineRuntime,
} from '../../0-foundation/public-api';

// ─── Raycast Layers ────────────────────────────────────────────────────────
export type { RaycastLayer } from './RaycastLayers';
export { matchesRaycastLayers, setRaycastLayersRecursive } from './RaycastLayers';

// ─── Object Pool ──────────────────────────────────────────────────────────
export { ObjectPool } from './ObjectPool';
export type { IPoolable } from './ObjectPool';

// ─── System Watchdog (Monitoring) ────────────────────────────────────────
export { SystemWatchdog } from './SystemWatchdog';

// ─── Feature Manager ─────────────────────────────────────────────────────
export { FeatureManager, FEATURE_META } from './FeatureManager';
export type { FeatureKey } from './FeatureManager';

// ─── Entity Attributes ──────────────────────────────────────────────────────
export type { EntityAttributes } from './EntityAttributes';
export {
  initializeEntityAttributes,
  getEntityAttributes,
  setEntityAttributes,
  getEntityAttribute,
  setEntityAttribute,
  hasHitbox,
  setHitbox,
  isScriptGate,
  setScriptGate,
  isInvisible,
  setInvisible,
  addTag,
  removeTag,
  hasTag,
  setMetadata,
  getMetadata,
  subscribeToAttributes,
} from './EntityAttributes';

// ─── Performance Budgets ────────────────────────────────────────────────────
// export { PerformanceBudgets } from './PerformanceBudgets'; // TODO: Check exports

// ─── Project Config ────────────────────────────────────────────────────────
export type { ProjectConfig } from './ProjectConfig';

// ─── Kernel (Physics Layer - under core) ──────────────────────────────────
export { SimulationKernel } from './kernel/SimulationKernel';

export { EntityMigrationSystem } from './kernel/EntityMigrationSystem';
export { ComponentMapper } from './kernel/ComponentMapper';
export { InventorySystem } from './kernel/InventorySystem';

// ─── Kernel Types and Storage Systems ───────────────────────────────
export type { EntityHandle, SimulationCommandSource, AuthoritativeSnapshot } from './kernel/types';
export { EntityRegistry } from './kernel/EntityRegistry';
export { PositionStorage } from './kernel/PositionStorage';
export { VelocityStorage } from './kernel/VelocityStorage';

// ─── Phase 2B Systems (DOD Kernel Layer) ────────────────────────────────────
export { KernelCommandQueue } from './kernel/KernelCommandQueue';
export { SnapshotReader } from './kernel/SnapshotReader';
export { SnapshotWriter, type KernelSnapshot } from './kernel/SnapshotWriter';
export { KernelStateHash, type KernelHashReference } from './kernel/KernelStateHash';
export { Float32BufferProxy, Int32BufferProxy, type DODBufferProxyConfig } from './kernel/DODBufferProxy';
export { KernelAuditSystem, type KernelAuditResult, createAuditSystemForKernel } from './kernel/KernelAuditSystem';
export { TransactionalKernelMode, type PhaseResolveResult, TransactionalCommandType } from './kernel/TransactionalKernelMode';
export { initTransactionalKernel } from './kernel/initTransactionalKernel';
export { MovementIntegrateSystem } from './kernel/MovementIntegrateSystem';
export { DODWeaponSystem } from './kernel/DODWeaponSystem';
export { HUDSyncSystem } from './kernel/HUDSyncSystem';

// ─── Runtime Infrastructure Exports ───────────────────────────────────────
export { HandleAllocator, EntityLifetimeRegistry, RuntimeHandleValidator } from './runtime';
export { FrameMemoryArena, RuntimeAllocator, ScratchBufferPool } from './runtime';
export { Vec2, Vec3, Vec4, Quaternion, Matrix4, AABB, Plane, Frustum, BoundingSphere, SIMDGeometryLibrary } from './runtime';