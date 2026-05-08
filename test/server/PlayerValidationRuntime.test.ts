import { describe, expect, it, vi } from 'vitest'
import {
  sanitizeAngle,
  sanitizePitch,
  sanitizeOptionalVec3,
  sanitizeOrigin,
  sanitizeDirection,
  sanitizeTimestamp,
  readFiniteNumber,
  clamp01,
  distance,
  normalizePlanarDirection,
  validateHitscan,
  validateAbilityUse,
  buildAbilityMovementIntent,
} from '../../server/src/session/playerValidationRuntime'

describe('PlayerValidationRuntime utilities', () => {
  const player = {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: Math.PI / 4, z: 0 },
  } as any

  it('normalizes an angle into the [-π, π] range', () => {
    expect(sanitizeAngle(4 * Math.PI, 0)).toBeCloseTo(0, 5)
    expect(sanitizeAngle(undefined, 1)).toBe(1)
  })

  it('clamps pitch into the allowed range', () => {
    expect(sanitizePitch(10, 0)).toBeCloseTo(Math.PI / 2.5, 5)
    expect(sanitizePitch(-10, 0)).toBeCloseTo(-Math.PI / 2.5, 5)
    expect(sanitizePitch(undefined, 0.3)).toBe(0.3)
  })

  it('returns null for invalid vec3 values and preserves valid vec3', () => {
    expect(sanitizeOptionalVec3(null)).toBeNull()
    expect(sanitizeOptionalVec3({ x: 1, y: 2, z: '3' })).toBeNull()
    expect(sanitizeOptionalVec3({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('sanitizes origin and falls back when raw data is invalid or distant', () => {
    const fallback = { x: 1, y: 2 + 1.65, z: 3 }
    expect(sanitizeOrigin(player, null)).toEqual(fallback)
    expect(sanitizeOrigin(player, { x: 100, y: 100, z: 100 })).toEqual(fallback)
    expect(sanitizeOrigin(player, { x: 2, y: fallback.y, z: 3 })).toEqual({ x: 2, y: fallback.y, z: 3 })
  })

  it('normalizes direction vectors and falls back on invalid input', () => {
    expect(sanitizeDirection(null)).toEqual({ x: 0, y: 0, z: -1 })
    expect(sanitizeDirection({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: -1 })
    expect(sanitizeDirection({ x: 2, y: 2, z: 0 })).toEqual({ x: 1 / Math.sqrt(2), y: 1 / Math.sqrt(2), z: 0 })
  })

  it('sanitizes timestamps and finite numbers', () => {
    expect(typeof sanitizeTimestamp(1234)).toBe('number')
    expect(sanitizeTimestamp(NaN)).toBeGreaterThan(Date.now() - 1000)
    expect(readFiniteNumber(5)).toBe(5)
    expect(readFiniteNumber('6')).toBeUndefined()
  })

  it('clamps numeric values to [0,1] range', () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(2)).toBe(1)
  })

  it('computes Euclidean distance between points', () => {
    expect(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5)
  })

  it('normalizes planar direction and falls back when direction is zero', () => {
    const fallback = normalizePlanarDirection({ x: 0, y: 0, z: 0 }, Math.PI / 2)
    expect(fallback.x).toBe(-1)
    expect(fallback.y).toBe(0)
    expect(fallback.z).toBeCloseTo(-Math.cos(Math.PI / 2), 5)
    expect(normalizePlanarDirection({ x: 3, y: 0, z: 4 }, 0)).toEqual({ x: 3 / 5, y: 0, z: 4 / 5 })
  })

  it('builds shield dash ability movement intent and returns undefined for unknown abilities', () => {
    const result = buildAbilityMovementIntent(player as any, 'ability_shield_dash', { direction: { x: 1, y: 0, z: 0 } })
    expect(result).toEqual(expect.objectContaining({ horizontalImpulse: 25, jump: false, crouch: false }))
    expect(buildAbilityMovementIntent(player as any, 'unknown_ability', {})).toBeUndefined()
  })

  it('validates hitscan with no valid target', () => {
    const options = {
      collisionAuthority: { raycast: vi.fn().mockReturnValue(null) },
      gameSession: {
        findEntityHistoryFrame: () => null,
        findCollisionHistoryFrame: () => null,
        players: new Map<string, any>([['player-1', { id: 'player-1', dead: true }]]),
        entities: new Map(),
        abilityCooldowns: new Map(),
        activeSummons: new Map(),
      },
    } as any

    expect(validateHitscan('player-1', 'ability_shoot_pistol', { x: 0, y: 1.65, z: 0 }, { x: 0, y: 0, z: -1 }, Date.now(), options)).toBeNull()
    expect(options.collisionAuthority.raycast).toHaveBeenCalled()
  })

  it('rejects invalid and over-range ability uses', () => {
    const playerState = { id: 'player-1', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, mana: 20 } as any
    const options = {
      collisionAuthority: { raycast: vi.fn().mockReturnValue(null), simulateProjectile: vi.fn().mockReturnValue({ hit: false, distance: 0 }) },
      gameSession: {
        findEntityHistoryFrame: () => null,
        findCollisionHistoryFrame: () => null,
        players: new Map(),
        entities: new Map(),
        abilityCooldowns: new Map([['player-1', new Map([['ability_shoot_pistol', Date.now() + 1000]])]]),
        activeSummons: new Map(),
      },
    } as any

    expect(validateAbilityUse(playerState, 'ability_unknown', {}, Date.now(), options)).toEqual({ accepted: false, cooldownSec: 0, manaCost: 0 })
    expect(validateAbilityUse(playerState, 'ability_summon_skeleton', { origin: { x: 10, y: 10, z: 10 }, direction: { x: 0, y: 0, z: -1 }, targetPosition: { x: 0, y: 0, z: 0 } }, Date.now(), options)).toEqual({ accepted: false, cooldownSec: 0, manaCost: 0 })
    expect(validateAbilityUse(playerState, 'ability_shoot_pistol', { origin: { x: 0, y: 1.65, z: 0 }, direction: { x: 0, y: 0, z: -1 } }, Date.now(), options)).toEqual({ accepted: false, cooldownSec: 0, manaCost: 0 })
  })

  it('accepts summon ability when under active limit and updates active summons', () => {
    const now = Date.now()
    const playerState = { id: 'player-1', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, mana: 100 } as any
    const abilityCooldowns = new Map<string, Map<string, number>>()
    const activeSummons = new Map<string, Array<{ abilityId: string; expiresAt: number }>>()
    const options = {
      collisionAuthority: { raycast: vi.fn().mockReturnValue(null), simulateProjectile: vi.fn().mockReturnValue({ hit: false, distance: 0 }) },
      gameSession: {
        findEntityHistoryFrame: () => null,
        findCollisionHistoryFrame: () => null,
        players: new Map(),
        entities: new Map(),
        abilityCooldowns,
        activeSummons,
      },
    } as any

    const result = validateAbilityUse(playerState, 'ability_summon_skeleton', { origin: { x: 0, y: 1.65, z: 0 }, direction: { x: 0, y: 0, z: -1 }, targetPosition: { x: 1, y: 0, z: 0 } }, now, options)
    expect(result.accepted).toBe(true)
    expect(result.cooldownSec).toBeGreaterThan(0)
    expect(activeSummons.get('player-1')?.length).toBe(1)
  })
})
