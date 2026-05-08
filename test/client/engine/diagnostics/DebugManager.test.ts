import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DebugManager, initDebugManager, getDebugManager, destroyDebugManager } from '../../../../client/src/engine/diagnostics/debug/DebugManager'
import { gameBus, setContext } from '@engine/core/public-api'
import type { SystemContext } from '@engine/core/public-api'

vi.mock('../../../../client/src/engine/diagnostics/debug/DebugUI', () => {
  class MockDebugUI {
    show = vi.fn()
    hide = vi.fn()
    refresh = vi.fn()
    destroy = vi.fn()
    constructor(registry: unknown) {
      // accept registry for compatibility
    }
  }
  return { DebugUI: MockDebugUI }
})

vi.mock('@engine/core/public-api', () => ({
  gameBus: {
    emit: vi.fn(),
  },
  setContext: vi.fn(),
}))

describe('DebugManager', () => {
  const addListenerSpy = vi.spyOn(window, 'addEventListener')
  const removeListenerSpy = vi.spyOn(window, 'removeEventListener')

  beforeEach(() => {
    vi.clearAllMocks()
    addListenerSpy.mockClear()
    removeListenerSpy.mockClear()
    destroyDebugManager()
  })

  it('initializes disabled with default configuration and registers keyboard toggle', () => {
    const manager = new DebugManager()
    expect(manager.isEnabled()).toBe(false)
    expect(addListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    expect(manager.getDebugState()).toEqual(expect.objectContaining({
      active: false,
      metrics: expect.objectContaining({
        toggleKey: 'F1',
        keyToggleEnabled: true,
        groupCount: 0,
        parameterCount: 0,
      }),
    }))
  })

  it('can toggle from disabled to enabled and emits debug state updates', () => {
    const manager = new DebugManager({ enabled: false, toggleKey: 'F2' })
    manager.toggle()

    expect(manager.isEnabled()).toBe(true)
    expect(gameBus.emit).toHaveBeenCalledWith('stateMutation', expect.objectContaining({ source: 'debugManager' }))
    expect(setContext).toHaveBeenCalledWith('ui')
    expect(manager.getDebugState().metrics.toggleKey).toBe('F2')
  })

  it('respects play mode when disabling', () => {
    const manager = new DebugManager({ enabled: true })
    const ctx = { systems: { modeManager: { isPlayMode: () => true } } } as unknown as SystemContext
    manager.init(ctx)
    manager.disable()

    expect(manager.isEnabled()).toBe(false)
    expect(setContext).toHaveBeenCalledWith('game')
  })

  it('uses editor context when mode manager is absent or not play mode', () => {
    const manager = new DebugManager({ enabled: true })
    const ctx = { systems: { modeManager: { isPlayMode: () => false } } } as unknown as SystemContext
    manager.init(ctx)
    manager.disable()

    expect(setContext).toHaveBeenCalledWith('editor')
  })

  it('adds groups and parameters then refreshes the UI', () => {
    const manager = new DebugManager({ enabled: true })
    const registry = manager.getRegistry()
    manager.addGroup('test-group')
    manager.addParameter('test-group', {
      id: 'test',
      name: 'Test',
      type: 'checkbox',
      get: () => true,
    })

    expect(registry.getGroup('test-group')).toBeDefined()
    expect(registry.getGroup('test-group')?.parameters).toHaveLength(1)
  })

  it('destroys the manager and cleans up event listeners and UI', () => {
    const manager = new DebugManager({ enabled: true })
    const debugUI = (manager as any).debugUI
    manager.destroy()

    expect(removeListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    expect(debugUI.destroy).toHaveBeenCalled()
    expect(manager.getRegistry().getGroups()).toHaveLength(0)
  })

  it('supports singleton debug manager lifecycle', () => {
    const first = initDebugManager({ enabled: true })
    const second = initDebugManager({ enabled: true })

    expect(first).toBe(second)
    expect(getDebugManager()).toBe(first)

    destroyDebugManager()
    expect(getDebugManager()).toBeNull()
  })
})
