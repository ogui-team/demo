
const mocks = vi.hoisted(() => ({
  setInputContext: vi.fn(),
  disableSystem: vi.fn(),
  markSystemError: vi.fn(),
  markSystemUpdated: vi.fn(),
  registerSystem: vi.fn(),
  logEvent: vi.fn(),
  gameBus: { emit: vi.fn() },
  stateManager: { set: vi.fn() },
  ensureGameplayUiActive: vi.fn(),
}))

vi.mock('../../client/src/engine/core/ControlRuntime', () => ({
  setInputContext: mocks.setInputContext,
  disableSystem: mocks.disableSystem,
  markSystemError: mocks.markSystemError,
  markSystemUpdated: mocks.markSystemUpdated,
  registerSystem: mocks.registerSystem,
  logEvent: mocks.logEvent,
  gameBus: mocks.gameBus,
}))
vi.mock('../../client/src/engine/diagnostics/debug/FrameCostProfiler', () => ({
  runtimeFrameCostProfiler: {
    isSamplingFrame: vi.fn(() => false),
    measure: vi.fn((label: string, callback: () => void) => callback()),
  },
}))
vi.mock('../../client/src/0-foundation/foundation/Engine', () => ({
  getStateManagerInstance: () => mocks.stateManager,
  ensureGameplayUiActive: mocks.ensureGameplayUiActive,
}))

import { EngineController } from '../../client/src/engine/core/EngineController'

