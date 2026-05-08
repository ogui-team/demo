import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as THREE from 'three'

let camera: THREE.PerspectiveCamera
let callbackStore: Record<string, (value: any) => void>
let state: Record<string, any>
let unsubscribed = false

vi.mock('../../client/src/engine/foundation/state/StateManager', () => ({
  getStateManager: () => ({
    subscribe: (path: string, callback: (value: any) => void) => {
      callbackStore[path] = callback
      return () => {
        unsubscribed = true
      }
    },
    update: (patch: Record<string, any>) => {
      state = { ...state, ...patch }
    },
    getState: () => state,
  }),
}))

vi.mock('../../client/src/engine/render/Camera', () => ({
  getCamera: () => camera,
}))

describe('CameraStateAdapter', () => {
  beforeEach(() => {
    vi.resetModules()
    callbackStore = {}
    unsubscribed = false
    state = {
      camera: {
        position: { x: 0, y: 0, z: 0 },
        fov: 45,
      },
    }
    camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
    camera.position.set(1, 2, 3)
    camera.updateProjectionMatrix = vi.fn()
  })

  afterEach(async () => {
    const { setCameraAuthorityController } = await import('../../client/src/engine/camera/CameraStateAdapter')
    setCameraAuthorityController(null)
    vi.resetAllMocks()
  })

  it('initializes the camera from state', async () => {
    const { CameraStateAdapter } = await import('../../client/src/engine/camera/CameraStateAdapter')
    const adapter = new CameraStateAdapter()

    adapter.initializeFromState()

    expect(camera.position.x).toBe(0)
    expect(camera.position.y).toBe(0)
    expect(camera.position.z).toBe(0)
    expect(camera.fov).toBe(45)
    expect(camera.updateProjectionMatrix).toHaveBeenCalled()
  })

  it('syncs camera position into state', async () => {
    const { CameraStateAdapter } = await import('../../client/src/engine/camera/CameraStateAdapter')
    const adapter = new CameraStateAdapter()
    camera.position.set(7, 8, 9)

    adapter.syncCameraToState()

    expect(state['camera.position.x']).toBe(7)
    expect(state['camera.position.y']).toBe(8)
    expect(state['camera.position.z']).toBe(9)
  })

  it('updates camera FOV when state subscription callback triggers', async () => {
    const { CameraStateAdapter, setCameraAuthorityController } = await import('../../client/src/engine/camera/CameraStateAdapter')
    setCameraAuthorityController(null)
    new CameraStateAdapter()

    const fovCallback = callbackStore['camera.fov']
    expect(typeof fovCallback).toBe('function')

    fovCallback(60)

    expect(camera.fov).toBe(60)
    expect(camera.updateProjectionMatrix).toHaveBeenCalled()
  })

  it('unsubscribes when destroyed', async () => {
    const { CameraStateAdapter } = await import('../../client/src/engine/camera/CameraStateAdapter')
    const adapter = new CameraStateAdapter()

    adapter.destroy()

    expect(unsubscribed).toBe(true)
  })

  it('blocks writes from non-authoritative sources', async () => {
    const { CameraStateAdapter, setCameraAuthorityController } = await import('../../client/src/engine/camera/CameraStateAdapter')
    setCameraAuthorityController({
      canWriteCamera: (source: string) => source === 'game',
    })
    const adapter = new CameraStateAdapter()

    const applied = adapter.applySnapshot({
      position: { x: 9, y: 9, z: 9 },
    }, 'editor')

    expect(applied).toBe(false)
    expect(camera.position.x).toBe(1)
    expect(camera.position.y).toBe(2)
    expect(camera.position.z).toBe(3)

    setCameraAuthorityController(null)
  })

  it('applies transient camera offsets without overwriting base state', async () => {
    const { CameraStateAdapter, setCameraAuthority, setCameraAuthorityController } = await import('../../client/src/engine/camera/CameraStateAdapter')
    setCameraAuthorityController(null)
    setCameraAuthority('menu')
    const adapter = new CameraStateAdapter()

    adapter.applySnapshot({
      position: { x: 4, y: 5, z: 6 },
      fov: 50,
    }, 'menu')
    adapter.setPositionOffset('shake', { x: 1, y: -2, z: 3 })
    adapter.setFovOffset('pulse', 5)

    expect(camera.position.x).toBe(5)
    expect(camera.position.y).toBe(3)
    expect(camera.position.z).toBe(9)
    expect(camera.fov).toBe(55)
    expect(state['camera.position.x']).toBe(4)
    expect(state['camera.position.y']).toBe(5)
    expect(state['camera.position.z']).toBe(6)
    expect(state['camera.fov']).toBe(50)

    adapter.clearPositionOffset('shake')
    adapter.clearFovOffset('pulse')

    expect(camera.position.x).toBe(4)
    expect(camera.position.y).toBe(5)
    expect(camera.position.z).toBe(6)
    expect(camera.fov).toBe(50)
  })
})
