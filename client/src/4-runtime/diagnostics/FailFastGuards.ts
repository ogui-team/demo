/**
 * FailFastGuards - Critical runtime checks for stress tests
 * Detects: Memory leaks, FPS drops, Event listener leaks
 * 
 * These guards run automatically during stress tests and abort
 * execution if critical thresholds are exceeded.
 * 
 * Philosophy: Fail fast with clear diagnostics rather than
 * letting degradation continue silently.
 */

/**
 * GUARD 1: Memory Growth Detection
 * Monitors heap size across mode transitions
 * Fails if growth exceeds 10% from baseline
 */
export class MemoryGrowthGuard {
  private baseline = 0;
  private samples: number[] = [];
  private maxSamples = 100;

  /**
   * Record current heap and check for excessive growth
   * @returns 'PASS' if within threshold, 'FAIL' if exceeded
   */
  check(currentHeapMB: number): 'PASS' | 'FAIL' {
    if (this.baseline === 0) {
      this.baseline = currentHeapMB;
      this.samples.push(currentHeapMB);
      return 'PASS';
    }

    this.samples.push(currentHeapMB);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    const growthPercent = ((currentHeapMB - this.baseline) / this.baseline) * 100;
    const threshold = 10; // Fail if >10% growth

    if (growthPercent > threshold) {
      const diagnosis = {
        baseline: this.baseline.toFixed(2),
        current: currentHeapMB.toFixed(2),
        growthPercent: growthPercent.toFixed(2),
        threshold,
        status: 'FAIL',
      };
      console.error('[FAIL-FAST] Memory growth exceeded threshold:', diagnosis);
      return 'FAIL';
    }

    return 'PASS';
  }

  /**
   * Reset baseline for new test phase
   */
  resetBaseline(currentHeapMB: number): void {
    this.baseline = currentHeapMB;
    this.samples = [currentHeapMB];
  }

  /**
   * Get diagnostic information
   */
  getDiagnostics() {
    return {
      baseline: this.baseline.toFixed(2),
      current: this.samples[this.samples.length - 1]?.toFixed(2) ?? 'N/A',
      min: Math.min(...this.samples).toFixed(2),
      max: Math.max(...this.samples).toFixed(2),
      avg: (this.samples.reduce((a, b) => a + b, 0) / this.samples.length).toFixed(2),
      sampleCount: this.samples.length,
    };
  }
}

/**
 * GUARD 2: FPS Drop Detection
 * Monitors frame rate stability
 * Warns if avg FPS drops below 55, fails if below 45
 */
export class FPSDropGuard {
  private fpsHistory: number[] = [];
  private maxHistory = 600; // Track last 10 seconds @ 60fps
  private failCount = 0;
  private warnCount = 0;

  /**
   * Record FPS and check for excessive drops
   * @returns 'PASS' | 'WARN' (55-60) | 'FAIL' (<45)
   */
  check(currentFPS: number): 'PASS' | 'WARN' | 'FAIL' {
    this.fpsHistory.push(currentFPS);
    if (this.fpsHistory.length > this.maxHistory) {
      this.fpsHistory.shift();
    }

    const avgLast10Frames = this.average(this.fpsHistory.slice(-10));
    const avgLast60Frames = this.average(this.fpsHistory.slice(-60));

    // Hard failure: <45 FPS average
    if (avgLast60Frames < 45) {
      this.failCount++;
      if (this.failCount % 60 === 0) { // Log once per second
        console.error('[FAIL-FAST] FPS drop detected:', {
          current: currentFPS.toFixed(1),
          avgLast10: avgLast10Frames.toFixed(1),
          avgLast60: avgLast60Frames.toFixed(1),
          failCount: this.failCount,
        });
      }
      return 'FAIL';
    }

    // Soft warning: 45-55 FPS
    if (avgLast60Frames < 55) {
      this.warnCount++;
      if (this.warnCount % 120 === 0) { // Log once every 2 seconds
        console.warn('[FAIL-FAST] FPS warning:', {
          avgLast60: avgLast60Frames.toFixed(1),
          warnCount: this.warnCount,
        });
      }
      return 'WARN';
    }

    // Reset counters on recovery
    if (avgLast60Frames >= 58) {
      this.failCount = 0;
      this.warnCount = 0;
    }

    return 'PASS';
  }

