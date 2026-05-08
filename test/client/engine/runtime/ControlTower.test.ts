import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@engine/core/public-api', () => ({
  gameBus: {
    on: vi.fn(() => () => undefined),
  },
  listSystems: vi.fn(() => [
    { name: 'sys1', status: 'active', lastError: null },
    { name: 'sys2', status: 'error', lastError: 'failure' },
  ]),
}))

import { ControlTower } from '../../../../client/src/engine/runtime/ControlTower'
import { gameBus, listSystems } from '@engine/core/public-api'

describe('ControlTower', () => {
  let tower: ControlTower

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    tower = new ControlTower()
  })

  it('initializes and exposes capabilities without context', () => {
    const capabilities = tower.getCapabilities()
    expect(capabilities.usesSystemContext).toBe(false)

    const state = tower.getDebugState()
    expect(state.status).toBe('ok')
    expect(state.metrics.players).toBe(0)
    expect(state.metrics.systems).toBe('active')
  })

  it('installs event listeners and updates snapshot state after init', () => {
    const unsub = vi.fn()
    vi.mocked(gameBus.on).mockImplementation(() => unsub)
    const now = 1000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const ctx = {
      entityManager: {
        getDiagnostics: vi.fn(() => ({ metrics: { count: 2, totalTrackedEntities: 3 } })),
      },
      network: {
        getClient: vi.fn(() => ({ getDebugStats: vi.fn(() => ({ packetsInPerSec: 5, packetsOutPerSec: 7 })) })),
        getSnapshot: vi.fn(() => ({ ackInputSeq: 10, timestamp: now, entities: [{ entityId: 'e1', transform: { position: { x: 1, y: 2, z: 3 } } }] })),
      },
      resolveSystem: vi.fn(() => null),
      systems: {},
    }

    tower.init(ctx as any)
    expect(gameBus.on).toHaveBeenCalledTimes(4)

    tower.update()
    const snapshot = tower.getSnapshot()
    expect(snapshot.generatedAt).toBe(now)
    expect(snapshot.entities.active).toBe(2)
    expect(snapshot.entities.worldObjects).toBe(0)
    expect(snapshot.replication.packetIn).toBe(5)
    expect(snapshot.replication.packetOut).toBe(7)

    tower.dispose()
    expect(unsub).toHaveBeenCalledTimes(4)
  })

  it('keeps snapshot unchanged when update is called too frequently', () => {
    const now = 2000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const ctx = {
      entityManager: { getDiagnostics: vi.fn(() => ({ metrics: { count: 1, totalTrackedEntities: 1 } })) },
      network: { getClient: vi.fn(() => ({ getDebugStats: vi.fn(() => ({ packetsInPerSec: 0, packetsOutPerSec: 0 })) })), getSnapshot: vi.fn(() => ({ ackInputSeq: 0, timestamp: now, entities: [] })) },
      resolveSystem: vi.fn(() => null),
      systems: {},
    }

    tower.init(ctx as any)
    tower.update()
    const firstSnapshot = tower.getSnapshot()

    vi.spyOn(Date, 'now').mockReturnValue(now + 100)
    tower.update()
    const secondSnapshot = tower.getSnapshot()

    expect(secondSnapshot.generatedAt).toBe(firstSnapshot.generatedAt)
  })
})
