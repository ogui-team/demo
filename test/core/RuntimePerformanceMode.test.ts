import {
  getRuntimePerformanceMode,
  initRuntimePerformanceMode,
  isDevMode,
  isReleaseMode,
  RuntimePerformanceMode,
  setRuntimePerformanceMode,
} from '../../client/src/engine/core/RuntimePerformanceMode'

describe('RuntimePerformanceMode', () => {
  beforeEach(() => {
    delete (globalThis as any).__ENGINE_PERF_MODE__
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/?')
    }
    setRuntimePerformanceMode(RuntimePerformanceMode.STABLE)
  })

  it('defaults to stable mode', () => {
    expect(getRuntimePerformanceMode()).toBe(RuntimePerformanceMode.STABLE)
    expect(isDevMode()).toBe(false)
    expect(isReleaseMode()).toBe(false)
  })

  it('allows switching modes and reports dev/release correctly', () => {
    setRuntimePerformanceMode(RuntimePerformanceMode.DEV)
    expect(getRuntimePerformanceMode()).toBe(RuntimePerformanceMode.DEV)
    expect(isDevMode()).toBe(true)
    expect(isReleaseMode()).toBe(false)

    setRuntimePerformanceMode(RuntimePerformanceMode.RELEASE)
    expect(isDevMode()).toBe(false)
    expect(isReleaseMode()).toBe(true)
  })

  it('reads override from global __ENGINE_PERF_MODE__', () => {
    ;(globalThis as any).__ENGINE_PERF_MODE__ = 'dev'
    initRuntimePerformanceMode()
    expect(getRuntimePerformanceMode()).toBe(RuntimePerformanceMode.DEV)
  })

  it('ignores invalid perfMode query params and preserves default', () => {
    window.history.replaceState(null, '', '/?perfMode=invalid')
    initRuntimePerformanceMode()
    expect(getRuntimePerformanceMode()).toBe(RuntimePerformanceMode.STABLE)
  })

  it('accepts valid perfMode query params from the window location', () => {
    window.history.replaceState(null, '', '/?perfMode=release')
    initRuntimePerformanceMode()
    expect(getRuntimePerformanceMode()).toBe(RuntimePerformanceMode.RELEASE)
  })
})
