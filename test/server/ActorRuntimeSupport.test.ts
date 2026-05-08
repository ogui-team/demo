import { describe, expect, it, vi } from 'vitest'
import {
  resolveActorMovement,
  isActorPositionUsable,
  findClosestActivePlayer,
  getDefaultActorSpawnPoint,
} from '../../server/src/actor/ActorRuntimeSupport'

describe('ActorRuntimeSupport', () => {
  it('resolves full movement when the target is unobstructed', () => {
    const upsertDynamicCollider = vi.fn()
    const removeDynamicCollider = vi.fn()

    const result = resolveActorMovement({
      actor: { objectId: 'actor-1', position: { x: 0, y: 0, z: 0 } } as any,
      desiredStep: { x: 1, y: 0, z: 1 },
      halfExtents: { x: 1, y: 1, z: 1 },
      collisionRadius: 1,
      isActorPositionUsable: () => true,
      removeDynamicCollider,
      upsertDynamicCollider,
    })

    expect(result).toEqual({ x: 1, y: 0, z: 1 })
    expect(removeDynamicCollider).toHaveBeenCalledWith('actor-1')
    expect(upsertDynamicCollider).toHaveBeenCalledWith('actor-1', { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 1 })
  })

  it('resolves partial movement when full movement is blocked', () => {
    const upsertDynamicCollider = vi.fn()
    const removeDynamicCollider = vi.fn()

    const result = resolveActorMovement({
      actor: { objectId: 'actor-2', position: { x: 0, y: 0, z: 0 } } as any,
      desiredStep: { x: 1, y: 0, z: 1 },
      halfExtents: { x: 1, y: 1, z: 1 },
      collisionRadius: 1,
      isActorPositionUsable: (position) => position.x !== 1 || position.z !== 1,
      removeDynamicCollider,
      upsertDynamicCollider,
    })

    expect(result).toEqual({ x: 1, y: 0, z: 0 })
    expect(upsertDynamicCollider).toHaveBeenCalledWith('actor-2', { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
  })

  it('rejects invalid positions and ignores dead players when checking actor usability', () => {
    const players = [
      { dead: false, position: { x: 1, y: 0, z: 0 } },
      { dead: true, position: { x: 0, y: 0, z: 0 } },
    ]

    const valid = isActorPositionUsable({ x: 0, y: 0, z: 0 }, 1, () => true, players, 1)
    expect(valid).toBe(false)

    const deadNearby = isActorPositionUsable({ x: 10, y: 0, z: 10 }, 1, () => true, players, 1)
    expect(deadNearby).toBe(true)
  })

  it('finds the closest active player among living players only', () => {
    const players = [
      { dead: false, position: { x: 5, y: 0, z: 0 }, id: 'near' },
      { dead: false, position: { x: 20, y: 0, z: 0 }, id: 'far' },
      { dead: true, position: { x: 1, y: 0, z: 0 }, id: 'dead' },
    ] as any

    const closest = findClosestActivePlayer(players, { x: 0, y: 0, z: 0 }, 10)
    expect(closest?.id).toBe('near')
  })

  it('selects a nearby valid spawn point when the primary spawn is blocked', () => {
    const spawnPoint = getDefaultActorSpawnPoint({
      spawnPoints: [{ x: 0, y: 1, z: 0 }],
      collisionRadius: 1,
      isActorPositionUsable: (position) => position.x !== 0 || position.z !== 0,
      fallbackSpawnPoint: () => ({ x: 10, y: 1, z: 10 }),
    })

    expect(spawnPoint).toEqual({ x: 2, y: 1, z: 0 })
  })
})
