/**
 * PLUGIN REGISTRY - Runtime Lifecycle Manager
 * 
 * Manages plugin loading, initialization, event binding, and cleanup.
 * Provides error boundaries and ensures no plugin can crash the engine.
 */

import type {
  GamePlugin,
  PluginInitContext,
  IDisposable,
  IPluginRegistry,
} from '@shared/contracts';

/**
 * Plugin metadata tracked during lifecycle
 */
interface PluginEntry {
  id: string;
  plugin: GamePlugin;
  context: PluginInitContext;
  loaded: boolean;
  error: Error | null;
}

/**
 * Plugin Registry
 * 
 * Manages:
 * 1. Plugin registration (before init)
 * 2. Plugin initialization (loading and onLoad)
 * 3. Plugin lifecycle events (onUnload)
 * 4. Error boundaries (prevent plugin crashes from cascading)
 * 5. Cleanup on engine shutdown (dispose)
 */
export class PluginRegistry implements IPluginRegistry, IDisposable {
  private plugins: Map<string, PluginEntry> = new Map();
  private disposed = false;
  private initOrder: string[] = [];
  private initialized = false;

  /**
   * Register a plugin for later initialization
   * 
   * This happens during bootstrap BEFORE the game starts.
   * The plugin is validated but not initialized until initializeAll() is called.
   */
  register(plugin: GamePlugin): void;
  register(pluginId: string, plugin: GamePlugin): void;
  register(pluginOrId: string | GamePlugin, maybePlugin?: GamePlugin): void {
    if (this.disposed) {
      throw new Error('PluginRegistry has been disposed');
    }

    const pluginId = typeof pluginOrId === 'string' ? pluginOrId : pluginOrId.id;
    const plugin = typeof pluginOrId === 'string' ? maybePlugin : pluginOrId;

    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" is null or undefined`);
    }

    // Validate plugin
    this.validatePlugin(plugin, pluginId);

    // Check for duplicates
    if (this.plugins.has(pluginId)) {
      throw new Error(`Plugin "${pluginId}" is already registered`);
    }

    // Store plugin entry
    this.plugins.set(pluginId, {
      id: pluginId,
      plugin,
      context: {} as PluginInitContext, // Will be filled during init
      loaded: false,
      error: null,
    });

