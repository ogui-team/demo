import { Entity } from '../../client/src/engine/core/Entity'
import { EntityManager } from '../../client/src/engine/core/EntityManager'
import { gameBus } from '../../client/src/engine/core/EventBus'

describe('EntityManager', () => {
  let manager: EntityManager
  let transformSystem: any
  let sceneGraph: any

  beforeEach(() => {
    gameBus.clear()
    transformSystem = {
      registerEntity: vi.fn(),
      unregisterEntity: vi.fn(),
    }
    sceneGraph = {
      registerEntity: vi.fn(),
      unregisterEntity: vi.fn(),
    }
    manager = new EntityManager({ enableLogging: false, maxEntities: 5, transformSystem, sceneGraph })
    manager.resetIdCounter()
  })

  it('creates and destroys entities with transform and scene integration', () => {
    const createdListener = vi.fn()
    const destroyedListener = vi.fn()
    manager.onEntityCreated(createdListener)
    manager.onEntityDestroyed(destroyedListener)

    const entity = manager.createEntity('player')
    expect(entity.id).toContain('entity_0_')
    expect(entity.type).toBe('player')
    expect(transformSystem.registerEntity).toHaveBeenCalledWith(entity, undefined)
    expect(sceneGraph.registerEntity).toHaveBeenCalledWith(entity)
    expect(createdListener).toHaveBeenCalledWith(entity)
    expect(manager.getEntityCount()).toBe(1)

    const destroyed = manager.destroyEntity(entity.id)
    expect(destroyed).toBe(true)
    expect(destroyedListener).toHaveBeenCalledWith(entity)
    expect(manager.getEntity(entity.id)).toBeUndefined()
    expect(manager.getEntityCount()).toBe(0)
  })

  it('supports parent entity readiness tracking and resolves awaiters', async () => {
    const completeSpy = vi.fn()
    gameBus.on('PLAYER_INIT_COMPLETE', completeSpy)

    manager.registerPlayerInit('player1')
    const promise = manager.awaitPlayerReady('player1')

    expect(manager.isPlayerReady('player1')).toBe(false)
    manager.markPlayerPhaseReady('player1', 'entity')
    manager.markPlayerPhaseReady('player1', 'inventory')
    manager.markPlayerPhaseReady('player1', 'abilities')
    expect(manager.isPlayerReady('player1')).toBe(false)

    manager.markPlayerPhaseReady('player1', 'avatar')
    await promise

    expect(manager.isPlayerReady('player1')).toBe(true)
    expect(completeSpy).toHaveBeenCalledWith({ playerId: 'player1' })
    expect(manager.getPlayerInitDiagnostics('player1').ready).toBe(true)
  })

  it('returns false for missing entities and warns when destroying unknown entity', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(manager.destroyEntity('missing')).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('throws when entity limit is reached', () => {
    for (let i = 0; i < 5; i += 1) {
      manager.createEntity(`type${i}`)
    }

    expect(() => manager.createEntity('overflow')).toThrow('Max entity limit reached')
  })

  it('creates pooled entities and reuses them after destroy', () => {
    const first = manager.createPooledEntity('bullet')
    expect(first.type).toBe('bullet')

    manager.destroyEntity(first)
    const second = manager.createPooledEntity('bullet')
    expect(second).toBe(first)
    expect(second.type).toBe('bullet')
  })

  it('queries entities by type, component, and active state', () => {
    const entityA = manager.createEntity('soldier')
    const entityB = manager.createEntity('soldier')
    const entityC = manager.createEntity('turret')
    entityB.addComponent({ name: 'shield', data: {} })
    manager.setEntityActive(entityC.id, false)

    expect(manager.getEntitiesByType('soldier')).toHaveLength(2)
    expect(manager.getEntitiesWithComponent('shield')).toEqual([entityB])
    expect(manager.queryEntities({ active: true })).toContain(entityA)
    expect(manager.queryEntities({ active: false })).toContain(entityC)
  })

  it('updates all entities and notifies update listeners', () => {
    const entity = manager.createEntity('npc')
    const updateListener = vi.fn()
    manager.onEntityUpdated(updateListener)
    entity.addComponent({ name: 'mover', data: {}, update: vi.fn() })

    manager.update(0.16)
    expect(updateListener).toHaveBeenCalledWith(entity)
  })

  it('serializes and deserializes entities including scene/transform integrations', () => {
    const entity = manager.createEntity('hero', { position: { x: 1, y: 2, z: 3 } })
    const json = manager.saveScene()

    manager.clear()
    expect(manager.getEntityCount()).toBe(0)

    manager.loadScene(json)
    expect(manager.getEntityCount()).toBe(1)
    expect(manager.getEntity(entity.id)?.getPosition()).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('returns debug records and diagnostics for active entities', () => {
    const entity = manager.createEntity('PlayerProjectile')
    entity.addComponent({ name: 'collider', data: {} })

    const records = manager.getActiveEntityDebugRecords()
    expect(records[0]).toMatchObject({ id: entity.id, type: 'PlayerProjectile', pooled: false, hasCollider: true })

    const diagnostics = manager.getDiagnostics()
    expect(diagnostics.metrics).toMatchObject({ count: 1, activeEntities: 1, created: 1, destroyed: 0 })
  })

  it('can set transform system and scene graph after entities exist', () => {
    const freshManager = new EntityManager({ enableLogging: false, maxEntities: 10 })
    freshManager.resetIdCounter()
    const entity = freshManager.createEntity('deferred')
    expect(freshManager.getTransformSystem()).toBeUndefined()
    expect(freshManager.getSceneGraph()).toBeUndefined()

    freshManager.setTransformSystem(transformSystem)
    freshManager.setSceneGraph(sceneGraph)

    expect(transformSystem.registerEntity).toHaveBeenCalledWith(entity)
    expect(sceneGraph.registerEntity).toHaveBeenCalledWith(entity)
    expect(freshManager.getTransformSystem()).toBe(transformSystem)
    expect(freshManager.getSceneGraph()).toBe(sceneGraph)
  })
})
