import { LobbyManager } from '../../server/src/system/LobbyManager'
import { WebSocket } from 'ws'
import { cloneTropicalHorrorArchetypeAppearance } from '@shared/contracts'

describe('LobbyManager', () => {
  let lobby: LobbyManager
  let ws1: any
  let ws2: any

  beforeEach(() => {
    lobby = new LobbyManager()
    ws1 = { readyState: WebSocket.OPEN, send: vi.fn() }
    ws2 = { readyState: WebSocket.OPEN, send: vi.fn() }
  })

  it('creates and retrieves rooms with defaults', () => {
    const room = lobby.createRoom()

    expect(room.id).toMatch(/^lobby_\d+$/)
    expect(room.maxPlayers).toBeGreaterThanOrEqual(2)
    expect(room.name).toBe(`Server ${room.id}`)
    expect(room.players.size).toBe(0)
  })

  it('joins a player and assigns the first player as host', () => {
    const room = lobby.createRoom({ maxPlayers: 4 })
    const success = lobby.joinRoom(ws1, room.id, 'p1', 'Alice')

    expect(success).toBe(true)
    expect(room.players.get('p1')?.isHost).toBe(true)
    expect(room.hostId).toBe('p1')
  })

  it('prevents join when room is full or in game', () => {
    const room = lobby.createRoom({ maxPlayers: 2 })
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')
    lobby.joinRoom(ws2, room.id, 'p2', 'Bob')

    const ws3 = { readyState: WebSocket.OPEN, send: vi.fn() }
    const notJoined = lobby.joinRoom(ws3, room.id, 'p3', 'Carol')

    expect(notJoined).toBe(false)
  })

  it('transfers host when host leaves', () => {
    const room = lobby.createRoom({ maxPlayers: 4 })
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')
    lobby.joinRoom(ws2, room.id, 'p2', 'Bob')

    lobby.leaveRoom(ws1)

    expect(room.players.has('p1')).toBe(false)
    expect(room.players.get('p2')?.isHost).toBe(true)
    expect(room.hostId).toBe('p2')
  })

  it('deletes room when all players leave', () => {
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')

    lobby.leaveRoom(ws1)

    expect(lobby.getRoom(room.id)).toBeUndefined()
  })

  it('handles lobby actions only for valid room and actor', () => {
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')

    lobby.handleLobbyAction(ws1, 'LOBBY_READY', { ready: true })

    expect(room.players.get('p1')?.ready).toBe(true)
  })

  it('updates ping for the correct player', () => {
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')
    lobby.updatePing(ws1, 123)

    expect(room.players.get('p1')?.ping).toBe(123)
  })

  it('prunes disconnected rooms and players', () => {
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')
    ws1.readyState = WebSocket.CLOSED

    lobby.pruneDisconnectedRooms()

    expect(lobby.getRoom(room.id)).toBeUndefined()
  })

  it('starts countdown when all players become ready and picks the voted map', () => {
    vi.useFakeTimers()
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')
    lobby.joinRoom(ws2, room.id, 'p2', 'Bob')

    lobby.handleLobbyAction(ws1, 'LOBBY_MAP', { mapId: 'forest_arena' })
    lobby.handleLobbyAction(ws2, 'MAP_VOTE', { mapId: 'freeplay_test' })
    lobby.handleLobbyAction(ws1, 'LOBBY_READY', { ready: true })
    lobby.handleLobbyAction(ws2, 'LOBBY_READY', { ready: true })

    expect(room.status).toBe('countdown')
    vi.advanceTimersByTime(3100)

    expect(room.status).toBe('in_game')
    expect(room.selectedMap).toBe('freeplay_test')
    vi.useRealTimers()
  })

  it('allows the host to update room settings and preserves bounds', () => {
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')

    lobby.handleLobbyAction(ws1, 'LOBBY_SETTINGS', {
      name: 'Custom Room',
      killLimit: 20,
      roundDurationSec: 120,
      maxPlayers: 4,
    })

    expect(room.name).toBe('Custom Room')
    expect(room.killLimit).toBe(20)
    expect(room.roundDurationSec).toBe(120)
    expect(room.maxPlayers).toBe(4)
  })

  it('forces start immediately when host requests it', () => {
    vi.useFakeTimers()
    const started: any[] = []
    lobby.onGameStart((room) => started.push(room))
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')

    lobby.handleLobbyAction(ws1, 'LOBBY_FORCE_START', {})
    vi.advanceTimersByTime(1000)

    expect(room.status).toBe('in_game')
    expect(started).toHaveLength(1)
    vi.useRealTimers()
  })

  it('cancels countdown when a ready player becomes unready', () => {
    vi.useFakeTimers()
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')
    lobby.joinRoom(ws2, room.id, 'p2', 'Bob')

    lobby.handleLobbyAction(ws1, 'LOBBY_READY', { ready: true })
    lobby.handleLobbyAction(ws2, 'LOBBY_READY', { ready: true })
    expect(room.status).toBe('countdown')

    lobby.handleLobbyAction(ws2, 'LOBBY_READY', { ready: false })
    expect(room.status).toBe('waiting')
    expect(room.countdown).toBe(-1)
    vi.useRealTimers()
  })

  it('reuses an existing waiting room when getOrCreateRoom is called', () => {
    const existingRoom = lobby.createRoom({ maxPlayers: 4 })
    lobby.joinRoom(ws1, existingRoom.id, 'p1', 'Alice')

    const reusedRoom = lobby.getOrCreateRoom('map_default', 'ffa')

    expect(reusedRoom.id).toBe(existingRoom.id)
    expect(reusedRoom.players.size).toBe(1)
  })

  it('prevents non-hosts from changing map settings or forcing start', () => {
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')
    lobby.joinRoom(ws2, room.id, 'p2', 'Bob')

    lobby.handleLobbyAction(ws2, 'LOBBY_MAP', { mapId: 'forest_arena' })
    lobby.handleLobbyAction(ws2, 'LOBBY_FORCE_START', {})

    expect(room.selectedMap).not.toBe('forest_arena')
    expect(room.status).toBe('waiting')
  })

  it('returns the correct room for a websocket and lists all open rooms', () => {
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice')

    expect(lobby.getRoomForWs(ws1)?.id).toBe(room.id)
    expect(lobby.listRooms().map((roomItem) => roomItem.id)).toContain(room.id)
  })

  it('falls back to archetype appearance when join payload has no appearance', () => {
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice', null, 'jungle-stalker')

    expect(room.players.get('p1')?.appearance).toEqual(cloneTropicalHorrorArchetypeAppearance('jungle-stalker'))
  })

  it('updates actor appearance when archetype changes in lobby', () => {
    const room = lobby.createRoom()
    lobby.joinRoom(ws1, room.id, 'p1', 'Alice', { bodyColor: 0x123456 }, 'obsidian-ravager')

    lobby.handleLobbyAction(ws1, 'LOBBY_ARCHETYPE', { archetypeId: 'tattered-shaman' })

    expect(room.players.get('p1')?.archetypeId).toBe('tattered-shaman')
    expect(room.players.get('p1')?.appearance).toEqual(cloneTropicalHorrorArchetypeAppearance('tattered-shaman'))
  })
})
