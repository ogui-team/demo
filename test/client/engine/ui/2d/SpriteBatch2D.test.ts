import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SpriteBatch2D } from '@engine/ui/2d/SpriteBatch2D'

describe('SpriteBatch2D', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('creates an instanced sprite batch and updates mesh state', () => {
    const texture = new THREE.Texture()
    const batch = new SpriteBatch2D(texture, 2)
    const mesh = batch.getMesh()

    expect(mesh).toBeDefined()
    expect(mesh.renderOrder).toBe(20)
    expect(mesh.geometry.instanceCount).toBe(0)
    expect(mesh.material.uniforms.uAtlas.value).toBe(texture)

    batch.updateSprites([
      {
        x: 1,
        y: 2,
        z: 3,
        width: 16,
        height: 32,
        uvRect: { x: 0, y: 0, width: 1, height: 1 },
        tint: 0xff00ff,
        opacity: 0.5,
        rotation: 0.2,
      },
    ])

    expect(mesh.visible).toBe(true)
    expect(mesh.geometry.instanceCount).toBe(1)
    expect(batch.getMetrics()).toEqual({ drawCalls: 1, batchCount: 1, spriteCount: 1 })

    batch.updateSprites([
      { x: 0, y: 0, width: 8, height: 8, uvRect: { x: 0, y: 0, width: 1, height: 1 } },
      { x: 4, y: 4, width: 8, height: 8, uvRect: { x: 0, y: 0, width: 1, height: 1 } },
      { x: 8, y: 8, width: 8, height: 8, uvRect: { x: 0, y: 0, width: 1, height: 1 } },
    ])

    expect(mesh.geometry.instanceCount).toBe(2)
    expect(batch.getMetrics()).toEqual({ drawCalls: 1, batchCount: 1, spriteCount: 2 })
    expect(mesh.material.uniforms.uAtlas.value).toBe(texture)

    expect(() => batch.dispose()).not.toThrow()
  })
})