    console.log(`[SDK] Plugin registered: ${pluginId}`);
  }

  /**
   * Initialize all registered plugins
   * 
   * Called once during engine bootstrap after all systems are ready.
   * Calls plugin.init(context) to set up deterministic handlers.
   */
  async initializeAll(context: PluginInitContext): Promise<void> {
    if (this.disposed) {
      throw new Error('PluginRegistry has been disposed');
    }

    if (this.plugins.size === 0) {
      console.log('[SDK] No plugins to initialize');
      return;
    }

    console.log(`[SDK] Initializing ${this.plugins.size} plugins...`);

    // Initialize in registration order
    for (const pluginId of this.plugins.keys()) {
      if (!this.initOrder.includes(pluginId)) {
        this.initOrder.push(pluginId);
      }
    }

    for (const pluginId of this.initOrder) {
      const entry = this.plugins.get(pluginId);
      if (!entry) continue;

      try {
        // Store context reference
        entry.context = context;

        // Call plugin.init()
        console.log(`[SDK] Initializing plugin: ${pluginId}`);
        if (entry.plugin.init && typeof entry.plugin.init === 'function') {
          await Promise.resolve(entry.plugin.init(context));
        }

        // Call onLoad() if present
        if (entry.plugin.onLoad && typeof entry.plugin.onLoad === 'function') {
          await Promise.resolve(entry.plugin.onLoad());
        }

        entry.loaded = true;
        console.log(`[SDK] Plugin initialized: ${pluginId}`);
      } catch (err) {
        entry.error = err instanceof Error ? err : new Error(String(err));
        console.error(`[SDK] Error initializing plugin "${pluginId}":`, err);

        // Don't rethrow - other plugins should still initialize
        // Plugin stays in "error" state but doesn't crash engine
      }
    }

    this.initialized = true;
  }

  /**
   * Check if a plugin is loaded and ready
   */
  isLoaded(pluginId: string): boolean {
    const entry = this.plugins.get(pluginId);
    return entry ? entry.loaded : false;
  }

  /**
   * Get plugin entry (metadata)
   */
  getPlugin(pluginId: string): GamePlugin | undefined {
    return this.plugins.get(pluginId)?.plugin;
  }

  /**
   * Unregister a plugin by ID.
   */
  unregister(pluginId: string): void {
    void this.unloadPlugin(pluginId);
  }

  /**
   * Get initialization error for a plugin (if any)
   */
  getError(pluginId: string): Error | null {
    return this.plugins.get(pluginId)?.error || null;
  }

  /**
   * List all registered plugin IDs
   */
  listPlugins(): GamePlugin[] {
    return Array.from(this.plugins.values()).map((entry) => entry.plugin);
  }

  /**
   * Get plugins that advertise a capability.
   */
  getPluginsWithCapability(capability: string): GamePlugin[] {
    return Array.from(this.plugins.values())
      .filter((entry) => {
        const capabilities = entry.plugin.capabilities;
        return Boolean(
          capabilities && (
            capabilities.hooks?.includes(capability) ||
            capabilities.systems?.includes(capability) ||
            capabilities.events?.includes(capability)
          )
        );
      })
      .map((entry) => entry.plugin);
  }

  /**
   * Check if the registry has completed an initializeAll pass.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get loaded plugin IDs.
   */
  getLoadedPlugins(): string[] {
    return Array.from(this.plugins.values())
      .filter((entry) => entry.loaded)
      .map((entry) => entry.id);
  }

  /**
   * Get plugin count
   */
  getPluginCount(): number {
    return this.plugins.size;
  }

  /**
   * Get loaded plugin count
   */
  getLoadedPluginCount(): number {
    return Array.from(this.plugins.values()).filter(e => e.loaded).length;
  }

  /**
   * Unload a single plugin
   * 
   * Calls onUnload() then dispose() if present.
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    if (this.disposed) {
      console.warn('Cannot unload plugin from disposed registry');
      return;
    }

    const entry = this.plugins.get(pluginId);
    if (!entry) {
      console.warn(`Plugin "${pluginId}" not found`);
      return;
    }

    if (!entry.loaded) {
      console.warn(`Plugin "${pluginId}" not loaded`);
      return;
    }

    try {
      console.log(`[SDK] Unloading plugin: ${pluginId}`);

      // Call onUnload() if present
      if (entry.plugin.onUnload && typeof entry.plugin.onUnload === 'function') {
        await Promise.resolve(entry.plugin.onUnload());
      }

      // Call dispose() if present
      if (entry.plugin.dispose && typeof entry.plugin.dispose === 'function') {
        entry.plugin.dispose();
      }

      entry.loaded = false;
      console.log(`[SDK] Plugin unloaded: ${pluginId}`);
    } catch (err) {
      console.error(`[SDK] Error unloading plugin "${pluginId}":`, err);
    }
  }

  /**
   * Unload all plugins (called during engine shutdown)
   */
  async unloadAll(): Promise<void> {
    if (this.plugins.size === 0) {
      return;
    }

    console.log(`[SDK] Unloading ${this.plugins.size} plugins...`);

    // Unload in reverse order
    const pluginIds = Array.from(this.plugins.keys()).reverse();

    for (const pluginId of pluginIds) {
      await this.unloadPlugin(pluginId);
    }

    this.initialized = false;
  }

  /**
   * Validate plugin meets contract requirements
   */
  private validatePlugin(plugin: GamePlugin, pluginId: string): void {
    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" is null or undefined`);
    }

    if (typeof plugin.id !== 'string' || plugin.id.length === 0) {
      throw new Error(`Plugin "${pluginId}" must have a non-empty id`);
    }

    if (typeof plugin.name !== 'string' || plugin.name.length === 0) {
      throw new Error(`Plugin "${pluginId}" must have a non-empty name`);
    }

    if (typeof plugin.version !== 'string' || plugin.version.length === 0) {
      throw new Error(`Plugin "${pluginId}" must have a non-empty version`);
    }

    if (typeof plugin.dispose !== 'function') {
      throw new Error(
        `Plugin "${pluginId}" must implement IDisposable (have dispose() method). ` +
        `Got: ${typeof plugin.dispose}`
      );
    }

    if (plugin.init && typeof plugin.init !== 'function') {
      throw new Error(
        `Plugin "${pluginId}" init is not a function. ` +
        `Got: ${typeof plugin.init}`
      );
    }

    // Warn if optional methods have wrong types
    if (plugin.onLoad && typeof plugin.onLoad !== 'function') {
      console.warn(
        `Plugin "${pluginId}" onLoad is not a function. ` +
        `Skipping optional lifecycle.`
      );
    }

    if (plugin.onUnload && typeof plugin.onUnload !== 'function') {
      console.warn(
        `Plugin "${pluginId}" onUnload is not a function. ` +
        `Skipping optional lifecycle.`
      );
    }
  }

  /**
   * Get diagnostic info about all plugins
   */
  getDiagnostics(): any {
    const diagnostics = {
      total: this.plugins.size,
      loaded: this.getLoadedPluginCount(),
      failed: Array.from(this.plugins.values()).filter(e => e.error).length,
      plugins: [] as any[],
    };

    for (const [id, entry] of this.plugins) {
      diagnostics.plugins.push({
        id,
        loaded: entry.loaded,
        error: entry.error ? entry.error.message : null,
      });
    }

    return diagnostics;
  }

  /**
   * Dispose registry and cleanup all plugins
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    console.log('[SDK] Disposing plugin registry...');

    this.plugins.clear();
    this.initOrder = [];
    this.initialized = false;
    this.disposed = true;

    console.log('[SDK] Plugin registry disposed');
  }

  /**
   * Check if disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}
