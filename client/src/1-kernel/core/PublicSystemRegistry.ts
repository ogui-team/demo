/**
 * PUBLIC SYSTEM REGISTRY - SDK Layer
 * 
 * Provides plugin-safe access to game systems without exposing internals.
 * All systems registered through this interface must be IDisposable.
 * 
 * Usage:
 *   const registry = new PublicSystemRegistry(internalRegistry);
 *   registry.registerSystem('my-system', new MySystem());
 *   const system = registry.getSystem('my-system');
 *   registry.unregisterSystem('my-system');
 */

import type { ISystemRegistry, IDisposable } from '@shared/contracts';

/**
 * Internal SystemRegistry Interface (for wrapper to know what to access)
 */
export interface InternalSystemRegistry {
  registerSystem(id: string, system: any): void;
  unregisterSystem(id: string): void;
  getSystem(id: string): any | undefined;
  getAllSystems(): Record<string, any>;
  hasSystem(id: string): boolean;
  listSystems?(): string[];
  replaceSystem?(id: string, newSystem: any): void;
}

/**
 * Plugin-Safe System Registry
 * 
 * Wraps the internal registry to:
 * 1. Validate that systems implement IDisposable
 * 2. Prevent access to critical internal systems
 * 3. Track plugin-registered systems for cleanup
 * 4. Ensure deterministic behavior
 */
export class PublicSystemRegistry implements ISystemRegistry, IDisposable {
  private pluginSystems: Set<string> = new Set();
  private disposed = false;
  
  // Whitelist of systems plugins CAN access
  private accessWhitelist = new Set([
    'physics',
    'health',
    'weapon',
    'ability',
    'inventory',
    'prefab',
    'spawn',
    'hud',
    'audio',
    'vfx',
    'pathfinding',
    'enemy-ai',
    'interaction',
    // ... add more as needed
  ]);
  
  // Blacklist of critical systems plugins CANNOT register
  private registrationBlacklist = new Set([
    'stateManager',
    'systemContext',
    'networkSync',
    'multiplayerClient',
    'renderingPipeline',
    'lifecycleCoordinator',
  ]);

  constructor(private internal: InternalSystemRegistry) {}

  /**
   * Register a plugin system safely
   * 
   * Requirements:
   * - System must implement IDisposable (have dispose() method)
   * - System ID cannot be in the blacklist
   * - System must not already exist
   */
  registerSystem(id: string, system: any): void {
    if (this.disposed) {
      throw new Error('PublicSystemRegistry has been disposed');
    }

    // Validate system has dispose() method
    if (!this.isDisposable(system)) {
      throw new Error(
        `System "${id}" must implement IDisposable (have dispose() method). ` +
        `Plugin systems require proper cleanup to prevent memory leaks.`
      );
    }

    // Prevent registration of critical systems
    if (this.registrationBlacklist.has(id)) {
      throw new Error(
        `Cannot register system "${id}": System is protected and reserved for engine use only. ` +
        `Choose a different ID with plugin prefix (e.g., "plugin_my_system")`
      );
    }

    // Prevent duplicate registration
    if (this.internal.hasSystem(id)) {
      throw new Error(
        `System "${id}" is already registered. ` +
        `Unregister first or use a different ID.`
      );
    }

    // Warn if not using plugin prefix (optional)
    if (!id.includes('plugin_') && !id.includes('-')) {
      console.warn(
        `System "${id}" registered by plugin. ` +
        `Consider using prefix: "plugin_${id}" or namespace convention.`
      );
    }

    // Register in internal registry
    this.internal.registerSystem(id, system);
    this.pluginSystems.add(id);

    console.log(`[SDK] Plugin system registered: ${id}`);
  }

  /**
   * Unregister a plugin system
   * 
   * Automatically calls dispose() on the system before removing it.
   */
  unregisterSystem(id: string): void {
    if (this.disposed) {
      throw new Error('PublicSystemRegistry has been disposed');
    }

    const system = this.internal.getSystem(id);
    if (!system) {
      console.warn(`System "${id}" not found for unregistration`);
      return;
    }

    // Call dispose if present
    if (this.isDisposable(system)) {
      try {
        system.dispose();
      } catch (err) {
        console.error(`Error disposing system "${id}":`, err);
      }
    }

    // Remove from internal registry
    this.internal.unregisterSystem(id);
    this.pluginSystems.delete(id);

    console.log(`[SDK] Plugin system unregistered: ${id}`);
  }

  /**
   * Get a system by ID
   * 
   * Returns undefined if system doesn't exist (safe access pattern).
   */
  getSystem(id: string): any | undefined {
    if (this.disposed) {
      console.warn('Accessing system from disposed PublicSystemRegistry');
      return undefined;
    }

    return this.internal.getSystem(id);
  }

  /**
   * Get all registered systems
   * 
   * Returns a shallow copy to prevent external modification.
   */
  getAllSystems(): Record<string, any> {
    if (this.disposed) {
      return {};
    }

    // Return shallow copy to prevent external modification
    return { ...this.internal.getAllSystems() };
  }

  /**
   * Check if a system exists
   */
  hasSystem(id: string): boolean {
    if (this.disposed) {
      return false;
    }

    return this.internal.hasSystem(id);
  }

  /**
   * List all registered system IDs
   */
  listSystems(): string[] {
    if (this.disposed) {
      return [];
    }

    if (this.internal.listSystems) {
      return this.internal.listSystems();
    }

    // Fallback: get keys from getAllSystems
    return Object.keys(this.internal.getAllSystems());
  }

  /**
   * Get list of systems registered by plugins
   */
  getPluginSystems(): string[] {
    return Array.from(this.pluginSystems);
  }

  /**
   * Check if system is disposable
   */
  private isDisposable(obj: any): boolean {
    return obj && typeof obj.dispose === 'function';
  }

  /**
   * Dispose all plugin systems
   * 
   * Called during engine shutdown to clean up all plugin-registered systems.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    const systemsToClean = Array.from(this.pluginSystems);
    
    console.log(`[SDK] Disposing ${systemsToClean.length} plugin systems...`);

    for (const id of systemsToClean) {
      try {
        this.unregisterSystem(id);
      } catch (err) {
        console.error(`Error during plugin system cleanup (${id}):`, err);
      }
    }

    this.pluginSystems.clear();
    this.disposed = true;
    
    console.log('[SDK] Plugin system registry disposed');
  }

  /**
   * Check if registry is disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}

/**
 * Helper function to validate if an object is plugin-safe
 */
export function isPluginSafeSystem(obj: any): boolean {
  return (
    obj &&
    typeof obj.dispose === 'function' &&
    (typeof obj.init === 'function' || typeof obj.update === 'function')
  );
}

/**
 * Helper function to create a minimal plugin system
 */
export function createMinimalSystem(id: string): IDisposable & { id: string } {
  return {
    id,
    dispose(): void {
      // Default: no-op
    },
  };
}
