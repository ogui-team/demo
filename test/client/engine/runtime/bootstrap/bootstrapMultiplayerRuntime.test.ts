import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/runtime/bootstrapClientRuntime', () => ({
  bootstrapRuntime: vi.fn(),
}))

import { bootstrapRuntime } from '../../../../../client/src/engine/runtime/bootstrapClientRuntime'
import { initializeMode } from '../../../../../client/src/engine/runtime/bootstrapMultiplayerRuntime'

describe('bootstrapMultiplayerRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    delete (window as any).__multiplayerRuntime
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as any).__multiplayerRuntime
    vi.restoreAllMocks()
  })

  it('boots the runtime and transitions to the multiplayer lobby', async () => {
    const transitionEngineState = vi.fn()
    const prepareMultiplayerLobby = vi.fn()

    ;(window as any).__multiplayerRuntime = {
      transitionEngineState,
      prepareMultiplayerLobby,
    }

    const modePromise = initializeMode()
    vi.advanceTimersByTime(150)
    await modePromise

    expect(bootstrapRuntime).toHaveBeenCalledTimes(1)
    expect(transitionEngineState).toHaveBeenCalledWith('lobby', 'auto_start_multiplayer')
    expect(prepareMultiplayerLobby).toHaveBeenCalledWith('auto_start_multiplayer')
  })

  it('does not throw when multiplayer runtime is unavailable', async () => {
    const modePromise = initializeMode()
    vi.advanceTimersByTime(150)
    await expect(modePromise).resolves.toBeUndefined()
    expect(bootstrapRuntime).toHaveBeenCalledTimes(1)
  })
})
