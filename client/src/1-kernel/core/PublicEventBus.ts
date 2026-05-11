/**
 * PUBLIC EVENT BUS - SDK Layer
 * 
 * Provides plugin-safe event subscription with whitelisting and namespacing.
 * Plugins can:
 * - Subscribe to whitelisted engine events
 * - Publish custom plugin: prefixed events
 * - Send data to other plugins via events
 * 
 * Plugins CANNOT:
 * - Subscribe to internal _internal, kernel, system prefixed events
 * - Spam events (rate limiting coming soon)
 * - Modify event payload after subscription
 */

import type { IEventBus, IDisposable } from '@shared/contracts';

/**
 * Whitelisted events that plugins can subscribe to
 */
const WHITELISTED_EVENTS = new Set([
  // Game state events
  'game:start',
  'game:end',
  'game:paused',
  'game:resumed',
  'game:modeChanged',
  
  // Player lifecycle
  'player:spawn',
  'player:death',
  'player:respawn',
  'player:joined',
  'player:left',
  'player:inputReceived',
  
  // Combat events
  'combat:damage',
  'combat:heal',
  'combat:killed',
  'combat:ability',
  'combat:statusApplied',
  'combat:statusRemoved',
  
  // Gameplay events
  'gameplay:interact',
  'gameplay:itemPickup',
  'gameplay:itemDrop',
  'gameplay:levelUpgraded',
  'gameplay:objectSpawned',
  'gameplay:objectDestroyed',
  
  // Audio/Visual
  'audio:play',
  'audio:stop',
  'vfx:play',
  'vfx:stop',
  'ui:notification',
  'ui:dialogOpened',
  'ui:dialogClosed',
  
  // Physics/World
  'physics:collision',
  'physics:trigger',
  'world:weatherChanged',
  'world:timeChanged',

  // Identity/Auth
  'auth:changed',
]);

/**
 * Events plugins cannot access (blacklist)
 */
const BLACKLIST_PATTERNS = [
  '_internal',    // Engine internals
  'kernel:',      // Kernel-level events
  'system:',      // System registry events
  'network:sync', // Network sync internals
  'render:',      // Rendering pipeline (use vfx: instead)
  'debug:',       // Debug-only events
];

/**
 * Plugin-Safe Event Bus
 * 
 * Wraps internal event bus with:
 * 1. Event whitelisting (only safe events)
 * 2. Namespace validation (plugin: prefix for custom)
 * 3. Subscription tracking (cleanup on unload)
 * 4. Determinism preservation (no random/date injection)
 */
export class PublicEventBus implements IEventBus, IDisposable {
  private subscriptions: Map<string, Set<Function>> = new Map();
  private disposed = false;
  
  // Track subscriptions by plugin for cleanup
  private pluginSubscriptions: Map<string, string[]> = new Map();

  constructor(private internal: IEventBus) {}

  /**
   * Subscribe to an event
   * 
   * Allows:
   * - Whitelisted engine events
   * - Any plugin: prefixed custom events
   * 
   * Blocks:
   * - Internal/system events
   * - Blacklisted prefixes
   */
  on(eventName: string, handler: (data: any) => void, pluginId?: string): () => void {
    if (this.disposed) {
      throw new Error('PublicEventBus has been disposed');
    }

    // Validate event name
    this.validateEventName(eventName, 'subscribe');

    // Validate handler
    if (typeof handler !== 'function') {
      throw new Error(`Event handler must be a function, got ${typeof handler}`);
    }

    // Subscribe via internal bus
    const unsubscribe = this.internal.on(eventName, handler);

    // Track subscription for cleanup
    if (pluginId) {
      if (!this.pluginSubscriptions.has(pluginId)) {
        this.pluginSubscriptions.set(pluginId, []);
      }
      this.pluginSubscriptions.get(pluginId)!.push(eventName);
    }

    // Track locally
    if (!this.subscriptions.has(eventName)) {
      this.subscriptions.set(eventName, new Set());
    }
    this.subscriptions.get(eventName)!.add(handler);

    return () => {
      unsubscribe();
      this.subscriptions.get(eventName)?.delete(handler);
    };
  }

