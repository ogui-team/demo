import { ObjectPool, gameBus, type GameEvents, type SystemCapabilities, type SystemContext } from '@engine/1-kernel/core/public-api';

type RuntimeEventKey = keyof GameEvents;
export type RuntimeEventPriorityTier = 'critical_lifecycle' | 'gameplay' | 'telemetry_debug';

interface RuntimeEventQueueOptions {
  capacity?: number;
  initialPoolSize?: number;
  maxDispatchPerUpdate?: number;
}

export interface RuntimeEventEnqueueOptions {
  chunkId?: string | null;
  entityId?: string | null;
  tier?: RuntimeEventPriorityTier;
}

export interface RuntimeEventSink {
  enqueue<K extends RuntimeEventKey>(type: K, payload: GameEvents[K], options?: RuntimeEventEnqueueOptions): boolean;
  clearChunk(chunkId: string): void;
}

class QueuedRuntimeEvent {
  isActive = false;
  type: RuntimeEventKey | null = null;
  payload: GameEvents[RuntimeEventKey] | null = null;
  chunkId: string | null = null;
  entityId: string | null = null;
  tier: RuntimeEventPriorityTier = 'gameplay';
  timestamp = 0;
  cancelled = false;

  reset(): void {
    this.type = null;
    this.payload = null;
    this.chunkId = null;
    this.entityId = null;
    this.tier = 'gameplay';
    this.timestamp = 0;
    this.cancelled = false;
  }
}

export class RuntimeEventQueue implements RuntimeEventSink {
  private readonly capacity: number;
  private readonly maxDispatchPerUpdate: number;
  private readonly eventPool: ObjectPool<QueuedRuntimeEvent>;
  private readonly criticalLifecycleQueue: QueuedRuntimeEvent[] = [];
  private readonly gameplayQueue: QueuedRuntimeEvent[] = [];
  private readonly telemetryQueue: QueuedRuntimeEvent[] = [];
  private systemContext: SystemContext | null = null;
  private enqueuedCount = 0;
  private drainedCount = 0;
  private droppedGameplayCount = 0;
  private droppedTelemetryCount = 0;
  private criticalOverflowDispatchCount = 0;
  private peakQueueSize = 0;
  private lastDrainCount = 0;
  private lastDrainedAt = 0;
  private dispatchDepth = 0;

