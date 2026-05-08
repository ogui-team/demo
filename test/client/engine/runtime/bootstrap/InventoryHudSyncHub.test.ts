import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@engine/core/public-api', () => ({
  gameBus: {
    emit: vi.fn(),
  },
}))

import { gameBus } from '@engine/core/public-api'
import { InventoryHudSyncHub } from '../../../../../client/src/engine/runtime/bootstrap/InventoryHudSyncHub'

const emit = (gameBus as any).emit as ReturnType<typeof vi.fn>

describe('InventoryHudSyncHub', () => {
  let hub: InventoryHudSyncHub
  let kernel: any

  beforeEach(() => {
    vi.clearAllMocks()
    kernel = {
      readHUDSnapshot: vi.fn(() => ({ ammo: 12 })),
    }
    hub = new InventoryHudSyncHub({
      kernel,
      getPlayerId: () => 'player1',
      getActivePhase: () => 'PLAY_ACTIVE',
    })
  })

  it('emits HUD_AMMO_SYNC when enough time passes in PLAY_ACTIVE', () => {
    hub.update(0.05)
    expect(emit).not.toHaveBeenCalled()

    hub.update(0.05)
    expect(emit).toHaveBeenCalledWith('HUD_AMMO_SYNC', expect.objectContaining({
      playerId: 'player1',
      current: 12,
      max: 12,
      isReloading: false,
    }))
  })

  it('does not emit when phase is not PLAY_ACTIVE', () => {
    hub = new InventoryHudSyncHub({
      kernel,
      getPlayerId: () => 'player1',
      getActivePhase: () => 'SPAWN_READY',
    })

    hub.update(0.1)
    expect(emit).not.toHaveBeenCalled()
  })
})
