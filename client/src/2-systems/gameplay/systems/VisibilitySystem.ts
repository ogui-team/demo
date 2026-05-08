import * as THREE from 'three';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import type { SpatialGridSystem } from './SpatialGridSystem';

interface VisibilitySystemOptions {
  cullInterval?: number;
  cellPadding?: number;
}

export class VisibilitySystem {
  private readonly spatialGrid: SpatialGridSystem;
  private readonly camera: THREE.Camera;
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly tempBox = new THREE.Box3();
  private readonly cullInterval: number;
  private readonly cellPadding: number;
  private timer = 0;
  private enabled = true;
  private systemContext: SystemContext | null = null;
  private visibleCells = 0;
  private hiddenCells = 0;
  private visibleMeshes = 0;
  private culledMeshes = 0;

  constructor(spatialGrid: SpatialGridSystem, camera: THREE.Camera, options: VisibilitySystemOptions = {}) {
    this.spatialGrid = spatialGrid;
    this.camera = camera;
    this.cullInterval = Math.max(0, options.cullInterval ?? 0.08);
    this.cellPadding = Math.max(0, options.cellPadding ?? 2);
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
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

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  update(dt: number): void {
    if (!this.enabled) return;

    this.timer += dt;
    if (this.timer < this.cullInterval) return;
    this.timer = 0;

    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);

    let visibleCount = 0;
    let hiddenCount = 0;
    let visibleMeshCount = 0;
    let culledMeshCount = 0;
    for (const cell of this.spatialGrid.getCells()) {
      this.tempBox.copy(cell.frustumBounds).expandByScalar(this.cellPadding);
      const visible = this.frustum.intersectsBox(this.tempBox);
      this.spatialGrid.setCellVisible(cell.id, visible);
      const renderableInCell = this.spatialGrid.countRenderableEntitiesInCell(cell);
      if (visible) visibleCount += 1;
      else hiddenCount += 1;
      if (visible) visibleMeshCount += renderableInCell;
      else culledMeshCount += renderableInCell;
    }

    this.visibleCells = visibleCount;
    this.hiddenCells = hiddenCount;
    this.visibleMeshes = visibleMeshCount;
    this.culledMeshes = culledMeshCount;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      cullInterval: this.cullInterval,
      visibleCells: this.visibleCells,
      hiddenCells: this.hiddenCells,
      visibleMeshes: this.visibleMeshes,
      culledMeshes: this.culledMeshes,
      cellPadding: this.cellPadding,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: this.enabled ? 'active' : 'idle',
      active: this.enabled,
      metrics: this.getDiagnostics(),
    };
  }

  dispose(): void {
    this.enabled = false;
    this.timer = 0;
  }
}
