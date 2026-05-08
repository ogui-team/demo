/**
 * BaselineCapture.ts
 * ═════════════════════════════════════════════════════════════════════════════
 * Expose kernel state for headless baseline capture.
 * 
 * Complexity: O(1) snapshot capture (all buffers pre-allocated)
 * Used by: headless browsers during PHASE 0: Baseline Lock
 */

import { SimulationKernel } from '../../1-kernel/core/kernel/SimulationKernel';
import { KernelStateHash } from '../../1-kernel/core/kernel/KernelStateHash';

export interface BaselineCaptureState {
  tick: number;
  stateHash: number;
  tickedHash: string;
  activeEntities: number;
}

export interface MemorySnapshot {
  entityRegistry: {
    generations: number[];
    alive: number[];
    denseToSlot: number[];
    slotToDense: number[];
    freeSlots: number[];
  };
  positionStorage: {
    readPage: number[];
    writePage: number[];
    authReadPage: number[];
    authWritePage: number[];
  };
  velocityStorage: {
    values: number[];
    authValues: number[];
  };
  healthStorage: {
    healthValues: number[];
    maxHealthValues: number[];
  };
  inventoryStorage: {
    ammoValues: number[];
    itemIdValues: number[];
  };
}

export interface CRC32HashChain {
  entityRegistryAliveHash: string;
  positionReadPageHash: string;
  velocityHash: string;
  healthHash: string;
  inventoryHash: string;
  combinedStateHash: string;
}

/**
 * Capture current kernel state for baseline freezing
 */
export class BaselineCapture {
  private kernel: SimulationKernel;
  private tickCounter = 0;

  constructor(kernel: SimulationKernel) {
    this.kernel = kernel;
  }

  /**
   * Capture CRC32 hash for current frame
   * Complexity: O(N) where N = buffer size (210,944 bytes = constant)
   */
  captureCRC32(): BaselineCaptureState {
    this.tickCounter++;

    // Extract buffers from kernel
    const aliveBuffer = this.kernel.entities['alive'] as Uint8Array;
    const posBuffer = this.kernel.positions.getReadBuffer() as Float32Array;
    const velBuffer = this.kernel.velocities.getBuffer() as Float32Array;
    const healthBuffer = this.kernel.healths.getHealthBuffer() as Float32Array;
    const ammoBuffer = this.kernel.inventories.getAmmoBuffer() as Uint32Array;

    // Compute CRC32 hash chain
    const h1 = KernelStateHash.computeBufferHash(
      new Uint32Array(aliveBuffer.buffer, aliveBuffer.byteOffset, aliveBuffer.byteLength / 4)
    );
    const h2 = KernelStateHash.computeBufferHash(posBuffer);
    const h3 = KernelStateHash.computeBufferHash(velBuffer);
    const h4 = KernelStateHash.computeBufferHash(healthBuffer);
    const h5 = KernelStateHash.computeBufferHash(ammoBuffer);

    const combined = (h1 ^ h2 ^ h3 ^ h4 ^ h5) >>> 0;
    const tickedHash = KernelStateHash.computeTickedHash(combined, this.tickCounter);

    return {
      tick: this.tickCounter,
      stateHash: combined,
      tickedHash,
      activeEntities: this.kernel.entities.activeCount,
    };
  }

