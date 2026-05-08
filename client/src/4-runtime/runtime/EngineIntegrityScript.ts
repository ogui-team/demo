/**
 * ============================================================================
 * EngineIntegrityScript.ts
 * ============================================================================
 * 
 * Runtime validation: Ensures all registered systems implement required interfaces.
 * 
 * Called during ENGINE_BOOT phase.
 * Validates that the system registry is internally consistent and all systems
 * fulfill their interface contracts.
 * 
 * Status: PHASE 2 INFRASTRUCTURE (placeholder)
 * 
 * ============================================================================
 */

import { gameBus } from '@engine/1-kernel/core/public-api';
import { listSystems, getSystem } from '@engine/1-kernel/core/public-api';
import type { RegisteredSystem, SystemCapabilities } from '@engine/1-kernel/core/public-api';

// ─── Interface Contracts (Phase 2: move to 0-foundation) ───────────────────

interface INetworkReplicator {
  applySnapshot(snapshot: unknown): void;
  getState(): Record<string, unknown>;
}

interface IGameplayStateProvider {
  getWeaponState(playerId: string): unknown;
  getPlayerHealth(playerId: string): unknown;
  getAbilityState(playerId: string): unknown[];
}

interface IPhysicsKernel {
  tick(dt: number): void;
  getEntityPosition(id: string): { x: number; y: number; z: number };
}

interface ISystem {
  update(dt: number): void;
  enable?(): void;
  disable?(): void;
}

// ─── Integrity Checks ────────────────────────────────────────────────────────

export interface IntegrityReport {
  timestamp: number;
  totalSystems: number;
  passed: number;
  failed: number;
  warnings: string[];
  errors: string[];
  details: IntegrityCheckDetail[];
}

export interface IntegrityCheckDetail {
  systemName: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  interfacesImplemented: string[];
  interfacesMissing: string[];
  reason?: string;
}

export class EngineIntegrityValidator {
  private report: IntegrityReport = {
    timestamp: 0,
    totalSystems: 0,
    passed: 0,
    failed: 0,
    warnings: [],
    errors: [],
    details: [],
  };

  /**
   * Run full integrity validation on all registered systems.
   * Called during ENGINE_BOOT.
   */
  validate(): IntegrityReport {
    this.report = {
      timestamp: Date.now(),
      totalSystems: 0,
      passed: 0,
      failed: 0,
      warnings: [],
      errors: [],
      details: [],
    };

    const systems = listSystems();
    this.report.totalSystems = systems.length;

    for (const system of systems) {
      const detail = this.validateSystem(system);
      this.report.details.push(detail);

      if (detail.status === 'PASS') {
        this.report.passed++;
      } else if (detail.status === 'WARN') {
        this.report.passed++; // Warnings don't block
        this.report.warnings.push(`${detail.systemName}: ${detail.reason}`);
      } else {
        this.report.failed++;
        this.report.errors.push(`${detail.systemName}: ${detail.reason}`);
      }
    }

    return this.report;
  }

  private validateSystem(system: RegisteredSystem): IntegrityCheckDetail {
    const detail: IntegrityCheckDetail = {
      systemName: system.name,
      status: 'PASS',
      interfacesImplemented: [],
      interfacesMissing: [],
    };

    // Check: System implements ISystem interface
    const systemImpl = system.system as unknown as Partial<ISystem>;
    if (typeof systemImpl.update !== 'function') {
      detail.status = 'WARN';
      detail.reason = 'Missing update() method';
      detail.interfacesMissing.push('ISystem.update()');
    } else {
      detail.interfacesImplemented.push('ISystem.update()');
    }

    if (systemImpl.enable && typeof systemImpl.enable !== 'function') {
      detail.status = 'WARN';
      detail.reason = 'enable property is not a function';
    }

    if (systemImpl.disable && typeof systemImpl.disable !== 'function') {
      detail.status = 'WARN';
      detail.reason = 'disable property is not a function';
    }

    // Check: System is registered with metadata
    if (!system.metadata) {
      detail.status = 'WARN';
      detail.reason = 'No metadata registered';
    } else {
      detail.interfacesImplemented.push('SystemDebugMetadata');
    }

    // Check: System status is valid
    if (!['active', 'disabled', 'error'].includes(system.status)) {
      detail.status = 'FAIL';
      detail.reason = `Invalid system status: ${system.status}`;
    }

    // Domain-specific checks (Phase 2: expand this)
    const nameToInterface: Record<string, string[]> = {
      NetworkReplicator: ['INetworkReplicator'],
      GameplayStateProvider: ['IGameplayStateProvider'],
      PhysicsSystem: ['IPhysicsKernel'],
    };

    const expectedInterfaces = nameToInterface[system.name] || [];
    for (const iface of expectedInterfaces) {
      const hasInterface = this.checkInterfaceImplementation(system.system as unknown, iface);
      if (hasInterface) {
        detail.interfacesImplemented.push(iface);
      } else {
        detail.interfacesMissing.push(iface);
        detail.status = 'WARN';
        detail.reason = `Missing interface: ${iface}`;
      }
    }

    return detail;
  }

