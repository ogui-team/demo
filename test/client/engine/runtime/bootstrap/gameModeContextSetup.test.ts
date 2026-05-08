import { describe, expect, it, vi } from 'vitest'
import { setupGameModeContext } from '@engine/runtime/bootstrap/gameModeContextSetup'

describe('GameModeContextSetup', () => {
  it('builds a game mode context with score and snapshot helpers', () => {
    const capturedContext: any = {}
    const engineGameModes = {
      setContext: vi.fn((ctx: any) => { capturedContext.ctx = ctx }),
      registerMode: vi.fn(),
    }

    const stateStore = new Map<string, unknown>()
    const stateManager = {
      get: vi.fn((key: string) => stateStore.get(key)),
      set: vi.fn((key: string, value: unknown) => stateStore.set(key, value)),
      update: vi.fn((updates: Record<string, unknown>) => {
        Object.entries(updates).forEach(([k, v]) => stateStore.set(k, v))
      }),
    }

    const worldRuntime = {
      getActiveRuntimePlayerId: vi.fn(() => 'player-1'),
      getLocalFreeplayPlayerId: vi.fn(() => 'player-1'),
      ensurePlayerRuntimeState: vi.fn(),
      syncLocalPlayerToAuthoritativeSpawn: vi.fn(),
      getLocalPlayerBootstrapCoordinator: vi.fn(() => ({ setLocalPlayerDead: vi.fn() })),
    }

    const healthSystem = {
      getHp: vi.fn(() => 80),
    }

    const spawnSystem = {
      findSpawnPosition: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
    }

    const playerModelSystem = {
      handleRespawn: vi.fn(),
    }

    const gameModeManager = {
      getPlayers: vi.fn(() => [{ id: 'player-1', name: 'Test', kills: 0, deaths: 0, health: 80 }]),
      getRound: vi.fn(() => ({ status: 'running', roundNumber: 1, winnerId: null })),
      getLifecycleState: vi.fn(() => 'PLAY_ACTIVE'),
    }

    setupGameModeContext({
      engineGameModes: engineGameModes as any,
      gameModeManager: gameModeManager as any,
      worldRuntime: worldRuntime as any,
      healthSystem: healthSystem as any,
      spawnSystem: spawnSystem as any,
      playerModelSystem: playerModelSystem as any,
      stateManager: stateManager as any,
    })

    expect(engineGameModes.setContext).toHaveBeenCalled()
    expect(engineGameModes.registerMode).toHaveBeenCalledTimes(4)
    expect(capturedContext.ctx).toBeDefined()

    const ctx = capturedContext.ctx
    const players = ctx.getPlayers()
    expect(players[0].id).toBe('player-1')

    ctx.addScore('player-1', 5)
    expect(stateManager.get('game.localScores.player-1')).toBe(5)

    ctx.setScore('player-1', 10)
    expect(stateManager.get('game.localScores.player-1')).toBe(10)

    ctx.broadcastEvent('test', { foo: 'bar' })
    expect(stateManager.get('game.modeRuntime.lastEvent')).toBeDefined()

    ctx.endMatch('player-1', 'win')
    expect(stateManager.get('game.modeRuntime.winnerId')).toBe('player-1')

    const snapshot = ctx.captureSnapshot()
    expect(snapshot.runtimePlayerId).toBe('player-1')

    const fakeCamera = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }
    ;(globalThis as any).window = { location: { search: '' } }
    expect(() => ctx.restoreSnapshot(snapshot)).not.toThrow()
  })
})
