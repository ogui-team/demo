import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/core/public-api', async () => {
  const actual = await vi.importActual<any>('../../../../../client/src/engine/core/public-api')
  return actual
})

import { gameBus } from '../../../../../client/src/engine/core/EventBus'
import { Entity } from '../../../../../client/src/engine/core/Entity'
import { TriggerVolumeTool } from '../../../../../client/src/engine/editor/tools/TriggerVolumeTool'

describe('TriggerVolumeTool', () => {
  beforeEach(() => {
    gameBus.clear()
  })

  it('creates a trigger volume from a whitebox drag and emits a creation event', () => {
    const createdEntity = new Entity('trigger_1', 'EditorObject_TriggerVolume')
    const endWhiteboxDrag = vi.fn(() => true)
    const finalizePlacedEntity = vi.fn()
    const entityRenderer = { syncEntity: vi.fn() }
    const pickGroundPointFromPointer = vi
      .fn()
      .mockReturnValueOnce({ entityId: 'ground', point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } })
      .mockReturnValueOnce({ entityId: 'ground', point: { x: 4, y: 0, z: 6 }, normal: { x: 0, y: 1, z: 0 } })

    const tool = new TriggerVolumeTool({
      scene: new THREE.Scene(),
      toolCoordinator: {
        getActiveTool: () => 'WHITEBOX',
        beginWhiteboxDrag: vi.fn(() => true),
        endWhiteboxDrag,
      },
      placementSystem: {
        pickGroundPointFromPointer,
        finalizePlacedEntity,
      } as any,
      entityManager: {
        createEntity: () => createdEntity,
      },
      entityRenderer,
      defaultHeight: 3,
      minDimension: 0.5,
    })

    const createdPayloads: any[] = []
    const offCreated = gameBus.on('EDITOR_TRIGGER_VOLUME_CREATED', (payload) => createdPayloads.push(payload))

    expect(tool.handlePointerDown({ button: 0, preventDefault: vi.fn() } as unknown as MouseEvent)).toBe(true)
    expect(tool.handlePointerMove({} as MouseEvent)).toBe(true)
    expect(tool.handlePointerUp({ button: 0 } as MouseEvent)).toBe(true)

    expect(createdEntity.getComponent('triggerVolume')?.data).toEqual(expect.objectContaining({
      type: 'triggerVolume',
      size: { x: 4, y: 3, z: 6 },
    }))
    expect(entityRenderer.syncEntity).toHaveBeenCalledWith(createdEntity)
    expect(finalizePlacedEntity).toHaveBeenCalledWith(createdEntity, expect.objectContaining({ entityType: 'EditorObject_TriggerVolume' }))
    expect(endWhiteboxDrag).toHaveBeenCalledWith('pointer_up')
    expect(createdPayloads).toHaveLength(1)
    expect(createdPayloads[0]).toEqual(expect.objectContaining({ entityId: 'trigger_1', size: { x: 4, y: 3, z: 6 } }))

    offCreated()
    tool.destroy()
  })
})