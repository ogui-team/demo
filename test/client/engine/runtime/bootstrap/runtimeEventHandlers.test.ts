import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gameBus } from '../../../../../client/src/engine/core/EventBus'

vi.mock('../../../../../client/src/engine/foundation/Engine', () => ({
  getEntityManager: vi.fn(() => ({ markPlayerPhaseReady: vi.fn() })),
}))

import { bootstrapRuntimeEventHandlers } from '../../../../../client/src/engine/runtime/bootstrap/runtimeEventHandlers'

describe('bootstrapRuntimeEventHandlers', () => {
  let worldRuntime: any
  let weaponSystem: any
  let stateManager: any
  let networkSyncSystem: any
  let mpClient: any
  let gameModeManager: any
  let replaySystem: any
  let runtimeOverlayCoordinator: any
  let gasBridge: any
  let debugManager: any

  beforeEach(() => {
    vi.clearAllMocks()
    gameBus.clear()

    worldRuntime = {
      getActiveRuntimePlayerId: vi.fn(() => 'player-1'),
      getLocalFreeplayPlayerId: vi.fn(() => 'player-1'),
      syncHealthChannelsFromGAS: vi.fn(),
    }
    weaponSystem = { equip: vi.fn() }
    stateManager = { set: vi.fn(), get: vi.fn() }
    networkSyncSystem = { setPlayerInitReady: vi.fn() }
    const eventHandlers: Record<string, Function> = {}
    mpClient = {
      connected: true,
      sendLobbyAction: vi.fn(),
      on: vi.fn((event, callback) => {
        eventHandlers[event] = callback
      }),
      trigger: (event: string, payload: any) => eventHandlers[event]?.(payload),
    }
    gameModeManager = {
      on: vi.fn((event, callback) => {
        eventHandlers[event] = callback
      }),
      destroy: vi.fn(),
    }
    replaySystem = { recordEvent: vi.fn() }
    runtimeOverlayCoordinator = { destroy: vi.fn() }
    gasBridge = { onPickup: vi.fn() }
    debugManager = { refreshUI: vi.fn() }

    bootstrapRuntimeEventHandlers({
      worldRuntime,
      weaponSystem,
      stateManager,
      networkSyncSystem,
      mpClient,
      gameModeManager,
      replaySystem,
      debugManager,
      runtimeOverlayCoordinator,
      gasBridge,
    })

    ;(mpClient as any).eventHandlers = eventHandlers
  })

  it('processes itemPicked and forwards GAS pickup events', () => {
    gameBus.emit('itemPicked', { itemId: 'ammo_9mm', quantity: 2 })

    expect(gasBridge.onPickup).toHaveBeenCalledWith('player-1', 'ammo_9mm', 2)
    expect(worldRuntime.syncHealthChannelsFromGAS).toHaveBeenCalledWith('player-1')
  })

  it('handles INVENTORY_READY and equips the correct weapon', () => {
    gameBus.emit('INVENTORY_READY', {
      playerId: 'player-1',
      equippedWeapon: 'item-1',
      equippedArmor: null,
      items: [
        { instanceId: 'item-1', itemId: 'weapon_pistol' },
      ],
    })

    expect(weaponSystem.equip).toHaveBeenCalledWith('player-1', 'pistol')
    expect(stateManager.set).toHaveBeenCalledWith('player.player-1.inventory', expect.any(Object))
  })

  it('marks player init ready when the local player completes init', () => {
    gameBus.emit('PLAYER_INIT_COMPLETE', { playerId: 'player-1' })
    expect(networkSyncSystem.setPlayerInitReady).toHaveBeenCalledWith(true)
  })

  it('sends lobby action when game mode starts and client is connected', () => {
    gameBus.emit('gameModeStarted', { modeName: 'freeplay' })
    expect(mpClient.sendLobbyAction).toHaveBeenCalledWith('GAME_MODE_SET', { mode: 'freeplay' })
  })

  it('records authoritative snapshot events to replay system', () => {
    const snapshotHandler = (mpClient.on as any).mock.calls.find(([event]) => event === 'authoritative_snapshot')[1]
    snapshotHandler({ entities: [{ id: 'player-1' }] })

    expect(replaySystem.recordEvent).toHaveBeenCalledWith('authoritative_snapshot', expect.objectContaining({ entityCount: 1 }))
  })

  it('refreshes debug UI on round start and score update', () => {
    const roundStartHandler = (gameModeManager.on as any).mock.calls.find(([event]) => event === 'round_start')[1]
    const scoreUpdateHandler = (gameModeManager.on as any).mock.calls.find(([event]) => event === 'score_update')[1]

    roundStartHandler()
    scoreUpdateHandler()

    expect(debugManager.refreshUI).toHaveBeenCalledTimes(2)
  })

  it('destroys runtime overlays and game mode manager on beforeunload', () => {
    window.dispatchEvent(new Event('beforeunload'))

    expect(gameModeManager.destroy).toHaveBeenCalled()
    expect(runtimeOverlayCoordinator.destroy).toHaveBeenCalled()
  })

  it('registers multiplayer snapshot event handlers', () => {
    expect(mpClient.on).toHaveBeenCalledWith('authoritative_snapshot', expect.any(Function))
  })
})
