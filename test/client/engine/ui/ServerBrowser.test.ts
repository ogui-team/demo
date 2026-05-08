import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { ServerBrowser } from '../../../../client/src/engine/ui/ServerBrowser'
import type { ServerInfo, LobbyState } from '../../../../client/src/engine/network/MultiplayerClient'

describe('ServerBrowser', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
  })

  class FakeServerBrowserClient {
    playerId = 'player1'
    private listeners = new Map<string, Set<Function>>()
    lastLobbyState: LobbyState | null = null
    lastJoin?: { wsUrl: string; playerName: string; roomId?: string }
    lastHost?: { wsUrl: string; playerName: string; config: unknown }
    lastReady?: boolean
    lastAction?: { action: string; data: unknown }
    disconnected = false

    on(event: string, callback: Function): void {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set())
      this.listeners.get(event)?.add(callback)
    }

    emit(event: string, data: unknown): void {
      this.listeners.get(event)?.forEach((callback) => callback(data))
    }

    getLastLobbyState(): LobbyState | null {
      return this.lastLobbyState
    }

    async fetchServers(): Promise<ServerInfo[]> {
      return [
        {
          id: 'server1',
          name: 'Test Server',
          map: 'forest_arena',
          mode: 'ffa',
          players: 1,
          maxPlayers: 8,
          status: 'waiting',
          killLimit: 10,
          roundDurationSec: 180,
          ping: 45,
        },
      ]
    }

    joinRoom(wsUrl: string, playerName: string, roomId?: string): void {
      this.lastJoin = { wsUrl, playerName, roomId }
    }

    hostRoom(wsUrl: string, playerName: string, config: unknown): void {
      this.lastHost = { wsUrl, playerName, config }
    }

    setReady(ready: boolean): void {
      this.lastReady = ready
    }

    sendLobbyAction(action: string, data: unknown): void {
      this.lastAction = { action, data }
    }

    disconnect(): void {
      this.disconnected = true
    }
  }

  it('renders server list and handles refresh without network fetch', async () => {
    const fakeClient = new FakeServerBrowserClient()
    const browser = new ServerBrowser(
      {
        httpUrl: 'http://localhost:8080',
        wsUrl: 'ws://localhost:8080',
      },
      fakeClient as any,
    )

    await browser.reopenToServerList('Disconnected', false)
    expect(document.body.textContent).toContain('SERVER BROWSER')
    expect(document.body.textContent).toContain('Disconnected')

    ;(browser as any).servers = await fakeClient.fetchServers()
    ;(browser as any)._renderServerList()

    expect(document.body.textContent).toContain('Test Server')
    expect(document.body.textContent).toContain('JOIN')

    ;(browser as any)._handleAction('join')
    expect(fakeClient.lastJoin?.wsUrl).toBe('ws://localhost:8080')
    expect(fakeClient.lastJoin?.roomId).toBe('server1')

    browser.destroy()
    expect(document.body.contains((browser as any).root)).toBe(false)
  })

  it('updates lobby view when the client emits connected and lobby_update events', () => {
    const fakeClient = new FakeServerBrowserClient()
    const browser = new ServerBrowser(
      {
        httpUrl: 'http://localhost:8080',
        wsUrl: 'ws://localhost:8080',
      },
      fakeClient as any,
    )

    fakeClient.emit('connected', { playerId: 'player1', roomId: 'room1', hosted: false })
    expect(document.body.textContent).toContain('Connected to room1 as player1')
    expect(document.body.textContent).toContain('LOBBY')

    fakeClient.emit('lobby_update', {
      players: [{ id: 'player1', name: 'Alice', ping: 22, ready: true, isHost: true }],
      selectedMap: 'forest_arena',
      selectedMode: 'ffa',
      status: 'waiting',
      countdown: 0,
      maxPlayers: 1,
    } as LobbyState)

    expect(document.body.textContent).toContain('READY')
    browser.destroy()
  })
})
