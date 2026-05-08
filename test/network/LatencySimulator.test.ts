import { LatencySimulator } from '../../client/src/engine/network/LatencySimulator'

class FakeTransport {
  public states: any[] = []
  private callback: ((state: any) => void) | null = null

  sendState(state: any): void {
    this.states.push(state)
  }

  onStateReceived(callback: (state: any) => void): void {
    this.callback = callback
  }

  disconnect(): void {
    this.states = []
    this.callback = null
  }

  triggerState(state: any): void {
    this.callback?.(state)
  }
}

describe('LatencySimulator', () => {
  let transport: FakeTransport
  let latency: LatencySimulator

  beforeEach(() => {
    transport = new FakeTransport()
    latency = new LatencySimulator(transport, { sendDelay: 10, receiveDelay: 15, jitter: 0, packetLoss: 0 })
    vi.useFakeTimers()
  })

  afterEach(() => {
    latency.disconnect()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('delays outgoing state sends and receives incoming state with configured latency', () => {
    const callback = vi.fn()
    latency.onStateReceived(callback)
    latency.sendState({ playerId: 'p1' })

    expect(transport.states).toEqual([])
    vi.advanceTimersByTime(10)
    expect(transport.states).toEqual([{ playerId: 'p1' }])

    transport.triggerState({ playerId: 'p2' })
    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(15)
    expect(callback).toHaveBeenCalledWith({ playerId: 'p2' })
  })

  it('drops packets based on packet loss settings', () => {
    const callback = vi.fn()
    latency.onStateReceived(callback)
    latency.setConfig({ packetLoss: 1 })
    vi.spyOn(Math, 'random').mockReturnValue(0)

    latency.sendState({ playerId: 'p3' })
    transport.triggerState({ playerId: 'p4' })
    vi.advanceTimersByTime(100)

    expect(transport.states).toEqual([])
    expect(callback).not.toHaveBeenCalled()
  })

  it('exposes estimated RTT and allows configuration updates', () => {
    expect(latency.estimatedRTT).toBe(25)
    latency.setConfig({ jitter: 5 })
    expect(latency.getConfig().jitter).toBe(5)
    expect(latency.estimatedRTT).toBe(30)
  })
})
