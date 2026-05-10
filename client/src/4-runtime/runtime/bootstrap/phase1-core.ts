/**
 * Phase 1: Core Runtime
 * 
 * Retrieves already-initialized systems from Engine (created during kernel bootstrap).
 * Validates that critical systems are ready before proceeding to later phases.
 * 
 * This phase DOES NOT create new systems - it just validates and retrieves.
 */

import * as Engine from '../../../0-foundation/foundation/Engine';
import type { SystemContext } from '../../../1-kernel/core/public-api';
import type { StateManager } from '../../../0-foundation/foundation/state/StateManager';
import { EventListenerRegistry } from '../../../1-kernel/core/EventListenerRegistry';

export interface BootstrapPhaseContext {
  stateManager: StateManager;
  systemContext: SystemContext;
  engineController: any;
  listenerRegistry: EventListenerRegistry;
}

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
