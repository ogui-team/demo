import { describe, expect, it } from 'vitest'
import { SpatialRuntimeDebugHud } from '../../../../client/src/4-runtime/runtime/SpatialRuntimeDebugHud'

describe('SpatialRuntimeDebugHud', () => {
  it('creates a HUD container and updates its contents', () => {
    const snapshot = {
      fps: 60,
      totalEntities: 3,
      visibleCells: 2,
      activeCells: 2,
      sleepingEntities: 1,
      dormantAiEntities: 0,
      renderedMeshes: 5,
      activeAiEntities: 1,
      visibleMeshes: 4,
      culledMeshes: 1,
      migrations: 0,
      cellAllocations: 1,
      loadedChunks: 0,
      activePathJobs: 0,
      streamingQueueSize: 0,
      simulationTickMs: 2.5,
      renderTickMs: 1.2,
    }

    const hud = new SpatialRuntimeDebugHud({ readSnapshot: () => snapshot, updateIntervalMs: 100 })
    hud.setEnabled(true)
    hud.update(0.2)

    const container = document.getElementById('spatial-runtime-debug-hud')
    expect(container).not.toBeNull()
    expect(container?.innerHTML).toContain('FPS:')
    expect(container?.innerHTML).toContain('Render Tick: 1.20 ms')

    hud.setEnabled(false)
    expect(container?.style.display).toBe('none')

    hud.dispose()
    expect(document.getElementById('spatial-runtime-debug-hud')).toBeNull()
  })
})
