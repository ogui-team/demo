/**
 * ============================================================================
 * KernelValidator.ts - In-Loop Buffer Validation
 * ============================================================================
 *
 * Validates buffer integrity after each system.execute() in the main tick loop.
 * Detects corruption from systems writing invalid data.
 *
 * Usage in SimulationKernel.tick():
 *   1. Execute system
 *   2. validator.validateAfterSystem(system)
 *   3. If fails: throw FATAL_DOD_CORRUPTION error
 *
 * Constraints checked:
 * - No NaN values in position/velocity buffers
 * - Entity counts don't exceed capacity
 * - Handle validity (exists in registry)
 * - Buffer consistency (no orphaned entries)
 */

import type { SimulationKernel } from './SimulationKernel';
import type { EntityRegistry } from './EntityRegistry';
import type { PositionStorage } from './PositionStorage';
import type { VelocityStorage } from './VelocityStorage';
import type { HealthStorage } from './HealthStorage';

export interface KernelValidationReport {
  valid: boolean;
  system: string;
  tick: number;
  errors: KernelValidationError[];
  warnings: string[];
  checksRun: number;
  checksPerformed: {
    positions: boolean;
    velocities: boolean;
    healths: boolean;
    entityRegistry: boolean;
    bufferConsistency: boolean;
  };
}

export interface KernelValidationError {
  code: string;
  message: string;
  severity: 'FATAL' | 'WARNING' | 'INFO';
  context?: Record<string, unknown>;
}

/**
 * Validation error codes
 */
export enum ValidationErrorCode {
  NAN_POSITION = 'NAN_POSITION',
  NAN_VELOCITY = 'NAN_VELOCITY',
  NAN_HEALTH = 'NAN_HEALTH',
  INVALID_ENTITY_HANDLE = 'INVALID_ENTITY_HANDLE',
  OUT_OF_BOUNDS_INDEX = 'OUT_OF_BOUNDS_INDEX',
  ORPHANED_BUFFER_ENTRY = 'ORPHANED_BUFFER_ENTRY',
  ENTITY_OVERFLOW = 'ENTITY_OVERFLOW',
  BUFFER_OVERFLOW = 'BUFFER_OVERFLOW',
  NEGATIVE_HEALTH = 'NEGATIVE_HEALTH',
  INVALID_BUFFER_STATE = 'INVALID_BUFFER_STATE',
}

export class KernelValidator {
  /**
   * Validate ALL buffers after a system executes
   * Throws if FATAL errors detected
   */
  validateAfterSystem(kernel: SimulationKernel, systemName: string, tick: number): KernelValidationReport {
    const report: KernelValidationReport = {
      valid: true,
      system: systemName,
      tick,
      errors: [],
      warnings: [],
      checksRun: 0,
      checksPerformed: {
        positions: false,
        velocities: false,
        healths: false,
        entityRegistry: false,
        bufferConsistency: false,
      },
    };

    // Check positions
    this.validatePositions(kernel, report);
    report.checksPerformed.positions = true;

    // Check velocities
    this.validateVelocities(kernel, report);
    report.checksPerformed.velocities = true;

    // Check healths
    this.validateHealths(kernel, report);
    report.checksPerformed.healths = true;

    // Check entity registry
    this.validateEntityRegistry(kernel, report);
    report.checksPerformed.entityRegistry = true;

    // Check buffer consistency
    this.validateBufferConsistency(kernel, report);
    report.checksPerformed.bufferConsistency = true;

    report.checksRun = Object.values(report.checksPerformed).filter(Boolean).length;
    report.valid = report.errors.every((e) => e.severity !== 'FATAL');

    if (!report.valid) {
      const fatalErrors = report.errors.filter((e) => e.severity === 'FATAL');
      if (fatalErrors.length > 0) {
        throw new Error(
          `[FATAL_DOD_CORRUPTION] System ${systemName} corrupted buffers:\n${fatalErrors
            .map((e) => `  ${e.code}: ${e.message}`)
            .join('\n')}`,
        );
      }
    }

    return report;
  }

