import { getMapCollisionLayout, hasMapCollisionLayout, getCollisionConfigMetadata } from '../../server/src/collision/MapCollisionData'

describe('MapCollisionData', () => {
  it('loads collision layout for known maps', () => {
    const layout = getMapCollisionLayout('map_default', 'session_123')

    expect(layout.mapId).toBe('map_default')
    expect(layout.sessionId).toBe('session_123')
    expect(layout.boxes).toBeDefined()
    expect(Array.isArray(layout.boxes)).toBe(true)
  })

  it('checks if map has collision data', () => {
    const hasDefault = hasMapCollisionLayout('map_default')
    const hasMissing = hasMapCollisionLayout('nonexistent_map_12345')

    expect(hasDefault).toBe(true)
    expect(hasMissing).toBe(false)
  })

  it('returns empty layout for unknown maps', () => {
    const layout = getMapCollisionLayout('unknown_map', 'session_test')

    expect(layout.mapId).toBe('unknown_map')
    expect(layout.boxes).toHaveLength(0)
  })

  it('provides collision config metadata', () => {
    const metadata = getCollisionConfigMetadata()

    expect(metadata.version).toBeGreaterThanOrEqual(1)
    expect(typeof metadata.checksum).toBe('string')
    expect(metadata.checksum.length).toBeGreaterThan(0)
  })

  it('collision boxes have required properties', () => {
    const layout = getMapCollisionLayout('map_default', 'session_123')

    if (layout.boxes.length > 0) {
      const box = layout.boxes[0]
      expect(box.id).toBeDefined()
      expect(box.position).toBeDefined()
      expect(box.halfExtents).toBeDefined()
      expect(box.position.x).toBeDefined()
      expect(box.position.y).toBeDefined()
      expect(box.position.z).toBeDefined()
    }
  })

  it('returns deterministic layout for same session', () => {
    const layout1 = getMapCollisionLayout('map_default', 'session_same')
    const layout2 = getMapCollisionLayout('map_default', 'session_same')

    expect(layout1.boxes.length).toBe(layout2.boxes.length)
    expect(layout1.sessionId).toBe(layout2.sessionId)
  })

  it('may return different layouts for different sessions', () => {
    const layout1 = getMapCollisionLayout('map_default', 'session_1')
    const layout2 = getMapCollisionLayout('map_default', 'session_2')

    expect(layout1.sessionId).toBe('session_1')
    expect(layout2.sessionId).toBe('session_2')
  })

  it('loads seeded forest arena collision boxes for the forest_arena map', () => {
    const layout = getMapCollisionLayout('forest_arena', 'session_forest')

    expect(layout.mapId).toBe('forest_arena')
    expect(layout.boxes.length).toBeGreaterThan(8)
    expect(hasMapCollisionLayout('forest_arena')).toBe(true)
  })
})
