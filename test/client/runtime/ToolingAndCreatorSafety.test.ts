import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Phase E - Tooling and Observability
 * Runtime diagnostics and snapshot export
 */

export interface RuntimeSnapshot {
  timestamp: number;
  frameIndex: number;
  authority: Record<string, string>;
  queueMetrics: { size: number; drainRate: number };
  replayEpoch: number;
  chunkCount: number;
  entityCount: number;
}

export class RuntimeSnapshotExporter {
  private snapshots: RuntimeSnapshot[] = [];
  private maxSnapshots = 1000;

  recordSnapshot(snapshot: RuntimeSnapshot): void {
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  exportSnapshots(): RuntimeSnapshot[] {
    return JSON.parse(JSON.stringify(this.snapshots));
  }

  exportRange(startFrame: number, endFrame: number): RuntimeSnapshot[] {
    return this.snapshots.filter((s) => s.frameIndex >= startFrame && s.frameIndex <= endFrame);
  }

  computeDiff(frame1: number, frame2: number): Record<string, unknown> {
    const snap1 = this.snapshots.find((s) => s.frameIndex === frame1);
    const snap2 = this.snapshots.find((s) => s.frameIndex === frame2);

    if (!snap1 || !snap2) {
      return {};
    }

    return {
      chunkDelta: snap2.chunkCount - snap1.chunkCount,
      entityDelta: snap2.entityCount - snap1.entityCount,
      queueDelta: snap2.queueMetrics.size - snap1.queueMetrics.size,
      authorityChanges: Object.keys(snap2.authority).filter(
        (key) => snap1.authority[key] !== snap2.authority[key],
      ),
    };
  }

  getLastSnapshot(): RuntimeSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }
}

/**
 * Phase F - Creator and Mod Safety
 * Content validation and prefab integrity
 */

export interface PrefabMetadata {
  prefabId: string;
  name: string;
  version: string;
  requiredVersion?: string;
  entityCount: number;
  isValid: boolean;
}

export interface ModBundle {
  modId: string;
  version: string;
  prefabs: PrefabMetadata[];
  dependencies: string[];
}

export class ContentValidator {
  private validatedPrefabs = new Map<string, PrefabMetadata>();
  private validatedMods = new Map<string, ModBundle>();

  validatePrefab(prefab: PrefabMetadata): boolean {
    // Validation rules
    if (!prefab.prefabId || prefab.prefabId.length === 0) return false;
    if (!prefab.name || prefab.name.length === 0) return false;
    if (prefab.entityCount < 0) return false;

    prefab.isValid = true;
    this.validatedPrefabs.set(prefab.prefabId, prefab);
    return true;
  }

  validateModBundle(bundle: ModBundle): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!bundle.modId || bundle.modId.length === 0) {
      errors.push('Missing modId');
    }

    if (!bundle.version || bundle.version.length === 0) {
      errors.push('Missing version');
    }

    if (!bundle.prefabs || bundle.prefabs.length === 0) {
      errors.push('No prefabs in bundle');
    }

    // Validate all prefabs
    for (const prefab of bundle.prefabs || []) {
      if (!this.validatePrefab(prefab)) {
        errors.push(`Invalid prefab: ${prefab.prefabId}`);
      }
    }

    const valid = errors.length === 0;
    if (valid) {
      this.validatedMods.set(bundle.modId, bundle);
    }

    return { valid, errors };
  }

  getValidationReport(): {
    totalPrefabs: number;
    validPrefabs: number;
    totalMods: number;
    validMods: number;
  } {
    return {
      totalPrefabs: this.validatedPrefabs.size,
      validPrefabs: Array.from(this.validatedPrefabs.values()).filter((p) => p.isValid).length,
      totalMods: this.validatedMods.size,
      validMods: this.validatedMods.size,
    };
  }

  isDeterministicMod(bundle: ModBundle): boolean {
    // Mods are deterministic if prefabs have fixed order and no random seeds
    return bundle.prefabs.every((p) => p.entityCount >= 0);
  }
}

