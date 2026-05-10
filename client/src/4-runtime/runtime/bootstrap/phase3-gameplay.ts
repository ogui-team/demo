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

import * as Engine from '../../../0-foundation/foundation/Engine';
import type { BootstrapPhaseContext } from './phase1-core';
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

export interface PhaseResult {
  systems: Record<string, any>
  dispose(): void
}

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
      Object.values(createdSystems).forEach((sys) => {
        const candidate = sys as {
          dispose?: () => void;
          destroy?: () => void;
          clearAll?: () => void;
          clearRuntimeState?: () => void;
          clear?: () => void;
        };
        candidate.dispose?.();
        if (!candidate.dispose && candidate.destroy) {
          candidate.destroy();
        }
        if (!candidate.dispose && !candidate.destroy && candidate.clearAll) {
          candidate.clearAll();
        }
        if (!candidate.dispose && !candidate.destroy && !candidate.clearAll && candidate.clearRuntimeState) {
          candidate.clearRuntimeState();
        }
        if (!candidate.dispose && !candidate.destroy && !candidate.clearAll && !candidate.clearRuntimeState && candidate.clear) {
          candidate.clear();
        }
      });
    }
  };
}
