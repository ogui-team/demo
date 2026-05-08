import { ObjectPool } from '../../ObjectPool';

export class ScratchBufferPool {
  private readonly pool: ObjectPool<Uint8Array>;
  private readonly bufferSize: number;

  constructor(bufferSize: number = 4096, initialCapacity: number = 16) {
    this.bufferSize = bufferSize;
    this.pool = new ObjectPool<Uint8Array>(() => new Uint8Array(this.bufferSize), {
      initialSize: initialCapacity,
      onAcquire: (buffer) => buffer.fill(0),
      onRelease: (buffer) => buffer.fill(0),
    });
  }

  acquire(): Uint8Array {
    return this.pool.acquire();
  }

  release(buffer: Uint8Array): void {
    if (buffer.byteLength !== this.bufferSize) {
      // Only pool buffers of the same size.
      return;
    }
    this.pool.release(buffer);
  }

  getStats() {
    return this.pool.getStats();
  }
}
