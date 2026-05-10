import { WebSocketNetworkTransport } from '../../client/src/3-network/network/NetworkTransport'

class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.OPEN
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  sent: string[] = []
  url: string

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
    setTimeout(() => {
      this.onopen?.({})
    }, 0)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({})
  }
}

describe('WebSocketNetworkTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(global as any).WebSocket = FakeWebSocket
    FakeWebSocket.instances = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (global as any).WebSocket
  })

  it('connects, sends payload envelopes, and receives state messages', () => {
    const transport = new WebSocketNetworkTransport('ws://test', true)
    vi.advanceTimersByTime(0)

    expect(FakeWebSocket.instances.length).toBe(1)
    const socket = FakeWebSocket.instances[0]
    expect(transport.isConnected()).toBe(true)

    const state = { playerId: 'p1', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, timestamp: 123 }
    transport.sendState(state)
    expect(socket.sent).toContain(JSON.stringify(state))

    const inputCallback = vi.fn()
    transport.onInputReceived(inputCallback)
    socket.onmessage?.({ data: JSON.stringify({ kind: 'player_input', payload: { playerId: 'p1', seq: 1, tick: 1, timestamp: 2, input: { jump: true } } }) })

    expect(inputCallback).toHaveBeenCalledTimes(1)
    expect(inputCallback.mock.calls[0][0]).toMatchObject({ playerId: 'p1', seq: 1 })
  })

  it('sends envelope messages for all network event types and preserves WebSocket protocol', () => {
    const transport = new WebSocketNetworkTransport('ws://test', false)
    vi.advanceTimersByTime(0)
    const socket = FakeWebSocket.instances[0]
    const sendSpy = vi.spyOn(socket, 'send')

    transport.sendInput({ playerId: 'p1', seq: 1, tick: 2, timestamp: 3, input: { move: true } })
    transport.sendSnapshot({ tick: 1, timestamp: 4, ackInputSeq: 1, lastProcessedInput: 0, entities: [] })
    transport.sendHitValidationRequest({ shooterId: 'p1', shotId: 'shot1', timestamp: 5, origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, range: 100 })
    transport.sendHitValidationResult({ shooterId: 'p1', shotId: 'shot1', timestamp: 5, hitEntityId: null })
    transport.sendAbilityRequest({ playerId: 'p1', abilityId: 'ability1', timestamp: 6 })
    transport.sendAbilityValidation({ playerId: 'p1', abilityId: 'ability1', accepted: true, timestamp: 7 })

    expect(sendSpy).toHaveBeenCalledTimes(6)
    expect(socket.sent.some((payload) => payload.includes('player_input'))).toBe(true)
    expect(socket.sent.some((payload) => payload.includes('snapshot'))).toBe(true)
    expect(socket.sent.some((payload) => payload.includes('hit_request'))).toBe(true)
    expect(socket.sent.some((payload) => payload.includes('ability_validation'))).toBe(true)
  })

  it('routes unknown messages to state listeners and disconnects cleanly', () => {
    const transport = new WebSocketNetworkTransport('ws://test', false)
    vi.advanceTimersByTime(0)
    const socket = FakeWebSocket.instances[0]

    const stateCallback = vi.fn()
    transport.onStateReceived(stateCallback)

    const payload = { playerId: 'player99', position: { x: 2, y: 2, z: 2 }, rotation: { x: 1, y: 1, z: 1 }, timestamp: 321 }
    socket.onmessage?.({ data: JSON.stringify(payload) })

    expect(stateCallback).toHaveBeenCalledWith(payload)

    transport.disconnect()
    expect(transport.isConnected()).toBe(false)
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED)
  })
})
