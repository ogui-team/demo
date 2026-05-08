import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeMetricsReporter } from '../../../../client/src/engine/diagnostics/debug/RuntimeMetricsReporter'
import { runtimeFrameCostProfiler } from '../../../../client/src/engine/diagnostics/debug/FrameCostProfiler'
import { getRuntimePerformanceMode, RuntimePerformanceMode } from '@engine/core/public-api'

vi.mock('@engine/core/public-api', async () => {
  const actual = await vi.importActual<typeof import('@engine/core/public-api')>('@engine/core/public-api')
  return {
    ...actual,
    getRuntimePerformanceMode: vi.fn(),
  }
})

describe('RuntimeMetricsReporter', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    document.hasFocus = () => true
    vi.spyOn(runtimeFrameCostProfiler, 'consumeBreakdown').mockReturnValue({
      cpuFrameAvgMs: 5,
      cpuFramePeakMs: 8,
      breakdown: [{ name: 'render', durationMs: 5 }],
    })
  })

  it('skips metrics collection in RELEASE mode', async () => {
    const runtimeModeMock = getRuntimePerformanceMode as unknown as { mockReturnValue: (value: RuntimePerformanceMode) => void }
    runtimeModeMock.mockReturnValue(RuntimePerformanceMode.RELEASE)

    const reporter = new RuntimeMetricsReporter({
      getBaseUrl: () => 'https://metrics.example.com',
      getSessionId: () => 'session-1',
      getMetrics: () => ({
        worldObjectCount: 12,
        visibleRenderables: 4,
        snapshotPayloadBytes: 1024,
        snapshotBytesPerSnapshot: 256,
        replicationUpdatesPerTick: 2,
        actorReplicationCount: 3,
      }),
      isEnabled: () => true,
      intervalSeconds: 1,
    })

    reporter.update(1.2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(reporter.getLastSample()).toBeNull()
  })

  it('publishes a metrics payload when enabled and interval elapses', async () => {
    const runtimeModeMock = getRuntimePerformanceMode as unknown as { mockReturnValue: (value: RuntimePerformanceMode) => void }
    runtimeModeMock.mockReturnValue(RuntimePerformanceMode.DEV)

    const reporter = new RuntimeMetricsReporter({
      getBaseUrl: () => 'https://metrics.example.com',
      getSessionId: () => 'session-2',
      getMetrics: () => ({
        worldObjectCount: 25,
        visibleRenderables: 8,
        snapshotPayloadBytes: 2048,
        snapshotBytesPerSnapshot: 512,
        replicationUpdatesPerTick: 4,
        actorReplicationCount: 6,
      }),
      isEnabled: () => true,
      intervalSeconds: 1,
    })

    reporter.update(1.1)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://metrics.example.com/runtime-metrics', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }))

    const lastSample = reporter.getLastSample()
    expect(lastSample).not.toBeNull()
    expect(lastSample?.sessionId).toBe('session-2')
    expect(lastSample?.worldObjectCount).toBe(25)
    expect(lastSample?.cpuFrameAvgMs).toBe(5)
    expect(lastSample?.cpuFramePeakMs).toBe(8)
    expect(lastSample?.frameCostBreakdown).toEqual([{ name: 'render', durationMs: 5 }])
  })

  it('does not publish when disabled', async () => {
    const runtimeModeMock = getRuntimePerformanceMode as unknown as { mockReturnValue: (value: RuntimePerformanceMode) => void }
    runtimeModeMock.mockReturnValue(RuntimePerformanceMode.DEV)

    const reporter = new RuntimeMetricsReporter({
      getBaseUrl: () => 'https://metrics.example.com',
      getSessionId: () => 'session-3',
      getMetrics: () => ({
        worldObjectCount: 7,
        visibleRenderables: 2,
        snapshotPayloadBytes: 512,
        snapshotBytesPerSnapshot: 128,
        replicationUpdatesPerTick: 1,
        actorReplicationCount: 1,
      }),
      isEnabled: () => false,
      intervalSeconds: 1,
    })

    reporter.update(1.2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(reporter.getLastSample()).toBeNull()
  })

  it('uses the URL search params to resolve scenario class and perf mode', async () => {
    const runtimeModeMock = getRuntimePerformanceMode as unknown as { mockReturnValue: (value: RuntimePerformanceMode) => void }
    runtimeModeMock.mockReturnValue(RuntimePerformanceMode.STABLE)

    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/?metricsScenarioClass=stress&perfMode=stable'),
      configurable: true,
    })

    const reporter = new RuntimeMetricsReporter({
      getBaseUrl: () => 'https://metrics.example.com',
      getSessionId: () => 'session-4',
      getMetrics: () => ({
        worldObjectCount: 10,
        visibleRenderables: 5,
        snapshotPayloadBytes: 1024,
        snapshotBytesPerSnapshot: 256,
        replicationUpdatesPerTick: 3,
        actorReplicationCount: 2,
      }),
      isEnabled: () => true,
      intervalSeconds: 1,
    })

    reporter.update(1.2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const lastSample = reporter.getLastSample()
    expect(lastSample?.scenarioClass).toBe('stress')
    expect(lastSample?.performanceMode).toBe(RuntimePerformanceMode.STABLE)

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    })
  })

  it('falls back to CAPTURE when release_freeplay metrics session ID is present', async () => {
    const runtimeModeMock = getRuntimePerformanceMode as unknown as { mockReturnValue: (value: RuntimePerformanceMode) => void }
    runtimeModeMock.mockReturnValue(RuntimePerformanceMode.DEV)

    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/?metricsSessionId=release_freeplay'),
      configurable: true,
    })

    const reporter = new RuntimeMetricsReporter({
      getBaseUrl: () => 'https://metrics.example.com',
      getSessionId: () => 'session-5',
      getMetrics: () => ({
        worldObjectCount: 8,
        visibleRenderables: 2,
        snapshotPayloadBytes: 512,
        snapshotBytesPerSnapshot: 128,
        replicationUpdatesPerTick: 2,
        actorReplicationCount: 1,
      }),
      isEnabled: () => true,
      intervalSeconds: 1,
    })

    reporter.update(1.2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(reporter.getLastSample()?.performanceMode).toBe(RuntimePerformanceMode.CAPTURE)

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    })
  })

  it('uses baseline scenario class when metricsScenarioClass is baseline', async () => {
    const runtimeModeMock = getRuntimePerformanceMode as unknown as { mockReturnValue: (value: RuntimePerformanceMode) => void }
    runtimeModeMock.mockReturnValue(RuntimePerformanceMode.CAPTURE)

    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/?metricsScenarioClass=baseline'),
      configurable: true,
    })

    const reporter = new RuntimeMetricsReporter({
      getBaseUrl: () => 'https://metrics.example.com',
      getSessionId: () => 'session-6',
      getMetrics: () => ({
        worldObjectCount: 20,
        visibleRenderables: 10,
        snapshotPayloadBytes: 1024,
        snapshotBytesPerSnapshot: 256,
        replicationUpdatesPerTick: 5,
        actorReplicationCount: 4,
      }),
      isEnabled: () => true,
      intervalSeconds: 1,
    })

    reporter.update(1.2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(reporter.getLastSample()?.scenarioClass).toBe('baseline')

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    })
  })

  it('records low-quality reasons when visibility or focus is missing', async () => {
    const runtimeModeMock = getRuntimePerformanceMode as unknown as { mockReturnValue: (value: RuntimePerformanceMode) => void }
    runtimeModeMock.mockReturnValue(RuntimePerformanceMode.DEV)

    const reporter = new RuntimeMetricsReporter({
      getBaseUrl: () => 'https://metrics.example.com',
      getSessionId: () => 'session-5',
      getMetrics: () => ({
        worldObjectCount: 6,
        visibleRenderables: 1,
        snapshotPayloadBytes: 256,
        snapshotBytesPerSnapshot: 64,
        replicationUpdatesPerTick: 1,
        actorReplicationCount: 0,
      }),
      isEnabled: () => true,
      intervalSeconds: 1,
    })

    ;(reporter as any).visibilityProbeCounter = 30
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    document.hasFocus = () => false

    reporter.update(1.2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const lastSample = reporter.getLastSample()
    expect(lastSample?.sampleQuality.valid).toBe(false)
    expect(lastSample?.sampleQuality.reasons.some((reason) => reason.includes('visibility'))).toBe(true)
    expect(lastSample?.sampleQuality.reasons.some((reason) => reason.includes('focus'))).toBe(true)
  })

  it('handles publish failures gracefully', async () => {
    const runtimeModeMock = getRuntimePerformanceMode as unknown as { mockReturnValue: (value: RuntimePerformanceMode) => void }
    runtimeModeMock.mockReturnValue(RuntimePerformanceMode.DEV)
    fetchMock.mockRejectedValue(new Error('network offline'))

    const reporter = new RuntimeMetricsReporter({
      getBaseUrl: () => 'https://metrics.example.com',
      getSessionId: () => 'session-6',
      getMetrics: () => ({
        worldObjectCount: 3,
        visibleRenderables: 1,
        snapshotPayloadBytes: 128,
        snapshotBytesPerSnapshot: 32,
        replicationUpdatesPerTick: 0,
        actorReplicationCount: 0,
      }),
      isEnabled: () => true,
      intervalSeconds: 1,
    })

    reporter.update(1.2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalled()
    expect(reporter.getLastSample()?.sessionId).toBe('session-6')
  })
})
