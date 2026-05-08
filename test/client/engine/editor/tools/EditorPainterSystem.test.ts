import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/core/public-api', async () => {
  const actual = await vi.importActual<any>('../../../../../client/src/engine/core/public-api')
  return actual
})

import { gameBus } from '../../../../../client/src/engine/core/EventBus'
import { EditorPainterSystem } from '../../../../../client/src/engine/editor/tools/EditorPainterSystem'

describe('EditorPainterSystem', () => {
  beforeEach(() => {
    gameBus.clear()
  })

  it('paints prefabs with spacing enforcement during an active paint stroke', () => {
    const beginPaintStroke = vi.fn(() => true)
    const endPaintStroke = vi.fn(() => true)
    const placePrefab = vi.fn()
    const pickGroundPointFromPointer = vi
      .fn()
      .mockReturnValueOnce({ entityId: 'ground', point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } })
      .mockReturnValueOnce({ entityId: 'ground', point: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } })
      .mockReturnValueOnce({ entityId: 'ground', point: { x: 3, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } })

    const system = new EditorPainterSystem({
      toolCoordinator: {
        getActiveTool: () => 'PAINT',
        beginPaintStroke,
        endPaintStroke,
      },
      placementSystem: {
        pickGroundPointFromPointer,
        placePrefab,
      } as any,
    })

    gameBus.emit('EDITOR_PAINTER_CONFIG_CHANGED', {
      selectedPrefabId: 'GrassPatch',
      spacing: 2,
      randomRotation: 0,
      randomScaleMin: 1,
      randomScaleMax: 1,
      timestamp: Date.now(),
    })

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(1000)
    nowSpy.mockReturnValueOnce(1100)
    nowSpy.mockReturnValueOnce(1200)

    const pointerEvent = { button: 0, preventDefault: vi.fn() } as unknown as MouseEvent

    expect(system.handlePointerDown(pointerEvent)).toBe(true)
    expect(system.handlePointerMove({} as MouseEvent)).toBe(true)
    expect(system.handlePointerMove({} as MouseEvent)).toBe(true)
    expect(system.handlePointerUp({ button: 0 } as MouseEvent)).toBe(true)

    expect(beginPaintStroke).toHaveBeenCalledTimes(1)
    expect(placePrefab).toHaveBeenCalledTimes(2)
    expect(placePrefab).toHaveBeenNthCalledWith(1, 'GrassPatch', expect.objectContaining({ position: { x: 0, y: 0, z: 0 } }))
    expect(placePrefab).toHaveBeenNthCalledWith(2, 'GrassPatch', expect.objectContaining({ position: { x: 3, y: 0, z: 0 } }))
    expect(endPaintStroke).toHaveBeenCalledWith('pointer_up')

    nowSpy.mockRestore()
    system.destroy()
  })
})