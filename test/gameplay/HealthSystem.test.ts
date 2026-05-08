import { HealthSystem } from '../../client/src/engine/gameplay/systems/HealthSystem'

describe('HealthSystem', () => {
  let healthSystem: HealthSystem
  const stateStore = { set: vi.fn() }

  beforeEach(() => {
    healthSystem = new HealthSystem(stateStore)
    vi.clearAllMocks()
  })

  it('registers an entity with default health', () => {
    const comp = healthSystem.register('player1')
    expect(comp.hp).toBe(100)
    expect(comp.maxHp).toBe(100)
    expect(healthSystem.isAlive('player1')).toBe(true)
  })

  it('applies damage with armor and death events', () => {
    const damageSpy = vi.fn()
    const deathSpy = vi.fn()
    healthSystem.onDamage(damageSpy)
    healthSystem.onDeath(deathSpy)
    healthSystem.register('player2', { armor: 0.5 })

    const effective = healthSystem.applyDamage('player2', { amount: 40, type: 'bullet', sourceId: 'enemy' })
    expect(effective).toBe(20)
    expect(healthSystem.getHp('player2')).toBe(80)
    expect(damageSpy).toHaveBeenCalledOnce()
    expect(deathSpy).not.toHaveBeenCalled()
  })

  it('kills a player when hp reaches zero and triggers death', () => {
    const deathSpy = vi.fn()
    healthSystem.onDeath(deathSpy)
    healthSystem.register('player3', { maxHp: 20 })
    const total = healthSystem.applyDamage('player3', { amount: 40 })
    expect(total).toBe(40)
    expect(healthSystem.getHp('player3')).toBe(0)
    expect(healthSystem.isAlive('player3')).toBe(false)
    expect(deathSpy).toHaveBeenCalledOnce()
  })

  it('heals entities and clamps hp to max', () => {
    healthSystem.register('player4', { maxHp: 50 })
    healthSystem.applyDamage('player4', { amount: 30 })
    const healed = healthSystem.heal('player4', 20)
    expect(healed).toBe(20)
    expect(healthSystem.getHp('player4')).toBe(40)

    const overHeal = healthSystem.heal('player4', 50)
    expect(overHeal).toBe(10)
    expect(healthSystem.getHp('player4')).toBe(50)
  })

  it('tracks shield state and emits shield events', () => {
    const shieldSpy = vi.fn()
    healthSystem.onShield(shieldSpy)
    healthSystem.register('player5', { maxHp: 100, shield: 20, maxShield: 20 })
    healthSystem.applyDamage('player5', { amount: 10 })
    expect(healthSystem.getShield('player5')).toBe(10)
    expect(shieldSpy).toHaveBeenCalledOnce()
  })

  it('revives a revivable entity', () => {
    healthSystem.register('player6', { maxHp: 80, revivable: true })
    healthSystem.kill('player6', 'enemy')
    expect(healthSystem.isAlive('player6')).toBe(false)
    const revived = healthSystem.revive('player6', 0.5)
    expect(revived).toBe(true)
    expect(healthSystem.isAlive('player6')).toBe(true)
    expect(healthSystem.getHp('player6')).toBeGreaterThan(0)
  })
})

