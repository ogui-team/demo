import { Entity } from '../../client/src/1-kernel/core/Entity'
import { gameBus } from '../../client/src/1-kernel/core/public-api'
import { ReplicationSystem } from '../../client/src/3-network/network/ReplicationSystem'

const makeBinding = (entity: Entity) => ({
  entity,
  velocityProvider: () => ({ x: 1, y: 2, z: 3 }),
  instance: { replicatedValue: 42 },
})

describe('ReplicationSystem', () => {
  let replication: ReplicationSystem
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    replication = new ReplicationSystem()
    emitSpy = vi.spyOn(gameBus, 'emit')
  })

  it('registers, tracks, and unregisters bindings', () => {
    const entity = new Entity('e1', 'player', { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 } })
    replication.registerBinding('e1', makeBinding(entity))

    expect(replication.hasBinding('e1')).toBe(true)
    expect(emitSpy).toHaveBeenCalledWith('replicationLifecycle', expect.objectContaining({ action: 'binding_registered', entityId: 'e1' }))

    replication.unregisterBinding('e1')
    expect(replication.hasBinding('e1')).toBe(false)
    expect(emitSpy).toHaveBeenCalledWith('replicationLifecycle', expect.objectContaining({ action: 'binding_unregistered', entityId: 'e1' }))
  })

  it('captures delta snapshots and returns nothing when state is unchanged', () => {
    const entity = new Entity('e1', 'player', { position: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 } })
    replication.registerBinding('e1', makeBinding(entity))

    const first = replication.captureSnapshots(undefined, 1, true)
    expect(first).toHaveLength(1)
    expect(replication.getTrackedEntityIds()).toEqual([])

    const second = replication.captureSnapshots(undefined, 2, true)
    expect(second).toHaveLength(0)
    expect(replication.getSnapshot('e1')).toBeDefined()
  })

  it('applies snapshots preserving position when requested and cleans up removed entities', () => {
    const entity1 = new Entity('e1', 'player', { position: { x: 5, y: 5, z: 5 }, rotation: { x: 0, y: 0, z: 0 } })
    const entity2 = new Entity('e2', 'player', { position: { x: 10, y: 10, z: 10 }, rotation: { x: 0, y: 0, z: 0 } })

    replication.registerBinding('e1', makeBinding(entity1))
    replication.registerBinding('e2', makeBinding(entity2))

    const snapshot1 = {
      entityId: 'e1',
      tick: 1,
      transform: { position: { x: 7, y: 7, z: 7 }, rotation: { x: 1, y: 1, z: 1 }, scale: { x: 1, y: 1, z: 1 } },
      replicated: { replicatedValue: 123 },
    }
    const snapshot2 = {
      entityId: 'e2',
      tick: 1,
      transform: { position: { x: 11, y: 11, z: 11 }, rotation: { x: 2, y: 2, z: 2 }, scale: { x: 1, y: 1, z: 1 } },
      replicated: { replicatedValue: 234 },
    }

    replication.applySnapshots([snapshot1, snapshot2])
    expect(replication.getTrackedEntityIds()).toEqual(expect.arrayContaining(['e1', 'e2']))

    const entityManager = { destroyEntity: vi.fn() }
    replication.init({ entityManager } as any)
    replication.applySnapshots([snapshot1])

    expect(entityManager.destroyEntity).toHaveBeenCalledWith(entity2)
    expect(replication.hasBinding('e2')).toBe(false)
  })

  it('validates snapshot structure and recipient constraints', () => {
    replication.registerBinding('e1', makeBinding(new Entity('e1', 'player', { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } })))

    expect(replication.validateSnapshotIntegrity([])).toBe(true)
    expect(replication.validateSnapshotIntegrity([{ entityId: 'e1', tick: 1 } as any])).toBe(true)
    expect(replication.validateSnapshotIntegrity([{ entityId: 'e1', tick: 0 } as any])).toBe(false)
    expect(replication.validateSnapshotIntegrity([{ entityId: 'missing', tick: 1 } as any])).toBe(false)
  })

  it('reports diagnostics and debug state after initialization', () => {
    replication.init({} as any)
    const diagnostics = replication.getDiagnostics()
    expect(diagnostics).toMatchObject({ bindingCount: 0, cachedSnapshots: 0 })
    expect(replication.getDebugState()).toMatchObject({ status: 'active', active: true })
  })
})
