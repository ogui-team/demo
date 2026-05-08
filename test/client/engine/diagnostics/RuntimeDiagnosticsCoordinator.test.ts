import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeDiagnosticsCoordinator } from '../../../../client/src/engine/diagnostics/debug/RuntimeDiagnosticsCoordinator'
import { gameBus } from '@engine/core/public-api'

vi.mock('@engine/core/public-api', () => ({
  gameBus: {
    emit: vi.fn(),
  },
}))

describe('RuntimeDiagnosticsCoordinator', () => {
  const fetchMock = vi.fn()
  const multiplayerClient = {
    connected: true,
    roomId: 'room-42',
    getServerHttpBaseUrl: () => 'http://example.com',
    getProtocolDiagnostics: () => ({ recentIncoming: [{ parseOk: false }, { parseOk: true }] }),
  }
  const renderingDiagnostics = {
    getDiagnostics: () => ({ cullEntries: 5, culledCount: 0, lastCullDurationMs: 100, visibleCount: 3, averageCullDurationMs: 20, peakCullDurationMs: 150 }),
  }

  beforeEach(() => {
    vi.resetAllMocks()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  it('resolves base URL from multiplayer client when available', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: 'http://override.com',
      multiplayerClient,
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    expect(coordinator.getBaseUrl()).toBe('http://example.com')
  })

  it('refresh updates server status and emits stateMutation on success', async () => {
    const payload = {
      clients: 2,
      sessions: 4,
      transport: { wsMaxPayloadBytes: 8192, httpJsonLimit: '1mb' },
      sessionDiagnostics: [
        { sessionId: 'room-42', lastSnapshotBytes: 512, lastBytesPerSnapshot: 256, peakBytesPerSnapshot: 1024, lastFanoutDurationMs: 120, averageFanoutDurationMs: 80, peakFanoutDurationMs: 200, lastDeltaEntities: 3, averageDeltaEntities: 4, peakDeltaEntities: 5, forcedRefreshes: 1, actorRuntime: { actorCount: 7 } },
      ],
    }
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload })

    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient,
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    await coordinator.refresh()

    expect(fetchMock).toHaveBeenCalledWith('http://example.com/status', { cache: 'no-store' })
    expect(gameBus.emit).toHaveBeenCalledWith('stateMutation', expect.objectContaining({ source: 'runtimeDiagnosticsCoordinator' }))
    expect(coordinator.getServerStatus().clients).toBe(2)
    expect(coordinator.getSessionDiagnostics()?.sessionId).toBe('room-42')
    expect(coordinator.getSnapshotBytesSummary()).toContain('fanout')
    expect(coordinator.getFanoutCostSummary()).toContain('last')
    expect(coordinator.getReplicationShapeSummary()).toContain('updates')
  })

  it('generates warning messages from stale and unhealthy diagnostics', async () => {
    const staleCoordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient,
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    const status = staleCoordinator.getServerStatus()
    status.lastUpdatedAt = Date.now() - 6000
    status.session = {
      lastFanoutDurationMs: 120,
      lastBytesPerSnapshot: 2048,
      forcedRefreshes: 1,
    } as any

    const warnings = staleCoordinator.getNetworkHealthWarnings()
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Server status diagnostics are stale'),
        expect.stringContaining('Snapshot fanout is expensive'),
        expect.stringContaining('Snapshot payload is large'),
        expect.stringContaining('Forced player refreshes occurred'),
        expect.stringContaining('Recent incoming packets had JSON parse failures'),
      ])
    )
  })

  it('returns rendering health warnings for culling anomalies', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient,
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    const warnings = coordinator.getRenderingHealthWarnings()
    expect(warnings).toEqual(
      expect.arrayContaining([
        'Culling is active but not rejecting any tracked geometry',
        expect.stringContaining('Cull pass is expensive'),
      ])
    )
  })

  it('does not refresh when polling is disabled', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient,
      renderingDiagnostics,
      shouldPoll: () => false,
    })

    const refreshSpy = vi.spyOn(coordinator as any, 'refresh').mockResolvedValue(undefined)
    coordinator.update(3)
    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('falls back to the metrics override URL when multiplayer client has no base URL', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: 'http://override.com',
      multiplayerClient: { ...multiplayerClient, getServerHttpBaseUrl: () => null },
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    expect(coordinator.getBaseUrl()).toBe('http://override.com')
  })

  it('returns default base URL when both multiplayer client and override are unavailable', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient: { ...multiplayerClient, getServerHttpBaseUrl: () => null },
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    expect(coordinator.getBaseUrl()).toBe('http://default.com')
  })

  it('returns n/a summaries when session diagnostics are not available', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient,
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    expect(coordinator.getSnapshotBytesSummary()).toBe('n/a')
    expect(coordinator.getFanoutCostSummary()).toBe('n/a')
    expect(coordinator.getReplicationShapeSummary()).toBe('n/a')
  })

  it('returns base transport summary when transport diagnostics are missing', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient,
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    expect(coordinator.getTransportSummary()).toBe('base http://default.com')
  })

  it('returns a stale status warning when diagnostics age exceeds threshold', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient,
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    const status = coordinator.getServerStatus()
    status.lastUpdatedAt = Date.now() - 6000
    const warnings = coordinator.getNetworkHealthWarnings()
    expect(warnings).toContain('Server status diagnostics are stale')
  })

  it('returns n/a for status age when lastUpdatedAt is zero', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient,
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    expect(coordinator.getStatusAgeSummary()).toBe('n/a')
  })

  it('returns null session diagnostics when roomId is unavailable', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient: { ...multiplayerClient, roomId: '' },
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    const payload = { sessionDiagnostics: [{ sessionId: 'room-42' }] }
    expect((coordinator as any).selectServerSessionDiagnostics(payload)).toBeNull()
  })

  it('returns n/a if no geometry is registered for culling service', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient,
      renderingDiagnostics: { getDiagnostics: () => ({ cullEntries: 0, culledCount: 0, lastCullDurationMs: 0 }) },
      shouldPoll: () => true,
    })

    expect(coordinator.getRenderingHealthWarnings()).toEqual(['No geometry is currently registered with the culling service'])
  })

  it('returns summary strings and formats values correctly', () => {
    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient,
      renderingDiagnostics,
      shouldPoll: () => true,
    })

    const status = coordinator.getServerStatus()
    status.clients = 1
    status.sessions = 2
    status.baseUrl = 'http://default.com'
    status.lastUpdatedAt = Date.now() - 1000
    status.transport = { wsMaxPayloadBytes: 2048, httpJsonLimit: '2mb' }
    status.session = {
      lastSnapshotBytes: 512,
      lastBytesPerSnapshot: 256,
      peakBytesPerSnapshot: 1024,
      lastFanoutDurationMs: 30,
      averageFanoutDurationMs: 20,
      peakFanoutDurationMs: 40,
      lastDeltaEntities: 5,
      forcedRefreshes: 2,
      actorRuntime: { actorCount: 7 },
    } as any

    expect(coordinator.getStatusSummary()).toContain('1 clients | 2 sessions')
    expect(coordinator.getTransportSummary()).toContain('WS 2.0 KB | HTTP 2mb')
    expect(coordinator.getSnapshotBytesSummary()).toContain('fanout 512 B')
    expect(coordinator.getFanoutCostSummary()).toContain('last 30.00 ms')
    expect(coordinator.getReplicationShapeSummary()).toContain('updates 5 | actors 7 | forced 2')
    expect(coordinator.getRenderingCountsSummary()).toContain('tracked 5 | visible 3 | culled 0')
    expect(coordinator.getRenderingCostSummary()).toContain('last 100.00 ms')
    expect(coordinator.getStatusAgeSummary()).toContain('ms ago')
  })

  it('reports error summary and publishes error payload when refresh fails', async () => {
    const stateManager = { set: vi.fn() }
    fetchMock.mockResolvedValue({ ok: false, status: 503 })

    const coordinator = new RuntimeDiagnosticsCoordinator({
      defaultBaseUrl: 'http://default.com',
      metricsBaseUrlOverride: null,
      multiplayerClient,
      renderingDiagnostics,
      shouldPoll: () => true,
      stateManager,
    })

    await coordinator.refresh()

    expect(coordinator.getStatusSummary()).toContain('error: HTTP 503')
    expect(stateManager.set).toHaveBeenCalledWith('diagnostics.network.serverStatus', expect.objectContaining({ error: 'HTTP 503' }))
  })
})
