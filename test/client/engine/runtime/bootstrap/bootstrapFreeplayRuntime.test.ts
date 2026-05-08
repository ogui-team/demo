import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/runtime/bootstrapClientRuntime', () => ({
  bootstrapRuntime: vi.fn(),
}))

import { bootstrapRuntime } from '../../../../../client/src/engine/runtime/bootstrapClientRuntime'
import { initializeMode } from '../../../../../client/src/engine/runtime/bootstrapFreeplayRuntime'

describe('bootstrapFreeplayRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (window as any).__gameLaunchCoordinator
  })

  afterEach(() => {
    delete (window as any).__gameLaunchCoordinator
    vi.restoreAllMocks()
  })

  it('bootstraps the client runtime and starts freeplay if coordinator is available', async () => {
    const startLocalFreeplay = vi.fn()
    ;(window as any).__gameLaunchCoordinator = {
      startLocalFreeplay,
    }

    await initializeMode()

    expect(bootstrapRuntime).toHaveBeenCalledTimes(1)
    expect(startLocalFreeplay).toHaveBeenCalledTimes(1)
  })

  it('resolves even when the game launch coordinator is not present', async () => {
    await expect(initializeMode()).resolves.toBeUndefined()
    expect(bootstrapRuntime).toHaveBeenCalledTimes(1)
  })
})
