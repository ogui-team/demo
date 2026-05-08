import { InputManager } from '../../client/src/engine/core/InputManager'
import { InputRouter } from '../../client/src/engine/core/InputRouter'

class FakeRouter implements InputRouter {
  handleKeyDown = vi.fn(() => true)
  handleKeyUp = vi.fn(() => true)
  handlePointerDown = vi.fn(() => true)
  handlePointerMove = vi.fn(() => true)
  handlePointerUp = vi.fn(() => true)
  handleDoubleClick = vi.fn(() => true)
  handleWheel = vi.fn(() => true)
  handlePointerLockChange = vi.fn()
}

describe('InputManager', () => {
  let router: any
  let manager: InputManager

  beforeEach(() => {
    document.body.innerHTML = ''
    router = new FakeRouter()
    manager = new InputManager(router)
  })

  it('enables and disables correctly and emits diagnostics', () => {
    manager.enable()
    expect(manager.getDiagnostics().active).toBe(true)

    manager.disable()
    expect(manager.getDiagnostics().active).toBe(false)
  })

  it('dispatches events through the router when enabled', () => {
    manager.enable()
    const keydown = new KeyboardEvent('keydown')
    window.dispatchEvent(keydown)
    expect(router.handleKeyDown).toHaveBeenCalled()

    const mouseDown = new MouseEvent('mousedown', { bubbles: true })
    window.dispatchEvent(mouseDown)
    expect(router.handlePointerDown).toHaveBeenCalled()

    manager.dispose()
    expect(manager.getDiagnostics().active).toBe(false)
  })

  it('rebinds safely after disable without duplicating listeners', () => {
    manager.enable()
    manager.disable()
    manager.enable()

    window.dispatchEvent(new KeyboardEvent('keydown'))
    expect(router.handleKeyDown).toHaveBeenCalledTimes(1)

    manager.dispose()
    manager.enable()
    window.dispatchEvent(new KeyboardEvent('keydown'))
    expect(router.handleKeyDown).toHaveBeenCalledTimes(1)
  })
})