  /**
   * Get diagnostic information
   */
  getDiagnostics() {
    const last10 = this.fpsHistory.slice(-10);
    const last60 = this.fpsHistory.slice(-60);
    return {
      current: this.fpsHistory[this.fpsHistory.length - 1]?.toFixed(1) ?? 'N/A',
      avgLast10: this.average(last10).toFixed(1),
      avgLast60: this.average(last60).toFixed(1),
      min: Math.min(...this.fpsHistory).toFixed(1),
      max: Math.max(...this.fpsHistory).toFixed(1),
      failCount: this.failCount,
      warnCount: this.warnCount,
    };
  }

  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
}

/**
 * GUARD 3: Event Listener Leak Detection
 * Monitors active event listeners count
 * Fails if new listeners accumulate without cleanup
 */
export class ListenerLeakGuard {
  private listenerCountAtTransition = 0;
  private maxAllowedNewListeners = 5; // Allow small fluctuation
  private transitionCount = 0;
  private listenerHistory: number[] = [];

  /**
   * Check listener count after mode transition
   * @param currentListenerCount Total active listeners
   * @returns 'PASS' if within threshold, 'FAIL' if leaked
   */
  check(currentListenerCount: number): 'PASS' | 'FAIL' {
    this.listenerHistory.push(currentListenerCount);

    if (this.listenerCountAtTransition === 0) {
      this.listenerCountAtTransition = currentListenerCount;
      return 'PASS';
    }

    const delta = currentListenerCount - this.listenerCountAtTransition;

    // Allow small fluctuation, but fail on persistent leaks
    if (delta > this.maxAllowedNewListeners) {
      const diagnosis = {
        baseline: this.listenerCountAtTransition,
        current: currentListenerCount,
        delta,
        threshold: this.maxAllowedNewListeners,
        transitionCount: this.transitionCount,
        status: 'FAIL',
      };
      console.error('[FAIL-FAST] Event listener leak detected:', diagnosis);
      return 'FAIL';
    }

    return 'PASS';
  }

  /**
   * Update baseline after successful mode transition
   */
  recordTransition(currentListenerCount: number): void {
    this.listenerCountAtTransition = currentListenerCount;
    this.transitionCount++;
  }

  /**
   * Get diagnostic information
   */
  getDiagnostics() {
    const cleanedHistory = this.listenerHistory.filter(x => x !== undefined);
    return {
      baseline: this.listenerCountAtTransition,
      current: cleanedHistory[cleanedHistory.length - 1] ?? 'N/A',
      min: Math.min(...cleanedHistory),
      max: Math.max(...cleanedHistory),
      transitionCount: this.transitionCount,
      sampleCount: cleanedHistory.length,
    };
  }
}

/**
 * Unified FailFastGuards manager
 * Coordinates all three guards and produces diagnostic reports
 */
export class FailFastGuardsManager {
  private memory = new MemoryGrowthGuard();
  private fps = new FPSDropGuard();
  private listeners = new ListenerLeakGuard();
  private testName = '';
  private testStartTime = 0;

  /**
   * Start a stress test phase
   */
  startTest(name: string, initialHeapMB: number): void {
    this.testName = name;
    this.testStartTime = performance.now();
    this.memory.resetBaseline(initialHeapMB);
    console.log(`[FailFastGuards] Starting test: ${name}`);
  }

