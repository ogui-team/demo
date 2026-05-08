import { EntityRegistry } from '../kernel/EntityRegistry';
import type { EntityHandle } from '../kernel/types';

/**
 * HandleAllocator manages generation-based runtime entity handles.
 * It is designed for zero-allocation handle validation and stale-handle detection.
 */
export class HandleAllocator {
  private readonly registry: EntityRegistry;
  private readonly capacity: number;

  constructor(capacity: number = 4096) {
    this.capacity = capacity;
    this.registry = new EntityRegistry(capacity);
  }

  allocate(): EntityHandle {
    const handle = this.registry.create();
    if (handle == null) {
      throw new Error(`[HandleAllocator] exhausted at capacity ${this.capacity}`);
    }
    return handle;
  }

  allocateNullable(): EntityHandle | null {
    return this.registry.create();
  }

  destroy(handle: EntityHandle): boolean {
    return this.registry.destroy(handle);
  }

  isValid(handle: EntityHandle | null | undefined): handle is EntityHandle {
    if (typeof handle !== 'number') {
      return false;
    }
    return this.registry.isHandleAlive(handle);
  }

  getDenseIndex(handle: EntityHandle): number {
    return this.registry.getDenseIndex(handle);
  }

  getHandleByDense(denseIndex: number): EntityHandle | null {
    return this.registry.getHandleForDense(denseIndex);
  }

  setNetworkId(handle: EntityHandle, networkId: string | number): void {
    this.registry.setNetworkId(handle, networkId);
  }

  getHandleByNetworkId(networkId: string | number): EntityHandle | null {
    return this.registry.getHandleByNetworkId(networkId);
  }
}
