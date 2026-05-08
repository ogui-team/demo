import { Entity } from '../../client/src/engine/core/Entity'

const mocks = vi.hoisted(() => ({
  disableSystem: vi.fn(),
  listSystems: vi.fn(),
  logEvent: vi.fn(),
}))

vi.mock('../../client/src/engine/core/SystemRegistry', () => ({
  disableSystem: mocks.disableSystem,
  listSystems: mocks.listSystems,
}))
vi.mock('../../client/src/engine/core/EventLogger', () => ({
  logEvent: mocks.logEvent,
}))

import { SystemWatchdog } from '../../client/src/engine/core/SystemWatchdog'

describe('SystemWatchdog', () => {
  beforeEach(() => {
    mocks.disableSystem.mockClear()
    mocks.listSystems.mockClear()
    mocks.logEvent.mockClear()
  })

  it('warns and disables a stale active system', () => {
    mocks.listSystems.mockReturnValue([
      {
        name: 'slow-system',
        status: 'active',
        lastUpdateAt: Date.now() - 6000,
        system: {
          update: () => {},
          isEnabled: () => true,
        },
      },
    ])

    const watchdog = new SystemWatchdog({ getEntities: () => [] } as any)
    watchdog.update(1.5)

    expect(mocks.disableSystem).toHaveBeenCalledWith('slow-system', 'watchdog timeout')
    expect(mocks.logEvent).toHaveBeenCalledWith('engine', expect.stringContaining('[watchdog]'))
  })

  it('clamps invalid transform values on entities and emits warnings', () => {
    const badEntity = new Entity('broken', 'test')
    badEntity.setTransform({ position: { x: NaN, y: Infinity, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } })
    badEntity.active = true

    mocks.listSystems.mockReturnValue([])
    const watchdog = new SystemWatchdog({ getEntities: () => [badEntity] } as any)
    watchdog.update(1.5)

    expect(badEntity.getTransform().position.x).toBe(0)
    expect(mocks.logEvent).toHaveBeenCalledWith('engine', expect.stringContaining('[watchdog]'))
  })
})
