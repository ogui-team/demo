import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/core/public-api', async () => {
  const actual = await vi.importActual<any>('../../../../../client/src/engine/core/public-api')
  return actual
})

import { gameBus } from '../../../../../client/src/engine/core/EventBus'
import { Entity } from '../../../../../client/src/engine/core/Entity'
import { PrefabPlacementSystem } from '../../../../../client/src/engine/editor/tools/PrefabPlacementSystem'

describe('PrefabPlacementSystem', () => {
  beforeEach(() => {
    gameBus.clear()
  })

  it('places prefabs from editor spawn events and emits placement state', () => {
    const entityRenderer = { syncEntity: vi.fn() }
    const worldObjectAuthorityService = {
      sendPlacedEntity: vi.fn(() => true),
      syncAuthorityTransformForEntity: vi.fn(() => true),
    }
    const system = new PrefabPlacementSystem({
      selectionSystem: { getSelectedEntity: () => null },
      toolCoordinator: {
        getActiveTool: () => 'SELECT',
        isBusy: () => false,
        setActiveTool: vi.fn(() => true),
      },
      entityManager: { getEntity: () => null },
      entityRenderer,
      camera: new THREE.PerspectiveCamera(),
    })

    system.setRuntimeServices({
      prefabSystem: {
        create: (prefabName, position) => {
          const entity = new Entity('placed_tree', prefabName)
          entity.setPosition({ ...position })
          return entity
        },
        getPrefab: (name) => (name === 'TreePrefab' ? { name } : null),
        findPrefabNameByEntityType: (entityType) => entityType === 'Tree' ? 'TreePrefab' : null,
      },
      worldObjectAuthorityService,
      isMultiplayerConnected: () => false,
    })

    const placedPayloads: any[] = []
    const offPlaced = gameBus.on('EDITOR_PREFAB_PLACED', (payload) => placedPayloads.push(payload))

    gameBus.emit('EDITOR_SPAWN_PREFAB', {
      prefabId: 'Tree',
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0.5, z: 0 },
      source: 'ui',
      timestamp: Date.now(),
    })

    expect(entityRenderer.syncEntity).toHaveBeenCalled()
    expect(worldObjectAuthorityService.sendPlacedEntity).toHaveBeenCalledWith(expect.objectContaining({ id: 'placed_tree' }), 'TreePrefab')
    expect(placedPayloads).toHaveLength(1)
    expect(placedPayloads[0]).toEqual(expect.objectContaining({ entityId: 'placed_tree', prefabId: 'TreePrefab', authority: 'local' }))

    offPlaced()
    system.destroy()
  })

  it('snaps arbitrary entities to the floor by entity id instead of relying on the current selection', () => {
    const entity = new Entity('crate_1', 'Crate')
    entity.setPosition({ x: 5, y: 10, z: -2 })

    const entityRenderer = { syncEntity: vi.fn() }
    const worldObjectAuthorityService = {
      sendPlacedEntity: vi.fn(() => true),
      syncAuthorityTransformForEntity: vi.fn(() => true),
    }
    const system = new PrefabPlacementSystem({
      selectionSystem: { getSelectedEntity: () => null },
      toolCoordinator: {
        getActiveTool: () => 'SELECT',
        isBusy: () => false,
        setActiveTool: vi.fn(() => true),
      },
      entityManager: {
        getEntity: (entityId: string) => entityId === entity.id ? entity : null,
      },
      entityRenderer,
      camera: new THREE.PerspectiveCamera(),
    })

    system.setRuntimeServices({
      physicsSystem: {
        raycastFirst: () => ({
          entityId: 'ground',
          point: { x: 5, y: 1, z: -2 },
          normal: { x: 0, y: 1, z: 0 },
        }),
      },
      worldObjectAuthorityService,
    })

    expect(system.snapEntityToFloor(entity.id, 100, 0.1)).toBe(true)
    expect(entity.getPosition()).toEqual({ x: 5, y: 1.1, z: -2 })
    expect(entityRenderer.syncEntity).toHaveBeenCalledWith(entity)
    expect(worldObjectAuthorityService.syncAuthorityTransformForEntity).toHaveBeenCalledWith(entity.id)

    system.destroy()
  })
})