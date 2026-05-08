import { calculatePositionHash, shouldIncludeDeterminismHash } from '../../server/src/snapshot/DeterminismHash'

describe('DeterminismHash', () => {
  it('produces a consistent hash regardless of ordering', () => {
    const positions = [
      { playerId: 'playerB', x: 1.5, y: 0, z: 0 },
      { playerId: 'playerA', x: 0, y: 0, z: 0 },
    ]

    const hashA = calculatePositionHash(positions)
    const hashB = calculatePositionHash([...positions].reverse())

    expect(hashA).toBe(hashB)
    expect(hashA).toMatch(/^[0-9A-F]{8}$/)
  })

  it('includes determinism hash only on tick multiples of 100', () => {
    expect(shouldIncludeDeterminismHash(100)).toBe(true)
    expect(shouldIncludeDeterminismHash(200)).toBe(true)
    expect(shouldIncludeDeterminismHash(101)).toBe(false)
    expect(shouldIncludeDeterminismHash(0)).toBe(true)
  })
})
