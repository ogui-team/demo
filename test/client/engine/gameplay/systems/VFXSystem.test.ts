import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { VFXSystem } from '@engine/gameplay/systems/VFXSystem'

describe('VFXSystem', () => {
  it('creates GPU-instanced particle emitters and cleans up finished burst effects', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100)
    camera.position.set(0, 2, 6)

    const system = new VFXSystem(scene, camera)
    const emitterId = system.playPreset('spawnBurst', { x: 0, y: 1, z: 0 })
    const mesh = system.getEmitterMesh(emitterId)

    expect(mesh).toBeInstanceOf(THREE.InstancedMesh)
    expect(system.hasEmitter(emitterId)).toBe(true)
    expect(scene.children.includes(mesh!)).toBe(true)

    system.update(0.016)

    expect(mesh!.count).toBeGreaterThan(0)
    expect(system.getDebugState()).toMatchObject({
      status: 'active',
      active: true,
      metrics: expect.objectContaining({ emitterCount: 1 }),
    })

    for (let index = 0; index < 180; index += 1) {
      system.update(0.016)
    }

    expect(system.hasEmitter(emitterId)).toBe(false)
    expect(scene.children.includes(mesh!)).toBe(false)
  })
})