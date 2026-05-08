import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/diagnostics/debug/RuntimeMetricsReporter', () => ({
  RuntimeMetricsReporter: vi.fn().mockImplementation(function (this: any, config: any) {
    this.config = config
  }),
}))

import { bootstrapRuntimeMetricsReporter } from '../../../../../client/src/engine/runtime/bootstrap/runtimeMetrics'
import { RuntimeMetricsReporter } from '../../../../../client/src/engine/diagnostics/debug/RuntimeMetricsReporter'

describe('bootstrapRuntimeMetricsReporter', () => {
  let runtimeDiagnosticsCoordinator: any
  let sessionLifecycleCoordinator: any
  let liveCullingSystem: any
  let worldRuntime: any
  let multiplayerRuntime: any
  let setRuntimeMetricsReporter: any

  beforeEach(() => {
    vi.clearAllMocks()
    runtimeDiagnosticsCoordinator = {
      getBaseUrl: vi.fn(() => 'http://metrics.local'),
      getSessionDiagnostics: vi.fn(() => ({ lastSnapshotBytes: 512, lastBytesPerSnapshot: 128, lastDeltaEntities: 4, actorRuntime: { actorCount: 12 } })),
    }
    sessionLifecycleCoordinator = {
      getRuntimeMetricsSessionId: vi.fn(() => 'session-1'),
      shouldCaptureRuntimeMetrics: vi.fn(() => true),
    }
    liveCullingSystem = {
      getDiagnostics: vi.fn(() => ({ visibleCount: 42 })),
    }
    worldRuntime = {
      getWorldObjectAuthorityDiagnostics: vi.fn(() => ({ mappedWorldObjects: 99 })),
    }
    multiplayerRuntime = {
      setRuntimeMetricsReporter: vi.fn(),
    }
    setRuntimeMetricsReporter = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes the runtime metrics reporter and attaches it to multiplayer runtime', async () => {
    bootstrapRuntimeMetricsReporter({
      runtimeDiagnosticsCoordinator,
      sessionLifecycleCoordinator,
      liveCullingSystem,
      worldRuntime,
      multiplayerRuntime,
      setRuntimeMetricsReporter,
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setRuntimeMetricsReporter).toHaveBeenCalled()
    expect(multiplayerRuntime.setRuntimeMetricsReporter).toHaveBeenCalled()
    expect(RuntimeMetricsReporter).toHaveBeenCalled()
  })
})
