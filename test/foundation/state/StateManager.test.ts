
const mocks = vi.hoisted(() => ({
  gameBusEmit: vi.fn(),
}))
vi.mock('@engine/core/public-api', () => ({
  gameBus: {
    emit: mocks.gameBusEmit,
  },
}))

import { StateManager } from '../../../client/src/engine/foundation/state/StateManager'

describe('StateManager', () => {
  beforeEach(() => {
    mocks.gameBusEmit.mockClear()
  })

  it('returns stored nested values and emits stateMutation when set', () => {
    const stateManager = new StateManager({ foo: { bar: 1 } })
    const listener = vi.fn()

    stateManager.onUpdate(listener)
    expect(stateManager.get('foo.bar')).toBe(1)

    const changed = stateManager.set('foo.bar', 2)
    expect(changed).toBe(true)
    expect(stateManager.get('foo.bar')).toBe(2)
    expect(listener).toHaveBeenCalledWith({ 'foo.bar': 2 })
    expect(mocks.gameBusEmit).toHaveBeenCalledWith('stateMutation', expect.objectContaining({ source: 'StateManager.set', paths: ['foo.bar'] }))
  })

  it('returns false when setting an identical value and does not emit stateMutation', () => {
    const stateManager = new StateManager({ foo: { bar: 3 } })
    mocks.gameBusEmit.mockClear()

    const changed = stateManager.set('foo.bar', 3)
    expect(changed).toBe(false)
    expect(mocks.gameBusEmit).not.toHaveBeenCalledWith('stateMutation', expect.anything())
  })

  it('notifies subscribers for parent paths when nested values change', () => {
    const stateManager = new StateManager({ camera: { position: { x: 1 } } })
    const parentListener = vi.fn()
    const childListener = vi.fn()

    stateManager.subscribe('camera.position', parentListener)
    stateManager.subscribe('camera.position.x', childListener)

    stateManager.set('camera.position.x', 5)
    expect(parentListener).toHaveBeenCalled()
    expect(childListener).toHaveBeenCalledWith(5, 1)
  })

  it('updates multiple paths and returns a result map', () => {
    const stateManager = new StateManager({ hud: { visible: false } })
    const listener = vi.fn()

    stateManager.onUpdate(listener)
    const result = stateManager.update({ 'hud.visible': true, 'new.path': 42 })

    expect(result).toEqual({ 'hud.visible': true, 'new.path': true })
    expect(listener).toHaveBeenLastCalledWith({ 'hud.visible': true, 'new.path': 42 })
    expect(stateManager.get('hud.visible')).toBe(true)
    expect(stateManager.get('new.path')).toBe(42)
  })

  it('resets state and returns a clean snapshot copy', () => {
    const stateManager = new StateManager({ foo: { bar: 1 } })
    stateManager.reset({ foo: { bar: 100 } })

    expect(stateManager.snapshot()).toEqual({ foo: { bar: 100 } })
    expect(stateManager.get('foo.bar')).toBe(100)
  })

  it('returns undefined for missing paths and emits a missing-state warning', () => {
    const stateManager = new StateManager({})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = stateManager.get('missing.path')
    expect(result).toBeUndefined()
    expect(mocks.gameBusEmit).toHaveBeenCalledWith('LOG_STATE_MISSING_WARNING', expect.objectContaining({ path: 'missing.path' }))

    warnSpy.mockRestore()
  })

  it('returns raw values without emitting stateMutation', () => {
    const stateManager = new StateManager({ foo: { bar: 1 } })

    expect(stateManager.getRaw('foo.bar')).toBe(1)
    expect(mocks.gameBusEmit).not.toHaveBeenCalled()
  })

  it('supports subscribe/unsubscribe for specific paths', () => {
    const stateManager = new StateManager({ foo: { bar: 1 } })
    const callback = vi.fn()

    const unsubscribe = stateManager.subscribe('foo.bar', callback)
    stateManager.set('foo.bar', 2)
    expect(callback).toHaveBeenCalledWith(2, 1)

    unsubscribe()
    stateManager.set('foo.bar', 3)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does not emit stateMutation while hydrating', () => {
    const stateManager = new StateManager({ foo: { bar: 1 } })
    stateManager.beginHydration()
    const changed = stateManager.set('foo.bar', 2)

    expect(changed).toBe(true)
    expect(mocks.gameBusEmit).not.toHaveBeenCalledWith('stateMutation', expect.anything())
    stateManager.endHydration()
  })

  it('exposes system context capabilities and debug state metrics', () => {
    const stateManager = new StateManager({})
    stateManager.setSystemContext({} as any)

    expect(stateManager.getCapabilities().usesSystemContext).toBe(true)
    expect(stateManager.getDebugState().metrics.hasSystemContext).toBe(true)
  })

  it('gets subtree state with getState and returns a read-only snapshot', () => {
    const stateManager = new StateManager({ foo: { bar: 1, baz: 2 } })
    const subtree = stateManager.getState('foo') as Record<string, unknown>

    expect(subtree).toEqual({ bar: 1, baz: 2 })
    expect(Object.isFrozen(subtree)).toBe(true)
    expect(stateManager.get('foo.bar')).toBe(1)
  })

  it('resets state and emits a reset stateMutation event', () => {
    const stateManager = new StateManager({ foo: { bar: 1 } })
    stateManager.reset({ foo: { bar: 100 } })

    expect(stateManager.snapshot()).toEqual({ foo: { bar: 100 } })
    expect(mocks.gameBusEmit).toHaveBeenCalledWith('stateMutation', expect.objectContaining({ source: 'StateManager.reset' }))
  })

  it('removes nested state paths cleanly', () => {
    const stateManager = new StateManager({ entities: { e1: { position: { x: 1, y: 2, z: 3 } } } })

    const changed = stateManager.remove('entities.e1')

    expect(changed).toBe(true)
    expect(stateManager.getRaw('entities.e1')).toBeUndefined()
  })
})
