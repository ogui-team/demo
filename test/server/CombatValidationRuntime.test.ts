import { describe, it, expect, vi } from 'vitest'
import {
  captureEntityHistoryFrame,
  findClosestHistoryFrame,
  validatePlayerRayTarget,
} from '../../server/src/session/combatValidationRuntime'

describe('CombatValidationRuntime', () => {
  it('captures entity history frames as deep copies of the entity state map', () => {
    const entities = new Map([
      ['entity-1', { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }],
    ])

    const frame = captureEntityHistoryFrame(entities, 5, 1000)
    expect(frame.tick).toBe(5)
    expect(frame.timestamp).toBe(1000)
    expect(frame.entities.get('entity-1')).toEqual(entities.get('entity-1'))

    const original = entities.get('entity-1') as any
    original.position.x = 99
    expect((frame.entities.get('entity-1') as any).position.x).toBe(1)
  })

  it('finds the closest history frame by timestamp', () => {
    const frames = [
      { timestamp: 100 },
      { timestamp: 200 },
      { timestamp: 300 },
    ]
    expect(findClosestHistoryFrame(frames, 250)).toBe(frames[1])
    expect(findClosestHistoryFrame(frames, 50)).toBe(frames[0])
    expect(findClosestHistoryFrame([], 150)).toBeNull()
  })

  it('returns the nearest valid target id when ray intersects a non-self player and geometry does not block', () => {
    const options = {
      playerId: 'player-1',
      players: new Map([
        ['player-1', { id: 'player-1', dead: false, position: { x: 0, y: 0, z: 0 } }],
        ['player-2', { id: 'player-2', dead: false, position: { x: 0, y: 0, z: -5 } }],
      ]),
      entities: new Map([
        ['player-2', { position: { x: 0, y: 0, z: -5 }, rotation: { x: 0, y: 0, z: 0 } }],
      ]),
      entityFrame: null,
      collisionFrame: null,
      collisionAuthority: { raycast: vi.fn().mockReturnValue(null) },
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
      range: 10,
    } as any

    const result = validatePlayerRayTarget(options)
    expect(result).toBe('player-2')
    expect(options.collisionAuthority.raycast).toHaveBeenCalledWith(options.origin, options.direction, 5, undefined)
  })

  it('returns null when the only target is self or dead', () => {
    const options = {
      playerId: 'player-1',
      players: new Map([
        ['player-1', { id: 'player-1', dead: false, position: { x: 0, y: 0, z: 0 } }],
        ['player-2', { id: 'player-2', dead: true, position: { x: 0, y: 0, z: -1 } }],
      ]),
      entities: new Map([['player-2', { position: { x: 0, y: 0, z: -1 }, rotation: { x: 0, y: 0, z: 0 } }]]),
      entityFrame: null,
      collisionFrame: null,
      collisionAuthority: { raycast: vi.fn().mockReturnValue(null) },
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
      range: 10,
    } as any

    expect(validatePlayerRayTarget(options)).toBeNull()
  })

  it('returns null when geometry collision occurs before the target', () => {
    const options = {
      playerId: 'player-1',
      players: new Map([
        ['player-1', { id: 'player-1', dead: false, position: { x: 0, y: 0, z: 0 } }],
        ['player-2', { id: 'player-2', dead: false, position: { x: 0, y: 0, z: -2 } }],
      ]),
      entities: new Map([['player-2', { position: { x: 0, y: 0, z: -2 }, rotation: { x: 0, y: 0, z: 0 } }]]),
      entityFrame: null,
      collisionFrame: null,
      collisionAuthority: { raycast: vi.fn().mockReturnValue({ distance: 1 }) },
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
      range: 10,
    } as any

    expect(validatePlayerRayTarget(options)).toBeNull()
  })
})
