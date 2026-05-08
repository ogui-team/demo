import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/runtime/bootstrapMultiplayerRuntime', () => ({
  initializeMode: vi.fn(),
}))
vi.mock('../../../../../client/src/engine/runtime/bootstrapFreeplayRuntime', () => ({
  initializeMode: vi.fn(),
}))

import { PreloadingStrategy } from '../../../../../client/src/engine/runtime/PreloadingStrategy'
import * as multiplayerRuntime from '../../../../../client/src/engine/runtime/bootstrapMultiplayerRuntime'
import * as freeplayRuntime from '../../../../../client/src/engine/runtime/bootstrapFreeplayRuntime'

describe('PreloadingStrategy', () => {
  let strategy: PreloadingStrategy

  beforeEach(() => {
    vi.clearAllMocks()
    strategy = new PreloadingStrategy()
  })

  afterEach(() => {
    strategy.destroy()
    vi.restoreAllMocks()
  })

  it('loads a registered freeplay module on demand and caches it', async () => {
    strategy.registerMode('freeplay')

    const module = await strategy.getMode('freeplay')

    expect(module).toBe(freeplayRuntime)
    expect(module.initializeMode).toBe(freeplayRuntime.initializeMode)
    expect(strategy.getStats()).toEqual({
      preloadedModes: ['freeplay'],
      totalPreloaded: 1,
      totalSavingsMs: 400,
    })
  })

  it('returns a cached multiplayer module after first load', async () => {
    strategy.registerMode('multiplayer')

    const firstLoad = await strategy.getMode('multiplayer')
    const secondLoad = await strategy.getMode('multiplayer')

    expect(firstLoad).toBe(secondLoad)
    expect(firstLoad.initializeMode).toBe(multiplayerRuntime.initializeMode)
  })

  it('records selections and predicts the next mode for idle preload', async () => {
    strategy.registerMode('multiplayer')
    strategy.recordSelection('multiplayer')
    strategy.recordSelection('multiplayer')
    strategy.recordSelection('freeplay')

    strategy.startIdleMonitoring()
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(strategy.getStats().preloadedModes).toContain('multiplayer')
    expect(strategy.getStats().totalPreloaded).toBe(1)
  })
})
