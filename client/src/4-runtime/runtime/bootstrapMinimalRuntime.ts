/**
 * MINIMAL RUNTIME BOOTSTRAP
 * 
 * Phase 3: Core-First Pattern
 * Initializes ONLY the rendering kernel and critical systems.
 * All game systems (HUD, gameplay, multiplayer client) are deferred to lazy-loaded bootstrap functions.
 */

import * as Engine from '../../0-foundation/foundation/Engine';

/**
 * Initialize the minimal runtime kernel:
 * - Three.js rendering (scene, camera, renderer)
 * - Entity manager (kernel buffers)
 * - Network sync system (reconciliation)
 * - State manager (global state)
 * 
 * Returns when kernel is ready. Game systems are NOT initialized here.
 */
export async function bootstrapMinimalRuntime(canvas: HTMLCanvasElement): Promise<void> {
  try {
    // Initialize Engine kernel (physics + rendering)
    console.log('[MinimalRuntime] Initializing kernel...');
    
    Engine.init(canvas, {
      fogDensity: 0.02,
      fogColor: 0x334444,
      ambientLightIntensity: 0.4,
      directionalLightIntensity: 0.8,
    });

    // Validate critical systems are initialized
    const stateManager = Engine.getStateManagerInstance();
    if (!stateManager) {
      throw new Error('StateManager initialization failed');
    }

    const engineController = Engine.getEngineController();
    if (!engineController) {
      throw new Error('EngineController initialization failed');
    }

    const networkSyncSystem = Engine.getNetworkSyncSystem();
    if (!networkSyncSystem) {
      throw new Error('NetworkSyncSystem initialization failed');
    }

    const systemContext = Engine.getSystemContext();
    if (!systemContext) {
      throw new Error('System context initialization failed');
    }

    console.log('[MinimalRuntime] ✓ Kernel ready. Game systems can now be lazy-loaded.');

  } catch (error) {
    console.error('[MinimalRuntime] ✗ Kernel initialization failed:', error);
    throw error;
  }
}
