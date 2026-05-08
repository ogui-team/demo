import { Entity } from '../../client/src/engine/core/Entity'
import { SceneGraph, registerEntityInSceneGraph, unregisterEntityFromSceneGraph } from '../../client/src/engine/core/SceneGraph'

describe('SceneGraph', () => {
  let sceneGraph: SceneGraph
  let stateStore: Record<string, unknown>
  let stateManager: { set: (path: string, value: unknown) => void; get: (path: string) => unknown }

  beforeEach(() => {
    stateStore = {}
    stateManager = {
      set(path: string, value: unknown) {
        stateStore[path] = value
      },
      get(path: string) {
        return stateStore[path]
      },
    }
    sceneGraph = new SceneGraph(stateManager as any, false)
  })

  it('registers entities and writes parent/children state', () => {
    const entity = new Entity('root', 'root')
    const callback = vi.fn()
    const unsubscribe = sceneGraph.onHierarchyChanged(callback)

    sceneGraph.registerEntity(entity)

    expect(sceneGraph.getParent('root')).toBeUndefined()
    expect(sceneGraph.getChildren('root')).toEqual([])
    expect(stateStore['entities.root.parentId']).toBeNull()
    expect(stateStore['entities.root.children']).toEqual([])
    expect(callback).toHaveBeenCalledWith({ type: 'registered', entityId: 'root' })

    unsubscribe()
    expect(sceneGraph.onHierarchyChanged(() => {})).toBeInstanceOf(Function)
  })

  it('parents and unparents entities while preserving world transforms', () => {
    const root = new Entity('root', 'root')
    root.setTransform({
      position: { x: 5, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    })

    const child = new Entity('child', 'child')
    child.setTransform({
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })

    sceneGraph.registerEntity(root)
    sceneGraph.registerEntity(child)

    const parented = vi.fn()
    const unparented = vi.fn()
    sceneGraph.onHierarchyChanged((event) => {
      if (event.type === 'parented') parented()
      if (event.type === 'unparented') unparented()
    })

    sceneGraph.addChild('root', 'child')

    expect(sceneGraph.getParent('child')).toBe('root')
    expect(sceneGraph.getChildren('root')).toEqual(['child'])
    expect(stateStore['entities.root.children']).toEqual(['child'])
    expect(stateStore['entities.child.parentId']).toBe('root')
    expect(parented).toHaveBeenCalled()

    const worldChild = sceneGraph.getWorldTransform('child')
    expect(worldChild.position).toEqual({ x: 7, y: 0, z: 0 })

    sceneGraph.removeChild('root', 'child')
    expect(sceneGraph.getParent('child')).toBeUndefined()
    expect(sceneGraph.getChildren('root')).toEqual([])
    expect(unparented).toHaveBeenCalled()
  })

  it('computes subtree and hierarchy path correctly', () => {
    const root = new Entity('root', 'root')
    const child = new Entity('child', 'child')
    const grandchild = new Entity('grand', 'grand')

    sceneGraph.registerEntity(root)
    sceneGraph.registerEntity(child)
    sceneGraph.registerEntity(grandchild)

    sceneGraph.addChild('root', 'child')
    sceneGraph.addChild('child', 'grand')

    expect(sceneGraph.getSubtree('root')).toEqual(['root', 'child', 'grand'])
    expect(sceneGraph.getHierarchyPath('grand')).toEqual(['root', 'child', 'grand'])
    expect(sceneGraph.getRoots().map((n) => n.entityId)).toEqual(['root'])
  })

  it('reparents an entity and preserves its world transform', () => {
    const rootA = new Entity('rootA', 'root')
    rootA.setTransform({
      position: { x: 10, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })
    const rootB = new Entity('rootB', 'root')
    rootB.setTransform({
      position: { x: 0, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })
    const child = new Entity('child', 'child')
    child.setTransform({
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })

    sceneGraph.registerEntity(rootA)
    sceneGraph.registerEntity(rootB)
    sceneGraph.registerEntity(child)
    sceneGraph.addChild('rootA', 'child')

    const before = sceneGraph.getWorldTransform('child')
    sceneGraph.reparent('child', 'rootB')
    const after = sceneGraph.getWorldTransform('child')

    expect(before.position).toEqual(after.position)
    expect(sceneGraph.getParent('child')).toBe('rootB')
  })

  it('unregisters an entity and detaches all children', () => {
    const root = new Entity('root', 'root')
    const child = new Entity('child', 'child')

    sceneGraph.registerEntity(root)
    sceneGraph.registerEntity(child)
    sceneGraph.addChild('root', 'child')

    sceneGraph.unregisterEntity('root')

    expect(sceneGraph.getParent('child')).toBeUndefined()
    expect(sceneGraph.getRoots().map((n) => n.entityId)).toEqual(['child'])
  })

  it('prevents cycles when adding children and logs an error', () => {
    const root = new Entity('root', 'root')
    const child = new Entity('child', 'child')
    const grand = new Entity('grand', 'grand')

    sceneGraph.registerEntity(root)
    sceneGraph.registerEntity(child)
    sceneGraph.registerEntity(grand)

    sceneGraph.addChild('root', 'child')
    sceneGraph.addChild('child', 'grand')

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sceneGraph.addChild('grand', 'root')

    expect(error).toHaveBeenCalled()
    expect(error.mock.calls[0][0]).toContain('Cycle detected: grand')
    expect(sceneGraph.getParent('root')).toBeUndefined()
    error.mockRestore()
  })

  it('registerEntityInSceneGraph and unregisterEntityFromSceneGraph helpers work', () => {
    const entity = new Entity('helper', 'helper')

    registerEntityInSceneGraph(entity, sceneGraph)
    expect(sceneGraph.getChildren('helper')).toEqual([])
    expect(stateStore['entities.helper.parentId']).toBeNull()

    unregisterEntityFromSceneGraph('helper', sceneGraph)
    expect(sceneGraph.getParent('helper')).toBeUndefined()
    expect(sceneGraph.getChildren('helper')).toEqual([])
  })

  it('getAllNodes returns copies and does not expose internal state', () => {
    const root = new Entity('root', 'root')
    const child = new Entity('child', 'child')

    sceneGraph.registerEntity(root)
    sceneGraph.registerEntity(child)
    sceneGraph.addChild('root', 'child')

    const nodes = sceneGraph.getAllNodes()
    const rootNode = nodes.get('root')!
    rootNode.children.push('extraneous')

    expect(sceneGraph.getChildren('root')).toEqual(['child'])
  })
})
