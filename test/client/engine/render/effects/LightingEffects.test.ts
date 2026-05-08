import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { initScene, clearScene } from '@engine/render/Scene'
import { initLights } from '@engine/render/Lights'
import { LightingEffects } from '@engine/render/effects/LightingEffects'

describe('LightingEffects', () => {
  beforeEach(() => {
    clearScene()
    document.body.innerHTML = ''
  })

  it('creates lighting effects and updates scene objects', () => {
    const scene = initScene()
    initLights()

    const effect = new LightingEffects(scene, {
      ambientFlickerSpeed: 1,
      ambientFlickerIntensity: 0.02,
      enableMovingLight: true,
      movingLightSpeed: 0.2,
      movingLightIntensity: 0.5,
      movingLightRadius: 5,
    })

    expect(effect.isEnabled()).toBe(true)
    effect.update(0.016)

    effect.setEnabled(false)
    expect(effect.isEnabled()).toBe(false)
    effect.destroy()

    const ambientLight = scene.children.find((child) => child.type === 'AmbientLight')
    expect(ambientLight).toBeTruthy()
  })
})
