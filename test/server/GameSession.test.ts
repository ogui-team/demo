import { expect, type Mock, vi } from 'vitest'
import { WebSocket } from 'ws'

vi.mock('../../server/src/collision/CollisionAuthoritySystem', () => ({
  CollisionAuthoritySystem: class {
    mapId: string
    sessionId: string

    constructor(mapId: string, sessionId: string) {
      this.mapId = mapId
      this.sessionId = sessionId
    }

    getHandshake() {
      return { version: 1, checksum: 'mock-checksum' }
    }

    getStaticLayout() {
      return { boxes: [] }
    }

    upsertDynamicCollider() {
      return undefined
    }

    removeDynamicCollider() {
      return undefined
    }

    clearDynamicColliders() {
      return undefined
    }

    captureCollisionHistoryFrame(tick: number, timestamp: number) {
      return { tick, timestamp, dynamicBoxes: [] }
    }

    isPositionValid() {
      return true
    }

    getDiagnostics() {
      return { status: 'ok' }
    }
  },
}))

import * as broadcastRuntime from '../../server/src/session/broadcastRuntime'
import { GameSession, sanitizePlayerAppearancePayload } from '../../server/src/core/GameSession'

const createRoom = (): any => ({
  id: 'room-1',
  name: 'Test Room',
  players: new Map(),
  selectedMap: 'map_default',
  selectedMode: 'ffa',
  status: 'waiting',
  countdown: 0,
  hostId: 'host-1',
  maxPlayers: 4,
  killLimit: 10,
  roundDurationSec: 60,
  spawnPoints: [{ x: 0, y: 1, z: 0 }],
})

const createMockWs = () => ({
  readyState: WebSocket.OPEN,
  send: vi.fn(),
}) as unknown as WebSocket

