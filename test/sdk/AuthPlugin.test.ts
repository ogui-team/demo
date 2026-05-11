import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAuthManager, IEventBus, IProfileService, PluginInitContext } from '@shared/contracts';
import { PluginRegistry } from '../../client/src/4-runtime/runtime/PluginRegistry';
import { PublicSystemRegistry } from '../../client/src/1-kernel/core/PublicSystemRegistry';
import { PublicEventBus } from '../../client/src/1-kernel/core/PublicEventBus';
import { GameEngineSDKImpl } from '../../client/src/4-runtime/runtime/GameEngineSdk';
import { AuthPlugin } from '../../client/src/4-runtime/runtime/AuthPlugin';

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

function createContextWithRegistry(systemRegistry: PublicSystemRegistry): {
  context: PluginInitContext;
  publicEventBus: PublicEventBus;
  pluginRegistry: PluginRegistry;
  sdk: GameEngineSDKImpl;
} {
  const pluginRegistry = new PluginRegistry();
  const publicEventBus = new PublicEventBus(new MockInternalEventBus());
  const sdk = new GameEngineSDKImpl(pluginRegistry, systemRegistry, publicEventBus);
  const stateManager = new MockStateManager();

  const context: PluginInitContext = {
    sdk,
    gameLoop: { currentTick: 0 },
    stateManager,
    systemContext: systemRegistry,
    systemRegistry,
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

  return { context, publicEventBus, pluginRegistry, sdk };
}

describe('AuthPlugin scaffold', () => {
  let publicSystemRegistry: PublicSystemRegistry;
  let context: PluginInitContext;
  let publicEventBus: PublicEventBus;
  let pluginRegistry: PluginRegistry;
  let sdk: GameEngineSDKImpl;

  beforeEach(() => {
    const registry = new PublicSystemRegistry(new MockInternalSystemRegistry());
    const setup = createContextWithRegistry(registry);

    publicSystemRegistry = registry;
    context = setup.context;
    publicEventBus = setup.publicEventBus;
    pluginRegistry = setup.pluginRegistry;
    sdk = setup.sdk;
    window.localStorage.clear();
    (window as any).__authLockReady = null;
  });

  afterEach(async () => {
    await pluginRegistry.unloadAll();
    sdk.dispose();
    pluginRegistry.dispose();
    publicSystemRegistry.dispose();
    publicEventBus.dispose();
    window.localStorage.clear();
    (window as any).__authLockReady = null;
  });

  it('registers auth/profile services and boots to locked guest identity', async () => {
    const authPlugin = new AuthPlugin();
    authPlugin.init(context);

    const auth = sdk.getService<IAuthManager>('auth.manager');
    const profile = sdk.getService<IProfileService>('profile.service');

    expect(auth).toBeDefined();
    expect(profile).toBeDefined();

    const status = auth!.getStatus();
    expect(status.state).toBe('AUTHENTICATED');
    expect(status.provider).toBe('guest');
    expect(status.locked).toBe(true);

    const identity = auth!.getIdentity();
    expect(identity).toBeTruthy();
    expect(identity?.isGuest).toBe(true);
    expect(identity?.permissions).toContain('play');

    await expect(auth!.waitForLock(50)).resolves.toEqual(expect.objectContaining({
      status: expect.objectContaining({ state: 'AUTHENTICATED', locked: true }),
    }));

    const globalGate = (window as any).__authLockReady as Promise<unknown> | null;
    expect(globalGate).toBeTruthy();
    await expect(globalGate).resolves.toBeDefined();

    authPlugin.dispose();
  });

  it('emits auth:changed and preserves guest fallback on logout', async () => {
    const authPlugin = new AuthPlugin();
    const events: Array<any> = [];
    const off = context.eventBus.on('auth:changed', (payload) => {
      events.push(payload);
    });

    authPlugin.init(context);

    const auth = sdk.getService<IAuthManager>('auth.manager');
    expect(auth).toBeDefined();

    await expect(auth!.logout()).resolves.toBe(true);

    const latest = auth!.getStatus();
    expect(latest.state).toBe('AUTHENTICATED');
    expect(latest.provider).toBe('guest');
    expect(latest.locked).toBe(true);

    expect(events.length).toBeGreaterThan(0);
    const finalEvent = events[events.length - 1];
    expect(finalEvent).toEqual(expect.objectContaining({
      status: expect.objectContaining({ state: 'AUTHENTICATED', provider: 'guest' }),
      identity: expect.objectContaining({ isGuest: true }),
    }));

    off();
    authPlugin.dispose();
  });
});
