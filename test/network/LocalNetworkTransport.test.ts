import { LocalNetworkTransport } from '../../client/src/engine/network/NetworkTransport'

describe('LocalNetworkTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('broadcasts state to registered listeners after latency', () => {
    const transport = new LocalNetworkTransport(25)
    const callback = vi.fn()

    transport.onStateReceived(callback)

    const state = {
      playerId: 'player-1',
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      timestamp: 123,
    }

    transport.sendState(state)
    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(25)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(state)
    expect(transport.getKnownPlayers()).toEqual([state])
  })

  it('forwards all network events through scheduled callbacks', () => {
    const transport = new LocalNetworkTransport(10)
    const stateSpy = vi.fn()
    const inputSpy = vi.fn()
    const snapshotSpy = vi.fn()
    const hitRequestSpy = vi.fn()
    const hitResultSpy = vi.fn()
    const abilityRequestSpy = vi.fn()
    const abilityValidationSpy = vi.fn()

    transport.onStateReceived(stateSpy)
    transport.onInputReceived(inputSpy)
    transport.onSnapshotReceived(snapshotSpy)
    transport.onHitValidationRequestReceived(hitRequestSpy)
    transport.onHitValidationResultReceived(hitResultSpy)
    transport.onAbilityRequestReceived(abilityRequestSpy)
    transport.onAbilityValidationReceived(abilityValidationSpy)

    transport.sendState({ playerId: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, timestamp: 1 })
    transport.sendInput({ playerId: 'p', seq: 1, tick: 2, timestamp: 3, input: { jump: true } })
    transport.sendSnapshot({ tick: 4, timestamp: 5, ackInputSeq: 1, entities: [] })
    transport.sendHitValidationRequest({ shooterId: 'p', shotId: 's1', timestamp: 6, origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, range: 10 })
    transport.sendHitValidationResult({ shooterId: 'p', shotId: 's1', timestamp: 6, hitEntityId: null })
    transport.sendAbilityRequest({ playerId: 'p', abilityId: 'dash', timestamp: 7 })
    transport.sendAbilityValidation({ playerId: 'p', abilityId: 'dash', accepted: true, timestamp: 8 })

    expect(stateSpy).not.toHaveBeenCalled()
    expect(inputSpy).not.toHaveBeenCalled()
    expect(snapshotSpy).not.toHaveBeenCalled()
    expect(hitRequestSpy).not.toHaveBeenCalled()
    expect(hitResultSpy).not.toHaveBeenCalled()
    expect(abilityRequestSpy).not.toHaveBeenCalled()
    expect(abilityValidationSpy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(10)
    expect(stateSpy).toHaveBeenCalledTimes(1)
    expect(inputSpy).toHaveBeenCalledTimes(1)
    expect(snapshotSpy).toHaveBeenCalledTimes(1)
    expect(hitRequestSpy).toHaveBeenCalledTimes(1)
    expect(hitResultSpy).toHaveBeenCalledTimes(1)
    expect(abilityRequestSpy).toHaveBeenCalledTimes(1)
    expect(abilityValidationSpy).toHaveBeenCalledTimes(1)
  })

  it('disconnects and clears queued callbacks', () => {
    const transport = new LocalNetworkTransport(20)
    const stateSpy = vi.fn()

    transport.onStateReceived(stateSpy)
    transport.sendState({ playerId: 'x', position: { x: 5, y: 6, z: 7 }, rotation: { x: 0, y: 0, z: 0 }, timestamp: 9 })
    transport.disconnect()

    vi.advanceTimersByTime(20)
    expect(stateSpy).not.toHaveBeenCalled()
    expect(transport.getKnownPlayers()).toEqual([])
  })
})
