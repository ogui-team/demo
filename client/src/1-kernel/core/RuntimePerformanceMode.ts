/**
 * RuntimePerformanceMode
 *
 * Three-tier performance mode that gates diagnostics, profiling, and
 * overlay overhead throughout the engine.
 *
 *  DEV     — Full diagnostics at original rates (explicit opt-in)
 *  CAPTURE — Release-gate capture with strict sample-quality requirements
 *  STABLE  — Throttled diagnostics, sampled profiling (default)
 *  RELEASE — Minimal overhead, all diagnostics disabled
 *
 * Set via URL query param `?perfMode=dev|capture|stable|release`
 * or by assigning `window.__ENGINE_PERF_MODE__` before engine boot.
 */

export const enum RuntimePerformanceMode {
  DEV     = 'dev',
  CAPTURE = 'capture',
  STABLE  = 'stable',
  RELEASE = 'release',
}

let currentMode: RuntimePerformanceMode = RuntimePerformanceMode.STABLE;

export function getRuntimePerformanceMode(): RuntimePerformanceMode {
  return currentMode;
}

export function setRuntimePerformanceMode(mode: RuntimePerformanceMode): void {
  currentMode = mode;
}

export function isDevMode(): boolean {
  return currentMode === RuntimePerformanceMode.DEV;
}

export function isReleaseMode(): boolean {
  return currentMode === RuntimePerformanceMode.RELEASE;
}

/** Call once during engine boot to pick up external overrides. */
export function initRuntimePerformanceMode(): void {
  const global = (globalThis as Record<string, unknown>).__ENGINE_PERF_MODE__;
  if (typeof global === 'string') {
    const g = global.toLowerCase();
    if (g === 'dev' || g === 'capture' || g === 'stable' || g === 'release') {
      currentMode = g as RuntimePerformanceMode;
      return;
    }
  }
  if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      const param = params.get('perfMode')?.toLowerCase();
      if (param === 'dev' || param === 'capture' || param === 'stable' || param === 'release') {
        currentMode = param as RuntimePerformanceMode;
      }
    } catch { /* SSR / test env — keep default */ }
  }
}
