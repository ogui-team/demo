import * as runtime from '../../client/src/engine/core/ControlRuntime'

describe('ControlRuntime exports', () => {
  it('re-exports control runtime helpers', () => {
    expect(typeof runtime.setInputContext).toBe('function')
    expect(typeof runtime.disableSystem).toBe('function')
    expect(typeof runtime.markSystemError).toBe('function')
    expect(typeof runtime.markSystemUpdated).toBe('function')
    expect(typeof runtime.registerSystem).toBe('function')
    expect(typeof runtime.logEvent).toBe('function')
    expect(typeof runtime.gameBus).toBe('object')
  })
})
