import type { EventBus } from './EventBus';
import type { GameEvents } from './types';
import type { EntityManager } from './EntityManager';
import type { NetworkManager } from '../../3-network/network/NetworkManager';
import type { NetworkAbilityRequest, NetworkInputCommand, NetworkReplicatedEntityState, NetworkSnapshot } from '../../3-network/network/NetworkRuntimeContracts';
import type { NetworkSyncSystem } from '../../3-network/network/NetworkSyncSystem';
import type { ReplicationSystem } from '../../3-network/network/ReplicationSystem';
import type { MultiplayerClient } from '../../3-network/network/MultiplayerClient';
import type { ResourceManager } from '../../2-systems/gameplay/systems/ResourceManager';

export interface EngineEvent<K extends keyof GameEvents = keyof GameEvents> {
  type: K;
  payload: GameEvents[K];
}

export interface SystemCapabilities {
  usesEventBus: boolean;
  usesReplication: boolean;
  exposesDebug: boolean;
  hasDebugIntegration?: boolean;
  deterministic: boolean;
  usesSystemContext?: boolean;
  usesNetworkFacade?: boolean;
}

export interface SystemContextSystems {
  [name: string]: unknown;
}

export interface GameplayCommand {
  type: string;
  payload?: Record<string, unknown>;
  playerId?: string;
  seq?: number;
  tick?: number;
  timestamp?: number;
  input?: Record<string, unknown>;
  abilityId?: string;
}

export interface NetworkFacade {
  sendCommand(cmd: GameplayCommand): void;
  getSnapshot(): NetworkSnapshot | null;
  onSnapshot(cb: (snapshot: NetworkSnapshot) => void): () => void;
  getClient(): MultiplayerClient | null;
  getSync(): NetworkSyncSystem | null;
  attachClient(client: MultiplayerClient | null): void;
}

export interface ReplicationFacade {
  getSnapshot(entityId: string): Record<string, unknown> | undefined;
  applySnapshot(snapshot: NetworkReplicatedEntityState): boolean;
  applySnapshots(snapshots: NetworkReplicatedEntityState[]): string[];
  getDiagnostics(): Record<string, unknown>;
  getSystem(): ReplicationSystem | null;
}

export interface SystemContext {
  eventBus: EventBus<GameEvents>;
  entityManager: EntityManager | null;
  network: NetworkFacade;
  replication: ReplicationFacade;
  resources: ResourceManager | null;
  systems: SystemContextSystems;
  resolveSystem?: <T = unknown>(name: string) => T | null;
}

export interface EngineSystem {
  id: string;
  init?(ctx: SystemContext): void;
  update?(dt: number): void;
  dispose?(): void;
  onEvent?(event: EngineEvent): void;
  getDebugState?(): Record<string, unknown>;
  getCapabilities?(): SystemCapabilities;
}

const SYSTEM_CONTEXT_KEY = Symbol('engine.systemContext');
const SYSTEM_CAPABILITIES_KEY = Symbol('engine.systemCapabilities');
const SYSTEM_ID_KEY = Symbol('engine.systemId');

interface MutableSystemShape extends Partial<EngineSystem> {
  destroy?: () => void;
  disable?: () => void;
  isEnabled?: () => boolean;
  isVisible?: () => boolean;
  getDiagnostics?: () => Record<string, unknown>;
  getDebugStats?: () => Record<string, unknown>;
  getProtocolDiagnostics?: () => Record<string, unknown>;
  setSystemContext?: (ctx: SystemContext) => void;
  [SYSTEM_CONTEXT_KEY]?: SystemContext;
  [SYSTEM_CAPABILITIES_KEY]?: Partial<SystemCapabilities>;
  [SYSTEM_ID_KEY]?: string;
  [key: string]: unknown;
}

const corridorWarnings = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (corridorWarnings.has(key)) return;
  corridorWarnings.add(key);
  console.warn(message);
}

function hasCompletedBootstrapRegistration(): boolean {
  const globalScope = globalThis as { __bootstrapState?: unknown };
  return globalScope.__bootstrapState != null;
}

