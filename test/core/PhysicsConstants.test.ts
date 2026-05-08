import { PHYSICS_CONSTANTS as sharedConstants, validatePhysicsConstants as validateSharedPhysicsConstants } from '../../shared/PhysicsConstants'
import { PHYSICS_CONSTANTS as clientConstants, validatePhysicsConstants as validateClientPhysicsConstants } from '../../client/src/PhysicsConstants'
import { PHYSICS_CONSTANTS as serverConstants, validatePhysicsConstants as validateServerPhysicsConstants } from '../../server/src/PhysicsConstants'

describe('PhysicsConstants', () => {
  it('exposes the expected shared physics keys', () => {
    expect(sharedConstants.PLAYER_MOVE_SPEED).toBe(6)
    expect(sharedConstants.PLAYER_GRAVITY).toBe(9.8)
    expect(sharedConstants.CLIENT_CORRECTION_THRESHOLD).toBe(0.05)
  })

  it('validates successfully for the current shared constants', () => {
    expect(() => validateSharedPhysicsConstants()).not.toThrow()
  })

  it('validates client and server copies and keeps keys in sync', () => {
    expect(Object.keys(clientConstants).sort()).toEqual(Object.keys(serverConstants).sort())
    expect(() => validateClientPhysicsConstants()).not.toThrow()
    expect(() => validateServerPhysicsConstants()).not.toThrow()
  })
})

