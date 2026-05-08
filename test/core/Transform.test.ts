import {
  initializeEntityTransform,
  syncEntityTransformFromState,
  getPosition,
  setPosition,
  getRotation,
  setRotation,
  getScale,
  setScale,
  translate,
  rotateAxis,
  scale,
  getTransform,
  subscribeToTransform,
  setPositionVec,
  setTransform,
  removeEntityTransform,
  TransformSystem,
} from '../../client/src/engine/core/Transform'
import { Entity } from '../../client/src/engine/core/Entity'

describe('Transform', () => {
  function createStateManager() {
    const store = new Map<string, any>()
    const listeners = new Map<string, Set<(newValue: any, oldValue: any) => void>>()

    return {
      set(key: string, value: unknown) {
        const oldValue = store.get(key)
        store.set(key, value)
        const bucket = listeners.get(key)
        if (bucket) {
          for (const cb of Array.from(bucket)) {
            cb(value, oldValue)
          }
        }
      },
      get(key: string) {
        return store.get(key)
      },
      subscribe(key: string, callback: (newValue: any, oldValue: any) => void) {
        let bucket = listeners.get(key)
        if (!bucket) {
          bucket = new Set()
          listeners.set(key, bucket)
        }
        bucket.add(callback)
        return () => bucket?.delete(callback)
      },
      remove(key: string) {
        store.delete(key)
        for (const existingKey of Array.from(store.keys())) {
          if (existingKey.startsWith(`${key}.`)) {
            store.delete(existingKey)
          }
        }
      },
    }
  }

  it('initializes entity transform in state manager', () => {
    const entity = new Entity('e1', 'player')
    const stateManager = createStateManager()
    initializeEntityTransform(entity, stateManager, {
      position: { x: 2, y: 3, z: 4 },
      rotation: { x: 0.1, y: 0.2, z: 0.3 },
      scale: { x: 2, y: 2, z: 2 },
    })

    expect(stateManager.get('entities.e1.position')).toEqual({ x: 2, y: 3, z: 4 })
    expect(stateManager.get('entities.e1.rotation')).toEqual({ x: 0.1, y: 0.2, z: 0.3 })
    expect(stateManager.get('entities.e1.scale')).toEqual({ x: 2, y: 2, z: 2 })
    expect(stateManager.get('entities.e1.type')).toBe('player')
  })

  it('syncs entity transform from state', () => {
    const entity = new Entity('e2', 'npc')
    const stateManager = createStateManager()
    stateManager.set('entities.e2.position', { x: 1, y: 1, z: 1 })
    stateManager.set('entities.e2.rotation', { x: 0, y: 0, z: 1 })
    stateManager.set('entities.e2.scale', { x: 3, y: 3, z: 3 })

    syncEntityTransformFromState(entity, stateManager)
    expect(entity.getPosition()).toEqual({ x: 1, y: 1, z: 1 })
    expect(entity.getRotation()).toEqual({ x: 0, y: 0, z: 1 })
    expect(entity.getScale()).toEqual({ x: 3, y: 3, z: 3 })
  })

  it('sets and gets position through state manager', () => {
    const entity = new Entity('e3', 'prop')
    const stateManager = createStateManager()
    setPosition(entity, stateManager, { x: 5, y: 6, z: 7 })
    expect(getPosition(entity, stateManager)).toEqual({ x: 5, y: 6, z: 7 })
    expect(entity.getPosition()).toEqual({ x: 5, y: 6, z: 7 })
  })

  it('sets and gets rotation through state manager', () => {
    const entity = new Entity('e4', 'prop')
    const stateManager = createStateManager()
    setRotation(entity, stateManager, { x: 1, y: 2, z: 3 })
    expect(getRotation(entity, stateManager)).toEqual({ x: 1, y: 2, z: 3 })
    expect(entity.getRotation()).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('sets and gets scale through state manager', () => {
    const entity = new Entity('e5', 'prop')
    const stateManager = createStateManager()
    setScale(entity, stateManager, { x: 2, y: 3, z: 4 })
    expect(getScale(entity, stateManager)).toEqual({ x: 2, y: 3, z: 4 })
    expect(entity.getScale()).toEqual({ x: 2, y: 3, z: 4 })
  })

  it('translates and rotates entity via state manager', () => {
    const entity = new Entity('e6', 'prop')
    const stateManager = createStateManager()
    setPosition(entity, stateManager, { x: 1, y: 1, z: 1 })
    translate(entity, stateManager, 2, 3, 4)
    expect(getPosition(entity, stateManager)).toEqual({ x: 3, y: 4, z: 5 })

    setRotation(entity, stateManager, { x: 0, y: 0, z: 0 })
    rotateAxis(entity, stateManager, 'z', Math.PI / 2)
    expect(getRotation(entity, stateManager).z).toBeCloseTo(Math.PI / 2)
  })

  it('scales entity through state manager', () => {
    const entity = new Entity('e7', 'prop')
    const stateManager = createStateManager()
    setScale(entity, stateManager, { x: 2, y: 2, z: 2 })
    scale(entity, stateManager, 0.5)
    expect(getScale(entity, stateManager)).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('returns the full transform from state manager', () => {
    const entity = new Entity('e8', 'prop')
    const stateManager = createStateManager()
    setPosition(entity, stateManager, { x: 1, y: 2, z: 3 })
    setRotation(entity, stateManager, { x: 4, y: 5, z: 6 })
    setScale(entity, stateManager, { x: 2, y: 2, z: 2 })

    expect(getTransform(entity, stateManager)).toEqual({
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 4, y: 5, z: 6 },
      scale: { x: 2, y: 2, z: 2 },
    })
  })

  it('sets position by vector helper and updates state and entity', () => {
    const entity = new Entity('e10', 'prop')
    const stateManager = createStateManager()
    setPositionVec(entity, stateManager, { x: 9, y: 9, z: 9 })

    expect(getPosition(entity, stateManager)).toEqual({ x: 9, y: 9, z: 9 })
    expect(entity.getPosition()).toEqual({ x: 9, y: 9, z: 9 })
  })

  it('sets a partial transform and preserves unchanged components', () => {
    const entity = new Entity('e11', 'prop')
    const stateManager = createStateManager()
    setPosition(entity, stateManager, { x: 1, y: 1, z: 1 })
    setRotation(entity, stateManager, { x: 0, y: 0, z: 0 })
    setScale(entity, stateManager, { x: 1, y: 1, z: 1 })

    setTransform(entity, stateManager, { position: { x: 2, y: 2, z: 2 } })
    expect(getRotation(entity, stateManager)).toEqual({ x: 0, y: 0, z: 0 })
    expect(getScale(entity, stateManager)).toEqual({ x: 1, y: 1, z: 1 })
    expect(getPosition(entity, stateManager)).toEqual({ x: 2, y: 2, z: 2 })
  })

  it('removes entity transform state when the entity is destroyed', () => {
    const entity = new Entity('e13', 'prop')
    const stateManager = createStateManager()
    initializeEntityTransform(entity, stateManager)

    removeEntityTransform(entity, stateManager as any)

    expect(stateManager.get('entities.e13.position')).toBeUndefined()
  })

  it('uses TransformSystem to manage entity transforms and syncs state', () => {
    const entity = new Entity('e12', 'prop')
    const stateManager = createStateManager()
    const transformSystem = new TransformSystem(stateManager)

    transformSystem.registerEntity(entity, {
      position: { x: 3, y: 3, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })

    expect(transformSystem.getPosition(entity)).toEqual({ x: 3, y: 3, z: 3 })
    expect(transformSystem.getRotation(entity)).toEqual({ x: 0, y: 0, z: 0 })
    expect(transformSystem.getScale(entity)).toEqual({ x: 1, y: 1, z: 1 })

    transformSystem.translate(entity, 1, 2, 3)
    expect(transformSystem.getPosition(entity)).toEqual({ x: 4, y: 5, z: 6 })

    transformSystem.rotateAxis(entity, 'x', Math.PI / 2)
    expect(transformSystem.getRotation(entity).x).toBeCloseTo(Math.PI / 2)

    transformSystem.scale(entity, 2)
    expect(transformSystem.getScale(entity)).toEqual({ x: 2, y: 2, z: 2 })

    transformSystem.unregisterEntity(entity)
    expect(transformSystem.getAllTransforms().has(entity.id)).toBe(false)
  })

  it('subscribes to transform changes and notifies callback', () => {
    const entity = new Entity('e9', 'prop')
    const stateManager = createStateManager()
    const callback = vi.fn()
    const unsubscribe = subscribeToTransform(entity, stateManager, callback)

    setPosition(entity, stateManager, { x: 1, y: 0, z: 0 })
    expect(callback).toHaveBeenCalled()

    callback.mockClear()
    unsubscribe()
    setPosition(entity, stateManager, { x: 2, y: 0, z: 0 })
    expect(callback).not.toHaveBeenCalled()
  })
})

