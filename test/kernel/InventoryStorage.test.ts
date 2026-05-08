import { InventoryStorage } from '../../client/src/engine/core/kernel/InventoryStorage'

describe('InventoryStorage', () => {
  it('sets and gets ammo and item IDs', () => {
    const inventory = new InventoryStorage(2)
    inventory.setAmmo(0, 15)
    inventory.setItemId(0, 7)
    expect(inventory.getAmmo(0)).toBe(15)
    expect(inventory.getItemId(0)).toBe(7)
  })

  it('manages inventory grid items and metadata', () => {
    const inventory = new InventoryStorage(1)
    const slot = 5
    inventory.setGridItem(0, slot, 123)
    expect(inventory.getGridItem(0, slot)).toBe(123)

    expect(inventory.findFirstEmptySlot(0)).toBe(0)
    inventory.setGridItem(0, 0, 99)
    expect(inventory.findFirstEmptySlot(0)).toBe(1)

    inventory.setSelectedSlot(0, 3)
    expect(inventory.getSelectedSlot(0)).toBe(3)

    inventory.setEquippedSlot(0, 12)
    expect(inventory.getEquippedSlot(0)).toBe(12)
  })

  it('clears the active entity range', () => {
    const inventory = new InventoryStorage(2)
    inventory.setAmmo(0, 10)
    inventory.setItemId(0, 5)
    inventory.setGridItem(0, 1, 15)
    inventory.setSelectedSlot(0, 2)
    inventory.setEquippedSlot(0, 4)

    inventory.clear(1)
    expect(inventory.getAmmo(0)).toBe(0)
    expect(inventory.getItemId(0)).toBe(0)
    expect(inventory.getGridItem(0, 1)).toBe(0)
    expect(inventory.getSelectedSlot(0)).toBe(0)
    expect(inventory.getEquippedSlot(0)).toBe(0)
  })
})
