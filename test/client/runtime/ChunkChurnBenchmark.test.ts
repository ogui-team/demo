import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Phase C - Chunk Churn Benchmark
 * Stress-tests repeated chunk load/unload cycles
 */

export interface ChunkChurnMetrics {
  totalCycles: number;
  cycleTimeMs: number;
  avgListenerGrowth: number;
  avgEntityGrowth: number;
  maxListenerCount: number;
  maxEntityCount: number;
  leaksDetected: boolean;
}

export class ChunkChurnBenchmark {
  private cycleMetrics: Array<{ listeners: number; entities: number }> = [];

  recordCycle(listenerCount: number, entityCount: number): void {
    this.cycleMetrics.push({ listeners: listenerCount, entities: entityCount });
  }

  analyze(): ChunkChurnMetrics {
    if (this.cycleMetrics.length < 2) {
      return {
        totalCycles: this.cycleMetrics.length,
        cycleTimeMs: 0,
        avgListenerGrowth: 0,
        avgEntityGrowth: 0,
        maxListenerCount: 0,
        maxEntityCount: 0,
        leaksDetected: false,
      };
    }

    let totalListenerGrowth = 0;
    let totalEntityGrowth = 0;
    let maxListeners = 0;
    let maxEntities = 0;

    for (let i = 1; i < this.cycleMetrics.length; i++) {
      const prev = this.cycleMetrics[i - 1];
      const curr = this.cycleMetrics[i];
      totalListenerGrowth += Math.max(0, curr.listeners - prev.listeners);
      totalEntityGrowth += Math.max(0, curr.entities - prev.entities);
      maxListeners = Math.max(maxListeners, curr.listeners);
      maxEntities = Math.max(maxEntities, curr.entities);
    }

    const avgListenerGrowth = totalListenerGrowth / (this.cycleMetrics.length - 1);
    const avgEntityGrowth = totalEntityGrowth / (this.cycleMetrics.length - 1);

    // Leak detected if growth per cycle exceeds 1% of baseline
    const baseline = this.cycleMetrics[0];
    const leaksDetected = avgListenerGrowth > baseline.listeners * 0.01 || avgEntityGrowth > baseline.entities * 0.01;

    return {
      totalCycles: this.cycleMetrics.length,
      cycleTimeMs: 0,
      avgListenerGrowth,
      avgEntityGrowth,
      maxListenerCount: maxListeners,
      maxEntityCount: maxEntities,
      leaksDetected,
    };
  }
}

/**
 * Dormant State Validator
 * Validates entities in dormant state are properly serialized
 */
export interface DormantEntity {
  entityId: string;
  chunkId: string;
  serialized: boolean;
  lastWakeFrame: number;
  positionValid: boolean;
}

export class DormantStateValidator {
  private dormantEntities = new Map<string, DormantEntity>();

  recordDormantEntity(entity: DormantEntity): void {
    this.dormantEntities.set(entity.entityId, entity);
  }

  validateSerialization(): { valid: number; invalid: number; orphans: string[] } {
    let valid = 0;
    let invalid = 0;
    const orphans: string[] = [];

    for (const [id, entity] of this.dormantEntities) {
      if (!entity.serialized) {
        invalid += 1;
        orphans.push(id);
      } else if (!entity.positionValid) {
        invalid += 1;
      } else {
        valid += 1;
      }
    }

    return { valid, invalid, orphans };
  }

  getTotalDormant(): number {
    return this.dormantEntities.size;
  }

  getOrphanedEntities(): string[] {
    const orphans: string[] = [];
    for (const [id, entity] of this.dormantEntities) {
      if (!entity.serialized) {
        orphans.push(id);
      }
    }
    return orphans;
  }
}

