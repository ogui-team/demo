import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { registerModelTemplate, registerObject3D, hasAsset, createInstance, getAssetOptions, listRegisteredAssets, invalidateAsset, clearRegistry } from '@engine/gameplay/systems/AssetRegistry'
import { dispose } from '@engine/gameplay/systems/AssetLoader'

describe('AssetRegistry', () => {
  beforeEach(() => {
    clearRegistry()
    dispose('template-1')
    dispose('object-1')
  })

  it('registers a model template, creates an instance, and returns options', () => {
    registerModelTemplate('template-1', () => {
      const root = new THREE.Object3D()
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
      mesh.name = 'root-mesh'
      root.add(mesh)
      return root
    }, { drawDistance: 10, ps1Style: false })

    expect(hasAsset('template-1')).toBe(true)
    expect(getAssetOptions('template-1')).toEqual({ drawDistance: 10, ps1Style: false })

    const instance = createInstance('template-1')
    expect(instance).toBeDefined()
    expect(instance?.userData.assetRegistryKey).toBe('template-1')
    expect(instance?.userData.sharedAssetInstance).toBe(true)

    const listed = listRegisteredAssets()
    expect(listed.some((item) => item.key === 'template-1' && item.source === 'template')).toBe(true)
  })

  it('registers an Object3D asset and clones it with markers', () => {
    const object = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial())
    object.name = 'sphere'

    registerObject3D('object-1', object)
    expect(hasAsset('object-1')).toBe(true)

    const instance = createInstance('object-1')
    expect(instance).not.toBeNull()
    expect(instance?.userData.assetRegistryKey).toBe('object-1')
    expect(instance?.userData.sharedAssetInstance).toBe(true)

    invalidateAsset('template-1')
    expect(getAssetOptions('template-1')).toBeNull()
  })
})
