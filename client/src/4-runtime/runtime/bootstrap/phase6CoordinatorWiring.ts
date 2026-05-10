import * as Engine from '../../../0-foundation/foundation/Engine';
import type { GameLaunchCoordinator } from '../../../2-systems/gameplay/game/GameLaunchCoordinator';
import type { HealthSystem } from '../../../2-systems/gameplay/systems/HealthSystem';
import type { HUDSystem } from '../../../2-systems/gameplay/systems/HUDSystem';
import type { InventorySystem } from '../../../2-systems/gameplay/systems/InventorySystem';
import type { PrefabSystem } from '../../../2-systems/gameplay/systems/PrefabSystem';
import type { WeaponSystem } from '../../../2-systems/gameplay/systems/WeaponSystem';
import type { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import type { SystemRegistry } from '../../../1-kernel/kernel/SystemRegistry';
import type { GASBridge } from '../../../2-systems/gameplay/systems/gas/GASBridge';
import type { EditorAuthorityCoordinator } from '../EditorAuthorityCoordinator';
import type { RuntimeAuxiliaryAssembly } from '../RuntimeAuxiliaryAssembly';
import type { MultiplayerRuntimeCoordinator } from '../coordinators/MultiplayerRuntimeCoordinator';
import type { SessionLifecycleCoordinator } from '../../../2-systems/gameplay/game/SessionLifecycleCoordinator';
import type { WorldObjectAuthorityService } from '../../../2-systems/gameplay/game/WorldObjectAuthorityService';
import type { KernelMovementIntegration } from './KernelMovementIntegration';
import { wireRuntimeAssemblies } from './wireRuntimeAssemblies';
import {
  type BootstrapPhaseContext,
  type PhaseResult,
  Phase3_GameplayRuntime,
  Phase4_NetworkingRuntime,
  Phase5_UIRuntime,
} from './phases';

interface Phase6CoordinatorWiringOptions {
  gameLaunchCoordinator: GameLaunchCoordinator;
  multiplayerRuntime: MultiplayerRuntimeCoordinator;
  prefabSystem: PrefabSystem;
  inventorySystem: InventorySystem;
  phaseResults: Map<string, PhaseResult>;
  phaseCtx: BootstrapPhaseContext;
  systemRegistry: SystemRegistry | null;
  healthSystem: HealthSystem;
  weaponSystem: WeaponSystem;
  mpClient: MultiplayerClient;
  gameHUD: HUDSystem;
  gasBridge: GASBridge;
  sessionLifecycleCoordinator: SessionLifecycleCoordinator;
  editorAuthorityCoordinator: EditorAuthorityCoordinator;
  auxiliaryAssembly: RuntimeAuxiliaryAssembly;
  worldObjectAuthorityService: WorldObjectAuthorityService;
  kernelMovementIntegration: KernelMovementIntegration;
}

export function completePhase6CoordinatorWiring(options: Phase6CoordinatorWiringOptions): void {
  // Expose to window for bootloader access (freeplay auto-start)
  (window as any).__gameLaunchCoordinator = options.gameLaunchCoordinator;

  // Expose multiplayerRuntime for auto-transitioning to lobby on multiplayer mode start
  (window as any).__multiplayerRuntime = options.multiplayerRuntime;

  // Expose prefab/inventory systems for debug menu helpers
  (window as any).__PrefabSystem = options.prefabSystem;
  (window as any).__InventorySystem = options.inventorySystem;

  // Expose bootstrap state for reload/idempotency tools
  (window as any).__bootstrapState = {
    phaseResults: options.phaseResults,
    phaseCtx: options.phaseCtx,
    systemRegistry: options.systemRegistry,
    systems: {
      healthSystem: options.healthSystem,
      weaponSystem: options.weaponSystem,
      prefabSystem: options.prefabSystem,
      mpClient: options.mpClient,
    },
    refs: {
      gameHUD: options.gameHUD,
      inventorySystem: options.inventorySystem,
      gasBridge: options.gasBridge,
    },
  };

  // Expose hot reload for idempotency validation.
  (window as any).__reloadPhase = async function(phaseId: string) {
    try {
      const state = (window as any).__bootstrapState;
      if (!state) {
        console.error('[Hot Reload] Bootstrap state not available');
        return;
      }

      console.log(`[Hot Reload] Reloading ${phaseId}...`);
      const oldResult = state.phaseResults.get(phaseId);
      if (!oldResult) {
        console.error(`[Hot Reload] Phase ${phaseId} not found in registry`);
        return;
      }

      oldResult.dispose?.();
      console.log(`[Hot Reload] ${phaseId} disposed`);

      let newResult: PhaseResult | undefined;
      if (phaseId === 'phase5') {
        newResult = Phase5_UIRuntime(state.phaseCtx, state.systems.healthSystem, state.systems.weaponSystem, state.systems.prefabSystem);
      } else if (phaseId === 'phase3') {
        newResult = Phase3_GameplayRuntime(state.phaseCtx, state.systems.mpClient);
      } else if (phaseId === 'phase4') {
        newResult = Phase4_NetworkingRuntime(state.phaseCtx);
      } else {
        console.error(`[Hot Reload] Unknown phase: ${phaseId}`);
        return;
      }

      if (state.systemRegistry && newResult.systems) {
        state.systemRegistry.removePhase(phaseId);
        Object.entries(newResult.systems).forEach(([id, system]) => {
          Engine.registerRuntimeSystem(id, system as never, phaseId);
        });
      }

      if (phaseId === 'phase3' && newResult.systems) {
        state.systems.healthSystem = newResult.systems.health;
        state.systems.weaponSystem = newResult.systems.weapon;
        state.systems.prefabSystem = newResult.systems.prefab;
      }

      if (phaseId === 'phase4' && newResult.systems) {
        state.systems.mpClient = newResult.systems.multiplayerClient;
      }

      if (phaseId === 'phase5' && newResult.systems) {
        state.refs.gameHUD = newResult.systems.hud;
        state.refs.inventorySystem = newResult.systems.inventory;
      }

      state.phaseResults.set(phaseId, newResult);
      console.log(`[Hot Reload] ${phaseId} reloaded successfully`);
    } catch (error) {
      console.error('[Hot Reload] ERROR:', error);
    }
  };

  console.log('[Titan Engine] __reloadPhase exposed to window');

  wireRuntimeAssemblies({
    multiplayerRuntime: options.multiplayerRuntime,
    sessionLifecycleCoordinator: options.sessionLifecycleCoordinator,
    gameLaunchCoordinator: options.gameLaunchCoordinator,
    editorAuthorityCoordinator: options.editorAuthorityCoordinator,
    auxiliaryAssembly: options.auxiliaryAssembly,
    worldObjectAuthorityService: options.worldObjectAuthorityService,
    mpClient: options.mpClient,
    kernelMovementIntegration: options.kernelMovementIntegration,
  });
}

/**
 * Phase 6: Coordinator Wiring Bootstrap Function
 * 
 * Wrapper for completing Phase 6 coordinator wiring with PhaseResult interface.
 * Called during bootstrap to finalize all runtime assemblies.
 */
export function bootstrapPhase6_CoordinatorWiring(
  _ctx: BootstrapPhaseContext,
  systems: Record<string, any>,
  wire: () => void,
): PhaseResult {
  wire();
  console.log(`[Phase 6] ✓ Coordinator wiring complete (${Object.keys(systems).length} assemblies)`);

  return {
    systems,
    dispose: () => {
      Object.values(systems).forEach((sys) => {
        (sys as any).dispose?.();
      });
    },
  };
}
