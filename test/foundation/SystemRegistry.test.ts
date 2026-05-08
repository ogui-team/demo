import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SystemRegistry,
  getRegistry,
  resetRegistry,
  RegistryGetters,
  HookedSystemRegistry,
} from '../../client/src/engine/0-foundation/runtime/SystemRegistry'

describe('SystemRegistry', () => {
  beforeEach(() => {
    resetRegistry()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetRegistry()
    delete (globalThis as any).DEBUG_SYSTEMS
  })

  it('registers, retrieves, and reports registered system keys', () => {
    const registry = new SystemRegistry()

    registry.register('WeaponSystem', { name: 'weapon' })
    expect(registry.has('WeaponSystem')).toBe(true)
    expect(registry.get('WeaponSystem')).toEqual({ name: 'weapon' })
    expect(registry.keys()).toEqual(['WeaponSystem'])
  })

  it('throws when requesting a missing required system', () => {
    const registry = new SystemRegistry()

    expect(() => registry.get('PhysicsSystem')).toThrow(
      '[SystemRegistry] FATAL: System not found: "PhysicsSystem"'
    )
  })

  it('allows optional retrieval without throwing', () => {
    const registry = new SystemRegistry()
    expect(registry.get('HUDSystem', false)).toBeNull()
  })

  it('overwrites existing system and logs warning when DEBUG_SYSTEMS is enabled', () => {
    const registry = new SystemRegistry()
    ;(globalThis as any).DEBUG_SYSTEMS = true

    registry.register('PlayerHealthSystem', { health: 100 })
    registry.register('PlayerHealthSystem', { health: 200 })

    expect(console.warn).toHaveBeenCalledWith(
      '[SystemRegistry] Overwriting existing system: PlayerHealthSystem'
    )
    expect(registry.get('PlayerHealthSystem')).toEqual({ health: 200 })
  })

  it('unregisters keys and clears all registered systems', () => {
    const registry = new SystemRegistry()
    registry.register('EntityRegistry', { id: 'entity' })
    registry.unregister('EntityRegistry')

    expect(registry.has('EntityRegistry')).toBe(false)
    expect(registry.keys()).toEqual([])

    registry.register('HUDSystem', { ui: true })
    registry.clear()
    expect(registry.keys()).toEqual([])
  })

  it('uses the singleton registry and resetRegistry clears it', () => {
    const first = getRegistry()
    first.register('WeaponSystem', { name: 'singleton' })

    const second = getRegistry()
    expect(second.get('WeaponSystem')).toEqual({ name: 'singleton' })

    resetRegistry()
    expect(() => getRegistry().get('WeaponSystem')).toThrow()
  })

  it('provides convenience getters for typed system access', () => {
    const registry = new SystemRegistry()
    registry.register('WeaponSystem', { fireWeapon: vi.fn() } as any)
    registry.register('PlayerHealthSystem', { getHealth: vi.fn() } as any)

    ;(globalThis as any).DEBUG_SYSTEMS = false
    const previous = getRegistry()
    resetRegistry()
    const singleton = getRegistry()
    singleton.register('WeaponSystem', { fireWeapon: vi.fn() } as any)
    singleton.register('PlayerHealthSystem', { getHealth: vi.fn() } as any)

    expect(RegistryGetters.getWeaponSystem()).toEqual(
      expect.objectContaining({ fireWeapon: expect.any(Function) })
    )
    expect(RegistryGetters.getPlayerHealthSystem()).toEqual(
      expect.objectContaining({ getHealth: expect.any(Function) })
    )

    resetRegistry()
  })

  it('invokes hook callbacks on register, unregister, and clear', () => {
    const hook = {
      onRegisterSystem: vi.fn(),
      onUnregisterSystem: vi.fn(),
      onClear: vi.fn(),
    }
    const registry = new HookedSystemRegistry()
    registry.addHook(hook)

    registry.register('MeshBindingTable', { id: 'mesh' })
    expect(hook.onRegisterSystem).toHaveBeenCalledWith('MeshBindingTable', { id: 'mesh' })

    registry.unregister('MeshBindingTable')
    expect(hook.onUnregisterSystem).toHaveBeenCalledWith('MeshBindingTable')

    registry.register('GameSession', { active: true })
    registry.clear()
    expect(hook.onClear).toHaveBeenCalled()
  })
})
