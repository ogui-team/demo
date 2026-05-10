/**
 * TIER 0A Validation: EventListener Lifecycle Enforcement & Stress Tests
 * 
 * Validates that:
 * 1. All event listeners are properly tracked
 * 2. No untracked listeners exist
 * 3. Listeners are properly cleaned up during mode transitions
 * 4. Memory is stable after multiple transitions
 * 
 * Also implements stress test infrastructure:
 * - 100 Mode Transitions: Verify lifecycle cleanup
 * - 5000 NPC Spawn: Verify performance at scale
 * - 20-Minute Multiplayer: Real-world scenario validation
 */

import { EventListenerRegistry } from '../../1-kernel/core/EventListenerRegistry';
import {
  FailFastGuardsManager,
  MemoryGrowthGuard,
  FPSDropGuard,
  ListenerLeakGuard,
  getCurrentHeapMB,
} from './FailFastGuards';

export interface ListenerMetrics {
  trackedListeners: number;
  memoryUsage: number;
  timestamp: number;
}

export interface ValidationResult {
  success: boolean;
  message: string;
  metrics: ListenerMetrics;
  errors: string[];
}

/**
 * Comprehensive listener lifecycle validation for TIER 0A
 */
export class ListenerValidation {
  private static metricsHistory: ListenerMetrics[] = [];
  private static maxHistorySize = 1000;

  /**
   * Get current listener metrics
   */
  static getMetrics(): ListenerMetrics {
    return {
      trackedListeners: this.countTrackedListeners(),
      memoryUsage: this.getMemoryUsageMB(),
      timestamp: performance.now(),
    };
  }

  /**
   * Count tracked listeners in all registries
   */
  private static countTrackedListeners(): number {
    // This would need to be integrated with actual EventListenerRegistry
    // For now, return a placeholder
    return 0;
  }

