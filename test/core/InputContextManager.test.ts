import { InputContextManager } from '../../client/src/engine/core/InputContextManager'

describe('InputContextManager', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    if ('exitPointerLock' in document) {
      ;(document as any).exitPointerLock = vi.fn()
    }
  })

  it('switches active context and resolves waiting promises', async () => {
    const manager = new InputContextManager()
    const promise = manager.waitForContext('play')

    manager.setActiveContext('play')
    await expect(promise).resolves.toBeUndefined()
    expect(manager.getActiveContext()).toBe('play')
    expect(manager.getDiagnostics().activeContext).toBe('play')
  })

  it('does not request pointer lock when no active play context exists', () => {
    const manager = new InputContextManager()
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)

    expect(manager.requestPointerLock(canvas)).toBe(false)
    expect(manager.tryLock(canvas)).toBe(false)
  })

  it('tries to lock pointer when play context is active', () => {
    const manager = new InputContextManager()
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const requestLock = vi.fn()
    ;(canvas as any).requestPointerLock = requestLock

    manager.setActiveContext('play')
    expect(manager.tryLock(canvas)).toBe(true)
    expect(requestLock).toHaveBeenCalled()
  })

  it('cleans up pending wait promises with rejection', async () => {
    const manager = new InputContextManager()
    const promise = manager.waitForContext('ui')

    manager.cleanup()
    await expect(promise).rejects.toThrow('InputContextManager cleaned up')
    expect(manager.getDiagnostics().pendingContextWaits).toBe(0)
  })
})
