import { describe, expect, it } from 'vitest'
import { createPS1Material, createBox, createSphere, createPlane, vec3, vec2, clamp, lerp, normalizeAngle, toRadians, toDegrees } from '../../../../client/src/engine/foundation/Utils'

describe('Foundation Utils', () => {
  it('creates PS1-style materials with defaults and overrides', () => {
    const mat = createPS1Material(undefined, { wireframe: true, roughness: 0.2 })
    expect(mat).toHaveProperty('flatShading', true)
    expect(mat).toHaveProperty('wireframe', true)
    expect(mat).toHaveProperty('roughness', 0.2)
    expect(mat).toHaveProperty('metalness', 0)
  })

  it('creates basic meshes and vector helpers', () => {
    const box = createBox(2, 0xff0000)
    expect(box.geometry).toBeDefined()
    expect(box.material).toBeDefined()

    const sphere = createSphere(1, 0x00ff00)
    expect(sphere.geometry).toBeDefined()
    expect(sphere.material).toBeDefined()

    const plane = createPlane(4, 2, 0x0000ff)
    expect(plane.geometry).toBeDefined()
    expect(plane.material).toBeDefined()

    expect(vec3(1, 2, 3)).toMatchObject({ x: 1, y: 2, z: 3 })
    expect(vec2(4, 5)).toMatchObject({ x: 4, y: 5 })
  })

  it('provides numeric utility functions', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(20, 0, 10)).toBe(10)

    expect(lerp(0, 10, 0)).toBe(0)
    expect(lerp(0, 10, 0.5)).toBe(5)
    expect(lerp(0, 10, 1)).toBe(10)

    expect(normalizeAngle(370)).toBe(10)
    expect(normalizeAngle(-30)).toBe(330)

    expect(toRadians(180)).toBeCloseTo(Math.PI)
    expect(toDegrees(Math.PI / 2)).toBeCloseTo(90)
  })
})
