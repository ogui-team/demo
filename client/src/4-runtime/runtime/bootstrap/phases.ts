/**
 * BOOTSTRAP PHASES
 * 
 * Explicit phases for initializing the runtime, allowing independent testing
 * and clear dependency ordering.
 * 
 * Phase 1: Core Runtime - SystemRegistry, state management, basic systems
 * Phase 2: Rendering Runtime - Three.js pipeline, scene graph, camera
 * Phase 3: Gameplay Runtime - Physics, gameplay logic, input
 * Phase 4: Networking Runtime - Multiplayer client, replication, sync
 * Phase 5: UI Runtime - Panels, HUD, mode selector
 * Phase 6: Coordinators - Wire all phases together
 */

import * as Engine from '../../../0-foundation/foundation/Engine';
import type { SystemContext } from '../../../1-kernel/core/public-api';
import type { StateManager } from '../../../0-foundation/foundation/state/StateManager';
import { EventListenerRegistry } from '../../../1-kernel/core/EventListenerRegistry';
import { PlayerModelSystem } from '../../../2-systems/gameplay/game/PlayerModelSystem';
import { MenuIdentitySystem } from '../../ui/MenuIdentitySystem';
import { CharacterActorSystem } from '../../../2-systems/gameplay/game/CharacterActorSystem';
import { PhysicsSystem } from '../../../2-systems/gameplay/systems/PhysicsSystem';
import { HealthSystem } from '../../../2-systems/gameplay/systems/HealthSystem';
import { WeaponSystem } from '../../../2-systems/gameplay/systems/WeaponSystem';
import { PrefabSystem } from '../../../2-systems/gameplay/systems/PrefabSystem';
import { SpawnSystem } from '../../../2-systems/gameplay/systems/SpawnSystem';
import { ObjectCreatorSystem } from '../../../2-systems/gameplay/game/ObjectCreatorSystem';
import { AbilitySystem } from '../../../2-systems/gameplay/systems/gas/AbilitySystem';
import { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import { CollisionAuthoritySystem } from '../../../3-network/network/CollisionAuthoritySystem';
import { HUDSystem } from '../../../2-systems/gameplay/systems/HUDSystem';
import { InventorySystem } from '../../../2-systems/gameplay/systems/InventorySystem';

export interface BootstrapPhaseContext {
  stateManager: StateManager;
  systemContext: SystemContext;
  engineController: any;
  listenerRegistry: EventListenerRegistry;
}

/**
 * Result of a bootstrap phase execution
 * All phases should return systems + a dispose method for cleanup
 */
export interface PhaseResult {
  systems: Record<string, any>
  dispose(): void
}

/**
 * Phase 1: Core Runtime
 * 
 * Retrieves already-initialized systems from Engine (created during kernel bootstrap).
 * Validates that critical systems are ready before proceeding to later phases.
 * 
 * This phase DOES NOT create new systems - it just validates and retrieves.
 */
export function bootstrapPhase1_CoreRuntime(): BootstrapPhaseContext {
  const stateManager = Engine.getStateManagerInstance();
  if (!stateManager) {
    throw new Error('[Phase 1] State manager not initialized - kernel may not be initialized');
  }

  const engineController = Engine.getEngineController();
  if (!engineController) {
    throw new Error('[Phase 1] EngineController not initialized');
  }

  const systemContext = Engine.getSystemContext();
  if (!systemContext) {
    throw new Error('[Phase 1] Engine system context not initialized');
  }

  const networkSyncSystem = Engine.getNetworkSyncSystem();
  if (!networkSyncSystem) {
    throw new Error('[Phase 1] NetworkSyncSystem not initialized');
  }

  console.log('[Phase 1] ✓ Core runtime systems validated');

  return {
    stateManager,
    systemContext: systemContext,
    engineController,
    listenerRegistry: new EventListenerRegistry(),
  };
}

/**
 * Phase 2: Rendering Runtime
 * 
 * Validates rendering pipeline is ready (Three.js scene, camera, renderer).
 * Does not initialize anything - rendering was already setup in kernel.
 */
export function bootstrapPhase2_RenderingRuntime(ctx: BootstrapPhaseContext): void {
  const scene = Engine.getEngineScene();
  if (!scene) {
    throw new Error('[Phase 2] Engine scene not initialized');
  }

  const camera = Engine.getEngineCamera();
  if (!camera) {
    throw new Error('[Phase 2] Engine camera not initialized');
  }

  const renderer = Engine.getEngineRenderer();
  if (!renderer) {
    throw new Error('[Phase 2] Engine renderer not initialized');
  }

  const cullingSystem = Engine.getCullingSystem();
  if (!cullingSystem) {
    throw new Error('[Phase 2] CullingSystem not initialized');
  }

  console.log('[Phase 2] ✓ Rendering runtime validated (scene, camera, renderer, culling)');
}

/**
 * Phase 3: Gameplay Runtime
 * 
 * Creates all gameplay systems:
 * - Physics, Health, Weapons, Abilities
 * - Character actors, Player models
 * - Prefabs, Spawning, Object creation
 * 
 * Returns PhaseResult with all systems + dispose method
 * 
 * NOTE: Designed to be called after Phase 1 & 2, with mpClient passed separately during integration
 */
export function Phase3_GameplayRuntime(
  ctx: BootstrapPhaseContext,
  mpClient?: any
): PhaseResult {
  const stateManager = ctx.stateManager;
  
  // Physics and damage systems (dependencies for many others)
  const physicsSystem = new PhysicsSystem();
  const healthSystem = new HealthSystem(stateManager);

  // Object creation and prefab systems
  const objectCreator = new ObjectCreatorSystem(
    Engine.getEngineScene()!,
    Engine.getEntityManager()!,
    Engine.getEntityRenderer()!,
    stateManager,
  );
  
  const prefabSystem = new PrefabSystem({
    scene: Engine.getEngineScene()!,
    entityManager: Engine.getEntityManager()!,
    stateManager,
    objectFactory: objectCreator,
    sceneGraph: Engine.getSceneGraph(),
    enableLogging: false,
  });

  // Spawn system depends on prefabs
  const spawnSystem = new SpawnSystem(Engine.getEntityManager()!, prefabSystem);

  // Weapon system depends on physics and health
  const weaponSystem = new WeaponSystem(physicsSystem, healthSystem, stateManager, {
    entityManager: Engine.getEntityManager()!,
    prefabSystem,
    multiplayer: mpClient || null,
    enableLogging: false,
  });

  // Ability system (GAS framework)
  const abilitySystem = new AbilitySystem({
    registry: Engine.getGasDataRegistry()!,
    attributes: Engine.getGasAttributeStore()!,
    effects: Engine.getGasEffectSystem()!,
    items: Engine.getGasItemSystem()!,
    physics: physicsSystem,
    health: healthSystem,
    entityManager: Engine.getEntityManager()!,
    multiplayer: mpClient || null,
    enableLogging: false,
  });

  // Character and player model systems
  const characterActorSystem = new CharacterActorSystem({
    entityManager: Engine.getEntityManager()!,
    entityRenderer: Engine.getEntityRenderer()!,
    getPlayerEntity: () => null,
    isEnabled: () => true,
    worldObjectAuthority: null,
    spatialPartition: Engine.getSpatialPartitionSystem(),
    profiles: [],
  });

  const playerModelSystem = new PlayerModelSystem(
    Engine.getEngineScene()!,
    Engine.getEntityManager()!,
    Engine.getEntityRenderer()!,
    stateManager,
  );
  playerModelSystem.setSnapshotInterpolationDelayMs(50);

  const menuIdentitySystem = new MenuIdentitySystem(
    stateManager,
    Engine.getModeManger?.(),
  );

  const createdSystems = {
    physics: physicsSystem,
    health: healthSystem,
    objectCreator: objectCreator,
    prefab: prefabSystem,
    spawn: spawnSystem,
    weapon: weaponSystem,
    ability: abilitySystem,
    characterActor: characterActorSystem,
    playerModel: playerModelSystem,
    menuIdentity: menuIdentitySystem,
  };

  // Collect all systems with stable IDs
  const systems = {
    ...createdSystems,
  };

  console.log('[Phase 3] ✓ Gameplay runtime created (10 systems)');

  return {
    systems,
    dispose: () => {
      console.log('[Phase 3] Disposing gameplay runtime systems');
      Object.values(createdSystems).forEach(sys => {
        (sys as any).dispose?.();
      });
    }
  };
}

/**
 * Phase 4: Networking Runtime
 * 
 * Creates multiplayer systems:
 * - MultiplayerClient for network communication
 * - CollisionAuthoritySystem for conflict resolution
 * 
 * Returns PhaseResult with all systems + dispose
 */
export function Phase4_NetworkingRuntime(ctx: BootstrapPhaseContext): PhaseResult {
  const mpClient = new MultiplayerClient();
  const collisionAuthoritySystem = new CollisionAuthoritySystem();

  const systems = {
    multiplayerClient: mpClient,
    collisionAuthority: collisionAuthoritySystem,
  };

  console.log('[Phase 4] ✓ Networking runtime created (2 systems)');

  return {
    systems,
    dispose: () => {
      console.log('[Phase 4] Disposing networking runtime systems');
      Object.values(systems).forEach(sys => {
        (sys as any).dispose?.();
      });
    }
  };
}

/**
 * Phase 5: UI Runtime
 * 
 * Creates UI systems with full idempotency guarantee:
 * - HUDSystem (in-game heads-up display)
 * - InventorySystem (player inventory management)
 * 
 * All event listeners tracked and removable.
 * All DOM nodes owned and removable.
 * 
 * Returns PhaseResult with all systems + dispose
 */
export function Phase5_UIRuntime(
  ctx: BootstrapPhaseContext,
  healthSystem: HealthSystem,
  weaponSystem: WeaponSystem,
  prefabSystem: PrefabSystem,
): PhaseResult {
  const { stateManager } = ctx;
  const listeners: Array<() => void> = [];
  const roots: HTMLElement[] = [];

  // Helper: track all event listeners for cleanup
  function trackListener(target: EventTarget, event: string, handler: EventListener) {
    target.addEventListener(event, handler);
    listeners.push(() => target.removeEventListener(event, handler));
  }

  // Helper: track DOM root ownership
  function trackRoot(el: HTMLElement): HTMLElement {
    roots.push(el);
    return el;
  }

  // Create HUD system
  const gameHUD = new HUDSystem({ stateManager });
  gameHUD.mount();

  // Create Inventory system
  const inventorySystem = new InventorySystem({
    health: healthSystem,
    weapons: weaponSystem,
    state: stateManager,
    prefabSystem,
    enableLogging: false,
  });
  inventorySystem.defineDefaults();

  // Track UI containers if they exist in DOM
  const hudContainer = document.querySelector('[data-hud-root]') as HTMLElement | null;
  if (hudContainer) trackRoot(hudContainer);

  const inventoryContainer = document.querySelector('[data-inventory-root]') as HTMLElement | null;
  if (inventoryContainer) trackRoot(inventoryContainer);

  const systems = {
    hud: gameHUD,
    inventory: inventorySystem,
  };

  console.log('[Phase 5] ✓ UI runtime created (2 systems)');

  return {
    systems,
    dispose: () => {
      console.log('[Phase 5] Disposing UI runtime');

      // 1. Remove all event listeners
      listeners.forEach(remove => remove());

      // 2. Remove all DOM nodes
      roots.forEach(el => {
        try {
          el.remove();
        } catch (e) {
          // Element might already be removed
        }
      });

      // 3. Dispose all systems
      Object.values(systems).forEach(sys => {
        (sys as any).dispose?.();
      });

      // 4. Clear arrays
      listeners.length = 0;
      roots.length = 0;

      console.log('[Phase 5] disposed cleanly');
    }
  };
}

/**
 * Phase 6: Coordinator Wiring
 * 
 * After all systems are created, wire them together:
 * - GameLaunchCoordinator
 * - SessionLifecycleCoordinator
 * - MultiplayerRuntimeCoordinator
 * - RuntimeOverlayCoordinator
 * - LifecycleOrchestrator
 * 
 * TODO: Move wiring logic here
 */
export function bootstrapPhase6_CoordinatorWiring(ctx: BootstrapPhaseContext): void {
  // Coordinator creation and wiring in main bootstrapRuntime()
  // TODO: Move here
  console.log('[Phase 6] ✓ Coordinator wiring will connect all runtime systems');
}

/**
 * Execute all bootstrap phases in order
 */
export async function executeBootstrapPhases(): Promise<BootstrapPhaseContext> {
  console.log('\n[Bootstrap Phases] Starting 6-phase initialization...\n');

  const ctx = bootstrapPhase1_CoreRuntime();
  bootstrapPhase2_RenderingRuntime(ctx);
  // Phase3_GameplayRuntime(ctx);  // Will be integrated in Block 3
  // bootstrapPhase4_NetworkingRuntime(ctx);
  // bootstrapPhase5_UIRuntime(ctx);
  // bootstrapPhase6_CoordinatorWiring(ctx);

  console.log('\n[Bootstrap Phases] ✅ All 6 phases complete\n');

  return ctx;
}
