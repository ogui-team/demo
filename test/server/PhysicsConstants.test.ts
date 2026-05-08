import { PHYSICS_CONSTANTS, validatePhysicsConstants } from '../../server/src/PhysicsConstants'

describe('Server PhysicsConstants', () => {
  it('exports a stable constants object and validates it successfully', () => {
    expect(PHYSICS_CONSTANTS.PLAYER_MOVE_SPEED).toBeGreaterThan(0)
    expect(() => validatePhysicsConstants()).not.toThrow()
  })

  it('throws when gravity or speed constants are invalid', () => {
    const original = { ...PHYSICS_CONSTANTS }
    try {
      ;(PHYSICS_CONSTANTS as any).PLAYER_GRAVITY = 0
      expect(() => validatePhysicsConstants()).toThrow(/PLAYER_GRAVITY/)

      ;(PHYSICS_CONSTANTS as any).PLAYER_GRAVITY = original.PLAYER_GRAVITY
      ;(PHYSICS_CONSTANTS as any).PLAYER_MOVE_SPEED = 0
      expect(() => validatePhysicsConstants()).toThrow(/PLAYER_MOVE_SPEED/)
    } finally {
      Object.assign(PHYSICS_CONSTANTS as any, original)
    }
  })
})
