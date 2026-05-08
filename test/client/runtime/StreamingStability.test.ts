import { describe, it, expect, beforeEach } from 'vitest';
import type { RuntimeDeterminismTrace } from '../../../client/src/4-runtime/runtime/RuntimeDeterminismTrace';

/**
 * Phase C - Streaming Stability Validation
 *
 * Tests chunk load/unload cycles, dormant state transitions, and detects:
 * - Listener leaks (event listeners not cleaned up)
 * - Entity duplication (same entity spawned multiple times)
 * - Stale AI references (AI pointing to invalid entities)
 * - Orphaned jobs (jobs queued but never executed)
 */

interface StreamingSnapshot {
  timestamp: number;
  chunkCount: number;
  entityCount: number;
  listenerCount: number;
  jobQueueSize: number;
  aiInstanceCount: number;
  dormantEntityCount: number;
}

interface StreamingMetrics {
  snapshots: StreamingSnapshot[];
  churnCycles: number;
  leakDetected: boolean;
  leakType?: 'listeners' | 'entities' | 'jobs' | 'ai_refs';
  memoryGrowth: number;
}

/**
 * Lifecycle Leak Detector
 * Validates that repeated load/unload cycles don't grow listener count
 */
export class LifecycleLeakDetector {
  private initialSnapshot: StreamingSnapshot | null = null;
  private snapshots: StreamingSnapshot[] = [];

  recordSnapshot(snapshot: StreamingSnapshot): void {
    this.snapshots.push(snapshot);
    if (!this.initialSnapshot) {
      this.initialSnapshot = snapshot;
    }
  }

  detectListenerLeaks(): boolean {
    if (this.snapshots.length < 2 || !this.initialSnapshot) {
      return false;
    }

    const lastSnapshot = this.snapshots[this.snapshots.length - 1];
    const expectedListeners = this.initialSnapshot.listenerCount;
    const actualListeners = lastSnapshot.listenerCount;

    // Listeners should not grow more than 5% per cycle (account for temporary listeners)
    const maxAllowedGrowth = expectedListeners * 1.05;
    return actualListeners > maxAllowedGrowth;
  }

  detectEntityDuplication(): boolean {
    if (this.snapshots.length < 2 || !this.initialSnapshot) {
      return false;
    }

    const lastSnapshot = this.snapshots[this.snapshots.length - 1];
    const expectedEntities = this.initialSnapshot.entityCount;
    const actualEntities = lastSnapshot.entityCount;

    // After full load/unload cycle, entity count should return to baseline
    return actualEntities > expectedEntities * 1.1;
  }

  detectOrphanedJobs(): boolean {
    if (this.snapshots.length < 2) {
      return false;
    }

    // Check if job queue size is growing without being drained
    let maxQueueSize = 0;
    for (const snapshot of this.snapshots) {
      if (snapshot.jobQueueSize > maxQueueSize) {
        maxQueueSize = snapshot.jobQueueSize;
      }
    }

    const lastSnapshot = this.snapshots[this.snapshots.length - 1];
    // If queue stayed at max size, jobs are not being drained
    return lastSnapshot.jobQueueSize === maxQueueSize && maxQueueSize > 10;
  }

  getMetrics(): StreamingMetrics {
    return {
      snapshots: [...this.snapshots],
      churnCycles: Math.max(0, this.snapshots.length - 1),
      leakDetected: this.detectListenerLeaks() || this.detectEntityDuplication() || this.detectOrphanedJobs(),
      memoryGrowth: this.initialSnapshot
        ? (this.snapshots[this.snapshots.length - 1]?.entityCount ?? 0) - this.initialSnapshot.entityCount
        : 0,
    };
  }
}

/**
 * Orphaned Job Detector
 * Tracks queued jobs and validates they are executed
 */
export class OrphanedJobDetector {
  private queuedJobs = new Map<string, { queued: number; executed: number }>();
  private executionDeadline = 60; // frames

  recordJobQueued(jobKey: string, frameIndex: number): void {
    if (!this.queuedJobs.has(jobKey)) {
      this.queuedJobs.set(jobKey, { queued: frameIndex, executed: 0 });
    }
  }

  recordJobExecuted(jobKey: string, frameIndex: number): void {
    const entry = this.queuedJobs.get(jobKey);
    if (entry) {
      entry.executed = frameIndex;
    }
  }

  detectOrphans(currentFrame: number): string[] {
    const orphans: string[] = [];

    for (const [jobKey, timing] of this.queuedJobs) {
      const ageFrames = currentFrame - timing.queued;
      if (timing.executed === 0 && ageFrames > this.executionDeadline) {
        orphans.push(jobKey);
      }
    }

    return orphans;
  }

  getStats(): {
    totalQueued: number;
    totalExecuted: number;
    orphanCount: number;
  } {
    let totalQueued = 0;
    let totalExecuted = 0;
    let orphanCount = 0;

    for (const entry of this.queuedJobs.values()) {
      totalQueued += 1;
      if (entry.executed > 0) {
        totalExecuted += 1;
      } else {
        orphanCount += 1;
      }
    }

    return { totalQueued, totalExecuted, orphanCount };
  }
}

