import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamePlugin, IEventBus, PluginInitContext } from '@shared/contracts';
import { PluginRegistry } from '../../client/src/4-runtime/runtime/PluginRegistry';
import { PublicSystemRegistry } from '../../client/src/1-kernel/core/PublicSystemRegistry';
import { PublicEventBus } from '../../client/src/1-kernel/core/PublicEventBus';
import { GameEngineSDKImpl } from '../../client/src/4-runtime/runtime/GameEngineSdk';

class MockInternalSystemRegistry {
  private readonly systems = new Map<string, unknown>();

  registerSystem(id: string, system: unknown): void {
    this.systems.set(id, system);
  }

  unregisterSystem(id: string): void {
    this.systems.delete(id);
  }

  getSystem(id: string): unknown {
    return this.systems.get(id);
  }

  getAllSystems(): Record<string, unknown> {
    return Object.fromEntries(this.systems.entries());
  }

  hasSystem(id: string): boolean {
    return this.systems.has(id);
  }

  listSystems(): string[] {
    return Array.from(this.systems.keys());
  }
}

class MockInternalEventBus implements IEventBus {
  private readonly handlers = new Map<string, Set<(data: any) => void>>();

  emit(event: string, data?: any): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }

  on(event: string, handler: (data: any) => void): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  once(event: string, handler: (data: any) => void): () => void {
    const wrapped = (data: any) => {
      try {
        handler(data);
      } finally {
        this.off(event, wrapped);
      }
    };
    return this.on(event, wrapped);
  }

  off(event: string, handler?: (data: any) => void): void {
    if (!handler) {
      this.handlers.delete(event);
      return;
    }
    this.handlers.get(event)?.delete(handler);
  }
}

class MockStateManager {
  private readonly values = new Map<string, unknown>();

  set(path: string, value: unknown): void {
    this.values.set(path, value);
  }

  get(path: string): unknown {
    return this.values.get(path);
  }
}

class LifecyclePlugin implements GamePlugin {
  readonly id: string;
  readonly name: string;
  readonly version = '1.0.0';

  constructor(id: string, private readonly marks: string[]) {
    this.id = id;
    this.name = id;
  }

  init(): void {
    this.marks.push(`${this.id}:init`);
  }

  onLoad(): void {
    this.marks.push(`${this.id}:onLoad`);
  }

  onUnload(): void {
    this.marks.push(`${this.id}:onUnload`);
  }

  dispose(): void {
    this.marks.push(`${this.id}:dispose`);
  }
}

function createContext(): {
  pluginRegistry: PluginRegistry;
  context: PluginInitContext;
  publicEventBus: PublicEventBus;
  publicSystemRegistry: PublicSystemRegistry;
  sdk: GameEngineSDKImpl;
} {
  const pluginRegistry = new PluginRegistry();
  const publicSystemRegistry = new PublicSystemRegistry(new MockInternalSystemRegistry());
  const publicEventBus = new PublicEventBus(new MockInternalEventBus());
  const sdk = new GameEngineSDKImpl(pluginRegistry, publicSystemRegistry, publicEventBus);
  const stateManager = new MockStateManager();

  const context: PluginInitContext = {
    sdk,
    gameLoop: { currentTick: 0 },
    stateManager,
    systemContext: publicSystemRegistry,
    systemRegistry: publicSystemRegistry,
    gameBus: publicEventBus,
    eventBus: publicEventBus,
    logger: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    features: {
      isEnabled: () => false,
      enable: () => undefined,
      disable: () => undefined,
    },
    config: sdk.config,
  };

  return { pluginRegistry, context, publicEventBus, publicSystemRegistry, sdk };
}

