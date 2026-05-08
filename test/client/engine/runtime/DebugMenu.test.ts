import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

let debugMenu: typeof import('../../../../client/src/engine/runtime/DebugMenu')

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  window.alert = vi.fn()
  document.body.innerHTML = ''
  delete (window as any).__InventorySystem
  delete (globalThis as any).__dummyEnemySystem

  debugMenu = await import('../../../../client/src/engine/runtime/DebugMenu')
  debugMenu.initDebugMenu()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DebugMenu', () => {
  it('initializes the debug menu and toggles visibility via F6', () => {
    const menu = document.getElementById('debug-menu')
    expect(menu).not.toBeNull()
    expect(menu?.style.display).toBe('none')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6' }))
    expect(menu?.style.display).toBe('block')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6' }))
    expect(menu?.style.display).toBe('none')
  })

  it('toggles collider visibility using the engine scene traverse', () => {
    const box1 = { userData: { debugType: 'staticCollider' }, visible: false }
    const box2 = { userData: { debugType: 'staticCollider' }, visible: false }
    const scene = { traverse: (cb: (obj: any) => void) => [box1, box2].forEach(cb) }
    ;(window as any).__Engine = { getEngineScene: () => scene }

    expect(box1.visible).toBe(false)
    expect(box2.visible).toBe(false)

    debugMenu.toggleColliders()

    expect(box1.visible).toBe(true)
    expect(box2.visible).toBe(true)
  })

  it('creates and toggles debug static collider boxes from collision authority layout when none exist', () => {
    const boxData = { id: 'box1', position: { x: 0, y: 2, z: 4 }, halfExtents: { x: 1, y: 1, z: 1 } }
    const scene = {
      children: [] as any[],
      add(obj: any) { this.children.push(obj) },
      traverse(cb: (obj: any) => void) { this.children.forEach(cb) },
    }

    const collisionAuthority = {
      getStaticLayout: vi.fn(() => ({ boxes: [boxData] })),
    }

    ;(window as any).__Engine = {
      getEngineScene: () => scene,
      getSystemContext: () => ({ systems: { clientCollisionAuthoritySystem: collisionAuthority } }),
    }

    expect(scene.children.length).toBe(0)

    debugMenu.toggleColliders()

    expect(scene.children.length).toBe(1)
    expect(scene.children[0].userData?.debugType).toBe('staticCollider')
    expect(scene.children[0].visible).toBe(true)
    expect(collisionAuthority.getStaticLayout).toHaveBeenCalled()
  })

  it('spawns 500 health packs when inventory system is available', () => {
    const spawnPickup = vi.fn()
    ;(window as any).__InventorySystem = { spawnPickup }

    debugMenu.spawnHealthPacks()

    expect(spawnPickup).toHaveBeenCalledTimes(500)
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('spawns a bite army through the dummy enemy system', () => {
    const spawnArmy = vi.fn(() => Array(500).fill('dummy'))
    const setIdleBobActive = vi.fn()
    ;(globalThis as any).__dummyEnemySystem = { spawnArmy, setIdleBobActive }

    debugMenu.spawnBiteArmy()

    expect(spawnArmy).toHaveBeenCalledWith(500, { x: 16, y: 1, z: 16 }, 2.0)
    expect(setIdleBobActive).toHaveBeenCalledWith(true)
  })
})
