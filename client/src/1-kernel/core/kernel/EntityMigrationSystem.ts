import { EntityRegistry } from './EntityRegistry';
import { ComponentMapper } from './ComponentMapper';
import type { EntityHandle, KernelCommandConsumer } from './types';
import { gameBus } from '../EventBus';
import type { GameEvents } from '../types';

interface MigrateEntityCommandPayload {
  entityId?: number;
  targetPrefab?: string;
  statePreservationMask?: number;
}

interface EntityMigrationSystemConfig {
  entityRegistry: EntityRegistry;
  componentMapper: ComponentMapper;
  createEntityForPrefab: (prefabName: string) => EntityHandle | null;
}

export class EntityMigrationSystem {
  private readonly entityRegistry: EntityRegistry;
  private readonly componentMapper: ComponentMapper;
  private readonly createEntityForPrefab: (prefabName: string) => EntityHandle | null;

  constructor(config: EntityMigrationSystemConfig) {
    this.entityRegistry = config.entityRegistry;
    this.componentMapper = config.componentMapper;
    this.createEntityForPrefab = config.createEntityForPrefab;
  }

  readonly consumeCommand: KernelCommandConsumer = (
    _seq,
    _tick,
    _timestamp,
    _source,
    type,
    _playerId,
    payload,
  ) => {
    if (type !== 'MIGRATE_ENTITY_CMD') {
      return;
    }

    const migratePayload = (payload ?? {}) as MigrateEntityCommandPayload;
    const entityId = migratePayload.entityId;
    const targetPrefab = migratePayload.targetPrefab;
    const mask = migratePayload.statePreservationMask ?? 31; // Default all

    if (!entityId || !targetPrefab) {
      console.error('EntityMigrationSystem: Missing entityId or targetPrefab');
      return;
    }

    const oldHandle = this.entityRegistry.getHandleByNetworkId(entityId);
    if (!oldHandle) {
      console.error(`EntityMigrationSystem: No handle for entityId ${entityId}`);
      return;
    }

    const oldDense = this.entityRegistry.getDenseIndex(oldHandle);
    if (oldDense < 0) {
      console.error(`EntityMigrationSystem: Invalid old handle for entityId ${entityId}`);
      return;
    }

    // Create new entity
    const newHandle = this.createEntityForPrefab(targetPrefab);
    if (!newHandle) {
      console.error(`EntityMigrationSystem: Failed to create entity for prefab ${targetPrefab}`);
      return;
    }

    const newDense = this.entityRegistry.getDenseIndex(newHandle);
    if (newDense < 0) {
      console.error(`EntityMigrationSystem: Invalid new handle for prefab ${targetPrefab}`);
      return;
    }

    // Copy components
    const success = this.componentMapper.copyComponents(oldDense, newDense, mask);
    if (!success) {
      console.error('EntityMigrationSystem: Component copy failed');
      // Destroy new entity
      this.entityRegistry.destroy(newHandle);
      return;
    }

    // Set network ID to new handle
    this.entityRegistry.setNetworkId(newHandle, entityId);

    // Destroy old handle
    this.entityRegistry.destroy(oldHandle);

    // Emit event with explicit type assertion
    const eventPayload: GameEvents['MIGRATE_COMPLETE'] = {
      oldEntityId: String(entityId ?? ''),
      newEntityId: String(entityId ?? ''),
      prefabName: String(targetPrefab ?? ''),
      success: true,
    };
    gameBus.emit('MIGRATE_COMPLETE', eventPayload);
  };
}