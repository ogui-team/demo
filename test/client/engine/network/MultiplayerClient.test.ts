import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MultiplayerClient } from '../../../../client/src/engine/network/MultiplayerClient'
import { gameBus, logEvent } from '@engine/core/public-api'

vi.mock('@engine/core/public-api', () => ({
  gameBus: { emit: vi.fn() },
  logEvent: vi.fn(),
}))

class FakeWebSocket {
  static OPEN = 1
  public readyState = FakeWebSocket.OPEN
  public onopen: (() => void) | null = null
  public onmessage: ((event: { data: string }) => void) | null = null
  public onclose: (() => void) | null = null
  public onerror: (() => void) | null = null
  public send = vi.fn()
  public close = vi.fn()
  public url: string

  constructor(url: string) {
    this.url = url
    ;(FakeWebSocket.instances as FakeWebSocket[]).push(this)
  }

  static instances: FakeWebSocket[] = []
}

declare global {
  var WebSocket: typeof FakeWebSocket
}

describe('MultiplayerClient', () => {
  let client: any
  let mockGameBusEmit: ReturnType<typeof vi.fn>
  let mockLogEvent: ReturnType<typeof vi.fn>

  beforeEach(() => {
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as any
    globalThis.fetch = vi.fn()
    mockGameBusEmit = (gameBus as any).emit
    mockLogEvent = logEvent as ReturnType<typeof vi.fn>
    mockGameBusEmit.mockClear()
    mockLogEvent.mockClear()
    client = new MultiplayerClient()
  })

  afterEach(() => {
    delete globalThis.WebSocket
    delete globalThis.fetch
  })

  it('computes server HTTP base URL from a WSS url', () => {
    client['_serverUrl'] = 'wss://example.com:8080/game'

    expect(client.getServerHttpBaseUrl()).toBe('https://example.com:8080')
  })

  it('returns null for invalid server URLs', () => {
    client['_serverUrl'] = 'http://[invalid-url]'

    expect(client.getServerHttpBaseUrl()).toBeNull()
  })

  it('emits network lifecycle events when joinRoom is requested and connected', () => {
    client.joinRoom('wss://example.com', 'Alice', 'room-1')

    expect(mockGameBusEmit).toHaveBeenCalledWith('networkLifecycle', expect.objectContaining({ state: 'join_requested', detail: 'wss://example.com', roomId: 'room-1' }))
    const ws = FakeWebSocket.instances[0]

    ws.onopen?.()

    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('PLAYER_JOIN'))
    expect(mockGameBusEmit).toHaveBeenCalledWith('networkLifecycle', expect.objectContaining({ state: 'connected' }))
  })

  it('emits host_requested and sends HOST_GAME on hostRoom', () => {
    client.hostRoom('wss://example.com', 'Alice', { name: 'Test', map: 'map_default', mode: 'ffa', killLimit: 10, roundDurationSec: 60, maxPlayers: 4 })
    expect(mockGameBusEmit).toHaveBeenCalledWith('networkLifecycle', expect.objectContaining({ state: 'host_requested' }))

    const ws = FakeWebSocket.instances[0]
    ws.onopen?.()

    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('HOST_GAME'))
  })

  it('receives JOIN_ACK and emits connected listener', () => {
    const connectedFn = vi.fn()
    client.on('connected', connectedFn)

    ;(client as any)._handleMessage(JSON.stringify({
      type: 'JOIN_ACK',
      playerId: 'player-123',
      roomId: 'room-123',
      hosted: true,
      protocol: { snapshotSchemaVersion: 2 },
    }))

    expect(connectedFn).toHaveBeenCalledWith({ playerId: 'player-123', roomId: 'room-123', hosted: true })
    expect(client.playerId).toBe('player-123')
    expect(client.roomId).toBe('room-123')
  })

  it('disconnects cleanly and emits disconnected event', () => {
    const ws = new FakeWebSocket('wss://example.com') as any
    client['_connected'] = true
    client['_inGame'] = true
    client['ws'] = ws

    const disconnectedFn = vi.fn()
    client.on('disconnected', disconnectedFn)

    client.disconnect()

    expect(ws.close).toHaveBeenCalled()
    expect(disconnectedFn).toHaveBeenCalledWith({ reason: 'disconnected_by_client' })
    expect(mockGameBusEmit).toHaveBeenCalledWith('networkLifecycle', expect.objectContaining({ state: 'disconnected' }))
    expect(client.connected).toBe(false)
    expect(client.inGame).toBe(false)
  })

  it('returns debug state and uses system context only after init', () => {
    expect(client.getDebugState().metrics.hasSystemContext).toBe(false)

    client.setSystemContext({ systems: { collisionAuthoritySystem: { getHandshake: () => ({ version: 1, checksum: 'abc' }) } } } as any)
    expect(client.getDebugState().metrics.hasSystemContext).toBe(true)
    expect(client.getDebugState().metrics.hasCollisionAuthority).toBe(true)
  })

  it('fetchServers returns server list on successful HTTP response', async () => {
    const fakeResponse = { ok: true, json: vi.fn().mockResolvedValue({ servers: [{ id: 'server-1', name: 'Test' }] }) }
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse) as any

    const servers = await client.fetchServers('https://example.com')

    expect(servers).toEqual([{ id: 'server-1', name: 'Test' }])
    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/servers')
  })

  it('fetchServers returns empty array when fetch fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network failure')) as any

    const servers = await client.fetchServers('https://example.com')

    expect(servers).toEqual([])
    consoleError.mockRestore()
  })

  it('parses movement intent only when valid', () => {
    expect((client as any).parseMovementIntent({ horizontalImpulse: 1, direction: { x: 0, y: 0, z: 1 } })).toEqual({ horizontalImpulse: 1, direction: { x: 0, y: 0, z: 1 } })
    expect((client as any).parseMovementIntent({ horizontalImpulse: '1', direction: { x: 0, y: 0, z: 1 } })).toBeUndefined()
  })

  it('sends movement commands only when connected and in-game', () => {
    const ws = new FakeWebSocket('wss://example.com') as any
    client['ws'] = ws
    client['_connected'] = true
    client['_inGame'] = true

    client.sendMovementCommand({ seq: 1, ts: 123, input: { forward: true, backward: false, left: false, right: false, yaw: 0 } })

    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('PLAYER_INPUT'))
  })

  it('sends lobby actions and emits action_sent', () => {
    const ws = new FakeWebSocket('wss://example.com') as any
    client['ws'] = ws
    client['_connected'] = true

    const actionSent = vi.fn()
    client.on('action_sent', actionSent)

    client.sendLobbyAction('LOBBY_MODE', { mode: 'ffa' })

    expect(actionSent).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOBBY_MODE', data: { mode: 'ffa' } }))
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('LOBBY_MODE'))
  })

  it('sends appearance actions correctly', () => {
    const ws = new FakeWebSocket('wss://example.com') as any
    client['ws'] = ws
    client['_connected'] = true

    client.sendAppearance({ modelVariant: 'scout', bodyColor: 5 })

    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('PLAYER_APPEARANCE'))
  })

  it('handles GAME_START with late join and emits connected and game_start', () => {
    const connectedFn = vi.fn()
    const gameStartFn = vi.fn()
    client.on('connected', connectedFn)
    client.on('game_start', gameStartFn)

    ;(client as any)._handleMessage(JSON.stringify({
      type: 'GAME_START',
      protocol: { snapshotSchemaVersion: 2 },
      late: true,
      playerId: 'player-456',
      sessionId: 'session-456',
      map: 'arena',
      mode: 'ffa',
    }))

    expect(client.inGame).toBe(true)
    expect(connectedFn).toHaveBeenCalledWith({ playerId: 'player-456', roomId: 'session-456', hosted: false })
    expect(gameStartFn).toHaveBeenCalledWith({ map: 'arena', mode: 'ffa', sessionId: 'session-456', late: true })
  })

  it('processes FULL_SYNC_DATA and emits full_sync_data events and game bus notifications', () => {
    const fullSyncFn = vi.fn()
    client.on('full_sync_data', fullSyncFn)

    ;(client as any)._handleMessage(JSON.stringify({
      type: 'FULL_SYNC_DATA',
      playerId: 'player-789',
      tick: 10,
      ack: 3,
      entities: [{ id: 'player-789', type: 'player', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
      timestamp: 1234,
    }))

    expect(fullSyncFn).toHaveBeenCalledWith(expect.objectContaining({ tick: 10, entityCount: 1 }))
    expect(mockGameBusEmit).toHaveBeenCalledWith('FULL_SYNC_READY', expect.objectContaining({ tick: 10, entityCount: 1 }))
    expect(mockGameBusEmit).toHaveBeenCalledWith('FORCE_SNAPSHOT', expect.objectContaining({ timestamp: 1234 }))
  })

  it('processes PONG messages and updates RTT', () => {
    vi.setSystemTime(1000)
    client['_lastPingTs'] = 900
    client['_connected'] = true

    ;(client as any)._handleMessage(JSON.stringify({ type: 'PONG', clientTs: 900 }))

    expect(client.rtt).toBe(100)
    vi.useRealTimers()
  })

  it('processes TICK_SYNC messages and emits tick_sync', () => {
    const tickSyncFn = vi.fn()
    client.on('tick_sync', tickSyncFn)

    ;(client as any)._handleMessage(JSON.stringify({ type: 'TICK_SYNC', tick: 20, timestamp: 5555, targetTickRate: 30 }))

    expect(tickSyncFn).toHaveBeenCalledWith({ tick: 20, timestamp: 5555, tickRate: 30 })
  })

  it('bridges HORDE_START_CONFIRMED to both client event emitter and gameBus', () => {
    const hordeConfirmedFn = vi.fn()
    client.on('horde_start_confirmed', hordeConfirmedFn)

    ;(client as any)._handleMessage(JSON.stringify({
      type: 'HORDE_START_CONFIRMED',
      playerId: 'player-123',
      timestamp: 777,
    }))

    expect(hordeConfirmedFn).toHaveBeenCalledWith({ playerId: 'player-123', timestamp: 777 })
    expect(mockGameBusEmit).toHaveBeenCalledWith('horde_start_confirmed', { playerId: 'player-123', timestamp: 777 })
    expect(mockGameBusEmit).toHaveBeenCalledWith('HORDE_START_CONFIRMED', { playerId: 'player-123', timestamp: 777 })
  })

  it('sends inventory and ability state sync actions', () => {
    const ws = new FakeWebSocket('wss://example.com') as any
    client['ws'] = ws
    client['_connected'] = true

    client.sendInventoryStateSync({ equipped: ['pistol'], activeSlot: 'primary' })
    client.sendAbilityStateSync({ abilityId: 'dash', cooldown: 2 })

    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('INVENTORY_STATE_SYNC'))
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('ABILITY_STATE_SYNC'))
  })

  it('requests a full sync over the websocket', () => {
    const ws = new FakeWebSocket('wss://example.com') as any
    client['ws'] = ws
    client['_connected'] = true

    client.requestFullSync()

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'FULL_SYNC_REQ' }))
  })
})
