import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Phase D - Scale and Performance Validation
 * Validates frame budget, memory growth, and runtime queue pressure
 */

export interface FrameBudgetSnapshot {
  frameIndex: number;
  frameTimeMs: number;
  targetFrameTimeMs: number;
  exceeds: boolean;
}

export class FrameBudgetValidator {
  private snapshots: FrameBudgetSnapshot[] = [];
  private targetFrameTimeMs: number;
  private maxBudgetExceeds: number;

  constructor(targetFrameTimeMs = 16.67, maxBudgetExceeds = 3) {
    // 16.67ms = 60fps, allow 3 consecutive frames to exceed
    this.targetFrameTimeMs = targetFrameTimeMs;
    this.maxBudgetExceeds = maxBudgetExceeds;
  }

  recordFrameTime(frameIndex: number, frameTimeMs: number): void {
    this.snapshots.push({
      frameIndex,
      frameTimeMs,
      targetFrameTimeMs: this.targetFrameTimeMs,
      exceeds: frameTimeMs > this.targetFrameTimeMs,
    });
  }

  validateBudget(): { compliant: boolean; violationCount: number; maxConsecutiveViolations: number } {
    let violationCount = 0;
    let maxConsecutive = 0;
    let currentConsecutive = 0;

    for (const snapshot of this.snapshots) {
      if (snapshot.exceeds) {
        violationCount += 1;
        currentConsecutive += 1;
        maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
      } else {
        currentConsecutive = 0;
      }
    }

    const compliant = maxConsecutive <= this.maxBudgetExceeds;
    return { compliant, violationCount, maxConsecutiveViolations: maxConsecutive };
  }

  getMetrics(): { totalFrames: number; avgFrameTime: number; maxFrameTime: number; minFrameTime: number } {
    if (this.snapshots.length === 0) {
      return { totalFrames: 0, avgFrameTime: 0, maxFrameTime: 0, minFrameTime: 0 };
    }

    let total = 0;
    let max = 0;
    let min = Number.MAX_VALUE;

    for (const snapshot of this.snapshots) {
      total += snapshot.frameTimeMs;
      max = Math.max(max, snapshot.frameTimeMs);
      min = Math.min(min, snapshot.frameTimeMs);
    }

    return {
      totalFrames: this.snapshots.length,
      avgFrameTime: total / this.snapshots.length,
      maxFrameTime: max,
      minFrameTime: min,
    };
  }
}

/**
 * Memory Growth Tracker
 * Validates sustained load doesn't cause unbounded memory growth
 */
export interface MemorySnapshot {
  sampleIndex: number;
  heapUsedMb: number;
  chunkCount: number;
  entityCount: number;
}

export class MemoryGrowthTracker {
  private snapshots: MemorySnapshot[] = [];
  private maxAllowedGrowthPercentPerSample = 0.5; // 0.5% per sample

  recordSnapshot(snapshot: MemorySnapshot): void {
    this.snapshots.push(snapshot);
  }

  detectUnboundedGrowth(): { detected: boolean; growthRate: number } {
    if (this.snapshots.length < 2) {
      return { detected: false, growthRate: 0 };
    }

    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    const growthPercent = ((last.heapUsedMb - first.heapUsedMb) / first.heapUsedMb) * 100;
    const maxAllowedGrowth = this.maxAllowedGrowthPercentPerSample * this.snapshots.length;

    return {
      detected: growthPercent > maxAllowedGrowth,
      growthRate: growthPercent / this.snapshots.length,
    };
  }

  getMemoryMetrics(): { startHeap: number; endHeap: number; totalGrowth: number; avgGrowthPerSample: number } {
    if (this.snapshots.length === 0) {
      return { startHeap: 0, endHeap: 0, totalGrowth: 0, avgGrowthPerSample: 0 };
    }

    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    const totalGrowth = last.heapUsedMb - first.heapUsedMb;

    return {
      startHeap: first.heapUsedMb,
      endHeap: last.heapUsedMb,
      totalGrowth,
      avgGrowthPerSample: totalGrowth / (this.snapshots.length - 1),
    };
  }
}

