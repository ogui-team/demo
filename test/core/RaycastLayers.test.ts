import * as THREE from 'three'
import {
  filterRaycastObjects,
  getContextRaycastLayers,
  getRaycastLayers,
  matchesRaycastLayers,
  raycastObjects,
  setRaycastLayers,
  setRaycastLayersRecursive,
} from '../../client/src/engine/core/RaycastLayers'

describe('RaycastLayers', () => {
  it('stores and reads layers on a single object', () => {
    const object = new THREE.Object3D()

    setRaycastLayers(object, ['editor', 'world'])
    expect(getRaycastLayers(object)).toEqual(['editor', 'world'])
  })

  it('preserves unique layers and applies recursively', () => {
    const parent = new THREE.Object3D()
    const child = new THREE.Object3D()
    parent.add(child)

    setRaycastLayersRecursive(parent, ['player', 'player', 'world'])

    expect(getRaycastLayers(parent)).toEqual(['player', 'world'])
    expect(getRaycastLayers(child)).toEqual(['player', 'world'])
  })

  it('falls back to parent layers when object has no direct layers', () => {
    const parent = new THREE.Object3D()
    const child = new THREE.Object3D()
    parent.add(child)

    setRaycastLayers(parent, 'editor')
    expect(getRaycastLayers(child)).toEqual(['editor'])
  })

  it('returns an empty array when no layers are found', () => {
    expect(getRaycastLayers(null)).toEqual([])
    expect(getRaycastLayers(undefined)).toEqual([])
    expect(getRaycastLayers(new THREE.Object3D())).toEqual([])
  })

  it('matches with undefined or empty layer filters', () => {
    const object = new THREE.Object3D()
    expect(matchesRaycastLayers(object, undefined)).toBe(true)
    expect(matchesRaycastLayers(object, [])).toBe(true)
  })

  it('filters objects according to requested raycast layers', () => {
    const editor = new THREE.Object3D()
    const player = new THREE.Object3D()
    const world = new THREE.Object3D()

    setRaycastLayers(editor, 'editor')
    setRaycastLayers(player, 'player')
    setRaycastLayers(world, 'world')

    const filtered = filterRaycastObjects([editor, player, world], ['player', 'world'])
    expect(filtered).toEqual([player, world])
  })

  it('raycastObjects returns an array for filtered objects', () => {
    const object = new THREE.Object3D()
    const raycaster = new THREE.Raycaster()

    const result = raycastObjects(raycaster, [object], ['player'])
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns context-specific raycast layers', () => {
    expect(getContextRaycastLayers('editor')).toEqual(['editor'])
    expect(getContextRaycastLayers('game')).toEqual(['player', 'world'])
    expect(getContextRaycastLayers('ui')).toEqual([])
  })
})
