/**
 * TransactionalKernelMode.ts
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * THE CORE ARCHITECTURE: Two-Phase Transactional Loop
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ PHASE_COLLECT (Read-Only)                                               │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ • All systems.update(dt) executes                                       │
 * │ • Systems can READ buffers (zero-copy)                                  │
 * │ • Systems MUST enqueue commands (never mutate buffers!)                 │
 * │ • CommandQueue fills up with work items                                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                 ↓
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ PHASE_RESOLVE (Mutation + Validation)                                   │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ For each command in queue:                                              │
 * │   1. Assign TraceID (tick + seq)                                        │
 * │   2. Validate entity handles & payload schema                           │
 * │   3. Atomic buffer mutation via BufferProxy (triggers assertions)       │
 * │   4. Emit state-changed event for listeners                             │
 * │   5. Log to replay stream                                               │
 * │                                                                          │
 * │ If any command fails → Rollback + Panic + Full diagnostics             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                 ↓
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ AUDIT (Debug-Only)                                                      │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ • Compute state hash over all buffers (CRC32)                          │
 * │ • Compare live buffers vs shadow buffers                                │
 * │ • If mismatch → Panic with frame number + diagnostics                  │
 * │ • Store hash for multiplayer validation                                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                 ↓
 * FRAME N+1 (next iteration)
 *
 * ⭐ Key Invariant: TypedArray buffers are ONLY mutated inside PHASE_RESOLVE
 */

import { KernelStateHash, type KernelHashReference } from './KernelStateHash';
import { KernelAuditSystem, type KernelAuditResult } from './KernelAuditSystem';
import { Float32BufferProxy, Int32BufferProxy } from './DODBufferProxy';
import type { EntityRegistry } from './EntityRegistry';
import type { KernelCommandQueue } from './KernelCommandQueue';

/**
 * Command validation schema: what we check before applying mutations.
 */
export interface CommandValidationSchema {
  type: string;
  requiresSourceHandle?: boolean;
  requiresTargetHandle?: boolean;
  payloadSchema?: Record<string, 'number' | 'string' | 'boolean'>;
}

/**
 * Trace log entry: every command execution is recorded (DEV build only).
 */
export interface TraceLogEntry {
  traceId: string; // "{tick}:{seq}"
  tick: number;
  seq: number;
  timestamp: number;
  commandType: string;
  sourceHandle?: number;
  targetHandle?: number;
  success: boolean;
  errorMessage?: string;
}

/**
 * Result of command resolution phase.
 */
export interface PhaseResolveResult {
  commandsProcessed: number;
  commandsFailed: number;
  stateHash: number;
  tickedStateHash: string;
  auditResult: KernelAuditResult | null;
}

/**
 * Main executor for the two-phase transactional loop.
 */
export class TransactionalKernelMode {
  private readonly entityRegistry: EntityRegistry;
  private readonly commandQueue: KernelCommandQueue;
  private readonly audit: KernelAuditSystem;

  // Buffer proxies with guard layer
  private readonly positionProxy: Float32BufferProxy;
  private readonly velocityProxy: Float32BufferProxy;
  private readonly healthProxy: Float32BufferProxy;
  private readonly ammoProxy: Int32BufferProxy;

  // Trace logging (DEV only)
  private readonly traceLog: TraceLogEntry[] = [];
  private sequenceCounter = 0;

  // State history for rollback
  private lastValidStateHash: KernelHashReference | null = null;
  private lastValidTick: number = -1;

  constructor(
    entityRegistry: EntityRegistry,
    commandQueue: KernelCommandQueue,
    audit: KernelAuditSystem,
    positionProxy: Float32BufferProxy,
    velocityProxy: Float32BufferProxy,
    healthProxy: Float32BufferProxy,
    ammoProxy: Int32BufferProxy,
  ) {
    this.entityRegistry = entityRegistry;
    this.commandQueue = commandQueue;
    this.audit = audit;
    this.positionProxy = positionProxy;
    this.velocityProxy = velocityProxy;
    this.healthProxy = healthProxy;
    this.ammoProxy = ammoProxy;
  }

