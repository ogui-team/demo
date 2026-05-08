import * as THREE from 'three'
import { Entity } from '../../client/src/engine/core/Entity'
import { EntityRenderer } from '../../client/src/engine/core/EntityRenderer'

vi.mock('../../client/src/engine/gameplay/systems/AssetRegistry', () => ({
  createInstance: vi.fn(() => null),
}))

const scene = new THREE.Scene()
const mockCulling = { registerForCulling: vi.fn(), unregisterForCulling: vi.fn() }

function makeEntityManager() {
  const createCallbacks: Array<(entity: Entity) => void> = []
  const destroyCallbacks: Array<(entity: Entity) => void> = []
  const updateCallbacks: Array<(entity: Entity) => void> = []
  const entities: Entity[] = []

  return {
    onEntityCreated: (cb: (entity: Entity) => void) => {
      createCallbacks.push(cb)
      return () => {}
    },
    onEntityDestroyed: (cb: (entity: Entity) => void) => {
      destroyCallbacks.push(cb)
      return () => {}
    },
    onEntityUpdated: (cb: (entity: Entity) => void) => {
      updateCallbacks.push(cb)
      return () => {}
    },
    getEntities: () => entities,
    addEntity: (entity: Entity) => {
      entities.push(entity)
      createCallbacks.forEach((cb) => cb(entity))
    },
    removeEntity: (entity: Entity) => {
      const idx = entities.indexOf(entity)
      if (idx !== -1) entities.splice(idx, 1)
      destroyCallbacks.forEach((cb) => cb(entity))
    },
    updateEntity: (entity: Entity) => updateCallbacks.forEach((cb) => cb(entity)),
  } as any
}

describe('EntityRenderer', () => {
  let entityManager: any
  let renderer: EntityRenderer

  beforeEach(() => {
    entityManager = makeEntityManager()
    scene.clear()
    renderer = new EntityRenderer(entityManager, scene, false)
    renderer.setCullingSystem(mockCulling)
    mockCulling.registerForCulling.mockClear()
    mockCulling.unregisterForCulling.mockClear()
  })

  it('syncs an entity with a render component and creates a mesh', () => {
    const entity = new Entity('e1', 'actor')
    entity.addComponent({ name: 'render', data: { meshType: 'box' } })
    entityManager.addEntity(entity)

    renderer.syncEntity(entity)
    expect(renderer.getMeshForEntity('e1')).toBeDefined()
    expect(scene.children.length).toBe(1)
  })

  it('handles dummy army spawn payload and creates fallback meshes', () => {
    const payload = { handles: [1, 2, 3], origin: { x: 0, y: 0, z: 0 }, spacing: 1.0, timestamp: Date.now() }
    ;(globalThis as any).__dummyEnemySystem = null
    ;(renderer as any).onDummyArmySpawned(payload)

    expect(renderer.getAllMeshes().size).toBe(3)
  })

  it('removes mesh when entity is destroyed', () => {
    const entity = new Entity('e2', 'actor')
    entity.addComponent({ name: 'render', data: { meshType: 'box' } })
    entityManager.addEntity(entity)
    renderer.syncEntity(entity)

    entityManager.removeEntity(entity)
    expect(renderer.getMeshForEntity('e2')).toBeUndefined()
    expect(scene.children.length).toBe(0)
  })
})
