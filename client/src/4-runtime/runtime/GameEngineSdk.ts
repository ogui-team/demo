import type { GameEngineSdk, IEventBus, IPluginRegistry, IService, ISystemRegistry, ServiceRegistry } from '@shared/contracts';
import { FeatureManager } from '@engine/1-kernel/core/public-api';

type ConfigValue = unknown;

export interface PluginLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export class RuntimeServiceRegistry implements ServiceRegistry {
  private readonly services = new Map<string, IService>();
  private disposed = false;

  registerService<T extends IService>(id: string, service: T): void {
    if (this.disposed) {
      throw new Error('RuntimeServiceRegistry has been disposed');
    }

    if (this.services.has(id)) {
      throw new Error(`Service "${id}" is already registered`);
    }

    this.services.set(id, service);
  }

  unregisterService(id: string): void {
    const service = this.services.get(id);
    if (!service) {
      return;
    }

    service.dispose();
    this.services.delete(id);
  }

  getService<T extends IService>(id: string): T | undefined {
    return this.services.get(id) as T | undefined;
  }

  hasService(id: string): boolean {
    return this.services.has(id);
  }

  listServices(): string[] {
    return Array.from(this.services.keys());
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    for (const serviceId of this.listServices()) {
      this.unregisterService(serviceId);
    }

    this.disposed = true;
  }
}

class RuntimeConfigManager {
  private readonly values = new Map<string, ConfigValue>();

  constructor(initialValues: Record<string, ConfigValue> = {}) {
    for (const [key, value] of Object.entries(initialValues)) {
      this.values.set(key, value);
    }

    this.loadFromStorage();
  }

  get(key: string): ConfigValue {
    return this.values.get(key);
  }

  set(key: string, value: ConfigValue): void {
    this.values.set(key, value);
    this.saveToStorage();
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem('engine_sdk_config');
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Record<string, ConfigValue>;
      for (const [key, value] of Object.entries(parsed)) {
        this.values.set(key, value);
      }
    } catch {
      // Ignore malformed or unavailable storage.
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem('engine_sdk_config', JSON.stringify(Object.fromEntries(this.values)));
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }
}

class RuntimeFeatureFacade {
  isEnabled(feature: string): boolean {
    return FeatureManager.isEnabled(feature as never);
  }
}

export class GameEngineSDKImpl implements GameEngineSdk {
  readonly version = '0.3.0';
  readonly config: RuntimeConfigManager;
  readonly features: RuntimeFeatureFacade;
  readonly services: RuntimeServiceRegistry;

  constructor(
    readonly plugins: IPluginRegistry,
    readonly systems: ISystemRegistry,
    readonly events: IEventBus,
    initialConfig: Record<string, ConfigValue> = {},
  ) {
    this.config = new RuntimeConfigManager(initialConfig);
    this.features = new RuntimeFeatureFacade();
    this.services = new RuntimeServiceRegistry();
  }

  getService<T extends IService>(id: string): T | undefined {
    return this.services.getService<T>(id);
  }

  registerService<T extends IService>(id: string, service: T): void {
    this.services.registerService(id, service);
  }

  unregisterService(id: string): void {
    this.services.unregisterService(id);
  }

  dispose(): void {
    this.services.dispose();
  }
}

export function createPluginLogger(scope: string): PluginLogger {
  const prefix = `[${scope}]`;
  return {
    log: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
    debug: (...args: unknown[]) => console.debug(prefix, ...args),
  };
}

declare global {
  interface Window {
    __GAME_ENGINE_SDK__?: GameEngineSdk;
    __gameEngineSdk?: GameEngineSdk;
  }
}

export function exposeGameEngineSDK(sdk: GameEngineSdk): GameEngineSdk {
  if (typeof window !== 'undefined') {
    window.__GAME_ENGINE_SDK__ = sdk;
    window.__gameEngineSdk = sdk;
  }

  (globalThis as any).__GAME_ENGINE_SDK__ = sdk;
  return sdk;
}
