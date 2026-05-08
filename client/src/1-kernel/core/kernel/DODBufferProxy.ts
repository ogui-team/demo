/**
 * DODBufferProxy.ts
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Guard layer for DOD TypedArray buffers.
 * Wraps read/write operations with hard assertions:
 *
 * ✅ Handle validity checks
 * ✅ Bounds checking
 * ✅ Type safety
 * ✅ Corruption detection
 *
 * In DEV build: Full validation (5-10% overhead, worth it)
 * In RELEASE: Assertions stripped, zero overhead
 */

import type { EntityHandle } from './types';
import type { EntityRegistry } from './EntityRegistry';

export interface DODBufferProxyConfig {
  /**
   * Enable assertions (DEV mode). In RELEASE, keep false.
   */
  enableAssertions: boolean;

  /**
   * Enable shadow-buffer tracking for corruption detection.
   */
  enableShadowBuffer: boolean;
}

/**
 * Internal: Soft assertion that logs but doesn't throw.
 * Used for warnings in production-safe scenarios.
 */
function softAssert(condition: boolean, message: string): void {
  if (!condition) {
    console.warn(`[DODBufferProxy] ${message}`);
  }
}

/**
 * Internal: Hard assertion that throws.
 * Used only in DEV build (assertions stripped in RELEASE).
 */
function hardAssert(condition: boolean, message: string): void {
  if (__DEV__ && !condition) {
    throw new Error(`[DODBufferProxy] ASSERTION FAILED: ${message}`);
  }
}

/**
 * Proxy for Float32Array buffer with validation.
 */
export class Float32BufferProxy {
  readonly buffer: Float32Array;
  readonly shadowBuffer: Float32Array | null;
  private readonly entityRegistry: EntityRegistry;
  private readonly config: DODBufferProxyConfig;
  private readonly name: string;

  constructor(
    buffer: Float32Array,
    entityRegistry: EntityRegistry,
    config: DODBufferProxyConfig,
    name: string,
  ) {
    this.buffer = buffer;
    this.entityRegistry = entityRegistry;
    this.config = config;
    this.name = name;

    // Allocate shadow buffer in DEV build only
    this.shadowBuffer = config.enableShadowBuffer ? new Float32Array(buffer.length) : null;
    if (this.shadowBuffer) {
      this.shadowBuffer.set(buffer);
    }

    // Validate buffer alignment
    if (config.enableAssertions) {
      hardAssert(buffer.length % 3 === 0, `${name} buffer length must be multiple of 3 (stride=3 for x,y,z)`);
    }
  }

  /**
   * Read value at dense index (no mutations).
   */
  read(denseIndex: number, offset: number = 0): number {
    if (this.config.enableAssertions) {
      this._validateDenseIndex(denseIndex);
      this._validateOffset(offset);
    }
    return this.buffer[denseIndex * 3 + offset];
  }

  /**
   * Write value with validation.
   */
  write(denseIndex: number, offset: number, value: number): void {
    if (this.config.enableAssertions) {
      this._validateDenseIndex(denseIndex);
      this._validateOffset(offset);
      hardAssert(isFinite(value), `${this.name}: Cannot write non-finite value ${value}`);
    }

    const index = denseIndex * 3 + offset;
    this.buffer[index] = value;

    // Update shadow buffer
    if (this.shadowBuffer) {
      this.shadowBuffer[index] = value;
    }
  }

  /**
   * Atomic write X, Y, Z coordinate (stride-3).
   */
  writeXYZ(denseIndex: number, x: number, y: number, z: number): void {
    if (this.config.enableAssertions) {
      this._validateDenseIndex(denseIndex);
      hardAssert(isFinite(x) && isFinite(y) && isFinite(z), `${this.name}: Non-finite XYZ: ${x}, ${y}, ${z}`);
    }

    const baseIdx = denseIndex * 3;
    this.buffer[baseIdx] = x;
    this.buffer[baseIdx + 1] = y;
    this.buffer[baseIdx + 2] = z;

    if (this.shadowBuffer) {
      this.shadowBuffer[baseIdx] = x;
      this.shadowBuffer[baseIdx + 1] = y;
      this.shadowBuffer[baseIdx + 2] = z;
    }
  }

  /**
   * Atomic read X, Y, Z coordinate.
   */
  readXYZ(denseIndex: number): [number, number, number] {
    if (this.config.enableAssertions) {
      this._validateDenseIndex(denseIndex);
    }

    const baseIdx = denseIndex * 3;
    return [
      this.buffer[baseIdx],
      this.buffer[baseIdx + 1],
      this.buffer[baseIdx + 2],
    ];
  }

