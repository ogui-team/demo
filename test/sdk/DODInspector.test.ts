import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IEventBus, PluginInitContext } from '@shared/contracts';
import { PluginRegistry } from '../../client/src/4-runtime/runtime/PluginRegistry';
import { PublicSystemRegistry } from '../../client/src/1-kernel/core/PublicSystemRegistry';
import { PublicEventBus } from '../../client/src/1-kernel/core/PublicEventBus';
import { GameEngineSDKImpl } from '../../client/src/4-runtime/runtime/GameEngineSdk';
import { DODInspectorPlugin } from '../../client/src/4-runtime/runtime/DODInspectorPlugin';

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

function createContext(): {
  context: PluginInitContext;
  publicSystemRegistry: PublicSystemRegistry;
  publicEventBus: PublicEventBus;
  pluginRegistry: PluginRegistry;
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

  return { context, publicSystemRegistry, publicEventBus, pluginRegistry, sdk };
}

describe('DODInspectorPlugin', () => {
  let context: PluginInitContext;
  let publicSystemRegistry: PublicSystemRegistry;
  let publicEventBus: PublicEventBus;
  let pluginRegistry: PluginRegistry;
  let sdk: GameEngineSDKImpl;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    ({ context, publicSystemRegistry, publicEventBus, pluginRegistry, sdk } = createContext());

    publicSystemRegistry.registerSystem('ui2DSystem', {
      dispose: vi.fn(),
    });
    publicSystemRegistry.registerSystem('hud', {
      showNotification: vi.fn(),
      dispose: vi.fn(),
    });
    publicSystemRegistry.registerSystem('physicsSystem', {
      getDebugState: () => ({ frame: 1 }),
      dispose: vi.fn(),
    });
  });

  afterEach(async () => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    await pluginRegistry.unloadAll();
    sdk.dispose();
    pluginRegistry.dispose();
    publicSystemRegistry.dispose();
    publicEventBus.dispose();
    document.body.innerHTML = '';
  });

  it('removes all inspector DOM elements from the document on dispose()', () => {
    const plugin = new DODInspectorPlugin();
    plugin.init(context);

    const rootBeforeDispose = document.getElementById('dod-inspector-overlay');
    expect(rootBeforeDispose).not.toBeNull();
    expect(document.body.textContent).toContain('DOD INSPECTOR [F4]');
    expect(document.body.textContent).toContain('BUFFER SNAPSHOT');

    plugin.dispose();

    expect(document.getElementById('dod-inspector-overlay')).toBeNull();
    expect(document.body.textContent).not.toContain('DOD INSPECTOR [F4]');
    expect(document.body.textContent).not.toContain('BUFFER SNAPSHOT');
    expect(document.querySelectorAll('#dod-inspector-overlay, #dod-inspector-overlay *').length).toBe(0);
  });

  it('cleans timers/listeners safely and supports repeated dispose()', () => {
    const plugin = new DODInspectorPlugin();
    plugin.init(context);

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    plugin.dispose();
    plugin.dispose();

    expect(vi.getTimerCount()).toBe(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4' }));
    vi.advanceTimersByTime(1200);

    expect(document.getElementById('dod-inspector-overlay')).toBeNull();
  });
});
