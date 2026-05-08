import { describe, expect, it, beforeEach } from 'vitest'
import * as THREE from 'three'
import { initScene, clearScene } from '@engine/render/Scene'
import { initLights, getAmbientLight, getDirectionalLight, setAmbientIntensity, setDirectionalIntensity, setDirectionalPosition } from '@engine/render/Lights'

describe('Lights module', () => {
  beforeEach(() => {
    clearScene()
  })

  it('initializes lights and updates their properties', () => {
    initScene()
    initLights()

    const ambient = getAmbientLight()
    const directional = getDirectionalLight()

    expect(ambient).toBeInstanceOf(THREE.AmbientLight)
    expect(directional).toBeInstanceOf(THREE.DirectionalLight)

    setAmbientIntensity(0.7)
    expect(ambient?.intensity).toBeCloseTo(0.7)

    setDirectionalIntensity(0.5)
    expect(directional?.intensity).toBeCloseTo(0.5)

    setDirectionalPosition(3, 4, 5)
    expect(directional?.position.x).toBeCloseTo(3)
    expect(directional?.position.y).toBeCloseTo(4)
    expect(directional?.position.z).toBeCloseTo(5)
  })
})
