import { ReplaySystem, SeededRandom } from '../../client/src/engine/core/ReplaySystem'

describe('ReplaySystem', () => {
  it('records events and exports/imports JSON safely', () => {
    const replay = new ReplaySystem()
    replay.startRecording('session-1', 123)
    replay.recordEvent('player_input', { x: 1 })
    const recording = replay.stopRecording()

    expect(recording.sessionId).toBe('session-1')
    expect(recording.events.length).toBeGreaterThanOrEqual(1)

    const json = replay.exportJSON(recording)
    const imported = replay.importJSON(json)
    expect(imported.sessionId).toBe(recording.sessionId)
    expect(imported.events.length).toBe(recording.events.length)
  })

  it('loads recordings and seeks correctly while preserving RNG parity', () => {
    const replay = new ReplaySystem()
    const recording = {
      sessionId: 'session-2',
      seed: 456,
      startedAt: 0,
      durationMs: 100,
      events: [{ time: 0, type: 'player_input', data: { } }],
    }
    replay.loadRecording(recording)
    replay.seek(50)

    expect(replay.getDuration()).toBe(100)
    expect(replay.getPlaybackTime()).toBe(50)
    expect(replay.getRng()).toBeDefined()
  })

  it('throws on invalid JSON import data', () => {
    const replay = new ReplaySystem()
    expect(() => replay.importJSON('{ "not": "valid" }')).toThrow()
  })

  it('plays back recorded events, pauses, seeks, and stops correctly', () => {
    vi.useFakeTimers()
    const replay = new ReplaySystem()
    const recording = {
      sessionId: 'session-3',
      seed: 789,
      startedAt: 0,
      durationMs: 200,
      events: [
        { time: 0, type: 'player_input', data: { value: 1 } },
        { time: 50, type: 'player_input', data: { value: 2 } },
      ],
    }

    replay.loadRecording(recording)
    const eventSpy = vi.fn()
    const stateSpy = vi.fn()
    replay.onPlaybackEvent(eventSpy)
    replay.onStateChange(stateSpy)

    replay.playReplay()
    expect(replay.getState()).toBe('playing')
    expect(stateSpy).toHaveBeenCalledWith('playing')

    replay.pauseReplay()
    expect(replay.getState()).toBe('paused')
    expect(stateSpy).toHaveBeenCalledWith('paused')

    const currentTime = replay.getPlaybackTime()
    expect(currentTime).toBeGreaterThanOrEqual(0)

    replay.seek(0)
  expect(replay.getPlaybackTime()).toBe(0)
  expect(replay.getState()).toBe('paused')

    replay.playReplay()
    vi.advanceTimersByTime(250)
    expect(eventSpy).toHaveBeenCalledTimes(1)
    expect(replay.getState()).toBe('idle')

    replay.stopReplay()
    expect(replay.getState()).toBe('idle')

    vi.useRealTimers()
  })

  it('provides seeded random values and diagnostics', () => {
    const rng = new SeededRandom(999)
    const first = rng.next()
    const second = rng.nextInt(1, 10)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThanOrEqual(1)
    expect(rng.getDiagnostics().metrics.count).toBe(2)
  })
})
