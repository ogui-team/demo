import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/runtime/coordinators/MultiplayerRuntimeCoordinator', () => ({
  MultiplayerRuntimeCoordinator: class {
    options: any
    constructor(options: any) {
      this.options = options
    }
  },
}))

vi.mock('../../../../../client/src/engine/runtime/RuntimeAuxiliaryAssembly', () => ({
  RuntimeAuxiliaryAssembly: class {
    options: any
    constructor(options: any) {
      this.options = options
    }
  },
}))

import {
  createMultiplayerRuntimeCoordinator,
  createRuntimeAuxiliaryAssembly,
} from '../../../../../client/src/engine/runtime/bootstrap/runtimeAssemblies'

describe('runtime assembly factories', () => {
  it('creates a multiplayer runtime coordinator with the provided options', () => {
    const options = { serverUrl: 'wss://example.com', playerId: 'test-player' }
    const coordinator = createMultiplayerRuntimeCoordinator(options)

    expect(coordinator).toBeDefined()
    expect((coordinator as any).options).toBe(options)
  })

  it('creates a runtime auxiliary assembly and preserves the passed configuration', () => {
    const config = { debugMode: true, name: 'aux' }
    const assembly = createRuntimeAuxiliaryAssembly(config)

    expect(assembly).toBeDefined()
    expect((assembly as any).options).toBe(config)
  })
})
