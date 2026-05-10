/**
 * Phase 4: Networking Runtime
 * 
 * Creates multiplayer systems:
 * - MultiplayerClient for network communication
 * - CollisionAuthoritySystem for conflict resolution
 * 
 * Returns PhaseResult with all systems + dispose
 */

import type { BootstrapPhaseContext } from './phase1-core';
import type { PhaseResult } from './phase3-gameplay';
import { MultiplayerClient } from '../../../3-network/network/MultiplayerClient';
import { CollisionAuthoritySystem } from '../../../3-network/network/CollisionAuthoritySystem';

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
