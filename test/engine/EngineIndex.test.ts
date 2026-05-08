import * as engineIndex from '../../client/src/engine/index'

describe('engine public index', () => {
  it('exposes engine domain symbols through the main engine barrel', () => {
    expect(typeof engineIndex.HUDSystem).toBe('function')
    expect(typeof engineIndex.MenuIdentitySystem).toBe('function')
    expect(typeof engineIndex.MultiplayerClient).toBe('function')
    expect(typeof engineIndex.CollisionAuthoritySystem).toBe('function')
    expect(typeof engineIndex.StateManager).toBe('function')
  })
})
