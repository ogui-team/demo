import { LifecycleOrchestrator } from '../../client/src/engine/debug/LifecycleOrchestrator'
import { Logger } from '../../client/src/engine/debug/Logger'
import { gameBus } from '../../client/src/engine/core/EventBus'

describe('LifecycleOrchestrator', () => {
  let config: any
  let orchestrator: LifecycleOrchestrator
  let warnSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    gameBus.clear()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    config = {
      getLocalPlayerId: () => 'player-1',
      getLocalPlayerEntity: () => null,
      hasFullNetworkSync: () => false,
      isStateHydrated: () => true,
    }

    orchestrator = new LifecycleOrchestrator(config)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    gameBus.clear()
  })

  it('starts in BOOT and transitions to NETWORK_SYNC', () => {
    expect(orchestrator.getPhase()).toBe('BOOT')
    expect(orchestrator.tryTransitionTo('NETWORK_SYNC')).toBe(true)
    expect(orchestrator.getPhase()).toBe('NETWORK_SYNC')
  })

  it('blocks SPAWN_READY when state hydration is incomplete', () => {
    config.isStateHydrated = () => false
    Logger.verbose = true
    orchestrator = new LifecycleOrchestrator(config)

    expect(orchestrator.tryTransitionTo('SPAWN_READY')).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('transitions to SPAWN_READY when FULL_SYNC_DATA arrives and sync is confirmed', () => {
    config.hasFullNetworkSync = () => true
    gameBus.emit('FULL_SYNC_DATA', { playerId: 'player-1' })

    expect(orchestrator.getPhase()).toBe('SPAWN_READY')
  })

  it('moves to PLAY_ACTIVE after snapshot verify and buffer hydration', () => {
    const entity = { id: 'entity-1' }
    config.getLocalPlayerEntity = () => entity
    config.hasFullNetworkSync = () => true
    config.isStateHydrated = () => true
    orchestrator = new LifecycleOrchestrator(config)

    const lifecycleChanged = vi.fn()
    gameBus.on('LIFECYCLE_CHANGED', lifecycleChanged)

    gameBus.emit('SYNC_VERIFIED', {
      playerId: 'player-1',
      tick: 123,
      networkEntityId: 'entity-1',
    })

    expect(orchestrator.getPhase()).toBe('BOOT')
    expect(lifecycleChanged).not.toHaveBeenCalled()

    gameBus.emit('FORCE_BUFFER_HYDRATION', {
      playerId: 'player-1',
      tick: 123,
      networkEntityId: 'entity-1',
    })

    expect(orchestrator.getPhase()).toBe('PLAY_ACTIVE')
    expect(lifecycleChanged).toHaveBeenCalled()
  })

  it('falls back to PLAY_ACTIVE when LOCAL_PLAYER_ACTUALIZED is received for the local player', () => {
    config.getLocalPlayerEntity = () => ({ id: 'entity-2' })
    config.hasFullNetworkSync = () => true
    config.isStateHydrated = () => true
    orchestrator = new LifecycleOrchestrator(config)

    gameBus.emit('LOCAL_PLAYER_ACTUALIZED', {
      playerId: 'player-1',
      entityId: 'entity-2',
      source: 'auth',
    })

    expect(orchestrator.getPhase()).toBe('PLAY_ACTIVE')
  })

  it('returns debug dump state and resets cleanly', () => {
    config.hasFullNetworkSync = () => true
    gameBus.emit('FULL_SYNC_DATA', { playerId: 'player-1' })

    const dump = orchestrator.debugDump()
    expect(dump.currentPhase).toBe('SPAWN_READY')
    expect(dump.playerId).toBe('player-1')
    expect(dump.checkpointCount).toBeGreaterThanOrEqual(1)

    orchestrator.reset()
    expect(orchestrator.getPhase()).toBe('BOOT')
    expect(orchestrator.getCheckpoints()).toHaveLength(0)
  })
})
