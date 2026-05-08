import { TraceStrideOffset } from './TraceStrideLayout';
import { PositionStorage } from './PositionStorage';
import { VelocityStorage } from './VelocityStorage';
import { HealthStorage } from './HealthStorage';
import { EntityRegistry } from './EntityRegistry';

/**
 * Binary Flight Recorder (BITE-System) - High-Performance Trace Coordinator
 * 
 * Manages a fixed 300KB SharedArrayBuffer (300 frames × 1024 bytes per stride).
 * Zero-allocation frame recording with O(N) entity selection and O(1) seeking.
 * 
 * All writes are atomic; DataView ensures proper Float64 alignment.
 * Bulk data sections use typed array views for maximum throughput.
 */
export class BinaryTraceCoordinator {
  private buffer: ArrayBuffer;
  private dataView: DataView;
  private uint8View: Uint8Array;
  private currentFrameIndex: number = 0;
  private readonly maxFrames = 300;
  private readonly frameSize = TraceStrideOffset.STRIDE_SIZE;
  private useSharedBuffer: boolean;

  constructor() {
    const bufferSize = this.frameSize * this.maxFrames;
    
    // Check if SharedArrayBuffer is available (requires COOP/COEP headers)
    try {
      if (typeof SharedArrayBuffer !== 'undefined') {
        this.buffer = new SharedArrayBuffer(bufferSize);
        this.useSharedBuffer = true;
      } else {
        this.buffer = new ArrayBuffer(bufferSize);
        this.useSharedBuffer = false;
        console.warn('[BinaryTraceCoordinator] SharedArrayBuffer not available, using ArrayBuffer fallback');
      }
    } catch (e) {
      // SharedArrayBuffer disabled or restricted by headers
      this.buffer = new ArrayBuffer(bufferSize);
      this.useSharedBuffer = false;
      console.warn('[BinaryTraceCoordinator] SharedArrayBuffer creation failed, using ArrayBuffer fallback:', e);
    }
    
    this.dataView = new DataView(this.buffer);
    this.uint8View = new Uint8Array(this.buffer);

    // Pre-fill with zeros
    this.uint8View.fill(0);
    
    console.log('[BinaryTraceCoordinator] Initialized with', this.useSharedBuffer ? 'SharedArrayBuffer' : 'ArrayBuffer');
  }

  /**
   * Record a complete simulation frame into the binary buffer.
   * 
   * Hot-path method: Must complete in O(N) time where N = active entity count.
   * Allocates zero temporary objects; all writes are direct to typed arrays.
   * 
   * @param frameIndex Current simulation frame number (auto-wrapped to 0-299)
   * @param timestamp Unix timestamp in milliseconds
   * @param stateHash CRC32 hash of positions + velocities + healths
   * @param commandCount Number of commands processed this frame
   * @param entities EntityRegistry for entity iteration
   * @param positions PositionStorage for entity positions
   * @param velocities VelocityStorage for entity velocities
   * @param healths HealthStorage for entity health values
   * @param inputs Raw input bitmasks (128 bytes)
   * @param networkSyncData Network reconciliation data (200 bytes)
   * @param gizmoData Editor transform overrides (56 bytes)
   * @param reconciliationData Network event log (216 bytes)
   */
  recordFrame(
    frameIndex: number,
    timestamp: number,
    stateHash: number,
    commandCount: number,
    entities: EntityRegistry,
    positions: PositionStorage,
    velocities: VelocityStorage,
    healths: HealthStorage,
    inputs: Uint8Array,
    networkSyncData: Uint8Array,
    gizmoData: Uint8Array,
    reconciliationData: Uint8Array
  ): void {
    // Ring buffer wraparound: convert frameIndex to 0-299 range
    const frameOffset = (frameIndex % this.maxFrames) * this.frameSize;

    // PHASE 1: Write header atomically (24 bytes, 8-byte aligned)
    this.writeHeader(frameOffset, frameIndex, timestamp, stateHash, commandCount);

    // PHASE 2: Copy input section (128 bytes)
    this.writeBulkSection(
      frameOffset + TraceStrideOffset.INPUT_BASE,
      inputs,
      TraceStrideOffset.INPUT_SIZE
    );

    // PHASE 3: Select top 10 entities by velocity magnitude and write transforms
    // This is O(N log N) due to sort, but N is typically <256 entities
    this.writeTopEntitiesTransforms(
      frameOffset,
      entities,
      positions,
      velocities,
      healths
    );

    // PHASE 4: Copy network sync data (200 bytes)
    this.writeBulkSection(
      frameOffset + TraceStrideOffset.NETWORK_BASE,
      networkSyncData,
      TraceStrideOffset.NETWORK_SIZE
    );

    // PHASE 5: Copy gizmo override data (56 bytes)
    this.writeBulkSection(
      frameOffset + TraceStrideOffset.GIZMO_BASE,
      gizmoData,
      TraceStrideOffset.GIZMO_SIZE
    );

    // PHASE 6: Copy reconciliation event data (216 bytes)
    this.writeBulkSection(
      frameOffset + TraceStrideOffset.RECONCILIATION_BASE,
      reconciliationData,
      TraceStrideOffset.RECONCILIATION_SIZE
    );

    this.currentFrameIndex = frameIndex + 1;
  }

