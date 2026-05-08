vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}))

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as store from '../../server/src/system/RuntimeMetricsStore'

describe('RuntimeMetricsStore', () => {
  const fileContents = new Map<string, string>()
  let mkdirSpy: ReturnType<typeof vi.fn>
  let writeSpy: ReturnType<typeof vi.fn>
  let existsSpy: ReturnType<typeof vi.fn>
  let readSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fileContents.clear()
    mkdirSpy = fs.mkdirSync as unknown as ReturnType<typeof vi.fn>
    writeSpy = fs.writeFileSync as unknown as ReturnType<typeof vi.fn>
    existsSpy = fs.existsSync as unknown as ReturnType<typeof vi.fn>
    readSpy = fs.readFileSync as unknown as ReturnType<typeof vi.fn>

    mkdirSpy.mockImplementation(() => undefined)
    writeSpy.mockImplementation((filePath, data) => {
      fileContents.set(String(filePath), String(data))
    })
    existsSpy.mockImplementation((filePath) =>
      Array.from(fileContents.keys()).some((key) => String(filePath).endsWith(key)),
    )
    readSpy.mockImplementation((filePath) => {
      const key = Array.from(fileContents.keys()).find((key) => String(filePath).endsWith(key))
      if (!key) throw new Error('File not found')
      return fileContents.get(key)!
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('saves runtime metrics and writes the latest, history, and session files', () => {
    const sample = {
      capturedAt: '2026-04-20T14:00:00Z',
      sessionId: 'freeplay:release_freeplay',
      scenarioClass: 'baseline',
      performanceMode: 'release',
      frameTimeAvgMs: 16,
      frameTimePeakMs: 18,
      cpuFrameAvgMs: 1.2,
      cpuFramePeakMs: 2.4,
      worldObjectCount: 10,
      visibleRenderables: 5,
      snapshotPayloadBytes: 1024,
      snapshotBytesPerSnapshot: 256,
      replicationUpdatesPerTick: 7,
      actorReplicationCount: 3,
    }

    const history = store.saveRuntimeMetrics(sample as any)

    expect(history).toHaveLength(1)
    expect(history[0].sessionId).toBe('freeplay:release_freeplay')
    expect(history[0].performanceMode).toBe('capture')
    expect([...fileContents.keys()].some((path) => path.endsWith('latest.json'))).toBe(true)
    expect([...fileContents.keys()].some((path) => path.endsWith('history.json'))).toBe(true)
    expect([...fileContents.keys()].some((path) => path.includes(encodeURIComponent('freeplay:release_freeplay')))).toBe(true)
    expect(mkdirSpy).toHaveBeenCalled()
    expect(writeSpy).toHaveBeenCalledTimes(3)
  })

  it('normalizes invalid stored runtime metrics values when reading latest metrics', () => {
    const sample = {
      capturedAt: '2026-04-20T14:33:00Z',
      sessionId: 'session-x',
      scenarioClass: 'invalid_scenario',
      performanceMode: 'unknown_mode',
      frameTimeAvgMs: 'bad',
      frameTimePeakMs: 'bad',
      cpuFrameAvgMs: 'bad',
      cpuFramePeakMs: 'bad',
      worldObjectCount: 'bad',
      visibleRenderables: 'bad',
      snapshotPayloadBytes: 'bad',
      snapshotBytesPerSnapshot: 'bad',
      replicationUpdatesPerTick: 'bad',
      actorReplicationCount: 'bad',
      sampleQuality: {
        focused: 'yes',
        visible: 'yes',
        valid: 'yes',
        reasons: 'not-array',
      },
      frameCostBreakdown: [
        { name: 'update', avgMs: 'bad', peakMs: 'bad', sharePct: 'bad' },
      ],
    }

    const latestPath = 'latest.json'
    const historyPath = 'history.json'
    const sessionPath = `${encodeURIComponent('session-x')}.json`

    fileContents.set(latestPath, JSON.stringify(sample))
    fileContents.set(historyPath, '[]')
    fileContents.set(sessionPath, '[]')

    const latest = store.getLatestRuntimeMetrics()

    expect(latest).toEqual(
      expect.objectContaining({
        capturedAt: sample.capturedAt,
        sessionId: 'session-x',
        scenarioClass: null,
        performanceMode: 'stable',
        frameTimeAvgMs: 0,
        frameTimePeakMs: 0,
        cpuFrameAvgMs: 0,
        cpuFramePeakMs: 0,
        worldObjectCount: 0,
        visibleRenderables: 0,
        snapshotPayloadBytes: 0,
        snapshotBytesPerSnapshot: 0,
        replicationUpdatesPerTick: 0,
        actorReplicationCount: 0,
        sampleQuality: { focused: 'yes', visible: 'yes', valid: 'yes', reasons: [] },
        frameCostBreakdown: [{ name: 'update', avgMs: 0, peakMs: 0, sharePct: 0 }],
      }),
    )
  })

  it('returns empty arrays when history files are missing or invalid', () => {
    expect(store.getRuntimeMetricsHistory()).toEqual([])
    expect(store.getRuntimeMetricsSessionHistory('missing-session')).toEqual([])
  })
})
