import { gameBus } from '../../client/src/1-kernel/core/public-api'
import {
  NetworkConnectionResolver,
  SafeWebSocketConnection,
} from '../../client/src/3-network/network/NetworkConnectionResolver'
import {
  SNAPSHOT_DELTA_MODE,
  SNAPSHOT_SCHEMA_VERSION,
  isSupportedSnapshotSchema,
} from '../../client/src/3-network/network/SnapshotContract'

class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  readyState = FakeWebSocket.OPEN
  onopen: (() => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  sent: string[] = []
  constructor(public url: string) {
    if (!url.includes('error')) {
      setTimeout(() => this.onopen?.(), 0)
    }
  }
  send(data: string): void { this.sent.push(data) }
  close(): void { this.readyState = FakeWebSocket.CLOSED; this.onclose?.() }
}

describe('NetworkConnectionResolver', () => {
  let originalImportMeta: any
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    originalImportMeta = (import.meta as any).env
    emitSpy = vi.spyOn(gameBus, 'emit')
    emitSpy.mockClear()
  })

  afterEach(() => {
    ;(import.meta as any).env = originalImportMeta
    vi.restoreAllMocks()
  })

  it('resolves localhost by default and respects default ports', () => {
    const resolver = new NetworkConnectionResolver()
    resolver.setManualServerIP(null)
    expect(resolver.resolveWebSocketUrl()).toBe('ws://localhost:8080')
    expect(resolver.resolveHttpUrl()).toBe('http://localhost:8080')
    expect(resolver.getResolvedHost()).toBe('localhost')
    expect(resolver.getResolvedHost()).toBe('localhost')
  })

  it('honors manual server IP override and secure protocol flags', () => {
    const resolver = new NetworkConnectionResolver({ useSecure: true, wsPort: 9000, httpPort: 9001 })
    resolver.setManualServerIP('192.168.100.100')
    expect(resolver.resolveWebSocketUrl()).toBe('wss://192.168.100.100:9000')
    expect(resolver.resolveHttpUrl()).toBe('https://192.168.100.100:9001')
  })

  it('prefers process.env.SERVER_URL when window hostname fallback would otherwise be used', () => {
    ;(import.meta as any).env = {}
    const saved = process.env.SERVER_URL
    process.env.SERVER_URL = 'env-host'
    const resolver = new NetworkConnectionResolver()
    expect(resolver.resolveWebSocketUrl()).toContain('env-host')
    process.env.SERVER_URL = saved
  })

  it('prefers process.env.SERVER_URL when VITE_SERVER_IP is absent', () => {
    ;(import.meta as any).env = {}
    const saved = process.env.SERVER_URL
    process.env.SERVER_URL = 'process-host'
    const resolver = new NetworkConnectionResolver()
    expect(resolver.resolveHttpUrl()).toContain('process-host')
    process.env.SERVER_URL = saved
  })

  it('uses browser same-origin URLs on hosted https origins when explicit env URLs are not set', () => {
    ;(import.meta as any).env = {}
    const savedHttp = process.env.SERVER_HTTP_URL
    const savedWs = process.env.SERVER_WS_URL
    const savedGeneric = process.env.SERVER_URL
    delete process.env.SERVER_HTTP_URL
    delete process.env.SERVER_WS_URL
    delete process.env.SERVER_URL

    Object.defineProperty(window, 'location', {
      value: {
        protocol: 'https:',
        hostname: 'demo-lzj1.onrender.com',
        port: '',
      },
      writable: true,
    })

    const resolver = new NetworkConnectionResolver()
    expect(resolver.resolveHttpUrl()).toBe('https://demo-lzj1.onrender.com')
    expect(resolver.resolveWebSocketUrl()).toBe('wss://demo-lzj1.onrender.com')

    process.env.SERVER_HTTP_URL = savedHttp
    process.env.SERVER_WS_URL = savedWs
    process.env.SERVER_URL = savedGeneric
  })

  it('validates snapshot schema constants and delta mode', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(2)
    expect(SNAPSHOT_DELTA_MODE).toBe('sparse-entity-delta-v1')
    expect(isSupportedSnapshotSchema(2)).toBe(true)
    expect(isSupportedSnapshotSchema(999)).toBe(false)
    expect(isSupportedSnapshotSchema(undefined)).toBe(false)
  })
})

describe('SafeWebSocketConnection', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    ;(global as any).WebSocket = FakeWebSocket
    emitSpy = vi.spyOn(gameBus, 'emit')
    emitSpy.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (global as any).WebSocket
    vi.restoreAllMocks()
  })

  it('connects successfully and returns a WebSocket instance', async () => {
    const connection = new SafeWebSocketConnection('ws://test', { connectTimeoutMs: 50 })
    const socketPromise = connection.connect()
    vi.runAllTimers()
    const socket = await socketPromise
    expect(socket).toBeInstanceOf(FakeWebSocket)
    expect(connection.getSocket()).toBe(socket)
    connection.disconnect()
    expect(connection.getSocket()).toBeNull()
  })

  it('emits networkLifecycle on connection failure', async () => {
    const connection = new SafeWebSocketConnection('ws://error', { connectTimeoutMs: 50 })
    const errorSocket = new FakeWebSocket('ws://error')
    errorSocket.onopen = null
    ;(global as any).WebSocket = vi.fn(() => errorSocket)
    const resultPromise = connection.connect()
    errorSocket.onerror?.('broken')
    const result = await resultPromise
    expect(result).toBeNull()
    expect(emitSpy).toHaveBeenCalledWith('networkLifecycle', expect.objectContaining({ source: 'SafeWebSocketConnection', state: 'connection_failed' }))
  })
})