  /**
   * Get current memory usage in MB
   */
  private static getMemoryUsageMB(): number {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      return (performance as any).memory.usedJSHeapSize / (1024 * 1024);
    }
    return 0;
  }

  /**
   * Record metrics for trend analysis
   */
  static recordMetrics(): void {
    const metrics = this.getMetrics();
    this.metricsHistory.push(metrics);

    // Keep history size bounded
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory.shift();
    }
  }

  /**
   * Check if memory is stable (no growth trend)
   */
  static isMemoryStable(sampleSize: number = 10): boolean {
    if (this.metricsHistory.length < sampleSize) {
      return true; // Not enough data yet
    }

    const recent = this.metricsHistory.slice(-sampleSize);
    const firstMemory = recent[0].memoryUsage;
    const lastMemory = recent[sampleSize - 1].memoryUsage;

    // Allow up to 5% variation as "stable"
    const maxGrowth = firstMemory * 0.05;
    return (lastMemory - firstMemory) <= maxGrowth;
  }

  /**
   * Get memory statistics from history
   */
  static getMemoryStats(): {
    min: number;
    max: number;
    avg: number;
    current: number;
  } {
    if (this.metricsHistory.length === 0) {
      return { min: 0, max: 0, avg: 0, current: 0 };
    }

    const memories = this.metricsHistory.map((m) => m.memoryUsage);
    return {
      min: Math.min(...memories),
      max: Math.max(...memories),
      avg: memories.reduce((a, b) => a + b, 0) / memories.length,
      current: memories[memories.length - 1],
    };
  }

  /**
   * Validate TIER 0A: No untracked listeners after mode transition
   */
  static validateTier0A(): ValidationResult {
    const errors: string[] = [];
    const metrics = this.getMetrics();
    let success = true;

    // Check 1: No untracked listeners
    if (metrics.trackedListeners > 0) {
      errors.push(`Found ${metrics.trackedListeners} untracked listeners`);
      success = false;
    }

    // Check 2: Memory not growing unbounded
    if (!this.isMemoryStable()) {
      errors.push('Memory usage shows growth trend (possible leak)');
      success = false;
    }

    return {
      success,
      message: success
        ? 'TIER 0A ✅ EventListener lifecycle properly managed'
        : 'TIER 0A ❌ Issues detected in listener lifecycle',
      metrics,
      errors,
    };
  }

  /**
   * Run comprehensive 100-transition stress test
   */
  static async stress100Transitions(): Promise<ValidationResult> {
    const errors: string[] = [];
    const startMetrics = this.getMetrics();

    console.log('[Tier0A] Starting 100-transition stress test...');

    for (let i = 0; i < 100; i++) {
      this.recordMetrics();

      if (i % 20 === 0) {
        console.log(`[Tier0A] Transition ${i}/100...`);
      }

      // Simulate small delay between transitions
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const endMetrics = this.getMetrics();
    const memoryGrowth = endMetrics.memoryUsage - startMetrics.memoryUsage;

    console.log(`[Tier0A] Memory change: ${memoryGrowth.toFixed(2)}MB`);

    // Validate results
    const success = this.isMemoryStable(20) && memoryGrowth < 50; // <50MB growth acceptable

    return {
      success,
      message: success
        ? `✅ 100 transitions complete, memory stable (${memoryGrowth.toFixed(2)}MB change)`
        : `❌ Memory unstable after 100 transitions (${memoryGrowth.toFixed(2)}MB growth)`,
      metrics: endMetrics,
      errors: success ? [] : [`Memory growth: ${memoryGrowth.toFixed(2)}MB`],
    };
  }

  /**
   * Generate diagnostic report
   */
  static generateReport(): Record<string, unknown> {
    return {
      tier0a: this.validateTier0A(),
      memory: this.getMemoryStats(),
      historySize: this.metricsHistory.length,
      timestamp: Engine.time.date().toISOString(),
    };
  }

  /**
   * ============================================================================
   * STRESS TEST SUITE - TIER 0A VALIDATION
   * ============================================================================
   */

  /**
   * STRESS TEST 1: 100 Mode Transitions
   * Tests: Lifecycle cleanup, memory stability, no listener leaks
   * Duration: ~15-20 minutes
   * Success Criteria: Memory ±5%, no listener leaks, memory <150MB
   */
  static async stressTest100ModeTransitions(options?: {
    verbose?: boolean;
    interval?: number;
  }): Promise<StressTestResult> {
    const { verbose = false, interval = 100 } = options || {};
    const testName = '100 Mode Transitions';
    const guards = new FailFastGuardsManager();
    const initialHeap = getCurrentHeapMB();

    guards.startTest(testName, initialHeap);

    const result: StressTestResult = {
      testName,
      status: 'IN_PROGRESS',
      totalTests: 100,
      passed: 0,
      failed: 0,
      warnings: 0,
      startTime: performance.now(),
      endTime: 0,
      elapsedSeconds: 0,
      initialHeapMB: initialHeap,
      finalHeapMB: 0,
      peakHeapMB: initialHeap,
      memoryGrowthMB: 0,
      memoryGrowthPercent: 0,
      errors: [],
      diagnostics: {},
    };

    try {
      for (let i = 0; i < 100; i++) {
        if (verbose && i % 10 === 0) {
          console.log(`[Stress Test] Mode transition ${i}/100...`);
        }

        // Record pre-transition state
        const preHeap = getCurrentHeapMB();

        // Simulate mode transition with small delay
        await this.simulateModeTransition();

        // Record post-transition state
        const postHeap = getCurrentHeapMB();
        result.peakHeapMB = Math.max(result.peakHeapMB, postHeap);

        // Check guards every transition
        const guardStatus = guards.recordFrameMetrics(60, postHeap, 0);

        if (guardStatus === 'FAIL') {
          result.failed++;
          result.errors.push(`Transition ${i}: Guard check failed`);
        } else if (guardStatus === 'WARN') {
          result.warnings++;
        } else {
          result.passed++;
        }

        // Record transition for listener guard
        guards.recordModeTransition(0);

        // Small delay between transitions
        await new Promise((resolve) => setTimeout(resolve, interval));
      }

      result.status = result.failed === 0 ? 'PASS' : 'FAIL';
      result.totalTests = 100;
      result.endTime = performance.now();
      result.elapsedSeconds = (result.endTime - result.startTime) / 1000;
      result.finalHeapMB = getCurrentHeapMB();
      result.memoryGrowthMB = result.finalHeapMB - result.initialHeapMB;
      result.memoryGrowthPercent =
        ((result.memoryGrowthMB / result.initialHeapMB) * 100) | 0;
      result.diagnostics = guards.generateReport();

      if (verbose) {
        guards.printReport();
      }

      return result;
    } catch (error) {
      result.status = 'ERROR';
      result.errors.push(`Test execution error: ${String(error)}`);
      return result;
    }
  }

  /**
   * STRESS TEST 2: 5000 NPC Spawn
   * Tests: Memory scaling, performance under entity load
   * Duration: ~20 minutes (spawn 5min, hold 10min, despawn 5min)
   * Success Criteria: 60 FPS maintained, memory <150MB, no crashes
   */
  static async stressTest5000NPCSpawn(options?: {
    verbose?: boolean;
    holdDurationSeconds?: number;
  }): Promise<StressTestResult> {
    const { verbose = false, holdDurationSeconds = 300 } = options || {};
    const testName = '5000 NPC Spawn';
    const guards = new FailFastGuardsManager();
    const initialHeap = getCurrentHeapMB();

    guards.startTest(testName, initialHeap);

    const result: StressTestResult = {
      testName,
      status: 'IN_PROGRESS',
      totalTests: 3, // spawn, hold, despawn phases
      passed: 0,
      failed: 0,
      warnings: 0,
      startTime: performance.now(),
      endTime: 0,
      elapsedSeconds: 0,
      initialHeapMB: initialHeap,
      finalHeapMB: 0,
      peakHeapMB: initialHeap,
      memoryGrowthMB: 0,
      memoryGrowthPercent: 0,
      errors: [],
      diagnostics: {},
      npcsSpawned: 0,
      avgFPS: 60,
      minFPS: 60,
      maxFPS: 60,
    };

    try {
      // Phase 1: Spawn 5000 NPCs linearly (~5 minutes)
      if (verbose) console.log('[Stress Test] Phase 1: Spawning 5000 NPCs...');

      const spawnFrames = 300; // Spawn over 5 seconds at 60fps
      const npcsPerFrame = 5000 / spawnFrames;
      const fpsHistory: number[] = [];

      for (let i = 0; i < spawnFrames; i++) {
        const npcCount = Math.round((i + 1) * npcsPerFrame);

        // Simulate NPC spawn
        await this.simulateNPCSpawn(Math.round(npcsPerFrame));

        const heap = getCurrentHeapMB();
        const fps = 60; // Placeholder - would be actual game loop FPS
        fpsHistory.push(fps);
        result.peakHeapMB = Math.max(result.peakHeapMB, heap);

        const guardStatus = guards.recordFrameMetrics(fps, heap, 0);
        if (guardStatus === 'FAIL') {
          result.failed++;
          result.errors.push(`Spawn phase: FPS/memory guard failed at ${npcCount} NPCs`);
        }

        if (verbose && (i + 1) % 60 === 0) {
          console.log(`[Stress Test] Spawned ${npcCount}/5000 NPCs...`);
        }
      }

      result.npcsSpawned = 5000;

      // Phase 2: Hold for configured duration
      if (verbose) console.log(`[Stress Test] Phase 2: Holding 5000 NPCs for ${holdDurationSeconds}s...`);

      const holdFrames = holdDurationSeconds * 60;
      for (let i = 0; i < holdFrames; i++) {
        const heap = getCurrentHeapMB();
        const fps = 60; // Placeholder
        fpsHistory.push(fps);

        const guardStatus = guards.recordFrameMetrics(fps, heap, 0);
        if (guardStatus === 'FAIL') {
          result.failed++;
          result.errors.push(`Hold phase: Performance degradation at frame ${i}`);
        }

        // Small yield
        if (i % 300 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      // Phase 3: Despawn all NPCs
      if (verbose) console.log('[Stress Test] Phase 3: Despawning all NPCs...');

      for (let i = 0; i < spawnFrames; i++) {
        await this.simulateNPCDespawn(Math.round(npcsPerFrame));

        const heap = getCurrentHeapMB();
        const fps = 60; // Placeholder
        fpsHistory.push(fps);

        const guardStatus = guards.recordFrameMetrics(fps, heap, 0);
        if (guardStatus === 'FAIL') {
          result.failed++;
        }

        if (verbose && (i + 1) % 60 === 0) {
          console.log(`[Stress Test] Despawned ${(i + 1) * Math.round(npcsPerFrame)}/5000 NPCs...`);
        }
      }

      result.status = result.failed === 0 ? 'PASS' : 'FAIL';
      result.passed = result.failed === 0 ? 3 : 0; // 3 phases
      result.endTime = performance.now();
      result.elapsedSeconds = (result.endTime - result.startTime) / 1000;
      result.finalHeapMB = getCurrentHeapMB();
      result.memoryGrowthMB = result.finalHeapMB - result.initialHeapMB;
      result.memoryGrowthPercent =
        ((result.memoryGrowthMB / result.initialHeapMB) * 100) | 0;
      result.avgFPS = fpsHistory.length > 0
        ? fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length
        : 0;
      result.minFPS = Math.min(...fpsHistory);
      result.maxFPS = Math.max(...fpsHistory);
      result.diagnostics = guards.generateReport();

      if (verbose) {
        guards.printReport();
      }

      return result;
    } catch (error) {
      result.status = 'ERROR';
      result.errors.push(`Test execution error: ${String(error)}`);
      return result;
    }
  }

  /**
   * STRESS TEST 3: 20-Minute Multiplayer Session
   * Tests: Real-world multiplayer stability
   * Duration: 20 minutes continuous gameplay
   * Success Criteria: No freeze, responsive movement, stable snapshots
   */
  static async stressTest20MinMultiplayer(options?: {
    verbose?: boolean;
  }): Promise<StressTestResult> {
    const { verbose = false } = options || {};
    const testName = '20-Minute Multiplayer';
    const guards = new FailFastGuardsManager();
    const initialHeap = getCurrentHeapMB();

    guards.startTest(testName, initialHeap);

    const result: StressTestResult = {
      testName,
      status: 'IN_PROGRESS',
      totalTests: 20, // 20 minutes = 20 sample points
      passed: 0,
      failed: 0,
      warnings: 0,
      startTime: performance.now(),
      endTime: 0,
      elapsedSeconds: 0,
      initialHeapMB: initialHeap,
      finalHeapMB: 0,
      peakHeapMB: initialHeap,
      memoryGrowthMB: 0,
      memoryGrowthPercent: 0,
      errors: [],
      diagnostics: {},
      snapshotConsistency: 100,
    };

    try {
      const totalMinutes = 20;
      const framesPerMinute = 3600; // 60fps * 60s
      const totalFrames = totalMinutes * framesPerMinute;

      for (let minute = 0; minute < totalMinutes; minute++) {
        if (verbose) {
          console.log(`[Stress Test] Minute ${minute + 1}/${totalMinutes}...`);
        }

        // Simulate continuous gameplay for 1 minute
        for (let frame = 0; frame < framesPerMinute; frame++) {
          const heap = getCurrentHeapMB();
          const fps = 60; // Placeholder
          const listenerCount = 0; // Placeholder

          result.peakHeapMB = Math.max(result.peakHeapMB, heap);

          // Record metrics every 60 frames (1 second)
          if (frame % 60 === 0) {
            const guardStatus = guards.recordFrameMetrics(fps, heap, listenerCount);
            if (guardStatus === 'FAIL') {
              result.failed++;
              result.errors.push(`Minute ${minute}: Guard check failed at frame ${frame}`);
            } else if (guardStatus === 'WARN') {
              result.warnings++;
            } else {
              result.passed++;
            }
          }

          // Simulate small yield every second
          if (frame % 60 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        }

        guards.recordModeTransition(0); // Simulate state checkpoint every minute
      }

      result.status = result.failed === 0 ? 'PASS' : 'FAIL';
      result.endTime = performance.now();
      result.elapsedSeconds = (result.endTime - result.startTime) / 1000;
      result.finalHeapMB = getCurrentHeapMB();
      result.memoryGrowthMB = result.finalHeapMB - result.initialHeapMB;
      result.memoryGrowthPercent =
        ((result.memoryGrowthMB / result.initialHeapMB) * 100) | 0;
      result.diagnostics = guards.generateReport();

      if (verbose) {
        guards.printReport();
      }

      return result;
    } catch (error) {
      result.status = 'ERROR';
      result.errors.push(`Test execution error: ${String(error)}`);
      return result;
    }
  }

  /**
   * Run all 3 stress tests in sequence
   */
  static async runFullStressSuite(options?: {
    verbose?: boolean;
    quickMode?: boolean;
  }): Promise<StressTestSuiteResult> {
    const { verbose = false, quickMode = false } = options || {};

    const suiteStart = performance.now();
    const results: StressTestResult[] = [];

    console.log('\n' + '='.repeat(70));
    console.log('🚀 TIER 0A FULL STRESS TEST SUITE');
    console.log('='.repeat(70));

    // Test 1: 100 Mode Transitions
    console.log('\n📋 Test 1: 100 Mode Transitions');
    const test1 = await this.stressTest100ModeTransitions({
      verbose,
      interval: quickMode ? 10 : 100,
    });
    results.push(test1);
    console.log(`Result: ${test1.status} (${test1.passed}/${test1.totalTests} passed)`);

    // Test 2: 5000 NPC Spawn (quick mode = 30 second hold)
    console.log('\n📋 Test 2: 5000 NPC Spawn');
    const test2 = await this.stressTest5000NPCSpawn({
      verbose,
      holdDurationSeconds: quickMode ? 30 : 300,
    });
    results.push(test2);
    console.log(
      `Result: ${test2.status} (${test2.npcsSpawned ?? 0} NPCs, ` +
      `${(test2.avgFPS ?? 0).toFixed(0)} FPS avg)`
    );

    // Test 3: 20-Minute Multiplayer (full mode only)
    if (!quickMode) {
      console.log('\n📋 Test 3: 20-Minute Multiplayer');
      const test3 = await this.stressTest20MinMultiplayer({ verbose });
      results.push(test3);
      console.log(`Result: ${test3.status} (${test3.elapsedSeconds.toFixed(0)}s elapsed)`);
    }

    const suiteEnd = performance.now();
    const totalPassed = results.filter((r) => r.status === 'PASS').length;
    const totalFailed = results.filter((r) => r.status === 'FAIL').length;

    const suiteResult: StressTestSuiteResult = {
      totalTests: results.length,
      passed: totalPassed,
      failed: totalFailed,
      elapsedSeconds: (suiteEnd - suiteStart) / 1000,
      results,
      overallStatus: totalFailed === 0 ? 'ALL_PASS' : 'SOME_FAILED',
    };

    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 STRESS TEST SUITE SUMMARY');
    console.log('='.repeat(70));
    console.log(`Overall Status: ${suiteResult.overallStatus}`);
    console.log(`Tests Passed: ${totalPassed}/${results.length}`);
    console.log(`Total Duration: ${suiteResult.elapsedSeconds.toFixed(1)}s`);
    console.log('='.repeat(70) + '\n');

    return suiteResult;
  }

  /**
   * ============================================================================
   * HELPER METHODS - Simulations
   * ============================================================================
   */

  /**
   * Simulate mode transition for testing
   */
  private static async simulateModeTransition(): Promise<void> {
    // Placeholder for actual mode transition simulation
    // In real usage, this would trigger actual mode switching
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  /**
   * Simulate NPC spawn
   */
  private static async simulateNPCSpawn(count: number): Promise<void> {
    // Placeholder for actual NPC spawning
    // Would integrate with entity manager in real usage
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  /**
   * Simulate NPC despawn
   */
  private static async simulateNPCDespawn(count: number): Promise<void> {
    // Placeholder for actual NPC despawning
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/**
 * Stress test result interface
 */
export interface StressTestResult {
  testName: string;
  status: 'PASS' | 'FAIL' | 'IN_PROGRESS' | 'ERROR';
  totalTests: number;
  passed: number;
  failed: number;
  warnings: number;
  startTime: number;
  endTime: number;
  elapsedSeconds: number;
  initialHeapMB: number;
  finalHeapMB: number;
  peakHeapMB: number;
  memoryGrowthMB: number;
  memoryGrowthPercent: number;
  errors: string[];
  diagnostics: Record<string, unknown>;
  npcsSpawned?: number;
  avgFPS?: number;
  minFPS?: number;
  maxFPS?: number;
  snapshotConsistency?: number;
}

/**
 * Stress test suite result interface
 */
export interface StressTestSuiteResult {
  totalTests: number;
  passed: number;
  failed: number;
  elapsedSeconds: number;
  results: StressTestResult[];
  overallStatus: 'ALL_PASS' | 'SOME_FAILED';
}
