import { applyPlayerDamage, processRespawns, respawnPlayer, scheduleRespawn } from '../../server/src/session/playerLifecycleRuntime'

describe('playerLifecycleRuntime', () => {
  const createPlayer = (id: string) => ({
    id,
    dead: false,
    health: 100,
    armor: 0,
    velocity: { x: 0, y: 0, z: 0 },
    deaths: 0,
    kills: 0,
    exp: 0,
    level: 1,
    lastUpdate: 0,
    respawnAt: null,
    equipment: ['pistol'],
  } as any)

  it('does nothing when the target player is missing', () => {
    const players = new Map<string, any>()

    applyPlayerDamage({
      players,
      targetId: 'missing',
      amount: 10,
      sourceId: 'attacker',
      killLimit: 5,
      now: 1000,
      getRespawnDelayMs: () => 500,
      syncPlayerEntity: vi.fn(),
      broadcastAll: vi.fn(),
      broadcastScoreUpdate: vi.fn(),
      scheduleRespawn: vi.fn(),
      onKillLimitReached: vi.fn(),
      sendDamageTaken: vi.fn(),
    })

    expect(players.size).toBe(0)
  })

  it('applies damage and sends damage taken when the player survives', () => {
    const target = createPlayer('target')
    target.health = 50
    target.armor = 10
    const players = new Map([['target', target]])
    const sendDamageTaken = vi.fn()
    const syncPlayerEntity = vi.fn()

    applyPlayerDamage({
      players,
      targetId: 'target',
      amount: 20,
      sourceId: 'attacker',
      killLimit: 5,
      now: 1000,
      getRespawnDelayMs: () => 500,
      syncPlayerEntity,
      broadcastAll: vi.fn(),
      broadcastScoreUpdate: vi.fn(),
      scheduleRespawn: vi.fn(),
      onKillLimitReached: vi.fn(),
      sendDamageTaken,
    })

    expect(target.health).toBe(40)
    expect(target.armor).toBe(0)
    expect(target.dead).toBe(false)
    expect(syncPlayerEntity).toHaveBeenCalledWith('target')
    expect(sendDamageTaken).toHaveBeenCalledWith(target, expect.objectContaining({ amount: 10, sourceId: 'attacker', health: 40, armor: 0 }))
  })

  it('marks the player dead and broadcasts death when damage is lethal without a killer', () => {
    const target = createPlayer('target')
    target.health = 10
    const players = new Map([['target', target]])
    const syncPlayerEntity = vi.fn()
    const broadcastAll = vi.fn()
    const broadcastScoreUpdate = vi.fn()
    const scheduleRespawn = vi.fn()

    applyPlayerDamage({
      players,
      targetId: 'target',
      amount: 20,
      sourceId: 'target',
      killLimit: 5,
      now: 1000,
      getRespawnDelayMs: () => 500,
      syncPlayerEntity,
      broadcastAll,
      broadcastScoreUpdate,
      scheduleRespawn,
      onKillLimitReached: vi.fn(),
      sendDamageTaken: vi.fn(),
    })

    expect(target.dead).toBe(true)
    expect(target.respawnAt).toBe(1500)
    expect(syncPlayerEntity).toHaveBeenCalledWith('target')
    expect(broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYER_DIED', playerId: 'target', killedBy: 'target' }))
    expect(broadcastScoreUpdate).toHaveBeenCalled()
    expect(scheduleRespawn).toHaveBeenCalledWith('target')
  })

  it('increments killer stats and triggers kill limit when reached', () => {
    const target = createPlayer('target')
    target.health = 0
    target.dead = true
    const killer = createPlayer('killer')
    killer.id = 'killer'
    killer.kills = 0
    killer.exp = 0
    const players = new Map([['target', target], ['killer', killer]])
    const syncPlayerEntity = vi.fn()
    const broadcastAll = vi.fn()
    const broadcastScoreUpdate = vi.fn()
    const onKillLimitReached = vi.fn()

    target.dead = false
    target.health = 0

    applyPlayerDamage({
      players,
      targetId: 'target',
      amount: 5,
      sourceId: 'killer',
      killLimit: 1,
      now: 1000,
      getRespawnDelayMs: () => 100,
      syncPlayerEntity,
      broadcastAll,
      broadcastScoreUpdate,
      scheduleRespawn: vi.fn(),
      onKillLimitReached,
      sendDamageTaken: vi.fn(),
    })

    expect(killer.kills).toBe(1)
    expect(killer.exp).toBe(100)
    expect(killer.level).toBe(1)
    expect(onKillLimitReached).toHaveBeenCalled()
    expect(broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYER_KILLED', killerId: 'killer', targetId: 'target' }))
  })

  it('does not schedule respawn when killer reaches the kill limit', () => {
    const target = createPlayer('target')
    target.health = 0
    target.dead = false
    const killer = createPlayer('killer')
    const players = new Map([['target', target], ['killer', killer]])
    const scheduleRespawn = vi.fn()
    const onKillLimitReached = vi.fn()

    applyPlayerDamage({
      players,
      targetId: 'target',
      amount: 10,
      sourceId: 'killer',
      killLimit: 1,
      now: 1000,
      getRespawnDelayMs: () => 100,
      syncPlayerEntity: vi.fn(),
      broadcastAll: vi.fn(),
      broadcastScoreUpdate: vi.fn(),
      scheduleRespawn,
      onKillLimitReached,
      sendDamageTaken: vi.fn(),
    })

    expect(killer.kills).toBe(1)
    expect(onKillLimitReached).toHaveBeenCalled()
    expect(scheduleRespawn).not.toHaveBeenCalled()
  })

  it('respawns a dead player and resets weapon state', () => {
    const player = createPlayer('target')
    player.dead = true
    player.health = 0
    player.respawnAt = 1000
    player.equipment = ['pistol']
    const weaponStates = new Map<string, any>()
    const syncPlayerEntity = vi.fn()
    const broadcastAll = vi.fn()
    const broadcastScoreUpdate = vi.fn()
    const resolvedSpawn = { x: 5, y: 1, z: 5 }

    respawnPlayer({
      playerId: 'target',
      players: new Map([['target', player]]),
      weaponStates,
      resolveSpawnPoint: () => resolvedSpawn,
      syncPlayerEntity,
      broadcastAll,
      broadcastScoreUpdate,
    })

    expect(player.dead).toBe(false)
    expect(player.position).toEqual(resolvedSpawn)
    expect(player.health).toBe(100)
    expect(player.respawnAt).toBeNull()
    expect(weaponStates.get('target')).toMatchObject({
      equippedWeaponId: 'pistol',
      isReloading: false,
      reloadEndsAt: 0,
      lastShotAt: 0,
    })
    expect(syncPlayerEntity).toHaveBeenCalledWith('target')
    expect(broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYER_RESPAWN', playerId: 'target' }))
    expect(broadcastScoreUpdate).toHaveBeenCalled()
  })

  it('processes respawns only when the round is active and respawn time is due', () => {
    const player = createPlayer('target')
    player.dead = true
    player.respawnAt = 1000
    const respawnPlayer = vi.fn()

    processRespawns({
      players: [player],
      now: 1000,
      isRoundActive: () => true,
      respawnPlayer,
    })

    expect(respawnPlayer).toHaveBeenCalledWith('target')
  })

  it('does not respawn when the round is not active', () => {
    const player = createPlayer('target')
    player.dead = true
    player.respawnAt = 1000
    const respawnPlayer = vi.fn()

    processRespawns({
      players: [player],
      now: 1000,
      isRoundActive: () => false,
      respawnPlayer,
    })

    expect(respawnPlayer).not.toHaveBeenCalled()
  })

  it('respawns a dead player and resets runtime state', () => {
    const player = createPlayer('target')
    player.dead = true
    player.health = 0
    player.respawnAt = 1000
    player.equipment = ['pistol']
    const weaponStates = new Map<string, any>()
    const syncPlayerEntity = vi.fn()
    const broadcastAll = vi.fn()
    const broadcastScoreUpdate = vi.fn()
    const resolvedSpawn = { x: 5, y: 1, z: 5 }

    respawnPlayer({
      playerId: 'target',
      players: new Map([['target', player]]),
      weaponStates,
      resolveSpawnPoint: () => resolvedSpawn,
      syncPlayerEntity,
      broadcastAll,
      broadcastScoreUpdate,
    })

    expect(player.dead).toBe(false)
    expect(player.position).toEqual(resolvedSpawn)
    expect(player.health).toBe(100)
    expect(player.respawnAt).toBeNull()
    expect(syncPlayerEntity).toHaveBeenCalledWith('target')
    expect(broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYER_RESPAWN', playerId: 'target' }))
    expect(broadcastScoreUpdate).toHaveBeenCalled()
  })

  it('schedules respawn only when player is dead and round active', () => {
    vi.useFakeTimers()
    const player = createPlayer('target')
    player.dead = true
    player.respawnAt = Date.now() + 50
    const getPlayer = vi.fn(() => player)
    const respawnPlayer = vi.fn()
    const isRoundActive = vi.fn(() => true)

    scheduleRespawn({
      playerId: 'target',
      getPlayer,
      isRoundActive,
      respawnPlayer,
    })

    vi.advanceTimersByTime(100)
    expect(respawnPlayer).toHaveBeenCalledWith('target')
    vi.useRealTimers()
  })
})
