import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { register, get, has, isReady, getNames, getSize, listAssets, dispose, setBaseUrl } from '@engine/gameplay/systems/AssetLoader'

describe('AssetLoader', () => {
  beforeEach(() => {
    dispose('object-1')
    dispose('texture-1')
  })

  it('registers and retrieves object3D assets', () => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    register('object-1', object)

    expect(has('object-1')).toBe(true)
    expect(isReady('object-1')).toBe(true)
    expect(get<THREE.Mesh>('object-1')).toBe(object)
    expect(getNames()).toContain('object-1')
    expect(getSize()).toBe(1)

    const assets = listAssets()
    expect(assets).toEqual([{ name: 'object-1', kind: 'object3d' }])

    dispose('object-1')
    expect(has('object-1')).toBe(false)
    expect(isReady('object-1')).toBe(false)
  })

  it('registers a texture asset and lists it', () => {
    const texture = new THREE.Texture()
    register('texture-1', texture)

    expect(has('texture-1')).toBe(true)
    expect(isReady('texture-1')).toBe(true)
    expect(get<THREE.Texture>('texture-1')).toBe(texture)
    expect(getSize()).toBe(1)

    dispose('texture-1')
    expect(has('texture-1')).toBe(false)
  })

  it('sets base url without throwing', () => {
    expect(() => setBaseUrl('/assets/')).not.toThrow()
  })
})
