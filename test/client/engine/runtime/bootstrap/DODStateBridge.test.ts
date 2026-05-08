import { beforeEach, describe, expect, it, vi } from 'vitest'

const onHandlers: Record<string, Function> = {}

vi.mock('@engine/core/public-api', () => ({
  gameBus: {
    on: vi.fn((event: string, callback: Function) => {
      onHandlers[event] = callback
    }),
    emit: vi.fn(),
  },
}))

import { gameBus } from '@engine/core/public-api'
import { DODStateBridge } from '../../../../../client/src/engine/runtime/bootstrap/DODStateBridge'
import { SCHEMA_PATHS } from '../../../../../client/src/engine/foundation/state/hydrateStateManager'

const emit = (gameBus as any).emit as ReturnType<typeof vi.fn>

describe('DODStateBridge', () => {
  let stateManager: any
  let kernel: any
  let bridge: DODStateBridge

  beforeEach(() => {
    vi.clearAllMocks()
    stateManager = {
      values: new Map<string, unknown>(),
      set: vi.fn(function (this: any, key: string, value: unknown) {
        this.values.set(key, value)
      }),
    }

    kernel = {
      entities: {
        getDenseIndex: vi.fn(() => 0),
      },
      healths: {
        getHealth: vi.fn(() => 75),
        getMaxHealth: vi.fn(() => 100),
      },
      inventories: {
        getAmmo: vi.fn(() => 20),
        getItemId: vi.fn(() => 3),
      },
    }

    bridge = new DODStateBridge({
      kernelBridge: {
        getKernel: () => kernel,
        getPlayerHandle: vi.fn(() => 7),
      },
      stateManager,
      getPlayerId: () => 'player1',
      getActivePhase: () => 'PLAY_ACTIVE',
    })
  })

  it('syncs kernel state into the state manager on update after threshold', () => {
    bridge.update(0.06)

    expect(stateManager.set).toHaveBeenCalledWith(SCHEMA_PATHS.healthHp('player1'), 75)
    expect(stateManager.set).toHaveBeenCalledWith(SCHEMA_PATHS.healthMaxHp('player1'), 100)
    expect(stateManager.set).toHaveBeenCalledWith(SCHEMA_PATHS.PLAYERS_LOCAL_HEALTH, 75)
    expect(stateManager.set).toHaveBeenCalledWith(SCHEMA_PATHS.DIAGNOSTICS_AMMO_CURRENT, 20)
    expect(stateManager.set).toHaveBeenCalledWith(SCHEMA_PATHS.playerInventoryKernel('player1'), expect.objectContaining({
      handle: 7,
      ammo: 20,
      itemId: 3,
    }))
  })

  it('does not sync if the phase is not PLAY_ACTIVE or SPAWN_READY', () => {
    bridge = new DODStateBridge({
      kernelBridge: {
        getKernel: () => kernel,
        getPlayerHandle: vi.fn(() => 7),
      },
      stateManager,
      getPlayerId: () => 'player1',
      getActivePhase: () => 'INIT',
    })

    bridge.update(0.06)
    expect(stateManager.set).not.toHaveBeenCalled()
  })

  it('responds to SYNC_VERIFIED by emitting FORCE_BUFFER_HYDRATION', () => {
    expect(onHandlers['SYNC_VERIFIED']).toBeDefined()
    onHandlers['SYNC_VERIFIED']({ playerId: 'player1', tick: 10, networkEntityId: 42 })

    expect(stateManager.set).toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith('FORCE_BUFFER_HYDRATION', expect.objectContaining({
      playerId: 'player1',
      tick: 10,
      networkEntityId: 42,
      reason: expect.any(String),
    }))
  })
})
