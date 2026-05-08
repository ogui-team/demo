import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { initScene, getScene, addToScene, removeFromScene, clearScene } from '@engine/render/Scene'

describe('Scene module', () => {
  beforeEach(() => {
    clearScene()
  })

  it('initializes scene and manages objects', () => {
    const scene = initScene()
    expect(scene).toBeDefined()
    expect(scene.background).toBeInstanceOf(THREE.Color)
    expect(getScene()).toBe(scene)

    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    addToScene(box)
    expect(scene.children).toContain(box)

    removeFromScene(box)
    expect(scene.children).not.toContain(box)

    addToScene(box)
    clearScene()
    expect(scene.children.length).toBe(0)
  })
})
