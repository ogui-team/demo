import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { PS1RenderingPipeline } from '@engine/render/PS1RenderingPipeline'

const fakeRenderer = () => {
  const renderer = {
    setRenderTarget: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
    getRenderTarget: vi.fn(() => null),
    autoClear: true,
  }
  return renderer as unknown as THREE.WebGLRenderer
}

describe('PS1RenderingPipeline', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
  })

  it('initializes and updates shader uniform setters', () => {
    const renderer = fakeRenderer()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000)
    const pipeline = new PS1RenderingPipeline(renderer, scene, camera, {
      enableResolutionScaling: false,
      enableVertexJitter: true,
      enableColorQuantization: true,
      enableDithering: true,
      enableFilmGrain: true,
      enableVignette: true,
      enableDepthFog: true,
    })

    expect(pipeline.isEnabled()).toBe(true)
    pipeline.setColorBits(4)
    pipeline.setDitheringIntensity(0.2)
    pipeline.setFilmGrainIntensity(0.15)
    pipeline.setVignetteIntensity(0.2)
    pipeline.setFogIntensity(0.4)
    pipeline.update(0.016)
    expect(pipeline.isEnabled()).toBe(true)
  })

  it('applies vertex jitter and simplifies lighting', () => {
    const renderer = fakeRenderer()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000)
    const pipeline = new PS1RenderingPipeline(renderer, scene, camera, { enableResolutionScaling: false })

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const originalPositions = Array.from((geometry.attributes.position.array as Float32Array))
    pipeline.applyVertexJitter(geometry)
    const jitteredPositions = geometry.attributes.position.array as Float32Array
    expect(jitteredPositions.some((v, idx) => v !== originalPositions[idx])).toBe(true)

    const standardMaterial = new THREE.MeshStandardMaterial()
    const phongMaterial = new THREE.MeshPhongMaterial()
    pipeline.simplifyLighting(standardMaterial)
    pipeline.simplifyLighting(phongMaterial)
    expect(standardMaterial.flatShading).toBe(true)
    expect(standardMaterial.roughness).toBe(1)
    expect(phongMaterial.shininess).toBe(0)
  })

  it('renders with pipeline disabled and enabled', () => {
    const renderer = fakeRenderer()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000)
    const pipeline = new PS1RenderingPipeline(renderer, scene, camera, { enableResolutionScaling: false })

    pipeline.setEnabled(false)
    pipeline.render()
    expect(renderer.render).toHaveBeenCalled()

    renderer.render.mockClear()
    pipeline.setEnabled(true)
    pipeline.render()
    expect(renderer.render).toHaveBeenCalled()
  })
})
