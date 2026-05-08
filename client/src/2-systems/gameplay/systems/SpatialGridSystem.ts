import * as THREE from 'three';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type {
  Entity,
  EntityManager,
  EntityRenderer,
  SystemCapabilities,
  SystemContext,
  Vector3,
} from '@engine/1-kernel/core/public-api';

export interface SpatialCellBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SpatialCell {
  id: string;
  bounds: SpatialCellBounds;
  entities: Set<string>;
  visible: boolean;
  active: boolean;
  frustumBounds: THREE.Box3;
}

interface SpatialGridOptions {
  cellSize?: number;
  verticalExtent?: number;
  debugHeight?: number;
  debugRefreshInterval?: number;
}

export class SpatialGridSystem {
  private readonly cellSize: number;
  private readonly verticalExtent: number;
  private readonly debugHeight: number;
  private readonly debugRefreshInterval: number;
  private readonly cells = new Map<string, SpatialCell>();
  private readonly entityToCell = new Map<string, string>();
  private entityManager: EntityManager | null = null;
  private entityRenderer: EntityRenderer | null = null;
  private systemContext: SystemContext | null = null;
  private unsubOnCreate: (() => void) | null = null;
  private unsubOnDestroy: (() => void) | null = null;
  private debugOverlayEnabled = false;
  private debugScene: THREE.Scene | null = null;
  private debugGroup: THREE.Group | null = null;
  private debugRefreshTimer = 0;
  private lastMigratedEntities = 0;
  private cellAllocations = 0;
  private cellDeallocations = 0;

