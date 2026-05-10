import { DeterminismValidator, calculateClientPositionHash } from '../../client/src/3-network/network/DeterminismValidator'

describe('DeterminismValidator', () => {
  it('calculates deterministic position hashes consistently', () => {
    const snapshot = {
      entities: [
        { entityId: 'a', transform: { position: { x: 1, y: 2, z: 3 } } as any },
        { entityId: 'b', transform: { position: { x: 4, y: 5, z: 6 } } as any },
      ],
    }
    const hash1 = calculateClientPositionHash(snapshot.entities as any)
    const hash2 = calculateClientPositionHash([...snapshot.entities] as any)
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[0-9A-F]{8}$/)
  })

  it('force-resets position storage when snapshot hash mismatches', () => {
    const positionStorage = {
      maxCapacity: 10,
      getAuthoritativeReadBuffer: vi.fn(() => new Float32Array(30).fill(0)),
      copyAuthoritativeReadToWrite: vi.fn(),
      getWriteBuffer: vi.fn(() => new Float32Array(30).fill(0)),
    }
    const entityRegistry = { activeCount: 1 }
    const validator = new DeterminismValidator(positionStorage as any, entityRegistry as any)

    const snapshot = {
      positionHash: 'DEADBEEF',
      entities: [{ entityId: 'a', transform: { position: { x: 1, y: 2, z: 3 } } as any }],
      tick: 1,
    }

    const result = validator.validateSnapshot(snapshot as any)
    expect(result.isValid).toBe(false)
    expect(positionStorage.copyAuthoritativeReadToWrite).toHaveBeenCalledWith(1)
    expect(positionStorage.getWriteBuffer).toHaveBeenCalled()
  })
})