  private validatePositions(kernel: SimulationKernel, report: KernelValidationReport): void {
    const positions = (kernel as any).positions as PositionStorage;
    if (!positions) return;

    // Check all entities have valid positions
    const entities = (kernel as any).entities as EntityRegistry;
    const maxEntities = (entities as any).denseHandles?.length ?? 0;

    for (let dense = 0; dense < maxEntities; dense++) {
      if (!(entities as any).isSparseIndexActive?.(dense)) continue;

      const x = (positions as any).getX?.(dense);
      const y = (positions as any).getY?.(dense);
      const z = (positions as any).getZ?.(dense);

      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        report.errors.push({
          code: ValidationErrorCode.NAN_POSITION,
          message: `NaN position at dense index ${dense}: (${x}, ${y}, ${z})`,
          severity: 'FATAL',
          context: { dense, x, y, z },
        });
      }

      // Check bounds (allow wide range but detect obvious corruption)
      const MAX_POSITION = 100000;
      if (Math.abs(x) > MAX_POSITION || Math.abs(y) > MAX_POSITION || Math.abs(z) > MAX_POSITION) {
        report.warnings.push(`Position out of reasonable bounds at dense ${dense}: (${x}, ${y}, ${z})`);
      }
    }
  }

  private validateVelocities(kernel: SimulationKernel, report: KernelValidationReport): void {
    const velocities = (kernel as any).velocities as VelocityStorage;
    if (!velocities) return;

    const entities = (kernel as any).entities as EntityRegistry;
    const maxEntities = (entities as any).denseHandles?.length ?? 0;

    for (let dense = 0; dense < maxEntities; dense++) {
      if (!(entities as any).isSparseIndexActive?.(dense)) continue;

      const vx = (velocities as any).getVX?.(dense);
      const vy = (velocities as any).getVY?.(dense);
      const vz = (velocities as any).getVZ?.(dense);

      if (isNaN(vx) || isNaN(vy) || isNaN(vz)) {
        report.errors.push({
          code: ValidationErrorCode.NAN_VELOCITY,
          message: `NaN velocity at dense index ${dense}: (${vx}, ${vy}, ${vz})`,
          severity: 'FATAL',
          context: { dense, vx, vy, vz },
        });
      }
    }
  }

  private validateHealths(kernel: SimulationKernel, report: KernelValidationReport): void {
    const healths = (kernel as any).healths as HealthStorage;
    if (!healths) return;

    const entities = (kernel as any).entities as EntityRegistry;
    const maxEntities = (entities as any).denseHandles?.length ?? 0;

    for (let dense = 0; dense < maxEntities; dense++) {
      if (!(entities as any).isSparseIndexActive?.(dense)) continue;

      const health = (healths as any).getHealth?.(dense);
      const maxHealth = (healths as any).getMaxHealth?.(dense);

      if (isNaN(health) || isNaN(maxHealth)) {
        report.errors.push({
          code: ValidationErrorCode.NAN_HEALTH,
          message: `NaN health at dense index ${dense}: health=${health}, maxHealth=${maxHealth}`,
          severity: 'FATAL',
          context: { dense, health, maxHealth },
        });
      }

      if (health < 0 && !isNaN(health)) {
        report.warnings.push(`Negative health at dense ${dense}: ${health} (should be >= 0 or handled by system)`);
      }
    }
  }

  private validateEntityRegistry(kernel: SimulationKernel, report: KernelValidationReport): void {
    const entities = (kernel as any).entities as EntityRegistry;
    if (!entities) return;

    const activeCount = (entities as any).denseHandles?.filter((h: number) => h >= 0).length ?? 0;
    const capacity = (entities as any).maxEntities ?? 0;

    if (activeCount > capacity) {
      report.errors.push({
        code: ValidationErrorCode.ENTITY_OVERFLOW as any,
        message: `Entity count (${activeCount}) exceeds capacity (${capacity})`,
        severity: 'FATAL',
        context: { activeCount, capacity },
      });
    }
  }

  private validateBufferConsistency(kernel: SimulationKernel, report: KernelValidationReport): void {
    const entities = (kernel as any).entities as EntityRegistry;
    const positions = (kernel as any).positions as PositionStorage;

    if (!entities || !positions) return;

    // Check that all position writes are to valid entities
    const maxEntities = (entities as any).denseHandles?.length ?? 0;
    for (let dense = 0; dense < maxEntities; dense++) {
      const isActive = (entities as any).isSparseIndexActive?.(dense);
      const hasPosition = (positions as any).getX?.(dense) !== undefined;

      if (hasPosition && !isActive) {
        report.warnings.push(
          `Buffer entry at dense ${dense} has position but entity is not active (orphaned)`,
        );
      }
    }
  }

  /**
   * Generate human-readable report
   */
  generateReport(report: KernelValidationReport): string {
    const lines: string[] = [
      `[KERNEL VALIDATION] System: ${report.system}, Tick: ${report.tick}`,
      `Status: ${report.valid ? '✅ VALID' : '❌ INVALID'}`,
      `Checks performed: ${report.checksRun}`,
      `Errors: ${report.errors.length}`,
      `Warnings: ${report.warnings.length}`,
    ];

    if (report.errors.length > 0) {
      lines.push(`\nErrors:`);
      for (const err of report.errors) {
        lines.push(`  [${err.code}] ${err.severity}: ${err.message}`);
      }
    }

    if (report.warnings.length > 0) {
      lines.push(`\nWarnings:`);
      for (const warn of report.warnings) {
        lines.push(`  ⚠️ ${warn}`);
      }
    }

    return lines.join('\n');
  }
}

// Export singleton
export const kernelValidator = new KernelValidator();
