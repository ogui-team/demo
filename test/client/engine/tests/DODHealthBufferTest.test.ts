import { runDOD_HealthBufferTest } from '../../../../client/src/engine/tests/DOD_HealthBufferTest'

describe('DOD Health Buffer Test helper', () => {
  it('executes without a transactional system', () => {
    const kernel = {
      createEntity: vi.fn(() => 1),
      entities: { getDenseIndex: vi.fn(() => 0) },
      healths: {
        setMaxHealth: vi.fn(),
        setHealth: vi.fn(),
        getHealth: vi.fn(() => 100),
        getMaxHealth: vi.fn(() => 100),
      },
      positions: {
        getReadBuffer: vi.fn(() => new Float32Array([0, 0, 0])),
        setWriteXYZ: vi.fn(),
        publish: vi.fn(),
      },
      commands: {
        enqueue: vi.fn(() => true),
        length: 1,
      },
    } as any

    expect(() => runDOD_HealthBufferTest(kernel)).not.toThrow()
    expect(kernel.createEntity).toHaveBeenCalled()
    expect(kernel.entities.getDenseIndex).toHaveBeenCalledWith(1)
  })

  it('executes with a transactional system and logs the result', () => {
    const kernel = {
      createEntity: vi.fn(() => 1),
      entities: { getDenseIndex: vi.fn(() => 0) },
      healths: {
        setMaxHealth: vi.fn(),
        setHealth: vi.fn(),
        getHealth: vi.fn(() => 100),
        getMaxHealth: vi.fn(() => 100),
      },
      positions: {
        getReadBuffer: vi.fn(() => new Float32Array([0, 0, 0])),
        setWriteXYZ: vi.fn(),
        publish: vi.fn(),
      },
      commands: {
        enqueue: vi.fn(() => true),
        length: 1,
      },
    } as any

    const transactional = {
      executeTransactionalTick: vi.fn(() => ({ stateHash: 0x1234 })),
    }

    expect(() => runDOD_HealthBufferTest(kernel, transactional)).not.toThrow()
    expect(transactional.executeTransactionalTick).toHaveBeenCalled()
  })
})
