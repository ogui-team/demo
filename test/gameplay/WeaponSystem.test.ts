import { gameBus } from '../../client/src/engine/core/EventBus'
import { WeaponSystem } from '../../client/src/engine/gameplay/systems/WeaponSystem'
import type { WeaponDefinition } from '../../client/src/engine/gameplay/systems/WeaponContracts'

describe('WeaponSystem', () => {
  let weaponSystem: WeaponSystem
  let stateStore: Record<string, any>
  let physicsMock: any
  let healthMock: any
  let entityManagerMock: any
  let prefabSystemMock: any
  let multiplayerMock: any

  const pistolDefinition: WeaponDefinition = {
    name: 'Test Pistol',
    fireMode: 'hitscan',
    damage: 10,
    fireRate: 2,
    magazineSize: 6,
    reserveAmmoCap: 24,
    autoReload: true,
    reloadTime: 1,
    range: 50,
    damageType: 'bullet',
    animation: { equipClip: 'equip', fireClip: 'fire', reloadClip: 'reload' },
  }

  beforeEach(() => {
    stateStore = {}
    physicsMock = {
      getBody: vi.fn(() => undefined),
      overlapSphere: vi.fn(() => []),
      raycastFirst: vi.fn(() => null),
      addBody: vi.fn(),
      removeBody: vi.fn(),
    }
    healthMock = {
      applyDamage: vi.fn(() => 10),
    }
    entityManagerMock = {
      createEntity: vi.fn(() => ({ id: 'proj-1', addComponent: vi.fn() })),
      getEntity: vi.fn(() => ({ setPosition: vi.fn() })),
      destroyEntity: vi.fn(),
    }
    prefabSystemMock = {
      create: vi.fn(() => ({ id: 'visual-1' })),
    }
    multiplayerMock = {
      connected: true,
      sendGameplayCommand: vi.fn(),
    }
    gameBus.clear()
    weaponSystem = new WeaponSystem(physicsMock, healthMock, {
      set(path: string, value: unknown) {
        stateStore[path] = value
      },
    }, {
      entityManager: entityManagerMock,
      prefabSystem: prefabSystemMock,
      multiplayer: multiplayerMock,
      enableLogging: false,
    })
  })

  it('registers weapons and lists them', () => {
    weaponSystem.registerWeapon('test_pistol', pistolDefinition)
    expect(weaponSystem.getDefinition('test_pistol')).toEqual(expect.objectContaining({ name: 'Test Pistol' }))
    expect(weaponSystem.listWeapons()).toContain('test_pistol')
    const summary = weaponSystem.logWeapons()
    expect(summary).toContain('test_pistol')
  })

  it('gives a weapon and equips it automatically', () => {
    weaponSystem.registerWeapon('test_pistol', pistolDefinition)
    const result = weaponSystem.giveWeapon('player1', 'test_pistol', 12)
    expect(result).toBe(true)
    expect(weaponSystem.getEquipped('player1')).toBe('test_pistol')
    expect(weaponSystem.getCurrentAmmo('player1')).toBe(6)
    expect(weaponSystem.getReserveAmmo('player1')).toBe(12)
  })

  it('adds reserve ammo with cap enforcement', () => {
    weaponSystem.registerWeapon('test_pistol', pistolDefinition)
    weaponSystem.giveWeapon('player1', 'test_pistol', 5)
    const added = weaponSystem.addAmmo('player1', 'test_pistol', 10)
    expect(added).toBe(true)
    expect(weaponSystem.getReserveAmmo('player1')).toBe(15)
  })

  it('exports and imports weapon state correctly', () => {
    weaponSystem.registerWeapon('test_pistol', pistolDefinition)
    weaponSystem.giveWeapon('player1', 'test_pistol', 5)
    const snapshot = weaponSystem.exportState()
    const newSystem = new WeaponSystem(physicsMock, healthMock, { set: vi.fn() }, { enableLogging: false })
    newSystem.importState(snapshot)
    expect(newSystem.getEquipped('player1')).toBe('test_pistol')
    expect(newSystem.getCurrentAmmo('player1')).toBe(6)
  })

  it('fires hitscan weapon and triggers hit callback', () => {
    const hitSpy = vi.fn()
    weaponSystem.setFireContextResolver(() => ({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } }))
    weaponSystem.onHit(hitSpy)
    weaponSystem.registerWeapon('test_pistol', pistolDefinition)
    weaponSystem.giveWeapon('player1', 'test_pistol', 5)

    // Provide resolver for the hitscan path
    weaponSystem.setHitscanResolver(() => ({ entityId: 'target', point: { x: 0, y: 0, z: -10 } }))

    const fired = weaponSystem.fire('player1')
    expect(fired).toBe(true)
    expect(healthMock.applyDamage).toHaveBeenCalledWith('target', expect.objectContaining({ amount: 10, sourceId: 'player1' }))
    expect(hitSpy).toHaveBeenCalledOnce()
  })

  it('reloads weapon when auto-reload is triggered after empty magazine', () => {
    weaponSystem.registerWeapon('test_pistol', pistolDefinition)
    weaponSystem.giveWeapon('player1', 'test_pistol', 2)
    weaponSystem.onReload(vi.fn())
    weaponSystem.setFireContextResolver(() => ({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } }))
    weaponSystem.setHitscanResolver(() => ({ entityId: 'target', point: { x: 0, y: 0, z: -10 } }))

    const entry = weaponSystem.getInventoryEntry('player1', 'test_pistol')!
    entry.currentAmmo = 0
    entry.fireCooldown = 0

    const fired = weaponSystem.fire('player1')
    expect(fired).toBe(false)
    expect(weaponSystem.isReloading('player1')).toBe(true)
  })

  it('applies remote reload and sets reloading flag', () => {
    weaponSystem.registerWeapon('test_pistol', pistolDefinition)
    weaponSystem.giveWeapon('player1', 'test_pistol', 2)
    const entry = weaponSystem.getInventoryEntry('player1', 'test_pistol')!
    entry.currentAmmo = 0

    const result = weaponSystem.applyRemoteReload('player1', 'test_pistol')
    expect(result).toBe(true)
    expect(weaponSystem.isReloading('player1')).toBe(true)
  })

  it('records remote shot and emits weaponFired event', () => {
    const fireSpy = vi.fn()
    weaponSystem.onFire(fireSpy)
    weaponSystem.registerWeapon('test_pistol', pistolDefinition)
    const result = weaponSystem.recordRemoteShot('player1', 'test_pistol', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })
    expect(result).toBe(true)
    expect(fireSpy).toHaveBeenCalledOnce()
  })

  it('uses sync ammo state to emit ammo changed events', () => {
    const ammoSpy = vi.fn()
    weaponSystem.onAmmoChange(ammoSpy)
    weaponSystem.registerWeapon('test_pistol', pistolDefinition)
    weaponSystem.giveWeapon('player1', 'test_pistol', 3)
    weaponSystem.addAmmo('player1', 'test_pistol', 2)
    expect(ammoSpy).toHaveBeenCalled()
  })

  it('clears all player state and resets projectiles', () => {
    weaponSystem.registerWeapon('test_pistol', pistolDefinition)
    weaponSystem.giveWeapon('player1', 'test_pistol', 5)
    weaponSystem.clearAll()
    expect(weaponSystem.getEquipped('player1')).toBeUndefined()
    expect(weaponSystem.getDiagnostics().trackedPlayers).toBe(0)
  })
})