describe('EngineController', () => {
  beforeEach(() => {
    mocks.setInputContext.mockClear()
    mocks.disableSystem.mockClear()
    mocks.markSystemError.mockClear()
    mocks.markSystemUpdated.mockClear()
    mocks.registerSystem.mockClear()
    mocks.logEvent.mockClear()
    mocks.gameBus.emit.mockClear()
    mocks.stateManager.set.mockClear()
    mocks.ensureGameplayUiActive.mockClear()
  })

  afterEach(async () => {
    const { setCameraAuthority } = await import('../../client/src/engine/camera/CameraStateAdapter')
    setCameraAuthority('menu')
  })

  it('registers systems and transitions state correctly', () => {
    const controller = new EngineController()
    const system = { update: vi.fn() }
    controller.registerSystems({ entityManager: system, auxiliarySystems: { aux: { update: vi.fn() } } })

    expect(mocks.registerSystem).toHaveBeenCalledWith('entityManager', system)
    expect(mocks.registerSystem).toHaveBeenCalledWith('aux', expect.any(Object))

    const result = controller.transition('menu')
    expect(result).toBe(true)
    expect(controller.state).toBe('menu')
    expect(mocks.setInputContext).toHaveBeenCalledWith('ui')
    expect(mocks.gameBus.emit.mock.calls[0][0]).toBe('stateMutation')
  })

  it('blocks invalid transitions and logs warnings', () => {
    const controller = new EngineController()
    const result = controller.transition('post_game')
    expect(result).toBe(false)
  })

  it('updates systems only in appropriate states and catches failures', () => {
    const errorSystem = {
      update: vi.fn(() => { throw new Error('boom') }),
      enable: vi.fn(),
      disable: vi.fn(),
    }
    const entityManager = { update: vi.fn() }
    const controller = new EngineController()
    controller.registerSystems({ entityManager, combatSystem: errorSystem })

    controller.transition('menu')
    controller.update(0.016)
    expect(entityManager.update).toHaveBeenCalled()
    expect(mocks.markSystemUpdated).toHaveBeenCalled()
    expect(mocks.markSystemError).not.toHaveBeenCalled()

    controller.transition('in_game')
  expect(errorSystem.enable).toHaveBeenCalled()
    controller.update(0.016)
    expect((errorSystem.update as any)).toHaveBeenCalled()
    expect(mocks.markSystemError).toHaveBeenCalled()
    expect(mocks.disableSystem).toHaveBeenCalled()
  })

  it('routes runtime mode and game mode through controller-owned sync', () => {
    const controller = new EngineController()
    const modeManager = {
      syncFromController: vi.fn(),
      isEditorMode: vi.fn(() => true),
      isPlayMode: vi.fn(() => false),
    }
    const gameModeSystem = {
      update: vi.fn(),
      syncFromController: vi.fn(),
      getActiveName: vi.fn(() => null),
      getMode: vi.fn((mode: string) => (mode === 'horde' ? { id: mode } : undefined)),
    }
    const gameplayRuntime = {
      update: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
    }
    const combatSystem = {
      update: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
    }

    controller.registerSystems({ modeManager, gameModeSystem, gameplayRuntime, combatSystem })

    controller.setGameMode('horde', 'test-selection')
    expect(gameModeSystem.syncFromController).toHaveBeenLastCalledWith(null)
    expect(mocks.stateManager.set).toHaveBeenCalledWith('game.mode', 'horde')

    controller.transition('menu')
    controller.transition('in_game')

    expect(modeManager.syncFromController).toHaveBeenLastCalledWith('play', { cameraAuthority: 'game' })
    expect(gameModeSystem.syncFromController).toHaveBeenLastCalledWith('horde')
    expect(gameplayRuntime.enable).toHaveBeenCalled()
    expect(combatSystem.enable).toHaveBeenCalled()
    expect(mocks.stateManager.set).toHaveBeenCalledWith('mode', 'play')
  })

  it('rejects direct runtime mode and game mode authority bypasses', async () => {
    const { ModeManager } = await import('../../client/src/2-systems/gameplay/modes/ModeManager')
    const { GameModeSystem } = await import('../../client/src/2-systems/gameplay/game/GameModeSystem')

    const modeManager = new ModeManager()
    await expect(modeManager.setMode('play')).rejects.toThrow('EngineController.setRuntimeMode')

    const gameModeSystem = new GameModeSystem()
    expect(() => gameModeSystem.activate('ffa')).toThrow('EngineController.setGameMode')
  })

  it('handles session authority intents through EngineController', () => {
    const controller = new EngineController()

    controller.requestSessionAuthorityIntent('restore-local-gameplay', 'test')
    expect(mocks.stateManager.set).toHaveBeenCalledWith('mode', 'play')
    expect(mocks.stateManager.set).toHaveBeenCalledWith('ui.hud.mode', 'play')
    expect(mocks.stateManager.set).toHaveBeenCalledWith('hud.visible', true)
    expect(mocks.ensureGameplayUiActive).toHaveBeenCalledTimes(1)

    controller.requestSessionAuthorityIntent('disconnect-cleanup', 'test')
    expect(mocks.stateManager.set).toHaveBeenCalledWith('ui.hud.mode', 'hidden')
    expect(mocks.stateManager.set).toHaveBeenCalledWith('hud.visible', false)
    expect(mocks.stateManager.set).toHaveBeenCalledWith('mode', 'editor')
  })

  it('publishes app and gameplay state flags from the controller', () => {
    const controller = new EngineController()
    const gameplayRuntime = {
      update: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
    }
    controller.registerSystems({ gameplayRuntime })

    controller.transition('menu')
    controller.transition('in_game')

    expect(mocks.stateManager.set).toHaveBeenCalledWith('engine.appState', 'menu')
    expect(mocks.stateManager.set).toHaveBeenCalledWith('engine.appState', 'in_game')
    expect(mocks.stateManager.set).toHaveBeenCalledWith('gameplay.active', true)

    controller.transition('post_game')

    expect(mocks.stateManager.set).toHaveBeenCalledWith('gameplay.active', false)
    expect(gameplayRuntime.enable).toHaveBeenCalled()
    expect(gameplayRuntime.disable).toHaveBeenCalled()
  })

  it('restores previous camera authority after snapshot overrides', async () => {
    const controller = new EngineController()
    const { getCameraAuthority, setCameraAuthority } = await import('../../client/src/engine/camera/CameraStateAdapter')

    setCameraAuthority('game')
    controller.setCameraAuthority('snapshot')

    expect(controller.canWriteCamera('snapshot')).toBe(true)
    expect(getCameraAuthority()).toBe('snapshot')

    controller.restorePreviousCameraAuthority()

    expect(getCameraAuthority()).toBe('game')
  })
})
