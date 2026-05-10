/**
 * PERFORMANCE MONITOR
 * Phase 4: Continuous performance tracking & monitoring
 * 
 * Collects and persists performance metrics:
 * - Time-to-interactive (TTI)
 * - Chunk load times
 * - Memory usage
 * - Frame rate (FPS)
 * - Mode transition times
 * - Detects regressions
 */

export interface PerformanceMetrics {
  timestamp: number;
  bootloaderToKernel: number; // ms
  kernelToUIReady: number; // ms
  modeSelectionToGameplay: number; // ms
  totalTTI: number; // ms
  chunkLoadTime?: number; // ms
  memoryUsed: number; // MB
  fps?: number;
}

export interface PerformanceAlert {
  type: 'regression' | 'threshold' | 'anomaly';
  metric: string;
  currentValue: number;
  threshold: number;
  message: string;
  timestamp: number;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private alerts: PerformanceAlert[] = [];
  private thresholds = {
    bootloaderToKernel: 400, // ms
    totalTTI: 1200, // ms
    modeSelectionToGameplay: 800, // ms
    chunkLoadTime: 800, // ms
  };
  private maxMetricsHistory = 1000;
  private fpsCounter = 0;
  private lastFpsCheck = performance.now();
  private frameCount = 0;
  private isMonitoring = false;

  constructor() {
    this.startFpsMonitoring();
  }

  /**
   * Record bootloader phase metrics
   */
  recordBootloaderMetrics(startTime: number, kernelReadyTime: number): void {
    const bootloaderDuration = kernelReadyTime - startTime;

    console.log(`[PerformanceMonitor] Bootloader → Kernel: ${bootloaderDuration.toFixed(0)}ms`);

    if (bootloaderDuration > this.thresholds.bootloaderToKernel) {
      this.addAlert({
        type: 'threshold',
        metric: 'bootloaderToKernel',
        currentValue: bootloaderDuration,
        threshold: this.thresholds.bootloaderToKernel,
        message: `Bootloader exceeded threshold: ${bootloaderDuration.toFixed(0)}ms > ${this.thresholds.bootloaderToKernel}ms`,
      });
    }
  }

  /**
   * Record UI ready metrics
   */
  recordUIReadyMetrics(uiReadyTime: number, bootloaderStartTime: number): void {
    const totalTime = uiReadyTime - bootloaderStartTime;

    console.log(`[PerformanceMonitor] Bootloader → UI Ready: ${totalTime.toFixed(0)}ms`);
  }

  /**
   * Record chunk load metrics
   */
  recordChunkLoadMetrics(mode: string, loadTime: number): void {
    console.log(`[PerformanceMonitor] ${mode} chunk loaded: ${loadTime.toFixed(0)}ms`);

    if (loadTime > this.thresholds.chunkLoadTime) {
      this.addAlert({
        type: 'threshold',
        metric: 'chunkLoadTime',
        currentValue: loadTime,
        threshold: this.thresholds.chunkLoadTime,
        message: `${mode} chunk exceeded threshold: ${loadTime.toFixed(0)}ms > ${this.thresholds.chunkLoadTime}ms`,
      });
    }
  }

  /**
   * Record complete session metrics
   */
  recordSessionMetrics(
    bootloaderToKernel: number,
    kernelToUI: number,
    modeToGameplay: number,
    chunkLoadTime?: number
  ): void {
    const totalTTI = bootloaderToKernel + kernelToUI + modeToGameplay;
    const memoryUsed = this.getMemoryUsage();

    const metric: PerformanceMetrics = {
      timestamp: performance.now(),
      bootloaderToKernel,
      kernelToUIReady: kernelToUI,
      modeSelectionToGameplay: modeToGameplay,
      totalTTI,
      chunkLoadTime,
      memoryUsed,
      fps: this.fpsCounter,
    };

    this.metrics.push(metric);

    // Keep history bounded
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics.shift();
    }

    console.log(
      `[PerformanceMonitor] Session metrics: TTI=${totalTTI.toFixed(0)}ms, Memory=${memoryUsed.toFixed(1)}MB`
    );

    // Check for regressions
    this.checkForRegressions(metric);

