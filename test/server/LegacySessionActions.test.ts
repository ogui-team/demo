import { executeLegacySessionAction, shouldIgnoreLegacyAction } from '../../server/src/gameplay/LegacySessionActions'

describe('LegacySessionActions', () => {
  it('detects legacy actions that should be ignored', () => {
    expect(shouldIgnoreLegacyAction('AMMO_STATE_SYNC')).toBe(true)
    expect(shouldIgnoreLegacyAction('PLAYER_DAMAGE')).toBe(true)
    expect(shouldIgnoreLegacyAction('PLAYER_APPEARANCE')).toBe(false)
  })

  it('handles player appearance updates and broadcasts to others', () => {
    const broadcastOthers = vi.fn()
    const actor = { id: 'p1', dead: false, health: 100 } as any

    executeLegacySessionAction({
      action: 'PLAYER_APPEARANCE',
      actor,
      data: { appearance: { hair: 'blue' } },
      readFiniteNumber: () => undefined,
      sanitizePlayerAppearancePayload: (value) => (typeof value === 'object' && value ? { ...(value as object) } : null),
      applyDamage: vi.fn(),
      respawnPlayer: vi.fn(),
      createWorldObjectFromRequest: vi.fn(),
      getWorldObject: vi.fn(),
      setWorldObject: vi.fn(),
      deleteWorldObject: vi.fn(),
      upsertWorldObjectCollider: vi.fn(),
      removeWorldObjectCollider: vi.fn(),
      getWorldObjectHalfExtents: () => ({ x: 1, y: 1, z: 1 }),
      broadcastAll: vi.fn(),
      broadcastOthers,
      syncPlayerEntity: vi.fn(),
    })

    expect(actor.appearance).toEqual({ hair: 'blue' })
    expect(broadcastOthers).toHaveBeenCalledWith('p1', expect.objectContaining({ type: 'PLAYER_APPEARANCE' }))
  })

  it('places, updates, and removes world objects correctly', () => {
    const setWorldObject = vi.fn()
    const upsertWorldObjectCollider = vi.fn()
    const broadcastAll = vi.fn()
    const broadcastOthers = vi.fn()
    const deleteWorldObject = vi.fn()
    const removeWorldObjectCollider = vi.fn()
    const worldObject = { id: 'obj1', position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 } }
    const actor = { id: 'p1', dead: false, health: 100 } as any

    executeLegacySessionAction({
      action: 'WORLD_OBJECT_PLACE',
      actor,
      data: { objectType: 'crate' },
      readFiniteNumber: () => undefined,
      sanitizePlayerAppearancePayload: () => null,
      applyDamage: vi.fn(),
      respawnPlayer: vi.fn(),
      createWorldObjectFromRequest: () => worldObject,
      getWorldObject: vi.fn(),
      setWorldObject,
      deleteWorldObject,
      upsertWorldObjectCollider,
      removeWorldObjectCollider,
      getWorldObjectHalfExtents: () => ({ x: 1, y: 1, z: 1 }),
      broadcastAll,
      broadcastOthers,
      syncPlayerEntity: vi.fn(),
    })

    expect(setWorldObject).toHaveBeenCalledWith('obj1', worldObject)
    expect(upsertWorldObjectCollider).toHaveBeenCalledWith('obj1', worldObject.position, { x: 1, y: 1, z: 1 })
    expect(broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'WORLD_OBJECT_PLACE' }))

    executeLegacySessionAction({
      action: 'WORLD_OBJECT_UPDATE',
      actor,
      data: { id: 'obj1', position: { x: 2, y: 2, z: 2 } },
      readFiniteNumber: () => undefined,
      sanitizePlayerAppearancePayload: () => null,
      applyDamage: vi.fn(),
      respawnPlayer: vi.fn(),
      createWorldObjectFromRequest: vi.fn(),
      getWorldObject: () => worldObject,
      setWorldObject,
      deleteWorldObject,
      upsertWorldObjectCollider,
      removeWorldObjectCollider,
      getWorldObjectHalfExtents: () => ({ x: 1, y: 1, z: 1 }),
      broadcastAll,
      broadcastOthers,
      syncPlayerEntity: vi.fn(),
    })

    expect(setWorldObject).toHaveBeenCalledWith('obj1', expect.objectContaining({ position: { x: 2, y: 2, z: 2 } }))
    expect(upsertWorldObjectCollider).toHaveBeenCalledWith('obj1', { x: 2, y: 2, z: 2 }, { x: 1, y: 1, z: 1 })
    expect(broadcastOthers).toHaveBeenCalledWith('p1', expect.objectContaining({ type: 'WORLD_OBJECT_UPDATE' }))

    executeLegacySessionAction({
      action: 'WORLD_OBJECT_REMOVE',
      actor,
      data: { id: 'obj1' },
      readFiniteNumber: () => undefined,
      sanitizePlayerAppearancePayload: () => null,
      applyDamage: vi.fn(),
      respawnPlayer: vi.fn(),
      createWorldObjectFromRequest: vi.fn(),
      getWorldObject: vi.fn(),
      setWorldObject,
      deleteWorldObject,
      upsertWorldObjectCollider,
      removeWorldObjectCollider,
      getWorldObjectHalfExtents: () => ({ x: 1, y: 1, z: 1 }),
      broadcastAll,
      broadcastOthers,
      syncPlayerEntity: vi.fn(),
    })

    expect(deleteWorldObject).toHaveBeenCalledWith('obj1')
    expect(removeWorldObjectCollider).toHaveBeenCalledWith('obj1')
    expect(broadcastOthers).toHaveBeenCalledWith('p1', expect.objectContaining({ type: 'WORLD_OBJECT_REMOVE' }))
  })

  it('handles player mode change and respawn requests', () => {
    const syncPlayerEntity = vi.fn()
    const respawnPlayer = vi.fn()
    const broadcastAll = vi.fn()
    const actor = { id: 'p1', dead: false, health: 100 } as any

    executeLegacySessionAction({
      action: 'PLAYER_MODE_CHANGE',
      actor,
      data: { mode: 'spectator' },
      readFiniteNumber: () => undefined,
      sanitizePlayerAppearancePayload: () => null,
      applyDamage: vi.fn(),
      respawnPlayer,
      createWorldObjectFromRequest: vi.fn(),
      getWorldObject: vi.fn(),
      setWorldObject: vi.fn(),
      deleteWorldObject: vi.fn(),
      upsertWorldObjectCollider: vi.fn(),
      removeWorldObjectCollider: vi.fn(),
      getWorldObjectHalfExtents: () => ({ x: 1, y: 1, z: 1 }),
      broadcastAll,
      broadcastOthers: vi.fn(),
      syncPlayerEntity,
    })

    expect(actor.dead).toBe(true)
    expect(actor.health).toBe(0)
    expect(syncPlayerEntity).toHaveBeenCalledWith('p1')
    expect(broadcastAll).toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYER_SPECTATE' }))

    actor.dead = true
    actor.health = 0

    executeLegacySessionAction({
      action: 'PLAYER_MODE_CHANGE',
      actor,
      data: { mode: 'play' },
      readFiniteNumber: () => undefined,
      sanitizePlayerAppearancePayload: () => null,
      applyDamage: vi.fn(),
      respawnPlayer,
      createWorldObjectFromRequest: vi.fn(),
      getWorldObject: vi.fn(),
      setWorldObject: vi.fn(),
      deleteWorldObject: vi.fn(),
      upsertWorldObjectCollider: vi.fn(),
      removeWorldObjectCollider: vi.fn(),
      getWorldObjectHalfExtents: () => ({ x: 1, y: 1, z: 1 }),
      broadcastAll,
      broadcastOthers: vi.fn(),
      syncPlayerEntity: vi.fn(),
    })

    expect(respawnPlayer).toHaveBeenCalledWith('p1')
  })
})
