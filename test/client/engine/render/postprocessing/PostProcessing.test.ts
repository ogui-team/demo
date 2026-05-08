import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PostProcessing } from '@engine/render/postprocessing/PostProcessing'

describe('PostProcessing', () => {
  it('initializes and updates shader uniforms without a real renderer', () => {
    const scene = new THREE.Scene()
    const fakeRenderer = {} as unknown as THREE.WebGLRenderer

    const effect = new PostProcessing(fakeRenderer, scene, {
      enableFilmGrain: true,
      filmGrainIntensity: 0.12,
      enableVignette: true,
      vignetteIntensity: 0.75,
      enableDesaturation: true,
      desaturationAmount: 0.35,
    })

    expect(() => effect.update(0.03)).not.toThrow()
    effect.setVignetteIntensity(0.9)
    effect.setFilmGrainIntensity(0.2)
    effect.setDesaturation(0.45)
    expect(() => effect.setEnabled(false)).not.toThrow()
    expect(() => effect.destroy()).not.toThrow()
  })
})
