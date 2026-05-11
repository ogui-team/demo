import {
  DeterministicRandomImpl,
  DeterministicTimeImpl,
  injectDeterminismShim,
  type GameEngineSdk,
  type GamePlugin,
  type PluginInitContext,
} from 'my-engine-sdk';

interface ZombieData {
  id: string;
  hp: number;
  position: {
    x: number;
    y: number;
    z: number;
  };
}

class ZombiePlugin implements GamePlugin {
  readonly id = 'zombie-plugin';
  readonly name = 'Zombie Plugin';
  readonly version = '1.0.0';

  readonly zombies: ZombieData[] = [];
  private unsubscribe: (() => void) | null = null;

  init(context: PluginInitContext): void {
    const random = new DeterministicRandomImpl(1337);
    this.unsubscribe = context.gameBus.on('game:start', () => {
      this.zombies.length = 0;
      for (let index = 0; index < 10; index++) {
        this.zombies.push({
          id: `zombie-${index + 1}`,
          hp: 100,
          position: {
            x: random.nextInt(0, 25),
            y: 0,
            z: random.nextInt(0, 25),
          },
        });
      }

      context.logger.log('[Sandbox] Spawned zombies:', this.zombies.length);
      context.logger.log('[Sandbox] First zombie:', this.zombies[0]);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.zombies.length = 0;
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

function createSdk(eventBus: ReturnType<typeof createEventBus>): GameEngineSdk {
  return {
    plugins: {} as GameEngineSdk['plugins'],
    systems: {} as GameEngineSdk['systems'],
    events: eventBus,
    services: {
      registerService: () => {},
      unregisterService: () => {},
      getService: () => undefined,
      hasService: () => false,
      listServices: () => [],
      dispose: () => {},
    },
    getService: () => undefined,
    registerService: () => {},
    unregisterService: () => {},
    config: {
      get: () => undefined,
      set: () => {},
    },
    version: 'sandbox',
    features: {
      isEnabled: () => false,
    },
  } as unknown as GameEngineSdk;
}

injectDeterminismShim({
  time: new DeterministicTimeImpl({ currentTick: 16 }),
  random: new DeterministicRandomImpl(42),
  timer: {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  },
});

const eventBus = createEventBus();
const sdk = createSdk(eventBus);
const plugin = new ZombiePlugin();

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
    enable: () => {},
    disable: () => {},
  },
  config: {
    get: () => undefined,
    set: () => {},
  },
} as unknown as PluginInitContext);

eventBus.emit('game:start');
console.log('[Sandbox] Zombie count after game:start:', plugin.zombies.length);
plugin.dispose();
console.log('[Sandbox] ZombiePlugin run completed');