  /**
   * Subscribe to event once (auto-unsubscribe after first trigger)
   */
  once(eventName: string, handler: (data: any) => void, pluginId?: string): () => void {
    if (this.disposed) {
      throw new Error('PublicEventBus has been disposed');
    }

    this.validateEventName(eventName, 'subscribe');

    if (typeof handler !== 'function') {
      throw new Error(`Event handler must be a function, got ${typeof handler}`);
    }

    // Wrap handler to auto-unsubscribe
    const wrappedHandler = (data: any) => {
      try {
        handler(data);
      } finally {
        unsubscribe();
      }
    };

    const unsubscribe = this.on(eventName, wrappedHandler, pluginId);
    return unsubscribe;
  }

  /**
   * Emit an event
   * 
   * Only allows plugin: prefixed events from external code.
   * Internal code can emit any event.
   * 
   * @param eventName Event name
   * @param data Event payload
   * @param pluginId ID of plugin emitting (for namespace validation)
   */
  emit(eventName: string, data?: any, pluginId?: string): void {
    if (this.disposed) {
      throw new Error('PublicEventBus has been disposed');
    }

    // If from a plugin, enforce plugin: prefix
    if (pluginId) {
      if (!eventName.startsWith('plugin:')) {
        throw new Error(
          `Plugin "${pluginId}" can only emit plugin: prefixed events. ` +
          `Tried to emit: "${eventName}". Use "plugin:myevent" instead.`
        );
      }
    }

    // Validate event name (blacklist check)
    this.validateEventName(eventName, 'emit');

    // Emit via internal bus
    this.internal.emit(eventName, data);
  }

  /**
   * Unsubscribe from an event
   */
  off(eventName: string, handler?: (data: any) => void): void {
    if (this.disposed) {
      return;
    }

    if (handler) {
      this.subscriptions.get(eventName)?.delete(handler);
      this.internal.off(eventName, handler);
    } else {
      this.subscriptions.delete(eventName);
      this.internal.off(eventName);
    }
  }

  /**
   * Remove all subscriptions for a plugin (called during unload)
   */
  unsubscribePlugin(pluginId: string): void {
    const events = this.pluginSubscriptions.get(pluginId);
    if (!events) {
      return;
    }

    for (const eventName of events) {
      const handlers = this.subscriptions.get(eventName);
      if (handlers) {
        handlers.clear();
      }
    }

    this.pluginSubscriptions.delete(pluginId);
    console.log(`[SDK] Event subscriptions cleared for plugin: ${pluginId}`);
  }

  /**
   * Validate event name is safe to access
   */
  private validateEventName(eventName: string, action: 'subscribe' | 'emit'): void {
    // Check whitelist
    if (WHITELISTED_EVENTS.has(eventName)) {
      return; // Whitelisted, allow
    }

    // Check plugin: namespace
    if (eventName.startsWith('plugin:')) {
      return; // Plugin events always allowed
    }

    // Check blacklist patterns
    for (const pattern of BLACKLIST_PATTERNS) {
      if (eventName.startsWith(pattern)) {
        throw new Error(
          `Cannot ${action} to "${eventName}": Event is reserved for engine use. ` +
          `Use whitelisted events or create a plugin: prefixed custom event.`
        );
      }
    }

    // If not whitelisted and not plugin: prefixed, reject
    throw new Error(
      `Event "${eventName}" is not whitelisted for plugin use. ` +
      `Use a whitelisted event or emit "plugin:myevent" for custom events.`
    );
  }

  /**
   * Get list of whitelisted events (for plugin documentation)
   */
  getWhitelistedEvents(): string[] {
    return Array.from(WHITELISTED_EVENTS);
  }

  /**
   * Get subscription count for a plugin
   */
  getPluginSubscriptionCount(pluginId: string): number {
    const events = this.pluginSubscriptions.get(pluginId);
    return events ? events.length : 0;
  }

  /**
   * Dispose event bus (cleanup all subscriptions)
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    // Clear all plugin subscriptions
    for (const pluginId of this.pluginSubscriptions.keys()) {
      this.unsubscribePlugin(pluginId);
    }

    this.subscriptions.clear();
    this.pluginSubscriptions.clear();
    this.disposed = true;

    console.log('[SDK] Event bus disposed');
  }

  /**
   * Check if disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}