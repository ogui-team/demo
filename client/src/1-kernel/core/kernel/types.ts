export type EntityHandle = number;

export type SimulationCommandSource = 'freeplay' | 'editor' | 'multiplayer' | 'server' | 'automation' | 'system' | 'test';

export interface KernelCommand {
  seq: number;
  tick: number;
  timestamp: number;
  source: SimulationCommandSource;
  type: string;
  playerId: string | null;
  payload: Record<string, unknown> | null;
}

export interface KernelCommandConsumer {
  (
    seq: number,
    tick: number,
    timestamp: number,
    source: SimulationCommandSource,
    type: string,
    playerId: string | null,
    payload: Record<string, unknown> | null,
  ): void;
}

export interface BufferSystem {
  readonly id: string;
  setActiveCount?(count: number): void;
  execute(buffer: Float32Array, dt: number): void;
}

export interface KernelSystem {
  readonly id: string;
  update(dt: number): void;
}

/**
 * System Classification for Domain-Driven Migration.
 * Determines where a system executes in the architecture.
 */
export enum SystemCategory {
  /** Deterministic DOD system executing on TypedArray buffers within kernel ticks. */
  KERNEL = 'kernel',
  /** Event-driven system reacting to game events; reads snapshots but doesn't mutate buffers directly. */
  BRIDGE = 'bridge',
  /** Legacy system; maintained for now, reads buffers but independent of kernel ticks. */
  LEGACY_ADAPTER = 'legacy_adapter',
}

/**
 * Interface for systems that execute within the kernel tick loop.
 * These systems operate directly on TypedArray buffers and must be deterministic.
 */
export interface IKernelSystem {
  readonly id: string;
  readonly category: SystemCategory.KERNEL;
  /** Called once per kernel tick. dt is fixed frame delta. */
  execute(dt: number): void;
  /** Notify system of active entity count for buffer iteration bounds. */
  setActiveCount?(count: number): void;
}

export interface AuthoritativeSnapshot {
  entities: Array<{
    networkEntityId: number | string;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
  }>;
}