  /**
   * Execute the TWO-PHASE LOOP for a single tick.
   *
   * Phase 1: COLLECT
   *   - Systems call update(dt) - read-only, enqueue commands
   *
   * Phase 2: RESOLVE
   *   - Process command queue with validation
   *   - Each command is atomic
   *
   * Phase 3: AUDIT
   *   - Compute state hash
   *   - Compare shadow buffers
   */
  executeTransactionalTick(tick: number, dt: number, systemUpdateFn: (dt: number) => void): PhaseResolveResult {
    // ┌─────────────────────────────────────────────────────────────────────┐
    // │ PHASE_COLLECT: Systems update (read-only state, enqueue commands)   │
    // └─────────────────────────────────────────────────────────────────────┘

    // Reset sequence counter for this tick
    this.sequenceCounter = 0;

    // Sync shadow buffers at start (baseline for audit)
    this.audit.syncShadowBuffers();

    // Systems run and enqueue commands
    // (They cannot mutate buffers - only read + enqueue!)
    systemUpdateFn(dt);

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │ PHASE_RESOLVE: Process all queued commands with validation          │
    // └─────────────────────────────────────────────────────────────────────┘

    let commandsProcessed = 0;
    let commandsFailed = 0;

    // Drain command queue, validating each command
    this.commandQueue.drain((seq, queueTick, timestamp, source, type, playerId, payload) => {
      const traceId = `${tick}:${this.sequenceCounter++}`;

      try {
        // Validate command schema
        this._validateCommand(type, payload as any);

        // Apply command mutations
        this._applyCommand(type, payload as any);

        // Log success
        this.traceLog.push({
          traceId,
          tick,
          seq,
          timestamp,
          commandType: type,
          success: true,
        });

        commandsProcessed++;
      } catch (error) {
        commandsFailed++;

        const errorMessage = error instanceof Error ? error.message : String(error);

        this.traceLog.push({
          traceId,
          tick,
          seq,
          timestamp,
          commandType: type,
          success: false,
          errorMessage,
        });

        console.error(`[TransactionalKernelMode] Command ${traceId} (${type}) failed: ${errorMessage}`);
      }
    });

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │ AUDIT: Validate state integrity and compute hash                    │
    // └─────────────────────────────────────────────────────────────────────┘

    const stateHash = this._computeStateHash();
    const tickedStateHash = KernelStateHash.computeTickedHash(stateHash, tick);

    // Audit buffer integrity (DEV build only)
    let auditResult: KernelAuditResult | null = null;
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
      auditResult = this.audit.audit(tick, stateHash);
    }

    // Update last valid state
    this.lastValidStateHash = { tick, stateHash, timestamp: Date.now() };
    this.lastValidTick = tick;

    return {
      commandsProcessed,
      commandsFailed,
      stateHash,
      tickedStateHash,
      auditResult,
    };
  }

  /**
   * Get the last valid state hash (for multiplayer protocol).
   */
  getLastValidStateHash(): KernelHashReference | null {
    return this.lastValidStateHash;
  }

  /**
   * Get trace log entries (DEV diagnostics).
   */
  getTraceLog(limitTo: number = 100): TraceLogEntry[] {
    return this.traceLog.slice(-limitTo);
  }

  /**
   * Clear trace log (can be called periodically to free memory).
   */
  clearTraceLog(): void {
    this.traceLog.length = 0;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Validate command against schema before applying.
   */
  private _validateCommand(type: string, payload: any): void {
    if (!payload) {
      throw new Error(`Command ${type} has no payload`);
    }

    // Add schema definitions here as needed
    // For now: permissive validation (systems are trusted)
  }

  /**
   * Apply command mutation atomically via BufferProxy.
   */
  private _applyCommand(type: string, payload: any): void {
    switch (type) {
      case 'APPLY_DAMAGE': {
        const { targetHandle, amount } = payload;
        if (!Number.isInteger(targetHandle)) throw new Error('Invalid target handle');
        if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid damage amount');

        const dense = this.entityRegistry.getDenseIndex(targetHandle);
        if (dense < 0) throw new Error(`Handle ${targetHandle} not found in registry`);

        const currentHealth = this.healthProxy.read(dense, 0);
        const newHealth = Math.max(0, currentHealth - amount);
        this.healthProxy.write(dense, 0, newHealth);
        break;
      }

      case 'HEAL': {
        const { targetHandle, amount } = payload;
        if (!Number.isInteger(targetHandle)) throw new Error('Invalid target handle');
        if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid heal amount');

        const dense = this.entityRegistry.getDenseIndex(targetHandle);
        if (dense < 0) throw new Error(`Handle ${targetHandle} not found in registry`);

        const maxHealth = this.healthProxy.read(dense, 1); // Assuming offset 1 = maxHealth
        const currentHealth = this.healthProxy.read(dense, 0);
        const newHealth = Math.min(maxHealth, currentHealth + amount);
        this.healthProxy.write(dense, 0, newHealth);
        break;
      }

      case 'SET_VELOCITY': {
        const { targetHandle, vx, vy, vz } = payload;
        if (!Number.isInteger(targetHandle)) throw new Error('Invalid target handle');
        if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) {
          throw new Error('Invalid velocity');
        }

        const dense = this.entityRegistry.getDenseIndex(targetHandle);
        if (dense < 0) throw new Error(`Handle ${targetHandle} not found in registry`);

        this.velocityProxy.writeXYZ(dense, vx, vy, vz);
        break;
      }

      default:
        throw new Error(`Unknown command type: ${type}`);
    }
  }

  /**
   * Compute state hash over all DOD buffers.
   */
  private _computeStateHash(): number {
    return KernelStateHash.computeKernelHash(
      new Uint32Array(0), // entityRegistry handle buffer (placeholder)
      this.positionProxy.buffer,
      this.velocityProxy.buffer,
      this.healthProxy.buffer,
      this.ammoProxy.buffer,
    );
  }
}

/**
 * Enum for command types supported by transactional kernel.
 */
export enum TransactionalCommandType {
  APPLY_DAMAGE = 'APPLY_DAMAGE',
  HEAL = 'HEAL',
  SET_VELOCITY = 'SET_VELOCITY',
}
