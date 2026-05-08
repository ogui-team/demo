import { analyzeGhostGeometry, createReplicableCollisionObjects } from '../../server/src/diagnostics/GhostGeometryDiagnostic'

describe('GhostGeometryDiagnostic', () => {
  const collisionLayout = {
    mapId: 'test-map',
    sessionId: 'session-1',
    bounds: null,
    boxes: [
      { id: 'box-1', position: { x: 1, y: 2, z: 3 }, halfExtents: { x: 1, y: 1, z: 1 } },
      { id: 'box-2', position: { x: 4, y: 5, z: 6 }, halfExtents: { x: 2, y: 2, z: 2 } },
    ],
  }

  it('produces a valid diagnostic when all boxes are replicated', () => {
    const diagnostic = analyzeGhostGeometry(collisionLayout, new Set(['box-1', 'box-2']), 'test-map', 'session-1')

    expect(diagnostic.isValid).toBe(true)
    expect(diagnostic.ghostColliderCount).toBe(0)
    expect(diagnostic.details).toContain('No issues detected')
  })

  it('detects ghost geometry and emits a console error when a box is missing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const diagnostic = analyzeGhostGeometry(collisionLayout, new Set(['box-1']), 'test-map', 'session-1')

    expect(diagnostic.isValid).toBe(false)
    expect(diagnostic.ghostColliderCount).toBe(1)
    expect(diagnostic.details).toContain('GHOST COLLIDER: Static collision box "box-2" exists on server but NOT in client snapshots')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('creates replicable collision objects with the expected metadata', () => {
    const objects = createReplicableCollisionObjects(collisionLayout.boxes)
    expect(objects).toHaveLength(2)
    expect(objects[0]).toEqual(expect.objectContaining({
      entityType: 'static_collider',
      networkEntityId: 'box-1',
      metadata: expect.objectContaining({ isStaticCollider: true }),
    }))
  })
})
