import {
  deriveSystemCapabilities,
  deriveSystemDebugState,
  enforceSystemDisposeContract,
  ensureEngineSystemContract,
  type SystemCapabilities,
} from './SystemHealthCorridor';

export type SystemStatus = 'active' | 'disabled' | 'error';

export type DebugControlType = 'boolean' | 'number' | 'string' | 'readonly' | 'action';

export interface SystemDebugProperty {
  key: string;
  label?: string;
  type: DebugControlType;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  get?: (system: unknown, entry: RegisteredSystem) => unknown;
  set?: (system: unknown, value: unknown, entry: RegisteredSystem) => void;
  action?: (system: unknown, entry: RegisteredSystem) => void;
}

export interface SystemDebugMetadata {
  displayName?: string;
  category?: string;
  order?: number;
  properties?: SystemDebugProperty[];
  getState?: (system: unknown, entry: RegisteredSystem) => Record<string, unknown>;
  getCapabilities?: (system: unknown, entry: RegisteredSystem) => SystemCapabilities;
}

export interface RegisteredSystem {
  name: string;
  system: unknown;
  status: SystemStatus;
  registeredAt: number;
  lastUpdateAt: number;
  updateCount: number;
  lastError: string | null;
  metadata: SystemDebugMetadata;
}

class SystemRegistry {
  private systems = new Map<string, RegisteredSystem>();

  register(name: string, system: unknown, metadata: SystemDebugMetadata = {}): void {
    ensureEngineSystemContract(system, name);
    enforceSystemDisposeContract(system, name);
    const existing = this.systems.get(name);
    this.systems.set(name, {
      name,
      system,
      status: existing?.status ?? 'active',
      registeredAt: existing?.registeredAt ?? Date.now(),
      lastUpdateAt: existing?.lastUpdateAt ?? 0,
      updateCount: existing?.updateCount ?? 0,
      lastError: existing?.lastError ?? null,
      metadata: { ...(existing?.metadata ?? {}), ...metadata },
    });
  }

  updateMetadata(name: string, metadata: SystemDebugMetadata): void {
    const existing = this.systems.get(name);
    if (!existing) return;
    existing.metadata = { ...existing.metadata, ...metadata };
  }

  get<T = unknown>(name: string): T | null {
    return (this.systems.get(name)?.system as T | undefined) ?? null;
  }

  list(): RegisteredSystem[] {
    return Array.from(this.systems.values());
  }

  markUpdated(name: string): void {
    const entry = this.systems.get(name);
    if (!entry) return;
    entry.lastUpdateAt = Date.now();
    entry.updateCount += 1;
    entry.status = 'active';
    entry.lastError = null;
  }

  markError(name: string, error: unknown): void {
    const entry = this.systems.get(name);
    if (!entry) return;
    entry.status = 'error';
    entry.lastError = error instanceof Error ? error.message : String(error);
  }

  disable(name: string, reason?: string): void {
    const entry = this.systems.get(name);
    if (!entry) return;
    entry.status = 'disabled';
    if (reason) entry.lastError = reason;

    const candidate = entry.system as { disable?: () => void };
    candidate.disable?.();
  }

  getActiveSystemNames(): string[] {
    return this.list()
      .filter((entry) => {
        if (entry.status !== 'active') return false;
        const candidate = entry.system as { isEnabled?: () => boolean; isVisible?: () => boolean };
        if (typeof candidate.isEnabled === 'function') {
          return candidate.isEnabled();
        }
        if (typeof candidate.isVisible === 'function') {
          return candidate.isVisible();
        }
        return true;
      })
      .map((entry) => entry.name)
      .sort();
  }

