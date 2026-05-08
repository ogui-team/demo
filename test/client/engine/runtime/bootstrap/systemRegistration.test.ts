import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../client/src/engine/foundation/CorridorOrchestrator', () => ({
  orchestrateCorridorManifest: vi.fn(),
}))

vi.mock('@engine/core/public-api', () => ({
  registerSystemMetadata: vi.fn(),
}))

vi.mock('../../../../../client/src/engine/runtime/bootstrap/support', () => ({
  getContextDeps: vi.fn(() => ({
    eventBus: {},
    entityManager: null,
    networkManager: null,
    networkSyncSystem: null,
    replicationSystem: null,
    multiplayerClient: null,
    resourceManager: null,
  })),
}))

import { registerRuntimeSystems, registerSaveLoadHandlers } from '../../../../../client/src/engine/runtime/bootstrap/systemRegistration'
import { orchestrateCorridorManifest } from '../../../../../client/src/engine/foundation/CorridorOrchestrator'
import { registerSystemMetadata } from '@engine/core/public-api'
import { getContextDeps } from '../../../../../client/src/engine/runtime/bootstrap/support'

const mockedOrchestrateCorridorManifest = vi.mocked(orchestrateCorridorManifest)
const mockedRegisterSystemMetadata = vi.mocked(registerSystemMetadata)
const mockedGetContextDeps = vi.mocked(getContextDeps)

describe('registerRuntimeSystems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers primary and secondary runtime systems and assigns multiplayer metadata', () => {
    const options: any = {
      mpClient: { connected: false },
      gameModeManager: {},
      stateManager: { get: vi.fn(), set: vi.fn(), update: vi.fn() },
      systemContext: {},
      collisionAuthoritySystem: {},
      worldObjectAuthorityService: {},
      characterActorSystem: {},
      physicsSystem: {},
      spriteAtlasSystem: {},
      camera2DSystem: {},
      featureManager: {},
      gameModeSystem: {},
      playerModelSystem: { getPlayerCount: vi.fn(() => 0), getPlayerIds: vi.fn(() => []) },
      weaponSystem: {},
      healthSystem: {},
      physics2DSystem: {},
      input2DAdapterSystem: {},
      spriteAnimationSystem: {},
      objectCreator: { getDebugState: vi.fn(() => ({ metrics: { objectCount: 0, prefabCount: 0 } })) },
      prefabSystem: { listPrefabs: vi.fn(() => []) },
      abilitySystem: { getDebugState: vi.fn(() => ({ metrics: { cooldownCount: 0, projectileCount: 0, aoeZoneCount: 0 } })) },
      weaponPresentationSystem: {},
      spawnSystem: {},
      undoRedoSystem: {},
      inventorySystem: {},
      tilemapSystem: {},
      parallax2DSystem: {},
      spriteRenderSystem: {},
      ui2DSystem: {},
      adaptiveRuntime: {},
      materialManager: {},
      audioManager: {},
      debugManager: {},
      scriptedLevelSystem: null,
    }

    registerRuntimeSystems(options)

    expect(mockedOrchestrateCorridorManifest).toHaveBeenCalled()
    expect(mockedRegisterSystemMetadata).toHaveBeenCalledWith('multiplayerClient', expect.objectContaining({ getState: expect.any(Function) }))
    expect(mockedGetContextDeps).toHaveBeenCalledWith(options.mpClient)
  })
})

describe('registerSaveLoadHandlers', () => {
  it('registers save/load handlers for supported systems', () => {
    const handlers: Record<string, { save: () => unknown; load: (data: unknown) => void }> = {}
    const saveLoadManager = {
      registerSystemDataHandler: vi.fn((key, save, load) => {
        handlers[key] = { save, load }
      }),
    }

    const weaponSystem = {
      exportState: vi.fn(() => ({ weapons: 1 })),
      importState: vi.fn(),
    }
    const inventorySystem = {
      exportState: vi.fn(() => ({ inventory: [] })),
      importState: vi.fn(),
    }
    const prefabSystem = {
      exportState: vi.fn(() => ({ prefabs: [] })),
      importState: vi.fn(),
    }
    const spawnSystem = {
      exportState: vi.fn(() => ({ spawns: [] })),
      importState: vi.fn(),
    }
    const engineGameModes = {
      captureSnapshot: vi.fn(() => ({ gameMode: 'ffa' })),
      restoreSnapshot: vi.fn(),
    }

    registerSaveLoadHandlers({ saveLoadManager: saveLoadManager as any, weaponSystem: weaponSystem as any, inventorySystem: inventorySystem as any, prefabSystem: prefabSystem as any, spawnSystem: spawnSystem as any, engineGameModes: engineGameModes as any })

    expect(saveLoadManager.registerSystemDataHandler).toHaveBeenCalledTimes(5)
    expect(handlers.weapons.save()).toEqual({ weapons: 1 })
    expect(handlers.inventories.save()).toEqual({ inventory: [] })
    expect(handlers.prefabs.save()).toEqual({ prefabs: [] })
    expect(handlers.spawns.save()).toEqual({ spawns: [] })
    expect(handlers.gameModes.save()).toEqual({ gameMode: 'ffa' })

    handlers.gameModes.load({ gameMode: 'ffa' })
    expect(engineGameModes.restoreSnapshot).toHaveBeenCalledWith({ gameMode: 'ffa' })
  })
})
