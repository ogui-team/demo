/**
 * Visual Drift Compensation System
 * MILESTONE 2: Fades out visual snap-back offsets over 300ms instead of instant snapping
 * 
 * Strategy:
 * - When reconciliation detects large drift (> PERF_WARNING_DISTANCE), store the delta offset
 * - Render system gradually reduces the offset over 300ms
 * - Physics buffer gets direct write, visual rendering gets smooth fade-out
 */

export interface VisualDriftOffset {
  entityId: string | number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  elapsedMs: number;
  durationMs: number;
}

export class VisualDriftCompensation {
  private static readonly FADE_DURATION_MS = 300;
  private static readonly ACTIVE_THRESHOLD = 0.001; // Below this, consider fade complete
  
  private readonly offsets = new Map<string | number, VisualDriftOffset>();

  /**
   * Record a reconciliation snap and create a fade-out offset
   */
  recordSnap(
    entityId: string | number,
    snapDeltaX: number,
    snapDeltaY: number,
    snapDeltaZ: number,
  ): void {
    // Cancel any existing fade for this entity
    this.offsets.delete(entityId);

    // Only track if snap is significant enough to be visible
    const magnitude = Math.sqrt(snapDeltaX * snapDeltaX + snapDeltaY * snapDeltaY + snapDeltaZ * snapDeltaZ);
    if (magnitude < VisualDriftCompensation.ACTIVE_THRESHOLD) {
      return;
    }

    this.offsets.set(entityId, {
      entityId,
      offsetX: snapDeltaX,
      offsetY: snapDeltaY,
      offsetZ: snapDeltaZ,
      elapsedMs: 0,
      durationMs: VisualDriftCompensation.FADE_DURATION_MS,
    });
  }

  /**
   * Update all active offsets and return their current values
   */
  update(deltaMs: number): Map<string | number, VisualDriftOffset> {
    const completed: (string | number)[] = [];
    
    for (const [entityId, offset] of this.offsets) {
      offset.elapsedMs += deltaMs;
      
      if (offset.elapsedMs >= offset.durationMs) {
        completed.push(entityId);
      }
    }

    // Remove completed fades
    for (const entityId of completed) {
      this.offsets.delete(entityId);
    }

    return this.offsets;
  }

  /**
   * Get the fade factor for an offset (0 = fully faded, 1 = full amplitude)
   */
  static getFadeFactor(offset: VisualDriftOffset): number {
    const progress = offset.elapsedMs / offset.durationMs;
    return Math.max(0, 1 - progress);
  }

  /**
   * Get the faded offset value
   */
  static getFadedOffset(offset: VisualDriftOffset): { x: number; y: number; z: number } {
    const fadeFactor = this.getFadeFactor(offset);
    return {
      x: offset.offsetX * fadeFactor,
      y: offset.offsetY * fadeFactor,
      z: offset.offsetZ * fadeFactor,
    };
  }

  /**
   * Get all active offsets
   */
  getActiveOffsets(): IterableIterator<[string | number, VisualDriftOffset]> {
    return this.offsets.entries();
  }

  /**
   * Clear all offsets
   */
  clear(): void {
    this.offsets.clear();
  }

  /**
   * Check if entity has active drift compensation
   */
  hasActiveDrift(entityId: string | number): boolean {
    return this.offsets.has(entityId);
  }
}