  private checkInterfaceImplementation(system: unknown, interfaceName: string): boolean {
    // TODO (Phase 2): Implement duck-typing checks for specific interfaces
    // For now, we do basic method existence checks
    const methodMap: Record<string, string[]> = {
      INetworkReplicator: ['applySnapshot', 'getState'],
      IGameplayStateProvider: ['getWeaponState', 'getPlayerHealth', 'getAbilityState'],
      IPhysicsKernel: ['tick', 'getEntityPosition'],
    };

    const requiredMethods = methodMap[interfaceName] || [];
    const systemObj = system as Record<string, unknown>;

    return requiredMethods.every(method => typeof systemObj[method] === 'function');
  }

  getReport(): IntegrityReport {
    return this.report;
  }

  printReport(): string {
    const lines: string[] = [
      '\n' + '='.repeat(70),
      '  ENGINE INTEGRITY REPORT',
      '='.repeat(70),
      `Timestamp: ${new Date(this.report.timestamp).toISOString()}`,
      `Total Systems: ${this.report.totalSystems}`,
      `Passed: ${this.report.passed} ✅`,
      `Failed: ${this.report.failed} ❌`,
      `Warnings: ${this.report.warnings.length} ⚠️`,
      '',
    ];

    if (this.report.failed > 0) {
      lines.push('ERRORS:');
      for (const error of this.report.errors) {
        lines.push(`  ❌ ${error}`);
      }
      lines.push('');
    }

    if (this.report.warnings.length > 0) {
      lines.push('WARNINGS:');
      for (const warning of this.report.warnings) {
        lines.push(`  ⚠️  ${warning}`);
      }
      lines.push('');
    }

    lines.push('SYSTEM DETAILS:');
    for (const detail of this.report.details) {
      const icon = detail.status === 'PASS' ? '✅' : detail.status === 'WARN' ? '⚠️' : '❌';
      lines.push(`  ${icon} ${detail.systemName}`);
      if (detail.interfacesImplemented.length > 0) {
        lines.push(`     Implements: ${detail.interfacesImplemented.join(', ')}`);
      }
      if (detail.interfacesMissing.length > 0) {
        lines.push(`     Missing: ${detail.interfacesMissing.join(', ')}`);
      }
      if (detail.reason) {
        lines.push(`     Reason: ${detail.reason}`);
      }
    }

    lines.push('='.repeat(70) + '\n');
    return lines.join('\n');
  }
}

// ─── Global Integration ─────────────────────────────────────────────────────

let globalValidator: EngineIntegrityValidator | null = null;

/**
 * Initialize and run integrity validation.
 * Called during ENGINE_BOOT event.
 */
export function initializeEngineIntegrityValidation(): void {
  globalValidator = new EngineIntegrityValidator();
  const report = globalValidator.validate();

  console.log(globalValidator.printReport());

  // Emit event so systems can listen
  gameBus.emit('stateMutation', {
    source: 'engineIntegrityValidator',
    path: 'engine.integrity',
    changedCount: report.totalSystems,
  });

  // Log to dev console if in dev mode
  if (typeof globalValidator.getReport().failed !== 'undefined') {
    const report = globalValidator.getReport();
    if (report.failed > 0) {
      console.error(
        `[ENGINE_BOOT] ❌ Integrity check FAILED: ${report.failed} systems have errors`
      );
    } else if (report.warnings.length > 0) {
      console.warn(
        `[ENGINE_BOOT] ⚠️ Integrity check PASSED with ${report.warnings.length} warnings`
      );
    } else {
      console.log(`[ENGINE_BOOT] ✅ All ${report.totalSystems} systems passed integrity check`);
    }
  }
}

/**
 * Get the current integrity report (after validation).
 */
export function getEngineIntegrityReport(): IntegrityReport | null {
  return globalValidator?.getReport() ?? null;
}

/**
 * Hook this into ENGINE_BOOT event:
 * 
 * gameBus.on('ENGINE_BOOT', () => {
 *   initializeEngineIntegrityValidation();
 * });
 */
