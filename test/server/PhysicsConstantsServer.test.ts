import { validatePhysicsConstants, PHYSICS_CONSTANTS } from '../../server/src/PhysicsConstants'

describe('PhysicsConstants Server', () => {
  it('provides player movement constants', () => {
    expect(PHYSICS_CONSTANTS.PLAYER_MOVE_SPEED).toBe(6)
    expect(PHYSICS_CONSTANTS.PLAYER_MOVE_ACCELERATION).toBe(28)
    expect(PHYSICS_CONSTANTS.PLAYER_GRAVITY).toBe(9.8)
  })

  it('provides player jump constants', () => {
    expect(PHYSICS_CONSTANTS.PLAYER_JUMP_IMPULSE).toBeGreaterThan(0)
    expect(PHYSICS_CONSTANTS.PLAYER_JUMP_BUFFER_SECONDS).toBeGreaterThan(0)
    expect(PHYSICS_CONSTANTS.PLAYER_COYOTE_TIME_SECONDS).toBeGreaterThan(0)
  })

  it('provides collision and physics properties', () => {
    expect(PHYSICS_CONSTANTS.PLAYER_COLLISION_RADIUS).toBeGreaterThan(0)
    expect(PHYSICS_CONSTANTS.PLAYER_EYE_HEIGHT).toBeGreaterThan(0)
    expect(PHYSICS_CONSTANTS.PLAYER_CROUCH_HALF_HEIGHT).toBeGreaterThan(0)
  })

  it('validates physics constants without throwing', () => {
    expect(() => validatePhysicsConstants()).not.toThrow()
  })

  it('has deterministic values across multiple reads', () => {
    const first = PHYSICS_CONSTANTS.PLAYER_JUMP_IMPULSE
    const second = PHYSICS_CONSTANTS.PLAYER_JUMP_IMPULSE

    expect(first).toBe(second)
  })

  it('provides air control factor between 0 and 1', () => {
    expect(PHYSICS_CONSTANTS.PLAYER_AIR_CONTROL_FACTOR).toBeGreaterThanOrEqual(0)
    expect(PHYSICS_CONSTANTS.PLAYER_AIR_CONTROL_FACTOR).toBeLessThanOrEqual(1)
  })

  it('has crouch speed multiplier less than 1', () => {
    expect(PHYSICS_CONSTANTS.PLAYER_CROUCH_SPEED_MULTIPLIER).toBeLessThan(1)
    expect(PHYSICS_CONSTANTS.PLAYER_CROUCH_SPEED_MULTIPLIER).toBeGreaterThan(0)
  })
})