    // Persist to localStorage
    this.persistMetrics();
  }

  /**
   * Check for performance regressions
   */
  private checkForRegressions(currentMetric: PerformanceMetrics): void {
    if (this.metrics.length < 5) {
      return; // Need at least 5 metrics to detect regression
    }

    const recent = this.metrics.slice(-10);
    const average = {
      totalTTI: recent.reduce((sum, m) => sum + m.totalTTI, 0) / recent.length,
      chunkLoad: recent.reduce((sum, m) => sum + (m.chunkLoadTime || 0), 0) / recent.length,
    };

    // If current TTI is 10% slower than average
    if (currentMetric.totalTTI > average.totalTTI * 1.1) {
      this.addAlert({
        type: 'regression',
        metric: 'totalTTI',
        currentValue: currentMetric.totalTTI,
        threshold: average.totalTTI,
        message: `Performance regression detected: TTI increased from ${average.totalTTI.toFixed(0)}ms to ${currentMetric.totalTTI.toFixed(0)}ms`,
      });
    }
  }

  /**
   * Start FPS monitoring
   */
  private startFpsMonitoring(): void {
    const raf = typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : undefined;

    if (!raf) {
      console.warn('[PerformanceMonitor] requestAnimationFrame is not available; FPS monitoring disabled.');
      return;
    }

    const measureFps = () => {
      const now = performance.now();
      this.frameCount++;

      if (now - this.lastFpsCheck >= 1000) {
        this.fpsCounter = this.frameCount;
        this.frameCount = 0;
        this.lastFpsCheck = now;
      }

      raf(measureFps);
    };

    raf(measureFps);
  }

  /**
   * Get current memory usage in MB
   */
  private getMemoryUsage(): number {
    try {
      // performance.memory is a non-standard Chrome DevTools API
      if ((performance as any).memory && (performance as any).memory.usedJSHeapSize) {
        return (performance as any).memory.usedJSHeapSize / (1024 * 1024);
      }
    } catch (e) {
      // Silently fail - not available in all browsers
    }
    return 0; // Not available
  }

  /**
   * Add performance alert
   */
  private addAlert(config: Omit<PerformanceAlert, 'timestamp'>): void {
    const alert: PerformanceAlert = {
      ...config,
      timestamp: performance.now(),
    };

    this.alerts.push(alert);
    console.warn(`[PerformanceMonitor] ALERT: ${alert.message}`);
  }

  /**
   * Get summary statistics
   */
  getStats(): {
    metricsCollected: number;
    averageTTI: number;
    worstTTI: number;
    bestTTI: number;
    averageMemory: number;
    alertsTriggered: number;
  } {
    if (this.metrics.length === 0) {
      return {
        metricsCollected: 0,
        averageTTI: 0,
        worstTTI: 0,
        bestTTI: 0,
        averageMemory: 0,
        alertsTriggered: 0,
      };
    }

    const ttis = this.metrics.map((m) => m.totalTTI);
    const memories = this.metrics.map((m) => m.memoryUsed);

    return {
      metricsCollected: this.metrics.length,
      averageTTI: ttis.reduce((a, b) => a + b, 0) / ttis.length,
      worstTTI: Math.max(...ttis),
      bestTTI: Math.min(...ttis),
      averageMemory: memories.reduce((a, b) => a + b, 0) / memories.length,
      alertsTriggered: this.alerts.length,
    };
  }

  /**
   * Get recent metrics
   */
  getRecentMetrics(count: number = 10): PerformanceMetrics[] {
    return this.metrics.slice(-count);
  }

  /**
   * Get all alerts
   */
  getAlerts(): PerformanceAlert[] {
    return [...this.alerts];
  }

  /**
   * Persist metrics to localStorage
   */
  private persistMetrics(): void {
    try {
      const data = {
        timestamp: Engine.time.date().toISOString(),
        stats: this.getStats(),
        recentMetrics: this.getRecentMetrics(5),
        alerts: this.alerts.slice(-10),
      };

      localStorage.setItem('game-performance-metrics', JSON.stringify(data));
    } catch (error) {
      console.warn('[PerformanceMonitor] Could not persist metrics:', error);
    }
  }

  /**
   * Load persisted metrics from previous session
   */
  static loadPersistedMetrics(): any {
    try {
      const data = localStorage.getItem('game-performance-metrics');
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('[PerformanceMonitor] Could not load persisted metrics:', error);
    }
    return null;
  }

  /**
   * Export metrics as JSON for analysis
   */
  exportMetrics(): string {
    return JSON.stringify({
      metrics: this.metrics,
      alerts: this.alerts,
      stats: this.getStats(),
      exportTime: Engine.time.date().toISOString(),
    }, null, 2);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
    this.alerts = [];
    console.log('[PerformanceMonitor] Metrics cleared');
  }
}

export const performanceMonitor = new PerformanceMonitor();