  /**
   * Record frame metrics from game loop
   * @returns 'PASS' if all guards pass, 'WARN' | 'FAIL' if issues
   */
  recordFrameMetrics(
    currentFPS: number,
    currentHeapMB: number,
    currentListenerCount: number
  ): 'PASS' | 'WARN' | 'FAIL' {
    const fpsStatus = this.fps.check(currentFPS);
    const memStatus = this.memory.check(currentHeapMB);
    const listenerStatus = this.listeners.check(currentListenerCount);

    // Return most severe status
    if (memStatus === 'FAIL' || listenerStatus === 'FAIL' || fpsStatus === 'FAIL') {
      return 'FAIL';
    }
    if (fpsStatus === 'WARN') {
      return 'WARN';
    }

    return 'PASS';
  }

  /**
   * Record successful mode transition
   */
  recordModeTransition(listenerCount: number): void {
    this.listeners.recordTransition(listenerCount);
  }

  /**
   * Generate full diagnostic report
   */
  generateReport() {
    const elapsedSeconds = (performance.now() - this.testStartTime) / 1000;
    return {
      testName: this.testName,
      elapsedSeconds: elapsedSeconds.toFixed(1),
      timestamp: new Date().toISOString(),
      memory: this.memory.getDiagnostics(),
      fps: this.fps.getDiagnostics(),
      listeners: this.listeners.getDiagnostics(),
    };
  }

  /**
   * Print formatted report to console
   */
  printReport(): void {
    const report = this.generateReport();
    console.log('\n' + '='.repeat(60));
    console.log('📊 STRESS TEST REPORT');
    console.log('='.repeat(60));
    console.log(`Test: ${report.testName}`);
    console.log(`Duration: ${report.elapsedSeconds}s`);
    console.log('\nMemory (MB):');
    console.log(`  Baseline: ${report.memory.baseline}`);
    console.log(`  Current:  ${report.memory.current}`);
    console.log(`  Min/Max:  ${report.memory.min} / ${report.memory.max}`);
    console.log(`  Avg:      ${report.memory.avg}`);
    console.log('\nFPS:');
    console.log(`  Current:  ${report.fps.current}`);
    console.log(`  Avg(10):  ${report.fps.avgLast10}`);
    console.log(`  Avg(60):  ${report.fps.avgLast60}`);
    console.log(`  Min/Max:  ${report.fps.min} / ${report.fps.max}`);
    console.log('\nListeners:');
    console.log(`  Baseline: ${report.listeners.baseline}`);
    console.log(`  Current:  ${report.listeners.current}`);
    console.log(`  Min/Max:  ${report.listeners.min} / ${report.listeners.max}`);
    console.log(`  Transitions: ${report.listeners.transitionCount}`);
    console.log('='.repeat(60) + '\n');
  }
}

/**
 * Global instance for engine-wide access
 */
let globalGuardsManager: FailFastGuardsManager | null = null;

export function initializeFailFastGuards(): FailFastGuardsManager {
  globalGuardsManager = new FailFastGuardsManager();
  return globalGuardsManager;
}

export function getFailFastGuards(): FailFastGuardsManager | null {
  return globalGuardsManager;
}

/**
 * Convenience helper: Get current heap memory in MB
 * Uses performance.memory API (only in Chrome/Edge)
 */
export function getCurrentHeapMB(): number {
  if (typeof performance !== 'undefined' && 'memory' in performance) {
    return (performance.memory as any).usedJSHeapSize / 1024 / 1024;
  }
  return 0; // Fallback for browsers without memory API
}

/**
 * Convenience helper: Count all registered event listeners
 * (Best effort - requires EventListenerRegistry integration)
 */
export function getActiveListenerCount(): number {
  // This will be populated by EventListenerRegistry
  // For now, return 0 as placeholder
  try {
    // Will be filled in when integrated with SystemContext
    const listenerRegistry = (globalThis as any).__eventListenerRegistry;
    return listenerRegistry?.getTrackedListenerCount?.() ?? 0;
  } catch {
    return 0;
  }
}
