import type { Vector3 } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

interface SpatialEntityRecord {
  id: string;
  type: string;
  isActive: boolean;
  lastUsedTime: number;
  getPosition(): Vector3;
}

interface SpatialEntityManagerAdapter {
  getEntities(): SpatialEntityRecord[];
}

export interface SpatialEntry {
  id: string;
  position: Vector3;
  radius: number;
  tags: string[];
  isActive: boolean;
  lastUsedTime: number;
  cellKey: string;
}

export interface SpatialQueryOptions {
  tags?: string[];
  includeInactive?: boolean;
}

function distanceSquared(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export class SpatialPartitionSystem {
  private readonly cellSize: number;
  private readonly entries = new Map<string, SpatialEntry>();
  private readonly cells = new Map<string, Set<string>>();
  private entityManager: SpatialEntityManagerAdapter | null = null;
  private debugDrawEnabled = false;
  private syncAccumulator = 0;
  private readonly syncInterval = 0.1;
  private systemContext: SystemContext | null = null;

  constructor(cellSize: number = 16) {
    this.cellSize = Math.max(1, cellSize);
  }

  bindEntityManager(entityManager: SpatialEntityManagerAdapter): void {
    this.entityManager = entityManager;
    for (const entity of entityManager.getEntities()) {
      this.updateEntry(entity.id, entity.getPosition(), {
        radius: 1,
        tags: [entity.type],
        isActive: entity.isActive,
        lastUsedTime: entity.lastUsedTime,
      });
    }
    gameBus.emit('stateMutation', {
      source: 'spatialPartitionSystem',
      path: 'spatialPartition.entityManager',
      changedCount: 1,
    });
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (!this.entityManager && ctx.entityManager) {
      this.bindEntityManager(ctx.entityManager as SpatialEntityManagerAdapter);
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: true,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: {
        ...this.getDiagnostics(),
        hasEntityManager: this.entityManager !== null,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  updateEntry(id: string, position: Vector3, options: {
    radius?: number;
    tags?: string[];
    isActive?: boolean;
    lastUsedTime?: number;
  } = {}): void {
    const nextCellKey = this.getCellKey(position);
    const existing = this.entries.get(id);
    const isNewEntry = !existing;
    const didCellChange = existing?.cellKey !== nextCellKey;
    if (existing && existing.cellKey !== nextCellKey) {
      this.cells.get(existing.cellKey)?.delete(id);
    }

    const entry: SpatialEntry = {
      id,
      position: { ...position },
      radius: options.radius ?? existing?.radius ?? 1,
      tags: [...(options.tags ?? existing?.tags ?? [])],
      isActive: options.isActive ?? existing?.isActive ?? true,
      lastUsedTime: options.lastUsedTime ?? existing?.lastUsedTime ?? Engine.time.now(),
      cellKey: nextCellKey,
    };
    this.entries.set(id, entry);
    if (!this.cells.has(nextCellKey)) {
      this.cells.set(nextCellKey, new Set());
    }
    this.cells.get(nextCellKey)!.add(id);
    if (isNewEntry || didCellChange) {
      gameBus.emit('stateMutation', {
        source: 'spatialPartitionSystem',
        path: `spatialPartition.entries.${id}`,
        changedCount: 1,
      });
    }
  }

  removeEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.cells.get(entry.cellKey)?.delete(id);
    this.entries.delete(id);
    gameBus.emit('stateMutation', {
      source: 'spatialPartitionSystem',
      path: `spatialPartition.entries.${id}`,
      changedCount: 1,
    });
  }

  setActive(id: string, isActive: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.isActive = isActive;
    entry.lastUsedTime = Engine.time.now();
    gameBus.emit('stateMutation', {
      source: 'spatialPartitionSystem',
      path: `spatialPartition.entries.${id}.active`,
      changedCount: 1,
    });
  }

  markUsed(id: string, timestamp: number = Engine.time.now()): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.lastUsedTime = timestamp;
  }

  queryRadius(center: Vector3, radius: number, options: SpatialQueryOptions = {}): SpatialEntry[] {
    const minX = Math.floor((center.x - radius) / this.cellSize);
    const maxX = Math.floor((center.x + radius) / this.cellSize);
    const minY = Math.floor((center.y - radius) / this.cellSize);
    const maxY = Math.floor((center.y + radius) / this.cellSize);
    const minZ = Math.floor((center.z - radius) / this.cellSize);
    const maxZ = Math.floor((center.z + radius) / this.cellSize);
    const radiusSq = radius * radius;
    const matches: SpatialEntry[] = [];

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const cell = this.cells.get(`${x}:${y}:${z}`);
          if (!cell) continue;
          for (const id of cell) {
            const entry = this.entries.get(id);
            if (!entry) continue;
            if (!options.includeInactive && !entry.isActive) continue;
            if (options.tags && options.tags.length > 0 && !options.tags.some((tag) => entry.tags.includes(tag))) continue;
            if (distanceSquared(center, entry.position) <= radiusSq + entry.radius * entry.radius) {
              matches.push({ ...entry, position: { ...entry.position }, tags: [...entry.tags] });
            }
          }
        }
      }
    }

    return matches;
  }

  getEntitiesInRadius(center: Vector3, radius: number, options: SpatialQueryOptions = {}): SpatialEntry[] {
    return this.queryRadius(center, radius, options);
  }

  getRelevantEntityIds(center: Vector3, radius: number, options: SpatialQueryOptions = {}): string[] {
    return this.queryRadius(center, radius, options).map((entry) => entry.id);
  }

  getInactiveEntityIds(maxIdleMs: number, now: number = Engine.time.now()): string[] {
    const matches: string[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.isActive || now - entry.lastUsedTime >= maxIdleMs) {
        matches.push(entry.id);
      }
    }
    return matches;
  }

  update(dt: number): void {
    this.syncAccumulator += dt;
    if (this.syncAccumulator < this.syncInterval || !this.entityManager) return;
    this.syncAccumulator = 0;

    const liveIds = new Set<string>();
    for (const entity of this.entityManager.getEntities()) {
      liveIds.add(entity.id);
      this.updateEntry(entity.id, entity.getPosition(), {
        radius: this.entries.get(entity.id)?.radius ?? 1,
        tags: this.entries.get(entity.id)?.tags ?? [entity.type],
        isActive: entity.isActive,
        lastUsedTime: entity.lastUsedTime,
      });
    }

    for (const id of [...this.entries.keys()]) {
      if (!liveIds.has(id) && id.startsWith('entity_')) {
        this.removeEntry(id);
      }
    }
  }

  setDebugDrawEnabled(enabled: boolean): void {
    this.debugDrawEnabled = enabled;
    gameBus.emit('stateMutation', {
      source: 'spatialPartitionSystem',
      path: 'spatialPartition.debugDrawEnabled',
      changedCount: 1,
    });
  }

  isDebugDrawEnabled(): boolean {
    return this.debugDrawEnabled;
  }

  getDiagnostics(): Record<string, unknown> {
    let activeEntries = 0;
    let inactiveEntries = 0;
    for (const entry of this.entries.values()) {
      if (entry.isActive) activeEntries += 1;
      else inactiveEntries += 1;
    }

    return {
      cellSize: this.cellSize,
      entryCount: this.entries.size,
      activeCells: this.cells.size,
      activeEntries,
      inactiveEntries,
      debugDrawEnabled: this.debugDrawEnabled,
    };
  }

  private getCellKey(position: Vector3): string {
    const x = Math.floor(position.x / this.cellSize);
    const y = Math.floor(position.y / this.cellSize);
    const z = Math.floor(position.z / this.cellSize);
    return `${x}:${y}:${z}`;
  }
}