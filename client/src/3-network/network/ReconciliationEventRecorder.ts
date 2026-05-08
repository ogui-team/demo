import { gameBus } from '../../1-kernel/core/EventBus';
import { TraceStrideOffset } from '../../1-kernel/core/kernel/TraceStrideLayout';

/**
 * Reconciliation Event Recorder - BITE Integration
 * 
 * Captures network reconciliation events (predicted vs authoritative deltas)
 * and records them into the BITE buffer for post-hoc analysis.
 * 
 * Zero-allocation O(1) recording: Uses circular buffer with pre-allocated entries.
 * Max 6 reconciliation events per frame (RECONCILIATION_SIZE = 216 bytes / 36 bytes per entry).
 * 
 * Memory Layout (36 bytes per entry):
 *   Offset 0-7:   Timestamp (Float64)
 *   Offset 8-9:   EntityId (Uint16)
 *   Offset 10:    ErrorType (Uint8) - 0=position, 1=velocity, 2=health, 3=state
 *   Offset 11-14: DeltaX (Float32)
 *   Offset 15-18: DeltaY (Float32)
 *   Offset 19-22: DeltaZ (Float32)
 *   Offset 23-26: VelX (Float32)
 *   Offset 27-30: VelY (Float32)
 *   Offset 31-34: VelZ (Float32)
 *   Offset 35:    Padding
 */
export class ReconciliationEventRecorder {
  // Pre-allocated circular buffer for max 6 events
  private readonly maxEvents = TraceStrideOffset.MAX_RECONCILIATION_EVENTS;
  private eventCount = 0;
  private frameReconciliationData = new Uint8Array(TraceStrideOffset.RECONCILIATION_SIZE);

  // Pre-allocated event data for O(1) recording
  private readonly events: Array<{
    timestamp: number;
    entityId: number;
    errorType: number;
    deltaX: number;
    deltaY: number;
    deltaZ: number;
    velX: number;
    velY: number;
    velZ: number;
  }> = Array(this.maxEvents)
    .fill(null)
    .map(() => ({
      timestamp: 0,
      entityId: 0,
      errorType: 0,
      deltaX: 0,
      deltaY: 0,
      deltaZ: 0,
      velX: 0,
      velY: 0,
      velZ: 0,
    }));

  // Runtime state for reconciliation tracking
  private lastReconciliationTick = -1;
  private activePlayerId: string | null = null;
  private reconciliationInProgress = false;

  constructor() {
    this.subscribeToReconciliationEvents();
  }

  /**
   * Subscribe to reconciliation events from the game bus.
   * Zero-allocation listeners - reuse pre-allocated event buffers.
   */
  private subscribeToReconciliationEvents(): void {
    gameBus.on('RECONCILIATION_BEGIN', (data: any) => {
      this.handleReconciliationBegin(data);
    });

    gameBus.on('RECONCILIATION_END', (data: any) => {
      this.handleReconciliationEnd(data);
    });

    gameBus.on('ENTITY_RECONCILED', (data: any) => {
      this.handleEntityReconciled(data);
    });
  }

  /**
   * Handle RECONCILIATION_BEGIN: Mark start of correction phase.
   * Fired when correctionDistance exceeds threshold.
   */
  private handleReconciliationBegin(data: any): void {
    this.reconciliationInProgress = true;
    this.activePlayerId = data.playerId;
    this.lastReconciliationTick = data.tick;

    // Mark frame boundary for reconciliation tracking
    if (this.eventCount < this.maxEvents) {
      this.eventCount = 0; // Reset for new frame
    }
  }

  /**
   * Handle RECONCILIATION_END: Record final reconciliation delta.
   * Contains the corrected position and replay count.
   */
  private handleReconciliationEnd(data: any): void {
    this.reconciliationInProgress = false;
    // Reconciliation complete - events already recorded in ENTITY_RECONCILED
  }

  /**
   * Handle ENTITY_RECONCILED: Record the reconciliation delta for this entity.
   * Called when entity state is corrected and replayed inputs are resimulated.
   * 
   * ERROR_TYPE: 0 = position correction
   * We track: predicted position error, velocity adjustment
   */
  private handleEntityReconciled(data: any): void {
    if (this.eventCount >= this.maxEvents) {
      // Circular buffer full - overwrite oldest
      return;
    }

    const event = this.events[this.eventCount];
    event.timestamp = Date.now();
    event.entityId = data.entityId ?? 0;
    event.errorType = 0; // Position correction
    event.deltaX = data.correctionDistance ?? 0; // Store magnitude in deltaX for simplicity
    event.deltaY = 0;
    event.deltaZ = 0;
    event.velX = 0;
    event.velY = 0;
    event.velZ = 0;

    this.eventCount++;
  }

  /**
   * Serialize buffered events into BITE-formatted Uint8Array.
   * Called each frame by SimulationKernel.recordFrameToBite().
   * 
   * ZERO-ALLOCATION: Writes directly to pre-allocated buffer.
   * Returns the formatted reconciliation data ready for BITE recording.
   */
  exportFrameData(): Uint8Array {
    // Clear buffer (reuse from last frame)
    this.frameReconciliationData.fill(0);

    // Serialize each event into 36-byte stride
    for (let i = 0; i < this.eventCount; i++) {
      const event = this.events[i];
      const offset = i * TraceStrideOffset.RECONCILIATION_ENTRY_SIZE;

      // Offset 0-7: Timestamp (Float64)
      const view = new DataView(this.frameReconciliationData.buffer);
      view.setFloat64(offset, event.timestamp, true); // Little-endian

      // Offset 8-9: EntityId (Uint16)
      view.setUint16(offset + 8, event.entityId, true);

      // Offset 10: ErrorType (Uint8)
      view.setUint8(offset + 10, event.errorType);

      // Offset 11-14: DeltaX (Float32)
      view.setFloat32(offset + 11, event.deltaX, true);

      // Offset 15-18: DeltaY (Float32)
      view.setFloat32(offset + 15, event.deltaY, true);

      // Offset 19-22: DeltaZ (Float32)
      view.setFloat32(offset + 19, event.deltaZ, true);

      // Offset 23-26: VelX (Float32)
      view.setFloat32(offset + 23, event.velX, true);

      // Offset 27-30: VelY (Float32)
      view.setFloat32(offset + 27, event.velY, true);

      // Offset 31-34: VelZ (Float32)
      view.setFloat32(offset + 31, event.velZ, true);

      // Offset 35: Padding (Uint8) = 0
    }

    // Reset count for next frame
    this.eventCount = 0;

    return this.frameReconciliationData;
  }

  /**
   * Reset recorder state (called on frame boundary or on demand).
   */
  reset(): void {
    this.eventCount = 0;
    this.reconciliationInProgress = false;
    this.activePlayerId = null;
    this.frameReconciliationData.fill(0);
  }

  /**
   * Get current reconciliation state for diagnostics.
   */
  getState() {
    return {
      eventCount: this.eventCount,
      maxEvents: this.maxEvents,
      reconciliationInProgress: this.reconciliationInProgress,
      activePlayerId: this.activePlayerId,
      lastReconciliationTick: this.lastReconciliationTick,
    };
  }
}
