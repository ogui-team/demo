/**
 * INTERPOLATION SYSTEM: Apply Linear Interpolation + Velocity Extrapolation
 * 
 * Solves: 60Hz kernel ticks but 144fps rendering = microsnapping
 * 
 * Architecture:
 * - TickManager provides renderAlpha (0.0 to 1.0) within tick interval
 * - InterpolationSystem reads:
 *   - previousPositions (from read buffer: last tick's published state)
 *   - currentPositions (from write buffer: this tick's calculated state)
 *   - velocities (for extrapolation)
 * - Outputs: visualPositions = lerp(prev, curr, alpha) + velocity * extrapolationFactor
 * 
 * Zero-allocation: All reads from TypedArrays, direct float calculations
 */

import { SimulationKernel } from '../../1-kernel/core/kernel/SimulationKernel';
import { TickManager } from '../../1-kernel/core/kernel/TickManager';

export interface InterpolationConfig {
  enableExtrapolation: boolean;
  extrapolationScale: number; // How much to predict ahead (default: 1.0)
  diagnosticsEnabled: boolean;
  diagnosticsInterval: number; // Frames between logs
}

export class InterpolationSystem {
  private kernel: SimulationKernel;
  private tickManager: TickManager;
  private config: InterpolationConfig;
  private diagnosticsFrameCounter: number = 0;

  // Cached read buffers to avoid re-fetching every frame
  private previousPositions: Float32Array;
  private currentPositions: Float32Array;
  private velocities: Float32Array;
  private visualPositions: Float32Array; // Output buffer

  constructor(
    kernel: SimulationKernel,
    tickManager: TickManager,
    config?: Partial<InterpolationConfig>,
  ) {
    this.kernel = kernel;
    this.tickManager = tickManager;
    this.config = {
      enableExtrapolation: true,
      extrapolationScale: 1.0,
      diagnosticsEnabled: true,
      diagnosticsInterval: 60, // Log once per second at 60fps
      ...config,
    };

    // Initialize buffers (allocated once, reused every frame)
    const maxCapacity = kernel.positions.maxCapacity;
    this.previousPositions = new Float32Array(maxCapacity * 3);
    this.currentPositions = new Float32Array(maxCapacity * 3);
    this.velocities = new Float32Array(maxCapacity * 3);
    this.visualPositions = new Float32Array(maxCapacity * 3);
  }

  /**
   * Call this ONCE per render frame (before EntityRenderer.update())
   * Outputs interpolated positions for visual rendering
   */
  update(activeCount: number): Float32Array {
    const alpha = this.tickManager.calculateRenderAlpha();

    // Fetch current buffer state
    const readBuffer = this.kernel.positions.getReadBuffer(); // Last tick (published)
    const writeBuffer = this.kernel.positions.getWriteBuffer(); // This tick (in-flight)
    const velocityBuffer = this.kernel.velocities.getAuthoritativeBuffer();

    // Cache buffers for this frame
    this.previousPositions.set(readBuffer.subarray(0, activeCount * 3), 0);
    this.currentPositions.set(writeBuffer.subarray(0, activeCount * 3), 0);
    this.velocities.set(velocityBuffer.subarray(0, activeCount * 3), 0);

    // Interpolate all active entities
    for (let i = 0; i < activeCount; i += 1) {
      const basePos = i * 3;

      // Read previous (last tick's published) and current (this tick) positions
      const prevX = this.previousPositions[basePos];
      const prevY = this.previousPositions[basePos + 1];
      const prevZ = this.previousPositions[basePos + 2];

      const currX = this.currentPositions[basePos];
      const currY = this.currentPositions[basePos + 1];
      const currZ = this.currentPositions[basePos + 2];

      // Linear interpolation between previous and current
      let visualX = prevX + (currX - prevX) * alpha;
      let visualY = prevY + (currY - prevY) * alpha;
      let visualZ = prevZ + (currZ - prevZ) * alpha;

      // Optional: Velocity-based extrapolation (predict ahead)
      if (this.config.enableExtrapolation) {
        const velX = this.velocities[basePos];
        const velY = this.velocities[basePos + 1];
        const velZ = this.velocities[basePos + 2];

        // Predict how far the entity will move in the remaining time of this tick
        // Scale: 0.0 at tick start, 1.0 at tick end, then predicts into future
        const extrapolationTime = (1.0 - alpha) * (1000 / 60); // ms until next tick
        const extrapolationScale = (extrapolationTime / 1000) * this.config.extrapolationScale;

        visualX += velX * extrapolationScale;
        visualY += velY * extrapolationScale;
        visualZ += velZ * extrapolationScale;
      }

      // Store interpolated position
      this.visualPositions[basePos] = visualX;
      this.visualPositions[basePos + 1] = visualY;
      this.visualPositions[basePos + 2] = visualZ;
    }

    // Diagnostics: Log interpolation state once per second
    if (this.config.diagnosticsEnabled) {
      this.diagnosticsFrameCounter += 1;
      if (this.diagnosticsFrameCounter >= this.config.diagnosticsInterval) {
        this.diagnosticsFrameCounter = 0;
        this.logDiagnostics(alpha, activeCount);
      }
    }

    return this.visualPositions;
  }

  /**
   * Get the interpolated position buffer for current frame
   * (Call after update() in the same frame)
   */
  getVisualPositions(): Float32Array {
    return this.visualPositions;
  }

  /**
   * Diagnostic logging
   */
  private logDiagnostics(alpha: number, activeCount: number): void {
    // Sample first few entities to show interpolation state
    const samples: string[] = [];
    for (let i = 0; i < Math.min(3, activeCount); i += 1) {
      const basePos = i * 3;
      const prev = `(${this.previousPositions[basePos].toFixed(1)},${this.previousPositions[basePos + 1].toFixed(1)},${this.previousPositions[basePos + 2].toFixed(1)})`;
      const curr = `(${this.currentPositions[basePos].toFixed(1)},${this.currentPositions[basePos + 1].toFixed(1)},${this.currentPositions[basePos + 2].toFixed(1)})`;
      const visual = `(${this.visualPositions[basePos].toFixed(1)},${this.visualPositions[basePos + 1].toFixed(1)},${this.visualPositions[basePos + 2].toFixed(1)})`;
      samples.push(`E${i}: prev${prev} curr${curr} visual${visual}`);
    }

    const msUntilNext = this.tickManager.msUntilNextTick();
    console.log(
      `[InterpolationSystem] Alpha=${alpha.toFixed(3)}, Entities=${activeCount}, NextTickIn=${msUntilNext.toFixed(1)}ms | ${samples.join(' | ')}`,
    );
  }
}
