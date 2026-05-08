import { HealthStorage } from '../../client/src/engine/core/kernel/HealthStorage'

describe('HealthStorage', () => {
  it('stores and retrieves health and max health values', () => {
    const storage = new HealthStorage(2)
    storage.setHealth(0, 77.5)
    storage.setMaxHealth(0, 150)

    expect(storage.getHealth(0)).toBe(77.5)
    expect(storage.getMaxHealth(0)).toBe(150)
    expect(storage.getHealthBuffer()[0]).toBe(77.5)
    expect(storage.getMaxHealthBuffer()[0]).toBe(150)
  })

  it('clears active entries without affecting capacity', () => {
    const storage = new HealthStorage(2)
    storage.setHealth(0, 88)
    storage.setMaxHealth(0, 110)
    storage.setHealth(1, 99)
    storage.setMaxHealth(1, 120)

    storage.clear(1)
    expect(storage.getHealth(0)).toBe(0)
    expect(storage.getMaxHealth(0)).toBe(0)
    expect(storage.getHealth(1)).toBe(99)
    expect(storage.getMaxHealth(1)).toBe(120)
  })
})