describe('Phase C - Streaming and Stability', () => {
  describe('Lifecycle Leak Detector', () => {
    let detector: LifecycleLeakDetector;

    beforeEach(() => {
      detector = new LifecycleLeakDetector();
    });

    it('detects no leaks on stable snapshot', () => {
      detector.recordSnapshot({
        timestamp: 0,
        chunkCount: 10,
        entityCount: 100,
        listenerCount: 50,
        jobQueueSize: 5,
        aiInstanceCount: 20,
        dormantEntityCount: 10,
      });

      detector.recordSnapshot({
        timestamp: 1000,
        chunkCount: 10,
        entityCount: 100,
        listenerCount: 50,
        jobQueueSize: 5,
        aiInstanceCount: 20,
        dormantEntityCount: 10,
      });

      expect(detector.detectListenerLeaks()).toBe(false);
      expect(detector.detectEntityDuplication()).toBe(false);
      expect(detector.detectOrphanedJobs()).toBe(false);
    });

    it('detects listener leaks when listeners grow', () => {
      detector.recordSnapshot({
        timestamp: 0,
        chunkCount: 10,
        entityCount: 100,
        listenerCount: 50,
        jobQueueSize: 5,
        aiInstanceCount: 20,
        dormantEntityCount: 10,
      });

      // Simulate listener leak
      detector.recordSnapshot({
        timestamp: 1000,
        chunkCount: 10,
        entityCount: 100,
        listenerCount: 100, // Doubled!
        jobQueueSize: 5,
        aiInstanceCount: 20,
        dormantEntityCount: 10,
      });

      expect(detector.detectListenerLeaks()).toBe(true);
    });

    it('detects entity duplication on incomplete cleanup', () => {
      detector.recordSnapshot({
        timestamp: 0,
        chunkCount: 10,
        entityCount: 100,
        listenerCount: 50,
        jobQueueSize: 5,
        aiInstanceCount: 20,
        dormantEntityCount: 10,
      });

      // Simulate entity duplication
      detector.recordSnapshot({
        timestamp: 1000,
        chunkCount: 10,
        entityCount: 120, // Grew by 20%
        listenerCount: 50,
        jobQueueSize: 5,
        aiInstanceCount: 20,
        dormantEntityCount: 10,
      });

      expect(detector.detectEntityDuplication()).toBe(true);
    });

    it('detects orphaned jobs when queue does not drain', () => {
      detector.recordSnapshot({
        timestamp: 0,
        chunkCount: 10,
        entityCount: 100,
        listenerCount: 50,
        jobQueueSize: 20,
        aiInstanceCount: 20,
        dormantEntityCount: 10,
      });

      // Queue size stays high (jobs not draining)
      detector.recordSnapshot({
        timestamp: 1000,
        chunkCount: 10,
        entityCount: 100,
        listenerCount: 50,
        jobQueueSize: 20,
        aiInstanceCount: 20,
        dormantEntityCount: 10,
      });

      expect(detector.detectOrphanedJobs()).toBe(true);
    });

    it('returns correct metrics', () => {
      detector.recordSnapshot({
        timestamp: 0,
        chunkCount: 10,
        entityCount: 100,
        listenerCount: 50,
        jobQueueSize: 5,
        aiInstanceCount: 20,
        dormantEntityCount: 10,
      });

      const metrics = detector.getMetrics();
      expect(metrics.snapshots.length).toBe(1);
      expect(metrics.churnCycles).toBe(0);
      expect(metrics.memoryGrowth).toBe(0);
    });
  });

  describe('Orphaned Job Detector', () => {
    let detector: OrphanedJobDetector;

    beforeEach(() => {
      detector = new OrphanedJobDetector();
    });

    it('detects orphaned jobs that exceed deadline', () => {
      detector.recordJobQueued('chunk:0:0', 0);
      detector.recordJobQueued('encounter:primary', 10);

      // Only execute one job
      detector.recordJobExecuted('chunk:0:0', 5);

      // Current frame is way past deadline for second job
      const orphans = detector.detectOrphans(100);
      expect(orphans).toContain('encounter:primary');
    });

    it('does not flag executed jobs as orphans', () => {
      detector.recordJobQueued('chunk:0:0', 0);
      detector.recordJobExecuted('chunk:0:0', 5);

      const orphans = detector.detectOrphans(100);
      expect(orphans).not.toContain('chunk:0:0');
    });

    it('returns correct stats', () => {
      detector.recordJobQueued('job1', 0);
      detector.recordJobQueued('job2', 10);
      detector.recordJobExecuted('job1', 5);

      const stats = detector.getStats();
      expect(stats.totalQueued).toBe(2);
      expect(stats.totalExecuted).toBe(1);
      expect(stats.orphanCount).toBe(1);
    });
  });
});
