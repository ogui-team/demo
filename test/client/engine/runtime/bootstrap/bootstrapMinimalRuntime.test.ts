import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/foundation/Engine', () => ({
  init: vi.fn(),
  getStateManagerInstance: vi.fn(() => ({})),
  getEngineController: vi.fn(() => ({})),
  getNetworkSyncSystem: vi.fn(() => ({})),
  getSystemContext: vi.fn(() => ({})),
}))

import * as Engine from '../../../../../client/src/engine/foundation/Engine'
import { bootstrapMinimalRuntime } from '../../../../../client/src/engine/runtime/bootstrapMinimalRuntime'

describe('bootstrapMinimalRuntime', () => {
  let canvas: HTMLCanvasElement

  beforeEach(() => {
    vi.resetAllMocks()
    ;(Engine.init as any).mockImplementation(vi.fn())
    ;(Engine.getStateManagerInstance as any).mockReturnValue({})
    ;(Engine.getEngineController as any).mockReturnValue({})
    ;(Engine.getNetworkSyncSystem as any).mockReturnValue({})
    ;(Engine.getSystemContext as any).mockReturnValue({})
    canvas = document.createElement('canvas')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes the engine kernel and validates critical systems', async () => {
    await expect(bootstrapMinimalRuntime(canvas)).resolves.toBeUndefined()

    expect(Engine.init).toHaveBeenCalledTimes(1)
    expect(Engine.init).toHaveBeenCalledWith(canvas, expect.objectContaining({
      fogDensity: 0.02,
      fogColor: 0x334444,
      ambientLightIntensity: 0.4,
      directionalLightIntensity: 0.8,
    }))
    expect(Engine.getStateManagerInstance).toHaveBeenCalled()
    expect(Engine.getEngineController).toHaveBeenCalled()
    expect(Engine.getNetworkSyncSystem).toHaveBeenCalled()
    expect(Engine.getSystemContext).toHaveBeenCalled()
  })

  it('throws when the state manager is not initialized', async () => {
    ;(Engine.getStateManagerInstance as any).mockReturnValue(null)

    await expect(bootstrapMinimalRuntime(canvas)).rejects.toThrow('StateManager initialization failed')
    expect(Engine.init).toHaveBeenCalled()
  })

  it('throws when the engine controller is not initialized', async () => {
    ;(Engine.getEngineController as any).mockReturnValue(null)

    await expect(bootstrapMinimalRuntime(canvas)).rejects.toThrow('EngineController initialization failed')
  })

  it('throws when the system context is not initialized', async () => {
    ;(Engine.getSystemContext as any).mockReturnValue(null)

    await expect(bootstrapMinimalRuntime(canvas)).rejects.toThrow('System context initialization failed')
  })
})
