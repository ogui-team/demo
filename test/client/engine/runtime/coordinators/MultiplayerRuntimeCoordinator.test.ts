import { describe, expect, it, vi } from 'vitest'
import { MultiplayerRuntimeCoordinator } from '../../../../../client/src/engine/runtime/coordinators/MultiplayerRuntimeCoordinator'

describe('MultiplayerRuntimeCoordinator', () => {
  const makeCoordinator = (overrides: Record<string, unknown> = {}) => {
    const baseConfig = {
      engineController: { is: vi.fn(() => false), transition: vi.fn(() => true), state: 'boot' },
      mpClient: { connected: false, inGame: false, playerId: null },
      networkSyncSystem: { clearLiveLocalInput: vi.fn() },
      playerModelSystem: { syncFromPayload: vi.fn() },
      weaponSystem: {},
      healthSystem: {},
      gameModeManager: {},
      gameHUD: { getPlayerMode: vi.fn(() => 'menu') },
      worldRuntime: { getLocalPlayerBootstrapCoordinator: vi.fn(() => ({ isAwaitingAuthoritativeSpawn: vi.fn(() => false), isLocalPlayerDead: vi.fn(() => false) })) },
      runtimeDiagnosticsCoordinator: {},
      liveCullingSystem: { getDiagnostics: vi.fn(() => ({ active: true })) },
      hitFeedback: { showHitMarker: vi.fn(), showDamageTaken: vi.fn(), showKillConfirm: vi.fn(), showDeathScreen: vi.fn() },
      overlayRuntime: { setInGameMode: vi.fn(), attachInGameModePanelClient: vi.fn(), showServerBrowser: vi.fn(), reopenServerBrowserToList: vi.fn(), prewarmPersistedServerBrowser: vi.fn(), buildRuntimeIssueSnapshot: vi.fn(() => ({ ok: true })) },
    }

    return new MultiplayerRuntimeCoordinator({ ...baseConfig, ...overrides } as any)
  }

  it('transitions engine states using the engine controller', () => {
    const engineController = {
      is: vi.fn((state: string) => state === 'boot'),
      transition: vi.fn((next: string) => next === 'menu' || next === 'lobby'),
      state: 'boot',
    }
    const coordinator = makeCoordinator({ engineController })

    expect(coordinator.transitionEngineState('menu', 'test')).toBe(true)
    expect(engineController.transition).toHaveBeenCalledWith('menu')

    engineController.is = vi.fn((state: string) => state === 'menu')
    expect(coordinator.transitionEngineState('lobby', 'test')).toBe(true)
    expect(engineController.transition).toHaveBeenCalledWith('lobby')
  })

  it('returns false when engine state transition prereqs fail', () => {
    const engineController = {
      is: vi.fn((state: string) => state === 'boot'),
      transition: vi.fn(() => false),
      state: 'boot',
    }
    const coordinator = makeCoordinator({ engineController })

    expect(coordinator.transitionEngineState('lobby', 'test')).toBe(false)
    expect(engineController.transition).toHaveBeenCalledWith('menu')
  })

  it('tracks gameplay session activity from controller state', () => {
    const gameHUD = { getPlayerMode: vi.fn(() => 'play') }
    const engineController = { is: vi.fn((state: string) => state === 'in_game'), transition: vi.fn(() => true), state: 'in_game' }
    const mpClient = { connected: false, inGame: false, playerId: null }
    const coordinator = makeCoordinator({ gameHUD, engineController, mpClient })

    expect(coordinator.isGameplaySessionActive()).toBe(true)

    engineController.is = vi.fn(() => false)
    expect(coordinator.isGameplaySessionActive()).toBe(false)
  })
})
