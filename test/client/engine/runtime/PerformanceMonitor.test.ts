import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PerformanceMonitor } from '../../../../client/src/engine/runtime/PerformanceMonitor'

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(PerformanceMonitor.prototype as any, 'startFpsMonitoring').mockImplementation(() => undefined)
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    monitor = new PerformanceMonitor()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns zero stats before any metrics are recorded', () => {
    expect(monitor.getStats()).toEqual({
      metricsCollected: 0,
      averageTTI: 0,
      worstTTI: 0,
      bestTTI: 0,
      averageMemory: 0,
      alertsTriggered: 0,
    })
  })

  it('adds a threshold alert when bootloader metrics exceed the defined threshold', () => {
    monitor.recordBootloaderMetrics(0, 500)

    const alerts = monitor.getAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      type: 'threshold',
      metric: 'bootloaderToKernel',
      currentValue: 500,
      threshold: 400,
    })
  })

  it('adds a chunk load alert when chunk load time exceeds the warning threshold', () => {
    monitor.recordChunkLoadMetrics('freeplay', 900)

    const alerts = monitor.getAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      type: 'threshold',
      metric: 'chunkLoadTime',
      currentValue: 900,
      threshold: 800,
    })
  })

  it('persists session metrics and detects a regression after enough history', () => {
    for (let i = 0; i < 5; i += 1) {
      monitor.recordSessionMetrics(100, 100, 0)
    }

    monitor.recordSessionMetrics(250, 250, 100)

    expect(setItemSpy).toHaveBeenCalled()
    expect(monitor.getRecentMetrics(3)).toHaveLength(3)
    expect(monitor.getStats().metricsCollected).toBe(6)
    expect(monitor.getAlerts().some((alert) => alert.type === 'regression')).toBe(true)
  })
})
