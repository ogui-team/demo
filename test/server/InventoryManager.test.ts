vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}))

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import { InventoryManager, makeDeterministicInstanceId } from '../../server/src/system/InventoryManager'

describe('InventoryManager', () => {
  let manager: InventoryManager
  let existsSpy: ReturnType<typeof vi.fn>
  let mkdirSpy: ReturnType<typeof vi.fn>
  let writeSpy: ReturnType<typeof vi.fn>
  let readSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    manager = new InventoryManager()
    existsSpy = fs.existsSync as unknown as ReturnType<typeof vi.fn>
    mkdirSpy = fs.mkdirSync as unknown as ReturnType<typeof vi.fn>
    writeSpy = fs.writeFileSync as unknown as ReturnType<typeof vi.fn>
    readSpy = fs.readFileSync as unknown as ReturnType<typeof vi.fn>

    vi.clearAllMocks()
    existsSpy.mockReturnValue(false)
    mkdirSpy.mockImplementation(() => undefined)
    writeSpy.mockImplementation(() => undefined)
    readSpy.mockImplementation(() => '{}')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a default inventory when none exists', () => {
    const inventory = manager.getOrCreate('player-1')

    expect(inventory.playerId).toBe('player-1')
    expect(inventory.items.length).toBeGreaterThan(0)
    expect(manager.get('player-1')).toBe(inventory)

    manager.savePlayer('player-1')
    expect(writeSpy).toHaveBeenCalled()
  })

  it('rejects unknown items and keeps the inventory intact', () => {
    const inventory = manager.getOrCreate('player-2')
    const result = manager.giveItem('player-2', 'unknown_item', 1)

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Unknown item id')
    expect(result.inventory).toBe(inventory)
  })

  it('stacks a stackable item into an existing stack', () => {
    const result = manager.giveItem('player-3', 'health_potion_sm', 2)
    const stacked = result.inventory.items.find((item) => item.itemId === 'health_potion_sm')

    expect(result.ok).toBe(true)
    expect(stacked).toBeDefined()
    expect(stacked?.quantity).toBe(3)
    expect(result.inventory.items.filter((item) => item.itemId === 'health_potion_sm')).toHaveLength(1)
    expect(writeSpy).toHaveBeenCalled()
  })

  it('moves an item to a valid destination and rejects invalid placement', () => {
    const inventory = manager.getOrCreate('player-4')
    const item = inventory.items.find((entry) => entry.itemId === 'health_potion_sm')!

    const validMove = manager.moveItem('player-4', item.instanceId, 1, 1)
    expect(validMove.ok).toBe(true)
    expect(item.gridX).toBe(1)
    expect(item.gridY).toBe(1)

    const invalidMove = manager.moveItem('player-4', item.instanceId, 100, 100)
    expect(invalidMove.ok).toBe(false)
    expect(invalidMove.reason).toContain('Invalid placement')
  })

  it('toggles equipment state and preserves weapon equip semantics', () => {
    const inventory = manager.getOrCreate('player-5')
    const pistol = inventory.items.find((entry) => entry.itemId === 'weapon_pistol')!

    const unequip = manager.toggleEquip('player-5', pistol.instanceId, 'weapon')
    expect(unequip.ok).toBe(true)
    expect(unequip.inventory.equippedWeapon).toBeNull()
    expect(pistol.equipped).toBe(false)

    const equip = manager.toggleEquip('player-5', pistol.instanceId, 'weapon')
    expect(equip.ok).toBe(true)
    expect(equip.inventory.equippedWeapon).toBe(pistol.instanceId)
    expect(pistol.equipped).toBe(true)
  })

  it('drops an item and removes it from the inventory', () => {
    const inventory = manager.getOrCreate('player-6')
    const knife = inventory.items.find((entry) => entry.itemId === 'weapon_knife')!

    const drop = manager.dropItem('player-6', knife.instanceId)
    expect(drop.ok).toBe(true)
    expect(drop.inventory.items.some((item) => item.instanceId === knife.instanceId)).toBe(false)
  })

  it('evicts a cached inventory and reports diagnostics', () => {
    manager.getOrCreate('player-7')
    manager.evict('player-7')

    expect(manager.get('player-7')).toBeNull()
    expect(manager.getDiagnostics()).toEqual(
      expect.objectContaining({
        status: 'ok',
        active: true,
        metrics: expect.objectContaining({ cachedInventories: 0 }),
      }),
    )
  })

  it('emits change events for inventory mutations', () => {
    const listener = vi.fn()
    manager.onChanged(listener)

    manager.giveItem('player-8', 'health_potion_sm', 1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ action: 'stack', playerId: 'player-8' }))
  })

  it('loads inventory from disk when present', () => {
    existsSpy.mockReturnValue(true)
    readSpy.mockReturnValue(JSON.stringify({
      playerId: 'player-9',
      cols: 10,
      rows: 6,
      items: [],
      equippedWeapon: null,
      equippedArmor: null,
      version: 1,
    }))

    const inventory = manager.getOrCreate('player-9')

    expect(inventory.playerId).toBe('player-9')
    expect(inventory.items).toEqual([])
    expect(manager.get('player-9')).toBe(inventory)
  })

  it('falls back to a default inventory when disk data is invalid', () => {
    existsSpy.mockReturnValue(true)
    readSpy.mockReturnValue('not valid json')

    const inventory = manager.getOrCreate('player-23')

    expect(inventory.playerId).toBe('player-23')
    expect(inventory.items.length).toBeGreaterThan(0)
    expect(manager.get('player-23')).toBe(inventory)
  })

  it('does not save an uncached player inventory', () => {
    manager.savePlayer('missing-player')
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('saves a cached inventory and updates disk write diagnostics', () => {
    manager.getOrCreate('player-21')
    manager.savePlayer('player-21')

    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(manager.getDiagnostics()).toEqual(
      expect.objectContaining({
        metrics: expect.objectContaining({ diskWriteCount: 1 }),
      }),
    )
  })

  it('emits an evict event when a cached inventory is removed', () => {
    const listener = vi.fn()
    manager.onChanged(listener)

    manager.getOrCreate('player-22')
    manager.evict('player-22')

    expect(manager.get('player-22')).toBeNull()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ action: 'evict', playerId: 'player-22' }))
  })

  it('gives a non-stackable item into the first available slot', () => {
    const inventory = manager.getOrCreate('player-10')
    const initialCount = inventory.items.length

    const result = manager.giveItem('player-10', 'weapon_smg', 1)
    const added = result.inventory.items.find((item) => item.itemId === 'weapon_smg')

    expect(result.ok).toBe(true)
    expect(result.inventory.items).toHaveLength(initialCount + 1)
    expect(added).toBeDefined()
    expect(added?.gridX).toBeGreaterThanOrEqual(0)
    expect(added?.gridY).toBeGreaterThanOrEqual(0)
  })

  it('rejects move requests for unknown item instances', () => {
    manager.getOrCreate('player-11')
    const result = manager.moveItem('player-11', 'nonexistent-instance', 1, 1)

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Item instance not found')
  })

  it('rejects move requests that overlap another item', () => {
    const inventory = manager.getOrCreate('player-17')
    const pistol = inventory.items.find((item) => item.itemId === 'weapon_pistol')!

    const result = manager.moveItem('player-17', pistol.instanceId, 3, 0)

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Invalid placement')
  })

  it('rejects equip toggles for unknown item instances', () => {
    manager.getOrCreate('player-18')
    const result = manager.toggleEquip('player-18', 'missing-instance', 'weapon')

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Item instance not found')
  })

  it('rejects drops for unknown item instances', () => {
    manager.getOrCreate('player-19')
    const result = manager.dropItem('player-19', 'missing-instance')

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Item instance not found')
  })

  it('creates a second stack when a stackable item is already full', () => {
    const inventory = manager.getOrCreate('player-16')
    const basePotion = inventory.items.find((item) => item.itemId === 'health_potion_sm')!

    const fillStack = manager.giveItem('player-16', 'health_potion_sm', 1)
    expect(fillStack.ok).toBe(true)
    expect(fillStack.inventory.items.find((item) => item.instanceId === basePotion.instanceId)?.quantity).toBe(3)

    const secondStack = manager.giveItem('player-16', 'health_potion_sm', 1)
    const potionStacks = secondStack.inventory.items.filter((item) => item.itemId === 'health_potion_sm')
    expect(secondStack.ok).toBe(true)
    expect(potionStacks).toHaveLength(2)
    expect(potionStacks.find((item) => item.instanceId !== basePotion.instanceId)?.quantity).toBe(1)
  })

  it('equips armor and replaces a previously equipped armor item', () => {
    const initial = manager.getOrCreate('player-12')
    const vestResult = manager.giveItem('player-12', 'armor_vest', 1)
    const vest = vestResult.inventory.items.find((item) => item.itemId === 'armor_vest')!

    const equipVest = manager.toggleEquip('player-12', vest.instanceId, 'armor')
    expect(equipVest.ok).toBe(true)
    expect(equipVest.inventory.equippedArmor).toBe(vest.instanceId)
    expect(vest.equipped).toBe(true)

    const helmetResult = manager.giveItem('player-12', 'armor_helmet', 1)
    const helmet = helmetResult.inventory.items.find((item) => item.itemId === 'armor_helmet')!
    const equipHelmet = manager.toggleEquip('player-12', helmet.instanceId, 'armor')

    expect(equipHelmet.ok).toBe(true)
    expect(equipHelmet.inventory.equippedArmor).toBe(helmet.instanceId)
    expect(helmet.equipped).toBe(true)
    expect(vest.equipped).toBe(false)
  })

  it('drops an equipped item and clears the equip slot', () => {
    const inventory = manager.getOrCreate('player-13')
    const pistol = inventory.items.find((entry) => entry.itemId === 'weapon_pistol')!

    expect(inventory.equippedWeapon).toBe(pistol.instanceId)

    const drop = manager.dropItem('player-13', pistol.instanceId)
    expect(drop.ok).toBe(true)
    expect(drop.inventory.equippedWeapon).toBeNull()
    expect(drop.inventory.items.some((item) => item.instanceId === pistol.instanceId)).toBe(false)
  })

  it('unsubscribes event listeners when the returned callback is called', () => {
    const listener = vi.fn()
    const unsubscribe = manager.onChanged(listener)
    unsubscribe()

    manager.giveItem('player-14', 'weapon_smg', 1)
    expect(listener).not.toHaveBeenCalled()
  })

  it('reports diagnostics with mutation and disk write counts', () => {
    manager.giveItem('player-15', 'weapon_smg', 1)
    manager.savePlayer('player-15')

    expect(manager.getDiagnostics()).toEqual(
      expect.objectContaining({
        metrics: expect.objectContaining({
          mutationCount: 1,
          diskWriteCount: 2,
        }),
      }),
    )
  })

  it('generates deterministic instance IDs from the helper', () => {
    const idA = makeDeterministicInstanceId('player-16', 0, 'weapon_pistol')
    const idB = makeDeterministicInstanceId('player-16', 0, 'weapon_pistol')
    const idC = makeDeterministicInstanceId('player-16', 1, 'weapon_pistol')

    expect(idA).toBe(idB)
    expect(idA).not.toBe(idC)
  })
})
