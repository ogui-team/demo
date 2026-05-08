import type { EntityHandle } from '../kernel/types';
import { EntityLifetimeRegistry } from './EntityLifetimeRegistry';
import type { Entity } from '../Entity';

export class RuntimeHandleValidator {
  constructor(private readonly lifetimeRegistry: EntityLifetimeRegistry) {}

  isEntityValid(entityRef: string | EntityHandle | null | undefined): boolean {
    return this.lifetimeRegistry.isEntityValid(entityRef as any);
  }

  resolveEntity(entityRef: string | EntityHandle | null | undefined): Entity | undefined {
    if (entityRef == null) {
      return undefined;
    }
    return this.lifetimeRegistry.resolve(entityRef as any);
  }

  getMetadata(entityId: string) {
    return this.lifetimeRegistry.getMetadata(entityId);
  }
}
