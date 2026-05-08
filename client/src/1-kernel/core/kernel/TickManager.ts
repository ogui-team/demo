/**
 * TICK MANAGER: Synchronize variable framerate rendering with fixed simulation ticks
 * 
 * Problem: 60Hz kernel ticks but 144fps rendering = microsnapping
 * Solution: Calculate renderAlpha (0.0 to 1.0) representing progress within current tick
 * 
 * Formula: alpha = (now - lastTickTime) / msPerTick
 * - alpha = 0.0 → just completed tick, at previous position
 * - alpha = 0.5 → halfway through tick interval
 * - alpha = 1.0 → tick just occurred, at current position
 */
export class TickManager {
  private tickRate: number;           // Ticks per second (60)
  private msPerTick: number;          // Milliseconds per tick (16.67)
  private lastTickTimestamp: number;  // performance.now() at last tick
  private currentTick: number;        // Tick counter
  private readonly highResTimer: () => number; // performance.now or compatible

  constructor(tickRate: number = 60) {
    this.tickRate = tickRate;
    this.msPerTick = 1000 / tickRate;
    this.currentTick = 0;
    this.highResTimer = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
    this.lastTickTimestamp = this.getHighResTime();
  }

  private getHighResTime(): number {
    return this.highResTimer();
  }

  /**
   * Call this ONCE per simulation tick (in SimulationKernel.tickOnce)
   * Updates the internal tick timestamp
   */
  recordTick(): void {
    this.currentTick += 1;
    this.lastTickTimestamp = this.getHighResTime();
  }

  /**
   * Call this EVERY FRAME (in Engine render loop) to get interpolation alpha
   * Returns 0.0 to 1.0, where:
   *   0.0 = render time matches last tick (use previous position)
   *   0.5 = render time is halfway through tick interval (blend both)
   *   1.0 = render time matches next tick (use current position)
   * 
   * Clamped to [0.0, 1.0] to handle variable frame rates and missed frames
   */
  calculateRenderAlpha(): number {
    const now = this.getHighResTime();
    const timeSinceLastTick = now - this.lastTickTimestamp;
    
    // Calculate position within tick interval (0.0 to 1.0)
    const alpha = timeSinceLastTick / this.msPerTick;
    
    // Clamp to [0.0, 1.0] to handle frame rate variance and lag
    // Values > 1.0 mean we're overdue for the next tick (lag)
    // Values < 0.0 shouldn't happen but we clamp just in case
    return Math.max(0.0, Math.min(1.0, alpha));
  }

  /**
   * Get the current tick number
   */
  getTick(): number {
    return this.currentTick;
  }

  /**
   * Diagnostic: How far into the current tick are we? (in milliseconds)
   */
  getTimeSinceLastTick(): number {
    return this.getHighResTime() - this.lastTickTimestamp;
  }

  /**
   * Diagnostic: Are we overdue for a tick? (lag detection)
   * Returns true if we're more than 1.5× msPerTick behind
   */
  isTickLagging(): boolean {
    return this.getTimeSinceLastTick() > this.msPerTick * 1.5;
  }

  /**
   * Diagnostic: Expected time until next tick
   */
  msUntilNextTick(): number {
    return Math.max(0, this.msPerTick - this.getTimeSinceLastTick());
  }

  /**
   * Console diagnostic (call ~once per second)
   */
  logDiagnostics(): void {
    const alpha = this.calculateRenderAlpha();
    const lag = this.isTickLagging();
    console.log(
      `[TickManager] Tick=${this.currentTick}, Alpha=${alpha.toFixed(3)}, ${this.getTimeSinceLastTick().toFixed(2)}ms/${this.msPerTick.toFixed(2)}ms${lag ? ' ⚠️ LAGGING' : ''}`,
    );
  }
}

/**
 * SINGLETON INSTANCE
 * Import as: import { tickManager } from './TickManager'
 */
export const tickManager = new TickManager(60);
