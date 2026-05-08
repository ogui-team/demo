export class FrameMemoryArena {
  private readonly buffer: ArrayBuffer;
  private offset = 0;

  constructor(sizeInBytes: number) {
    if (!Number.isInteger(sizeInBytes) || sizeInBytes <= 0) {
      throw new Error('[FrameMemoryArena] sizeInBytes must be a positive integer');
    }
    this.buffer = new ArrayBuffer(sizeInBytes);
    this.offset = 0;
  }

  get capacity(): number {
    return this.buffer.byteLength;
  }

  get usedBytes(): number {
    return this.offset;
  }

  get remainingBytes(): number {
    return this.buffer.byteLength - this.offset;
  }

  allocate(bytes: number, alignment: number = 16): Uint8Array | null {
    if (bytes <= 0) {
      return null;
    }
    const alignedOffset = this.align(this.offset, alignment);
    if (alignedOffset + bytes > this.buffer.byteLength) {
      return null;
    }
    const view = new Uint8Array(this.buffer, alignedOffset, bytes);
    this.offset = alignedOffset + bytes;
    return view;
  }

  allocateFloat32(length: number, alignment: number = 16): Float32Array | null {
    const bytes = length * Float32Array.BYTES_PER_ELEMENT;
    const alignedOffset = this.align(this.offset, alignment);
    if (alignedOffset + bytes > this.buffer.byteLength) {
      return null;
    }
    const view = new Float32Array(this.buffer, alignedOffset, length);
    this.offset = alignedOffset + bytes;
    return view;
  }

  reset(): void {
    this.offset = 0;
  }

  private align(pointer: number, alignment: number): number {
    if (alignment <= 1) {
      return pointer;
    }
    return Math.ceil(pointer / alignment) * alignment;
  }
}
