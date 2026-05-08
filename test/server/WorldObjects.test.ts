import {
  createWorldObjectFromRequest,
  getWorldObjectHalfExtents,
  nextWorldObjectId,
} from '../../server/src/world/WorldObjects'

describe('WorldObjects', () => {
  const readFiniteNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

  it('computes half extents for default box geometry', () => {
    const worldObject = {
      id: 'obj-1',
      entityType: 'box',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      renderData: { meshType: 'box', color: 0xffffff, geometry: { width: 4, height: 2, depth: 6 } },
    } as any

    expect(getWorldObjectHalfExtents(worldObject, readFiniteNumber)).toEqual({ x: 2, y: 1, z: 3 })
  })

  it('computes sphere half extents using radius values', () => {
    const worldObject = {
      id: 'obj-2',
      entityType: 'sphere',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      renderData: { meshType: 'sphere', color: 0xffffff, geometry: { radius: 5 } },
    } as any

    expect(getWorldObjectHalfExtents(worldObject, readFiniteNumber)).toEqual({ x: 5, y: 5, z: 5 })
  })

  it('creates a world object from valid request data', () => {
    const object = createWorldObjectFromRequest(
      {
        entityType: 'tree',
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 90, z: 0 },
        renderData: { meshType: 'box', color: 123, geometry: { width: 2, height: 4, depth: 2 } },
      },
      'actor-1',
      (actorId) => `world_object_${actorId}_1`,
      readFiniteNumber,
    )

    expect(object).toEqual({
      id: 'world_object_actor-1_1',
      entityType: 'tree',
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 90, z: 0 },
      renderData: { meshType: 'box', color: 123, geometry: { width: 2, height: 4, depth: 2 } },
    })
  })

  it('returns null for invalid createWorldObjectFromRequest data', () => {
    expect(createWorldObjectFromRequest({ renderData: { meshType: 'box' } }, 'actor-1', () => 'id', readFiniteNumber)).toBeNull()
  })

  it('builds a deterministic world object id', () => {
    expect(nextWorldObjectId('session', 5, 'actor')).toBe('world_object_session_actor_5')
  })
})
