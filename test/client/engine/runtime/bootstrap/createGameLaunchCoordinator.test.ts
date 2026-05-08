import { beforeEach, describe, expect, it, vi } from 'vitest'

const inventoryGridManager = { initOffline: vi.fn() }

vi.mock('../../../../../client/src/engine/foundation/Engine', () => ({
  setRuntimePlayerId: vi.fn(),
  ensureGameplayUiActive: vi.fn(),
  setEngineState: vi.fn(),
  loadMap: vi.fn(),
  saveMap: vi.fn(),
  listMaps: vi.fn(() => ['map_default']),
  getInventoryGridManager: vi.fn(() => inventoryGridManager),
}))
vi.mock('@engine/core/public-api', () => ({
  FeatureManager: {
    configure: vi.fn(),
    enable: vi.fn(),
    toggle: vi.fn(),
    save: vi.fn(),
    isEnabled: vi.fn(() => true),
  },
  FEATURE_META: {
    debugTools: { label: 'Debug Tools' },
  },
  logEvent: vi.fn(),
}))

import * as Engine from '../../../../../client/src/engine/foundation/Engine'
import { createGameLaunchCoordinator } from '../../../../../client/src/engine/runtime/bootstrap/createGameLaunchCoordinator'
import { FeatureManager } from '@engine/core/public-api'

