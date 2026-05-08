import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  MemoryGrowthGuard,
  FPSDropGuard,
  ListenerLeakGuard,
  FailFastGuardsManager,
  getCurrentHeapMB,
  getActiveListenerCount,
} from '../../../../client/src/engine/diagnostics/FailFastGuards'

describe('FailFastGuards', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('MemoryGrowthGuard', () => {
    it('initializes baseline and passes on first sample', () => {
      const guard = new MemoryGrowthGuard()
      const result = guard.check(100)
      expect(result).toBe('PASS')
      expect(guard.getDiagnostics().baseline).toBe('100.00')
    })

    it('fails when heap growth exceeds threshold', () => {
      const guard = new MemoryGrowthGuard()
      guard.check(100)
      const result = guard.check(112)
      expect(result).toBe('FAIL')
      expect(guard.getDiagnostics().current).toBe('112.00')
      expect(guard.getDiagnostics().min).toBe('100.00')
    })

    it('resets baseline correctly', () => {
      const guard = new MemoryGrowthGuard()
      guard.check(100)
      guard.resetBaseline(200)
      expect(guard.getDiagnostics().baseline).toBe('200.00')
      expect(guard.check(210)).toBe('PASS')
    })
  })

  describe('FPSDropGuard', () => {
    it('passes when FPS stays stable', () => {
      const guard = new FPSDropGuard()
      for (let i = 0; i < 60; i += 1) {
        expect(guard.check(60)).toBe('PASS')
      }
      const diagnostics = guard.getDiagnostics()
      expect(diagnostics.current).toBe('60.0')
      expect(diagnostics.avgLast10).toBe('60.0')
      expect(diagnostics.failCount).toBe(0)
      expect(diagnostics.warnCount).toBe(0)
    })

    it('warns when average FPS drops below warning threshold', () => {
      const guard = new FPSDropGuard()
      for (let i = 0; i < 60; i += 1) {
        guard.check(50)
      }
      expect(guard.check(50)).toBe('WARN')
      const diagnostics = guard.getDiagnostics()
      expect(Number(diagnostics.avgLast60)).toBeGreaterThanOrEqual(50)
      expect(diagnostics.warnCount).toBeGreaterThan(0)
    })

    it('fails when average FPS drops below failure threshold', () => {
      const guard = new FPSDropGuard()
      for (let i = 0; i < 60; i += 1) {
        guard.check(40)
      }
      const result = guard.check(40)
      expect(result).toBe('FAIL')
      expect(guard.getDiagnostics().failCount).toBeGreaterThan(0)
    })
  })

  describe('ListenerLeakGuard', () => {
    it('passes on first sample and records baseline after transition', () => {
      const guard = new ListenerLeakGuard()
      expect(guard.check(3)).toBe('PASS')
      guard.recordTransition(3)
      expect(guard.check(5)).toBe('PASS')
      const diagnostics = guard.getDiagnostics()
      expect(diagnostics.baseline).toBe(3)
      expect(diagnostics.current).toBe(5)
      expect(diagnostics.sampleCount).toBe(2)
    })

    it('fails when listener count leaks beyond threshold', () => {
      const guard = new ListenerLeakGuard()
      guard.check(2)
      guard.recordTransition(2)
      expect(guard.check(10)).toBe('FAIL')
      const diagnostics = guard.getDiagnostics()
      expect(diagnostics.max).toBe(10)
    })
  })

  describe('FailFastGuardsManager', () => {
    it('records metrics and generates report after a normal frame', () => {
      const manager = new FailFastGuardsManager()
      manager.startTest('stress-check', 150)
      const result = manager.recordFrameMetrics(60, 150, 3)
      expect(result).toBe('PASS')
      manager.recordModeTransition(3)
      const report = manager.generateReport()
      expect(report.testName).toBe('stress-check')
      expect(report.memory.baseline).toBe('150.00')
      expect(report.listeners.transitionCount).toBe(1)
    })

    it('returns the most severe status when a failure occurs', () => {
      const manager = new FailFastGuardsManager()
      manager.startTest('stress-check', 100)
      const result = manager.recordFrameMetrics(60, 120, 3)
      expect(result).toBe('FAIL')
    })
  })

  describe('utility helpers', () => {
    it('returns heap size from performance.memory when available', () => {
      const originalPerformance = globalThis.performance
      Object.defineProperty(globalThis, 'performance', {
        value: {
          memory: { usedJSHeapSize: 5 * 1024 * 1024 },
        },
        configurable: true,
      })
      expect(getCurrentHeapMB()).toBeCloseTo(5, 3)
      Object.defineProperty(globalThis, 'performance', { value: originalPerformance })
    })

    it('returns active listener count from registry when available', () => {
      const registry = { getTrackedListenerCount: () => 42 }
      ;(globalThis as any).__eventListenerRegistry = registry
      expect(getActiveListenerCount()).toBe(42)
      delete (globalThis as any).__eventListenerRegistry
    })
  })
})
