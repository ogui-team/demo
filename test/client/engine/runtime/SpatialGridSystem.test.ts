import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

vi.mock('@engine/1-kernel/core/public-api', () => ({
  gameBus: {
    emit: vi.fn(),
  },
}))

import { SpatialGridSystem } from '../../../../client/src/2-systems/gameplay/systems/SpatialGridSystem'

function createEntityStub(id: string, position: { x: number; y: number; z: number }) {
  const data = { id, position }
  return {
    id,
    getPosition: () => ({ ...data.position }),
    getComponent: vi.fn(() => undefined),
    hasComponent: vi.fn(() => false),
  }
}

describe('SpatialGridSystem', () => {
  let spatialGrid: SpatialGridSystem
  let entityManager: any
  let entityRenderer: any

  beforeEach(() => {
    vi.clearAllMocks()
    spatialGrid = new SpatialGridSystem({ cellSize: 32, verticalExtent: 64, debugRefreshInterval: 0.05 })
    entityRenderer = {
      getMeshForEntity: vi.fn((entityId: string) => ({ visible: true, userData: {} })),
    }
    entityManager = {
      onEntityCreated: vi.fn(() => () => undefined),
      onEntityDestroyed: vi.fn(() => () => undefined),
      getEntities: vi.fn(() => []),
    }
  })

  it('registers existing entities and returns cell identifiers', () => {
    const entity = createEntityStub('entity-1', { x: 5, y: 0, z: 5 })
    entityManager.getEntities = vi.fn(() => [entity])

    spatialGrid.bindEntityManager(entityManager)
    spatialGrid.bindEntityRenderer(entityRenderer)

    expect(spatialGrid.getCellForEntity('entity-1')).toBe('0:0')
    expect(spatialGrid.getCells().next().value.id).toBe('0:0')
    expect(spatialGrid.getCellSize()).toBe(32)
  })

  it('moves entities to new cells when their position changes', () => {
    const entity = createEntityStub('entity-2', { x: 5, y: 0, z: 5 })
    entityManager.getEntities = vi.fn(() => [entity])
    spatialGrid.bindEntityManager(entityManager)
    spatialGrid.bindEntityRenderer(entityRenderer)

    expect(spatialGrid.getCellForEntity('entity-2')).toBe('0:0')
    entity.position = { x: 40, y: 0, z: 5 }
    spatialGrid.update(0.1)

    expect(spatialGrid.getCellForEntity('entity-2')).toBe('1:0')
    expect(spatialGrid.getDiagnostics().cellCount).toBeGreaterThanOrEqual(1)
  })

  it('applies visibility state to mesh objects when a cell visibility changes', () => {
    const entity = createEntityStub('entity-3', { x: 0, y: 0, z: 0 })
    entityManager.getEntities = vi.fn(() => [entity])
    spatialGrid.bindEntityManager(entityManager)
    spatialGrid.bindEntityRenderer(entityRenderer)

    const cell = spatialGrid.getCell('0:0')
    expect(cell).toBeDefined()
    spatialGrid.setCellVisible('0:0', false)

    expect(entityRenderer.getMeshForEntity).toHaveBeenCalledWith('entity-3')
    expect(cell?.visible).toBe(false)
  })

  it('creates and destroys the debug overlay when enabled and disposed', () => {
    const scene = new THREE.Scene()
    spatialGrid.bindDebugScene(scene)
    spatialGrid.setDebugOverlayEnabled(true)

    expect(spatialGrid.isDebugOverlayEnabled()).toBe(true)
    expect(scene.getObjectByName('spatial_grid_debug_overlay')).toBeDefined()

    spatialGrid.dispose()
    expect(spatialGrid.getCellSnapshots()).toEqual([])
  })
})
