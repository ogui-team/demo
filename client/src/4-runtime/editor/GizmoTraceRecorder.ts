import { TraceStrideOffset } from '../../1-kernel/core/kernel/TraceStrideLayout';

/**
 * Gizmo Transform Override Recorder - BITE Integration
 * 
 * Records editor transform manipulations (gizmo drags) into the BITE buffer.
 * Captures when editor transforms a world object and logs the override to tracing.
 * 
 * Zero-allocation O(1) recording: Circular buffer with pre-allocated entries.
 * Max 4 gizmo events per frame (GIZMO_SIZE = 56 bytes / 14 bytes per entry).
 * 
 * Memory Layout (14 bytes per entry):
 *   Offset 0-1:   EntityId (Uint16)
 *   Offset 2:     OverrideFlags (Uint8) - bitmask: 0x1=position, 0x2=rotation, 0x4=scale
 *   Offset 3-6:   PosX (Float32)
 *   Offset 7-10:  PosY (Float32)
 *   Offset 11-13: PosZ (Float32)
 * 
 * Entry structure: 14 bytes = 4 entries × 14 bytes = 56 bytes total
 */
export interface GizmoTransformCommit {
  id: string;
  previousPosition: { x: number; y: number; z: number };
  previousRotation: { x: number; y: number; z: number };
  previousScale: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

export class GizmoTraceRecorder {
  // Pre-allocated circular buffer for max 4 events
  private readonly maxEvents = TraceStrideOffset.MAX_GIZMO_EVENTS;
  private eventCount = 0;
  private frameGizmoData = new Uint8Array(TraceStrideOffset.GIZMO_SIZE);

  // Pre-allocated event data for O(1) recording
  private readonly events: Array<{
    entityId: number;
    overrideFlags: number;
    posX: number;
    posY: number;
    posZ: number;
  }> = Array(this.maxEvents)
    .fill(null)
    .map(() => ({
      entityId: 0,
      overrideFlags: 0,
      posX: 0,
      posY: 0,
      posZ: 0,
    }));

  // Runtime state for gizmo tracking
  private lastGizmoDragTick = -1;
  private activeDragEntityId: string | null = null;

  constructor() {
    // Initialize without subscribers - external calls recordTransformCommit()
  }

  /**
   * Record a gizmo transform override event.
   * Called directly from EditorAuthorityCoordinator or GizmoSystem callback.
   * 
   * ZERO-ALLOCATION: Reuses pre-allocated event slots.
   */
  recordTransformCommit(commit: GizmoTransformCommit): void {
    if (this.eventCount >= this.maxEvents) {
      // Circular buffer full - overwrite oldest
      return;
    }

    // Parse entityId (extract numeric part if needed)
    let entityIdNum = 0;
    try {
      // If entityId is UUID, hash it to uint16
      if (commit.id && commit.id.length > 0) {
        let hash = 0;
        for (let i = 0; i < Math.min(commit.id.length, 8); i++) {
          hash = ((hash << 5) - hash) + commit.id.charCodeAt(i);
          hash = hash & hash; // Convert to 32-bit integer
        }
        entityIdNum = Math.abs(hash) % 65535; // Uint16 range
      }
    } catch {
      entityIdNum = 0;
    }

    // Determine which transforms changed (override flags)
    let overrideFlags = 0;
    const prevPos = commit.previousPosition;
    const currPos = commit.position;
    const prevRot = commit.previousRotation;
    const currRot = commit.rotation;
    const prevScale = commit.previousScale;
    const currScale = commit.scale;

    // 0x1 = position changed
    if (prevPos.x !== currPos.x || prevPos.y !== currPos.y || prevPos.z !== currPos.z) {
      overrideFlags |= 0x1;
    }

    // 0x2 = rotation changed
    if (prevRot.x !== currRot.x || prevRot.y !== currRot.y || prevRot.z !== currRot.z) {
      overrideFlags |= 0x2;
    }

    // 0x4 = scale changed
    if (prevScale.x !== currScale.x || prevScale.y !== currScale.y || prevScale.z !== currScale.z) {
      overrideFlags |= 0x4;
    }

    if (overrideFlags === 0) {
      return; // No change, don't record
    }

    const event = this.events[this.eventCount];
    event.entityId = entityIdNum;
    event.overrideFlags = overrideFlags;
    event.posX = currPos.x;
    event.posY = currPos.y;
    event.posZ = currPos.z;

    this.eventCount++;
    this.activeDragEntityId = commit.id;
  }

  /**
   * Serialize buffered events into BITE-formatted Uint8Array.
   * Called each frame by SimulationKernel.recordFrameToBite().
   * 
   * ZERO-ALLOCATION: Writes directly to pre-allocated buffer.
   * Returns the formatted gizmo data ready for BITE recording.
   */
  exportFrameData(): Uint8Array {
    // Clear buffer (reuse from last frame)
    this.frameGizmoData.fill(0);

    // Serialize each event into 14-byte stride
    for (let i = 0; i < this.eventCount; i++) {
      const event = this.events[i];
      const offset = i * TraceStrideOffset.GIZMO_ENTRY_SIZE;

      // Offset 0-1: EntityId (Uint16)
      const view = new DataView(this.frameGizmoData.buffer);
      view.setUint16(offset, event.entityId, true); // Little-endian

      // Offset 2: OverrideFlags (Uint8)
      view.setUint8(offset + 2, event.overrideFlags);

      // Offset 3-6: PosX (Float32)
      view.setFloat32(offset + 3, event.posX, true);

      // Offset 7-10: PosY (Float32)
      view.setFloat32(offset + 7, event.posY, true);

      // Offset 11-13: PosZ (Float32)
      view.setFloat32(offset + 11, event.posZ, true);

      // Offset 13 is the last byte of PosZ - 14 bytes total
    }

    // Reset count for next frame
    this.eventCount = 0;

    return this.frameGizmoData;
  }

  /**
   * Reset recorder state (called on frame boundary or on demand).
   */
  reset(): void {
    this.eventCount = 0;
    this.activeDragEntityId = null;
    this.frameGizmoData.fill(0);
  }

  /**
   * Get current gizmo state for diagnostics.
   */
  getState() {
    return {
      eventCount: this.eventCount,
      maxEvents: this.maxEvents,
      activeDragEntityId: this.activeDragEntityId,
      lastGizmoDragTick: this.lastGizmoDragTick,
    };
  }
}
