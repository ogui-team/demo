/**
 * DETERMINISTIC UTILITIES - SDK Module
 * 
 * Provides deterministic alternatives to non-deterministic operations:
 * - DeterministicTime: Replaces Date.now() with engine ticks
 * - DeterministicRandom: Replaces Math.random() with seeded RNG
 * - GlobalShim: Proxy injection for legacy code
 * 
 * Usage:
 *   const time = Engine.time.now()     // Instead of Date.now()
 *   const rand = Engine.random.next()  // Instead of Math.random()
 *   const date = Engine.time.date()    // Instead of new Date()
 */

/**
 * Deterministic Time Interface
 * 
 * Replaces system time with engine ticks for replay/determinism.
 */
export interface DeterministicTime {
  /**
   * Get current time in milliseconds (engine ticks)
   * Returns consistent value during deterministic replay
   */
  now(): number;
  
  /**
   * Get current time in seconds (for gameplay calculations)
   */
  seconds(): number;
  
  /**
   * Create a Date object using deterministic time
   */
  date(): Date;
  
  /**
   * Get delta time since last frame (in seconds)
   */
  deltaTime(): number;
  
  /**
   * Get current tick number (useful for replays)
   */
  tick(): number;
}

/**
 * Deterministic Random Interface
 * 
 * Replaces Math.random() with seeded RNG for determinism.
 */
export interface DeterministicRandom {
  /**
   * Get next random value [0, 1)
   * Deterministic given same seed
   */
  next(): number;
  
  /**
   * Get random integer in range [min, max)
   */
  nextInt(min: number, max: number): number;
  
  /**
   * Get random float in range [min, max)
   */
  nextFloat(min: number, max: number): number;
  
  /**
   * Reseed the RNG (for replay scenarios)
   */
  seed(value: number): void;
  
  /**
   * Get current seed
   */
  getSeed(): number;
}

/**
 * Implementation: Deterministic Time
 * 
 * Backed by engine tick system for consistency.
 */
export class DeterministicTimeImpl implements DeterministicTime {
  private currentTick: number = 0;
  private tickDeltaMs: number = 16; // Default 60 FPS
  private startTime: number = Date.now();
  
  constructor(private gameLoop?: any) {
    if (gameLoop && gameLoop.currentTick !== undefined) {
      this.currentTick = gameLoop.currentTick;
    }
  }
  
  now(): number {
    if (this.gameLoop?.currentTick !== undefined) {
      this.currentTick = this.gameLoop.currentTick;
    }
    return this.currentTick * this.tickDeltaMs;
  }
  
  seconds(): number {
    return this.now() / 1000;
  }
  
  date(): Date {
    return new Date(this.startTime + this.now());
  }
  
  deltaTime(): number {
    return this.tickDeltaMs / 1000;
  }
  
  tick(): number {
    if (this.gameLoop?.currentTick !== undefined) {
      this.currentTick = this.gameLoop.currentTick;
    }
    return this.currentTick;
  }
  
  setTickDelta(ms: number): void {
    this.tickDeltaMs = ms;
  }
}

/**
 * Implementation: Deterministic Random
 * 
 * Seeded RNG for replay determinism.
 * Uses Linear Congruential Generator (simple, fast, deterministic).
 */
export class DeterministicRandomImpl implements DeterministicRandom {
  private seed_: number;
  private multiplier: number = 1664525;
  private increment: number = 1013904223;
  private modulus: number = 2 ** 32;
  
  constructor(initialSeed: number = 12345) {
    this.seed_ = initialSeed;
  }
  
  next(): number {
    // Linear Congruential Generator
    this.seed_ = (this.multiplier * this.seed_ + this.increment) % this.modulus;
    return this.seed_ / this.modulus; // Normalize to [0, 1)
  }
  
  nextInt(min: number, max: number): number {
    const range = max - min;
    return min + Math.floor(this.next() * range);
  }
  
  nextFloat(min: number, max: number): number {
    const range = max - min;
    return min + this.next() * range;
  }
  
  seed(value: number): void {
    this.seed_ = value;
  }
  
  getSeed(): number {
    return this.seed_;
  }
}

/**
 * Deterministic Timer Interface
 * 
 * Provides delay scheduling without breaking determinism.
 * Backed by frame/tick system instead of wall-clock.
 */
export interface DeterministicTimer {
  /**
   * Schedule callback after N milliseconds (as ticks)
   */
  setTimeout(callback: () => void, delayMs: number): number;
  
  /**
   * Clear scheduled timeout
   */
  clearTimeout(id: number): void;
  
  /**
   * Schedule callback to run every N milliseconds
   */
  setInterval(callback: () => void, intervalMs: number): number;
  
  /**
   * Clear scheduled interval
   */
  clearInterval(id: number): void;
}

/**
 * Implementation: Deterministic Timer
 * 
 * Backed by tick-based scheduling.
 */
export class DeterministicTimerImpl implements DeterministicTimer {
  private timeoutId: number = 0;
  private timeouts: Map<number, { callback: () => void; targetTick: number }> = new Map();
  private intervals: Map<number, { callback: () => void; intervalTicks: number; nextTick: number }> = new Map();
  
  constructor(private gameLoop?: any) {}
  
  setTimeout(callback: () => void, delayMs: number): number {
    const id = ++this.timeoutId;
    const targetTick = (this.gameLoop?.currentTick || 0) + Math.ceil(delayMs / 16); // 16ms per tick (60 FPS)
    this.timeouts.set(id, { callback, targetTick });
    return id;
  }
  
  clearTimeout(id: number): void {
    this.timeouts.delete(id);
  }
  