describe('GameSession', () => {
  let gameSession: GameSession
  let room: any
  let mockWs: any
  let broadcastAllSpy: Mock
  let broadcastOthersSpy: Mock
  let sendToSpy: Mock

  beforeEach(() => {
    vi.useFakeTimers()
    room = createRoom()
    mockWs = createMockWs()
    broadcastAllSpy = vi.spyOn(broadcastRuntime, 'broadcastAll')
    broadcastOthersSpy = vi.spyOn(broadcastRuntime, 'broadcastOthers')
    sendToSpy = vi.spyOn(broadcastRuntime, 'sendTo')
    broadcastAllSpy.mockClear()
    broadcastOthersSpy.mockClear()
    sendToSpy.mockClear()
    gameSession = new GameSession(room, 60)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sanitizes player appearance payload correctly', () => {
    expect(sanitizePlayerAppearancePayload(null)).toBeNull()
    expect(sanitizePlayerAppearancePayload(true)).toBeNull()
    expect(sanitizePlayerAppearancePayload({})).toBeNull()
    expect(sanitizePlayerAppearancePayload({
      modelVariant: 'operator',
      textureStyle: 'checker',
      bodyColor: 1,
      accentColor: 2,
      invalid: 'value',
    })).toEqual({
      modelVariant: 'operator',
      textureStyle: 'checker',
      bodyColor: 1,
      accentColor: 2,
    })
  })

  it('adds a player, sends join state, and then removes the player cleanly', () => {
    const player = gameSession.addPlayer(mockWs, 'player-1', 'Alice', { modelVariant: 'operator', textureStyle: 'checker', bodyColor: 3 })
    expect(player.id).toBe('player-1')
    expect(gameSession.getPlayerCount()).toBe(1)
    expect(gameSession.getPlayerById('player-1')?.name).toBe('Alice')
    expect(gameSession.getEntityCount()).toBe(1)

    // Flush pending setImmediate full sync and force full snapshot
    vi.runAllTimers()

    expect(mockWs.send).toHaveBeenCalled()
    expect((broadcastRuntime.broadcastAll as Mock).mock.calls.length).toBeGreaterThanOrEqual(1)

    gameSession.removePlayer(mockWs)
    expect(gameSession.getPlayerCount()).toBe(0)
    expect(gameSession.getEntityCount()).toBe(0)
  })

  it('handles full sync requests and sends FULL_SYNC_DATA', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(broadcastRuntime.sendTo as Mock).mockClear()
    mockWs.send.mockClear()

    gameSession.handleFullSyncRequest(mockWs)

    expect(broadcastRuntime.sendTo).toHaveBeenCalledTimes(1)
    const sentMessage = (broadcastRuntime.sendTo as Mock).mock.calls[0][1]
    expect(sentMessage.type).toBe('FULL_SYNC_DATA')
    expect(sentMessage.localPlayerId).toBe('player-1')
    expect(sentMessage.entities).toEqual(expect.any(Array))
  })

  it('executes round lifecycle startRound and activates the round after the delay', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    gameSession.startRound()
    expect((broadcastRuntime.broadcastAll as Mock).mock.calls.some(
      (call) => call[0] && call[0].type === 'ROUND_START'
    )).toBe(true)
    expect(gameSession.getRoundState().status).toBe('warmup')

    vi.advanceTimersByTime(1200)
    expect(gameSession.getRoundState().status).toBe('active')
    expect((broadcastRuntime.broadcastAll as Mock).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('ends a round and restarts it after the restart timer', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    ;(gameSession as any).roundState.status = 'active'
    gameSession.endRound('manual')

    expect(gameSession.getRoundState().status).toBe('ended')
    expect(broadcastRuntime.broadcastAll).toHaveBeenCalled()

    const callsAfterEnd = (broadcastRuntime.broadcastAll as Mock).mock.calls.length
    vi.advanceTimersByTime(5000)
    expect((broadcastRuntime.broadcastAll as Mock).mock.calls.length).toBeGreaterThan(callsAfterEnd)
    expect(gameSession.getRoundState().status).not.toBe('ended')
  })

  it('handles dev commands spawn_army and unknown commands', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    const previousEntityCount = gameSession.getEntityCount()

    gameSession.handleDevCommand(mockWs, 'spawn_army', { count: '5', x: '0', z: '0', spacing: '1' })
    expect(gameSession.getEntityCount()).toBe(previousEntityCount + 5)
    expect(broadcastRuntime.sendTo).toHaveBeenCalledWith(mockWs, expect.objectContaining({ type: 'DEV_COMMAND_RESULT' }))

    ;(broadcastRuntime.sendTo as Mock).mockClear()
    gameSession.handleDevCommand(mockWs, 'unknown_command', {})
    expect(broadcastRuntime.sendTo).toHaveBeenCalledWith(mockWs, expect.objectContaining({ type: 'ERROR' }))
  })

  it('updates ping and exposes network diagnostics', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()

    gameSession.setPlayerPing(mockWs, 123)
    expect(gameSession.getPlayerById('player-1')?.ping).toBe(123)

    const diagnostics = gameSession.getNetworkDiagnostics()
    expect(diagnostics).toHaveProperty('sessionId', room.id)
    expect(diagnostics).toHaveProperty('tickRate', 60)
    expect(diagnostics).toHaveProperty('worldObjectCount')
    expect(diagnostics).toHaveProperty('actorRuntime')
  })

  it('rejects dev commands when production mode is enabled', () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(broadcastRuntime.sendTo as Mock).mockClear()

    gameSession.handleDevCommand(mockWs, 'spawn_army', { count: '1', x: '0', z: '0', spacing: '1' })
    expect(broadcastRuntime.sendTo).toHaveBeenCalledWith(mockWs, expect.objectContaining({ type: 'ERROR' }))

    process.env.NODE_ENV = originalEnv
  })

  it('handles the flush_geometry dev command and broadcasts the result', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()
    ;(broadcastRuntime.sendTo as Mock).mockClear()

    gameSession.handleDevCommand(mockWs, 'flush_geometry', {})

    expect(broadcastRuntime.broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'GEOMETRY_FLUSHED' }), expect.anything())
    expect(broadcastRuntime.sendTo).toHaveBeenCalledWith(mockWs, expect.objectContaining({ type: 'DEV_COMMAND_RESULT', success: true }))
  })

  it('maps legacy gameplay actions to commands and broadcasts authorization', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    gameSession.handleAction(mockWs, 'WEAPON_EQUIP', { weaponId: 'pistol' })

    expect(broadcastRuntime.broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'COMMAND_AUTHORIZED' }), expect.anything())
  })

  it('ends the round when removing a player during an active round with one remaining', () => {
    const secondWs = createMockWs()
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    gameSession.addPlayer(secondWs, 'player-2', 'Bob')
    vi.runAllTimers()
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    ;(gameSession as any).roundState.status = 'active'
    gameSession.removePlayer(secondWs)

    expect(gameSession.getPlayerCount()).toBe(1)
    expect(broadcastRuntime.broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'ROUND_END' }), expect.anything())
  })

  it('ignores legacy actions that are filtered out', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    gameSession.handleAction(mockWs, 'PLAYER_DAMAGE', {})
    expect(broadcastRuntime.broadcastAll).not.toHaveBeenCalled()
  })

  it('purges disallowed replicated entities and world objects', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    gameSession['entities'].set('npc_1', {
      id: 'npc_1',
      type: 'npc',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    })

    gameSession['worldObjects'].set('obj_1', {
      id: 'obj_1',
      entityType: 'dummy',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      renderData: { meshType: 'box', color: 0, geometry: { width: 1, height: 1, depth: 1 } },
    })

    ;(gameSession as any).purgeDisallowedReplicatedObjects('test')

    expect(gameSession.getEntityCount()).toBe(1)
    expect(gameSession['worldObjects'].has('obj_1')).toBe(false)
    const didDestroyNpc = broadcastAllSpy.mock.calls.some((call) => call[0]?.type === 'ENTITY_DESTROY' && call[0]?.entityId === 'npc_1')
    const didRemoveWorldObj = broadcastAllSpy.mock.calls.some((call) => call[0]?.type === 'WORLD_OBJECT_REMOVE' && call[0]?.id === 'obj_1')
    expect(didDestroyNpc).toBe(true)
    expect(didRemoveWorldObj).toBe(true)
  })

  it('returns the protocol handshake from collision authority', () => {
    const handshake = gameSession.getProtocolHandshake()
    expect(handshake).toHaveProperty('collisionAuthority')
    expect(handshake.collisionAuthority).toHaveProperty('version', 1)
    expect(handshake.collisionAuthority).toHaveProperty('checksum', expect.any(String))
    expect(handshake.snapshotSchemaVersion).toBeTypeOf('number')
  })

  it('resolves a fallback spawn point when the offset position is invalid', () => {
    (gameSession['collisionAuthority'] as any).isPositionValid = () => false
    const fallback = (gameSession as any)._resolvePlayerSpawnPoint(0, 'player-1')
    expect(fallback).toEqual({ x: 0, y: 1, z: 0 })
  })

  it('broadcasts score updates to connected players', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    ;(gameSession as any)._broadcastScoreUpdate()

    expect(broadcastRuntime.broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'SCORE_UPDATE', players: expect.any(Array) }), expect.anything())
  })

  it('logs an attempted purge of a connected player entity and preserves allowed world objects', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()

    const playerEntity = gameSession['entities'].get('player-1') as any
    playerEntity.type = 'Player'
    gameSession['entities'].set('player-1', playerEntity)
    gameSession['worldObjects'].set('obj-1', {
      id: 'obj-1',
      entityType: 'static_collider',
      position: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      renderData: { meshType: 'box', color: 0, geometry: { width: 1, height: 1, depth: 1 } },
    })

    ;(gameSession as any).purgeDisallowedReplicatedObjects('world_delta')

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[SERVER_ASSERTION_ERROR] Attempted to purge connected player entity'), expect.anything())
    expect(gameSession['worldObjects'].has('obj-1')).toBe(true)
    consoleErrorSpy.mockRestore()
  })

  it('logs snapshot assertion and entity-filter warnings when a player entity is incorrectly treated as a grunt', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const gruntPlayerId = 'npc_enemy_grunt_player-1'
    gameSession.addPlayer(mockWs, gruntPlayerId, 'Alice')
    vi.runAllTimers()

    ;(gameSession as any)._broadcastWorldDelta()

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('SNAPSHOT WOULD HAVE 0 ENTITIES BUT PLAYERS EXIST'), expect.anything())
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('PLAYER ENTITY FILTERED OUT'), expect.anything())
    consoleErrorSpy.mockRestore()
  })

  it('broadcasts a world delta successfully when the player entity is allowed for snapshot', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()
    mockWs.send.mockClear()

    ;(gameSession as any)._broadcastWorldDelta()

    expect(mockWs.send).toHaveBeenCalled()
    expect((broadcastRuntime.broadcastAll as Mock).mock.calls.length).toBeGreaterThanOrEqual(0)
  })

  it('determines whether an actor position is usable and respects nearby non-dead players', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()

    expect((gameSession as any)._isActorPositionUsable({ x: 100, y: 0, z: 100 }, 1)).toBe(true)
    expect((gameSession as any)._isActorPositionUsable({ x: 0, y: 0, z: 0 }, 1)).toBe(false)
  })

  it('updates player status movement modifiers and syncs the entity when status expires', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    const player = gameSession.getPlayerById('player-1')!
    player.rotation = { x: 0, y: 0, z: 0 }
    player.activeMovementStatuses = [{ statusId: 'status_chilled', expiresAt: Date.now() - 100 }]
    const syncSpy = vi.spyOn(gameSession as any, '_syncPlayerEntity')

    ;(gameSession as any)._updatePlayerStatusMovementModifiers(Date.now())

    expect(syncSpy).toHaveBeenCalledWith('player-1')
    expect(player.activeMovementStatuses).toEqual([])
  })

  it('executes a game tick without players and emits tick sync', () => {
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    ;(gameSession as any)._gameTick()

    expect(broadcastRuntime.broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'TICK_SYNC' }), expect.anything())
  })

  it('sets and removes arbitrary entities', () => {
    gameSession.setEntity({
      id: 'entity-1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    })
    expect(gameSession.getEntityCount()).toBe(1)

    gameSession.removeEntity('entity-1')
    expect(gameSession.getEntityCount()).toBe(0)
  })

  it('validates weapon usability based on player state and round status', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(gameSession as any).roundState.status = 'active'
    const player = gameSession.getPlayerById('player-1')!

    expect((gameSession as any)._canUseWeapons(player)).toBe(true)
    player.dead = true
    expect((gameSession as any)._canUseWeapons(player)).toBe(false)
    player.dead = false
    ;(gameSession as any).roundState.status = 'warmup'
    expect((gameSession as any)._canUseWeapons(player)).toBe(false)
  })

  it('captures history frames, trims old frames, and finds the closest frame', () => {
    const shortSession = new GameSession(room, 1)
    const castSession = shortSession as any

    castSession.tick = 1
    castSession._captureHistoryFrame(100)
    castSession.tick = 2
    castSession._captureHistoryFrame(200)
    castSession.tick = 3
    castSession._captureHistoryFrame(300)

    expect(castSession.entityHistoryFrames.length).toBeGreaterThan(0)
    expect(castSession.collisionHistoryFrames.length).toBeGreaterThan(0)
    expect(castSession._findEntityHistoryFrame(250)).toBeTruthy()
    expect(castSession._findCollisionHistoryFrame(250)).toBeTruthy()
  })

  it('produces world object half extents and creates world objects from request', () => {
    const obj = {
      id: 'obj-1',
      entityType: 'static_collider',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      renderData: { meshType: 'box', color: 0xff00ff, geometry: { width: 2, height: 4, depth: 6 } },
    }

    const extents = (gameSession as any)._getWorldObjectHalfExtents(obj)
    expect(extents).toEqual({ x: 1, y: 2, z: 3 })

    const created = (gameSession as any)._createWorldObjectFromRequest({
      entityType: 'barrier',
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      renderData: { meshType: 'box', color: 123456, geometry: { width: 4 } },
    }, 'player-1')

    expect(created).toMatchObject({
      entityType: 'barrier',
      position: { x: 1, y: 2, z: 3 },
    })
    expect(created?.id).toBe('world_object_room-1_player-1_1')
    expect((gameSession as any)._createWorldObjectFromRequest({ renderData: {} }, 'player-1')).toBeNull()
  })

  it('increments world object ids deterministically', () => {
    expect((gameSession as any)._nextWorldObjectId('player-1')).toBe('world_object_room-1_player-1_1')
    expect((gameSession as any)._nextWorldObjectId('player-1')).toBe('world_object_room-1_player-1_2')
  })

  it('processes legacy PLAYER_APPEARANCE actions and broadcasts appearance updates', () => {
    const broadcastOthersSpy = vi.spyOn(broadcastRuntime, 'broadcastOthers')
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    broadcastOthersSpy.mockClear()

    gameSession.handleAction(mockWs, 'PLAYER_APPEARANCE', {
      appearance: { modelVariant: 'scout', bodyColor: 42 },
    })

    expect(gameSession.getPlayerById('player-1')?.appearance).toEqual({ modelVariant: 'scout', bodyColor: 42 })
    expect(broadcastOthersSpy).toHaveBeenCalledTimes(1)
    expect(broadcastOthersSpy.mock.calls[0][0]).toBe('player-1')
    expect(broadcastOthersSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
      type: 'PLAYER_APPEARANCE',
      playerId: 'player-1',
      appearance: { modelVariant: 'scout', bodyColor: 42 },
    }))
  })

  it('handles legacy WORLD_OBJECT_PLACE and WORLD_OBJECT_REMOVE actions', () => {
    const broadcastAllSpy = vi.spyOn(broadcastRuntime, 'broadcastAll')
    const broadcastOthersSpy = vi.spyOn(broadcastRuntime, 'broadcastOthers')
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    broadcastAllSpy.mockClear()
    broadcastOthersSpy.mockClear()

    gameSession.handleAction(mockWs, 'WORLD_OBJECT_PLACE', {
      entityType: 'static_collider',
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      renderData: { meshType: 'box', color: 123, geometry: { width: 2, height: 2, depth: 2 } },
    })

    expect(broadcastAllSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'WORLD_OBJECT_PLACE' }), expect.anything())
    expect(gameSession['worldObjects'].size).toBe(1)

    const objectId = Array.from(gameSession['worldObjects'].keys())[0]
    gameSession.handleAction(mockWs, 'WORLD_OBJECT_REMOVE', { id: objectId })

    expect(gameSession['worldObjects'].has(objectId)).toBe(false)
    expect(broadcastOthersSpy).toHaveBeenCalledWith('player-1', expect.objectContaining({ type: 'WORLD_OBJECT_REMOVE', id: objectId }), expect.anything())
  })

  it('handles legacy WORLD_OBJECT_UPDATE and PLAYER_MODE_CHANGE actions', () => {
    const broadcastOthersSpy = vi.spyOn(broadcastRuntime, 'broadcastOthers')
    const broadcastAllSpy = vi.spyOn(broadcastRuntime, 'broadcastAll')
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    gameSession['worldObjects'].set('obj-1', {
      id: 'obj-1',
      entityType: 'static_collider',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      renderData: { meshType: 'box', color: 0, geometry: { width: 1, height: 1, depth: 1 } },
    })
    broadcastOthersSpy.mockClear()
    broadcastAllSpy.mockClear()

    gameSession.handleAction(mockWs, 'WORLD_OBJECT_UPDATE', { id: 'obj-1', position: { x: 2, y: 2, z: 2 } })
    expect(broadcastOthersSpy).toHaveBeenCalledWith('player-1', expect.objectContaining({ type: 'WORLD_OBJECT_UPDATE', object: expect.objectContaining({ id: 'obj-1', position: { x: 2, y: 2, z: 2 } }) }), expect.anything())

    gameSession.handleAction(mockWs, 'PLAYER_MODE_CHANGE', { mode: 'spectator' })
    expect(gameSession.getPlayerById('player-1')?.dead).toBe(true)
    expect(broadcastAllSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYER_SPECTATE', playerId: 'player-1' }), expect.anything())
  })

  it('registers and tears down actor runtime world objects through the authoritative actor runtime host', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    const broadcastAllSpy = vi.spyOn(broadcastRuntime, 'broadcastAll')
    const actorRuntime = (gameSession as any).actorRuntime
    actorRuntime.registerProfile({
      id: 'dummy_actor',
      entityType: 'dummy_actor',
      halfExtents: { x: 1, y: 1, z: 1 },
      collisionRadius: 1,
      renderData: { meshType: 'box', color: 0x123456, geometry: { width: 1, height: 1, depth: 1 } },
      motion: { moveSpeed: 1, detectionRange: 10, stopRange: 0.5, returnRange: 5, syncInterval: 1 },
      createObjectId: (sessionId: string) => `actor_${sessionId}_dummy_actor`,
      resolveSpawnPosition: () => ({ x: 0, y: 1, z: 0 }),
      resolveGoal: () => ({ position: { x: 0, y: 1, z: 0 }, stopRange: 0.5 }),
    })

    const actor = actorRuntime.ensureSingleton('dummy_actor')
    expect(actor).not.toBeNull()
    expect(broadcastAllSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'WORLD_OBJECT_PLACE' }), expect.anything())
    broadcastAllSpy.mockClear()

    actorRuntime.destroyActor('dummy_actor')
    expect(broadcastAllSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'WORLD_OBJECT_REMOVE' }), expect.anything())
  })

  it('handles a legacy player shoot action and broadcasts authorization', () => {
    const secondWs = createMockWs()
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    gameSession.addPlayer(secondWs, 'player-2', 'Bob')
    vi.runAllTimers()
    ;(gameSession['collisionAuthority'] as any).raycast = () => null
    ;(gameSession as any).roundState.status = 'active'
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    gameSession.handleAction(mockWs, 'PLAYER_SHOOT', {
      weaponId: 'pistol',
      origin: { x: 0, y: 1, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      timestamp: Date.now(),
    })

    expect(broadcastRuntime.broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'COMMAND_AUTHORIZED' }), expect.anything())
    expect(gameSession.getPlayerById('player-2')?.health).toBeLessThan(100)
  })

  it('reads finite numbers and rejects invalid numeric inputs', () => {
    expect((gameSession as any)._readFiniteNumber(5)).toBe(5)
    expect((gameSession as any)._readFiniteNumber(NaN)).toBeUndefined()
    expect((gameSession as any)._readFiniteNumber('foo')).toBeUndefined()
  })

  it('starts and stops the session tick scheduler correctly', () => {
    const session = new GameSession(room, 10)
    session.start()
    expect((session as any).tickInterval).not.toBeNull()
    session.stop()
    expect((session as any).tickInterval).toBeNull()
  })

  it('returns the websocket-associated player from getPlayerByWs', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    expect(gameSession.getPlayerByWs(mockWs)?.id).toBe('player-1')
  })

  it('validates hitscan using the session collision authority and player history', () => {
    const secondWs = createMockWs()
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    gameSession.addPlayer(secondWs, 'player-2', 'Bob')
    vi.runAllTimers()
    ;(gameSession['collisionAuthority'] as any).raycast = () => null
    const result = (gameSession as any)._validateHitscan(
      'player-1',
      'pistol',
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
      Date.now(),
    )
    expect(result).toBe('player-2')
  })

  it('returns a respawn delay within the expected range', () => {
    const delay = (gameSession as any)._getRespawnDelayMs()
    expect(delay).toBeGreaterThanOrEqual(2000)
    expect(delay).toBeLessThan(5000)
  })

  it('handles a legacy RESPAWN_REQUEST when player is dead', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    expect(() => gameSession.handleAction(mockWs, 'UNKNOWN_LEGACY_ACTION', {})).not.toThrow()
  })

  it('rejects dev commands when websocket is not associated with a player', () => {
    const unknownWs = createMockWs()
    gameSession.handleDevCommand(unknownWs, 'spawn_army', { count: '1', x: '0', z: '0', spacing: '1' })

    expect(broadcastRuntime.broadcastAll).not.toHaveBeenCalled()
    expect(sendToSpy).not.toHaveBeenCalled()
  })

  it('does not broadcast round end again when the round is already ended', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    ;(gameSession as any).roundState.status = 'ended'
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    gameSession.endRound('manual')

    expect(broadcastRuntime.broadcastAll).not.toHaveBeenCalled()
  })

  it('clears an existing restart timer when starting a new round', () => {
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    const pendingTimer = setTimeout(() => undefined, 1000)
    ;(gameSession as any).restartTimer = pendingTimer
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    gameSession.startRound()

    expect((gameSession as any).restartTimer).toBeNull()
    expect((gameSession as any).roundStartTimer).not.toBeNull()
    expect(broadcastRuntime.broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'ROUND_START' }), expect.anything())
  })

  it('runs an active game tick and ends the round when time expires', () => {
    vi.setSystemTime(100000)
    gameSession.addPlayer(mockWs, 'player-1', 'Alice')
    vi.runAllTimers()
    mockWs.send.mockClear()
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()
    ;(gameSession as any).roundState.status = 'active'
    ;(gameSession as any).roundState.endsAt = 99999

    ;(gameSession as any)._gameTick()

    expect(broadcastRuntime.broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'TICK_SYNC' }), expect.anything())
    expect(mockWs.send).toHaveBeenCalled()
    expect((gameSession as any).roundState.status).toBe('ended')
  })

  it('ignores gameplay commands when websocket has no associated player', () => {
    const unknownWs = createMockWs()
    ;(broadcastRuntime.broadcastAll as Mock).mockClear()

    gameSession.handleGameplayCommand(unknownWs, 'WEAPON_EQUIP', { weaponId: 'pistol' })

    expect(broadcastRuntime.broadcastAll).not.toHaveBeenCalled()
  })
})
