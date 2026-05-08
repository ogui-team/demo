import { executeGameplayCommand, mapLegacyGameplayAction } from '../../server/src/gameplay/GameplayCommands'

const createDefaultOptions = () => ({
  actor: {
    id: 'player-1',
    dead: false,
    rotation: { x: 0, y: 0, z: 0 },
    equipment: ['weapon_pistol'],
    mana: 50,
  } as any,
  command: 'weapon_equip' as const,
  data: {},
  weaponStates: new Map<string, any>(),
  canUseWeapons: () => true,
  syncPlayerEntity: vi.fn(),
  pushGameplayEvent: vi.fn(),
  dispatchGameplayCommand: vi.fn(),
  sanitizeOrigin: () => ({ x: 0, y: 0, z: 0 }),
  sanitizeDirection: () => ({ x: 0, y: 0, z: 1 }),
  sanitizeTimestamp: () => 1234,
  validateHitscan: () => null,
  resolveAbilityProjectileTarget: () => null,
  applyDamage: vi.fn(),
  validateAbilityUse: () => ({ accepted: true, cooldownSec: 0, manaCost: 0 }),
  buildAbilityMovementIntent: () => undefined,
  applyAbilityMovementStatuses: vi.fn(),
  readFiniteNumber: (value: unknown) => (typeof value === 'number' ? value : undefined),
  clamp01: (value: number) => Math.max(0, Math.min(1, value)),
  allowDebugStatusHooks: false,
})

