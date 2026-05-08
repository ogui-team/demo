import { BinaryTraceExporter, TraceParser } from './BinaryTraceExporter';
import type { SimulationKernel } from './kernel/SimulationKernel';

/**
 * BITE Trace Window API
 * Exposes binary trace export functionality to the global window object
 * 
 * Usage:
 *   window.exportTrace() - Download .trace file
 *   window.parseTrace(file) - Parse uploaded .trace file
 *   window.dumpTraceHex() - Print hex dump to console
 */

declare global {
  interface Window {
    /**
     * Export the current session's BITE buffer to a downloadable .trace file
     */
    exportTrace(): void;

    /**
     * Parse a .trace file and print frame summary to console
     */
    parseTrace(file: File): Promise<void>;

    /**
     * Print hex dump of first 10 frames to console
     */
    dumpTraceHex(): void;

    /**
     * Access the kernel instance for diagnostics
     */
    __kernelInstance?: SimulationKernel;

    /**
     * Access the TraceParser class for manual analysis
     */
    TraceParser: typeof TraceParser;
  }
}

/**
 * Initialize BITE Trace API when kernel is ready
 * Called from BootstrapGame or engine init
 */
export function initializeTraceAPI(kernel: SimulationKernel): void {
  window.__kernelInstance = kernel;
  window.TraceParser = TraceParser;

  // Export trace command
  window.exportTrace = () => {
    if (!window.__kernelInstance) {
      console.error('Kernel not initialized');
      return;
    }
    BinaryTraceExporter.exportTrace(window.__kernelInstance);
  };

  // Parse trace file
  window.parseTrace = async (file: File) => {
    try {
      const parser = await TraceParser.fromFile(file);
      const validation = parser.validate();
      console.log('[TraceParser] Validation:', validation);
      parser.printLastFrames(10);
    } catch (error) {
      console.error('[TraceParser] Error parsing file:', error);
    }
  };

  // Hex dump
  window.dumpTraceHex = () => {
    if (!window.__kernelInstance) {
      console.error('Kernel not initialized');
      return;
    }
    const hex = BinaryTraceExporter.exportHexDump(window.__kernelInstance, 10);
    console.log(hex);
  };

  console.log('[BITE API] Trace export enabled - use window.exportTrace() to download .trace file');
}
