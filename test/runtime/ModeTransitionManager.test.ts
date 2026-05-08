import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../client/src/engine/diagnostics/FailFastGuards', () => {
  const recordModeTransition = vi.fn()
  const recordFrameMetrics = vi.fn(() => 'PASS')

  return {
    getFailFastGuards: () => ({
      recordModeTransition,
      recordFrameMetrics,
    }),
    getCurrentHeapMB: () => 42,
  }
})

vi.mock('../../client/src/engine/foundation/Engine', () => {
  const disable = vi.fn()
  const inputDispose = vi.fn()
  const systemDispose = vi.fn()
  const disconnect = vi.fn(async () => undefined)

  return {
    getInputManager: () => ({ disable, dispose: inputDispose }),
    getNetworkSyncSystem: () => ({ disconnect }),
    getReplicationSystem: () => ({ dispose: systemDispose }),
    getCullingSystem: () => ({ dispose: systemDispose }),
    getKernel: () => ({ clear: vi.fn() }),
  }
})

import { ModeTransitionManager } from '../../client/src/engine/runtime/ModeTransitionManager'

describe('ModeTransitionManager', () => {
  let manager: ModeTransitionManager
  let fakeDocument: any

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new ModeTransitionManager()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    document.body.innerHTML = ''

    const createElement = (id: string) => {
      const element = document.createElement('div')
      element.id = id
      element.innerHTML = '<span>content</span>'
      element.style.display = 'block'
      return element
    }

    ['gameplay-hud', 'game-ui', 'player-stats', 'enemy-markers', 'inventory-ui'].forEach((id) => {
      document.body.appendChild(createElement(id))
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('transitions mode successfully and returns memory metrics', async () => {
    console.log('document exists', typeof document !== 'undefined')
    console.log('body exists', document?.body !== undefined)
    console.log('hud before', document.getElementById('gameplay-hud'))

    const transitionPromise = manager.transitionMode({
      sourceMode: 'editor',
      targetMode: 'freeplay',
      onCleanupStart: vi.fn(),
      onCleanupEnd: vi.fn(),
      onInitStart: vi.fn(),
      onInitEnd: vi.fn(),
    })

    await vi.runAllTimersAsync()

    const metrics = await transitionPromise
    expect(metrics).toEqual(
      expect.objectContaining({
        beforeCleanup: 0,
        afterCleanup: 0,
        freed: 0,
        duration: expect.any(Number),
      })
    )
    expect(manager.getCurrentMode()).toBe('freeplay')
    expect(manager.isInProgress()).toBe(false)

    const hud = document.getElementById('gameplay-hud')
    expect(hud?.innerHTML).toBe('')
    expect(hud?.style.display).toBe('none')
  })

  it('rejects when a transition is already in progress', async () => {
    const firstTransition = manager.transitionMode({
      sourceMode: null,
      targetMode: 'editor',
    })

    await expect(
      manager.transitionMode({ sourceMode: 'editor', targetMode: 'multiplayer' })
    ).rejects.toThrow('Transition already in progress')

    await vi.advanceTimersByTimeAsync(50)
    await firstTransition
  })

  it('records transition history and reports statistics', async () => {
    const transitionPromise = manager.transitionMode({ sourceMode: null, targetMode: 'multiplayer' })
    await vi.runAllTimersAsync()
    await transitionPromise

    const stats = manager.getStats()
    expect(stats.totalTransitions).toBe(1)
    expect(stats.averageDuration).toBeGreaterThanOrEqual(0)
    expect(stats.lastTransition).toContain('none → multiplayer')

    const history = manager.getHistory()
    expect(history).toHaveLength(1)
    expect(history[0]).toEqual(
      expect.objectContaining({ from: 'none', to: 'multiplayer' })
    )
  })

  it('disables input during cleanup without permanently disposing it', async () => {
    const Engine = await import('../../client/src/engine/foundation/Engine')
    const inputManager = Engine.getInputManager() as { disable: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }

    const transitionPromise = manager.transitionMode({
      sourceMode: 'editor',
      targetMode: 'freeplay',
    })

    await vi.runAllTimersAsync()
    await transitionPromise

    expect(inputManager.disable).toHaveBeenCalled()
    expect(inputManager.dispose).not.toHaveBeenCalled()
  })
})
