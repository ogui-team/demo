import { beforeEach, describe, expect, it, vi } from 'vitest'

const coordinatorConfigs: any[] = []

class MockUICompositionCoordinator {
  config: any
  constructor(config: any) {
    this.config = config
    coordinatorConfigs.push(config)
  }
}

vi.mock('../../../../../client/src/engine/ui/UICompositionCoordinator', () => ({
  UICompositionCoordinator: MockUICompositionCoordinator,
}))

vi.mock('../../../../../client/src/engine/foundation/Engine', () => ({
  setEngineMode: vi.fn(),
  setEngineState: vi.fn(),
  loadMap: vi.fn(),
  saveMap: vi.fn(),
  listMaps: vi.fn(() => ['forest_arena', 'map_default', 'custom_map']),
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

import { createRuntimeUiCompositionCoordinator } from '../../../../../client/src/engine/runtime/bootstrap/createRuntimeUiCompositionCoordinator'
import { FeatureManager, logEvent } from '@engine/core/public-api'

describe('createRuntimeUiCompositionCoordinator', () => {
  let options: any
  let coordinator: any

  beforeEach(async () => {
    vi.clearAllMocks()
    coordinatorConfigs.length = 0

    options = {
      modeManager: { registerListener: vi.fn() },
      engineController: { is: vi.fn(() => false) },
      mpClient: { connected: true, sendLobbyAction: vi.fn() },
      gameLaunchCoordinator: {
        startLocalFreeplay: vi.fn(),
        startEngineShowcase: vi.fn(),
        startScriptedLevel: vi.fn(),
        hostAutostartMultiplayer: vi.fn(),
        joinAutostartMultiplayer: vi.fn(),
      },
      audioManager: {
        stopMusic: vi.fn(),
        getMixerState: vi.fn(() => ({ master: 0.5 })),
        adjustChannelVolume: vi.fn(),
        toggleMute: vi.fn(),
      },
      worldRuntime: {
        getActiveLevelGroup: vi.fn(() => 'world_group'),
        buildMinimalTestArena: vi.fn(() => 'arena_group'),
        clearActiveLevel: vi.fn(),
        buildMatchLevel: vi.fn(() => null),
        setActiveLevelGroup: vi.fn(),
      },
      multiplayerRuntime: {
        prepareMultiplayerLobby: vi.fn(),
        transitionEngineState: vi.fn(),
        hostAutostartMultiplayer: vi.fn(),
        joinAutostartMultiplayer: vi.fn(),
        getServerHttpUrl: vi.fn(() => 'http://localhost'),
        getServerWsUrl: vi.fn(() => 'ws://localhost'),
        handleGameStart: vi.fn(),
      },
      scriptedLevelSystem: {
        listLevels: vi.fn(() => [{ id: 'level1', label: 'Level One', description: 'desc' }]),
      },
      engineGameModes: {
        getActiveName: vi.fn(() => 'ffa'),
        listModes: vi.fn(() => ['ffa']),
        getMode: vi.fn(() => ({ displayName: 'FFA' })),
        activate: vi.fn(),
      },
      menuIdentitySystem: { getElement: vi.fn(() => '<identity/>') },
      debugManager: { enable: vi.fn() },
    }

    coordinator = await createRuntimeUiCompositionCoordinator(options)
  })

  it('returns a UICompositionCoordinator instance', () => {
    expect(coordinator).toBeInstanceOf(MockUICompositionCoordinator)
    expect(coordinatorConfigs).toHaveLength(1)
  })

  it('routes main menu freeplay and debug feature actions', () => {
    const config = coordinatorConfigs[0]
    config.mainMenu.onFreeplay()
    expect(options.gameLaunchCoordinator.startLocalFreeplay).toHaveBeenCalled()

    config.mainMenu.enableMultiplayerFeature()
    expect(FeatureManager.enable).toHaveBeenCalledWith('multiplayer')

    config.mainMenu.toggleFeature('debugTools')
    expect(FeatureManager.toggle).toHaveBeenCalledWith('debugTools')

    config.mainMenu.activateGameMode('ffa')
    expect(logEvent).toHaveBeenCalledWith('engine', 'Gamemode set to ffa (menu)')
  })

  it('builds maps and features lists correctly for the server browser and menu', () => {
    const config = coordinatorConfigs[0]

    const maps = config.mainMenu.getMaps()
    expect(maps).toContain('custom_map')
    expect(maps).toContain('forest_arena')

    const features = config.mainMenu.getFeatures()
    expect(features[0]).toEqual(expect.objectContaining({ key: 'debugTools' }))

    config.serverBrowser.onHostGame({ playerName: 'User', config: { name: 'room', map: 'arena', killLimit: 10, roundDurationSec: 60, maxPlayers: 8 } })
    expect(options.multiplayerRuntime.hostAutostartMultiplayer).toHaveBeenCalled()

    config.serverBrowser.onJoinGame({ playerName: 'User', roomId: 'room1' })
    expect(options.multiplayerRuntime.joinAutostartMultiplayer).toHaveBeenCalled()
  })
})