  getStateSnapshot(name: string): Record<string, unknown> {
    const entry = this.systems.get(name);
    if (!entry) return {};

    if (typeof entry.metadata.getState === 'function') {
      return entry.metadata.getState(entry.system, entry);
    }

    const candidate = entry.system as {
      getDiagnostics?: () => Record<string, unknown>;
      getDebugStats?: () => Record<string, unknown>;
      getProtocolDiagnostics?: () => Record<string, unknown>;
      isEnabled?: () => boolean;
      isVisible?: () => boolean;
    };
    const snapshot: Record<string, unknown> = {
      status: entry.status,
      updateCount: entry.updateCount,
      lastUpdateAt: entry.lastUpdateAt,
      lastError: entry.lastError,
      systemId: name,
      capabilities: this.getCapabilitiesSnapshot(name),
    };

    const debugState = deriveSystemDebugState(entry.system);
    if (Object.keys(debugState).length > 0) {
      snapshot.debugState = debugState;
    }

    if (typeof candidate.getDiagnostics === 'function') {
      Object.assign(snapshot, candidate.getDiagnostics());
    }
    if (typeof candidate.getDebugStats === 'function') {
      Object.assign(snapshot, candidate.getDebugStats());
    }
    if (typeof candidate.getProtocolDiagnostics === 'function') {
      snapshot.protocol = candidate.getProtocolDiagnostics();
    }
    if (typeof candidate.isEnabled === 'function') {
      snapshot.enabled = candidate.isEnabled();
    }
    if (typeof candidate.isVisible === 'function') {
      snapshot.visible = candidate.isVisible();
    }

    return snapshot;
  }

  getCapabilitiesSnapshot(name: string): SystemCapabilities {
    const entry = this.systems.get(name);
    if (!entry) {
      return {
        usesEventBus: false,
        usesReplication: false,
        exposesDebug: false,
        deterministic: true,
        usesSystemContext: false,
        usesNetworkFacade: false,
      };
    }

    if (typeof entry.metadata.getCapabilities === 'function') {
      return entry.metadata.getCapabilities(entry.system, entry);
    }

    return deriveSystemCapabilities(entry.system);
  }

  getProperties(name: string): SystemDebugProperty[] {
    return [...(this.systems.get(name)?.metadata.properties ?? [])];
  }

  readProperty(name: string, propertyKey: string): unknown {
    const entry = this.systems.get(name);
    if (!entry) return undefined;
    const descriptor = entry.metadata.properties?.find((property) => property.key === propertyKey);
    if (!descriptor) return undefined;
    if (typeof descriptor.get === 'function') {
      return descriptor.get(entry.system, entry);
    }
    return (entry.system as Record<string, unknown>)[propertyKey];
  }

  writeProperty(name: string, propertyKey: string, value: unknown): void {
    const entry = this.systems.get(name);
    if (!entry) return;
    const descriptor = entry.metadata.properties?.find((property) => property.key === propertyKey);
    if (!descriptor) return;
    if (descriptor.type === 'action') {
      descriptor.action?.(entry.system, entry);
      return;
    }
    if (typeof descriptor.set === 'function') {
      descriptor.set(entry.system, value, entry);
      return;
    }
    (entry.system as Record<string, unknown>)[propertyKey] = value;
  }
}

const registry = new SystemRegistry();

export function registerSystem(name: string, system: unknown, metadata: SystemDebugMetadata = {}): void {
  registry.register(name, system, metadata);
}

export function registerSystemMetadata(name: string, metadata: SystemDebugMetadata): void {
  registry.updateMetadata(name, metadata);
}

export function getSystem<T = unknown>(name: string): T | null {
  return registry.get<T>(name);
}

export function listSystems(): RegisteredSystem[] {
  return registry.list();
}

export function markSystemUpdated(name: string): void {
  registry.markUpdated(name);
}

export function markSystemError(name: string, error: unknown): void {
  registry.markError(name, error);
}

export function disableSystem(name: string, reason?: string): void {
  registry.disable(name, reason);
}

export function getActiveSystemNames(): string[] {
  return registry.getActiveSystemNames();
}

export function getSystemStateSnapshot(name: string): Record<string, unknown> {
  return registry.getStateSnapshot(name);
}

export function getSystemCapabilitiesSnapshot(name: string): SystemCapabilities {
  return registry.getCapabilitiesSnapshot(name);
}

export function getSystemDebugProperties(name: string): SystemDebugProperty[] {
  return registry.getProperties(name);
}

export function getSystemDebugValue(name: string, propertyKey: string): unknown {
  return registry.readProperty(name, propertyKey);
}

export function setSystemDebugValue(name: string, propertyKey: string, value: unknown): void {
  registry.writeProperty(name, propertyKey, value);
}