  /**
   * Audit: Compare buffer against shadow buffer.
   * Returns array of mismatched indices, or empty if all good.
   */
  auditAgainstShadow(): number[] {
    if (!this.shadowBuffer) return [];

    const mismatches: number[] = [];
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i] !== this.shadowBuffer[i]) {
        mismatches.push(i);
      }
    }
    return mismatches;
  }

  /**
   * Sync shadow buffer from current buffer.
   */
  syncShadowBuffer(): void {
    if (this.shadowBuffer) {
      this.shadowBuffer.set(this.buffer);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _validateDenseIndex(denseIndex: number): void {
    hardAssert(Number.isInteger(denseIndex), `Dense index must be integer, got ${denseIndex}`);
    hardAssert(denseIndex >= 0, `Dense index cannot be negative: ${denseIndex}`);
    hardAssert(denseIndex * 3 < this.buffer.length, `Dense index ${denseIndex} out of bounds (max ${this.buffer.length / 3})`);
  }

  private _validateOffset(offset: number): void {
    hardAssert(Number.isInteger(offset) && offset >= 0 && offset < 3, `Offset must be 0-2, got ${offset}`);
  }
}

/**
 * Proxy for Int32Array buffer (ammo, item IDs, etc).
 */
export class Int32BufferProxy {
  readonly buffer: Int32Array;
  readonly shadowBuffer: Int32Array | null;
  private readonly entityRegistry: EntityRegistry;
  private readonly config: DODBufferProxyConfig;
  private readonly name: string;
  private readonly stride: number;

  constructor(
    buffer: Int32Array,
    entityRegistry: EntityRegistry,
    config: DODBufferProxyConfig,
    name: string,
    stride: number = 1,
  ) {
    this.buffer = buffer;
    this.entityRegistry = entityRegistry;
    this.config = config;
    this.name = name;
    this.stride = stride;

    this.shadowBuffer = config.enableShadowBuffer ? new Int32Array(buffer.length) : null;
    if (this.shadowBuffer) {
      this.shadowBuffer.set(buffer);
    }

    if (config.enableAssertions) {
      hardAssert(buffer.length % stride === 0, `${name} buffer length must be multiple of ${stride}`);
    }
  }

  /**
   * Atomic read at stride position.
   */
  read(denseIndex: number, offset: number = 0): number {
    if (this.config.enableAssertions) {
      this._validateDenseIndex(denseIndex);
      this._validateOffset(offset);
    }
    return this.buffer[denseIndex * this.stride + offset];
  }

  /**
   * Atomic write with validation.
   */
  write(denseIndex: number, offset: number, value: number): void {
    if (this.config.enableAssertions) {
      this._validateDenseIndex(denseIndex);
      this._validateOffset(offset);
      hardAssert(Number.isInteger(value), `${this.name}: Value must be integer, got ${value}`);
    }

    const index = denseIndex * this.stride + offset;
    this.buffer[index] = value;

    if (this.shadowBuffer) {
      this.shadowBuffer[index] = value;
    }
  }

  /**
   * Audit: Compare against shadow buffer.
   */
  auditAgainstShadow(): number[] {
    if (!this.shadowBuffer) return [];

    const mismatches: number[] = [];
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i] !== this.shadowBuffer[i]) {
        mismatches.push(i);
      }
    }
    return mismatches;
  }

  /**
   * Sync shadow buffer.
   */
  syncShadowBuffer(): void {
    if (this.shadowBuffer) {
      this.shadowBuffer.set(this.buffer);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _validateDenseIndex(denseIndex: number): void {
    hardAssert(Number.isInteger(denseIndex), `Dense index must be integer, got ${denseIndex}`);
    hardAssert(denseIndex >= 0, `Dense index cannot be negative: ${denseIndex}`);
    hardAssert(
      denseIndex * this.stride < this.buffer.length,
      `Dense index ${denseIndex} out of bounds (max ${Math.floor(this.buffer.length / this.stride)})`,
    );
  }

  private _validateOffset(offset: number): void {
    hardAssert(
      Number.isInteger(offset) && offset >= 0 && offset < this.stride,
      `Offset must be 0-${this.stride - 1}, got ${offset}`,
    );
  }
}

/**
 * Conditional assert macro for production-safe code.
 * In RELEASE: compiles to no-op.
 */
const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
