/**
 * Global Engine Namespace Declaration
 *
 * Declares the Engine global so files can use Engine.time.now() and
 * Engine.random.next() without a per-file import.
 *
 * The actual implementation is attached to globalThis in Engine.ts.
 */

interface EngineTimeApi {
  now(): number;
  seconds(): number;
  date(): Date;
}

interface EngineRandomApi {
  next(): number;
  nextInt(min: number, max: number): number;
  nextFloat(min: number, max: number): number;
}

interface EngineTimerApi {
  setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): ReturnType<typeof globalThis.setTimeout>;
  clearTimeout(id: ReturnType<typeof globalThis.setTimeout>): void;
  setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): ReturnType<typeof globalThis.setInterval>;
  clearInterval(id: ReturnType<typeof globalThis.setInterval>): void;
}

interface EngineGlobal {
  readonly time: EngineTimeApi;
  readonly random: EngineRandomApi;
  readonly timer: EngineTimerApi;
}

declare var Engine: EngineGlobal;

declare const process: {
  env: {
    NODE_ENV?: string;
    [key: string]: string | undefined;
  };
};

declare function require(moduleName: string): any;
