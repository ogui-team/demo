import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@engine/core/public-api', () => {
  const createEntity = vi.fn(() => 123)
  const entities = {
    createEntity,
    setNetworkId: vi.fn(),
    getHandleByNetworkId: vi.fn((networkId: string | number) => (networkId === 42 ? 123 : null)),
  }

  return {
    initTransactionalKernel: vi.fn(() => ({
      kernel: {
        createEntity: vi.fn(() => 123),
        entities,
        positions: {},
        velocities: {},
        inventories: {},
        healths: {},
        abilities: {},
        addSystem: vi.fn(),
      },
      transactional: {},
    })),
    MovementIntegrateSystem: class {
      constructor(_: any) {}
    },
    InventorySystem: class {
      constructor(_: any) {}
    },
    EntityMigrationSystem: class {
      constructor(_: any) {}
    },
    ComponentMapper: class {
      constructor(_: any) {}
    },
    SnapshotReader: class {
      constructor(_: any) {}
    },
    SnapshotWriter: class {
      constructor() {}
    },
    GameplayCommandBridge: class {
      constructor(_: any, __: any) {}
    },
    DamageNumberUISystem: class {
      constructor(_: any) {}
    },
    DummyEnemySystem: class {
      constructor(_: any) {}
    },
    gameBus: {
      on: vi.fn(),
      emit: vi.fn(),
    },
  }
})

vi.mock('../../../../client/src/engine/render/MeshBindingTable', () => ({
  MeshBindingTable: class {
    constructor() {}
    rebind = vi.fn(() => true)
    updateHandle = vi.fn()
  },
}))

vi.mock('../../../../client/src/engine/diagnostics/BaselineCapture', () => ({
  exposeBaselineCapture: vi.fn(),
}))

import { KernelMovementIntegration } from '../../../../client/src/engine/runtime/bootstrap/KernelMovementIntegration'
import { gameBus } from '@engine/core/public-api'

describe('KernelMovementIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = '<canvas id="canvas"></canvas>'
  })

  it('ensures and reserves player handles correctly', () => {
    const integration = new KernelMovementIntegration()

    const handle1 = integration.ensurePlayerHandle('player1', 1, 2, 3)
    expect(handle1).toBe(123)

    const handle2 = integration.ensurePlayerHandle('player1', 4, 5, 6)
    expect(handle2).toBe(123)

    expect(integration.reservePlayerHandle('player1')).toBe(true)
    expect(integration.reservePlayerHandle('player2')).toBe(true)
  })

  it('registers network entity ids and reports mapped handle state', () => {
    const integration = new KernelMovementIntegration()
    const registrar = integration.getNetworkEntityIdRegistrar()

    const reserved = registrar.reserveHandleForPlayer('player3')
    expect(reserved).toBe(true)

    const mapped = registrar.registerNetworkEntityIdMapping('player3', 42)
    expect(mapped).toBe(true)
    expect(integration.hasHandleForNetworkEntityId(42)).toBe(true)

    expect(gameBus.emit).toHaveBeenCalledWith('NETWORK_ENTITY_HANDLE_MAPPED', expect.objectContaining({
      playerId: 'player3',
      networkEntityId: 42,
    }))
  })

  it('returns false when no handle exists for the given player', () => {
    const integration = new KernelMovementIntegration()

    expect(integration.registerNetworkEntityIdMapping('missing', 99)).toBe(false)
  })
})
