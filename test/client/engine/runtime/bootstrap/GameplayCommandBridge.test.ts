import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers: Record<string, Function> = {}

vi.mock('@engine/core/public-api', () => ({
  gameBus: {
    on: vi.fn((event: string, callback: Function) => {
      handlers[event] = callback
    }),
    emit: vi.fn(),
  },
}))

import { gameBus } from '@engine/core/public-api'
import { GameplayCommandBridge } from '../../../../../client/src/engine/runtime/bootstrap/GameplayCommandBridge'

const emit = (gameBus as any).emit as ReturnType<typeof vi.fn>

describe('GameplayCommandBridge', () => {
  let kernel: any
  let bridge: GameplayCommandBridge

  beforeEach(() => {
    vi.clearAllMocks()
    kernel = {
      commands: {
        enqueue: vi.fn(() => true),
      },
      entities: {
        getDenseIndex: vi.fn(() => 1),
      },
      healths: {
        getHealth: vi.fn(() => 60),
      },
    }
    bridge = new GameplayCommandBridge(kernel, {})
  })

  it('queues a damage command and emits an ENTITY_TOOK_DAMAGE event', () => {
    expect(handlers['APPLY_DAMAGE_REQUESTED']).toBeDefined()

    handlers['APPLY_DAMAGE_REQUESTED']({ targetId: 77, damageAmount: 15 })

    expect(kernel.commands.enqueue).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      'system',
      'APPLY_DAMAGE',
      null,
      expect.objectContaining({
        targetHandle: 77,
        damageAmount: 15,
        damageType: 'physical',
      }),
    )
    expect(emit).toHaveBeenCalledWith('ENTITY_TOOK_DAMAGE', expect.objectContaining({
      entityHandle: 77,
      damageAmount: 15,
      oldHealth: 60,
      newHealth: 45,
    }))
  })

  it('ignores fire requests with missing target or damage', () => {
    expect(handlers['FIRE_REQUESTED']).toBeDefined()

    handlers['FIRE_REQUESTED']({ targetHandle: null, damageAmount: 10 })
    handlers['FIRE_REQUESTED']({ targetHandle: 77, damageAmount: 0 })

    expect(kernel.commands.enqueue).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })
})