describe('GameplayCommands', () => {
  it('maps legacy gameplay actions to modern command identifiers', () => {
    expect(mapLegacyGameplayAction('WEAPON_EQUIP')).toBe('weapon_equip')
    expect(mapLegacyGameplayAction('USE_ABILITY')).toBe('use_ability')
    expect(mapLegacyGameplayAction('UNKNOWN_ACTION')).toBeNull()
  })

  it('equips a new weapon and emits a gameplay event', () => {
    const options = createDefaultOptions()
    options.command = 'weapon_equip'
    options.data = { weaponId: 'shotgun' }

    executeGameplayCommand(options)

    expect(options.actor.equipment[0]).toBe('shotgun')
    expect(options.syncPlayerEntity).toHaveBeenCalledWith('player-1')
    expect(options.pushGameplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'weapon_equip', playerId: 'player-1', weaponId: 'shotgun' }),
    )
  })

  it('uses an ability, deducts mana, and dispatches an ability event', () => {
    const options = createDefaultOptions()
    options.command = 'use_ability'
    options.data = { abilityId: 'ability_arcane_burst' }
    options.validateAbilityUse = () => ({ accepted: true, cooldownSec: 2, manaCost: 10 })
    options.buildAbilityMovementIntent = () => ({ direction: { x: 1, y: 0, z: 0 }, speed: 1 })

    executeGameplayCommand(options)

    expect(options.actor.mana).toBe(40)
    expect(options.actor.pendingMovementIntent).toEqual({ direction: { x: 1, y: 0, z: 0 }, speed: 1 })
    expect(options.applyAbilityMovementStatuses).toHaveBeenCalledWith(options.actor, 'ability_arcane_burst', options.data, expect.any(Number))
    expect(options.syncPlayerEntity).toHaveBeenCalledWith('player-1')
    expect(options.pushGameplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'use_ability', playerId: 'player-1', abilityId: 'ability_arcane_burst' }),
    )
  })

  it('uses a projectile ability and applies damage to the first visible target', () => {
    const options = createDefaultOptions()
    options.command = 'use_ability'
    options.data = {
      abilityId: 'ability_fireball',
      origin: { x: 0, y: 1.65, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
    }
    options.validateAbilityUse = () => ({ accepted: true, cooldownSec: 2, manaCost: 0 })
    options.resolveAbilityProjectileTarget = () => 'target-1'
    options.applyDamage = vi.fn()

    executeGameplayCommand(options)

    expect(options.applyDamage).toHaveBeenCalledWith('target-1', 25, 'player-1')
    expect(options.pushGameplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'use_ability', playerId: 'player-1', abilityId: 'ability_fireball', hitId: 'target-1' }),
    )
  })

  it('uses a projectile ability without applying damage when no target is visible', () => {
    const options = createDefaultOptions()
    options.command = 'use_ability'
    options.data = {
      abilityId: 'ability_fireball',
      origin: { x: 0, y: 1.65, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
    }
    options.validateAbilityUse = () => ({ accepted: true, cooldownSec: 2, manaCost: 0 })
    options.resolveAbilityProjectileTarget = () => null
    options.applyDamage = vi.fn()

    executeGameplayCommand(options)

    expect(options.applyDamage).not.toHaveBeenCalled()
    expect(options.pushGameplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'use_ability', playerId: 'player-1', abilityId: 'ability_fireball', hitId: null }),
    )
  })

  it('shoots a weapon and applies damage when hitscan returns a target', () => {
    const options = createDefaultOptions()
    options.command = 'player_shoot'
    options.data = {
      weapon: 'pistol',
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      timestamp: 1000,
      shotId: 'test-shot',
    }
    options.validateHitscan = () => 'target-1'
    options.applyDamage = vi.fn()

    executeGameplayCommand(options)

    expect(options.applyDamage).toHaveBeenCalledWith('target-1', expect.any(Number), 'player-1')
    expect(options.syncPlayerEntity).toHaveBeenCalledWith('player-1')
    expect(options.pushGameplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'player_shoot', shooterId: 'player-1', hitId: 'target-1' }),
    )
  })

  it('applies a debug status movement override when hooks are allowed', () => {
    const options = createDefaultOptions()
    options.command = 'debug_set_status_movement'
    options.data = { rooted: true, speedMultiplier: 0.2 }
    options.allowDebugStatusHooks = true

    executeGameplayCommand(options)

    expect(options.actor.debugStatusOverride).toEqual(
      expect.objectContaining({ rooted: true, chilled: false, electrocuted: false }),
    )
    expect(options.syncPlayerEntity).toHaveBeenCalledWith('player-1')
  })

  it('rejects ability use when validation fails and does not sync', () => {
    const options = createDefaultOptions()
    options.command = 'use_ability'
    options.data = { abilityId: 'ability_arcane_burst' }
    options.validateAbilityUse = () => ({ accepted: false, cooldownSec: 0, manaCost: 0 })

    executeGameplayCommand(options)

    expect(options.actor.mana).toBe(50)
    expect(options.syncPlayerEntity).not.toHaveBeenCalled()
    expect(options.pushGameplayEvent).not.toHaveBeenCalled()
  })

  it('reloads when shooting with no ammo and reserve ammo available', () => {
    const options = createDefaultOptions()
    options.command = 'player_shoot'
    options.data = {
      weapon: 'pistol',
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      timestamp: 1000,
      shotId: 'test-shot',
    }
    options.validateHitscan = () => null
    options.applyDamage = vi.fn()
    options.dispatchGameplayCommand = vi.fn()
    options.weaponStates.set('player-1', {
      equippedWeaponId: 'pistol',
      currentAmmo: 0,
      reserveAmmo: 5,
      lastShotAt: 0,
      isReloading: false,
      reloadEndsAt: 0,
    })

    executeGameplayCommand(options)

    expect(options.applyDamage).not.toHaveBeenCalled()
    expect(options.dispatchGameplayCommand).toHaveBeenCalledWith('weapon_reload', expect.objectContaining({ weaponId: 'pistol' }))
  })

  it('performs a successful weapon reload and emits an event', () => {
    const options = createDefaultOptions()
    options.command = 'weapon_reload'
    options.data = { weaponId: 'pistol' }
    options.weaponStates.set('player-1', {
      equippedWeaponId: 'pistol',
      currentAmmo: 0,
      reserveAmmo: 2,
      lastShotAt: 0,
      isReloading: false,
      reloadEndsAt: 0,
    })

    executeGameplayCommand(options)

    const weaponState = options.weaponStates.get('player-1')
    expect(weaponState.isReloading).toBe(true)
    expect(weaponState.reloadEndsAt).toBeGreaterThan(0)
    expect(options.syncPlayerEntity).toHaveBeenCalledWith('player-1')
    expect(options.pushGameplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'weapon_reload', playerId: 'player-1', weaponId: 'pistol' }),
    )
  })

  it('does not reload when weapon use is disallowed', () => {
    const options = createDefaultOptions()
    options.command = 'weapon_reload'
    options.data = { weaponId: 'pistol' }
    options.canUseWeapons = () => false
    options.weaponStates.set('player-1', {
      equippedWeaponId: 'pistol',
      currentAmmo: 0,
      reserveAmmo: 2,
      lastShotAt: 0,
      isReloading: false,
      reloadEndsAt: 0,
    })

    executeGameplayCommand(options)

    expect(options.syncPlayerEntity).not.toHaveBeenCalled()
    expect(options.pushGameplayEvent).not.toHaveBeenCalled()
  })

  it('shoots a weapon and emits a player_shoot event without a hit', () => {
    const options = createDefaultOptions()
    options.command = 'player_shoot'
    options.data = {
      weapon: 'pistol',
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      timestamp: 1000,
      shotId: 'test-shot',
    }
    options.validateHitscan = () => null
    options.applyDamage = vi.fn()
    options.weaponStates.set('player-1', {
      equippedWeaponId: 'pistol',
      currentAmmo: 2,
      reserveAmmo: 3,
      lastShotAt: 0,
      isReloading: false,
      reloadEndsAt: 0,
    })

    executeGameplayCommand(options)

    expect(options.applyDamage).not.toHaveBeenCalled()
    expect(options.syncPlayerEntity).toHaveBeenCalledWith('player-1')
    expect(options.pushGameplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'player_shoot', shooterId: 'player-1', hitId: null }),
    )
  })

  it('skips use_ability when abilityId is missing', () => {
    const options = createDefaultOptions()
    options.command = 'use_ability'
    options.data = { abilityId: '' }
    options.validateAbilityUse = () => ({ accepted: true, cooldownSec: 0, manaCost: 0 })

    executeGameplayCommand(options)

    expect(options.actor.mana).toBe(50)
    expect(options.pushGameplayEvent).not.toHaveBeenCalled()
    expect(options.syncPlayerEntity).not.toHaveBeenCalled()
  })

  it('does not reload when reserve ammo is empty', () => {
    const options = createDefaultOptions()
    options.command = 'player_shoot'
    options.data = {
      weapon: 'pistol',
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      timestamp: 1000,
      shotId: 'test-shot',
    }
    options.validateHitscan = () => null
    options.applyDamage = vi.fn()
    options.dispatchGameplayCommand = vi.fn()
    options.weaponStates.set('player-1', {
      equippedWeaponId: 'pistol',
      currentAmmo: 0,
      reserveAmmo: 0,
      lastShotAt: 0,
      isReloading: false,
      reloadEndsAt: 0,
    })

    executeGameplayCommand(options)

    expect(options.applyDamage).not.toHaveBeenCalled()
    expect(options.dispatchGameplayCommand).not.toHaveBeenCalled()
  })

  it('does not shoot while weapon is reloading', () => {
    const options = createDefaultOptions()
    options.command = 'player_shoot'
    options.data = {
      weapon: 'pistol',
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      timestamp: 1000,
      shotId: 'test-shot',
    }
    options.validateHitscan = () => 'target-1'
    options.applyDamage = vi.fn()
    options.dispatchGameplayCommand = vi.fn()
    options.weaponStates.set('player-1', {
      equippedWeaponId: 'pistol',
      currentAmmo: 5,
      reserveAmmo: 10,
      lastShotAt: 0,
      isReloading: true,
      reloadEndsAt: Date.now() + 10000,
    })

    executeGameplayCommand(options)

    expect(options.applyDamage).not.toHaveBeenCalled()
    expect(options.dispatchGameplayCommand).not.toHaveBeenCalled()
  })
})
