import { ensureWeaponState, resetWeaponState, updateWeaponRuntime, type WeaponRuntimeState } from '../../server/src/rules/WeaponRuntime'
import { getWeaponRule } from '../../server/src/rules/WeaponRules'

describe('WeaponRuntime', () => {
  let weaponStates: Map<string, WeaponRuntimeState>

  beforeEach(() => {
    weaponStates = new Map()
  })

  it('ensures weapon state creation with defaults', () => {
    const state = ensureWeaponState(weaponStates, 'player1', 'pistol')

    expect(state).toBeDefined()
    expect(state.equippedWeaponId).toBe('pistol')
    expect(state.currentAmmo).toBe(12)
    expect(state.isReloading).toBe(false)
  })

  it('returns existing state without recreation', () => {
    const first = ensureWeaponState(weaponStates, 'player1', 'pistol')
    first.currentAmmo = 5
    const second = ensureWeaponState(weaponStates, 'player1', 'shotgun')

    expect(second.currentAmmo).toBe(5)
  })

  it('resets weapon state to initial values', () => {
    ensureWeaponState(weaponStates, 'player1', 'rifle')
    const state = weaponStates.get('player1')!
    state.currentAmmo = 0
    state.isReloading = true

    resetWeaponState(weaponStates, 'player1', 'rifle')

    expect(state.currentAmmo).toBe(30)
    expect(state.isReloading).toBe(false)
  })

  it('completes reload and refills ammo', () => {
    const state = ensureWeaponState(weaponStates, 'player1', 'shotgun')
    state.currentAmmo = 2
    state.reserveAmmo = 8
    state.isReloading = true
    state.reloadEndsAt = Date.now() - 100

    const now = Date.now()
    const updated = updateWeaponRuntime(weaponStates, now)

    expect(updated).toContain('player1')
    expect(state.isReloading).toBe(false)
    expect(state.currentAmmo).toBe(6)
    expect(state.reserveAmmo).toBe(4)
  })

  it('does not complete reload if still in progress', () => {
    const state = ensureWeaponState(weaponStates, 'player1', 'pistol')
    state.isReloading = true
    state.reloadEndsAt = Date.now() + 1000

    const updated = updateWeaponRuntime(weaponStates, Date.now())

    expect(updated).not.toContain('player1')
    expect(state.isReloading).toBe(true)
  })

  it('handles multiple players with different weapon states', () => {
    ensureWeaponState(weaponStates, 'player1', 'pistol')
    ensureWeaponState(weaponStates, 'player2', 'rifle')

    expect(weaponStates.get('player1')!.equippedWeaponId).toBe('pistol')
    expect(weaponStates.get('player2')!.equippedWeaponId).toBe('rifle')
  })
})
