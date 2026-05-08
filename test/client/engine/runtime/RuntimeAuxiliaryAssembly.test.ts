import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@engine/core/public-api', () => ({
  getRuntimePerformanceMode: () => 'dev',
  RuntimePerformanceMode: {
    DEV: 'dev',
    RELEASE: 'release',
    CAPTURE: 'capture',
  },
}))

vi.mock('../../../../client/src/engine/foundation/Engine', () => ({
  getToolbarSystem: vi.fn(() => ({
    getActiveSlot: vi.fn(() => ({ index: 1, itemId: 'weapon_rifle' })),
  })),
  getInputRouter: vi.fn(() => ({ setCombatSystem: vi.fn() })),
  getEngineCamera: vi.fn(() => ({
    position: { x: 0, y: 0, z: 0 },
    getWorldDirection: vi.fn(() => ({ x: 1, y: 0, z: 0, normalize: vi.fn(() => ({ x: 1, y: 0, z: 0 })) })),
  })),
  getEntityManager: vi.fn(() => ({ getEntities: vi.fn(() => []) })),
  getGasEffectSystem: vi.fn(() => ({ getActiveEffects: vi.fn(() => []) })),
}))

import { RuntimeAuxiliaryAssembly } from '../../../../client/src/engine/runtime/RuntimeAuxiliaryAssembly'

