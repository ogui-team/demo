import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { initCamera } from '@engine/render/Camera'
import { CameraEffects } from '@engine/render/effects/CameraEffects'

describe('CameraEffects', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('applies sway and preserves camera state when disabled', () => {
    const camera = initCamera()
    const effect = new CameraEffects({ swaySpeed: 1, swayIntensity: 0.1, jitterIntensity: 0.01 })

    expect(effect.isEnabled()).toBe(true)

    const beforePosition = camera.position.clone()
    effect.update(0.016)
    expect(camera.position.equals(beforePosition)).toBe(false)

    effect.setEnabled(false)
    expect(effect.isEnabled()).toBe(false)

    effect.update(0.016)
    expect(camera.position).not.toBeUndefined()

    effect.destroy()
    expect(camera.fov).toBe(75)
  })

  it('updates FOV when FOV pulsing is enabled', () => {
    initCamera()
    const effect = new CameraEffects({ enableFOVPulse: true, fovPulseSpeed: 4, fovPulseAmount: 5 })

    expect(() => effect.update(0.05)).not.toThrow()
    expect(effect.isEnabled()).toBe(true)
    effect.setEnabled(false)
    effect.destroy()
  })
})