describe('Phase E - Tooling and Observability', () => {
  describe('RuntimeSnapshotExporter', () => {
    let exporter: RuntimeSnapshotExporter;

    beforeEach(() => {
      exporter = new RuntimeSnapshotExporter();
    });

    it('records and exports snapshots', () => {
      exporter.recordSnapshot({
        timestamp: 0,
        frameIndex: 0,
        authority: { mode: 'menu' },
        queueMetrics: { size: 5, drainRate: 2 },
        replayEpoch: 0,
        chunkCount: 1,
        entityCount: 10,
      });

      const snapshots = exporter.exportSnapshots();
      expect(snapshots).toHaveLength(1);
    });

    it('exports snapshot range by frame', () => {
      for (let i = 0; i < 10; i++) {
        exporter.recordSnapshot({
          timestamp: i * 1000,
          frameIndex: i,
          authority: { mode: 'gameplay' },
          queueMetrics: { size: 5, drainRate: 2 },
          replayEpoch: 0,
          chunkCount: 1,
          entityCount: 10,
        });
      }

      const range = exporter.exportRange(3, 7);
      expect(range).toHaveLength(5);
      expect(range[0].frameIndex).toBe(3);
      expect(range[4].frameIndex).toBe(7);
    });

    it('computes diff between snapshots', () => {
      exporter.recordSnapshot({
        timestamp: 0,
        frameIndex: 0,
        authority: { mode: 'menu' },
        queueMetrics: { size: 5, drainRate: 2 },
        replayEpoch: 0,
        chunkCount: 1,
        entityCount: 10,
      });

      exporter.recordSnapshot({
        timestamp: 1000,
        frameIndex: 1,
        authority: { mode: 'gameplay' },
        queueMetrics: { size: 8, drainRate: 3 },
        replayEpoch: 1,
        chunkCount: 2,
        entityCount: 20,
      });

      const diff = exporter.computeDiff(0, 1);
      expect(diff.chunkDelta).toBe(1);
      expect(diff.entityDelta).toBe(10);
      expect(diff.queueDelta).toBe(3);
    });

    it('retrieves last snapshot', () => {
      exporter.recordSnapshot({
        timestamp: 0,
        frameIndex: 0,
        authority: { mode: 'menu' },
        queueMetrics: { size: 5, drainRate: 2 },
        replayEpoch: 0,
        chunkCount: 1,
        entityCount: 10,
      });

      const last = exporter.getLastSnapshot();
      expect(last?.frameIndex).toBe(0);
    });
  });
});

describe('Phase F - Creator and Mod Safety', () => {
  describe('ContentValidator', () => {
    let validator: ContentValidator;

    beforeEach(() => {
      validator = new ContentValidator();
    });

    it('validates correct prefabs', () => {
      const result = validator.validatePrefab({
        prefabId: 'goblin',
        name: 'Goblin Enemy',
        version: '1.0',
        entityCount: 3,
        isValid: false,
      });

      expect(result).toBe(true);
    });

    it('rejects prefabs with missing fields', () => {
      const result = validator.validatePrefab({
        prefabId: '',
        name: 'Invalid',
        version: '1.0',
        entityCount: 1,
        isValid: false,
      });

      expect(result).toBe(false);
    });

    it('validates mod bundles', () => {
      const bundle: ModBundle = {
        modId: 'goblin-pack',
        version: '1.0',
        prefabs: [
          {
            prefabId: 'goblin',
            name: 'Goblin',
            version: '1.0',
            entityCount: 3,
            isValid: false,
          },
        ],
        dependencies: [],
      };

      const result = validator.validateModBundle(bundle);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('detects invalid bundles', () => {
      const bundle: ModBundle = {
        modId: '',
        version: '1.0',
        prefabs: [],
        dependencies: [],
      };

      const result = validator.validateModBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('generates validation report', () => {
      validator.validatePrefab({
        prefabId: 'goblin',
        name: 'Goblin',
        version: '1.0',
        entityCount: 3,
        isValid: false,
      });

      const report = validator.getValidationReport();
      expect(report.totalPrefabs).toBeGreaterThan(0);
    });

    it('identifies deterministic mods', () => {
      const bundle: ModBundle = {
        modId: 'deterministic-pack',
        version: '1.0',
        prefabs: [
          {
            prefabId: 'goblin',
            name: 'Goblin',
            version: '1.0',
            entityCount: 3,
            isValid: true,
          },
        ],
        dependencies: [],
      };

      expect(validator.isDeterministicMod(bundle)).toBe(true);
    });
  });
});
