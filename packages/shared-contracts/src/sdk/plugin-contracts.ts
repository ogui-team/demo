/**
 * SDK Plugin Interfaces
 * 
 * These interfaces define the contract for external game plugins.
 * All plugins MUST implement these interfaces to be valid.
 */

/**
 * Disposable Interface - Standard cleanup contract
 * 
 * Any resource that holds memory, listeners, or state MUST implement this.
 * Used for garbage collection and memory management.
 */
export interface IDisposable {
  dispose(): void;
}

/**
 * Initialize Payload - Context passed to plugin during initialization
 * 
 * Provides access to core systems and utilities without exposing internal details.
 */
export interface PluginInitContext {
  // Core engine references
  gameLoop: any; // GameLoop system
  stateManager: any; // State management
  systemContext: any; // System registry context
  
  // Event system
  gameBus: {
    emit(event: string, data?: any): void;
    on(event: string, handler: (data: any) => void): () => void;
    once(event: string, handler: (data: any) => void): () => void;
  };
  
  // Logging
  logger: {
    log(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
  };
  
  // Feature flags
  features: {
    isEnabled(feature: string): boolean;
    enable(feature: string): void;
    disable(feature: string): void;
  };
  
  // Configuration
  config: {
    get(key: string): any;
    set(key: string, value: any): void;
  };
}

/**
 * Game Plugin Base Interface
 * 
 * All plugins must implement this contract.
 * Plugins are loaded at runtime and can extend game functionality.
 */
export interface GamePlugin extends IDisposable {
  // Metadata
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  
  // Lifecycle
  init?(context: PluginInitContext): void | Promise<void>;
  onLoad?(): void | Promise<void>;
  onUnload?(): void | Promise<void>;
  
  // Required cleanup
  dispose(): void;
  
  // Optional capabilities
  capabilities?: {
    hooks?: string[];
    systems?: string[];
    events?: string[];
  };
}

/**
 * System Registry Interface
 * 
 * Provides plugin-safe access to game systems.
 */
export interface ISystemRegistry {
  // Register and unregister systems
  registerSystem(id: string, system: any): void;
  unregisterSystem(id: string): void;
  getSystem(id: string): any | undefined;
  
  // Query systems
  getAllSystems(): Record<string, any>;
  hasSystem(id: string): boolean;
  
  // List available systems
  listSystems(): string[];
}

/**
 * Event Bus Interface
 * 
 * Plugin-safe event subscription and emission.
 * Prevents direct access to internal events.
 */
export interface IEventBus {
  emit(event: string, data?: any): void;
  on(event: string, handler: (data: any) => void): () => void;
  once(event: string, handler: (data: any) => void): () => void;
  off(event: string, handler?: (data: any) => void): void;
}

/**
 * Plugin Registry
 * 
 * Manages plugin lifecycle and loading.
 */
export interface IPluginRegistry extends IDisposable {
  // Plugin management
  register(plugin: GamePlugin): void;
  unregister(pluginId: string): void;
  getPlugin(pluginId: string): GamePlugin | undefined;
  
  // Query plugins
  listPlugins(): GamePlugin[];
  getPluginsWithCapability(capability: string): GamePlugin[];
  
  // Lifecycle
  initializeAll(context: PluginInitContext): Promise<void>;
  unloadAll(): Promise<void>;
  
  // State
  isInitialized(): boolean;
  getLoadedPlugins(): string[];
}

/**
 * SDK Public API
 * 
 * This is what plugins should interact with.
 * Only these interfaces should be in the public API.
 */
export interface GameEngineSdk {
  // Plugins
  plugins: IPluginRegistry;
  
  // Systems
  systems: ISystemRegistry;
  
  // Events
  events: IEventBus;
  
  // Configuration
  config: {
    get(key: string): any;
    set(key: string, value: any): void;
  };
  
  // Version info
  version: string;
  
  // Features
  features: {
    isEnabled(feature: string): boolean;
  };
}
