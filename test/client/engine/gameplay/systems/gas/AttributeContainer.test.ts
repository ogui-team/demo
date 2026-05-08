import { describe, expect, it } from 'vitest'
import { AttributeContainer, EntityAttributeStore } from '../../../../../../client/src/engine/gameplay/systems/gas/AttributeContainer'

describe('AttributeContainer', () => {
  it('initializes defaults and allows base overrides', () => {
    const container = new AttributeContainer({ Health: 50, MaxHealth: 120 })
    expect(container.getBase('Health')).toBe(50)
    expect(container.getBase('MaxHealth')).toBe(120)
    expect(container.get('Health')).toBe(50)

    container.setBase('Health', 70)
    expect(container.getBase('Health')).toBe(70)
    expect(container.get('Health')).toBe(70)
  })

  it('applies additive and multiplicative modifiers correctly', () => {
    const container = new AttributeContainer({ Health: 80, MaxHealth: 300, DamageMultiplier: 1.0 })
    container.addModifiers('equip:primary', [
      { attribute: 'Health', op: 'Add', value: 20 },
      { attribute: 'DamageMultiplier', op: 'MultiplyTotal', value: 1.5 },
    ])

    expect(container.get('Health')).toBe(100)
    expect(container.get('DamageMultiplier')).toBe(1.5)

    container.addModifiers('buff:strong', [
      { attribute: 'Health', op: 'MultiplyBase', value: 2 },
    ])
    expect(container.get('Health')).toBe(200)

    expect(container.hasSource('buff:strong')).toBe(true)
    container.removeSource('buff:strong')
    expect(container.hasSource('buff:strong')).toBe(false)
    expect(container.get('Health')).toBe(100)
  })

  it('clamps health and mana deltas and detects death', () => {
    const container = new AttributeContainer({ Health: 30, MaxHealth: 100, Mana: 10, MaxMana: 50 })
    container.applyHealthDelta(-50)
    expect(container.getBase('Health')).toBe(0)
    expect(container.isDead()).toBe(true)

    container.applyManaDelta(100)
    expect(container.getBase('Mana')).toBe(50)
  })

  it('exports and imports state correctly', () => {
    const container = new AttributeContainer({ Health: 50, MaxHealth: 80 })
    container.addModifiers('source:1', [{ attribute: 'Health', op: 'Add', value: 10 }])

    const snapshot = container.export()
    const copy = new AttributeContainer()
    copy.import(snapshot)

    expect(copy.get('Health')).toBe(60)
    expect(copy.hasSource('source:1')).toBe(true)
  })
})

describe('EntityAttributeStore', () => {
  it('manages entity attribute containers and snapshots all', () => {
    const store = new EntityAttributeStore()
    const a = store.ensure('entity-1', { Health: 20 })
    const b = store.ensure('entity-2', { Health: 40 })

    expect(store.has('entity-1')).toBe(true)
    expect(store.get('entity-1')).toBe(a)
    expect(store.get('entity-3')).toBeUndefined()

    expect(store.snapshotAll()).toEqual({
      'entity-1': expect.objectContaining({ Health: 20 }),
      'entity-2': expect.objectContaining({ Health: 40 }),
    })

    store.remove('entity-1')
    expect(store.has('entity-1')).toBe(false)

    store.clearAll()
    expect(store.has('entity-2')).toBe(false)
  })
})
