import { InputRouter } from '../../client/src/engine/core/InputRouter'
import { setContext } from '../../client/src/engine/core/InputContext'

describe('InputRouter', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setContext('editor')
  })

  it('uses the editor controller for key and pointer events', () => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)

    const editorController = {
      handleKeyDown: vi.fn(() => true),
      handlePointerDown: vi.fn(() => true),
      handlePointerMove: vi.fn(() => true),
      handlePointerUp: vi.fn(() => true),
      handleDoubleClick: vi.fn(() => true),
      handleWheel: vi.fn(() => true),
    }

    const router = new InputRouter({
      canvas,
      editorController,
      enableDebugOverlay: false,
    })

    expect(router.getCurrentContext()).toBe('editor')
    expect(router.handleKeyDown(new KeyboardEvent('keydown'))).toBe(true)
    expect(editorController.handleKeyDown).toHaveBeenCalled()

    const mouseEvent = new MouseEvent('mousedown', { button: 0, bubbles: true })
    expect(router.handlePointerDown(mouseEvent)).toBe(true)
    expect(editorController.handlePointerDown).toHaveBeenCalled()
  })

  it('updates current context when global context changes', () => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const router = new InputRouter({ canvas, enableDebugOverlay: false })

    setContext('ui')
    expect(router.getCurrentContext()).toBe('ui')
    expect(router.getActiveRaycastLayers()).toEqual(expect.any(Array))
  })
})
