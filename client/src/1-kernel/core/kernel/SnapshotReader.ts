import type { SimulationKernel } from './SimulationKernel';

export class SnapshotReader {
  private readonly kernel: SimulationKernel;

  constructor(kernel: SimulationKernel) {
    this.kernel = kernel;
  }

  getTick(): number {
    return this.kernel.tick;
  }

  getActiveCount(): number {
    return this.kernel.entities.activeCount;
  }

  // Zero-copy: returns direct typed-array view of the active read buffer.
  getPositionBuffer(): Float32Array {
    return this.kernel.positions.getReadBuffer();
  }
}
