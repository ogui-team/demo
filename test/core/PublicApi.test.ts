import * as coreApi from '../../client/src/engine/core/public-api'

describe('core public api', () => {
  it('exports core engine public API symbols', () => {
    expect(typeof coreApi.Entity).toBe('function')
    expect(typeof coreApi.EntityManager).toBe('function')
    expect(typeof coreApi.gameBus).toBe('object')
    expect(typeof coreApi.SceneGraph).toBe('function')
    expect(typeof coreApi.ObjectPool).toBe('function')
  })
})
