import {
  filterAllowedEntities,
  getSnapshotFilterDiagnostics,
  isEntityAllowedForSnapshot,
  isWorldObjectAllowedForSnapshot,
} from '../../server/src/session/SnapshotFilter'

describe('SnapshotFilter', () => {
  it('filters out grunt entities and allows player entities', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const grunt = { id: 'npc_1', type: 'Prefab_EnemyGrunt' }
    const player = { id: 'player_1', type: 'player' }

    expect(isEntityAllowedForSnapshot(grunt)).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    expect(isEntityAllowedForSnapshot(player)).toBe(true)

    warnSpy.mockRestore()
  })

  it('permits world objects only when entityType is allowed', () => {
    expect(isWorldObjectAllowedForSnapshot({ entityType: 'player' })).toBe(true)
    expect(isWorldObjectAllowedForSnapshot({ entityType: 'prefab_enemygrunt' })).toBe(false)
  })

  it('returns the filtered entity and world object collections', () => {
    const inputEntities = [
      { id: 'player_1', type: 'player' },
      { id: 'enemy_1', type: 'static_collider' },
      { id: 'grunt_1', type: 'prefab_enemygrunt' },
    ]
    const inputWorld = [
      { entityType: 'player' },
      { entityType: 'prefab_enemygrunt' },
    ]

    const result = filterAllowedEntities(inputEntities as any, inputWorld as any)

    expect(result.entities).toEqual([
      { id: 'player_1', type: 'player' },
      { id: 'enemy_1', type: 'static_collider' },
    ])
    expect(result.worldObjects).toEqual([{ entityType: 'player' }])
  })

  it('exposes diagnostics metadata for snapshot filtering rules', () => {
    const diagnostics = getSnapshotFilterDiagnostics()
    expect(diagnostics.allowedEntityTypes).toContain('player')
    expect(diagnostics.relevanceRadius).toBe(72)
  })
})