export function ensureEngineSystemContract(system: unknown, id: string, capabilities?: Partial<SystemCapabilities>): void {
  if (!isObject(system)) return;
  const candidate = system as MutableSystemShape;

  candidate[SYSTEM_ID_KEY] = candidate[SYSTEM_ID_KEY] ?? id;
  if (typeof capabilities === 'object') {
    candidate[SYSTEM_CAPABILITIES_KEY] = {
      ...(candidate[SYSTEM_CAPABILITIES_KEY] ?? {}),
      ...capabilities,
    };
  }

  if (typeof candidate.id !== 'string') {
    Object.defineProperty(candidate, 'id', {
      value: id,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  if (typeof candidate.getCapabilities !== 'function') {
    Object.defineProperty(candidate, 'getCapabilities', {
      value: () => deriveSystemCapabilities(candidate),
      writable: true,
      configurable: true,
    });
  }

  if (typeof candidate.getDebugState !== 'function') {
    Object.defineProperty(candidate, 'getDebugState', {
      value: () => deriveSystemDebugState(candidate),
      writable: true,
      configurable: true,
    });
  }

  if (typeof candidate.dispose !== 'function') {
    Object.defineProperty(candidate, 'dispose', {
      value: () => {
        if (typeof candidate.destroy === 'function') {
          candidate.destroy();
          return;
        }
        if (typeof candidate.disable === 'function') {
          candidate.disable();
        }
      },
      writable: true,
      configurable: true,
    });
  }
}

export function bindSystemContext(system: unknown, id: string, ctx: SystemContext, capabilities?: Partial<SystemCapabilities>): void {
  ensureEngineSystemContract(system, id, capabilities);
  if (!isObject(system)) return;

  const candidate = system as MutableSystemShape;
  candidate[SYSTEM_CONTEXT_KEY] = ctx;
  if (typeof capabilities === 'object') {
    candidate[SYSTEM_CAPABILITIES_KEY] = {
      ...(candidate[SYSTEM_CAPABILITIES_KEY] ?? {}),
      ...capabilities,
      usesSystemContext: true,
    };
  } else {
    candidate[SYSTEM_CAPABILITIES_KEY] = {
      ...(candidate[SYSTEM_CAPABILITIES_KEY] ?? {}),
      usesSystemContext: true,
    };
  }

  if (typeof candidate.setSystemContext === 'function') {
    candidate.setSystemContext(ctx);
  }

  if (typeof candidate.getCapabilities === 'function') {
    const declared = candidate.getCapabilities();
    if (declared.usesSystemContext === false) {
      warnOnce(`capabilities:context:${id}`, `[Corridor] ${id} reported usesSystemContext=false after context binding`);
    }
    if (declared.usesNetworkFacade && !ctx.network.getClient() && !ctx.network.getSync()) {
      warnOnce(`capabilities:network:${id}`, `[Corridor] ${id} declared NetworkFacade usage but no client/sync transport is available yet`);
    }
  }
}

export function getBoundSystemContext(system: unknown): SystemContext | null {
  if (!isObject(system)) return null;
  return (system as MutableSystemShape)[SYSTEM_CONTEXT_KEY] ?? null;
}

export function deriveSystemCapabilities(system: unknown): SystemCapabilities {
  if (!isObject(system)) {
    return {
      usesEventBus: false,
      usesReplication: false,
      exposesDebug: false,
      deterministic: true,
      usesSystemContext: false,
      usesNetworkFacade: false,
    };
  }

  const candidate = system as MutableSystemShape;
  const declared = candidate[SYSTEM_CAPABILITIES_KEY] ?? {};
  const hasContext = Boolean(candidate[SYSTEM_CONTEXT_KEY]);

  return {
    usesEventBus: declared.usesEventBus ?? typeof candidate.onEvent === 'function',
    usesReplication: declared.usesReplication ?? (typeof candidate.applySnapshot === 'function' || typeof candidate.applySnapshots === 'function'),
    exposesDebug: declared.exposesDebug ?? (typeof candidate.getDebugState === 'function' || typeof candidate.getDiagnostics === 'function' || typeof candidate.getDebugStats === 'function'),
    hasDebugIntegration: declared.hasDebugIntegration ?? declared.exposesDebug ?? (typeof candidate.getDebugState === 'function' || typeof candidate.getDiagnostics === 'function' || typeof candidate.getDebugStats === 'function'),
    deterministic: declared.deterministic ?? true,
    usesSystemContext: declared.usesSystemContext ?? hasContext,
    usesNetworkFacade: declared.usesNetworkFacade ?? Boolean(hasContext && candidate[SYSTEM_CONTEXT_KEY]?.network),
  };
}

export function createSystemAccessProxy(resolveSystem: (name: string) => unknown): SystemContextSystems {
  return new Proxy({}, {
    get: (_target, prop) => {
      if (typeof prop !== 'string') return undefined;
      const resolved = resolveSystem(prop);
      if (resolved == null && hasCompletedBootstrapRegistration()) {
        warnOnce(`systems:${prop}`, `[Corridor] ctx.systems.${prop} was accessed before the system was registered or bound`);
      }
      return resolved;
    },
    has: (_target, prop) => typeof prop === 'string' && resolveSystem(prop) != null,
  }) as SystemContextSystems;
}

export function deriveSystemDebugState(system: unknown): Record<string, unknown> {
  if (!isObject(system)) {
    return {
      id: 'unknown',
      contractApplied: false,
    };
  }

  const candidate = system as MutableSystemShape;
  const snapshot: Record<string, unknown> = {
    id: typeof candidate.id === 'string' ? candidate.id : candidate[SYSTEM_ID_KEY] ?? 'unknown',
    contractApplied: true,
    hasSystemContext: Boolean(candidate[SYSTEM_CONTEXT_KEY]),
    capabilities: deriveSystemCapabilities(candidate),
  };

  if (typeof candidate.isEnabled === 'function') {
    snapshot.enabled = candidate.isEnabled();
  }
  if (typeof candidate.isVisible === 'function') {
    snapshot.visible = candidate.isVisible();
  }
  if (typeof candidate.getDiagnostics === 'function') {
    snapshot.diagnostics = candidate.getDiagnostics();
  }
  if (typeof candidate.getDebugStats === 'function') {
    snapshot.debugStats = candidate.getDebugStats();
  }
  if (typeof candidate.getProtocolDiagnostics === 'function') {
    snapshot.protocol = candidate.getProtocolDiagnostics();
  }

  return snapshot;
}

export function createNetworkFacade(deps: {
  networkManager: NetworkManager | null;
  networkSyncSystem: NetworkSyncSystem | null;
  replicationSystem: ReplicationSystem | null;
  multiplayerClient?: MultiplayerClient | null;
}): NetworkFacade {
  let currentClient = deps.multiplayerClient ?? null;
  let latestSnapshot: NetworkSnapshot | null = null;
  const listeners = new Set<(snapshot: NetworkSnapshot) => void>();

  deps.networkManager?.onSnapshot((snapshot) => {
    latestSnapshot = snapshot;
    for (const listener of [...listeners]) {
      listener(snapshot);
    }
  });

  return {
    sendCommand(cmd: GameplayCommand): void {
      if (!deps.networkManager && !currentClient) {
        warnOnce('network:sendCommand', '[Corridor] NetworkFacade.sendCommand() was called without a network manager or attached multiplayer client');
        return;
      }

      if (isInputCommand(cmd)) {
        deps.networkManager?.sendInputCommand(cmd as NetworkInputCommand);
        return;
      }

      if (isAbilityCommand(cmd)) {
        const request: NetworkAbilityRequest = {
          playerId: cmd.playerId,
          abilityId: cmd.abilityId,
          timestamp: cmd.timestamp ?? Date.now(),
          payload: cmd.payload,
        };
        deps.networkManager?.sendAbilityRequest(request);
        return;
      }

      currentClient?.sendGameplayCommand(cmd.type, cmd.payload ?? {});
    },
    getSnapshot(): NetworkSnapshot | null {
      return latestSnapshot;
    },
    onSnapshot(cb: (snapshot: NetworkSnapshot) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getClient(): MultiplayerClient | null {
      if (!currentClient && hasCompletedBootstrapRegistration()) {
        warnOnce('network:getClient', '[Corridor] NetworkFacade.getClient() returned null because no multiplayer client is attached');
      }
      return currentClient;
    },
    getSync(): NetworkSyncSystem | null {
      if (!deps.networkSyncSystem && hasCompletedBootstrapRegistration()) {
        warnOnce('network:getSync', '[Corridor] NetworkFacade.getSync() returned null because no network sync system is attached');
      }
      return deps.networkSyncSystem;
    },
    attachClient(client: MultiplayerClient | null): void {
      currentClient = client;
    },
  };
}

export function createReplicationFacade(replicationSystem: ReplicationSystem | null): ReplicationFacade {
  return {
    getSnapshot(entityId: string): Record<string, unknown> | undefined {
      return replicationSystem?.getSnapshot(entityId);
    },
    applySnapshot(snapshot: NetworkReplicatedEntityState): boolean {
      return replicationSystem?.applySnapshot(snapshot) ?? false;
    },
    applySnapshots(snapshots: NetworkReplicatedEntityState[]): string[] {
      return replicationSystem?.applySnapshots(snapshots) ?? [];
    },
    getDiagnostics(): Record<string, unknown> {
      return replicationSystem?.getDiagnostics() ?? {};
    },
    getSystem(): ReplicationSystem | null {
      return replicationSystem;
    },
  };
}

function isInputCommand(value: GameplayCommand): boolean {
  return typeof value.playerId === 'string'
    && typeof value.seq === 'number'
    && typeof value.tick === 'number'
    && typeof value.timestamp === 'number'
    && typeof value.input === 'object'
    && value.input !== null;
}

function isAbilityCommand(value: GameplayCommand): value is GameplayCommand & { playerId: string; abilityId: string } {
  return typeof value.playerId === 'string' && typeof value.abilityId === 'string';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * TIER 0E: Enforce Lifecycle Contract
 * 
 * Validates that all registered systems have at least one cleanup method:
 * - dispose() (preferred)
 * - destroy()
 * - disable()
 * - clear()
 * 
 * Throws an error if a system has no cleanup method, preventing future leaks.
 * Called during system registration in SystemRegistry.
 */
export function enforceSystemDisposeContract(system: unknown, systemId: string): void {
  if (!isObject(system)) {
    throw new Error(`[SystemRegistry] System "${systemId}" is not an object`);
  }

  const candidate = system as MutableSystemShape;

  // Check for at least one cleanup method
  const hasDispose = typeof candidate.dispose === 'function';
  const hasDestroy = typeof candidate.destroy === 'function';
  const hasDisable = typeof candidate.disable === 'function';
  const hasClear = typeof candidate.clear === 'function';

  if (!hasDispose && !hasDestroy && !hasDisable && !hasClear) {
    throw new Error(
      `[SystemRegistry] System "${systemId}" MUST implement at least one cleanup method:` +
      ` dispose(), destroy(), disable(), or clear(). ` +
      `This is required for safe mode transitions and memory leak prevention.`
    );
  }

  // Ensure dispose() exists (even if it delegates to another method)
  if (!hasDispose) {
    Object.defineProperty(candidate, 'dispose', {
      value: () => {
        if (hasDestroy && typeof candidate.destroy === 'function') {
          candidate.destroy();
          return;
        }
        if (hasDisable && typeof candidate.disable === 'function') {
          candidate.disable();
          return;
        }
        if (hasClear && typeof candidate.clear === 'function') {
          candidate.clear();
        }
      },
      writable: true,
      configurable: true,
    });
  }

  console.log(`[SystemRegistry] ✓ Lifecycle contract enforced for "${systemId}"`);
}