  /**
   * Dump entire memory state for baseline snapshot
   * Complexity: O(N) where N = buffer size (constant, 210,944 bytes)
   */
  dumpMemoryState(): {
    memorySnapshot: MemorySnapshot;
    crc32Hash: CRC32HashChain;
  } {
    // EntityRegistry
    const regAlive = this.kernel.entities['alive'] as Uint8Array;
    const regDenseToSlot = this.kernel.entities['denseToSlot'] as Uint32Array;
    const regSlotToDense = this.kernel.entities['slotToDense'] as Int32Array;
    const regGenerations = this.kernel.entities['generations'] as Uint16Array;
    const regFreeSlots = this.kernel.entities['freeSlots'] as Uint32Array;

    // Positions (dual-page)
    const posRead = this.kernel.positions.getReadBuffer();
    const posWrite = this.kernel.positions.getWriteBuffer();
    const posAuthRead = this.kernel.positions.getAuthoritativeReadBuffer();

    // Velocities
    const velValues = this.kernel.velocities.getBuffer();
    const velAuthValues = this.kernel.velocities.getAuthoritativeBuffer();

    // Health
    const healthValues = this.kernel.healths.getHealthBuffer();
    const maxHealthValues = this.kernel.healths.getMaxHealthBuffer();

    // Inventory
    const ammoValues = this.kernel.inventories.getAmmoBuffer();
    const itemIdValues = this.kernel.inventories.getItemIdBuffer();

    // Compute CRC32 hashes
    const h1 = KernelStateHash.computeBufferHash(
      new Uint32Array(regAlive.buffer, regAlive.byteOffset, regAlive.byteLength / 4)
    ).toString(16).padStart(8, '0');
    const h2 = KernelStateHash.computeBufferHash(posRead).toString(16).padStart(8, '0');
    const h3 = KernelStateHash.computeBufferHash(velValues).toString(16).padStart(8, '0');
    const h4 = KernelStateHash.computeBufferHash(healthValues).toString(16).padStart(8, '0');
    const h5 = KernelStateHash.computeBufferHash(ammoValues).toString(16).padStart(8, '0');
    const combined = ((parseInt(h1, 16) ^ parseInt(h2, 16) ^ parseInt(h3, 16) ^ parseInt(h4, 16) ^ parseInt(h5, 16)) >>> 0).toString(16).padStart(8, '0');

    return {
      memorySnapshot: {
        entityRegistry: {
          generations: Array.from(regGenerations),
          alive: Array.from(regAlive),
          denseToSlot: Array.from(regDenseToSlot),
          slotToDense: Array.from(regSlotToDense),
          freeSlots: Array.from(regFreeSlots),
        },
        positionStorage: {
          readPage: Array.from(posRead),
          writePage: Array.from(posWrite),
          authReadPage: Array.from(posAuthRead),
          authWritePage: Array.from(posAuthRead), // Use authReadPage (same as write page after publish)
        },
        velocityStorage: {
          values: Array.from(velValues),
          authValues: Array.from(velAuthValues),
        },
        healthStorage: {
          healthValues: Array.from(healthValues),
          maxHealthValues: Array.from(maxHealthValues),
        },
        inventoryStorage: {
          ammoValues: Array.from(ammoValues),
          itemIdValues: Array.from(itemIdValues),
        },
      },
      crc32Hash: {
        entityRegistryAliveHash: `0x${h1}`,
        positionReadPageHash: `0x${h2}`,
        velocityHash: `0x${h3}`,
        healthHash: `0x${h4}`,
        inventoryHash: `0x${h5}`,
        combinedStateHash: `0x${combined}`,
      },
    };
  }

  /**
   * Reset tick counter
   */
  reset(): void {
    this.tickCounter = 0;
  }
}

/**
 * Global exposure for headless capture
 */
declare global {
  interface Window {
    __KERNEL_INITIALIZED: boolean;
    __CAPTURE_CRC32: () => BaselineCaptureState;
    __DUMP_MEMORY_STATE: () => {
      memorySnapshot: MemorySnapshot;
      crc32Hash: CRC32HashChain;
    };
    __BASELINE_CAPTURE?: BaselineCapture;
  }
}

export function exposeBaselineCapture(kernel: SimulationKernel): void {
  const capture = new BaselineCapture(kernel);
  window.__BASELINE_CAPTURE = capture;
  window.__CAPTURE_CRC32 = () => capture.captureCRC32();
  window.__DUMP_MEMORY_STATE = () => capture.dumpMemoryState();
  window.__KERNEL_INITIALIZED = true;
}
