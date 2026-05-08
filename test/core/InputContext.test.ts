import { getContext, onContextChange, setContext } from '../../client/src/engine/core/InputContext'

describe('InputContext', () => {
  beforeEach(() => {
    setContext('editor')
  })

  it('returns the default context', () => {
    expect(getContext()).toBe('editor')
  })

  it('changes context and notifies listeners', () => {
    const callback = vi.fn()
    const off = onContextChange(callback)

    setContext('game')
    expect(getContext()).toBe('game')
    expect(callback).toHaveBeenCalledWith('game', 'editor')

    off()
    setContext('ui')
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does not call listeners when the context stays the same', () => {
    const callback = vi.fn()
    onContextChange(callback)

    setContext('editor')
    expect(callback).not.toHaveBeenCalled()
  })
})
