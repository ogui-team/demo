import { PhysicsDebugVisualizer } from '../../client/src/engine/core/PhysicsDebugVisualizer'
import * as THREE from 'three'

describe('PhysicsDebugVisualizer', () => {
  it('renders debug colliders and handles missing kernel data gracefully', () => {
    const kernel = { positions: { getReadBuffer: () => new Float32Array([1, 2, 3]) }, entities: { forEachDense: vi.fn() } } as any
    const scene = new THREE.Scene()
    const debug = new PhysicsDebugVisualizer(kernel, scene)

    debug.renderPhysicsDebugColliders()
    expect(scene.children.length).toBe(0)
    expect(debug.getDebugStats().kernelEntityCount).toBe(0)

    kernel.entities.forEachDense = (callback: (denseIndex: number, handle: number) => void) => {
      callback(0, 42)
    }

    debug.renderPhysicsDebugColliders()
    expect(scene.children.length).toBe(1)
    expect(debug.getDebugStats().debugMeshesCount).toBe(1)

    debug.renderStaticColliders([{ id: 'box1', position: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } }])
    expect(scene.children.length).toBe(2)

    debug.setEnabled(false)
    expect(debug.getDebugStats().enabled).toBe(false)
    expect(scene.children.length).toBe(0)
  })
})
