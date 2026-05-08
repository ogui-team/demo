/**
 * MULTIPLAYER RUNTIME
 * 
 * Lazy-loaded via bootloader when user selects multiplayer mode.
 * Initializes the full client runtime with network-dependent systems.
 */

import { bootstrapRuntime } from './bootstrapClientRuntime';

/**
 * Initialize multiplayer mode - set up all gameplay systems and show lobby/host menu.
 * Called after bootloader detects mode selection and lazy-loads this chunk.
 */
export async function initializeMode(): Promise<void> {
  console.log('[MultiplayerRuntime] 🌐 Initializing multiplayer mode...');
  
  try {
    // Initialize the full client runtime (same as freeplay)
    // This sets up all systems: physics, rendering, network, UI, etc.
    bootstrapRuntime();
    
    console.log('[MultiplayerRuntime] ✓ Full runtime initialized for multiplayer');
    
    // Give systems a moment to initialize before transitioning to lobby
    await new Promise(r => setTimeout(r, 150));
    
    // Access the multiplayer runtime that was initialized in bootstrapRuntime()
    // to transition to the lobby/server browser screen
    const multiplayerRuntime = (window as any).__multiplayerRuntime;
    if (multiplayerRuntime && multiplayerRuntime.transitionEngineState) {
      console.log('[MultiplayerRuntime] Transitioning to lobby screen...');
      multiplayerRuntime.transitionEngineState('lobby', 'auto_start_multiplayer');
      
      // Prepare the lobby if available
      if (multiplayerRuntime.prepareMultiplayerLobby) {
        multiplayerRuntime.prepareMultiplayerLobby('auto_start_multiplayer');
      }
    } else {
      console.warn('[MultiplayerRuntime] ⚠️ multiplayerRuntime not available, menu will show automatically');
    }
    
    console.log('[MultiplayerRuntime] ✅ Multiplayer mode ready! Server browser should be visible.');

  } catch (error) {
    console.error('[MultiplayerRuntime] ❌ Initialization failed:', error);
    throw error;
  }
}
