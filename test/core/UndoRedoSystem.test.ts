import { UndoRedoSystem } from '../../client/src/engine/core/UndoRedoSystem'

describe('UndoRedoSystem', () => {
  it('executes, undoes, and redoes actions with snapshot notifications', () => {
    const system = new UndoRedoSystem(3)
    const trace: string[] = []
    const listener = vi.fn((snapshot) => trace.push(`snapshot:${snapshot.undoDepth}:${snapshot.redoDepth}`))
    const off = system.onChange(listener)

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ undoDepth: 0, redoDepth: 0 }))

    const action = {
      label: 'change-color',
      undo: vi.fn(() => trace.push('undo')),
      redo: vi.fn(() => trace.push('redo')),
    }

    system.execute(action)
    expect(action.redo).toHaveBeenCalled()
    expect(system.snapshot().undoDepth).toBe(1)
    expect(system.undo()).toBe(true)
    expect(action.undo).toHaveBeenCalled()
    expect(system.redo()).toBe(true)
    expect(action.redo).toHaveBeenCalledTimes(2)

    system.clear()
    expect(system.snapshot().undoDepth).toBe(0)
    off()
  })

  it('pushCompletedAction respects max depth and drops old actions', () => {
    const system = new UndoRedoSystem(2)
    const actionA = { label: 'a', undo: vi.fn(), redo: vi.fn() }
    const actionB = { label: 'b', undo: vi.fn(), redo: vi.fn() }
    const actionC = { label: 'c', undo: vi.fn(), redo: vi.fn() }

    system.pushCompletedAction(actionA)
    system.pushCompletedAction(actionB)
    system.pushCompletedAction(actionC)

    expect(system.snapshot().undoDepth).toBe(3)
    expect(system.snapshot().nextUndoLabel).toBe('c')
  })
})
