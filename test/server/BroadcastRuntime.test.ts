import { broadcastAll, broadcastOthers, sendTo } from '../../server/src/session/broadcastRuntime'
import { WebSocket } from 'ws'

describe('BroadcastRuntime', () => {
  let mockWs1: any
  let mockWs2: any
  let mockWs3: any

  beforeEach(() => {
    mockWs1 = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    }
    mockWs2 = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    }
    mockWs3 = {
      readyState: WebSocket.CLOSED,
      send: vi.fn(),
    }
  })

  it('broadcasts to all open connections', () => {
    const players = new Map([
      ['p1', { id: 'p1', ws: mockWs1 }],
      ['p2', { id: 'p2', ws: mockWs2 }],
      ['p3', { id: 'p3', ws: mockWs3 }],
    ]) as any

    const message = { type: 'TEST' }
    broadcastAll(message, { players })

    expect(mockWs1.send).toHaveBeenCalledWith(JSON.stringify(message))
    expect(mockWs2.send).toHaveBeenCalledWith(JSON.stringify(message))
    expect(mockWs3.send).not.toHaveBeenCalled()
  })

  it('broadcasts to all except one player', () => {
    const players = new Map([
      ['p1', { id: 'p1', ws: mockWs1 }],
      ['p2', { id: 'p2', ws: mockWs2 }],
      ['p3', { id: 'p3', ws: mockWs3 }],
    ]) as any

    const message = { type: 'TEST' }
    broadcastOthers('p1', message, { players })

    expect(mockWs1.send).not.toHaveBeenCalled()
    expect(mockWs2.send).toHaveBeenCalledWith(JSON.stringify(message))
    expect(mockWs3.send).not.toHaveBeenCalled()
  })

  it('sends message to specific websocket', () => {
    const message = { type: 'TEST' }
    sendTo(mockWs1, message)

    expect(mockWs1.send).toHaveBeenCalledWith(JSON.stringify(message))
  })

  it('does not send to closed websockets', () => {
    sendTo(mockWs3, { type: 'TEST' })

    expect(mockWs3.send).not.toHaveBeenCalled()
  })
})