describe('Phase C - Chunk Churn and Dormant Validation', () => {
  describe('ChunkChurnBenchmark', () => {
    let benchmark: ChunkChurnBenchmark;

    beforeEach(() => {
      benchmark = new ChunkChurnBenchmark();
    });

    it('reports stable metrics when cycles are stable', () => {
      benchmark.recordCycle(50, 100);
      benchmark.recordCycle(50, 100);
      benchmark.recordCycle(50, 100);

      const metrics = benchmark.analyze();
      expect(metrics.totalCycles).toBe(3);
      expect(metrics.avgListenerGrowth).toBe(0);
      expect(metrics.avgEntityGrowth).toBe(0);
      expect(metrics.leaksDetected).toBe(false);
    });

    it('detects listener leaks on growing baseline', () => {
      benchmark.recordCycle(50, 100);
      benchmark.recordCycle(51, 100);
      benchmark.recordCycle(52, 100);

      const metrics = benchmark.analyze();
      expect(metrics.leaksDetected).toBe(true);
      expect(metrics.avgListenerGrowth).toBeGreaterThan(0);
    });

    it('detects entity leaks independently', () => {
      benchmark.recordCycle(50, 100);
      benchmark.recordCycle(50, 105);
      benchmark.recordCycle(50, 110);

      const metrics = benchmark.analyze();
      expect(metrics.leaksDetected).toBe(true);
      expect(metrics.avgEntityGrowth).toBeGreaterThan(0);
    });

    it('reports maximum resource counts', () => {
      benchmark.recordCycle(40, 80);
      benchmark.recordCycle(60, 120);
      benchmark.recordCycle(50, 100);

      const metrics = benchmark.analyze();
      expect(metrics.maxListenerCount).toBe(60);
      expect(metrics.maxEntityCount).toBe(120);
    });
  });

  describe('DormantStateValidator', () => {
    let validator: DormantStateValidator;

    beforeEach(() => {
      validator = new DormantStateValidator();
    });

    it('validates serialized dormant entities', () => {
      validator.recordDormantEntity({
        entityId: 'ent:1',
        chunkId: 'chunk:0:0',
        serialized: true,
        lastWakeFrame: 100,
        positionValid: true,
      });

      validator.recordDormantEntity({
        entityId: 'ent:2',
        chunkId: 'chunk:0:0',
        serialized: true,
        lastWakeFrame: 105,
        positionValid: true,
      });

      const result = validator.validateSerialization();
      expect(result.valid).toBe(2);
      expect(result.invalid).toBe(0);
      expect(result.orphans).toHaveLength(0);
    });

    it('detects unserializable dormant entities', () => {
      validator.recordDormantEntity({
        entityId: 'ent:1',
        chunkId: 'chunk:0:0',
        serialized: false,
        lastWakeFrame: 100,
        positionValid: true,
      });

      const result = validator.validateSerialization();
      expect(result.invalid).toBe(1);
      expect(result.orphans).toContain('ent:1');
    });

    it('detects invalid positions in dormant state', () => {
      validator.recordDormantEntity({
        entityId: 'ent:1',
        chunkId: 'chunk:0:0',
        serialized: true,
        lastWakeFrame: 100,
        positionValid: false,
      });

      const result = validator.validateSerialization();
      expect(result.invalid).toBe(1);
      expect(result.valid).toBe(0);
    });

    it('tracks total dormant entities', () => {
      validator.recordDormantEntity({
        entityId: 'ent:1',
        chunkId: 'chunk:0:0',
        serialized: true,
        lastWakeFrame: 100,
        positionValid: true,
      });

      validator.recordDormantEntity({
        entityId: 'ent:2',
        chunkId: 'chunk:0:1',
        serialized: true,
        lastWakeFrame: 105,
        positionValid: true,
      });

      expect(validator.getTotalDormant()).toBe(2);
    });

    it('returns list of orphaned entities', () => {
      validator.recordDormantEntity({
        entityId: 'ent:1',
        chunkId: 'chunk:0:0',
        serialized: true,
        lastWakeFrame: 100,
        positionValid: true,
      });

      validator.recordDormantEntity({
        entityId: 'ent:2',
        chunkId: 'chunk:0:0',
        serialized: false,
        lastWakeFrame: 105,
        positionValid: true,
      });

      const orphans = validator.getOrphanedEntities();
      expect(orphans).toContain('ent:2');
      expect(orphans).not.toContain('ent:1');
    });
  });
});
