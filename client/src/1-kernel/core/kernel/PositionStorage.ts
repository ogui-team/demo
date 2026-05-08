export class PositionStorage {
  private readonly capacity: number;
  private readonly readPage: Float32Array;
  private readonly writePage: Float32Array;
  private reader: Float32Array;
  private writer: Float32Array;
  private readonly authoritativeReadPage: Float32Array;
  private readonly authoritativeWritePage: Float32Array;
  private authoritativeReader: Float32Array;
  private authoritativeWriter: Float32Array;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('PositionStorage capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.readPage = new Float32Array(capacity * 3);
    this.writePage = new Float32Array(capacity * 3);
    this.reader = this.readPage;
    this.writer = this.writePage;
    this.authoritativeReadPage = new Float32Array(capacity * 3);
    this.authoritativeWritePage = new Float32Array(capacity * 3);
    this.authoritativeReader = this.authoritativeReadPage;
    this.authoritativeWriter = this.authoritativeWritePage;
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  getReadBuffer(): Float32Array {
    return this.reader;
  }

  getWriteBuffer(): Float32Array {
    return this.writer;
  }

  setWriteXYZ(denseIndex: number, x: number, y: number, z: number): void {
    const base = denseIndex * 3;
    this.writer[base] = x;
    this.writer[base + 1] = y;
    this.writer[base + 2] = z;
  }

  copyReadToWrite(activeCount: number): void {
    this.writer.set(this.reader.subarray(0, activeCount * 3), 0);
  }

  publish(): void {
    const nextReader = this.writer;
    this.writer = this.reader;
    this.reader = nextReader;
  }

  getAuthoritativeReadBuffer(): Float32Array {
    return this.authoritativeReader;
  }

  setAuthoritativeWriteXYZ(denseIndex: number, x: number, y: number, z: number): void {
    const base = denseIndex * 3;
    this.authoritativeWriter[base] = x;
    this.authoritativeWriter[base + 1] = y;
    this.authoritativeWriter[base + 2] = z;
  }

  copyAuthoritativeReadToWrite(activeCount: number): void {
    this.writer.set(this.authoritativeReader.subarray(0, activeCount * 3), 0);
  }

  publishAuthoritative(): void {
    const nextReader = this.authoritativeWriter;
    this.authoritativeWriter = this.authoritativeReader;
    this.authoritativeReader = nextReader;
  }
}
