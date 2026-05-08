import { Entity } from '../../client/src/engine/core/Entity'

describe('Entity', () => {
  it('initializes with id, type, and default transform', () => {
    const entity = new Entity('e1', 'player')
    expect(entity.id).toBe('e1')
    expect(entity.type).toBe('player')
    expect(entity.getPosition()).toEqual({ x: 0, y: 0, z: 0 })
    expect(entity.getRotation()).toEqual({ x: 0, y: 0, z: 0 })
    expect(entity.getScale()).toEqual({ x: 1, y: 1, z: 1 })
    expect(entity.isActive).toBe(true)
  })

  it('touch updates lastUsedTime', () => {
    const entity = new Entity('e2', 'npc')
    const before = entity.lastUsedTime
    entity.touch(1234)
    expect(entity.lastUsedTime).toBe(1234)
    expect(entity.lastUsedTime).not.toBe(before)
  })

  it('reinitialize resets transform and clears components', () => {
    const entity = new Entity('e3', 'item')
    entity.addComponent({ name: 'test', data: { x: 1 } })
    entity.reinitialize('e4', 'item2', {
      position: { x: 5, y: 6, z: 7 },
      rotation: { x: 1, y: 2, z: 3 },
      scale: { x: 2, y: 2, z: 2 },
    })

    expect(entity.id).toBe('e4')
    expect(entity.type).toBe('item2')
    expect(entity.getPosition()).toEqual({ x: 5, y: 6, z: 7 })
    expect(entity.getRotation()).toEqual({ x: 1, y: 2, z: 3 })
    expect(entity.getScale()).toEqual({ x: 2, y: 2, z: 2 })
    expect(entity.getComponents()).toEqual([])
  })

  it('reset clears identity and components', () => {
    const entity = new Entity('e5', 'prop')
    entity.addComponent({ name: 'foo', data: {} })
    entity.reset()
    expect(entity.id).toBe('')
    expect(entity.type).toBe('')
    expect(entity.isActive).toBe(false)
    expect(entity.getComponents()).toEqual([])
  })

  it('setTransform updates transform immutably', () => {
    const entity = new Entity('e6', 'object')
    const original = entity.getTransform()
    entity.setTransform({ position: { x: 1, y: 2, z: 3 } })
    expect(entity.getPosition()).toEqual({ x: 1, y: 2, z: 3 })
    expect(original.position).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('adds, removes, and queries components', () => {
    const entity = new Entity('e7', 'unit')
    entity.addComponent({ name: 'comp', data: { value: 42 } })
    expect(entity.hasComponent('comp')).toBe(true)
    expect(entity.getComponent('comp')?.data.value).toBe(42)

    entity.removeComponent('comp')
    expect(entity.hasComponent('comp')).toBe(false)
  })

  it('updates components when active', () => {
    const entity = new Entity('e8', 'enemy')
    const updateFn = vi.fn((dt) => {})
    entity.addComponent({ name: 'updater', data: {}, update: updateFn })
    entity.update(0.16)
    expect(updateFn).toHaveBeenCalledOnce()
  })

  it('serializes and deserializes via JSON', () => {
    const entity = new Entity('e9', 'prop', {
      position: { x: 4, y: 5, z: 6 },
      rotation: { x: 1, y: 2, z: 3 },
      scale: { x: 2, y: 3, z: 4 },
    })
    entity.addComponent({ name: 'data', data: { x: true } })
    const json = entity.toJSON()
    const restored = Entity.fromJSON(json)

    expect(restored.id).toBe('e9')
    expect(restored.type).toBe('prop')
    expect(restored.getPosition()).toEqual({ x: 4, y: 5, z: 6 })
    expect(restored.getComponent('data')?.data.x).toBe(true)
  })

  it('clones entity with deep component copy', () => {
    const entity = new Entity('e10', 'actor')
    entity.addComponent({ name: 'health', data: { hp: 100 } })
    const clone = entity.clone('clone1')

    expect(clone.id).toBe('clone1')
    expect(clone.type).toBe('actor')
    expect(clone.getComponent('health')?.data.hp).toBe(100)
    expect(clone.getComponent('health')).not.toBe(entity.getComponent('health'))
  })
})

