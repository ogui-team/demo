import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { SelectionSystem } from '@engine/editor/tools/SelectionSystem'

describe('SelectionSystem', () => {
  beforeEach(() => {
    document.body.innerHTML = '<canvas id="canvas" width="800" height="600"></canvas>'
  })

  it('enables and disables selection, and notifies subscribers', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000)
    const entity = { id: 'entity-1', type: 'Object' }
    const entityManager = {
      onEntityCreated: vi.fn(() => () => undefined),
      onEntityDestroyed: vi.fn(() => () => undefined),
      getEntities: vi.fn(() => [entity]),
    }
    const modeManager = { getMode: vi.fn(() => 'editor') }

    const system = new SelectionSystem(scene, entityManager as any, modeManager as any, camera, {
      enableLogging: false,
    })

    expect(system.isEnabled()).toBe(false)
    system.enable()
    expect(system.isEnabled()).toBe(true)

    const onSelect = vi.fn()
    const onDeselect = vi.fn()
    system.onSelect(onSelect)
    system.onDeselect(onDeselect)

    system.selectEntity('entity-1')
    expect(system.getSelected()).toBe('entity-1')
    expect(onSelect).toHaveBeenCalledWith('entity-1')

    system.deselect()
    expect(system.getSelected()).toBeNull()
    expect(onDeselect).toHaveBeenCalledWith('entity-1')

    expect(system.validateSelection()).toBe(true)
    system.disable()
    expect(system.isEnabled()).toBe(false)
  })

  it('selects multiple entities in a subtree when scene graph is set', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000)
    const selectableEntity = { id: 'entity-1', type: 'Object' }
    const entityManager = {
      onEntityCreated: vi.fn(() => () => undefined),
      onEntityDestroyed: vi.fn(() => () => undefined),
      getEntities: vi.fn(() => [selectableEntity]),
    }
    const modeManager = { getMode: vi.fn(() => 'editor') }
    const system = new SelectionSystem(scene, entityManager as any, modeManager as any, camera)

    let subtreeCalled = false
    system.setSceneGraph({
      getSubtree: (rootId: string) => {
        subtreeCalled = true
        return [rootId, 'entity-2']
      },
    } as any)
    const onSelect = vi.fn()
    system.onSelect(onSelect)

    system.enable()
    system.selectWithSubtree('entity-1')
    expect(subtreeCalled).toBe(true)
    expect(onSelect).toHaveBeenCalledWith('entity-1')
  })
})
