import {
  getMapCollisionLayout,
  hasMapCollisionLayout,
  getCollisionConfigMetadata,
} from '../../client/src/engine/network/MapCollisionData'

describe('MapCollisionData', () => {
  it('detects known and unknown map layouts correctly', () => {
    expect(hasMapCollisionLayout('map_default')).toBe(true)
    expect(hasMapCollisionLayout('forest_arena')).toBe(true)
    expect(hasMapCollisionLayout('missing_map')).toBe(false)
  })

  it('returns empty layout for unknown maps', () => {
    const layout = getMapCollisionLayout('missing_map', 'session-x')
    expect(layout.mapId).toBe('missing_map')
    expect(layout.sessionId).toBe('session-x')
    expect(layout.boxes).toEqual([])
    expect(layout.bounds).toBeNull()
  })

  it('generates seeded boxes for default arena and forest arena', () => {
    const defaultLayout = getMapCollisionLayout('map_default', 'seed-1')
    expect(defaultLayout.mapId).toBe('map_default')
    expect(defaultLayout.boxes.length).toBeGreaterThan(0)

    const forestLayout = getMapCollisionLayout('forest_arena', 'seed-2')
    expect(forestLayout.mapId).toBe('forest_arena')
    expect(forestLayout.boxes.length).toBeGreaterThan(0)
    expect(defaultLayout.boxes).not.toEqual(forestLayout.boxes)
  })

  it('returns collision metadata checksum and version', () => {
    const meta = getCollisionConfigMetadata()
    expect(meta.version).toBeGreaterThan(0)
    expect(meta.checksum).toMatch(/^[0-9a-f]{8}$/)
  })
})
