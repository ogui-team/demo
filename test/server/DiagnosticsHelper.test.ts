import { DiagnosticsHelper } from '../../server/src/session/DiagnosticsHelper'
import { WebSocket } from 'ws'

describe('DiagnosticsHelper', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs world state without throwing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const entities = new Map([['e1', { id: 'e1', type: 'player' } as any], ['e2', { id: 'e2', type: 'npc' } as any]])
    const players = new Map([['p1', { id: 'p1' }]])
    const worldObjects = new Map([['o1', {}]])

    DiagnosticsHelper.dumpWorldState(12, entities, players, worldObjects, 'TEST_PREFIX')

    expect(spy).toHaveBeenCalled()
  })

  it('warns when target connection is missing or disconnected', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const player = { ws: null }

    DiagnosticsHelper.forceFullSnapshot('p1', player as any, 1, [], { phase: 'warmup' } as any)

    expect(warnSpy).toHaveBeenCalled()
  })

  it('sends a full snapshot when the connection is open', () => {
    const sendSpy = vi.fn()
    const ws = { readyState: WebSocket.OPEN, send: sendSpy } as any
    const player = { ws }
    const now = Date.now()

    DiagnosticsHelper.forceFullSnapshot(
      'player-1',
      player as any,
      2,
      [
        { id: 'player-1', type: 'player', position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 } } as any,
      ],
      { phase: 'active' } as any,
    )

    expect(sendSpy).toHaveBeenCalled()
  })

  it('logs a fatal error when snapshot audit finds no entities', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    DiagnosticsHelper.logSnapshotAudit('test-source', 5, [], [], null)

    expect(errorSpy).toHaveBeenCalledWith(
      'FATAL: Server WorldState is empty. Player registry missing?',
      expect.objectContaining({ source: 'test-source', tick: 5, timestamp: expect.any(Number) }),
    )
  })
})
