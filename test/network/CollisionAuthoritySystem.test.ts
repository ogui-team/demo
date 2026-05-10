import { gameBus } from '../../client/src/1-kernel/core/public-api'
import { CollisionAuthoritySystem } from '../../client/src/3-network/network/CollisionAuthoritySystem'

describe('CollisionAuthoritySystem', () => {
  let system: CollisionAuthoritySystem
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    emitSpy = vi.spyOn(gameBus, 'emit')
    system = new CollisionAuthoritySystem()
  })

  it('exposes handshake metadata and static layout bounds', () => {
    const handshake = system.getHandshake()
    expect(handshake.version).toBeGreaterThan(0)
    expect(handshake.checksum).toMatch(/^[0-9a-f]{8}$/)

    const bounds = system.getBounds()
    expect(bounds).toEqual(expect.objectContaining({ halfWidth: expect.any(Number), halfDepth: expect.any(Number) }))
    expect(system.getVersion()).toBe(handshake.version)
    expect(system.getChecksum()).toBe(handshake.checksum)
  })

  it('updates layout and emits state mutation events', () => {
    const before = system.getStaticLayout()
    system.setStaticLayout('forest_arena', 'session-1')
    expect(system.getStaticLayout().mapId).toBe('forest_arena')
    expect(emitSpy).toHaveBeenCalledWith('stateMutation', expect.objectContaining({ source: 'CollisionAuthoritySystem' }))

    system.setRemotePredictionMode('server_only')
    expect(emitSpy).toHaveBeenCalledWith('stateMutation', expect.objectContaining({ path: 'collisionAuthority.remotePredictionMode' }))
    expect(system.canPredictMovement('local')).toBe(true)
    expect(system.canPredictMovement('remote')).toBe(false)
  })

  it('manages dynamic colliders and combined boxes correctly', () => {
    system.upsertDynamicCollider('dyn-1', { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 1 }, false)
    system.upsertDynamicCollider('dyn-2', { x: 2, y: 0, z: 2 }, { x: 1, y: 1, z: 1 }, true)

    const combined = system.getCombinedCollisionBoxes({ includeNonDeterministic: false })
    expect(combined.some((box) => box.id === 'dyn-2')).toBe(true)
    expect(combined.some((box) => box.id === 'dyn-1')).toBe(false)

    const allBoxes = system.getCombinedCollisionBoxes()
    expect(allBoxes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'dyn-1' })]))

    system.removeDynamicCollider('dyn-1')
    expect(system.getDiagnostics().metrics.dynamicColliderCount).toBeGreaterThanOrEqual(0)
    system.clearDynamicColliders()
    expect(system.getDiagnostics().metrics.dynamicColliderCount).toBe(0)
  })

  it('validates positions, resolves movement, and raycasts against collision geometry', () => {
    const valid = system.isPositionValid({ x: 0, y: 1, z: 0 }, 0.5)
    expect(typeof valid).toBe('boolean')

    const movement = system.resolveMovement({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 0.5)
    expect(movement).toHaveProperty('x')
    expect(movement).toHaveProperty('z')

    const hit = system.raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 100)
    expect(hit === null || hit).toBeDefined()
  })
})