describe('createGameLaunchCoordinator', () => {
  const options = {
    engineController: { is: vi.fn(() => false) },
    mpClient: { playerId: 'player_1', connected: false, disconnect: vi.fn(), getLastLobbyState: vi.fn(() => ({ roundDurationSec: 120, killLimit: 5 })), getLastRoundState: vi.fn(() => null) } as any,
    stateManager: { getRaw: vi.fn(() => null), set: vi.fn() } as any,
    worldRuntime: (() => {
      const bootstrapCoordinator = { setLocalPlayerDead: vi.fn() }
      return {
        setActiveMapCollisionLayout: vi.fn(),
        buildScriptedLevel: vi.fn(() => null),
        buildMatchLevel: vi.fn(() => null),
        setActiveLevelGroup: vi.fn(),
        registerStaticLevelGeometryForCulling: vi.fn(),
        registerScriptedSpawnPoints: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
        registerArenaSpawnPoints: vi.fn(),
        getLocalFreeplayPlayerId: vi.fn(() => 'player_1'),
        ensurePlayerRuntimeState: vi.fn(),
        bindNetworkSyncLocalPlayer: vi.fn(),
        syncLocalPlayerToAuthoritativeSpawn: vi.fn(),
        buildFlatTestMap: vi.fn(() => null),
        getCollisionAuthoritySystem: vi.fn(),
        getLocalPlayerBootstrapCoordinator: vi.fn(() => bootstrapCoordinator),
        hardResetRuntimeState: vi.fn(),
        resetGameplayWorld: vi.fn(),
        bootstrapCoordinator,
      }
    })() as any,
    playerModelSystem: { clearAll: vi.fn() } as any,
    worldObjectAuthorityService: { clear: vi.fn() } as any,
    spawnSystem: { findSpawnPosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })) } as any,
    gameHUD: { show: vi.fn(), setPlayerMode: vi.fn() } as any,
    engineGameModes: { getSpawnLoadout: vi.fn(() => ({ weapons: ['weapon_1'] })), activate: vi.fn() } as any,
    gameModeManager: { getRound: vi.fn(() => ({ roundNumber: 1 })), startRound: vi.fn() } as any,
    sessionLifecycleCoordinator: { setRuntimeMetricsSession: vi.fn(), prepareRoundInitialization: vi.fn() } as any,
    scriptedLevelSystem: null,
    multiplayerRuntime: { transitionEngineState: vi.fn(), stopInputSending: vi.fn(), resetSessionTimestamps: vi.fn(), markRoundStart: vi.fn(), getRuntimeAppStateLabel: vi.fn(), isGameplaySessionActive: vi.fn(), getServerHttpUrl: vi.fn(() => ''), getServerWsUrl: vi.fn(() => ''), handleGameStart: vi.fn(), hostAutostartMultiplayer: vi.fn(), joinAutostartMultiplayer: vi.fn(), prepareMultiplayerLobby: vi.fn() } as any,
    audioManager: { stopMusic: vi.fn() } as any,
    setPendingMatchResetMode: vi.fn(),
    setRuntimePlayerIdInState: vi.fn(),
    getLocalFreeplayPlayerId: vi.fn(() => 'player_1'),
    getCachedLobbyState: vi.fn(() => ({ roundDurationSec: 120, killLimit: 5 })),
    getCachedRoundState: vi.fn(() => null),
    getNextRoundNumber: vi.fn(() => 2),
    startRound: vi.fn(),
    getCurrentPlayerId: vi.fn(() => 'player_1'),
    setLocalPlayerDead: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    window.location.search = '?metricsSessionId=metric123'
  })

  it('creates a GameLaunchCoordinator that starts scripted levels', () => {
    const coordinator = createGameLaunchCoordinator(options as any)

    coordinator.startScriptedLevel('new_map')

    expect(options.worldRuntime.setActiveMapCollisionLayout).toHaveBeenCalledWith('scripted:new_map', 'new_map')
    expect(options.setPendingMatchResetMode).toHaveBeenCalledWith('full')
    expect(options.sessionLifecycleCoordinator.setRuntimeMetricsSession).toHaveBeenCalledWith('scripted', 'metric123')
    expect(options.engineController.is).toHaveBeenCalledWith('in_game')
    expect(options.multiplayerRuntime.transitionEngineState).toHaveBeenCalledWith('in_game', 'scripted_level:new_map')
    expect(options.worldRuntime.setActiveLevelGroup).toHaveBeenCalledWith(null)
    expect(options.worldRuntime.registerStaticLevelGeometryForCulling).not.toHaveBeenCalled()
    expect(options.worldRuntime.registerScriptedSpawnPoints).toHaveBeenCalledWith('new_map')
    expect(options.worldRuntime.syncLocalPlayerToAuthoritativeSpawn).toHaveBeenCalledWith({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 })
    expect(options.playerModelSystem.clearAll).not.toHaveBeenCalled()
    expect(options.gameHUD.show).toHaveBeenCalled()
    expect(options.engineGameModes.activate).toHaveBeenCalledWith('freeplay')
    expect(options.stateManager.set).toHaveBeenCalledWith('multiplayer.playerId', 'player_1')
    expect(FeatureManager.configure).toHaveBeenCalled()
  })

  it('starts a multiplayer match and initializes round state when needed', () => {
    const coordinator = createGameLaunchCoordinator(options as any)

    coordinator.startMultiplayerMatch({ map: 'arena', mode: 'ffa', sessionId: 'session-1' })

    expect(options.worldRuntime.setActiveMapCollisionLayout).toHaveBeenCalledWith('arena', 'session-1')
    expect(options.multiplayerRuntime.transitionEngineState).toHaveBeenCalledWith('starting', 'multiplayer_game_start')
    expect(options.multiplayerRuntime.transitionEngineState).toHaveBeenCalledWith('in_game', 'multiplayer_game_start')
    expect(options.worldRuntime.setActiveLevelGroup).toHaveBeenCalledWith(null)
    expect(options.worldRuntime.bootstrapCoordinator.setLocalPlayerDead).toHaveBeenCalledWith(false)
    expect(options.gameModeManager.startRound).toHaveBeenCalled()
    expect(options.sessionLifecycleCoordinator.prepareRoundInitialization).toHaveBeenCalledWith('game_start', 'full')
    expect(options.engineGameModes.activate).toHaveBeenCalledWith('round')
  })

  it('starts local freeplay and initializes offline inventory and freeplay world objects', () => {
    const collisionAuthority = {
      getStaticLayout: vi.fn(() => ({
        boxes: [{
          id: 'box1',
          position: { x: 0, y: 1, z: 2 },
          halfExtents: { x: 1, y: 2, z: 3 },
        }],
      })),
    }
    options.worldRuntime.getCollisionAuthoritySystem = vi.fn(() => collisionAuthority)
    options.worldObjectAuthorityService.syncRemoteWorldState = vi.fn()

    const coordinator = createGameLaunchCoordinator(options as any)

    coordinator.startLocalFreeplay()

    expect(inventoryGridManager.initOffline).toHaveBeenCalledWith('player_1', ['weapon_1'])
    expect(options.worldObjectAuthorityService.syncRemoteWorldState).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'box1',
        entityType: 'static_collider',
        position: { x: 0, y: 1, z: 2 },
      }),
    ])
  })
})
