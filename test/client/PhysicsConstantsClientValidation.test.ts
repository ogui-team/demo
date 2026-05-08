import { PHYSICS_CONSTANTS, validatePhysicsConstants } from '../../client/src/PhysicsConstants'

describe('Client PhysicsConstants validation', () => {
  const originalConstants = { ...PHYSICS_CONSTANTS } as Record<string, unknown>

  afterEach(() => {
    Object.assign(PHYSICS_CONSTANTS as any, originalConstants)
  })

  it('validates the current production constants successfully', () => {
    expect(() => validatePhysicsConstants()).not.toThrow()
  })

  it('throws when the jump impulse is invalid', () => {
    ;(PHYSICS_CONSTANTS as any).PLAYER_JUMP_IMPULSE = 0
    expect(() => validatePhysicsConstants()).toThrow(/PLAYER_JUMP_IMPULSE/)
  })

  it('throws when gravity is invalid', () => {
    ;(PHYSICS_CONSTANTS as any).PLAYER_GRAVITY = 0
    expect(() => validatePhysicsConstants()).toThrow(/PLAYER_GRAVITY/)
  })

  it('throws when move speed is invalid', () => {
    ;(PHYSICS_CONSTANTS as any).PLAYER_MOVE_SPEED = 1000
    expect(() => validatePhysicsConstants()).toThrow(/PLAYER_MOVE_SPEED/)
  })

  it('throws when air control factor is out of range', () => {
    ;(PHYSICS_CONSTANTS as any).PLAYER_AIR_CONTROL_FACTOR = -1
    expect(() => validatePhysicsConstants()).toThrow(/PLAYER_AIR_CONTROL_FACTOR/)
  })
})
