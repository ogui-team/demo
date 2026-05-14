import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.SERVER_HTTP_URL = 'https://demo-lzj1.onrender.com/'
  process.env.RENDER_EXTERNAL_URL = ''
  process.env.ALLOWED_ORIGINS = ''
  return null
})

vi.mock('express', () => {
  const app = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    static: vi.fn(() => app),
  }
  const express = vi.fn(() => app)
  express.json = vi.fn(() => vi.fn())
  express.static = app.static
  const router = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  }
  express.Router = vi.fn(() => router)
  return { default: express, Router: express.Router }
})

vi.mock('ws', () => {
  class WebSocket {}
  WebSocket.OPEN = 1
  class WebSocketServer {
    on = vi.fn()
    constructor(_opts: unknown) {}
  }
  return { WebSocketServer, WebSocket }
})

vi.mock('http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('http')>()
  return {
    ...actual,
    createServer: vi.fn(() => ({ listen: vi.fn() })),
  }
})

vi.mock('../../server/src/core/GameSession', () => ({
  GameSession: class {
    constructor(_room: any, _tick: number) {}
    getProtocolHandshake() { return { collisionAuthority: { version: 1, checksum: 'ok' }, snapshotSchemaVersion: 1 } }
    start() {}
    addPlayer(_ws: any, _id: string, _name: string, _appearance: unknown) {}
  },
  sanitizePlayerAppearancePayload: vi.fn((value: unknown) => (typeof value === 'object' && value ? value as Record<string, unknown> : null)),
}))

vi.mock('../../server/src/system/LobbyManager', () => ({
  LobbyManager: class {
    onGameStart = vi.fn()
    listRooms = vi.fn(() => [])
    getRoom = vi.fn(() => undefined)
    getOrCreateRoom = vi.fn(() => ({ id: 'auto', selectedMap: 'map_default', selectedMode: 'ffa', players: new Map(), maxPlayers: 8, status: 'waiting', killLimit: 10, roundDurationSec: 180 }))
  }
}))

vi.mock('../../server/src/collision/CollisionAuthoritySystem', () => ({
  CollisionAuthoritySystem: class {
    constructor(_mapId: string, _roomId: string) {}
    getHandshake() { return { version: 1, checksum: 'abc' } }
  },
}))

vi.mock('../../server/src/system/InventoryManager', () => ({
  inventoryManager: { getOrCreate: vi.fn(() => ({})), evict: vi.fn() },
}))

vi.mock('../../server/src/snapshot/SnapshotContract', () => ({ SNAPSHOT_SCHEMA_VERSION: 1 }))
vi.mock('../../server/src/data/itemCatalog', () => ({ ITEM_CATALOG: [] }))
vi.mock('../../server/src/system/RuntimeMetricsStore', () => ({
  getLatestRuntimeMetrics: vi.fn(() => null),
  saveRuntimeMetrics: vi.fn(() => []),
}))

import { buildAllowedOrigins, isLoopbackOrigin, isAllowedOrigin, classifyRateLimitKey, consumeRateLimit, validateClientProtocol } from '../../server/src/index'

describe('server index helpers', () => {
  it('detects loopback origins and allows origin values', () => {
    expect(isLoopbackOrigin('http://localhost:8080')).toBe(true)
    expect(isLoopbackOrigin('https://127.0.0.1:3000')).toBe(true)
    expect(isLoopbackOrigin('http://example.com')).toBe(false)
    expect(isLoopbackOrigin('not-a-url')).toBe(false)
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin('http://localhost:8080')).toBe(true)
    expect(isAllowedOrigin('https://demo-lzj1.onrender.com')).toBe(true)
    expect(buildAllowedOrigins().has('https://demo-lzj1.onrender.com')).toBe(true)
  })

  it('classifies rate limit keys correctly', () => {
    expect(classifyRateLimitKey('PLAYER_INPUT')).toBe('PLAYER_INPUT')
    expect(classifyRateLimitKey('INVENTORY_EQUIP')).toBe('INVENTORY_MUTATION')
    expect(classifyRateLimitKey('UNKNOWN')).toBe('DEFAULT')
  })

  it('consumes rate limit and rejects when threshold exceeded', () => {
    const ws = { readyState: 1, send: vi.fn(), close: vi.fn() }
    const guard = { malformedMessages: 0, rateLimitViolations: 4, rates: new Map() }

    expect(consumeRateLimit(ws as any, guard as any, 'PLAYER_INPUT')).toBe(true)
    expect(guard.rates.get('PLAYER_INPUT')?.count).toBe(1)

    const startedAt = Date.now()
    guard.rates.set('PLAYER_INPUT', { startedAt, count: 90 })
    const result = consumeRateLimit(ws as any, guard as any, 'PLAYER_INPUT')
    expect(result).toBe(false)
    expect(guard.rateLimitViolations).toBe(5)
    expect(ws.send).toHaveBeenCalled()
  })

  it('validates client protocol handshake success and failure', () => {
    const ws = { readyState: 1, send: vi.fn(), close: vi.fn() }
    const expected = { collisionAuthority: { version: 1, checksum: 'abc' }, snapshotSchemaVersion: 1 }

    expect(validateClientProtocol(ws as any, { collisionAuthority: { version: 1, checksum: 'abc' }, snapshotSchemaVersion: 1 }, expected)).toBe(true)
    expect(validateClientProtocol(ws as any, { collisionAuthority: { version: 2, checksum: 'bad' }, snapshotSchemaVersion: 1 }, expected)).toBe(false)
    expect(validateClientProtocol(ws as any, { collisionAuthority: { version: 1, checksum: 'abc' }, snapshotSchemaVersion: 2 }, expected)).toBe(false)
  })
})
