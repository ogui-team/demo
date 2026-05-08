import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GizmoSystem } from '@engine/editor/tools/GizmoSystem'

describe('GizmoSystem', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('initializes, cycles modes, attaches an entity, and cleans up', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
    const stateManager = {
      get: vi.fn((key: string) => {
        if (key === 'entities.entity-1.position') return { x: 1, y: 2, z: 3 }
        if (key === 'entities.entity-1.rotation') return { x: 0, y: 0, z: 0 }
        if (key === 'entities.entity-1.scale') return { x: 1, y: 1, z: 1 }
        return undefined
      }),
      set: vi.fn(() => true),
    }
    const modeManager = {
      getMode: vi.fn(() => 'editor'),
      registerListener: vi.fn(() => () => undefined),
    }

    const gizmo = new GizmoSystem(scene, stateManager as any, modeManager as any, camera, {
      enableLogging: false,
    })

    expect(gizmo.getMode()).toBe('translate')
    gizmo.setMode('rotate')
    expect(gizmo.getMode()).toBe('rotate')
    gizmo.setMode('scale')
    expect(gizmo.getMode()).toBe('scale')

    gizmo.attachEntity('entity-1')
    const debugState = gizmo.getDebugState()
    expect((debugState.metrics as any).selectedEntityId).toBe('entity-1')

    gizmo.disable()
    expect(gizmo.isEnabled()).toBe(false)
    expect(() => gizmo.destroy()).not.toThrow()
  })
})
