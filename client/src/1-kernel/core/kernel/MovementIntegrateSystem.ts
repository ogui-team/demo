import { EntityRegistry } from './EntityRegistry';
import { VelocityStorage } from './VelocityStorage';
import type { BufferSystem, EntityHandle, KernelCommandConsumer } from './types';

interface MoveCommandPayload {
  handle?: unknown;
  moveX?: unknown;
  moveY?: unknown;
  moveZ?: unknown;
  speed?: unknown;
}

interface MovementIntegrateSystemConfig {
  entityRegistry: EntityRegistry;
  velocityStorage: VelocityStorage;
  resolveHandleByPlayerId?: (playerId: string) => EntityHandle | null;
  isReconciling?: () => boolean;
  defaultSpeed?: number;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export class MovementIntegrateSystem implements BufferSystem {
  readonly id = 'movementIntegrateSystem';

  private readonly entityRegistry: EntityRegistry;
  private readonly velocityStorage: VelocityStorage;
  private readonly resolveHandleByPlayerId?: (playerId: string) => EntityHandle | null;
  private readonly isReconciling: () => boolean;
  private readonly defaultSpeed: number;
  private activeCount = 0;

  constructor(config: MovementIntegrateSystemConfig) {
    this.entityRegistry = config.entityRegistry;
    this.velocityStorage = config.velocityStorage;
    this.resolveHandleByPlayerId = config.resolveHandleByPlayerId;
    this.isReconciling = config.isReconciling ?? (() => false);
    this.defaultSpeed = config.defaultSpeed ?? 6;
  }

  readonly consumeCommand: KernelCommandConsumer = (
    _seq,
    _tick,
    _timestamp,
    _source,
    type,
    playerId,
    payload,
  ) => {
    if (type !== 'MOVE_CMD') {
      return;
    }

    const movePayload = (payload ?? {}) as MoveCommandPayload;
    const explicitHandle = typeof movePayload.handle === 'number' ? movePayload.handle : null;
    const resolvedHandle = explicitHandle
      ?? (playerId && this.resolveHandleByPlayerId ? this.resolveHandleByPlayerId(playerId) : null);

    if (resolvedHandle == null) {
      return;
    }

    const dense = this.entityRegistry.getDenseIndex(resolvedHandle);
    if (dense < 0) {
      return;
    }

    const speed = toFiniteNumber(movePayload.speed, this.defaultSpeed);
    const moveX = toFiniteNumber(movePayload.moveX, 0);
    const moveY = toFiniteNumber(movePayload.moveY, 0);
    const moveZ = toFiniteNumber(movePayload.moveZ, 0);

    this.velocityStorage.setAuthoritativeXYZ(
      dense,
      moveX * speed,
      moveY * speed,
      moveZ * speed,
    );
  };

  setActiveCount(count: number): void {
    this.activeCount = count;
  }

  execute(positionWriteBuffer: Float32Array, dt: number): void {
    // ─ FIX: Don't block movement during reconciliation ─
    // Reconciliation happens at the NETWORK layer (lerp correction),
    // not here. This layer should always integrate velocity.
    // Blocking here causes complete movement freeze if isReconciling
    // gets stuck TRUE (which shouldn't happen, but prevents disaster).
    
    const velocity = this.velocityStorage.getAuthoritativeBuffer();
    const limit = this.activeCount * 3;
    for (let i = 0; i < limit; i += 3) {
      positionWriteBuffer[i] += velocity[i] * dt;
      positionWriteBuffer[i + 1] += velocity[i + 1] * dt;
      positionWriteBuffer[i + 2] += velocity[i + 2] * dt;
    }
  }
}
