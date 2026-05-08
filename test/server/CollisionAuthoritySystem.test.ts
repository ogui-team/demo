import { CollisionAuthoritySystem } from '../../server/src/collision/CollisionAuthoritySystem'

describe('CollisionAuthoritySystem', () => {
  it('provides handshake metadata and static layout info', () => {
    const system = new CollisionAuthoritySystem('map_default', 'session-1')
    const handshake = system.getHandshake()

    expect(handshake.version).toBeGreaterThanOrEqual(1)
    expect(typeof handshake.checksum).toBe('string')
    expect(handshake.checksum.length).toBeGreaterThan(0)
    expect(system.hasDeterministicStaticLayout()).toBe(true)
    expect(system.getBounds()).toMatchObject({ halfWidth: expect.any(Number), halfDepth: expect.any(Number) })
  })

  it('upserts and removes dynamic colliders while emitting change events', () => {
    const system = new CollisionAuthoritySystem('map_default', 'session-2')
    const events: Array<{ action: string; id?: string }> = []
    const unsubscribe = system.onChanged((payload) => events.push(payload))

    system.upsertDynamicCollider('dyn-1', { x: 10, y: 0, z: 10 }, { x: 1, y: 1, z: 1 })
    expect(system.getDiagnostics().metrics.dynamicColliderCount).toBe(1)
    expect(system.getDiagnostics().metrics.mutationCount).toBe(1)
    expect(events).toEqual([{ action: 'upsert', id: 'dyn-1' }])

    system.removeDynamicCollider('dyn-1')
    expect(system.getDiagnostics().metrics.dynamicColliderCount).toBe(0)
    expect(system.getDiagnostics().metrics.mutationCount).toBe(2)
    expect(events).toContainEqual({ action: 'remove', id: 'dyn-1' })

    system.clearDynamicColliders()
    expect(system.getDiagnostics().metrics.dynamicColliderCount).toBe(0)
    expect(system.getDiagnostics().metrics.mutationCount).toBe(3)
    expect(events).toContainEqual({ action: 'clear' })

    unsubscribe()
  })

  it('captures collision history frames and clones dynamic boxes', () => {
    const system = new CollisionAuthoritySystem('map_default', 'session-3')
    system.upsertDynamicCollider('dyn-2', { x: 5, y: 0, z: 5 }, { x: 0.5, y: 0.5, z: 0.5 })

    const frame = system.captureCollisionHistoryFrame(42, 1000)
    expect(frame.tick).toBe(42)
    expect(frame.timestamp).toBe(1000)
    expect(frame.dynamicBoxes).toHaveLength(1)
    expect(frame.dynamicBoxes[0]).toMatchObject({ id: 'dyn-2' })

    // Verify clone behavior
    frame.dynamicBoxes[0].position.x = 999
    expect(system.getCombinedCollisionBoxes().some((box) => box.id === 'dyn-2' && box.position.x === 999)).toBe(false)
  })

  it('combines static and dynamic boxes for collision queries', () => {
    const system = new CollisionAuthoritySystem('map_default', 'session-4')
    const staticBoxes = system.getStaticLayout().boxes
    expect(system.getCombinedCollisionBoxes()).toHaveLength(staticBoxes.length)

    system.upsertDynamicCollider('dyn-3', { x: 15, y: 0, z: 15 }, { x: 1, y: 1, z: 1 })
    expect(system.getCombinedCollisionBoxes().length).toBe(staticBoxes.length + 1)
  })

  it('validates positions against static bounds and collision boxes', () => {
    const system = new CollisionAuthoritySystem('map_default', 'session-5')
    const bounds = system.getBounds()
    expect(bounds).not.toBeNull()

    const inside = { x: 0, y: 0, z: 0 }
    expect(system.isPositionValid(inside, 0.1)).toBe(true)

    // Outside bounds should be invalid
    if (bounds) {
      expect(system.isPositionValid({ x: bounds.halfWidth + 1, y: 0, z: 0 }, 0.1)).toBe(false)
    }
  })

  it('raycasts against combined collision boxes and simulates projectile hits', () => {
    const system = new CollisionAuthoritySystem('map_default', 'session-6')
    const origin = { x: 0, y: 0, z: -10 }
    const direction = { x: 0, y: 0, z: 1 }
    const maxDistance = 100

    const hit = system.raycast(origin, direction, maxDistance)
    if (hit) {
      expect(hit.colliderId).toBeDefined()
      expect(hit.distance).toBeGreaterThanOrEqual(0)
    }

    const projection = system.simulateProjectile(origin, direction, 10, 1)
    expect(projection.distance).toBeGreaterThanOrEqual(0)
    expect(typeof projection.hit).toBe('boolean')
  })

  it('uses provided collision history frames for combined box queries', () => {
    const system = new CollisionAuthoritySystem('map_default', 'session-7')
    system.upsertDynamicCollider('dyn-8', { x: 20, y: 0, z: 20 }, { x: 1, y: 1, z: 1 })
    const frame = {
      tick: 7,
      timestamp: 200,
      dynamicBoxes: [{ id: 'frame-box', position: { x: 2, y: 0, z: 2 }, halfExtents: { x: 1, y: 1, z: 1 } }],
    }

    const combined = system.getCombinedCollisionBoxes(frame)
    expect(combined.some((box) => box.id === 'frame-box')).toBe(true)
    expect(combined.some((box) => box.id === 'dyn-8')).toBe(false)
  })

  it('returns null when a ray misses every collision box', () => {
    const system = new CollisionAuthoritySystem('map_default', 'session-8')
    const origin = { x: 0, y: 100, z: 0 }
    const direction = { x: 0, y: 1, z: 0 }

    expect(system.raycast(origin, direction, 10)).toBeNull()
    const projection = system.simulateProjectile(origin, direction, 10, 1)
    expect(projection.hit).toBe(false)
    expect(projection.distance).toBe(10)
  })
})
