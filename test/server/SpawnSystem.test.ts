import { SpawnSystem } from '../../server/src/session/SpawnSystem'

describe('SpawnSystem', () => {
  it('spawns a player with default prefab values', () => {
    const spawnSystem = new SpawnSystem()
    const player = { id: 'player-1' } as any
    const result = spawnSystem.spawnPlayer(player, 'player_v1', { x: 1, y: 2, z: 3 })

    expect(result.player.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(result.player.rotation).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.entity.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(result.entity.type).toBe('player')
    expect(result.entity.equipment).toContain('pistol')
  })

  it('throws when an unknown prefab is used', () => {
    const spawnSystem = new SpawnSystem()

    expect(() => spawnSystem.spawnPlayer({ id: 'player-2' } as any, 'unknown_prefab', { x: 0, y: 0, z: 0 })).toThrow(
      'Unknown player prefab: unknown_prefab',
    )
  })
})
