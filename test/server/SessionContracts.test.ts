import { getDefaultSpawnPointsForMap } from '../../server/src/sessionContracts'

describe('Server SessionContracts', () => {
  it('returns default and arena spawn points correctly', () => {
    const defaultPoints = getDefaultSpawnPointsForMap('unknown_map')
    expect(defaultPoints).toHaveLength(8)
    expect(defaultPoints[0]).toEqual({ x: 0, y: 1, z: 0 })

    const forestPoints = getDefaultSpawnPointsForMap('forest_arena')
    expect(forestPoints).toHaveLength(8)
    expect(forestPoints).not.toEqual(defaultPoints)

    const arenaPoints = getDefaultSpawnPointsForMap('map_default')
    expect(arenaPoints).toHaveLength(8)
    expect(arenaPoints).not.toEqual(forestPoints)
  })
})
