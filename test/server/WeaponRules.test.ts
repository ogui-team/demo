import { getWeaponRule, sanitizeWeaponId } from '../../server/src/rules/WeaponRules'

describe('WeaponRules', () => {
  it('returns the configured rule for a known weapon', () => {
    const pistol = getWeaponRule('pistol')

    expect(pistol).toEqual({
      fireRate: 2.5,
      reloadTime: 1.2,
      magazineSize: 12,
      reserveAmmo: 48,
      damage: 25,
      range: 90,
    })
  })

  it('falls back to pistol when the weapon id is unknown', () => {
    const fallbackRule = getWeaponRule('unknown-weapon')

    expect(fallbackRule).toEqual(getWeaponRule('pistol'))
  })

  it('sanitizes a valid weapon id and returns it unchanged', () => {
    expect(sanitizeWeaponId('shotgun', 'pistol')).toBe('shotgun')
  })

  it('returns the fallback for invalid weapon ids', () => {
    expect(sanitizeWeaponId('', 'pistol')).toBe('pistol')
    expect(sanitizeWeaponId('   ', 'shotgun')).toBe('shotgun')
    expect(sanitizeWeaponId('not-a-weapon', 'rifle')).toBe('rifle')
    expect(sanitizeWeaponId(123, 'flareGun')).toBe('flareGun')
  })
})
