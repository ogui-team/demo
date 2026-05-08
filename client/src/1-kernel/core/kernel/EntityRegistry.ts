import type { EntityHandle } from './types';

const SLOT_BITS = 20;
const SLOT_MASK = (1 << SLOT_BITS) - 1;

function canonicalizeNetworkEntityId(networkId: string | number): number | null {
  if (typeof networkId === 'number') {
    if (!Number.isFinite(networkId)) {
      return null;
    }
    return Math.trunc(networkId);
  }

  const trimmed = networkId.trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }

  // Stable FNV-1a hash so string network IDs can participate in the numeric kernel registry.
  let hash = 0x811c9dc5;
  for (let index = 0; index < trimmed.length; index += 1) {
    hash ^= trimmed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function encodeHandle(slot: number, generation: number): EntityHandle {
  return ((generation & 0xfff) << SLOT_BITS) | (slot & SLOT_MASK);
}

function decodeSlot(handle: EntityHandle): number {
  return handle & SLOT_MASK;
}

function decodeGeneration(handle: EntityHandle): number {
  return handle >>> SLOT_BITS;
}

export class EntityRegistry {
  private readonly capacity: number;
  private readonly generations: Uint16Array;
  private readonly alive: Uint8Array;
  private readonly denseToSlot: Uint32Array;
  private readonly slotToDense: Int32Array;
  private readonly freeSlots: Uint32Array;
  private readonly networkIdToHandle = new Map<number, EntityHandle>();
  private readonly handleToNetworkId = new Map<EntityHandle, number>();
  private freeCount = 0;
  private activeCountValue = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0 || capacity > SLOT_MASK) {
      throw new Error(`EntityRegistry capacity must be in range 1..${SLOT_MASK}`);
    }
    this.capacity = capacity;
    this.generations = new Uint16Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.denseToSlot = new Uint32Array(capacity);
    this.slotToDense = new Int32Array(capacity);
    this.freeSlots = new Uint32Array(capacity);

    this.slotToDense.fill(-1);
    for (let i = capacity - 1; i >= 0; i -= 1) {
      this.freeSlots[this.freeCount] = i;
      this.freeCount += 1;
    }
  }

  get activeCount(): number {
    return this.activeCountValue;
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  create(): EntityHandle | null {
    if (this.freeCount === 0) {
      return null;
    }
    this.freeCount -= 1;
    const slot = this.freeSlots[this.freeCount];
    const dense = this.activeCountValue;
    this.activeCountValue += 1;

    this.alive[slot] = 1;
    this.slotToDense[slot] = dense;
    this.denseToSlot[dense] = slot;

    return encodeHandle(slot, this.generations[slot]);
  }

  destroy(handle: EntityHandle): boolean {
    const slot = decodeSlot(handle);
    if (!this.isHandleAlive(handle)) {
      return false;
    }

    const dense = this.slotToDense[slot];
    const lastDense = this.activeCountValue - 1;
    if (dense !== lastDense) {
      const movedSlot = this.denseToSlot[lastDense];
      this.denseToSlot[dense] = movedSlot;
      this.slotToDense[movedSlot] = dense;
    }

    this.activeCountValue -= 1;
    this.alive[slot] = 0;
    this.slotToDense[slot] = -1;
    this.generations[slot] = (this.generations[slot] + 1) & 0xfff;
    this.freeSlots[this.freeCount] = slot;
    this.freeCount += 1;

    // Clean up network ID mappings
    const networkId = this.handleToNetworkId.get(handle);
    if (networkId != null) {
      this.networkIdToHandle.delete(networkId);
      this.handleToNetworkId.delete(handle);
    }

    return true;
  }

  isHandleAlive(handle: EntityHandle): boolean {
    const slot = decodeSlot(handle);
    if (slot >= this.capacity) {
      return false;
    }
    return this.alive[slot] === 1 && this.generations[slot] === decodeGeneration(handle);
  }

  getDenseIndex(handle: EntityHandle): number {
    if (!this.isHandleAlive(handle)) {
      return -1;
    }
    return this.slotToDense[decodeSlot(handle)];
  }

  getHandleForDense(denseIndex: number): EntityHandle | null {
    if (denseIndex < 0 || denseIndex >= this.activeCountValue) {
      return null;
    }
    const slot = this.denseToSlot[denseIndex];
    return encodeHandle(slot, this.generations[slot]);
  }

  forEachDense(callback: (denseIndex: number, handle: EntityHandle) => void): void {
    for (let dense = 0; dense < this.activeCountValue; dense += 1) {
      const slot = this.denseToSlot[dense];
      callback(dense, encodeHandle(slot, this.generations[slot]));
    }
  }

  setNetworkId(handle: EntityHandle, networkId: string | number): void {
    if (!this.isHandleAlive(handle)) {
      return;
    }

    const canonicalNetworkId = canonicalizeNetworkEntityId(networkId);
    if (canonicalNetworkId == null) {
      return;
    }

    const previousNetworkId = this.handleToNetworkId.get(handle);
    if (previousNetworkId != null && previousNetworkId !== canonicalNetworkId) {
      this.networkIdToHandle.delete(previousNetworkId);
    }

    const previousHandle = this.networkIdToHandle.get(canonicalNetworkId);
    if (previousHandle != null && previousHandle !== handle) {
      this.handleToNetworkId.delete(previousHandle);
    }

    this.networkIdToHandle.set(canonicalNetworkId, handle);
    this.handleToNetworkId.set(handle, canonicalNetworkId);
  }

  getHandleByNetworkId(networkId: string | number): EntityHandle | null {
    const canonicalNetworkId = canonicalizeNetworkEntityId(networkId);
    if (canonicalNetworkId == null) {
      return null;
    }
    return this.networkIdToHandle.get(canonicalNetworkId) ?? null;
  }

  /**
   * Get entity handle from dense index (DOD buffer index).
   * Used by DOD systems to recover handle from buffer iteration.
   * Returns null if dense index is invalid or entity not alive.
   */
  getHandleByDenseIndex(dense: number): EntityHandle | null {
    if (dense < 0 || dense >= this.activeCountValue) return null;

    const slot = this.denseToSlot[dense];
    if (slot < 0 || slot >= this.capacity) return null;

    if (this.alive[slot] === 0) return null;

    return encodeHandle(slot, this.generations[slot]);
  }
}
