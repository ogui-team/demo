import {
  DeterministicRandomImpl,
  DeterministicTimeImpl,
  injectDeterminismShim,
  isDeterminismShimActive,
  type GameEngineSdk,
  type GamePlugin,
  type IAudioService,
  type ISettingsService,
  type PluginInitContext,
} from 'my-engine-sdk';

class EmptyPlugin implements GamePlugin {
  readonly id = 'empty-plugin';
  readonly name = 'Empty Plugin';
  readonly version = '1.0.0';

  init(context: PluginInitContext): void {
    const settingsService = context.sdk.getService<ISettingsService>('settings');
    settingsService?.set('sandbox.lastPlugin', this.id);
    const audioService = context.sdk.getService<IAudioService>('audio');
    audioService?.setMasterVolume(0.75);
    audioService?.play('sandbox_click', { volume: 0.5 });
    context.logger.log('[Sandbox] EmptyPlugin initialized');
    context.logger.log('[Sandbox] Settings value:', settingsService?.get('sandbox.lastPlugin'));
    context.logger.log('[Sandbox] Audio volume:', audioService?.getMasterVolume());
    context.logger.log('[Sandbox] Determinism shim active:', isDeterminismShimActive());
  }

  dispose(): void {
    console.log('[Sandbox] EmptyPlugin disposed');
  }
}

class MockSettingsService implements ISettingsService {
  readonly id = 'settings';
  private readonly values = new Map<string, unknown>();
  private visible = false;

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  get<T = unknown>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set<T = unknown>(key: string, value: T): void {
    this.values.set(key, value);
  }

  dispose(): void {
    this.values.clear();
    this.visible = false;
  }
}

class MockAudioService implements IAudioService {
  readonly id = 'audio';
  private muted = false;
  private masterVolume = 1;

  play(trackId: string, options?: { volume?: number; loop?: boolean }): void {
    console.log('[Sandbox] play()', { trackId, options });
  }

  stop(trackId: string): void {
    console.log('[Sandbox] stop()', { trackId });
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  dispose(): void {
    this.muted = false;
    this.masterVolume = 1;
  }
}

function createEventBus() {
  const handlers = new Map<string, Array<(data: unknown) => void>>();
  return {
    emit(event: string, data?: unknown): void {
      for (const handler of handlers.get(event) ?? []) {
        handler(data);
      }
    },
    on(event: string, handler: (data: unknown) => void): () => void {
      const next = handlers.get(event) ?? [];
      next.push(handler);
      handlers.set(event, next);
      return () => {
        handlers.set(event, (handlers.get(event) ?? []).filter((entry) => entry !== handler));
      };
    },
    once(event: string, handler: (data: unknown) => void): () => void {
      let unsubscribe = () => {};
      const wrapped = (data: unknown): void => {
        unsubscribe();
        handler(data);
      };
      unsubscribe = this.on(event, wrapped);
      return unsubscribe;
    },
    off(event: string): void {
      handlers.delete(event);
    },
  };
}

function createSdk(
  settingsService: MockSettingsService,
  audioService: MockAudioService,
  eventBus: ReturnType<typeof createEventBus>,
): GameEngineSdk {
  const services = new Map<string, ISettingsService | IAudioService>();
  const sdk = {
    plugins: {} as GameEngineSdk['plugins'],
    systems: {} as GameEngineSdk['systems'],
    events: eventBus,
    services: {
      registerService(id: string, service: ISettingsService | IAudioService): void {
        services.set(id, service);
      },
      unregisterService(id: string): void {
        services.get(id)?.dispose();
        services.delete(id);
      },
      getService<T>(id: string): T | undefined {
        return services.get(id) as T | undefined;
      },
      hasService(id: string): boolean {
        return services.has(id);
      },
      listServices(): string[] {
        return Array.from(services.keys());
      },
      dispose(): void {
        for (const service of services.values()) {
          service.dispose();
        }
        services.clear();
      },
    },
    getService<T>(id: string): T | undefined {
      return services.get(id) as T | undefined;
    },
    registerService(id: string, service: ISettingsService | IAudioService): void {
      services.set(id, service);
    },
    unregisterService(id: string): void {
      services.get(id)?.dispose();
      services.delete(id);
    },
    config: {
      get: () => undefined,
      set: () => {},
    },
    version: 'sandbox',
    features: {
      isEnabled: () => false,
    },
  } as unknown as GameEngineSdk;

  sdk.registerService('settings', settingsService);
  sdk.registerService('audio', audioService);
  return sdk;
}

const deterministicTime = new DeterministicTimeImpl({ currentTick: 8 });
const deterministicRandom = new DeterministicRandomImpl(2026);
injectDeterminismShim({
  time: deterministicTime,
  random: deterministicRandom,
  timer: {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  },
});

const eventBus = createEventBus();
const settingsService = new MockSettingsService();
const audioService = new MockAudioService();
const sdk = createSdk(settingsService, audioService, eventBus);

const plugin = new EmptyPlugin();
plugin.init({
  sdk,
  gameLoop: {},
  stateManager: {},
  systemContext: {},
  systemRegistry: sdk.systems,
  gameBus: eventBus,
  eventBus,
  logger: {
    log: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
  },
  features: {
    isEnabled: () => false,
  },
  config: {
    get: () => undefined,
    set: () => {},
  },
} as unknown as PluginInitContext);

plugin.dispose();
sdk.services.dispose();
console.log('[Sandbox] Smoke test run completed');