  setInterval(callback: () => void, intervalMs: number): number {
    const id = ++this.timeoutId;
    const intervalTicks = Math.ceil(intervalMs / 16);
    const nextTick = (this.gameLoop?.currentTick || 0) + intervalTicks;
    this.intervals.set(id, { callback, intervalTicks, nextTick });
    return id;
  }
  
  clearInterval(id: number): void {
    this.intervals.delete(id);
  }
  
  /**
   * Called once per frame to execute scheduled callbacks
   * Should be called from game loop
   */
  tick(): void {
    const currentTick = this.gameLoop?.currentTick || 0;
    
    // Process timeouts
    for (const [id, { callback, targetTick }] of this.timeouts.entries()) {
      if (currentTick >= targetTick) {
        callback();
        this.timeouts.delete(id);
      }
    }
    
    // Process intervals
    for (const [id, { callback, intervalTicks, nextTick: nextTickRef }] of this.intervals.entries()) {
      const entry = this.intervals.get(id);
      if (entry && currentTick >= entry.nextTick) {
        callback();
        entry.nextTick += entry.intervalTicks;
      }
    }
  }
}

/**
 * Global Engine Time/Random/Timer Proxy
 * 
 * Attached to global Engine object for easy access:
 * - Engine.time.now() instead of Date.now()
 * - Engine.random.next() instead of Math.random()
 * - Engine.timer.setTimeout() instead of setTimeout()
 */
export interface EngineProxy {
  time: DeterministicTime;
  random: DeterministicRandom;
  timer: DeterministicTimer;
}

/**
 * Create Engine proxy for global injection
 */
export function createEngineProxy(
  time: DeterministicTime,
  random: DeterministicRandom,
  timer?: DeterministicTimer
): EngineProxy {
  return { time, random, timer: timer || new DeterministicTimerImpl() };
}

/**
 * Global Shim for Legacy Code
 * 
 * Injects a shim that redirects legacy Date.now/Math.random
 * to deterministic versions without refactoring.
 * 
 * Usage at top of file:
 *   import { injectDeterminismShim } from '@shared/contracts';
 *   injectDeterminismShim();
 *   
 *   // Now Date.now() and Math.random() use deterministic implementations
 */
export function injectDeterminismShim(engine?: EngineProxy): void {
  // Check for browser environment using globalThis
  if (typeof globalThis === 'undefined') {
    return; // Node environment, skip
  }

  const win = globalThis as any;
  
  // Default implementations if engine not provided
  const defaultTime = new DeterministicTimeImpl();
  const defaultRandom = new DeterministicRandomImpl();
  const proxy: EngineProxy = engine || {
    time: defaultTime,
    random: defaultRandom,
    timer: new DeterministicTimerImpl(),
  };
  
  // Save originals for reference
  const originalDateNow = Date.now;
  const originalMathRandom = Math.random;
  
  // Override Date.now()
  (Date as any).now = function(): number {
    return proxy.time.now();
  };
  
  // Override Math.random()
  Math.random = function(): number {
    return proxy.random.next();
  };
  
  // Mark that shim is active
  win.__DETERMINISM_SHIM_ACTIVE__ = true;
  win.__ENGINE_PROXY__ = proxy;
  
  // Provide access to restore if needed
  win.__RESTORE_NONDETERMINISM__ = function() {
    Date.now = originalDateNow;
    Math.random = originalMathRandom;
    win.__DETERMINISM_SHIM_ACTIVE__ = false;
  };
}

/**
 * Check if determinism shim is active
 */
export function isDeterminismShimActive(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const win = globalThis as any;
  return win.__DETERMINISM_SHIM_ACTIVE__ === true;
}

/**
 * Get current engine proxy
 */
export function getEngineProxy(): EngineProxy | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  const win = globalThis as any;
  return win.__ENGINE_PROXY__;
}

/**
 * Replace Legacy Code Pattern Mapping
 * 
 * These regex patterns are used for automated refactoring:
 */
export const DETERMINISM_REFACTOR_PATTERNS = {
  // Date.now() → Engine.time.now()
  dateNow: {
    pattern: /Date\.now\(\)/g,
    replacement: 'Engine.time.now()',
    description: 'Replace Date.now() with deterministic time',
  },
  
  // Math.random() → Engine.random.next()
  mathRandom: {
    pattern: /Math\.random\(\)/g,
    replacement: 'Engine.random.next()',
    description: 'Replace Math.random() with deterministic RNG',
  },
  
  // new Date() → Engine.time.date()
  newDate: {
    pattern: /new Date\(\)/g,
    replacement: 'Engine.time.date()',
    description: 'Replace new Date() with deterministic date',
  },
  
  // new Date(timestamp) → Engine.time.dateFromTimestamp(timestamp)
  newDateTimestamp: {
    pattern: /new Date\(([^)]+)\)/g,
    replacement: (match: string, arg: string) => {
      // Only match if not already inside Engine.time
      if (arg.includes('Engine.time')) return match;
      return `Engine.time.dateFromTimestamp(${arg})`;
    },
    description: 'Replace new Date(timestamp) with deterministic variant',
  },
};

/**
 * List of files that should be automatically refactored
 * 
 * These patterns match file paths that should have determinism applied.
 */
export const DETERMINISM_REFACTOR_TARGETS = [
  '**/src/**/*.ts',        // All source files
  '!**/src/**/*.test.ts',  // Exclude tests
  '!**/src/**/*.spec.ts',  // Exclude specs
  '!**/node_modules/**',   // Exclude node_modules
];

/**
 * Files that are exempt from automatic refactoring
 * (use shim instead)
 */
export const DETERMINISM_EXEMPTIONS = [
  'client/src/4-runtime/diagnostics/**', // Diagnostics OK to use real time
  'client/src/1-kernel/core/debug/**',   // Debug systems OK
];
