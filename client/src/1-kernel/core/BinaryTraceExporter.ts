import { SimulationKernel } from './kernel/SimulationKernel';

/**
 * BITE Binary Export Utility
 * Exports the 300KB SharedArrayBuffer trace to a downloadable .trace binary file
 */
export class BinaryTraceExporter {
  /**
   * Export the BITE buffer as a binary .trace file.
   * Triggers browser download with filename: titan_session_trace.trace
   */
  static exportTrace(kernel: SimulationKernel): void {
    const buffer = kernel.getBiteBuffer();
    if (!buffer) {
      console.error('[BinaryTraceExporter] No BITE buffer available');
      return;
    }

    // Create a copy of the SharedArrayBuffer for download
    // SharedArrayBuffer cannot be directly converted to Blob, so we copy to regular ArrayBuffer
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    const sourceView = new Uint8Array(buffer);
    const destView = new Uint8Array(arrayBuffer);
    destView.set(sourceView);

    // Create Blob with binary MIME type
    const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });

    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `titan_session_trace_${Date.now()}.trace`;

    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log('[BinaryTraceExporter] Trace exported:', {
      filename: link.download,
      sizeKB: (buffer.byteLength / 1024).toFixed(1),
      frames: buffer.byteLength / 1024,
    });
  }

  /**
   * Export as hex dump (for debugging)
   */
  static exportHexDump(kernel: SimulationKernel, frameCount = 10): string {
    const buffer = kernel.getBiteBuffer();
    if (!buffer) return 'No BITE buffer';

    const stride = 1024;
    let output = '';

    for (let f = 0; f < frameCount; f += 1) {
      const offset = f * stride;
      const frameBytes = new Uint8Array(buffer, offset, 32); // First 32 bytes of frame header
      let hexLine = `Frame ${f}: `;

      for (let i = 0; i < frameBytes.length; i += 1) {
        hexLine += frameBytes[i].toString(16).padStart(2, '0') + ' ';
      }

      output += hexLine + '\n';
    }

    return output;
  }
}

/**
 * Trace Parser - Development utility for post-hoc analysis
 * Parses the .trace binary file and extracts frame data for inspection
 */
export class TraceParser {
  private buffer: ArrayBuffer;
  private view: DataView;
  private readonly stride = 1024;
  private readonly maxFrames = 300;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
  }

  /**
   * Parse a raw .trace file (ArrayBuffer)
   */
  static fromFile(file: File): Promise<TraceParser> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const buffer = reader.result as ArrayBuffer;
        resolve(new TraceParser(buffer));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Get frame header
   */
  getFrameHeader(frameIndex: number): any {
    if (frameIndex < 0 || frameIndex >= this.maxFrames) return null;

    const offset = frameIndex * this.stride;
    const frameIndex_val = this.view.getUint32(offset, true);
    const timestamp = this.view.getFloat64(offset + 8, true);
    const stateHash = this.view.getUint32(offset + 16, true);
    const commandCount = this.view.getUint16(offset + 20, true);

    return {
      frameIndex: frameIndex_val,
      timestamp,
      stateHash,
      commandCount,
    };
  }

  /**
   * Get reconciliation events from a frame
   */
  getReconciliationEvents(frameIndex: number): any[] {
    if (frameIndex < 0 || frameIndex >= this.maxFrames) return [];

    const offset = frameIndex * this.stride + 808; // RECONCILIATION_BASE
    const events = [];

    for (let i = 0; i < 6; i += 1) {
      // 6 max events
      const eventOffset = offset + i * 36;
      const timestamp = this.view.getFloat64(eventOffset, true);

      // Stop if timestamp is zero (no event)
      if (timestamp === 0) break;

      const entityId = this.view.getUint16(eventOffset + 8, true);
      const errorType = this.view.getUint8(eventOffset + 10);
      const deltaX = this.view.getFloat32(eventOffset + 11, true);

      events.push({
        entityId,
        errorType,
        correctionDistance: deltaX,
        timestamp,
      });
    }

    return events;
  }

  /**
   * Get gizmo override events from a frame
   */
  getGizmoEvents(frameIndex: number): any[] {
    if (frameIndex < 0 || frameIndex >= this.maxFrames) return [];

    const offset = frameIndex * this.stride + 752; // GIZMO_BASE
    const events = [];

    for (let i = 0; i < 4; i += 1) {
      // 4 max events
      const eventOffset = offset + i * 14;
      const entityId = this.view.getUint16(eventOffset, true);
      const overrideFlags = this.view.getUint8(eventOffset + 2);

      // Stop if entityId is zero (no event)
      if (entityId === 0) break;

      const posX = this.view.getFloat32(eventOffset + 3, true);
      const posY = this.view.getFloat32(eventOffset + 7, true);
      const posZ = this.view.getFloat32(eventOffset + 11, true);

      events.push({
        entityId,
        overrideFlags: {
          position: (overrideFlags & 0x1) !== 0,
          rotation: (overrideFlags & 0x2) !== 0,
          scale: (overrideFlags & 0x4) !== 0,
        },
        position: { x: posX, y: posY, z: posZ },
      });
    }

    return events;
  }

  /**
   * Print last N frames as console.table()
   * Development utility for quick inspection
   */
  printLastFrames(count = 10): void {
    const frames = [];

    for (let i = Math.max(0, this.maxFrames - count); i < this.maxFrames; i += 1) {
      const header = this.getFrameHeader(i);
      if (!header) continue;

      const reconcEvents = this.getReconciliationEvents(i);
      const gizmoEvents = this.getGizmoEvents(i);

      frames.push({
        Frame: header.frameIndex,
        Timestamp: new Date(header.timestamp).toISOString(),
        StateHash: `0x${header.stateHash.toString(16)}`,
        Commands: header.commandCount,
        ReconciliationEvents: reconcEvents.length,
        GizmoEvents: gizmoEvents.length,
      });
    }

    console.table(frames);

    // Print detailed events for last frame
    if (frames.length > 0) {
      const lastFrame = this.maxFrames - 1;
      const reconcEvents = this.getReconciliationEvents(lastFrame);
      const gizmoEvents = this.getGizmoEvents(lastFrame);

      if (reconcEvents.length > 0) {
        console.log(`\n[Last Frame ${lastFrame}] Reconciliation Events:`, reconcEvents);
      }

      if (gizmoEvents.length > 0) {
        console.log(`[Last Frame ${lastFrame}] Gizmo Override Events:`, gizmoEvents);
      }
    }
  }

  /**
   * Validate trace integrity (check for corruption)
   */
  validate(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check buffer size
    if (this.buffer.byteLength !== this.stride * this.maxFrames) {
      issues.push(
        `Invalid buffer size: ${this.buffer.byteLength} (expected ${this.stride * this.maxFrames})`
      );
    }

    // Check frame header integrity (frame indices should be sequential)
    let lastFrameIndex = -1;
    for (let i = 0; i < Math.min(10, this.maxFrames); i += 1) {
      const header = this.getFrameHeader(i);
      if (header && header.frameIndex !== lastFrameIndex + 1 && lastFrameIndex >= 0) {
        issues.push(`Frame discontinuity at frame ${i}: expected ${lastFrameIndex + 1}, got ${header.frameIndex}`);
      }
      if (header) {
        lastFrameIndex = header.frameIndex;
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}
