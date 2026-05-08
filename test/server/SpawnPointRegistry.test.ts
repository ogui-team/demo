import { SpawnPointRegistry } from '../../server/src/session/SpawnPointRegistry'

describe('SpawnPointRegistry', () => {
  it('assigns deterministic spawn indices for the same player', () => {
    const registry = new SpawnPointRegistry()
    const first = registry.registerPlayerSpawn('player-a')
    const second = registry.registerPlayerSpawn('player-a')
    expect(first).toBe(second)
  })

  it('assigns unique indices to different players', () => {
    const registry = new SpawnPointRegistry()
    const a = registry.registerPlayerSpawn('player-a')
    const b = registry.registerPlayerSpawn('player-b')
    expect(a).not.toBe(b)
    expect(a).toBe(0)
    expect(b).toBe(1)
  })

  it('unregisters a player and allows reuse only after new registration', () => {
    const registry = new SpawnPointRegistry()
    registry.registerPlayerSpawn('player-a')
    registry.unregisterPlayerSpawn('player-a')
    const reused = registry.registerPlayerSpawn('player-a')
    expect(reused).toBe(1)
  })

  it('calculates deterministic offsets based on spawn index', () => {
    const registry = new SpawnPointRegistry()
    const basePoint = { x: 0, y: 0, z: 0 }
    const offset0 = registry.calculateDeterministicOffset(0, basePoint)
    const offset4 = registry.calculateDeterministicOffset(4, basePoint)
    expect(offset0).toEqual({ x: 0, y: 0, z: 0 })
    expect(offset4).not.toEqual(offset0)
  })
})

