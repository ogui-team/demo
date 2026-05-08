import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { TransformGizmo } from '@engine/editor/tools/TransformGizmo'

describe('TransformGizmo', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('cycles modes, attaches an entity, and detaches cleanly', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
    const stateStore = new Map<string, unknown>([
      ['entities.entity-1.position', { x: 1, y: 2, z: 3 }],
      ['entities.entity-1.rotation', { x: 0, y: 0, z: 0 }],
      ['entities.entity-1.scale', { x: 1, y: 1, z: 1 }],
    ])
    const stateManager = {
      get: vi.fn((key: string) => stateStore.get(key)),
      set: vi.fn((key: string, value: unknown) => {
        stateStore.set(key, value)
        return true
      }),
    }
    const entity = {
      id: 'entity-1',
      type: 'Object',
      getPosition: () => ({ x: 1, y: 2, z: 3 }),
      getRotation: () => ({ x: 0, y: 0, z: 0 }),
      getScale: () => ({ x: 1, y: 1, z: 1 }),
      setPosition: vi.fn(),
      setRotation: vi.fn(),
      setScale: vi.fn(),
    }

    const gizmo = new TransformGizmo(scene, stateManager as any, camera)
    expect(gizmo.getMode()).toBe('move')
    gizmo.cycleMode()
    expect(gizmo.getMode()).toBe('rotate')
    gizmo.cycleMode()
    expect(gizmo.getMode()).toBe('scale')

    gizmo.enable()
    gizmo.setEntity(entity as any)
    expect(gizmo.getEntity()).toBe(entity)

    gizmo.setEntity(null)
    expect(gizmo.getEntity()).toBeNull()

    gizmo.destroy()
    expect(document.getElementById('gizmo-mode-indicator')).toBeNull()
  })
})