describe('RuntimeAuxiliaryAssembly', () => {
  let assembly: RuntimeAuxiliaryAssembly
  let config: any

  beforeEach(() => {
    vi.clearAllMocks()
    config = {
      engineController: { registerSystems: vi.fn() },
      stateManager: { set: vi.fn() },
      mpClient: { connected: false },
      networkSyncSystem: {
        getAllMovementAuthorityDebugStates: vi.fn(() => []),
        getMovementTuningDebugState: vi.fn(() => ({ hasDebugOverride: false, live: null, hooks: null })),
        getLocalPlayerTransform: vi.fn(() => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } })),
        queueMovementIntent: vi.fn(),
        setDerivedStatusMovementModifier: vi.fn(),
        setDebugStatusMovementModifier: vi.fn(),
        setMovementFeelDebugConfig: vi.fn(),
      },
      gameHUD: {
        update: vi.fn(),
        getPlayerMode: vi.fn(() => 'editor'),
        setRoundState: vi.fn(),
        setPlayerList: vi.fn(),
        setEntityCount: vi.fn(),
      },
      gameModeManager: {
        getRound: vi.fn(() => ({ timeRemainingMs: 1000, killLimit: 10 })),
        getPlayer: vi.fn(() => ({ name: 'Joe', health: 90, kills: 1, deaths: 0 })),
        getPlayers: vi.fn(() => [{ name: 'Joe', health: 90 }]),
        activate: vi.fn(),
      },
      playerModelSystem: {
        update: vi.fn(),
        getPlayerIds: vi.fn(() => []),
        getGroup: vi.fn(() => null),
        getMovementDebugStates: vi.fn(() => []),
      },
      weaponPresentationSystem: { update: vi.fn(), handleFire: vi.fn(), handleImpact: vi.fn(), getDiagnostics: vi.fn(() => ({ pressure: 1 })) },
      characterActorSystem: { update: vi.fn(), getDiagnostics: vi.fn(() => ({ active: true })) },
      runtimeDiagnosticsCoordinator: { update: vi.fn() },
      worldRuntime: {
        getActiveRuntimePlayerId: vi.fn(() => 'player_1'),
        getLocalPlayerBootstrapCoordinator: vi.fn(() => ({ isLocalPlayerDead: vi.fn(() => false) })),
        syncActiveHealthChannels: vi.fn(),
        syncHealthChannelsFromGAS: vi.fn(),
        syncAdaptiveRuntime: vi.fn(),
        getLocalPlayerEntity: vi.fn(() => ({ getRotation: vi.fn(() => ({ y: 0 })) })),
        syncCameraToLocalPlayerEntity: vi.fn(),
      },
      multiplayerRuntime: {
        isGameplaySessionActive: vi.fn(() => false),
        updateInput: vi.fn(),
      },
      healthSystem: { update: vi.fn() },
      weaponSystem: {
        update: vi.fn(),
        onFire: vi.fn(),
        onHit: vi.fn(),
        setFireContextResolver: vi.fn(),
        setHitscanResolver: vi.fn(),
        onChange: vi.fn(),
        getDiagnostics: vi.fn(() => ({ health: 1 })),
        getEquipped: vi.fn(() => null),
        equip: vi.fn(),
        fire: vi.fn(() => true),
        reload: vi.fn(() => true),
      },
      inventorySystem: {
        update: vi.fn(),
        equipSlot: vi.fn(() => true),
        quickSwap: vi.fn(() => true),
      },
      prefabSystem: { update: vi.fn() },
      adaptiveRuntime: { update: vi.fn() },
      audioManager: { attachCamera: vi.fn(), update: vi.fn() },
      vfxMaker: { setCamera: vi.fn() },
      abilitySystem: {
        setMovementIntentSink: vi.fn(),
        update: vi.fn(),
      },
      netGraphBridge: { isVisible: vi.fn(() => true), update: vi.fn() },
      hitFeedbackBridge: { update: vi.fn(), showHitMarker: vi.fn(), showDamageTaken: vi.fn(), showKillConfirm: vi.fn(), destroy: vi.fn() },
      runtimeIssueInspectorBridge: { update: vi.fn() },
      runtimeMetricsReporterRef: vi.fn(() => ({ update: vi.fn(), getLastSample: vi.fn(() => null) })),
      worldObjectAuthorityDiagnostics: vi.fn(() => ({})),
      spriteSystems: {},
    }
    assembly = new RuntimeAuxiliaryAssembly(config)
  })

  it('toggles auto health channel sync', () => {
    expect(assembly.getAutoHealthChannelSync()).toBe(true)
    assembly.setAutoHealthChannelSync(false)
    expect(assembly.getAutoHealthChannelSync()).toBe(false)
  })

  it('updates and resets status movement debug config', () => {
    const updated = assembly.setStatusMovementDebugConfig({ rooted: true, speedMultiplier: 1.5, impulseMagnitude: 3 })
    expect(updated.config.rooted).toBe(true)
    expect(updated.config.speedMultiplier).toBe(1)
    expect(updated.config.impulseMagnitude).toBe(3)

    const reset = assembly.resetStatusMovementDebugConfig()
    expect(reset.config.rooted).toBe(false)
    expect(reset.config.speedMultiplier).toBe(0.5)
    expect(reset.config.impulseMagnitude).toBe(0)
  })

  it('syncs health channels through the world runtime', () => {
    assembly.syncHealthChannels()
    expect(config.worldRuntime.syncActiveHealthChannels).toHaveBeenCalled()
  })

  it('handles combat pointer and weapon input when enabled', () => {
    const combatSystem = (assembly as any).createCombatSystem()
    assembly.enableCombat()

    const pointerResult = combatSystem.handlePointerDown({ button: 0 } as MouseEvent)
    expect(config.weaponSystem.equip).toHaveBeenCalledWith('player_1', 'rifle')
    expect(config.weaponSystem.fire).toHaveBeenCalledWith('player_1')
    expect(pointerResult).toBe(true)

    const keyEvent = { code: 'KeyR' } as KeyboardEvent
    expect(combatSystem.handleKeyDown(keyEvent)).toBe(true)
    expect(config.weaponSystem.reload).toHaveBeenCalledWith('player_1')

    const digitEvent = { code: 'Digit3' } as KeyboardEvent
    expect(combatSystem.handleKeyDown(digitEvent)).toBe(true)
    expect(config.inventorySystem.equipSlot).toHaveBeenCalledWith('player_1', 2)

    const wheelEvent = { deltaY: 100 } as WheelEvent
    expect(combatSystem.handleWheel(wheelEvent)).toBe(true)
    expect(config.inventorySystem.quickSwap).toHaveBeenCalledWith('player_1', 1)
  })
})
