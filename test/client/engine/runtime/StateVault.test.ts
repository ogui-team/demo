import { describe, expect, it, vi } from 'vitest'
import { StateVault } from '../../../../client/src/engine/runtime/StateVault'

describe('StateVault', () => {
  const createKernel = () => ({
    entities: { getDenseIndex: vi.fn((handle) => (handle === 1 ? 0 : -1)) },
    healths: {
      getHealth: vi.fn(() => 10),
      getMaxHealth: vi.fn(() => 12),
      setHealth: vi.fn(),
      setMaxHealth: vi.fn(),
    },
    inventories: {
      getAmmo: vi.fn(() => 5),
      getItemId: vi.fn(() => 42),
      setAmmo: vi.fn(),
      setItemId: vi.fn(),
    },
    abilities: {
      getPrimaryAbility: vi.fn(() => 7),
      setPrimaryAbility: vi.fn(),
    },
  })

  it('saves state for a valid entity handle and rejects invalid handles', () => {
    const kernel = createKernel()
    const vault = new StateVault(kernel as any)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(vault.save('entity_1', 2 as any)).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith('StateVault.save: Invalid handle 2 for entityId entity_1')
    errorSpy.mockRestore()

    expect(vault.save('entity_1', 1 as any)).toBe(true)
  })

  it('loads saved state into buffers and rejects missing or invalid state', () => {
    const kernel = createKernel()
    const vault = new StateVault(kernel as any)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(vault.load('entity_missing', 1 as any)).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith('StateVault.load: No saved state for entityId entity_missing')
    warnSpy.mockRestore()

    expect(vault.save('entity_1', 1 as any)).toBe(true)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(vault.load('entity_1', 2 as any)).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith('StateVault.load: Invalid handle 2 for entityId entity_1')
    errorSpy.mockRestore()

    expect(vault.load('entity_1', 1 as any)).toBe(true)
    expect(kernel.healths.setHealth).toHaveBeenCalledWith(0, 10)
    expect(kernel.healths.setMaxHealth).toHaveBeenCalledWith(0, 12)
    expect(kernel.inventories.setAmmo).toHaveBeenCalledWith(0, 5)
    expect(kernel.inventories.setItemId).toHaveBeenCalledWith(0, 42)
    expect(kernel.abilities.setPrimaryAbility).toHaveBeenCalledWith(0, 7)
  })

  it('validates consistency and reports mismatches', () => {
    const kernel = createKernel()
    const vault = new StateVault(kernel as any)

    expect(vault.save('entity_1', 1 as any)).toBe(true)
    expect(vault.validateConsistency('entity_1', 1 as any)).toBe('')

    kernel.healths.getHealth.mockReturnValue(99)
    const message = vault.validateConsistency('entity_1', 1 as any)
    expect(message).toContain('STATE_TRANSITION_ERROR for entity_1')
  })

  it('can clear saved state entries', () => {
    const kernel = createKernel()
    const vault = new StateVault(kernel as any)

    expect(vault.save('entity_1', 1 as any)).toBe(true)
    vault.clear('entity_1')
    expect(vault.load('entity_1', 1 as any)).toBe(false)

    expect(vault.save('entity_2', 1 as any)).toBe(true)
    vault.clearAll()
    expect(vault.load('entity_2', 1 as any)).toBe(false)
  })
})
