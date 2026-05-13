interface SpatialRuntimeDebugSnapshot {
  fps: number;
  totalEntities: number;
  visibleCells: number;
  activeCells: number;
  sleepingEntities: number;
  dormantAiEntities: number;
  renderedMeshes: number;
  activeAiEntities: number;
  visibleMeshes: number;
  culledMeshes: number;
  migrations: number;
  cellAllocations: number;
  loadedChunks: number;
  activePathJobs: number;
  streamingQueueSize: number;
  eventQueueSize: number;
  asyncJobs: number;
  activeEncounters: number;
  simulationTickMs: number;
  renderTickMs: number;
}

interface SpatialRuntimeDebugHudOptions {
  readSnapshot: () => SpatialRuntimeDebugSnapshot;
  updateIntervalMs?: number;
}

export class SpatialRuntimeDebugHud {
  private readonly readSnapshot: () => SpatialRuntimeDebugSnapshot;
  private readonly updateIntervalMs: number;
  private container: HTMLDivElement | null = null;
  private enabled = false;  // Disabled by default
  private elapsedMs = 0;
  private fpsSmoothed = 0;

  constructor(options: SpatialRuntimeDebugHudOptions) {
    this.readSnapshot = options.readSnapshot;
    this.updateIntervalMs = Math.max(100, options.updateIntervalMs ?? 250);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.container) {
      this.container.style.display = 'none';
    } else if (enabled) {
      this.ensureContainer();
      if (this.container) this.container.style.display = 'block';
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  update(dt: number): void {
    if (!this.enabled) return;

    const fpsInstant = dt > 0 ? 1 / dt : 0;
    this.fpsSmoothed = this.fpsSmoothed <= 0
      ? fpsInstant
      : (this.fpsSmoothed * 0.85) + (fpsInstant * 0.15);

    this.elapsedMs += dt * 1000;
    if (this.elapsedMs < this.updateIntervalMs) return;
    this.elapsedMs = 0;

    const snapshot = this.readSnapshot();
    this.ensureContainer();
    if (!this.container) return;

    this.container.innerHTML = [
      `FPS: ${Math.round(this.fpsSmoothed || snapshot.fps)}`,
      `Render Tick: ${snapshot.renderTickMs.toFixed(2)} ms`,
      `Simulation Tick: ${snapshot.simulationTickMs.toFixed(2)} ms`,
      `Entities: ${snapshot.totalEntities}`,
      `Loaded Chunks: ${snapshot.loadedChunks}`,
      `Visible Cells: ${snapshot.visibleCells}`,
      `Active Cells: ${snapshot.activeCells}`,
      `Sleeping Entities: ${snapshot.sleepingEntities}`,
      `Dormant AI: ${snapshot.dormantAiEntities}`,
      `Active AI: ${snapshot.activeAiEntities}`,
      `Active Path Jobs: ${snapshot.activePathJobs}`,
      `Streaming Queue: ${snapshot.streamingQueueSize}`,
      `Event Queue: ${snapshot.eventQueueSize}`,
      `Async Jobs: ${snapshot.asyncJobs}`,
      `Active Encounters: ${snapshot.activeEncounters}`,
      `Rendered Meshes: ${snapshot.renderedMeshes}`,
      `Visible Meshes: ${snapshot.visibleMeshes}`,
      `Culled Meshes: ${snapshot.culledMeshes}`,
      `Migrations: ${snapshot.migrations}`,
      `Cell Allocations: ${snapshot.cellAllocations}`,
    ].join('<br/>');
  }

  dispose(): void {
    if (!this.container) return;
    this.container.remove();
    this.container = null;
  }

  private ensureContainer(): void {
    if (this.container || typeof document === 'undefined') return;
    const element = document.createElement('div');
    element.id = 'spatial-runtime-debug-hud';
    element.style.position = 'fixed';
    element.style.top = '8px';
    element.style.left = '8px';
    element.style.zIndex = '2500';
    element.style.pointerEvents = 'none';
    element.style.padding = '8px 10px';
    element.style.background = 'rgba(6, 10, 14, 0.72)';
    element.style.color = '#cce4ff';
    element.style.fontFamily = 'Consolas, monospace';
    element.style.fontSize = '11px';
    element.style.lineHeight = '1.4';
    element.style.border = '1px solid rgba(130, 170, 210, 0.45)';
    element.style.borderRadius = '4px';
    document.body.appendChild(element);
    this.container = element;
  }
}
