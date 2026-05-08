import {
  buildDebugStatusOverride,
  buildStatusMovementModifier,
  cloneStatusMovementModifier,
  refreshPlayerStatusMovementModifier,
  statusMovementModifiersEqual,
  type StatusTrackedPlayer,
} from '../../server/src/gameplay/StatusRuntime'

describe('StatusRuntime', () => {
  let player: StatusTrackedPlayer

  beforeEach(() => {
    player = {
      rotation: { x: 0, y: 0, z: 0 },
      activeMovementStatuses: [],
    }
  })

  it('builds no modifier when no active statuses', () => {
    player.activeMovementStatuses = []
    const modifier = buildStatusMovementModifier(player)

    expect(modifier).toBeNull()
  })

  it('applies rooted status blocking movement', () => {
    player.activeMovementStatuses = [
      { statusId: 'status_rooted', expiresAt: Date.now() + 1000 },
    ]
    const modifier = buildStatusMovementModifier(player)

    expect(modifier?.blockMovement).toBe(true)
    expect(modifier?.speedMultiplier).toBe(0)
  })

  it('applies chilled status reducing speed', () => {
    player.activeMovementStatuses = [
      { statusId: 'status_chilled', expiresAt: Date.now() + 1000 },
    ]
    const modifier = buildStatusMovementModifier(player)

    expect(modifier?.speedMultiplier).toBe(0.5)
    expect(modifier?.blockMovement).toBeUndefined()
  })

  it('applies electrocuted status with impulse override', () => {
    player.activeMovementStatuses = [
      { statusId: 'status_electrocuted', expiresAt: Date.now() + 1000 },
    ]
    const modifier = buildStatusMovementModifier(player)

    expect(modifier?.blockMovement).toBe(true)
  })

  it('refreshes expired statuses removing them', () => {
    const now = Date.now()
    player.activeMovementStatuses = [
      { statusId: 'status_rooted', expiresAt: now - 100 },
      { statusId: 'status_chilled', expiresAt: now + 1000 },
    ]

    refreshPlayerStatusMovementModifier(player, now)

    expect(player.activeMovementStatuses).toHaveLength(1)
    expect(player.activeMovementStatuses![0].statusId).toBe('status_chilled')
  })

  it('combines multiple active statuses', () => {
    player.activeMovementStatuses = [
      { statusId: 'status_rooted', expiresAt: Date.now() + 1000 },
      { statusId: 'status_chilled', expiresAt: Date.now() + 2000 },
    ]
    const modifier = buildStatusMovementModifier(player)

    expect(modifier?.blockMovement).toBe(true)
    expect(modifier?.speedMultiplier).toBe(0)
  })

  it('builds debug status override from raw input values', () => {
    const override = buildDebugStatusOverride(
      { rooted: true, chilled: true, electrocuted: true, speedMultiplier: 0.25, impulseMagnitude: 4 },
      (value) => (typeof value === 'number' ? value : undefined),
      (value) => Math.max(0, Math.min(1, value)),
    )

    expect(override).toEqual({
      rooted: true,
      chilled: true,
      electrocuted: true,
      speedMultiplier: 0.25,
      impulseMagnitude: 4,
    })
  })

  it('clones status movement modifiers deeply and compares equality correctly', () => {
    const modifier = {
      blockMovement: true,
      speedMultiplier: 0,
      impulseOverride: { x: 1, y: 0, z: 2 },
    }
    const cloned = cloneStatusMovementModifier(modifier)

    expect(cloned).toEqual(modifier)
    expect(cloned).not.toBe(modifier)
    expect(statusMovementModifiersEqual(modifier, cloned)).toBe(true)
    expect(statusMovementModifiersEqual(modifier, null)).toBe(false)
  })

  it('returns null modifier when no active statuses and no debug override', () => {
    player.activeMovementStatuses = []
    const modifier = buildStatusMovementModifier(player)

    expect(modifier).toBeNull()
  })

  it('builds electrocuted debug override with impulse override', () => {
    player.rotation = { x: 0, y: Math.PI / 2, z: 0 }
    player.debugStatusOverride = {
      rooted: false,
      chilled: false,
      electrocuted: true,
      speedMultiplier: 0.7,
      impulseMagnitude: 4,
    }

    const modifier = buildStatusMovementModifier(player)

    expect(modifier?.blockMovement).toBe(true)
    expect(modifier?.speedMultiplier).toBe(0)
    expect(modifier?.impulseOverride).toBeDefined()
    expect(modifier?.impulseOverride?.x).toBeCloseTo(4)
    expect(modifier?.impulseOverride?.y).toBeCloseTo(0)
    expect(modifier?.impulseOverride?.z).toBeCloseTo(0)
  })

  it('does not refresh status when nothing changes', () => {
    player.activeMovementStatuses = [{ statusId: 'status_chilled', expiresAt: Date.now() + 1000 }]
    player.statusMovementModifier = buildStatusMovementModifier(player)
    const now = Date.now()

    const refreshed = refreshPlayerStatusMovementModifier(player, now)

    expect(refreshed).toBe(false)
  })

  it('applies chilled debug override when no active statuses exist', () => {
    player.activeMovementStatuses = []
    player.debugStatusOverride = {
      rooted: false,
      chilled: true,
      electrocuted: false,
      speedMultiplier: 0.3,
      impulseMagnitude: 0,
    }

    const modifier = buildStatusMovementModifier(player)

    expect(modifier?.speedMultiplier).toBe(0.3)
    expect(modifier?.blockMovement).toBeUndefined()
  })

  it('buildDebugStatusOverride returns null when no status flags are provided', () => {
    const override = buildDebugStatusOverride(
      { rooted: false, chilled: false, electrocuted: false },
      (value) => (typeof value === 'number' ? value : undefined),
      (value) => Math.max(0, Math.min(1, value)),
    )

    expect(override).toBeNull()
  })
})
