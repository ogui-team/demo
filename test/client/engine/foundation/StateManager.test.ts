import { describe, expect, it, vi } from 'vitest'
import { StateManager } from '../../../../client/src/engine/foundation/state/StateManager'
import { StateHydrationGuard, STATE_LOADING, hydrateStateManager } from '../../../../client/src/engine/foundation/state/hydrateStateManager'
import { createInitialEngineState } from '../../../../client/src/engine/foundation/state/engineInitialState'

describe('StateManager', () => {
  it('sets and gets nested values and avoids redundant writes', () => {
    const manager = new StateManager({})
    expect(manager.getRaw('camera.position.x')).toBeUndefined()

    expect(manager.set('camera.position.x', 5)).toBe(true)
    expect(manager.get('camera.position.x')).toBe(5)
    expect(manager.set('camera.position.x', 5)).toBe(false)
  })

  it('notifies subscriptions and update listeners', () => {
    const manager = new StateManager({})
    const pathCallback = vi.fn()
    const listener = vi.fn()

    const unsubscribe = manager.subscribe('player.health', pathCallback)
    const updateOff = manager.onUpdate(listener)

    expect(manager.set('player.health', 50)).toBe(true)
    expect(pathCallback).toHaveBeenCalledWith(50, undefined)
    expect(listener).toHaveBeenCalledWith({ 'player.health': 50 })

    unsubscribe()
    updateOff()

    expect(manager.set('player.health', 60)).toBe(true)
    expect(pathCallback).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('supports reset and snapshot with deep cloning', () => {
    const manager = new StateManager({ player: { health: 100 } })
    manager.set('player.health', 45)

    const snapshot = manager.snapshot()
    expect(snapshot.player.health).toBe(45)

    snapshot.player.health = 77
    expect(manager.get('player.health')).toBe(45)

    manager.reset({ game: { mode: 'editor' } })
    expect(manager.get('game.mode')).toBe('editor')
  })

  it('auto-hydrates known schema paths after hydration', () => {
    const manager = new StateManager({})
    manager.markHydrated()

    expect(manager.get('camera.fov')).toBe(75)
    expect(manager.getRaw('camera.fov')).toBe(75)
  })

  it('hydrates the state manager from schema defaults', () => {
    const manager = new StateManager({})
    hydrateStateManager(manager)

    expect(manager.isHydrated).toBe(true)
    expect(manager.get('camera.fov')).toBe(75)
    expect(manager.getRaw('camera.position.x')).toBe(0)
  })

  it('uses StateHydrationGuard to represent loading state before hydration', () => {
    const manager = new StateManager({})
    const guard = new StateHydrationGuard(manager)

    expect(guard.read('camera.position.x')).toBe(STATE_LOADING)
    expect(guard.isLoading('camera.position.x')).toBe(true)
  })
})

describe('Engine initial state', () => {
  it('creates a valid engine initial state record', () => {
    const state = createInitialEngineState({ fogDensity: 0.1, fogColor: 0x112233, ambientLightIntensity: 0.2, directionalLightIntensity: 0.6 })
    expect(state.mode).toBe('editor')
    expect(state.fog.density).toBe(0.1)
    expect(state.fog.color).toBe(0x112233)
    expect(state.lighting.ambientIntensity).toBe(0.2)
    expect(state.lighting.directionalIntensity).toBe(0.6)
    expect(state.lobby.localPlayer.appearance).toBeDefined()
  })
})
