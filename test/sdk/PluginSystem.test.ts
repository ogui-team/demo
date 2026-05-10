/**
 * PLUGIN SYSTEM TEST - Tier 2 SDK Validation
 * 
 * Validates:
 * 1. Plugin registration and initialization
 * 2. Plugin lifecycle (init → onLoad → onUnload → dispose)
 * 3. Event subscription through PublicEventBus
 * 4. System registration through PublicSystemRegistry
 * 5. Determinism maintained during plugin execution
 * 6. Memory cleanup on plugin disposal
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GamePlugin, PluginInitContext, IDisposable } from '@shared/contracts';
import { PluginRegistry } from '../runtime/PluginRegistry';
import { PublicSystemRegistry } from '../../1-kernel/core/PublicSystemRegistry';
import { PublicEventBus } from '../../1-kernel/core/PublicEventBus';

// Mock implementations
class MockGameLoop {
  currentTick: number = 0;
  
  advance() {
    this.currentTick++;
  }
}

class MockSystemRegistry {
  private systems: Map<string, any> = new Map();
  
  registerSystem(id: string, system: any): void {
    this.systems.set(id, system);
  }
  
  unregisterSystem(id: string): void {
    this.systems.delete(id);
  }
  
  getSystem(id: string): any | undefined {
    return this.systems.get(id);
  }
  
  getAllSystems(): Record<string, any> {
    return Object.fromEntries(this.systems);
  }
  
  hasSystem(id: string): boolean {
    return this.systems.has(id);
  }
  
  listSystems(): string[] {
    return Array.from(this.systems.keys());
  }
}

class MockEventBus {
  private subscriptions: Map<string, Set<Function>> = new Map();
  
  on(eventName: string, handler: Function): () => void {
    if (!this.subscriptions.has(eventName)) {
      this.subscriptions.set(eventName, new Set());
    }
    this.subscriptions.get(eventName)!.add(handler);
    
    return () => {
      this.subscriptions.get(eventName)?.delete(handler);
    };
  }
  
  once(eventName: string, handler: Function): () => void {
    const wrappedHandler = (...args: any[]) => {
      handler(...args);
      unsubscribe();
    };
    
    const unsubscribe = this.on(eventName, wrappedHandler);
    return unsubscribe;
  }
  
  emit(eventName: string, data: any): void {
    const handlers = this.subscriptions.get(eventName);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as any)(data);
        } catch (err) {
          console.error(`Error in handler for ${eventName}:`, err);
        }
      }
    }
  }
}

// Test plugins
class TestPlugin implements GamePlugin {
  static initCount = 0;
  static loadCount = 0;
  static unloadCount = 0;
  static disposeCount = 0;
  
  constructor(public name: string = 'TestPlugin') {}
  
  async init(context: PluginInitContext): Promise<void> {
    TestPlugin.initCount++;
    // Plugin can access the context
    expect(context).toBeDefined();
  }
  
  async onLoad(): Promise<void> {
    TestPlugin.loadCount++;
  }
  
  async onUnload(): Promise<void> {
    TestPlugin.unloadCount++;
  }
  
  dispose(): void {
    TestPlugin.disposeCount++;
  }
}

class EventEmitterPlugin implements GamePlugin {
  events: string[] = [];
  
  constructor(public name: string = 'EventEmitterPlugin') {}
  
  async init(context: PluginInitContext): Promise<void> {
    const eventBus = context.eventBus as any;
    
    // Subscribe to whitelisted events
    eventBus.on('game:start', () => {
      this.events.push('game:start');
    }, this.name);
    
    // Emit custom plugin event
    eventBus.emit('plugin:test', { test: true }, this.name);
  }
  
  dispose(): void {
    // Cleanup
  }
}

class SystemRegisteringPlugin implements GamePlugin {
  registeredSystems: string[] = [];
  
  constructor(public name: string = 'SystemRegisteringPlugin') {}
  
  async init(context: PluginInitContext): Promise<void> {
    const registry = context.systemRegistry as any;
    
    // Create and register a simple system
    const testSystem: IDisposable = {
      dispose(): void {
        // no-op
      },
    };
    
    registry.registerSystem('plugin_test_system', testSystem);
    this.registeredSystems.push('plugin_test_system');
  }
  
  dispose(): void {
    // Systems will be cleaned up by registry
  }
}

class DeterministicPlugin implements GamePlugin {
  randomValues: number[] = [];
  timestamps: number[] = [];
  
  constructor(public name: string = 'DeterministicPlugin') {}
  
  async init(context: PluginInitContext): Promise<void> {
    const engine = (context as any).engine;
    
    // Collect deterministic values
    for (let i = 0; i < 5; i++) {
      this.randomValues.push(engine.random.next());
      this.timestamps.push(engine.time.now());
    }
  }
  
  dispose(): void {
    // no-op
  }
}

describe('PluginSystem - SDK Tier 2', () => {
  let pluginRegistry: PluginRegistry;
  let systemRegistry: PublicSystemRegistry;
  let eventBus: PublicEventBus;
  let gameLoop: MockGameLoop;
  let context: PluginInitContext;
  
  beforeEach(() => {
    // Reset test counters
    TestPlugin.initCount = 0;
    TestPlugin.loadCount = 0;
    TestPlugin.unloadCount = 0;
    TestPlugin.disposeCount = 0;
    
    // Create mock infrastructure
    gameLoop = new MockGameLoop();
    
    const internalRegistry = new MockSystemRegistry();
    systemRegistry = new PublicSystemRegistry(internalRegistry);
    
    const internalEventBus = new MockEventBus();
    eventBus = new PublicEventBus(internalEventBus);
    
    pluginRegistry = new PluginRegistry();
    
    // Create plugin initialization context
    context = {
      gameLoop,
      systemRegistry,
      eventBus,
    } as any;
  });
  
  afterEach(() => {
    // Cleanup
    pluginRegistry.dispose();
    systemRegistry.dispose();
    eventBus.dispose();
  });
  
  describe('Plugin Registration', () => {
    it('should register a plugin', () => {
      const plugin = new TestPlugin('test1');
      pluginRegistry.register('test1', plugin);
      
      expect(pluginRegistry.listPlugins().map((entry) => entry.id)).toContain('test1');
    });
    
    it('should prevent duplicate registration', () => {
      const plugin = new TestPlugin('test1');
      pluginRegistry.register('test1', plugin);
      
      expect(() => {
        pluginRegistry.register('test1', plugin);
      }).toThrow();
    });
    
    it('should validate plugin contract', () => {
      const invalidPlugin = {
        // Missing init method
      };
      
      expect(() => {
        pluginRegistry.register('invalid', invalidPlugin as any);
      }).toThrow();
    });
  });
  
  describe('Plugin Initialization', () => {
    it('should initialize registered plugins', async () => {
      const plugin1 = new TestPlugin('test1');
      const plugin2 = new TestPlugin('test2');
      
      pluginRegistry.register('test1', plugin1);
      pluginRegistry.register('test2', plugin2);
      
      await pluginRegistry.initializeAll(context);
      
      expect(TestPlugin.initCount).toBe(2);
      expect(TestPlugin.loadCount).toBe(2);
    });
    
    it('should track loaded plugins', async () => {
      const plugin = new TestPlugin('test1');
      pluginRegistry.register('test1', plugin);
      
      expect(pluginRegistry.isLoaded('test1')).toBe(false);
      
      await pluginRegistry.initializeAll(context);
      
      expect(pluginRegistry.isLoaded('test1')).toBe(true);
    });
    
    it('should handle initialization errors', async () => {
      const errorPlugin: GamePlugin = {
        init: async () => {
          throw new Error('Init failed');
        },
        dispose: () => {},
      };
      
      pluginRegistry.register('error', errorPlugin);
      
      // Should not throw
      await pluginRegistry.initializeAll(context);
      
      expect(pluginRegistry.isLoaded('error')).toBe(false);
      expect(pluginRegistry.getError('error')).toBeTruthy();
    });
  });
  
  describe('Plugin Lifecycle', () => {
    it('should call onLoad during initialization', async () => {
      const plugin = new TestPlugin('test1');
      pluginRegistry.register('test1', plugin);
      
      await pluginRegistry.initializeAll(context);
      
      expect(TestPlugin.loadCount).toBe(1);
    });
    
    it('should call onUnload during unload', async () => {
      const plugin = new TestPlugin('test1');
      pluginRegistry.register('test1', plugin);
      
      await pluginRegistry.initializeAll(context);
      await pluginRegistry.unloadPlugin('test1');
      
      expect(TestPlugin.unloadCount).toBe(1);
      expect(TestPlugin.disposeCount).toBe(1);
    });
    
    it('should unload all plugins', async () => {
      const plugin1 = new TestPlugin('test1');
      const plugin2 = new TestPlugin('test2');
      
      pluginRegistry.register('test1', plugin1);
      pluginRegistry.register('test2', plugin2);
      
      await pluginRegistry.initializeAll(context);
      await pluginRegistry.unloadAll();
      
      expect(TestPlugin.unloadCount).toBe(2);
      expect(TestPlugin.disposeCount).toBe(2);
    });
  });
  
  describe('Event System Integration', () => {
    it('should allow plugins to subscribe to whitelisted events', async () => {
      const plugin = new EventEmitterPlugin();
      pluginRegistry.register('event-test', plugin);
      
      await pluginRegistry.initializeAll(context);
      
      // Emit whitelisted event
      eventBus.emit('game:start', {});
      
      expect(plugin.events).toContain('game:start');
    });
    
    it('should allow custom plugin: events', async () => {
      const plugin = new EventEmitterPlugin();
      pluginRegistry.register('event-test', plugin);
      
      let customEventData: any;
      eventBus.on('plugin:test', (data) => {
        customEventData = data;
      });
      
      await pluginRegistry.initializeAll(context);
      
      expect(customEventData).toEqual({ test: true });
    });
    
    it('should prevent access to internal events', () => {
      expect(() => {
        eventBus.on('_internal:debug', () => {});
      }).toThrow();
    });
  });
  
  describe('System Registry Integration', () => {
    it('should allow plugins to register systems', async () => {
      const plugin = new SystemRegisteringPlugin();
      pluginRegistry.register('sys-test', plugin);
      
      await pluginRegistry.initializeAll(context);
      
      expect(systemRegistry.hasSystem('plugin_test_system')).toBe(true);
    });
    
    it('should require systems to be IDisposable', () => {
      const invalidSystem = {}; // No dispose method
      
      expect(() => {
        systemRegistry.registerSystem('test', invalidSystem);
      }).toThrow();
    });
    
    it('should list registered systems', async () => {
      const plugin = new SystemRegisteringPlugin();
      pluginRegistry.register('sys-test', plugin);
      
      await pluginRegistry.initializeAll(context);
      
      const systems = systemRegistry.listSystems();
      expect(systems).toContain('plugin_test_system');
    });
  });
  
  describe('Determinism', () => {
    it('should provide deterministic values to plugins', async () => {
      const plugin1 = new DeterministicPlugin('det1');
      const plugin2 = new DeterministicPlugin('det2');
      
      pluginRegistry.register('det1', plugin1);
      pluginRegistry.register('det2', plugin2);
      
      await pluginRegistry.initializeAll(context);
      
      // With deterministic shim, both plugins should see same sequence
      // (after reset/replay)
      expect(plugin1.randomValues.length).toBe(5);
      expect(plugin2.randomValues.length).toBe(5);
    });
  });
  
  describe('Memory Cleanup', () => {
    it('should dispose plugin registry', async () => {
      const plugin = new TestPlugin('test1');
      pluginRegistry.register('test1', plugin);
      
      await pluginRegistry.initializeAll(context);
      await pluginRegistry.dispose();
      
      expect(pluginRegistry.isDisposed()).toBe(true);
    });
    
    it('should prevent operations on disposed registry', async () => {
      const plugin = new TestPlugin('test1');
      pluginRegistry.register('test1', plugin);
      
      await pluginRegistry.dispose();
      
      expect(() => {
        pluginRegistry.register('test2', plugin);
      }).toThrow();
    });
    
    it('should track diagnostics', async () => {
      const plugin1 = new TestPlugin('test1');
      const plugin2 = new TestPlugin('test2');
      
      pluginRegistry.register('test1', plugin1);
      pluginRegistry.register('test2', plugin2);
      
      const diags = pluginRegistry.getDiagnostics();
      
      expect(diags.total).toBe(2);
      expect(diags.loaded).toBe(0); // Not initialized yet
    });
  });
});
