import { createPlayerState, resetPlayerRuntimeState, getPlayerSpawnPoint } from '../../server/src/session/playerSessionRuntime'
import { cloneTropicalHorrorArchetypeAppearance } from '@shared/contracts'

describe('playerSessionRuntime', () => {
  it('creates a player state with defaults and clones appearance', () => {
    const appearance = { color: 'red' }
    const player = createPlayerState({
      id: 'player-1',
      name: 'Hero',
      appearance,
      spawn: { x: 1, y: 2, z: 3 },
      now: 1000,
    })

    expect(player.id).toBe('player-1')
    expect(player.name).toBe('Hero')
    expect(player.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(player.health).toBe(player.maxHealth)
    expect(player.health).toBeGreaterThan(0)
    expect(player.dead).toBe(false)
    expect(player.currentInput.forward).toBe(false)
    expect(player.appearance).toEqual({ color: 'red' })
    appearance.color = 'blue'
    expect(player.appearance).toEqual({ color: 'red' })
  })

  it('resets runtime state for a player and clears active statuses', () => {
    const player = createPlayerState({
      id: 'player-2',
      name: 'ResetTest',
      spawn: { x: 5, y: 0, z: 5 },
      now: 2000,
    })
    player.velocity = { x: 10, y: 10, z: 10 }
    player.dead = true
    player.health = 20
    player.activeMovementStatuses = [{ type: 'slow' } as any]
    player.statusMovementModifier = { speedMultiplier: 0.5 } as any
    player.pendingMovementIntent = { jump: true, crouch: false } as any
    player.lastMoveCommandAt = 9999

    resetPlayerRuntimeState(player, { x: 2, y: 1, z: 2 })

    expect(player.position).toEqual({ x: 2, y: 1, z: 2 })
    expect(player.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(player.dead).toBe(false)
    expect(player.health).toBe(player.maxHealth)
    expect(player.health).toBeGreaterThan(0)
    expect(player.activeMovementStatuses).toEqual([])
    expect(player.statusMovementModifier).toBeNull()
    expect(player.pendingMovementIntent).toBeNull()
    expect(player.lastMoveCommandAt).toBe(0)
  })

  it('returns the first valid spawn point from spawnPoints', () => {
    const spawnPoints = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }]
    const chosen = getPlayerSpawnPoint({
      startIndex: 0,
      spawnPoints,
      selectedMap: 'default_map',
      players: new Map(),
      excludePlayerId: undefined,
      isPositionValid: () => true,
      playerCollisionRadius: 0.5,
    })

    expect(chosen).toEqual(spawnPoints[0])
  })

  it('skips a spawn point that is too close to an existing player', () => {
    const spawnPoints = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }]
    const players = new Map([
      ['player-a', { id: 'player-a', position: { x: 0.5, y: 0, z: 0 }, dead: false } as any],
    ])

    const chosen = getPlayerSpawnPoint({
      startIndex: 0,
      spawnPoints,
      selectedMap: 'default_map',
      players,
      excludePlayerId: undefined,
      isPositionValid: () => true,
      playerCollisionRadius: 0.5,
    })

    expect(chosen).toEqual(spawnPoints[1])
  })

  it('falls back to a nearby valid spawn when all primary spawn points are invalid', () => {
    const spawnPoints = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }]

    const chosen = getPlayerSpawnPoint({
      startIndex: 0,
      spawnPoints,
      selectedMap: 'default_map',
      players: new Map(),
      excludePlayerId: undefined,
      isPositionValid: (position) => position.x === 2 && position.y === 0 && position.z === 0,
      playerCollisionRadius: 0.5,
    })

    expect(chosen).toEqual({ x: 2, y: 0, z: 0 })
  })

  it('ignores excluded players when choosing a valid spawn point', () => {
    const spawnPoints = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }]
    const players = new Map([
      ['player-a', { id: 'player-a', position: { x: 0.5, y: 0, z: 0 }, dead: false } as any],
    ])

    const chosen = getPlayerSpawnPoint({
      startIndex: 0,
      spawnPoints,
      selectedMap: 'default_map',
      players,
      excludePlayerId: 'player-a',
      isPositionValid: () => true,
      playerCollisionRadius: 0.5,
    })

    expect(chosen).toEqual(spawnPoints[0])
  })

  it('uses archetype appearance fallback when no appearance payload is provided', () => {
    const player = createPlayerState({
      id: 'player-archetype',
      name: 'ArchetypeOnly',
      archetypeId: 'obsidian-ravager',
      spawn: { x: 0, y: 0, z: 0 },
      now: 3000,
      appearance: null,
    })

    expect(player.appearance).toEqual(cloneTropicalHorrorArchetypeAppearance('obsidian-ravager'))
  })
})
