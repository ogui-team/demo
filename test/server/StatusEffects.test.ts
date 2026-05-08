import { applyAbilityMovementStatuses, applyMovementStatus } from '../../server/src/gameplay/StatusEffects'
import { ABILITY_STATUS_APPLICATIONS } from '../../server/src/rules/AbilityRules'

describe('StatusEffects', () => {
  it('adds a new movement status and refreshes player state', () => {
    const syncPlayerEntity = vi.fn()
    const player = {
      id: 'player-1',
      dead: false,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }

    applyMovementStatus(player, 'status_rooted', 1000, syncPlayerEntity)

    expect(player.activeMovementStatuses).toHaveLength(1)
    expect(player.activeMovementStatuses?.[0]).toMatchObject({
      statusId: 'status_rooted',
      sourceAbilityId: undefined,
    })
    expect(player.activeMovementStatuses?.[0].expiresAt).toBe(3000)
    expect(syncPlayerEntity).toHaveBeenCalledWith('player-1')
  })

  it('extends an existing movement status instead of duplicating it', () => {
    const syncPlayerEntity = vi.fn()
    const player = {
      id: 'player-1',
      dead: false,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [
        { statusId: 'status_rooted', expiresAt: 1200, sourceAbilityId: 'ability_old' },
      ],
    }

    applyMovementStatus(player, 'status_rooted', 1300, syncPlayerEntity, 'ability_new')

    expect(player.activeMovementStatuses).toHaveLength(1)
    expect(player.activeMovementStatuses?.[0]).toMatchObject({
      statusId: 'status_rooted',
      sourceAbilityId: 'ability_new',
    })
    expect(player.activeMovementStatuses?.[0].expiresAt).toBe(3300)
    expect(syncPlayerEntity).toHaveBeenCalledTimes(1)
  })

  it('applies aoe movement status to valid nearby targets', () => {
    const syncPlayerEntity = vi.fn()
    const actor = {
      id: 'caster',
      dead: false,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }
    const target = {
      id: 'target-1',
      dead: false,
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }
    const distant = {
      id: 'target-2',
      dead: false,
      position: { x: 100, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }

    const abilityId = Object.keys(ABILITY_STATUS_APPLICATIONS).find(
      (id) => ABILITY_STATUS_APPLICATIONS[id].kind === 'aoe_sphere',
    ) as string

    applyAbilityMovementStatuses({
      actor,
      abilityId,
      data: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
      now: 2000,
      players: [actor, target, distant],
      playerCollisionRadius: 0,
      sanitizeOrigin: (_, raw) => raw as any,
      sanitizeDirection: (raw) => raw as any,
      distance: (left, right) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z),
      validatePlayerRayTarget: () => null,
      getPlayerById: () => undefined,
      syncPlayerEntity: syncPlayerEntity,
    })

    expect(target.activeMovementStatuses).toHaveLength(1)
    expect(target.activeMovementStatuses?.[0].statusId).toBe(ABILITY_STATUS_APPLICATIONS[abilityId].statusId)
    expect(distant.activeMovementStatuses).toHaveLength(0)
    expect(syncPlayerEntity).toHaveBeenCalledWith('target-1')
  })

  it('applies hitscan movement status to a validated target', () => {
    const syncPlayerEntity = vi.fn()
    const actor = {
      id: 'caster',
      dead: false,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }
    const target = {
      id: 'target-1',
      dead: false,
      position: { x: 5, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }

    const abilityId = Object.keys(ABILITY_STATUS_APPLICATIONS).find(
      (id) => ABILITY_STATUS_APPLICATIONS[id].kind === 'hitscan',
    ) as string

    applyAbilityMovementStatuses({
      actor,
      abilityId,
      data: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
      now: 2000,
      players: [actor, target],
      playerCollisionRadius: 0,
      sanitizeOrigin: (_, raw) => raw as any,
      sanitizeDirection: (raw) => raw as any,
      distance: () => 0,
      validatePlayerRayTarget: () => target.id,
      getPlayerById: (playerId) => (playerId === target.id ? target : undefined),
      syncPlayerEntity: syncPlayerEntity,
    })

    expect(target.activeMovementStatuses).toHaveLength(1)
    expect(target.activeMovementStatuses?.[0].statusId).toBe(ABILITY_STATUS_APPLICATIONS[abilityId].statusId)
    expect(syncPlayerEntity).toHaveBeenCalledWith('target-1')
  })

  it('does nothing when the ability profile is unknown', () => {
    const syncPlayerEntity = vi.fn()
    const actor = {
      id: 'caster',
      dead: false,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }
    const target = {
      id: 'target-1',
      dead: false,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }

    applyAbilityMovementStatuses({
      actor,
      abilityId: 'ability_unknown',
      data: {},
      now: 2000,
      players: [target],
      playerCollisionRadius: 0,
      sanitizeOrigin: () => ({ x: 0, y: 0, z: 0 }),
      sanitizeDirection: () => ({ x: 0, y: 0, z: 0 }),
      distance: () => 0,
      validatePlayerRayTarget: () => null,
      getPlayerById: () => undefined,
      syncPlayerEntity: syncPlayerEntity,
    })

    expect(target.activeMovementStatuses).toHaveLength(0)
    expect(syncPlayerEntity).not.toHaveBeenCalled()
  })

  it('applies ring movement status only to players within the ring range', () => {
    const syncPlayerEntity = vi.fn()
    const actor = {
      id: 'caster',
      dead: false,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }
    const innerTarget = {
      id: 'inner',
      dead: false,
      position: { x: 2, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }
    const ringTarget = {
      id: 'ring',
      dead: false,
      position: { x: 8, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }

    const abilityId = Object.keys(ABILITY_STATUS_APPLICATIONS).find(
      (id) => ABILITY_STATUS_APPLICATIONS[id].kind === 'aoe_ring',
    ) as string

    applyAbilityMovementStatuses({
      actor,
      abilityId,
      data: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
      now: 2000,
      players: [actor, innerTarget, ringTarget],
      playerCollisionRadius: 0,
      sanitizeOrigin: (_, raw) => raw as any,
      sanitizeDirection: (raw) => raw as any,
      distance: (left, right) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z),
      validatePlayerRayTarget: () => null,
      getPlayerById: () => undefined,
      syncPlayerEntity: syncPlayerEntity,
    })

    expect(innerTarget.activeMovementStatuses).toHaveLength(0)
    expect(ringTarget.activeMovementStatuses).toHaveLength(1)
    expect(syncPlayerEntity).toHaveBeenCalledWith('ring')
  })
})
