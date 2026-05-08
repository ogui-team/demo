import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { initScene, clearScene } from '@engine/render/Scene'
import { initFog, getFog } from '@engine/render/Fog'
import { FogEffects } from '@engine/render/effects/FogEffects'

describe('FogEffects', () => {
  beforeEach(() => {
    clearScene()
    document.body.innerHTML = ''
  })

  it('initializes fog and updates scene background', () => {
    const scene = initScene()
    initFog({ color: 0x112233, density: 0.02 })

    const fog = getFog()
    expect(fog).toBeTruthy()
    expect(fog?.density).toBeCloseTo(0.02)

    const effect = new FogEffects(scene, { minDensity: 0.01, maxDensity: 0.02 })
    expect(effect.isEnabled()).toBe(true)

    effect.update(0.1)
    expect(scene.background).toBeInstanceOf(THREE.Color)

    effect.setEnabled(false)
    expect(effect.isEnabled()).toBe(false)
    effect.destroy()
  })
})
