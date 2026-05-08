import { describe, expect, it } from 'vitest'
import { gameBus, EntityManager } from '@engine/core/public-api'
import { createBoxCollider } from '@engine/gameplay/game/components/ColliderComponent'
import { createAIControllerComponent } from '@engine/gameplay/game/components/AIControllerComponent'
import { PathfindingSystem } from '@engine/gameplay/systems/PathfindingSystem'

type Vector3 = { x: number; y: number; z: number }

describe('PathfindingSystem', () => {
  it('reports walkability and diagnostics correctly', () => {
    const nav = new PathfindingSystem({ cellSize: 1, width: 5, height: 5, diagonal: false, smooth: false, waypointRadius: 0.5 })

    expect(nav.isWalkable(0, 0)).toBe(true)
    expect(nav.isWalkableWorld({ x: -2, y: 0, z: -2 })).toBe(true)
    expect(nav.getDebugState()).toMatchObject({
      status: 'active',
      active: true,
      metrics: expect.objectContaining({ gridWidth: 5, gridHeight: 5 }),
    })

    nav.markBlocked(2, 2)
    expect(nav.isWalkable(2, 2)).toBe(false)
    expect(nav.debugPrintGrid()).toContain('#')
    expect(nav.getBlockedWorldPositions()).toContainEqual({ x: 0, y: 0, z: 0 })
  })

  it('supports block marking by AABB and returns empty path when start is blocked', () => {
    const nav = new PathfindingSystem({ cellSize: 1, width: 5, height: 5, diagonal: false, smooth: false })
    nav.markBlockedAABB({ min: { x: -2, z: -2 }, max: { x: 0, z: 0 } }, true)

    expect(nav.isWalkable(0, 0)).toBe(false)
    expect(nav.isWalkableWorld({ x: -2, y: 0, z: -2 })).toBe(false)

    const path = nav.findPath({ x: -2, y: 0, z: -2 }, { x: 2, y: 0, z: 2 })
    expect(path).toEqual([])
  })

  it('finds a valid path on an open grid and caches repeated requests', () => {
    const nav = new PathfindingSystem({ cellSize: 1, width: 5, height: 5, diagonal: false, smooth: false })
    const start = { x: -2, y: 0, z: -2 }
    const end = { x: 2, y: 0, z: 2 }

    const path = nav.findPath(start, end)
    expect(path.length).toBeGreaterThan(0)
    expect(path[0]).toEqual(start)
    expect(path[path.length - 1]).toEqual(end)

    const cached = nav.findPath(start, end)
    expect(cached).toEqual(path)
  })

  it('steers along waypoints and returns null after completion', () => {
    const nav = new PathfindingSystem({ cellSize: 1, width: 5, height: 5, smooth: false, waypointRadius: 0.5 })
    const path: Vector3[] = [
      { x: -2, y: 0, z: -2 },
      { x: 0, y: 0, z: -2 },
    ]
    const indexRef = { value: 0 }

    const direction = nav.steer({ x: -2, y: 0, z: -2 }, path, indexRef)
    expect(indexRef.value).toBe(1)
    expect(direction).toEqual({ x: 1, y: 0, z: 0 })

    const complete = nav.steer({ x: 0, y: 0, z: -2 }, path, indexRef)
    expect(complete).toBeNull()
  })

  it('stamps static colliders into the navmesh and writes steering velocity for AI-controlled entities', () => {
    const nav = new PathfindingSystem({
      cellSize: 1,
      width: 14,
      height: 14,
      diagonal: false,
      smooth: false,
      originX: -7,
      originZ: -7,
      waypointRadius: 0.25,
    })
    const entityManager = new EntityManager()

    const obstacle = entityManager.createEntity('static_collider', {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })
    obstacle.addComponent({
      name: 'collider',
      data: createBoxCollider(2, 2, 2) as unknown as Record<string, any>,
    })

    const agent = entityManager.createEntity('npc_agent', {
      position: { x: -4, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })
    agent.addComponent({
      name: 'aiController',
      data: createAIControllerComponent({ x: 4, y: 0, z: 0 }, {
        speed: 3,
        repathIntervalMs: 250,
      }) as unknown as Record<string, any>,
    })

    nav.init({
      entityManager,
      eventBus: gameBus,
      network: {} as never,
      replication: {} as never,
      resources: null,
      systems: {},
    })

    nav.update(0.016)

    const aiController = agent.getComponent('aiController')?.data as { currentPath: Vector3[] }
    const velocity = agent.getComponent('velocity')?.data as Vector3

    expect(nav.getBlockedWorldPositions().length).toBeGreaterThan(0)
    expect(aiController.currentPath.length).toBeGreaterThan(0)
    expect(aiController.currentPath.some((waypoint) => Math.abs(waypoint.z) > 0.01)).toBe(true)
    expect(velocity.x).toBeGreaterThan(0)
    expect(Math.abs(velocity.z)).toBeGreaterThan(0)
    expect(Math.hypot(velocity.x, velocity.z)).toBeCloseTo(3, 5)
  })
})
