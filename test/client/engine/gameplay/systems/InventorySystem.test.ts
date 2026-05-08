import { describe, expect, it, vi, beforeEach } from 'vitest'
import { InventorySystem } from '@engine/gameplay/systems/InventorySystem'

describe('InventorySystem', () => {
  let state: { [key: string]: unknown }
  let stateManager: { set: (key: string, value: unknown) => void; update: (updates: Record<string, unknown>) => void; get: (key: string) => unknown }
  let healthSystem: { heal: vi.Mock; get: vi.Mock }
  let weapons: { equip: vi.Mock; addAmmo: vi.Mock; pickupWeapon: vi.Mock }
  let prefabSystem: { create: vi.Mock; remove: vi.Mock }

  beforeEach(() => {
    state = {}
    stateManager = {
      set: vi.fn((key: string, value: unknown) => { state[key] = value }),
      update: vi.fn((updates: Record<string, unknown>) => Object.assign(state, updates)),
      get: vi.fn((key: string) => state[key]),
    }
    healthSystem = {
      heal: vi.fn(() => 10),
      get: vi.fn(() => ({ armor: 0.1 })),
    }
    weapons = {
      equip: vi.fn(() => true),
      addAmmo: vi.fn(() => true),
      pickupWeapon: vi.fn(() => true),
    }
    prefabSystem = {
      create: vi.fn(() => ({ id: 'prefab-entity' })),
      remove: vi.fn(() => true),
    }
  })

  it('defines items, manages inventory slots, and equips a weapon', () => {
    const system = new InventorySystem({ health: healthSystem as any, weapons: weapons as any, prefabSystem: prefabSystem as any, state: stateManager as any })
    ;(system as any).isPlayActive = true

    system.defineItem('health_small', { type: 'health', label: 'Health Pack', maxStack: 3, healAmount: 25, quickSlot: 0 })
    system.defineItem('shotgun_shells', { type: 'ammo', label: 'Shells', weapon: 'shotgun', amount: 8, maxStack: 6 })
    system.defineItem('weapon_shotgun', { type: 'weapon', label: 'Shotgun', weaponKey: 'shotgun', maxStack: 1, autoEquip: true })

    const inventory = system.getInventory('player-1')
    expect(inventory.length).toBe(0)

    expect(system.addItem('player-1', 'health_small', 2)).toBe(true)
    expect(system.getInventory('player-1')[0].itemId).toBe('health_small')
    expect(system.getInventory('player-1')[0].quantity).toBe(2)

    expect(system.addItem('player-1', 'weapon_shotgun', 1)).toBe(true)
    expect(weapons.equip).not.toHaveBeenCalled()

    expect(system.equipSlot('player-1', 1)).toBe(true)
    expect(weapons.equip).toHaveBeenCalledWith('player-1', 'shotgun')
    expect(system.quickSwap('player-1', 1)).toBe(true)

    expect(system.useItem('player-1', 0)).toBe(true)
    expect(healthSystem.heal).toHaveBeenCalled()

    expect(system.removeItem('player-1', 0, 1)).toBe(true)
  })

  it('exports and imports state, and handles pickup creation and removal', () => {
    const system = new InventorySystem({ health: healthSystem as any, weapons: weapons as any, prefabSystem: prefabSystem as any, state: stateManager as any })
    ;(system as any).isPlayActive = true

    system.defineItem('health_small', { type: 'health', label: 'Health Pack', maxStack: 3, healAmount: 25, prefabName: 'pickup_medkit' })
    const pickupId = system.createPickup('health_small', { x: 0, y: 0, z: 0 })
    expect(pickupId).toContain('pickup_')
    expect(system.getPickups().length).toBe(1)

    const stateSnapshot = system.exportState()
    expect(stateSnapshot.pickups.length).toBe(1)

    system.removePickup(pickupId)
    expect(system.getPickups().length).toBe(0)

    system.importState(stateSnapshot)
    expect(system.getPickups().length).toBe(1)
  })

  it('returns inventory empty summary when no items are present', () => {
    const system = new InventorySystem({ state: stateManager as any })
    ;(system as any).isPlayActive = true
    expect(system.showInventory('player-x')).toBe('Inventory empty')
  })
})
