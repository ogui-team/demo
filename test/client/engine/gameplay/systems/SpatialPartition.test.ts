import { describe, expect, it } from 'vitest'
import { SpatialPartitionSystem } from '@engine/gameplay/systems/SpatialPartitionSystem'

describe('SpatialPartitionSystem', () => {
  it('returns only nearby entities within the radius and executes the query within 2ms for 5000 entities', () => {
    const partition = new SpatialPartitionSystem(8)

    for (let index = 0; index < 4995; index += 1) {
      partition.updateEntry(`far_${index}`, {
        x: 1000 + (index % 100) * 12,
        y: 0,
        z: 1000 + Math.floor(index / 100) * 12,
      }, {
        tags: ['prop'],
      })
    }

    const nearIds = ['near_0', 'near_1', 'near_2', 'near_3', 'near_4']
    const nearPositions = [
      { x: 1, y: 0, z: 1 },
      { x: 3, y: 0, z: 2 },
      { x: -2, y: 0, z: 1 },
      { x: 2, y: 0, z: -3 },
      { x: -1, y: 0, z: -2 },
    ]

    nearPositions.forEach((position, index) => {
      partition.updateEntry(nearIds[index], position, {
        tags: ['prop'],
      })
    })

    partition.updateEntry('player_1', { x: 0, y: 0, z: 0 }, {
      tags: ['player'],
    })

    const start = performance.now()
    const results = partition.getEntitiesInRadius({ x: 0, y: 0, z: 0 }, 5, {
      tags: ['prop'],
    })
    const durationMs = performance.now() - start

    expect(results.map((entry) => entry.id).sort()).toEqual(nearIds)
    expect(durationMs).toBeLessThan(2)
  })
})