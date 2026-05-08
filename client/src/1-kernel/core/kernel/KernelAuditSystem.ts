/**
 * KernelAuditSystem.ts
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Post-frame audit system: compares live buffers against shadow buffers
 * to detect memory corruption or state divergence.
 *
 * Only runs in DEV build. In production: zero overhead (disabled).
 *
 * If corruption detected: throws with full stack trace + last valid state hash.
 */

import type { DODBufferProxyConfig } from './DODBufferProxy';
import { Float32BufferProxy, Int32BufferProxy } from './DODBufferProxy';
import { KernelStateHash, type KernelHashReference } from './KernelStateHash';

/**
 * Audit result: pass or fail with diagnostics.
 */
export interface KernelAuditResult {
  status: 'pass' | 'fail';
  tick: number;
  stateHash: number;
  bufferAudits: Map<string, BufferAuditResult>;
  errorMessage?: string;
  lastValidHash?: KernelHashReference;
}

interface BufferAuditResult {
  name: string;
  mismatchCount: number;
  mismatchedIndices: number[];
}

/**
 * Core audit system: validates buffer integrity post-tick.
 */
export class KernelAuditSystem {
  private readonly config: DODBufferProxyConfig;
  private readonly bufferProxies: Map<string, Float32BufferProxy | Int32BufferProxy> = new Map();
  private lastValidHash: KernelHashReference | null = null;
  private lastValidHashStack: string = '';

  constructor(config: DODBufferProxyConfig) {
    this.config = config;
  }

  /**
   * Register a buffer proxy for ongoing audit.
   */
  registerProxy(name: string, proxy: Float32BufferProxy | Int32BufferProxy): void {
    this.bufferProxies.set(name, proxy);
  }

  /**
   * Run full audit: compare all registered buffers against shadow buffers.
   * Returns pass/fail with detailed mismatch diagnostics.
   */
  audit(tick: number, stateHash: number): KernelAuditResult {
    const result: KernelAuditResult = {
      status: 'pass',
      tick,
      stateHash,
      bufferAudits: new Map(),
    };

    let totalMismatches = 0;

    // Audit each registered buffer
    for (const [name, proxy] of this.bufferProxies) {
      const mismatches = proxy.auditAgainstShadow();

      if (mismatches.length > 0) {
        totalMismatches += mismatches.length;
        result.bufferAudits.set(name, {
          name,
          mismatchCount: mismatches.length,
          mismatchedIndices: mismatches.slice(0, 10), // First 10 for diagnostics
        });
      }
    }

    // If mismatches found: FAIL
    if (totalMismatches > 0) {
      result.status = 'fail';
      result.errorMessage = `Kernel corruption detected at tick ${tick}: ${totalMismatches} buffer mismatches`;
      result.lastValidHash = this.lastValidHash ?? undefined;

      // PANIC: Throw with full diagnostic
      this._panic(result);
    }

    // Success: update last valid hash
    this.lastValidHash = { tick, stateHash, timestamp: Date.now() };
    this.lastValidHashStack = new Error().stack ?? '(no stack)';

    return result;
  }

  /**
   * Sync all shadow buffers from live buffers.
   * Call at start of frame before mutations.
   */
  syncShadowBuffers(): void {
    for (const proxy of this.bufferProxies.values()) {
      proxy.syncShadowBuffer();
    }
  }

  /**
   * Get last valid hash reference for recovery/logging.
   */
  getLastValidHash(): KernelHashReference | null {
    return this.lastValidHash;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Panic: log corruption and throw with diagnostics.
   */
  private _panic(result: KernelAuditResult): never {
    const DiagnosticReport = this._buildDiagnosticReport(result);

    console.error('🔥 KERNEL CORRUPTION PANIC 🔥');
    console.error(DiagnosticReport);

    if (this.lastValidHash) {
      console.error(`📍 Last valid hash: Tick ${this.lastValidHash.tick}, Hash 0x${this.lastValidHash.stateHash.toString(16)}`);
      console.error(`⏳ Timestamp: ${new Date(this.lastValidHash.timestamp).toISOString()}`);
      console.error(`\n📜 Last valid hash acquired from:\n${this.lastValidHashStack}`);
    }

    throw new Error(
      `[KernelAuditSystem] ${result.errorMessage}\n\n${DiagnosticReport}`,
    );
  }

  /**
   * Build human-readable diagnostic report.
   */
  private _buildDiagnosticReport(result: KernelAuditResult): string {
    let report = `TICK ${result.tick} | StateHash 0x${result.stateHash.toString(16)}\n`;
    report += '═'.repeat(60) + '\n';

    for (const [bufName, audit] of result.bufferAudits) {
      report += `\n${bufName}: ${audit.mismatchCount} mismatches\n`;
      report += `  Indices: ${audit.mismatchedIndices.join(', ')}\n`;
    }

    report += '\n' + '═'.repeat(60);
    return report;
  }
}

/**
 * Integration helper: automatically audit all kernel buffers.
 *
 * Usage in SimulationKernel.tickOnce():
 *
 *   PHASE_RESOLVE: resolve all commands
 *   POST_PHASE:    kernelAudit.syncShadowBuffers()
 *   AUDIT:         kernelAudit.audit(tick, stateHash)
 */
export function createAuditSystemForKernel(
  config: DODBufferProxyConfig,
  positionProxy: Float32BufferProxy,
  velocityProxy: Float32BufferProxy,
  healthProxy: Float32BufferProxy,
  ammoProxy: Int32BufferProxy,
): KernelAuditSystem {
  const audit = new KernelAuditSystem(config);

  audit.registerProxy('positions', positionProxy);
  audit.registerProxy('velocities', velocityProxy);
  audit.registerProxy('healths', healthProxy);
  audit.registerProxy('ammos', ammoProxy);

  return audit;
}