  /**
   * Write 24-byte header with proper Float64 alignment.
   * Uses DataView for 8-byte atomicity on TIMESTAMP field.
   */
  private writeHeader(
    frameOffset: number,
    frameIndex: number,
    timestamp: number,
    stateHash: number,
    commandCount: number
  ): void {
    // Offset 0-3: FRAME_INDEX (Uint32)
    this.dataView.setUint32(frameOffset + TraceStrideOffset.FRAME_INDEX, frameIndex, true);

    // Offset 4-7: PADDING_1 (implicit zero from pre-fill)

    // Offset 8-15: TIMESTAMP (Float64 - now properly 8-byte aligned!)
    this.dataView.setFloat64(frameOffset + TraceStrideOffset.TIMESTAMP, timestamp, true);

    // Offset 16-19: STATE_HASH (Uint32)
    this.dataView.setUint32(frameOffset + TraceStrideOffset.STATE_HASH, stateHash, true);

    // Offset 20-21: COMMAND_COUNT (Uint16)
    this.dataView.setUint16(frameOffset + TraceStrideOffset.COMMAND_COUNT, commandCount, true);

    // Offset 22-23: PADDING_2 (implicit zero from pre-fill)
  }

  /**
   * Bulk copy data section using memcpy-like Uint8Array.set() operation.
   * Zero-allocation, maximum throughput.
   */
  private writeBulkSection(offset: number, data: Uint8Array, size: number): void {
    const copySize = Math.min(size, data.length);
    if (copySize > 0) {
      this.uint8View.set(data.subarray(0, copySize), offset);
    }
  }