/**
 * Queue Pressure Analyzer
 * Tracks runtime job queue depth and drain rates
 */
export interface QueueSnapshot {
  frameIndex: number;
  queueSize: number;
  drainedCount: number;
  enqueuedCount: number;
}

export class QueuePressureAnalyzer {
  private snapshots: QueueSnapshot[] = [];
  private maxAllowedQueueSize = 500;

  recordSnapshot(snapshot: QueueSnapshot): void {
    this.snapshots.push(snapshot);
  }

  detectQueueBackpressure(): { detected: boolean; maxQueueSize: number } {
    let maxQueue = 0;
    for (const snapshot of this.snapshots) {
      maxQueue = Math.max(maxQueue, snapshot.queueSize);
    }

    return {
      detected: maxQueue > this.maxAllowedQueueSize,
      maxQueueSize: maxQueue,
    };
  }

  calculateDrainRate(): number {
    if (this.snapshots.length < 2) {
      return 0;
    }

    let totalDrained = 0;
    for (const snapshot of this.snapshots) {
      totalDrained += snapshot.drainedCount;
    }

    return totalDrained / this.snapshots.length;
  }

  getQueueMetrics(): { avgQueueSize: number; maxQueueSize: number; avgDrainPerFrame: number } {
    if (this.snapshots.length === 0) {
      return { avgQueueSize: 0, maxQueueSize: 0, avgDrainPerFrame: 0 };
    }

    let totalQueue = 0;
    let maxQueue = 0;
    let totalDrained = 0;

    for (const snapshot of this.snapshots) {
      totalQueue += snapshot.queueSize;
      maxQueue = Math.max(maxQueue, snapshot.queueSize);
      totalDrained += snapshot.drainedCount;
    }

    return {
      avgQueueSize: totalQueue / this.snapshots.length,
      maxQueueSize: maxQueue,
      avgDrainPerFrame: totalDrained / this.snapshots.length,
    };
  }
}

