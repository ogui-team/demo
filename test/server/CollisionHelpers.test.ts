import { CollisionHelpers } from '../../server/src/session/CollisionHelpers'

const createMockCollisionAuthority = (isValid: boolean) => ({
  isPositionValid: (_position: any, _radius: any, _arg3: any, _playerHalfHeight: any) => isValid,
})

describe('CollisionHelpers', () => {
  const playerId = 'player-1'
  const position = { x: 0, y: 0, z: 0 }
  const desiredMovement = { x: 1, y: 0, z: 0 }
  const radius = 0.5

  it('returns the full desired movement when the full destination is valid', () => {
    const collisionAuthority = createMockCollisionAuthority(true)
    const result = CollisionHelpers.resolveMovement(
      playerId,
      position,
      desiredMovement,
      radius,
      collisionAuthority as any,
    )

    expect(result).toEqual({ x: 1, y: 0, z: 0 })
  })

  it('falls back to the first valid axis-aligned candidate when full movement is invalid', () => {
    let calls = 0
    const collisionAuthority = {
      isPositionValid: () => {
        calls += 1
        return calls === 2
      },
    }

    const result = CollisionHelpers.resolveMovement(
      playerId,
      position,
      desiredMovement,
      radius,
      collisionAuthority as any,
    )

    expect(result).toEqual({ x: 1, y: 0, z: 0 })
    expect(calls).toBeGreaterThan(1)
  })

  it('returns the original position when no candidate is valid', () => {
    const collisionAuthority = createMockCollisionAuthority(false)
    const result = CollisionHelpers.resolveMovement(
      playerId,
      position,
      desiredMovement,
      radius,
      collisionAuthority as any,
    )

    expect(result).toEqual(position)
  })

  it('delegates validity checks to the collision authority', () => {
    const collisionAuthority = {
      isPositionValid: vi.fn().mockReturnValue(true),
    }

    const result = CollisionHelpers.isMovementPositionValid(
      playerId,
      position,
      radius,
      collisionAuthority as any,
    )

    expect(result).toBe(true)
    expect(collisionAuthority.isPositionValid).toHaveBeenCalledWith(position, radius, undefined, 0.9)
  })
})
