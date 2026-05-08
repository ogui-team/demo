import { ABILITY_VALIDATION_PROFILES, MOVEMENT_STATUS_DURATIONS_MS } from '../../server/src/rules/AbilityRules'

describe('AbilityRules', () => {
  it('has valid ability validation profiles', () => {
    expect(Object.keys(ABILITY_VALIDATION_PROFILES).length).toBeGreaterThan(0)

    for (const [abilityId, profile] of Object.entries(ABILITY_VALIDATION_PROFILES)) {
      expect(profile.delivery).toMatch(/Hitscan|Projectile|AoE|Summon/)
      expect(profile.cooldownSec).toBeGreaterThanOrEqual(0)
      expect(profile.manaCost).toBeGreaterThanOrEqual(0)
    }
  })

  it('defines movement status durations for all status types', () => {
    expect(MOVEMENT_STATUS_DURATIONS_MS['status_rooted']).toBe(2000)
    expect(MOVEMENT_STATUS_DURATIONS_MS['status_chilled']).toBe(3000)
    expect(MOVEMENT_STATUS_DURATIONS_MS['status_electrocuted']).toBe(800)
  })

  it('validates hitscan ability has maximum range', () => {
    const profile = ABILITY_VALIDATION_PROFILES.ability_lightning_chain
    expect(profile.maxRange).toBeDefined()
    expect(profile.maxRange).toBeGreaterThan(0)
  })

  it('validates projectile ability has projectile speed', () => {
    const profile = ABILITY_VALIDATION_PROFILES.ability_launch_grenade
    expect(profile.projectileSpeed).toBeDefined()
    expect(profile.projectileSpeed).toBeGreaterThan(0)
  })

  it('validates fireball ability has projectile speed and range', () => {
    const profile = ABILITY_VALIDATION_PROFILES.ability_fireball
    expect(profile).toBeDefined()
    expect(profile.delivery).toBe('Projectile')
    expect(profile.projectileSpeed).toBeGreaterThan(0)
    expect(profile.maxLifetimeSec).toBeGreaterThan(0)
  })

  it('validates aoe ability has radius', () => {
    const profile = ABILITY_VALIDATION_PROFILES.ability_arcane_burst
    expect(profile.maxRadius).toBeDefined()
    expect(profile.maxRadius).toBeGreaterThan(0)
  })

  it('validates summon ability has max active summons limit', () => {
    const profile = ABILITY_VALIDATION_PROFILES.ability_summon_skeleton
    expect(profile.maxActiveSummons).toBeDefined()
    expect(profile.maxActiveSummons).toBeGreaterThan(0)
  })
})