describe('Phase D - Scale and Performance Validation', () => {
  describe('FrameBudgetValidator', () => {
    let validator: FrameBudgetValidator;

    beforeEach(() => {
      validator = new FrameBudgetValidator(16.67, 3);
    });

    it('validates compliant frame times', () => {
      validator.recordFrameTime(1, 10);
      validator.recordFrameTime(2, 12);
      validator.recordFrameTime(3, 14);

      const result = validator.validateBudget();
      expect(result.compliant).toBe(true);
      expect(result.violationCount).toBe(0);
    });

    it('detects single frame violations', () => {
      validator.recordFrameTime(1, 10);
      validator.recordFrameTime(2, 25); // Exceeds 16.67ms
      validator.recordFrameTime(3, 12);

      const result = validator.validateBudget();
      expect(result.violationCount).toBe(1);
    });

    it('tolerates short violation streaks', () => {
      validator.recordFrameTime(1, 20);
      validator.recordFrameTime(2, 20);
      validator.recordFrameTime(3, 20);
      validator.recordFrameTime(4, 10);

      const result = validator.validateBudget();
      expect(result.compliant).toBe(true);
      expect(result.maxConsecutiveViolations).toBe(3);
    });

    it('fails on sustained violations', () => {
      validator.recordFrameTime(1, 20);
      validator.recordFrameTime(2, 20);
      validator.recordFrameTime(3, 20);
      validator.recordFrameTime(4, 20);

      const result = validator.validateBudget();
      expect(result.compliant).toBe(false);
    });

    it('reports correct metrics', () => {
      validator.recordFrameTime(1, 10);
      validator.recordFrameTime(2, 15);
      validator.recordFrameTime(3, 20);

      const metrics = validator.getMetrics();
      expect(metrics.totalFrames).toBe(3);
      expect(metrics.avgFrameTime).toBeCloseTo(15);
      expect(metrics.maxFrameTime).toBe(20);
      expect(metrics.minFrameTime).toBe(10);
    });
  });

  describe('MemoryGrowthTracker', () => {
    let tracker: MemoryGrowthTracker;

    beforeEach(() => {
      tracker = new MemoryGrowthTracker();
    });

    it('detects stable memory', () => {
      tracker.recordSnapshot({ sampleIndex: 0, heapUsedMb: 100, chunkCount: 10, entityCount: 100 });
      tracker.recordSnapshot({ sampleIndex: 1, heapUsedMb: 100.5, chunkCount: 10, entityCount: 100 });

      const result = tracker.detectUnboundedGrowth();
      expect(result.detected).toBe(false);
    });

    it('detects unbounded growth', () => {
      tracker.recordSnapshot({ sampleIndex: 0, heapUsedMb: 100, chunkCount: 10, entityCount: 100 });

      for (let i = 1; i <= 100; i++) {
        tracker.recordSnapshot({
          sampleIndex: i,
          heapUsedMb: 100 + i, // Growing linearly
          chunkCount: 10,
          entityCount: 100,
        });
      }

      const result = tracker.detectUnboundedGrowth();
      expect(result.detected).toBe(true);
    });

    it('reports memory metrics', () => {
      tracker.recordSnapshot({ sampleIndex: 0, heapUsedMb: 100, chunkCount: 10, entityCount: 100 });
      tracker.recordSnapshot({ sampleIndex: 1, heapUsedMb: 105, chunkCount: 10, entityCount: 100 });

      const metrics = tracker.getMemoryMetrics();
      expect(metrics.startHeap).toBe(100);
      expect(metrics.endHeap).toBe(105);
      expect(metrics.totalGrowth).toBe(5);
    });
  });

  describe('QueuePressureAnalyzer', () => {
    let analyzer: QueuePressureAnalyzer;

    beforeEach(() => {
      analyzer = new QueuePressureAnalyzer();
    });

    it('detects healthy queue drain', () => {
      analyzer.recordSnapshot({ frameIndex: 1, queueSize: 10, drainedCount: 8, enqueuedCount: 3 });
      analyzer.recordSnapshot({ frameIndex: 2, queueSize: 5, drainedCount: 10, enqueuedCount: 2 });

      const backpressure = analyzer.detectQueueBackpressure();
      expect(backpressure.detected).toBe(false);
    });

    it('detects queue backpressure', () => {
      for (let i = 0; i < 10; i++) {
        analyzer.recordSnapshot({
          frameIndex: i,
          queueSize: 600, // Exceeds max of 500
          drainedCount: 5,
          enqueuedCount: 50,
        });
      }

      const backpressure = analyzer.detectQueueBackpressure();
      expect(backpressure.detected).toBe(true);
      expect(backpressure.maxQueueSize).toBe(600);
    });

    it('calculates drain rate', () => {
      analyzer.recordSnapshot({ frameIndex: 1, queueSize: 10, drainedCount: 8, enqueuedCount: 3 });
      analyzer.recordSnapshot({ frameIndex: 2, queueSize: 5, drainedCount: 10, enqueuedCount: 2 });

      const drainRate = analyzer.calculateDrainRate();
      expect(drainRate).toBeCloseTo(9);
    });

    it('reports queue metrics', () => {
      analyzer.recordSnapshot({ frameIndex: 1, queueSize: 100, drainedCount: 8, enqueuedCount: 3 });
      analyzer.recordSnapshot({ frameIndex: 2, queueSize: 50, drainedCount: 10, enqueuedCount: 2 });

      const metrics = analyzer.getQueueMetrics();
      expect(metrics.avgQueueSize).toBeCloseTo(75);
      expect(metrics.maxQueueSize).toBe(100);
      expect(metrics.avgDrainPerFrame).toBe(9);
    });
  });
});
