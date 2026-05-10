/**
 * GOLDEN PATH TEST: EmptyPlugin
 * 
 * This plugin demonstrates the minimal public API surface for SDK plugins.
 * 
 * CRITICAL: This file uses ONLY public exports from @shared/contracts.
 * If you need to import anything from client/src or server/src to make this compile,
 * the public API is not yet complete.
 * 
 * Instructions:
 * 1. Copy this file as a template for creating new plugins
 * 2. Replace the class name and metadata
 * 3. Implement your plugin logic using ONLY the public API
 * 4. If you can't implement your feature with public API, file an issue
 */

import type { GamePlugin, PluginInitContext } from '@shared/contracts';

/**
 * EmptyPlugin: Minimal plugin using only public API
 */
export class EmptyPlugin implements GamePlugin {
  // === METADATA ===
  
  readonly id = 'empty-plugin';
  readonly name = 'Empty Plugin';
  readonly version = '1.0.0';
  readonly description = 'Minimal plugin demonstrating public API usage';
  
  // === STATE ===
  
  private initialized = false;
  private unsubscribers: Array<() => void> = [];
  
  // === LIFECYCLE ===
  
  /**
   * Called when plugin is registered
   */
  async init(context: PluginInitContext): Promise<void> {
    // Use logger from context
    context.logger.log('[EmptyPlugin] Initializing...');
    
    // Subscribe to game events using public event bus
    const gameStartUnsub = context.gameBus.on('game:start', () => {
      context.logger.log('[EmptyPlugin] Game started');
    });
    this.unsubscribers.push(gameStartUnsub);
    
    const gameEndUnsub = context.gameBus.on('game:end', () => {
      context.logger.log('[EmptyPlugin] Game ended');
    });
    this.unsubscribers.push(gameEndUnsub);
    
    // Check feature flags
    if (context.features.isEnabled('plugin_mode')) {
      context.logger.log('[EmptyPlugin] Plugin mode is enabled');
    }
    
    // Access configuration
    const someConfig = context.config.get('some-key');
    if (someConfig) {
      context.logger.log('[EmptyPlugin] Config loaded:', someConfig);
    }
    
    this.initialized = true;
  }
  
  /**
   * Called when plugin is loaded into running game
   */
  async onLoad(): Promise<void> {
    // Plugin-specific load logic
  }
  
  /**
   * Called when plugin is being unloaded
   */
  async onUnload(): Promise<void> {
    // Plugin-specific unload logic
  }
  
  /**
   * REQUIRED: Clean up all resources
   * 
   * This is called when the plugin is disposed.
   * Must unsubscribe from all events and free all memory.
   */
  dispose(): void {
    // Unsubscribe from all events
    this.unsubscribers.forEach(unsub => {
      try {
        unsub();
      } catch (err) {
        // Ignore cleanup errors
      }
    });
    this.unsubscribers = [];
    
    this.initialized = false;
  }
  
  // === CAPABILITIES (optional) ===
  
  capabilities = {
    hooks: ['init', 'load', 'unload'],
    systems: [],
    events: ['game:start', 'game:end'],
  };
  
  // === HELPERS (optional) ===
  
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * ADVANCED EXAMPLE: Plugin with system registration
 * 
 * Once ISystemRegistry is available in PluginInitContext,
 * plugins can register their own systems:
 * 
 *   class AdvancedPlugin implements GamePlugin {
 *     id = 'advanced-plugin';
 *     
 *     async init(context: PluginInitContext): Promise<void> {
 *       // Register a custom system
 *       const mySystem = new MyCustomSystem();
 *       context.systems.registerSystem('my-system', mySystem);
 *     }
 *     
 *     dispose(): void {
 *       // Unregister system
 *       context.systems.unregisterSystem('my-system');
 *     }
 *   }
 * 
 * This pattern allows plugins to extend the engine without
 * touching internal architecture.
 */

/**
 * DETERMINISM CHECKLIST for Plugin Developers
 * 
 * ✓ Do NOT use Math.random() → Use deterministic seeded RNG
 * ✓ Do NOT use Date.now() → Use context.gameLoop.currentTick
 * ✓ Do NOT use setTimeout() → Use context.gameLoop.schedule()
 * ✓ Do NOT use global state → Use plugin instance state
 * ✓ Do clear all subscriptions in dispose()
 * ✓ Do implement IDisposable interface
 */

/**
 * EVENT NAMING CONVENTION
 * 
 * Plugin events should follow naming pattern: plugin:{pluginId}:{event}
 * Examples:
 *   plugin:combat-system:hit
 *   plugin:ui-overlay:menu-open
 *   plugin:networking:connection-lost
 * 
 * This prevents collisions with engine events.
 */
