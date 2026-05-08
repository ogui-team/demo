export class VelocityStorage {
  private readonly capacity: number;
  private readonly values: Float32Array;
  private readonly authoritativeValues: Float32Array;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('VelocityStorage capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.values = new Float32Array(capacity * 3);
    this.authoritativeValues = new Float32Array(capacity * 3);
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  getBuffer(): Float32Array {
    return this.values;
  }

  setXYZ(denseIndex: number, x: number, y: number, z: number): void {
    const base = denseIndex * 3;
    this.values[base] = x;
    this.values[base + 1] = y;
    this.values[base + 2] = z;
  }

  clear(activeCount: number): void {
    this.values.fill(0, 0, activeCount * 3);
  }

  getAuthoritativeBuffer(): Float32Array {
    return this.authoritativeValues;
  }

  setAuthoritativeXYZ(denseIndex: number, x: number, y: number, z: number): void {
    const base = denseIndex * 3;
    this.authoritativeValues[base] = x;
    this.authoritativeValues[base + 1] = y;
    this.authoritativeValues[base + 2] = z;
  }
}
