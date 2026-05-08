import { describe, expect, it, beforeEach } from 'vitest'
import * as THREE from 'three'
import { initScene, clearScene } from '@engine/render/Scene'
import { initFog, getFog, setFogDensity, setFogColor, getFogConfig } from '@engine/render/Fog'

describe('Fog module', () => {
  beforeEach(() => {
    clearScene()
  })

  it('initializes fog and updates density and color', () => {
    initScene()
    const fog = initFog({ color: 0x123456, density: 0.05 })

    expect(fog).toBeInstanceOf(THREE.FogExp2)
    expect(getFog()).toBe(fog)
    expect(fog.color.getHex()).toBe(0x123456)
    expect(fog.density).toBeCloseTo(0.05)

    setFogDensity(0.08)
    expect(fog.density).toBeCloseTo(0.08)

    setFogColor(0x654321)
    expect(fog.color.getHex()).toBe(0x654321)

    const config = getFogConfig()
    expect(config).toEqual({ color: 0x654321, density: expect.any(Number) })
  })
})
