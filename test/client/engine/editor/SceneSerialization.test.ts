import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../client/src/engine/core/public-api', async () => {
  const actual = await vi.importActual<any>('../../../../client/src/engine/core/public-api')
  return actual
})

import { gameBus } from '../../../../client/src/engine/core/EventBus'
import { EntityManager } from '../../../../client/src/engine/core/EntityManager'
import {
  SceneSerializationSystem,
  type SerializedSceneMap,
} from '../../../../client/src/engine/editor/SceneSerializationSystem'
import { EditorPainterSystem } from '../../../../client/src/engine/editor/tools/EditorPainterSystem'
import { PrefabPlacementSystem } from '../../../../client/src/engine/editor/tools/PrefabPlacementSystem'
import { TriggerVolumeTool } from '../../../../client/src/engine/editor/tools/TriggerVolumeTool'

describe('SceneSerializationSystem', () => {
  beforeEach(() => {
    gameBus.clear()
    vi.restoreAllMocks()
  })

  it('serializes painted props and trigger volumes, then restores the same scene from JSON', () => {
    const entityManager = new EntityManager()
    const entityRenderer = {
      syncEntity: vi.fn(),
    }

    let activeTool: 'SELECT' | 'PAINT' | 'WHITEBOX' = 'PAINT'
    const toolCoordinator = {
      getActiveTool: () => activeTool,
      isBusy: () => false,
      setActiveTool: vi.fn((tool: 'SELECT' | 'PAINT' | 'WHITEBOX') => {
        activeTool = tool
        return true
      }),
      beginPaintStroke: vi.fn(() => true),
      endPaintStroke: vi.fn(() => true),
      beginWhiteboxDrag: vi.fn(() => true),
      endWhiteboxDrag: vi.fn(() => true),
    }

    const authorityIds = new Map<string, string>()
    const worldObjectAuthorityService = {
      sendPlacedEntity: vi.fn((entity: { id: string }) => {
        authorityIds.set(entity.id, `authority_${entity.id}`)
        return true
      }),
      syncAuthorityTransformForEntity: vi.fn(() => true),
      getAuthorityIdForLocalEntity: vi.fn((entityId: string) => authorityIds.get(entityId) ?? null),
      sendRemovedAuthority: vi.fn((authorityId: string) => {
        for (const [entityId, mappedAuthorityId] of authorityIds.entries()) {
          if (mappedAuthorityId === authorityId) {
            authorityIds.delete(entityId)
            break
          }
        }
      }),
    }

    const placementSystem = new PrefabPlacementSystem({
      selectionSystem: { getSelectedEntity: () => null },
      toolCoordinator,
      entityManager,
      entityRenderer,
      camera: new THREE.PerspectiveCamera(),
    })

    const prefabCatalog = new Map<string, { entityType: string; color: number; category: string }>([
      ['GrassPatch', { entityType: 'GrassPatchEntity', color: 0x44aa55, category: 'foliage' }],
    ])

    placementSystem.setRuntimeServices({
      prefabSystem: {
        create: (prefabName, position, overrides) => {
          const prefab = prefabCatalog.get(prefabName)
          if (!prefab) {
            throw new Error(`Unknown prefab ${prefabName}`)
          }

          const entity = entityManager.createEntity(prefab.entityType, {
            position: { ...position },
            rotation: (overrides?.rotation as { x: number; y: number; z: number } | undefined) ?? { x: 0, y: 0, z: 0 },
            scale: (overrides?.scale as { x: number; y: number; z: number } | undefined) ?? { x: 1, y: 1, z: 1 },
          })
          entity.addComponent({
            name: 'prefab',
            data: { prefabName },
          })
          entity.addComponent({
            name: 'render',
            data: {
              meshType: 'box',
              color: prefab.color,
              geometry: { width: 1, height: 1, depth: 1 },
            },
          })
          entity.addComponent({
            name: 'propMetadata',
            data: {
              category: prefab.category,
              bakedLighting: true,
            },
          })
          return entity
        },
        getPrefab: (name) => prefabCatalog.get(name) ?? null,
        findPrefabNameByEntityType: (entityType) => {
          for (const [prefabId, prefab] of prefabCatalog.entries()) {
            if (prefab.entityType === entityType) {
              return prefabId
            }
          }
          return null
        },
      },
      worldObjectAuthorityService,
      isMultiplayerConnected: () => false,
    })

    const painter = new EditorPainterSystem({
      toolCoordinator,
      placementSystem,
    })

    const triggerTool = new TriggerVolumeTool({
      scene: new THREE.Scene(),
      toolCoordinator,
      placementSystem,
      entityManager,
      entityRenderer,
      defaultHeight: 3,
      minDimension: 0.5,
    })

    const serializer = new SceneSerializationSystem({
      entityManager,
      entityRenderer,
      prefabPlacementSystem: placementSystem,
      worldObjectAuthorityService,
    })

    const groundPointSpy = vi.spyOn(placementSystem, 'pickGroundPointFromPointer')
      .mockReturnValueOnce({ entityId: 'ground', point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } })
      .mockReturnValueOnce({ entityId: 'ground', point: { x: 3, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } })
      .mockReturnValueOnce({ entityId: 'ground', point: { x: 6, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } })
      .mockReturnValueOnce({ entityId: 'ground', point: { x: 10, y: 0, z: 10 }, normal: { x: 0, y: 1, z: 0 } })
      .mockReturnValueOnce({ entityId: 'ground', point: { x: 14, y: 0, z: 16 }, normal: { x: 0, y: 1, z: 0 } })

    gameBus.emit('EDITOR_PAINTER_CONFIG_CHANGED', {
      selectedPrefabId: 'GrassPatch',
      spacing: 2,
      randomRotation: 0,
      randomScaleMin: 1,
      randomScaleMax: 1,
      timestamp: 1000,
    })

    let now = 1000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)

    expect(painter.handlePointerDown({ button: 0, preventDefault: vi.fn() } as unknown as MouseEvent)).toBe(true)
    now = 1100
    expect(painter.handlePointerMove({} as MouseEvent)).toBe(true)
    now = 1200
    expect(painter.handlePointerMove({} as MouseEvent)).toBe(true)
    expect(painter.handlePointerUp({ button: 0 } as MouseEvent)).toBe(true)

    activeTool = 'WHITEBOX'

    expect(triggerTool.handlePointerDown({ button: 0, preventDefault: vi.fn() } as unknown as MouseEvent)).toBe(true)
    expect(triggerTool.handlePointerMove({} as MouseEvent)).toBe(true)
    expect(triggerTool.handlePointerUp({ button: 0 } as MouseEvent)).toBe(true)

    expect(groundPointSpy).toHaveBeenCalledTimes(5)
    expect(entityManager.getEntities()).toHaveLength(4)

    const serializedJson = serializer.serializeScene('string')
    const initialMap = JSON.parse(serializedJson) as SerializedSceneMap

    expect(initialMap.entityCount).toBe(4)
    expect(initialMap.entities.filter((entity) => entity.kind === 'prefab')).toHaveLength(3)
    expect(initialMap.entities.filter((entity) => entity.kind === 'triggerVolume')).toHaveLength(1)

    for (const entity of [...entityManager.getEntities()]) {
      entityManager.destroyEntity(entity.id)
    }
    expect(entityManager.getEntities()).toHaveLength(0)

    const placePrefabSpy = vi.spyOn(placementSystem, 'placePrefab')
    const finalizePlacedEntitySpy = vi.spyOn(placementSystem, 'finalizePlacedEntity')
    entityRenderer.syncEntity.mockClear()
    worldObjectAuthorityService.sendPlacedEntity.mockClear()

    const deserializeResult = serializer.deserializeScene(serializedJson)

    expect(deserializeResult).toEqual({ cleared: 0, recreated: 4 })
    expect(placePrefabSpy).toHaveBeenCalledTimes(3)
    expect(finalizePlacedEntitySpy).toHaveBeenCalledTimes(4)
    expect(worldObjectAuthorityService.sendPlacedEntity).toHaveBeenCalledTimes(4)
    expect(entityManager.getEntities()).toHaveLength(4)

    const restoredMap = serializer.serializeScene('object')
    expect(normalizeSceneMap(restoredMap)).toEqual(normalizeSceneMap(initialMap))

    nowSpy.mockRestore()
    groundPointSpy.mockRestore()
    triggerTool.destroy()
    painter.destroy()
    placementSystem.destroy()
  })
})

function normalizeSceneMap(map: SerializedSceneMap) {
  return {
    version: map.version,
    entityCount: map.entityCount,
    entities: map.entities.map(({ sourceEntityId, ...entity }) => entity),
  }
}