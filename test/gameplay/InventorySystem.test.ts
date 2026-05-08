import { gameBus } from '../../client/src/engine/core/EventBus'
import { InventorySystem } from '../../client/src/engine/gameplay/systems/InventorySystem'

describe('InventorySystem', () => {
  let inventorySystem: InventorySystem
  let stateStore: Record<string, any>
  let stateManager: { set: (path: string, value: unknown) => void; get: (path: string) => unknown }
  let weaponSystemMock: any
  let healthSystemMock: any
  let prefabSystemMock: any

  beforeEach(() => {
    stateStore = {}
    stateManager = {
      set(path: string, value: unknown) {
        stateStore[path] = value
      },
      get(path: string) {
        return stateStore[path]
      },
    }
    weaponSystemMock = {
      equip: vi.fn(() => true),
      pickupWeapon: vi.fn(() => true),
      addAmmo: vi.fn(() => true),
    }
    healthSystemMock = {
      heal: vi.fn(() => 10),
      get: vi.fn(() => ({ armor: 0 })),
    }
    prefabSystemMock = {
      create: vi.fn(() => ({ id: 'entity_1' })),
      remove: vi.fn(() => true),
    }
    gameBus.clear()
    inventorySystem = new InventorySystem({
      health: healthSystemMock,
      weapons: weaponSystemMock,
      state: stateManager,
      prefabSystem: prefabSystemMock,
      enableLogging: false,
    })
    gameBus.emit('LIFECYCLE_PLAY_ACTIVE')
  })

  it('defines default items and retrieves definitions', () => {
    inventorySystem.defineDefaults()
    const def = inventorySystem.getDefinition('health_small')
    expect(def).toBeDefined()
    expect(def?.type).toBe('health')
  })

  it('adds and retrieves items for a player inventory', () => {
    inventorySystem.defineDefaults()
    const success = inventorySystem.addItem('player1', 'health_small', 2)
    expect(success).toBe(true)
    const inventory = inventorySystem.getInventory('player1')
    expect(inventory.length).toBe(1)
    expect(inventory[0].quantity).toBe(2)
  })

  it('removes items from inventory and adjusts equipped slot', () => {
    inventorySystem.defineDefaults()
    inventorySystem.addItem('player1', 'health_small', 2)
    inventorySystem.equipSlot('player1', 0)
    const success = inventorySystem.removeItem('player1', 0, 2)
    expect(success).toBe(true)
    expect(inventorySystem.getInventory('player1').length).toBe(0)
  })

  it('quick-swaps inventory slots', () => {
    inventorySystem.defineDefaults()
    inventorySystem.addItem('player1', 'health_small', 1)
    inventorySystem.addItem('player1', 'rifle_rounds', 1)
    const swapped = inventorySystem.quickSwap('player1', 1)
    expect(swapped).toBe(true)
    expect(weaponSystemMock.equip).not.toHaveBeenCalled()
  })

  it('exports and imports inventory state', () => {
    inventorySystem.defineDefaults()
    inventorySystem.addItem('player1', 'health_small', 1)
    const snapshot = inventorySystem.exportState()
    const newSystem = new InventorySystem({ state: stateManager, enableLogging: false })
    gameBus.emit('LIFECYCLE_PLAY_ACTIVE')
    newSystem.importState(snapshot)
    expect(newSystem.getInventory('player1').length).toBe(1)
  })

  it('uses a health item and reduces quantity', () => {
    inventorySystem.defineDefaults()
    inventorySystem.addItem('player1', 'health_small', 1)
    const used = inventorySystem.useItem('player1', 0)
    expect(used).toBe(true)
    expect(healthSystemMock.heal).toHaveBeenCalled()
    expect(inventorySystem.getInventory('player1').length).toBe(0)
  })

  it('creates and removes pickups', () => {
    inventorySystem.defineDefaults()
    const pickupId = inventorySystem.createPickup('health_small', { x: 0, y: 0, z: 0 })
    expect(inventorySystem.getPickups().some((p) => p.id === pickupId)).toBe(true)
    inventorySystem.removePickup(pickupId)
    expect(inventorySystem.getPickups().length).toBe(0)
    expect(prefabSystemMock.remove).toHaveBeenCalled()
  })

  it('consumes a pickup when player is in range', () => {
    inventorySystem.defineDefaults()
    const pickupId = inventorySystem.createPickup('health_small', { x: 0, y: 0, z: 0 })
    const callback = vi.fn()
    inventorySystem.onPickup(callback)

    inventorySystem.update(0.1, new Map([['player1', { x: 0, y: 0, z: 0 }]]), new Set(['player1']))
    expect(callback).toHaveBeenCalledOnce()
    expect(inventorySystem.getPickups().length).toBe(0)
  })

  it('shows inventory summary text', () => {
    inventorySystem.defineDefaults()
    inventorySystem.addItem('player1', 'health_small', 1)
    const summary = inventorySystem.showInventory('player1')
    expect(summary).toContain('Health Pack')
  })
})

