import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SimulationKernel } from '@engine/1-kernel/core/public-api';
import { BinaryTraceExporter } from '@engine/1-kernel/core/BinaryTraceExporter';
import { initializeTraceAPI } from '@engine/1-kernel/core/TraceWindowAPI';

/**
 * TITAN BENCHMARK OVERLAY
 * Real-time performance monitoring and stress-test controls
 * 
 * Provides UI for:
 * - Spawning 500-entity army with FROSTBITE zero-allocation
 * - Exporting BITE trace buffer for post-hoc analysis
 * - Real-time kernel tick time monitoring
 * - BITE buffer stride index tracking
 */
export class TitanBenchmarkOverlay {
  private container: HTMLElement | null = null;
  private kernel: SimulationKernel | null = null;
  private dummySystem: any = null;
  private lastTickTime: number = 0;
  private tickTimeHistory: number[] = [];
  private readonly MAX_HISTORY = 60; // Last 60 frames
  private running: boolean = false;

  constructor() {
    this.initializeUI();
    this.subscribeToEvents();
  }

  /**
   * Initialize the benchmark overlay UI
   */
  private initializeUI(): void {
    // Create container
    this.container = document.createElement('div');
    this.container.id = 'titan-benchmark-overlay';
    this.container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 320px;
      background: rgba(20, 20, 30, 0.95);
      border: 2px solid #00ff00;
      border-radius: 8px;
      padding: 16px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #00ff00;
      z-index: 9999;
      box-shadow: 0 0 20px rgba(0, 255, 0, 0.3);
      text-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
    `;

    // Title
    const title = document.createElement('div');
    title.style.cssText = 'font-weight: bold; margin-bottom: 12px; border-bottom: 1px solid #00ff00; padding-bottom: 8px;';
    title.textContent = '⚡ TITAN BENCHMARK v0.2.2';
    this.container.appendChild(title);

    // Metrics display
    const metrics = document.createElement('div');
    metrics.id = 'titan-metrics';
    metrics.style.cssText = `
      margin-bottom: 12px;
      padding: 8px;
      background: rgba(0, 255, 0, 0.05);
      border-left: 2px solid #00ff00;
      min-height: 80px;
    `;
    metrics.innerHTML = `
      <div id="tick-time">Kernel Tick: -- ms</div>
      <div id="tick-avg">Avg Tick: -- ms</div>
      <div id="bite-index">BITE Index: -- / 300</div>
      <div id="entity-count">Entities: 0</div>
    `;
    this.container.appendChild(metrics);

    // Button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;';

    // Spawn button
    const spawnBtn = document.createElement('button');
    spawnBtn.textContent = '[ SPAWN 500 ]';
    spawnBtn.style.cssText = `
      flex: 1;
      min-width: 140px;
      padding: 8px 12px;
      background: rgba(0, 255, 0, 0.1);
      border: 1px solid #00ff00;
      color: #00ff00;
      font-family: 'Courier New', monospace;
      cursor: pointer;
      border-radius: 4px;
      transition: all 0.2s;
    `;
    spawnBtn.onmouseover = () => {
      spawnBtn.style.background = 'rgba(0, 255, 0, 0.2)';
      spawnBtn.style.boxShadow = '0 0 10px rgba(0, 255, 0, 0.5)';
    };
    spawnBtn.onmouseout = () => {
      spawnBtn.style.background = 'rgba(0, 255, 0, 0.1)';
      spawnBtn.style.boxShadow = 'none';
    };
    spawnBtn.onclick = () => this.spawnArmy();
    buttonContainer.appendChild(spawnBtn);

    // Export button
    const exportBtn = document.createElement('button');
    exportBtn.textContent = '[ EXPORT ]';
    exportBtn.style.cssText = `
      flex: 1;
      min-width: 140px;
      padding: 8px 12px;
      background: rgba(0, 100, 255, 0.1);
      border: 1px solid #0064ff;
      color: #0064ff;
      font-family: 'Courier New', monospace;
      cursor: pointer;
      border-radius: 4px;
      transition: all 0.2s;
    `;
    exportBtn.onmouseover = () => {
      exportBtn.style.background = 'rgba(0, 100, 255, 0.2)';
      exportBtn.style.boxShadow = '0 0 10px rgba(0, 100, 255, 0.5)';
    };
    exportBtn.onmouseout = () => {
      exportBtn.style.background = 'rgba(0, 100, 255, 0.1)';
      exportBtn.style.boxShadow = 'none';
    };
    exportBtn.onclick = () => this.exportTrace();
    buttonContainer.appendChild(exportBtn);

    this.container.appendChild(buttonContainer);

    // Idle-Bob toggle
    const bobContainer = document.createElement('div');
    bobContainer.style.cssText = 'display: flex; gap: 8px; align-items: center;';

    const bobLabel = document.createElement('label');
    bobLabel.style.cssText = 'flex: 1; cursor: pointer;';
    bobLabel.textContent = 'Idle-Bob (Data Flux)';

    const bobToggle = document.createElement('input');
    bobToggle.type = 'checkbox';
    bobToggle.id = 'titan-bob-toggle';
    bobToggle.style.cssText = 'cursor: pointer;';
    bobToggle.onchange = () => this.toggleIdleBob(bobToggle.checked);

    bobContainer.appendChild(bobToggle);
    bobContainer.appendChild(bobLabel);
    this.container.appendChild(bobContainer);

    // Post-Processing toggle
    const ppContainer = document.createElement('div');
    ppContainer.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-top: 8px;';

    const ppLabel = document.createElement('label');
    ppLabel.style.cssText = 'flex: 1; cursor: pointer;';
    ppLabel.textContent = 'Post-Processing';

    const ppToggle = document.createElement('input');
    ppToggle.type = 'checkbox';
    ppToggle.id = 'titan-pp-toggle';
    ppToggle.style.cssText = 'cursor: pointer;';
    ppToggle.checked = true; // Default enabled
    ppToggle.onchange = () => this.togglePostProcessing(ppToggle.checked);

    ppContainer.appendChild(ppToggle);
    ppContainer.appendChild(ppLabel);
    this.container.appendChild(ppContainer);

    // Status line
    const status = document.createElement('div');
    status.id = 'titan-status';
    status.style.cssText = `
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #00ff00;
      font-size: 11px;
      opacity: 0.8;
    `;
    status.textContent = 'Ready...';
    this.container.appendChild(status);

    document.body.appendChild(this.container);
  }

  /**
   * Subscribe to game events for metrics updates
   */
  private subscribeToEvents(): void {
    (gameBus as any).on('KERNEL_TICK_TIME', (data: any) => {
      this.onKernelTickTime(data);
    });

    (gameBus as any).on('BITE_FRAME_RECORDED', (data: any) => {
      this.onBiteFrameRecorded(data);
    });

    (gameBus as any).on('DUMMY_ARMY_SPAWNED', (data: any) => {
      this.onArmySpawned(data);
    });
  }

  /**
   * Set kernel and system references for control
   */
  setKernel(kernel: SimulationKernel): void {
    this.kernel = kernel;
    initializeTraceAPI(kernel); // Enable window.exportTrace()
  }

  /**
   * Set dummy enemy system for spawn control
   */
  setDummyEnemySystem(system: any): void {
    this.dummySystem = system;
  }

  /**
   * Spawn 500-entity army
   */
  private spawnArmy(): void {
    if (!this.dummySystem) {
      console.error('[TitanBenchmark] DummyEnemySystem not initialized');
      return;
    }

    const status = document.getElementById('titan-status');
    if (status) status.textContent = 'Spawning 500 entities...';

    const startTime = performance.now();
    const handles = this.dummySystem.spawnArmy(500, { x: 16, y: 1, z: 16 }, 2.0);
    const elapsed = performance.now() - startTime;

    if (status) {
      status.textContent = `Spawned ${handles.length} entities in ${elapsed.toFixed(1)}ms`;
    }

    // Enable idle-bob for maximum flux
    if (this.dummySystem.setIdleBobActive) {
      this.dummySystem.setIdleBobActive(true);
      const bobToggle = document.getElementById('titan-bob-toggle') as HTMLInputElement;
      if (bobToggle) bobToggle.checked = true;
    }

    this.running = true;
    this.tickTimeHistory = [];
  }

  /**
   * Export BITE trace buffer
   */
  private exportTrace(): void {
    if (!this.kernel) {
      console.error('[TitanBenchmark] Kernel not initialized');
      return;
    }

    const status = document.getElementById('titan-status');
    if (status) status.textContent = 'Exporting trace...';

    BinaryTraceExporter.exportTrace(this.kernel);

    if (status) {
      status.textContent = `Trace exported (${(this.kernel.getBiteBuffer().byteLength / 1024).toFixed(0)}KB)`;
    }
  }

  /**
   * Toggle Idle-Bob animation
   */
  private toggleIdleBob(enabled: boolean): void {
    if (!this.dummySystem) return;
    if (this.dummySystem.setIdleBobActive) {
      this.dummySystem.setIdleBobActive(enabled);
    }
  }

  /**
   * Toggle Post-Processing effects globally
   */
  private togglePostProcessing(enabled: boolean): void {
    const Engine = (window as any).Engine;
    if (Engine && Engine.setEnginePostProcessingEnabled) {
      Engine.setEnginePostProcessingEnabled(enabled);
      console.log(`[TITAN] Post-Processing: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }
  }

  /**
   * Handle kernel tick time metric
   */
  private onKernelTickTime(data: any): void {
    const tickTime = data.ms ?? 0;
    this.lastTickTime = tickTime;
    this.tickTimeHistory.push(tickTime);

    if (this.tickTimeHistory.length > this.MAX_HISTORY) {
      this.tickTimeHistory.shift();
    }

    this.updateMetricsDisplay();
  }

  /**
   * Handle BITE frame recorded metric
   */
  private onBiteFrameRecorded(data: any): void {
    const frameIndex = data.frameIndex ?? 0;
    const metricsDiv = document.getElementById('bite-index');
    if (metricsDiv) {
      metricsDiv.textContent = `BITE Index: ${frameIndex} / 300`;
    }
  }

  /**
   * Handle army spawned event
   */
  private onArmySpawned(data: any): void {
    const count = data.count ?? 0;
    const metricsDiv = document.getElementById('entity-count');
    if (metricsDiv) {
      metricsDiv.textContent = `Entities: ${count}`;
    }
  }

  /**
   * Update metrics display
   */
  private updateMetricsDisplay(): void {
    const tickDiv = document.getElementById('tick-time');
    const avgDiv = document.getElementById('tick-avg');

    if (tickDiv) {
      tickDiv.textContent = `Kernel Tick: ${this.lastTickTime.toFixed(2)} ms`;
    }

    if (avgDiv && this.tickTimeHistory.length > 0) {
      const avg =
        this.tickTimeHistory.reduce((a, b) => a + b, 0) / this.tickTimeHistory.length;
      avgDiv.textContent = `Avg Tick: ${avg.toFixed(2)} ms`;

      // Color warning if avg > 1.5ms
      if (avg > 1.5) {
        avgDiv.style.color = '#ff6600';
      } else {
        avgDiv.style.color = '#00ff00';
      }
    }
  }

  /**
   * Show status message
   */
  setStatus(message: string): void {
    const status = document.getElementById('titan-status');
    if (status) status.textContent = message;
  }
}
