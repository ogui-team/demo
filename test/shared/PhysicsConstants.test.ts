import { PHYSICS_CONSTANTS, validatePhysicsConstants } from '../../shared/PhysicsConstants'

describe('Shared PhysicsConstants', () => {
  it('exports the shared physics constants object and keeps values reasonable', () => {
    expect(PHYSICS_CONSTANTS.PLAYER_JUMP_IMPULSE).toBeGreaterThan(0)
    expect(PHYSICS_CONSTANTS.PLAYER_GRAVITY).toBeGreaterThan(0)
    expect(PHYSICS_CONSTANTS.PLAYER_MOVE_SPEED).toBeGreaterThan(0)
    expect(PHYSICS_CONSTANTS.PLAYER_AIR_CONTROL_FACTOR).toBeGreaterThanOrEqual(0)
    expect(PHYSICS_CONSTANTS.PLAYER_AIR_CONTROL_FACTOR).toBeLessThanOrEqual(1)
  })

  it('validates constants successfully when the shared values are good', () => {
    expect(() => validatePhysicsConstants()).not.toThrow()
  })

  it('rejects invalid jump impulse values', () => {
    const original = PHYSICS_CONSTANTS.PLAYER_JUMP_IMPULSE
    const constants = PHYSICS_CONSTANTS as any
    constants.PLAYER_JUMP_IMPULSE = 0

    expect(() => validatePhysicsConstants()).toThrow(/Invalid PLAYER_JUMP_IMPULSE/)

    constants.PLAYER_JUMP_IMPULSE = original
  })

  it('rejects invalid gravity values', () => {
    const original = PHYSICS_CONSTANTS.PLAYER_GRAVITY
    const constants = PHYSICS_CONSTANTS as any
    constants.PLAYER_GRAVITY = 0

    expect(() => validatePhysicsConstants()).toThrow(/Invalid PLAYER_GRAVITY/)

    constants.PLAYER_GRAVITY = original
  })

  it('rejects invalid move speed values', () => {
    const original = PHYSICS_CONSTANTS.PLAYER_MOVE_SPEED
    const constants = PHYSICS_CONSTANTS as any
    constants.PLAYER_MOVE_SPEED = 0

    expect(() => validatePhysicsConstants()).toThrow(/Invalid PLAYER_MOVE_SPEED/)

    constants.PLAYER_MOVE_SPEED = original
  })

  it('rejects invalid air control factor values', () => {
    const original = PHYSICS_CONSTANTS.PLAYER_AIR_CONTROL_FACTOR
    const constants = PHYSICS_CONSTANTS as any
    constants.PLAYER_AIR_CONTROL_FACTOR = -1

    expect(() => validatePhysicsConstants()).toThrow(/Invalid PLAYER_AIR_CONTROL_FACTOR/)

    constants.PLAYER_AIR_CONTROL_FACTOR = original
  })
})