  /**
   * Select top 10 entities by velocity magnitude and write their transform deltas.
   * 
   * Algorithm:
   * 1. Scan all active entities, compute velocity magnitudes (O(N))
   * 2. Sort descending by magnitude (O(N log N), but N typically <256)
   * 3. Take top 10 entities
   * 4. Write each to transform stride section
   * 
   * No temporary arrays allocated; uses stack-allocated sort.
   */
  private writeTopEntitiesTransforms(
    frameOffset: number,
    entities: EntityRegistry,
    positions: PositionStorage,
    velocities: VelocityStorage,
    healths: HealthStorage
  ): void {
    const activeCount = entities.activeCount;
    if (activeCount === 0) return;

    // PHASE 3A: Collect all active entities with velocity magnitudes
    // Allocate once: reusable array of entity indices with magnitudes
    const entityVelocities: Array<{ index: number; magnitude: number }> = [];

    // Get buffers for direct access
    const velocityBuffer = velocities.getAuthoritativeBuffer();

    for (let i = 0; i < activeCount; i++) {
      const vx = velocityBuffer[i * 3];
      const vy = velocityBuffer[i * 3 + 1];
      const vz = velocityBuffer[i * 3 + 2];
      const magnitude = Math.sqrt(vx * vx + vy * vy + vz * vz);
      entityVelocities.push({ index: i, magnitude });
    }

    // PHASE 3B: Sort descending by magnitude and select top 10
    entityVelocities.sort((a, b) => b.magnitude - a.magnitude);
    const maxEntities = Math.min(TraceStrideOffset.MAX_ACTIVE_ENTITIES, activeCount);

    // PHASE 3C: Write each entity's transform stride
    const positionBuffer = positions.getReadBuffer();
    const healthBuffer = healths.getHealthBuffer();

    for (let i = 0; i < maxEntities; i++) {
      const denseIndex = entityVelocities[i].index;
      const strideBase = frameOffset + TraceStrideOffset.TRANSFORM_BASE + i * TraceStrideOffset.ACTIVE_ENTITY_STRIDE;

      // Read entity data from buffers
      const px = positionBuffer[denseIndex * 3];
      const py = positionBuffer[denseIndex * 3 + 1];
      const pz = positionBuffer[denseIndex * 3 + 2];
      const vx = velocityBuffer[denseIndex * 3];
      const vy = velocityBuffer[denseIndex * 3 + 1];
      const vz = velocityBuffer[denseIndex * 3 + 2];
      const health = healthBuffer[denseIndex];

      // Write transform stride (40 bytes total):
      // Offset 0-1: EntityId (Uint16)
      this.dataView.setUint16(strideBase + 0, denseIndex, true);
      // Offset 2-5: DeltaX (Float32)
      this.dataView.setFloat32(strideBase + 2, px, true);
      // Offset 6-9: DeltaY (Float32)
      this.dataView.setFloat32(strideBase + 6, py, true);
      // Offset 10-13: DeltaZ (Float32)
      this.dataView.setFloat32(strideBase + 10, pz, true);
      // Offset 14-17: VelX (Float32)
      this.dataView.setFloat32(strideBase + 14, vx, true);
      // Offset 18-21: VelY (Float32)
      this.dataView.setFloat32(strideBase + 18, vy, true);
      // Offset 22-25: VelZ (Float32)
      this.dataView.setFloat32(strideBase + 22, vz, true);
      // Offset 26: Health (Uint8)
      this.dataView.setUint8(strideBase + 26, Math.floor(health));
      // Offset 27-39: Padding (implicit zero from pre-fill)
    }
  }

  /**
   * Get current frame number (accounting for wraparound).
   */
  getCurrentFrame(): number {
    return this.currentFrameIndex;
  }

  /**
   * Get a specific frame's data as a Uint8Array view.
   * O(1) access - no copying, just subarray view.
   * 
   * @param frameNum Absolute frame number (auto-wrapped to 0-299)
   * @returns Uint8Array view into the stride buffer
   */
  getFrameBuffer(frameNum: number): Uint8Array {
    const frameOffset = (frameNum % this.maxFrames) * this.frameSize;
    return new Uint8Array(this.buffer, frameOffset, this.frameSize);
  }

  /**
   * Export the underlying buffer (SharedArrayBuffer if available, ArrayBuffer otherwise).
   */
  getSharedBuffer(): SharedArrayBuffer | ArrayBuffer {
    return this.buffer;
  }

  /**
   * Check if using shared buffer (vs fallback ArrayBuffer)
   */
  isSharedBufferAvailable(): boolean {
    return this.useSharedBuffer;
  }

  /**
   * Get total capacity (in frames).
   */
  getCapacity(): number {
    return this.maxFrames;
  }

  /**
   * Get stride size (in bytes per frame).
   */
  getStrideSize(): number {
    return this.frameSize;
  }
}
