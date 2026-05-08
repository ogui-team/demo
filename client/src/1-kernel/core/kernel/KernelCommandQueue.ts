import type { KernelCommandConsumer, SimulationCommandSource } from './types';

export class KernelCommandQueue {
  private readonly capacity: number;
  private readonly seq: Int32Array;
  private readonly tick: Int32Array;
  private readonly timestamp: Float64Array;
  private readonly source: SimulationCommandSource[];
  private readonly type: string[];
  private readonly playerId: Array<string | null>;
  private readonly payload: Array<Record<string, unknown> | null>;

  private head = 0;
  private tail = 0;
  private size = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('KernelCommandQueue capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.seq = new Int32Array(capacity);
    this.tick = new Int32Array(capacity);
    this.timestamp = new Float64Array(capacity);
    this.source = new Array<SimulationCommandSource>(capacity);
    this.type = new Array<string>(capacity);
    this.playerId = new Array<string | null>(capacity);
    this.payload = new Array<Record<string, unknown> | null>(capacity);
  }

  get length(): number {
    return this.size;
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  enqueue(
    seq: number,
    tick: number,
    timestamp: number,
    source: SimulationCommandSource,
    type: string,
    playerId: string | null,
    payload: Record<string, unknown> | null,
  ): boolean {
    if (this.size >= this.capacity) {
      return false;
    }

    const index = this.tail;
    this.seq[index] = seq;
    this.tick[index] = tick;
    this.timestamp[index] = timestamp;
    this.source[index] = source;
    this.type[index] = type;
    this.playerId[index] = playerId;
    this.payload[index] = payload;

    this.tail = (this.tail + 1) % this.capacity;
    this.size += 1;
    return true;
  }

  drain(consumer: KernelCommandConsumer): number {
    let drained = 0;
    while (this.size > 0) {
      const index = this.head;
      consumer(
        this.seq[index],
        this.tick[index],
        this.timestamp[index],
        this.source[index],
        this.type[index],
        this.playerId[index],
        this.payload[index],
      );

      this.payload[index] = null;
      this.playerId[index] = null;

      this.head = (this.head + 1) % this.capacity;
      this.size -= 1;
      drained += 1;
    }
    return drained;
  }
}
