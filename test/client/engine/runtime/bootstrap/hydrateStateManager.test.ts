import { describe, expect, it, vi } from 'vitest'
import { hydrateStateManager, setRuntimePlayerIdInState } from '../../../../../client/src/engine/runtime/bootstrap/hydrateStateManager'

describe('hydrateStateManager', () => {
  it('hydrates default state keys in the state manager', () => {
    const stateManager = {
      values: new Map<string, unknown>(),
      set: vi.fn(function (this: any, key: string, value: unknown) {
        this.values.set(key, value)
      }),
      getRaw: vi.fn(() => null),
    }

    hydrateStateManager(stateManager)

    expect(stateManager.set).toHaveBeenCalledWith('game.mode', 'freeplay')
    expect(stateManager.set).toHaveBeenCalledWith('players.local.health', 100)
    expect(stateManager.set).toHaveBeenCalledWith('hud.visible', true)
    expect(stateManager.values.get('multiplayer.isConnected')).toBe(false)
  })

  it('updates runtime player id and local player id when setRuntimePlayerIdInState is called', () => {
    const stateManager = {
      values: new Map<string, unknown>([['multiplayer.playerId', null]]),
      set: vi.fn(function (this: any, key: string, value: unknown) {
        this.values.set(key, value)
      }),
      getRaw: vi.fn(function (this: any, key: string) {
        return this.values.get(key)
      }),
    }

    setRuntimePlayerIdInState(stateManager, 'player1')
    expect(stateManager.set).toHaveBeenCalledWith('multiplayer.playerId', 'player1')
    expect(stateManager.set).toHaveBeenCalledWith('players.local.id', 'player1')

    stateManager.values.set('multiplayer.playerId', 'player1')
    stateManager.set.mockClear()
    setRuntimePlayerIdInState(stateManager, 'player1')
    expect(stateManager.set).not.toHaveBeenCalled()

    setRuntimePlayerIdInState(stateManager, null)
    expect(stateManager.set).toHaveBeenCalledWith('multiplayer.playerId', null)
    expect(stateManager.set).toHaveBeenCalledWith('players.local.id', null)
  })
})
