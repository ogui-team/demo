import { describe, expect, it, vi } from 'vitest'
import { HealthSystem } from '@engine/gameplay/systems/HealthSystem'

describe('HealthSystem', () => {
  it('registers entities, applies damage, heals, and revives', () => {
    const stateManager = { set: vi.fn() }
    const system = new HealthSystem(stateManager as any)

    const component = system.register('entity-1', {
      maxHp: 100,
      armor: 0.25,
      revivable: true,
      shield: 10,
      maxShield: 20,
      shieldRegenRate: 1,
      shieldRegenDelay: 0,
      invulnerabilityDuration: 0,
    })

    expect(component.hp).toBe(100)
    expect(system.isAlive('entity-1')).toBe(true)
    expect(system.getHpFraction('entity-1')).toBeCloseTo(1)
    expect(system.getShieldFraction('entity-1')).toBeCloseTo(0.5)

    const damageCallback = vi.fn()
    const shieldCallback = vi.fn()
    const deathCallback = vi.fn()
    system.onDamage(damageCallback)
    system.onShield(shieldCallback)
    system.onDeath(deathCallback)

    const damage = system.applyDamage('entity-1', { amount: 20, type: 'bullet', sourceId: 'enemy-1' })
    expect(damage).toBe(15)
    expect(system.getHp('entity-1')).toBe(95)
    expect(system.getShield('entity-1')).toBe(0)
    expect(damageCallback).toHaveBeenCalled()
    expect(shieldCallback).toHaveBeenCalled()
    expect(deathCallback).not.toHaveBeenCalled()

    const healed = system.heal('entity-1', 3)
    expect(healed).toBe(3)
    expect(system.getHp('entity-1')).toBe(98)

    system.setShield('entity-1', 12)
    expect(system.getShield('entity-1')).toBe(12)

    const delta = system.addShield('entity-1', -2)
    expect(delta).toBe(-2)
    expect(system.getShield('entity-1')).toBe(10)

    system.kill('entity-1')
    expect(system.isAlive('entity-1')).toBe(false)
    expect(deathCallback).toHaveBeenCalled()

    const revived = system.revive('entity-1', 0.5)
    expect(revived).toBe(true)
    expect(system.getHp('entity-1')).toBeGreaterThan(0)
    expect(system.isAlive('entity-1')).toBe(true)
  })
})