  constructor(options: RuntimeEventQueueOptions = {}) {
    this.capacity = Math.max(32, options.capacity ?? 512);
    this.maxDispatchPerUpdate = Math.max(1, options.maxDispatchPerUpdate ?? 64);
    this.eventPool = new ObjectPool(() => new QueuedRuntimeEvent(), {
      initialSize: Math.max(16, options.initialPoolSize ?? 128),
      reset: (event) => event.reset(),
    });
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  enqueue<K extends RuntimeEventKey>(type: K, payload: GameEvents[K], options: RuntimeEventEnqueueOptions = {}): boolean {
    const tier = options.tier ?? classifyRuntimeEventPriority(type);
    if (this.getQueueSize() >= this.capacity) {
      if (tier === 'critical_lifecycle') {
        if (!this.tryEvictLowerPriorityEvent()) {
          this.criticalOverflowDispatchCount += 1;
          console.warn('[RuntimeEventQueue] Critical lifecycle event overflowed queue; dispatching immediately', { type });
          gameBus.emit(type, payload);
          return true;
        }
      } else if (tier === 'gameplay') {
        if (!this.tryEvictTelemetryEvent()) {
          this.droppedGameplayCount += 1;
          return false;
        }
      } else {
        this.droppedTelemetryCount += 1;
        return false;
      }
    }

    const event = this.eventPool.acquire();
    event.type = type;
    event.payload = payload as GameEvents[RuntimeEventKey];
    event.chunkId = options.chunkId ?? null;
    event.entityId = options.entityId ?? null;
    event.tier = tier;
    event.timestamp = Engine.time.now();
    event.cancelled = false;

    this.getQueueForTier(tier).push(event);
    this.enqueuedCount += 1;
    this.peakQueueSize = Math.max(this.peakQueueSize, this.getQueueSize());
    return true;
  }

  clearChunk(chunkId: string): void {
    if (!chunkId || this.getQueueSize() === 0) {
      return;
    }

    for (const queue of this.getAllQueues()) {
      for (const event of queue) {
        if (!event || event.chunkId !== chunkId) {
          continue;
        }
        event.cancelled = true;
      }
    }
  }

  update(_dt: number): void {
    this.drain(this.maxDispatchPerUpdate);
  }

  drain(limit = this.maxDispatchPerUpdate): number {
    if (this.dispatchDepth > 0 || this.getQueueSize() === 0) {
      return 0;
    }

    this.dispatchDepth += 1;
    let drained = 0;

    try {
      while (this.getQueueSize() > 0 && drained < limit) {
        const event = this.dequeueNextEvent();

        if (!event) {
          continue;
        }

        if (!event.cancelled && event.type) {
          gameBus.emit(event.type, event.payload as GameEvents[typeof event.type]);
          drained += 1;
        }

        this.eventPool.release(event);
      }
    } finally {
      this.dispatchDepth -= 1;
    }

    this.drainedCount += drained;
    this.lastDrainCount = drained;
    this.lastDrainedAt = Engine.time.now();
    return drained;
  }

  getQueueSize(): number {
    return this.criticalLifecycleQueue.length + this.gameplayQueue.length + this.telemetryQueue.length;
  }

  getDiagnostics(): Record<string, unknown> {
    const poolStats = this.eventPool.getStats();
    return {
      queueSize: this.getQueueSize(),
      peakQueueSize: this.peakQueueSize,
      enqueuedCount: this.enqueuedCount,
      drainedCount: this.drainedCount,
      droppedGameplayCount: this.droppedGameplayCount,
      droppedTelemetryCount: this.droppedTelemetryCount,
      criticalOverflowDispatchCount: this.criticalOverflowDispatchCount,
      lastDrainCount: this.lastDrainCount,
      lastDrainedAt: this.lastDrainedAt,
      criticalLifecycleQueueSize: this.criticalLifecycleQueue.length,
      gameplayQueueSize: this.gameplayQueue.length,
      telemetryQueueSize: this.telemetryQueue.length,
      poolActive: poolStats.active,
      poolAvailable: poolStats.available,
      poolTotal: poolStats.total,
    };
  }

  getDebugState(): Record<string, unknown> {
    const queueSize = this.getQueueSize();
    return {
      status: queueSize > 0 ? 'active' : 'idle',
      active: queueSize > 0,
      metrics: {
        ...this.getDiagnostics(),
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  dispose(): void {
    for (const queue of this.getAllQueues()) {
      while (queue.length > 0) {
        const event = queue.shift();
        if (event) {
          this.eventPool.release(event);
        }
      }
    }
  }

  private dequeueNextEvent(): QueuedRuntimeEvent | null {
    for (const queue of this.getAllQueues()) {
      const event = queue.shift();
      if (event) {
        return event;
      }
    }
    return null;
  }

  private getQueueForTier(tier: RuntimeEventPriorityTier): QueuedRuntimeEvent[] {
    switch (tier) {
      case 'critical_lifecycle':
        return this.criticalLifecycleQueue;
      case 'telemetry_debug':
        return this.telemetryQueue;
      case 'gameplay':
      default:
        return this.gameplayQueue;
    }
  }

  private getAllQueues(): QueuedRuntimeEvent[][] {
    return [this.criticalLifecycleQueue, this.gameplayQueue, this.telemetryQueue];
  }

  private tryEvictLowerPriorityEvent(): boolean {
    return this.tryEvictTelemetryEvent() || this.tryEvictGameplayEvent();
  }

  private tryEvictTelemetryEvent(): boolean {
    const event = this.telemetryQueue.shift();
    if (!event) {
      return false;
    }
    this.droppedTelemetryCount += 1;
    this.eventPool.release(event);
    return true;
  }

  private tryEvictGameplayEvent(): boolean {
    const event = this.gameplayQueue.shift();
    if (!event) {
      return false;
    }
    this.droppedGameplayCount += 1;
    this.eventPool.release(event);
    return true;
  }
}

function classifyRuntimeEventPriority(type: RuntimeEventKey): RuntimeEventPriorityTier {
  switch (type) {
    case 'CHUNK_LOADED':
    case 'CHUNK_UNLOADED':
      return 'critical_lifecycle';
    case 'RUNTIME_SIMULATION_BUDGET':
      return 'telemetry_debug';
    default:
      return 'gameplay';
  }
}
