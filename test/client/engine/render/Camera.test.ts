import { describe, expect, it } from 'vitest'
import { initCamera, getCamera, updateCameraAspect } from '@engine/render/Camera'

describe('Camera module', () => {
  it('initializes camera and updates properties', () => {
    const camera = initCamera()
    expect(camera).toBeDefined()
    expect(getCamera()).toBe(camera)

    updateCameraAspect(2, 1)
    expect(camera.aspect).toBeCloseTo(2)
  })
})
