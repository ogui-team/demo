import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/core/public-api', async () => {
  const actual = await vi.importActual<any>('../../../../../client/src/engine/core/public-api')
  return actual
})

import { gameBus } from '../../../../../client/src/engine/core/EventBus'
import { EditorToolCoordinator } from '../../../../../client/src/engine/editor/tools/EditorToolCoordinator'

describe('EditorToolCoordinator', () => {
  beforeEach(() => {
    gameBus.clear()
  })

  it('switches tools through the request event and clears transient state', () => {
    const coordinator = new EditorToolCoordinator()
    const stateChanges: any[] = []
    const toolChanges: any[] = []

    const offState = gameBus.on('EDITOR_TOOL_STATE_CHANGED', (payload) => stateChanges.push(payload))
    const offTool = gameBus.on('EDITOR_TOOL_CHANGED', (payload) => toolChanges.push(payload))

    expect(coordinator.beginGizmoDrag()).toBe(true)

    gameBus.emit('EDITOR_TOOL_CHANGE_REQUESTED', {
      tool: 'PAINT',
      reason: 'test',
      source: 'ui',
      timestamp: Date.now(),
    })

    expect(coordinator.getActiveTool()).toBe('PAINT')
    expect(coordinator.getState().busyOwner).toBe('none')
    expect(toolChanges.at(-1)).toEqual(expect.objectContaining({ tool: 'PAINT', previousTool: 'SELECT' }))
    expect(stateChanges.at(-1)).toEqual(expect.objectContaining({ activeTool: 'PAINT', busyOwner: 'none' }))

    offState()
    offTool()
    coordinator.destroy()
  })

  it('prevents painting while gizmo is active and allows paint strokes when paint tool is selected', () => {
    const coordinator = new EditorToolCoordinator()

    expect(coordinator.beginGizmoDrag()).toBe(true)
    expect(coordinator.beginPaintStroke()).toBe(false)
    expect(coordinator.endGizmoDrag()).toBe(true)

    coordinator.setActiveTool('PAINT', 'test', 'system')
    expect(coordinator.canPaint()).toBe(true)
    expect(coordinator.beginPaintStroke()).toBe(true)
    expect(coordinator.getState().busyOwner).toBe('paint')
  })
})