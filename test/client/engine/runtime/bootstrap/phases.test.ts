import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/foundation/Engine', () => ({
  getStateManagerInstance: vi.fn(),
  getEngineController: vi.fn(),
  getSystemContext: vi.fn(),
  getNetworkSyncSystem: vi.fn(),
  getEngineScene: vi.fn(),
  getEngineCamera: vi.fn(),
  getEngineRenderer: vi.fn(),
  getCullingSystem: vi.fn(),
}))

import * as Engine from '../../../../../client/src/engine/foundation/Engine'
import {
  bootstrapPhase1_CoreRuntime,
  bootstrapPhase2_RenderingRuntime,
  executeBootstrapPhases,
} from '../../../../../client/src/engine/runtime/bootstrap/phases'

describe('bootstrap phases', () => {
  const fakeScene = { id: 'scene' }
  const fakeCamera = { id: 'camera' }
  const fakeRenderer = { id: 'renderer' }
  const fakeCulling = { id: 'culling' }
  const fakeStateManager = { name: 'stateManager' }
  const fakeEngineController = { name: 'engineController' }
  const fakeSystemContext = { name: 'systemContext' }
  const fakeNetworkSyncSystem = { name: 'networkSyncSystem' }

  beforeEach(() => {
    vi.mocked(Engine.getStateManagerInstance).mockReturnValue(fakeStateManager)
    vi.mocked(Engine.getEngineController).mockReturnValue(fakeEngineController)
    vi.mocked(Engine.getSystemContext).mockReturnValue(fakeSystemContext)
    vi.mocked(Engine.getNetworkSyncSystem).mockReturnValue(fakeNetworkSyncSystem)
    vi.mocked(Engine.getEngineScene).mockReturnValue(fakeScene)
    vi.mocked(Engine.getEngineCamera).mockReturnValue(fakeCamera)
    vi.mocked(Engine.getEngineRenderer).mockReturnValue(fakeRenderer)
    vi.mocked(Engine.getCullingSystem).mockReturnValue(fakeCulling)
  })

  it('validates phase 1 core runtime context successfully', () => {
    const ctx = bootstrapPhase1_CoreRuntime()

    expect(ctx.stateManager).toBe(fakeStateManager)
    expect(ctx.engineController).toBe(fakeEngineController)
    expect(ctx.systemContext).toBe(fakeSystemContext)
    expect(ctx.listenerRegistry).toBeDefined()
  })

  it('throws when core runtime is missing the state manager', () => {
    vi.mocked(Engine.getStateManagerInstance).mockReturnValue(null)

    expect(() => bootstrapPhase1_CoreRuntime()).toThrow('[Phase 1] State manager not initialized - kernel may not be initialized')
  })

  it('validates phase 2 rendering runtime after phase 1 setup', () => {
    const ctx = bootstrapPhase1_CoreRuntime()

    expect(() => bootstrapPhase2_RenderingRuntime(ctx)).not.toThrow()
  })

  it('throws when rendering runtime scene is missing', () => {
    const ctx = bootstrapPhase1_CoreRuntime()
    vi.mocked(Engine.getEngineScene).mockReturnValue(null)

    expect(() => bootstrapPhase2_RenderingRuntime(ctx)).toThrow('[Phase 2] Engine scene not initialized')
  })

  it('executes bootstrap phases and returns a valid phase context', async () => {
    const ctx = await executeBootstrapPhases()

    expect(ctx.stateManager).toBe(fakeStateManager)
    expect(ctx.systemContext).toBe(fakeSystemContext)
    expect(ctx.engineController).toBe(fakeEngineController)
  })
})
