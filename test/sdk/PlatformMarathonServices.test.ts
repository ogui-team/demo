import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IEventBus, PluginInitContext } from '@shared/contracts';
import { PluginRegistry } from '../../client/src/4-runtime/runtime/PluginRegistry';
import { PublicSystemRegistry } from '../../client/src/1-kernel/core/PublicSystemRegistry';
import { PublicEventBus } from '../../client/src/1-kernel/core/PublicEventBus';
import { GameEngineSDKImpl } from '../../client/src/4-runtime/runtime/GameEngineSdk';
import { InspectorService, RuntimeMixerService, StatePersistenceService } from '../../client/src/4-runtime/runtime/RuntimeMixerPlugin';
import { MetadataStore } from '../../client/src/0-foundation/reflection/ReflectionSystem';

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

describe('Platform Marathon service smoke tests', () => {
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
  });

  afterEach(async () => {
    await pluginRegistry.unloadAll();
    sdk.dispose();
    pluginRegistry.dispose();
    publicSystemRegistry.dispose();
    publicEventBus.dispose();
  });

  it('Block A: RuntimeMixerService toggles system updates', () => {
    const updates: number[] = [];
    const physicsSystem = {
      update: (deltaTime: number) => {
        updates.push(deltaTime);
        return new Map([['ok', true]]);
      },
      dispose: vi.fn(),
    };

    publicSystemRegistry.registerSystem('physicsSystem', physicsSystem);

    const mixer = new RuntimeMixerService(context, null);

    expect(mixer.setTrackEnabled('physicsSystem', false)).toBe(true);
    const disabledResult = physicsSystem.update(0.016);
    expect(disabledResult).toBeInstanceOf(Map);
    expect(updates.length).toBe(0);

    expect(mixer.setTrackEnabled('physicsSystem', true)).toBe(true);
    physicsSystem.update(0.016);
    expect(updates.length).toBe(1);

    mixer.dispose();
  });

  it('Block B: InspectorService builds and applies metadata-aware fields', () => {
    const entity = {
      id: 'entity-1',
      type: 'enemy',
      getComponent: (name: string) => (name === 'stats' ? { name: 'stats', data: statsData } : undefined),
      getComponents: () => [{ name: 'stats', data: statsData }],
      touch: vi.fn(),
    };

    const statsData: Record<string, unknown> = {
      speed: 12,
      alive: true,
    };

    MetadataStore.registerClass('stats', 'Stats');
    MetadataStore.registerProperty('stats', 'speed', {
      editorVisible: true,
      type: 'number',
      min: 0,
      max: 100,
      label: 'Movement Speed',
    });

    publicSystemRegistry.registerSystem('entityManager', {
      getEntity: (id: string) => (id === 'entity-1' ? entity : null),
      dispose: vi.fn(),
    });
    publicSystemRegistry.registerSystem('selectionSystem', {
      getSelected: () => 'entity-1',
      onSelect: () => () => undefined,
      onDeselect: () => () => undefined,
      dispose: vi.fn(),
    });

    const inspector = new InspectorService(context, null);

    const snapshot = inspector.inspectSelectedEntity();
    expect(snapshot?.entityId).toBe('entity-1');
    expect(snapshot?.fields.some((field) => field.path === 'speed')).toBe(true);

    const applied = inspector.applyFieldValue('entity-1', 'stats', 'speed', 999);
    expect(applied).toBe(true);
    expect(statsData.speed).toBe(100);

    inspector.dispose();
  });

  it('Block C: StatePersistenceService wraps SaveLoadManager operations', () => {
    const loadResult = { success: true, entitiesCreated: 3, settingsApplied: 5 };

    const manager = {
      saveMap: vi.fn(() => true),
      loadMap: vi.fn(() => loadResult),
      listMaps: vi.fn(() => ['alpha']),
      deleteMap: vi.fn(() => true),
      exportMap: vi.fn(() => '{"world":1}'),
      importMap: vi.fn(() => loadResult),
      dispose: vi.fn(),
    };

    publicSystemRegistry.registerSystem('saveLoadManager', manager);

    const persistence = new StatePersistenceService(context, null);

    expect(persistence.saveMap('alpha')).toBe(true);
    expect(persistence.loadMap('alpha')).toEqual(loadResult);
    expect(persistence.listMaps()).toEqual(['alpha']);
    expect(persistence.deleteMap('alpha')).toBe(true);
    expect(persistence.exportWorld('alpha')).toBe('{"world":1}');
    expect(persistence.importWorld('{"world":1}', 'alpha')).toEqual(loadResult);

    persistence.dispose();
  });
});