  constructor(options: SpatialGridOptions = {}) {
    this.cellSize = Math.max(1, options.cellSize ?? 64);
    this.verticalExtent = Math.max(8, options.verticalExtent ?? 256);
    this.debugHeight = options.debugHeight ?? 0.2;
    this.debugRefreshInterval = Math.max(0.05, options.debugRefreshInterval ?? 0.2);
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    if (!this.entityManager && ctx.entityManager) {
      this.bindEntityManager(ctx.entityManager as EntityManager);
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
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  bindEntityManager(entityManager: EntityManager): void {
    this.unsubOnCreate?.();
    this.unsubOnDestroy?.();
    this.entityManager = entityManager;

    this.unsubOnCreate = entityManager.onEntityCreated((entity) => {
      this.registerEntity(entity);
    });
    this.unsubOnDestroy = entityManager.onEntityDestroyed((entity) => {
      this.unregisterEntity(entity.id);
    });

    for (const entity of entityManager.getEntities()) {
      this.registerEntity(entity);
    }
  }

  bindEntityRenderer(entityRenderer: EntityRenderer): void {
    this.entityRenderer = entityRenderer;
  }

  bindDebugScene(scene: THREE.Scene | null): void {
    this.debugScene = scene;
    if (!scene) {
      this.disposeDebugOverlay();
      return;
    }
    if (this.debugOverlayEnabled) {
      this.ensureDebugOverlay();
      this.rebuildDebugOverlay();
    }
  }

  getCellFromWorldPosition(x: number, z: number): string {
    const cellX = Math.floor(x / this.cellSize);
    const cellZ = Math.floor(z / this.cellSize);
    return `${cellX}:${cellZ}`;
  }

  getCellForEntity(entityId: string): string | undefined {
    return this.entityToCell.get(entityId);
  }

  getCells(): IterableIterator<SpatialCell> {
    return this.cells.values();
  }

  getCell(cellId: string): SpatialCell | undefined {
    return this.cells.get(cellId);
  }

  getCellSnapshots(): Array<{
    id: string;
    bounds: SpatialCellBounds;
    visible: boolean;
    active: boolean;
    entityCount: number;
  }> {
    const snapshots: Array<{
      id: string;
      bounds: SpatialCellBounds;
      visible: boolean;
      active: boolean;
      entityCount: number;
    }> = [];
    for (const cell of this.cells.values()) {
      snapshots.push({
        id: cell.id,
        bounds: { ...cell.bounds },
        visible: cell.visible,
        active: cell.active,
        entityCount: cell.entities.size,
      });
    }
    return snapshots;
  }

  getEntityIdsInCell(cellId: string): string[] {
    const cell = this.cells.get(cellId);
    if (!cell) return [];
    return [...cell.entities];
  }

  countRenderableEntitiesInCell(cell: SpatialCell): number {
    if (!this.entityRenderer) return 0;
    let count = 0;
    for (const entityId of cell.entities) {
      if (this.entityRenderer.getMeshForEntity(entityId)) {
        count += 1;
      }
    }
    return count;
  }

  getCellSize(): number {
    return this.cellSize;
  }

  setCellVisible(cellId: string, visible: boolean): void {
    const cell = this.cells.get(cellId);
    if (!cell || cell.visible === visible) return;
    cell.visible = visible;
    this.applyCellVisibility(cell);
  }

  setCellActive(cellId: string, active: boolean): void {
    const cell = this.cells.get(cellId);
    if (!cell || cell.active === active) return;
    cell.active = active;
  }

  setDebugOverlayEnabled(enabled: boolean): void {
    this.debugOverlayEnabled = enabled;
    if (!enabled) {
      this.disposeDebugOverlay();
      return;
    }
    this.ensureDebugOverlay();
    this.rebuildDebugOverlay();
  }

  isDebugOverlayEnabled(): boolean {
    return this.debugOverlayEnabled;
  }

  update(dt: number): void {
    if (!this.entityManager) return;

    let migrated = 0;
    for (const entity of this.entityManager.getEntities()) {
      const position = entity.getPosition();
      const nextCell = this.getCellFromWorldPosition(position.x, position.z);
      const currentCell = this.entityToCell.get(entity.id);
      if (!currentCell) {
        this.registerEntity(entity);
        migrated += 1;
        continue;
      }
      if (currentCell !== nextCell) {
        this.moveEntity(entity.id, currentCell, nextCell);
        migrated += 1;
      }
    }

    this.lastMigratedEntities = migrated;
    if (this.debugOverlayEnabled && this.debugGroup) {
      this.debugRefreshTimer += dt;
      if (this.debugRefreshTimer >= this.debugRefreshInterval) {
        this.debugRefreshTimer = 0;
        this.rebuildDebugOverlay();
      }
    }
  }

  getDiagnostics(): Record<string, unknown> {
    let visibleCells = 0;
    let activeCells = 0;
    for (const cell of this.cells.values()) {
      if (cell.visible) visibleCells += 1;
      if (cell.active) activeCells += 1;
    }

    return {
      cellSize: this.cellSize,
      cellCount: this.cells.size,
      trackedEntities: this.entityToCell.size,
      cellAllocations: this.cellAllocations,
      cellDeallocations: this.cellDeallocations,
      visibleCells,
      activeCells,
      debugOverlayEnabled: this.debugOverlayEnabled,
      lastMigratedEntities: this.lastMigratedEntities,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: this.getDiagnostics(),
    };
  }

  dispose(): void {
    this.unsubOnCreate?.();
    this.unsubOnDestroy?.();
    this.unsubOnCreate = null;
    this.unsubOnDestroy = null;
    this.cells.clear();
    this.entityToCell.clear();
    this.disposeDebugOverlay();
  }

  private registerEntity(entity: Entity): void {
    const position = entity.getPosition();
    const cellId = this.getCellFromWorldPosition(position.x, position.z);
    const cell = this.getOrCreateCell(cellId);
    cell.entities.add(entity.id);
    this.entityToCell.set(entity.id, cell.id);
    this.applyEntityVisibility(entity.id, cell.visible);
  }

  private unregisterEntity(entityId: string): void {
    const currentCellId = this.entityToCell.get(entityId);
    if (!currentCellId) return;

    const cell = this.cells.get(currentCellId);
    if (cell) {
      cell.entities.delete(entityId);
      this.cleanupCellIfEmpty(cell);
    }

    this.entityToCell.delete(entityId);
  }

  private moveEntity(entityId: string, currentCellId: string, nextCellId: string): void {
    const currentCell = this.cells.get(currentCellId);
    if (currentCell) {
      currentCell.entities.delete(entityId);
      this.cleanupCellIfEmpty(currentCell);
    }

    const nextCell = this.getOrCreateCell(nextCellId);
    nextCell.entities.add(entityId);
    this.entityToCell.set(entityId, nextCell.id);
    this.applyEntityVisibility(entityId, nextCell.visible);

    gameBus.emit('stateMutation', {
      source: 'spatialGridSystem',
      path: `spatialGrid.cells.${nextCell.id}`,
      changedCount: 1,
    });
  }

  private applyCellVisibility(cell: SpatialCell): void {
    for (const entityId of cell.entities) {
      this.applyEntityVisibility(entityId, cell.visible);
    }
  }

  private applyEntityVisibility(entityId: string, cellVisible: boolean): void {
    const mesh = this.entityRenderer?.getMeshForEntity(entityId);
    if (!mesh) return;
    mesh.visible = cellVisible && mesh.userData.forceHidden !== true;
  }

  private getOrCreateCell(cellId: string): SpatialCell {
    const existing = this.cells.get(cellId);
    if (existing) return existing;

    const [xRaw, zRaw] = cellId.split(':');
    const cellX = Number.parseInt(xRaw, 10) || 0;
    const cellZ = Number.parseInt(zRaw, 10) || 0;
    const minX = cellX * this.cellSize;
    const maxX = minX + this.cellSize;
    const minZ = cellZ * this.cellSize;
    const maxZ = minZ + this.cellSize;
    const halfHeight = this.verticalExtent * 0.5;

    const created: SpatialCell = {
      id: cellId,
      bounds: { minX, maxX, minZ, maxZ },
      entities: new Set<string>(),
      visible: true,
      active: true,
      frustumBounds: new THREE.Box3(
        new THREE.Vector3(minX, -halfHeight, minZ),
        new THREE.Vector3(maxX, halfHeight, maxZ),
      ),
    };

    this.cells.set(created.id, created);
    this.cellAllocations += 1;
    return created;
  }

  private cleanupCellIfEmpty(cell: SpatialCell): void {
    if (cell.entities.size > 0) return;
    this.cells.delete(cell.id);
    this.cellDeallocations += 1;
  }

  private ensureDebugOverlay(): void {
    if (!this.debugScene || this.debugGroup) return;
    this.debugGroup = new THREE.Group();
    this.debugGroup.name = 'spatial_grid_debug_overlay';
    this.debugScene.add(this.debugGroup);
  }

  private rebuildDebugOverlay(): void {
    if (!this.debugOverlayEnabled || !this.debugGroup) return;

    for (const child of this.debugGroup.children) {
      const line = child as THREE.Line;
      line.geometry.dispose();
      const material = line.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material.dispose();
      }
    }
    this.debugGroup.clear();

    for (const cell of this.cells.values()) {
      let color = 0x24d16f; // visible
      if (!cell.visible) {
        color = 0xc93b3b; // culled
      } else if (!cell.active && cell.entities.size > 0) {
        color = 0xd4b32f; // sleeping
      } else if (!cell.active && cell.entities.size === 0) {
        color = 0x7a7a7a; // inactive
      }

      const y = this.debugHeight;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(cell.bounds.minX, y, cell.bounds.minZ),
        new THREE.Vector3(cell.bounds.maxX, y, cell.bounds.minZ),
        new THREE.Vector3(cell.bounds.maxX, y, cell.bounds.maxZ),
        new THREE.Vector3(cell.bounds.minX, y, cell.bounds.maxZ),
        new THREE.Vector3(cell.bounds.minX, y, cell.bounds.minZ),
      ]);

      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      this.debugGroup.add(line);
    }
  }

  private disposeDebugOverlay(): void {
    if (!this.debugGroup) return;
    for (const child of this.debugGroup.children) {
      const line = child as THREE.Line;
      line.geometry.dispose();
      const material = line.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material.dispose();
      }
    }
    this.debugGroup.clear();
    this.debugScene?.remove(this.debugGroup);
    this.debugGroup = null;
  }
}
