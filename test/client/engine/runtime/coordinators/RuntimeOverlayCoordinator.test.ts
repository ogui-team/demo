import { describe, expect, it, vi } from 'vitest'
import { RuntimeOverlayCoordinator } from '../../../../../client/src/engine/runtime/coordinators/RuntimeOverlayCoordinator'

describe('RuntimeOverlayCoordinator', () => {
  const makeCoordinator = () => {
    const config = {
      debugManager: {},
      engineController: { registerSystems: vi.fn(), is: vi.fn(() => false) },
      modeManager: null,
      mpClient: { getDebugStats: vi.fn(() => ({ ping: 0 })) },
      runtimeDiagnosticsCoordinator: {},
      liveCullingSystem: { getDiagnostics: vi.fn(() => ({})), isEnabled: vi.fn(() => false), setEnabled: vi.fn() },
      gameHUD: {},
      audioManager: {},
      gameModeManager: { on: vi.fn(), off: vi.fn() },
      engineGameModes: {},
      runtimeMetricsReporterRef: vi.fn(() => null),
      buildRuntimeIssueSnapshot: vi.fn(() => ({ issue: 'snapshot' })),
      physicsSystem: { getBodyIds: vi.fn(() => []) },
      getActiveRuntimePlayerId: vi.fn(() => null),
      syncLocalPlayerToAuthoritativeSpawn: vi.fn(),
      worldObjectAuthorityService: {},
      spawnSystem: {},
      inventorySystem: {},
      weaponSystem: {},
      undoRedoSystem: {},
      prefabSystem: {},
      saveLoadManager: null,
      replaySystem: {},
      editorMenu: null,
      syncEditorPrefabLibrary: vi.fn(),
      setLastEditorSnapshot: vi.fn(),
      search: '',
      serverHttpUrl: 'http://localhost',
      serverWsUrl: 'ws://localhost',
      launchActions: {
        startLocalFreeplay: vi.fn(),
        startEngineShowcase: vi.fn(),
        startScriptedLevel: vi.fn(),
        hostMultiplayer: vi.fn(),
        joinMultiplayer: vi.fn(),
      },
      createUiCompositionCoordinator: vi.fn(async () => ({
        setInGameMode: vi.fn(),
        attachInGameModePanelClient: vi.fn(),
        showServerBrowser: vi.fn(),
        reopenServerBrowserToList: vi.fn(),
        prewarmPersistedServerBrowser: vi.fn(),
        startRuntimeUi: vi.fn(),
      })),
      auxiliaryAssemblyRef: vi.fn(() => ({
        getAutoHealthChannelSync: vi.fn(),
        setAutoHealthChannelSync: vi.fn(),
        syncHealthChannels: vi.fn(),
        getStatusMovementDebugState: vi.fn(),
        setStatusMovementDebugConfig: vi.fn(),
        resetStatusMovementDebugConfig: vi.fn(),
      })),
      worldRuntime: {
        getHealthChannelHpSummary: vi.fn(),
        getHealthChannelShieldSummary: vi.fn(),
        getHealthChannelGasSummary: vi.fn(),
      },
    }
    return new RuntimeOverlayCoordinator(config as any)
  }

  it('builds runtime issue snapshots using config callback', () => {
    const coordinator = makeCoordinator()
    expect(coordinator.buildRuntimeIssueSnapshot()).toEqual({ issue: 'snapshot' })
  })

  it('routes UI actions through the UI composition coordinator', async () => {
    const coordinator = makeCoordinator()
    const ui = {
      setInGameMode: vi.fn(),
      attachInGameModePanelClient: vi.fn(),
      showServerBrowser: vi.fn(),
      reopenServerBrowserToList: vi.fn(),
      prewarmPersistedServerBrowser: vi.fn(),
      startRuntimeUi: vi.fn(),
    }

    ;(coordinator as any).ensureUiCompositionCoordinator = vi.fn(async () => ui)
    ;(coordinator as any).ensureScoreboard = vi.fn(async () => ({ hide: vi.fn() }))

    coordinator.setInGameMode('play')
    coordinator.attachInGameModePanelClient(true)
    coordinator.showServerBrowser()
    coordinator.reopenServerBrowserToList('list')
    coordinator.prewarmPersistedServerBrowser()
    await coordinator.startRuntimeUi()

    expect(ui.setInGameMode).toHaveBeenCalledWith('play')
    expect(ui.attachInGameModePanelClient).toHaveBeenCalledWith(true)
    expect(ui.showServerBrowser).toHaveBeenCalled()
    expect(ui.reopenServerBrowserToList).toHaveBeenCalledWith('list')
    expect(ui.prewarmPersistedServerBrowser).toHaveBeenCalled()
    expect(ui.startRuntimeUi).toHaveBeenCalledWith('', (coordinator as any).config.launchActions)
  })
})
