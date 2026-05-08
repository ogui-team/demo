/**
 * KernelStateHash.ts
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Deterministic state hash computation over DOD kernel buffers.
 * Enables bit-exact replication protocol: server sends hash, client validates.
 *
 * If hashes diverge: we know the EXACT tick where multiplayer desynced.
 * No guessing, no "why did the enemy teleport" mystery.
 *
 * Uses CRC32 for speed (not cryptographic security, just bit-exact matching).
 */

export class KernelStateHash {
  /**
   * Compute CRC32 hash over a UInt32Array buffer.
   * Returns 32-bit unsigned integer.
   */
  static computeBufferHash(buffer: Uint32Array | Float32Array): number {
    let hash = 0xffffffff;

    const uint32View = buffer instanceof Uint32Array 
      ? buffer 
      : new Uint32Array((buffer as any).buffer, (buffer as any).byteOffset, (buffer as any).byteLength / 4);

    for (let i = 0; i < uint32View.length; i++) {
      const byte1 = uint32View[i] & 0xff;
      const byte2 = (uint32View[i] >> 8) & 0xff;
      const byte3 = (uint32View[i] >> 16) & 0xff;
      const byte4 = (uint32View[i] >> 24) & 0xff;

      hash = this._crc32Byte(hash, byte1);
      hash = this._crc32Byte(hash, byte2);
      hash = this._crc32Byte(hash, byte3);
      hash = this._crc32Byte(hash, byte4);
    }

    return (hash ^ 0xffffffff) >>> 0;
  }

  /**
   * Compute combined hash over all DOD kernel buffers.
   * Order matters: always hash in the same sequence.
   */
  static computeKernelHash(
    entityHandles: Uint32Array,
    positionBuffer: Float32Array,
    velocityBuffer: Float32Array,
    healthBuffer: Float32Array,
    ammoBuffer: Int32Array,
  ): number {
    let combined = 0;

    // Hash each buffer and XOR together for final hash
    const h1 = this.computeBufferHash(entityHandles);
    const h2 = this.computeBufferHash(positionBuffer);
    const h3 = this.computeBufferHash(velocityBuffer);
    const h4 = this.computeBufferHash(healthBuffer);
    const h5 = this.computeBufferHash(new Uint32Array(ammoBuffer.buffer, ammoBuffer.byteOffset, ammoBuffer.byteLength / 4));

    // XOR all hashes together
    combined = h1 ^ h2 ^ h3 ^ h4 ^ h5;

    return combined >>> 0;
  }

  /**
   * Create a "snapshot hash" that includes tick counter.
   * This prevents tick-wrap-around hash collisions.
   */
  static computeTickedHash(stateHash: number, tick: number): string {
    const hex = stateHash.toString(16).padStart(8, '0');
    const tickHex = tick.toString(16).padStart(8, '0');
    return `${tickHex}:${hex}`;
  }

  /**
   * Compare two ticked hashes for equality.
   */
  static hashesEqual(hash1: string, hash2: string): boolean {
    return hash1 === hash2;
  }

  /**
   * Extract tick from ticked hash string.
   */
  static extractTick(tickedHash: string): number {
    const [tickStr] = tickedHash.split(':');
    return parseInt(tickStr, 16);
  }

  /**
   * Extract state hash from ticked hash string.
   */
  static extractStateHash(tickedHash: string): number {
    const [, hashStr] = tickedHash.split(':');
    return parseInt(hashStr, 16);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * CRC32 polynomial byte update.
   * Standard CRC32 implementation for deterministic hashing.
   */
  private static _crc32Byte(crc: number, byte: number): number {
    let result = crc ^ byte;
    for (let i = 0; i < 8; i++) {
      if (result & 1) {
        result = (result >>> 1) ^ 0xedb88320;
      } else {
        result = result >>> 1;
      }
    }
    return result >>> 0;
  }
}

/**
 * Protocol contract: serializable hash reference for network transmission.
 */
export interface KernelHashReference {
  tick: number;
  stateHash: number;
  timestamp: number;
}

/**
 * Hash comparison result for diagnostics.
 */
export interface HashMismatchDiagnostic {
  tick: number;
  expected: number;
  actual: number;
  buffersDiverged: string[]; // Which buffers don't match
  lastValidHash: KernelHashReference | null;
}
