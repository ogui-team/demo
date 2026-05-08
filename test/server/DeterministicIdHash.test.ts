import {
  fnv1aHash,
  generateDeterministicPlayerId,
  generateDeterministicItemId,
  validateNoCollisions,
  analyzeHashDistribution,
} from '../../server/src/utils/DeterministicIdHash'

describe('DeterministicIdHash', () => {
  it('returns the same hash for identical input', () => {
    const value = 'player_123'
    expect(fnv1aHash(value)).toBe(fnv1aHash(value))
  })

  it('returns different hashes for different inputs', () => {
    const hashA = fnv1aHash('player_123')
    const hashB = fnv1aHash('player_124')
    expect(hashA).not.toBe(hashB)
  })

  it('generates stable player IDs with the expected format', () => {
    const idA = generateDeterministicPlayerId('session_1', 'conn_42')
    const idB = generateDeterministicPlayerId('session_1', 'conn_42')
    expect(idA).toBe(idB)
    expect(idA).toMatch(/^p_[0-9a-f]{8}$/)
  })

  it('generates stable item IDs with the expected format', () => {
    const idA = generateDeterministicItemId('p_12345678', 0, 'weapon_pistol')
    const idB = generateDeterministicItemId('p_12345678', 0, 'weapon_pistol')
    expect(idA).toBe(idB)
    expect(idA).toMatch(/^itm_[0-9a-f]{8}$/)
  })

  it('detects zero collisions for a set of unique inputs', () => {
    const inputs = Array.from({ length: 200 }, (_, index) => `unique_${index}`)
    const result = validateNoCollisions(inputs)
    expect(result.collisions).toBe(0)
    expect(result.duplicateHashes.size).toBe(0)
  })

  it('reports collision rate correctly for the analyzed sample', () => {
    const report = analyzeHashDistribution(1000)
    expect(report.uniqueCount).toBe(1000)
    expect(report.collisionRate).toBe(0)
  })
})

