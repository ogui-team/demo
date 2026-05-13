/**
 * FREEPLAY RUNTIME
 * 
 * Lazy-loaded via bootloader when user selects freeplay (offline) mode.
 * Initializes offline gameplay systems on top of the kernel.
 */

import * as Engine from '../../0-foundation/foundation/Engine';

/**
 * Initialize freeplay mode - set up all offline gameplay systems.
 * Called after bootloader detects mode selection and lazy-loads this chunk.
 * 
 * Uses only validated Engine APIs (no fake functions).
 */
export async function initializeMode(): Promise<void> {
  console.log('[FreeplayRuntime] 🎮 Initializing freeplay mode...');
  
  try {
    // Import the full client runtime
    const clientRuntime = await import('./bootstrapClientRuntime');
    
    // Bootstrap the full runtime (sets up game systems, UI, etc.)
    clientRuntime.bootstrapRuntime();
    
    // Give systems a moment to initialize
    await new Promise(r => Engine.timer.setTimeout(r, 100));
    
    // Auto-start freeplay game
    try {
      const gameLaunchCoordinator = (window as any).__gameLaunchCoordinator;
      if (gameLaunchCoordinator && gameLaunchCoordinator.startLocalFreeplay) {
        console.log('[FreeplayRuntime] Starting local freeplay game...');
        await gameLaunchCoordinator.startLocalFreeplay();
      } else {
        console.warn('[FreeplayRuntime] gameLaunchCoordinator not available');
      }
    } catch (err) {
      console.warn('[FreeplayRuntime] Could not start freeplay:', err);
    }

    console.log('[FreeplayRuntime] ✅ Freeplay mode ready!');

  } catch (error) {
    console.error('[FreeplayRuntime] ❌ Initialization failed:', error);
    throw error;
  }
}