describe('PluginSystem SDK integration', () => {
  let pluginRegistry: PluginRegistry;
  let context: PluginInitContext;
  let publicEventBus: PublicEventBus;
  let publicSystemRegistry: PublicSystemRegistry;
  let sdk: GameEngineSDKImpl;

  beforeEach(() => {
    ({ pluginRegistry, context, publicEventBus, publicSystemRegistry, sdk } = createContext());
  });

  afterEach(async () => {
    await pluginRegistry.unloadAll();
    sdk.dispose();
    pluginRegistry.dispose();
    publicSystemRegistry.dispose();
    publicEventBus.dispose();
  });

  it('registers and initializes plugins', async () => {
    const marks: string[] = [];
    const pluginA = new LifecyclePlugin('plugin-a', marks);
    const pluginB = new LifecyclePlugin('plugin-b', marks);

    pluginRegistry.register(pluginA);
    pluginRegistry.register(pluginB);
    await pluginRegistry.initializeAll(context);

    expect(pluginRegistry.isInitialized()).toBe(true);
    expect(pluginRegistry.getLoadedPlugins()).toEqual(['plugin-a', 'plugin-b']);
    expect(marks).toContain('plugin-a:init');
    expect(marks).toContain('plugin-b:onLoad');
  });

  it('contains plugin init failures and tracks diagnostics', async () => {
    const failingPlugin: GamePlugin = {
      id: 'broken-plugin',
      name: 'broken-plugin',
      version: '1.0.0',
      init: () => {
        throw new Error('boom');
      },
      dispose: () => undefined,
    };

    pluginRegistry.register(failingPlugin);
    await pluginRegistry.initializeAll(context);

    expect(pluginRegistry.isLoaded('broken-plugin')).toBe(false);
    expect(pluginRegistry.getError('broken-plugin')?.message).toBe('boom');
    expect(pluginRegistry.getDiagnostics().failed).toBe(1);
  });

  it('enforces public event bus rules for internal namespaces', () => {
    expect(() => publicEventBus.on('_internal:secret', () => undefined)).toThrow();
    expect(() => publicEventBus.emit('kernel:reset')).toThrow();
  });

  it('supports plugin-scoped event roundtrip through context buses', async () => {
    let payload: unknown;

    const plugin: GamePlugin = {
      id: 'event-plugin',
      name: 'event-plugin',
      version: '1.0.0',
      init: (ctx) => {
        ctx.eventBus.on('plugin:event-test', (data) => {
          payload = data;
        });
        ctx.gameBus.emit('plugin:event-test', { ok: true });
      },
      dispose: () => undefined,
    };

    pluginRegistry.register(plugin);
    await pluginRegistry.initializeAll(context);

    expect(payload).toEqual({ ok: true });
  });

  it('requires plugin systems to implement dispose()', () => {
    expect(() => publicSystemRegistry.registerSystem('plugin_invalid', {})).toThrow();

    const validSystem = { dispose: () => undefined };
    publicSystemRegistry.registerSystem('plugin_valid', validSystem);

    expect(publicSystemRegistry.hasSystem('plugin_valid')).toBe(true);
    publicSystemRegistry.unregisterSystem('plugin_valid');
    expect(publicSystemRegistry.hasSystem('plugin_valid')).toBe(false);
  });

  it('allows plugins to register and unregister SDK services', async () => {
    const plugin: GamePlugin = {
      id: 'service-plugin',
      name: 'service-plugin',
      version: '1.0.0',
      init: (ctx) => {
        ctx.sdk.registerService('plugin.counter', {
          id: 'plugin.counter',
          value: 7,
          dispose() {
            this.value = 0;
          },
        } as any);
      },
      dispose: () => {
        sdk.unregisterService('plugin.counter');
      },
    };

    pluginRegistry.register(plugin);
    await pluginRegistry.initializeAll(context);

    expect(sdk.services.hasService('plugin.counter')).toBe(true);
    expect((sdk.getService<any>('plugin.counter') as any).value).toBe(7);

    await pluginRegistry.unloadPlugin('service-plugin');
    expect(sdk.services.hasService('plugin.counter')).toBe(false);
  });
});
