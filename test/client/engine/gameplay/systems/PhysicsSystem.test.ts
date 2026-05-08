import { describe, expect, it, vi } from 'vitest'
import { PhysicsSystem } from '@engine/gameplay/systems/PhysicsSystem'

describe('PhysicsSystem', () => {
  it('manages bodies, updates dynamic motion, and clears state', () => {
    const system = new PhysicsSystem()

    const body = system.addBody('player-1', { shape: 'sphere', radius: 0.5, layer: 'player' })
    expect(system.hasBody('player-1')).toBe(true)
    expect(body.shape.shape).toBe('sphere')

    system.applyForce('player-1', { x: 0, y: 10, z: 0 })
    system.setVelocity('player-1', { x: 1, y: 0, z: 0 })
    expect(system.getVelocity('player-1')).toEqual({ x: 1, y: 0, z: 0 })

    const positions = new Map([['player-1', { x: 0, y: 0, z: 0 }]])
    const result = system.update(positions, 0.02)
    expect(result.has('player-1')).toBe(true)
    expect(result.get('player-1')?.x).toBeGreaterThan(0)

    system.clear()
    expect(system.hasBody('player-1')).toBe(false)
    expect(system.getDiagnostics().metrics.bodyCount).toBe(0)
  })

  it('detects and resolves collisions and trigger enter/exit events', () => {
    const system = new PhysicsSystem()
    const collisionCb = vi.fn()
    const triggerEnterCb = vi.fn()
    const triggerExitCb = vi.fn()

    system.onCollision(collisionCb)
    system.onTriggerEnter(triggerEnterCb)
    system.onTriggerExit(triggerExitCb)

    system.addBody('projectile-1', { shape: 'sphere', radius: 0.5, layer: 'projectile' })
    system.addBody('env-1', { shape: 'aabb', halfExtents: { x: 1, y: 1, z: 1 }, layer: 'environment', isStatic: true })

    const positions = new Map([
      ['projectile-1', { x: 0, y: 0, z: 0 }],
      ['env-1', { x: 0, y: 0, z: 0 }],
    ])

    system.update(positions, 0.02)
    expect(collisionCb).toHaveBeenCalled()

    // Add trigger body with a layer that participates in trigger checks
    system.addBody('trigger-1', { shape: 'sphere', radius: 1, layer: 'player', isTrigger: true })
    const triggerPos = new Map([
      ['projectile-1', { x: 0, y: 0, z: 0 }],
      ['env-1', { x: 0, y: 0, z: 0 }],
      ['trigger-1', { x: 0, y: 0, z: 0 }],
    ])
    system.update(triggerPos, 0.02)
    expect(triggerEnterCb).toHaveBeenCalled()

    system.update(new Map([
      ['projectile-1', { x: 10, y: 0, z: 10 }],
      ['env-1', { x: 0, y: 0, z: 0 }],
      ['trigger-1', { x: 0, y: 0, z: 0 }],
    ]), 0.02)
    expect(triggerExitCb).toHaveBeenCalled()
  })

  it('supports raycasts and overlap queries', () => {
    const system = new PhysicsSystem()
    system.addBody('sphere-1', { shape: 'sphere', radius: 0.5, layer: 'player' })
    system.addBody('box-1', { shape: 'aabb', halfExtents: { x: 1, y: 1, z: 1 }, layer: 'environment' })
    system.update(new Map([
      ['sphere-1', { x: 0, y: 0, z: 5 }],
      ['box-1', { x: 0, y: 0, z: 10 }],
    ]), 0.01)

    const hit = system.raycastFirst({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 1 })
    expect(hit?.entityId).toBe('sphere-1')

    const overlapAll = system.overlapSphere({ x: 0, y: 0, z: 0 }, 12)
    expect(overlapAll).toEqual(expect.arrayContaining(['sphere-1', 'box-1']))

    const overlapFiltered = system.overlapSphereFiltered({ x: 0, y: 0, z: 0 }, 12, { layerMask: ['player'] })
    expect(overlapFiltered).toEqual(['sphere-1'])

    const ring = system.overlapRing({ x: 0, y: 0, z: 0 }, 0.5, 15)
    expect(ring).toEqual(expect.arrayContaining(['sphere-1', 'box-1']))

    const cone = system.overlapCone({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }, 15, 45)
    expect(cone).toContain('sphere-1')

    system.moveToward('sphere-1', { x: 2, y: 0, z: 5 }, 1, 0.5)
    expect(system.getBody('sphere-1')!.position.x).toBeGreaterThan(0)
  })
})
