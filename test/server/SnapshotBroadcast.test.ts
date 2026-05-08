import { expect, type Mock, vi } from 'vitest'
import * as SnapshotBroadcastModule from '../../server/src/snapshot/SnapshotBroadcast'
import { broadcastWorldDelta, cloneEntitySnapshot, createInitialSnapshotDiagnostics, countIterable, isEntityRelevantToPlayer, computeDelta, arraysEqual } from '../../server/src/snapshot/SnapshotBroadcast'

describe('SnapshotBroadcast', () => {
  it('sends a player snapshot payload to connected players', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()

    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = {
      id: 'player-1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }

    const result = broadcastWorldDelta({
      tick: 1,
      timestamp: 123456,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(1)
    const message = JSON.parse(sentPayloads[0].payload)
    expect(message.type).toBe('WORLD_DELTA')
    expect(message.tick).toBe(1)
    expect(message.entities).toHaveLength(1)
    expect(message.entities[0]).toMatchObject({ id: 'player-1', isPlayerControlled: true, IS_PLAYER_CONTROLLED: true })
    expect(result.snapshotsSent).toBe(1)
    expect(result.entityCount).toBe(1)
    expect(result.playerCount).toBe(1)
  })

  it('filters grunt entities from the snapshot broadcast', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()

    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const grunt = {
      id: 'grunt_1',
      type: 'prefab_enemygrunt',
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }
    const entity = {
      id: 'player-1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }

    const result = broadcastWorldDelta({
      tick: 2,
      timestamp: 123457,
      round: null,
      events: [],
      players: [player],
      entities: [entity, grunt],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(1)
    const message = JSON.parse(sentPayloads[0].payload)
    expect(message.entities).toHaveLength(1)
    expect(message.entities[0].id).toBe('player-1')
    expect(result.entityCount).toBe(1)
  })

  it('recovers from a failed initial clone by adding an emergency local player payload', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = {
      id: 'player-1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }
    let cloneCalls = 0

    const result = broadcastWorldDelta({
      tick: 16,
      timestamp: 123472,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
      cloneEntitySnapshot: () => {
        cloneCalls += 1
        return cloneCalls === 1 ? undefined : ({ ...entity })
      },
    })

    expect(cloneCalls).toBe(2)
    expect(sentPayloads).toHaveLength(1)
    const message = JSON.parse(sentPayloads[0].payload)
    expect(message.entities).toHaveLength(1)
    expect(message.entities[0].id).toBe('player-1')
    expect(result.snapshotsSent).toBe(1)
  })

  it('logs a payload validation failure when snapshot payload is empty and player is not in the snapshot data', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const distantNpc = {
      id: 'npc_1',
      type: 'npc',
      position: { x: 1000, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = broadcastWorldDelta({
      tick: 20,
      timestamp: 123500,
      round: null,
      events: [],
      players: [player],
      entities: [distantNpc],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[SERVER_PAYLOAD_VALIDATION_FAILED] Serialized snapshot has zero entities'), expect.anything())
    expect(result.snapshotsSent).toBe(0)
    errorSpy.mockRestore()
  })

  it('skips sending an empty snapshot when no relevant entities exist', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()

    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const npc = {
      id: 'npc_1',
      type: 'npc',
      position: { x: 1000, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }

    const result = broadcastWorldDelta({
      tick: 3,
      timestamp: 123458,
      round: null,
      events: [],
      players: [player],
      entities: [npc],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(0)
    expect(result.snapshotsSent).toBe(0)
  })

  it('includes a determinism hash on snapshot ticks divisible by 100', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = { id: 'player-1', type: 'player', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }

    broadcastWorldDelta({
      tick: 100,
      timestamp: 123459,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    const message = JSON.parse(sentPayloads[0].payload)
    expect(message.positionHash).toMatch(/^[0-9A-F]{8}$/)
  })

  it('does not send snapshots when canSendToPlayer returns false', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = { id: 'player-1', type: 'player', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }

    const result = broadcastWorldDelta({
      tick: 4,
      timestamp: 123460,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => false,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(0)
    expect(result.snapshotsSent).toBe(0)
  })

  it('skips sending when there are no entities at all', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }

    const result = broadcastWorldDelta({
      tick: 7,
      timestamp: 123463,
      round: null,
      events: [],
      players: [player],
      entities: [],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 100,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(0)
    expect(result.snapshotsSent).toBe(0)
    expect(result.playerCount).toBe(1)
    expect(result.entityCount).toBe(0)
  })

  it('updates snapshot diagnostics statistics correctly after a broadcast', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = { id: 'player-1', type: 'player', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, health: 100 }

    const result = broadcastWorldDelta({
      tick: 8,
      timestamp: 123464,
      round: null,
      events: [{ type: 'TEST_EVENT' }],
      players: [player],
      entities: [entity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 100,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 5,
      lastProcessedInputTickForPlayer: () => 5,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(1)
    expect(result.eventCount).toBe(1)
    expect(result.snapshotsSent).toBe(1)
    expect(result.lastBytesPerSnapshot).toBeGreaterThan(0)
    expect(result.averageBytesPerSnapshot).toBeGreaterThan(0)
    expect(result.forcedRefreshes).toBe(1)
  })

  it('includes an owned entity when ownership matches the snapshot player', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = {
      id: 'owned_1',
      type: 'player',
      ownerId: 'player-1',
      position: { x: 50, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }

    broadcastWorldDelta({
      tick: 5,
      timestamp: 123461,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(1)
    const message = JSON.parse(sentPayloads[0].payload)
    expect(message.entities).toHaveLength(1)
    expect(message.entities[0].id).toBe('owned_1')
  })

  it('filters entities using includeEntityInSnapshot before processing', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = {
      id: 'filtered_1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }

    const result = broadcastWorldDelta({
      tick: 6,
      timestamp: 123462,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 100,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
      includeEntityInSnapshot: () => false,
    })

    expect(sentPayloads).toHaveLength(0)
    expect(result.snapshotsSent).toBe(0)
  })

  it('still includes local player entities when they are outside the relevance radius', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = {
      id: 'player-1',
      type: 'player',
      position: { x: 1000, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 1, y: 2, z: 3 },
      equipment: ['pistol'],
      statusMovementModifier: { mode: 'run' },
      health: 100,
    }

    broadcastWorldDelta({
      tick: 9,
      timestamp: 123465,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => ({ ...(modifier as object) }),
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(1)
    const message = JSON.parse(sentPayloads[0].payload)
    expect(message.entities).toHaveLength(1)
    expect(message.entities[0].id).toBe('player-1')
  })

  it('includes entities controlled by a player via controllerId in snapshots', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = {
      id: 'drone_1',
      type: 'player',
      controllerId: 'player-1',
      position: { x: 1000, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }

    broadcastWorldDelta({
      tick: 12,
      timestamp: 123468,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(1)
    const message = JSON.parse(sentPayloads[0].payload)
    expect(message.entities).toHaveLength(1)
    expect(message.entities[0].id).toBe('drone_1')
    expect(message.entities[0].isPlayerControlled).toBe(true)
  })

  it('includes entities controlled by networkEntityId in snapshots', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = {
      id: 'drone_2',
      type: 'player',
      networkEntityId: 'player-1',
      position: { x: 1000, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }

    broadcastWorldDelta({
      tick: 13,
      timestamp: 123469,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(1)
    const message = JSON.parse(sentPayloads[0].payload)
    expect(message.entities).toHaveLength(1)
    expect(message.entities[0].id).toBe('drone_2')
    expect(message.entities[0].isPlayerControlled).toBe(true)
  })

  it('filters grunts by npc_enemy_grunt id and Prefab_EnemyGrunt type', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const gruntById = {
      id: 'npc_enemy_grunt_1',
      type: 'npc',
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }
    const gruntByType = {
      id: 'grunt_2',
      type: 'Prefab_EnemyGrunt',
      position: { x: 2, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }
    const entity = {
      id: 'player-1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }

    broadcastWorldDelta({
      tick: 15,
      timestamp: 123471,
      round: null,
      events: [],
      players: [player],
      entities: [entity, gruntById, gruntByType],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => modifier,
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(1)
    const message = JSON.parse(sentPayloads[0].payload)
    expect(message.entities).toHaveLength(1)
    expect(message.entities[0].id).toBe('player-1')
  })

  it('directly clones an entity snapshot and preserves nested structures', () => {
    const original = {
      id: 'player-1',
      type: 'player',
      position: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 1, y: 2, z: 3 },
      equipment: ['pistol'],
      statusMovementModifier: { mode: 'run' },
    }

    const cloned = cloneEntitySnapshot(original, (modifier) => ({ ...(modifier as object) }))
    expect(cloned).toEqual(expect.objectContaining({ id: 'player-1' }))
    expect(cloned.position).not.toBe(original.position)
    expect(cloned.rotation).not.toBe(original.rotation)
    expect(cloned.velocity).not.toBe(original.velocity)
    expect(cloned.equipment).not.toBe(original.equipment)
    expect(cloned.statusMovementModifier).not.toBe(original.statusMovementModifier)
  })

  it('returns false for non-array inputs in arraysEqual', () => {
    const cloneSpy = vi.fn((modifier) => ({ ...(modifier as Record<string, unknown>) }))
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = {
      id: 'player-1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      statusMovementModifier: { mode: 'dash' },
    }

    broadcastWorldDelta({
      tick: 14,
      timestamp: 123470,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: cloneSpy,
      statusMovementModifiersEqual: () => false,
    })

    expect(cloneSpy).toHaveBeenCalledWith({ mode: 'dash' })
    const message = JSON.parse(sentPayloads[0].payload)
    expect(message.entities[0].statusMovementModifier).toEqual({ mode: 'dash' })
  })

  it('returns false for non-array inputs in arraysEqual', () => {
    expect(arraysEqual('a', ['a'])).toBe(false)
    expect(arraysEqual(['a'], 'a')).toBe(false)
    expect(arraysEqual('a', 'a')).toBe(false)
    expect(arraysEqual(['a'], ['a', 'b'])).toBe(false)
  })

  it('computes delta for vector changes and ignores tiny floating point drift', () => {
    const current = {
      id: 'player-1',
      type: 'player',
      position: { x: 1.0005, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 0.5, y: 0, z: 0 },
      health: 100,
      equipment: ['pistol'],
      statusMovementModifier: { mode: 'run' },
    }
    const previous = {
      ...current,
      position: { x: 1.0, y: 1, z: 1 },
      velocity: { x: 0.5, y: 0, z: 0 },
      equipment: ['pistol'],
      statusMovementModifier: { mode: 'run' },
    }

    const noDelta = computeDelta(current, previous, () => true)
    expect(noDelta).toBeNull()

    const changed = computeDelta({ ...current, velocity: { x: 1, y: 0, z: 0 } }, previous, () => true)
    expect(changed).toMatchObject({ velocity: { x: 1, y: 0, z: 0 } })
  })

  it('computes status movement modifier changes using comparator equality', () => {
    const current = {
      id: 'player-1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      health: 100,
      equipment: ['pistol'],
      statusMovementModifier: { mode: 'run' },
    }
    const previous = {
      ...current,
      statusMovementModifier: { mode: 'run' },
    }

    expect(computeDelta(current, previous, () => true)).toBeNull()
    expect(computeDelta(current, previous, () => false)).toMatchObject({ statusMovementModifier: current.statusMovementModifier })
  })

  it('preserves previous status movement modifier object when comparator deems them equal', () => {
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = {
      id: 'player-1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      statusMovementModifier: { mode: 'run' },
    }
    const previousSnapshot = new Map<string, Record<string, unknown>>()
    const previousStatusModifier = { mode: 'run' }
    previousSnapshot.set('player-1', {
      id: 'player-1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      statusMovementModifier: previousStatusModifier,
    })

    const snapshots = new Map<string, Map<string, Record<string, unknown>>>()
    snapshots.set(player.id, previousSnapshot)

    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    broadcastWorldDelta({
      tick: 30,
      timestamp: 123480,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots,
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 100,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => ({ ...(modifier as object) }),
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(1)
    expect(snapshots.get(player.id)?.get('player-1')?.statusMovementModifier).toBe(previousStatusModifier)
  })

  it('deep clones entity payloads so mutating the sent snapshot does not affect original entities', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const originalEntity = {
      id: 'player-1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 1, y: 2, z: 3 },
      equipment: ['pistol'],
      statusMovementModifier: { mode: 'run' },
    }

    broadcastWorldDelta({
      tick: 10,
      timestamp: 123466,
      round: null,
      events: [],
      players: [{ id: 'player-1', position: { x: 0, y: 0, z: 0 } }],
      entities: [originalEntity],
      snapshots: new Map(),
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 0,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => ({ ...(modifier as object) }),
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(1)
    const message = JSON.parse(sentPayloads[0].payload)
    const payloadEntity = message.entities[0]

    payloadEntity.position.x = 999
    payloadEntity.velocity.x = 999
    payloadEntity.equipment[0] = 'shotgun'
    payloadEntity.statusMovementModifier.mode = 'crawl'

    expect(originalEntity.position.x).toBe(0)
    expect(originalEntity.velocity.x).toBe(1)
    expect(originalEntity.equipment[0]).toBe('pistol')
    expect((originalEntity.statusMovementModifier as any).mode).toBe('run')
  })

  it('removes stale snapshot entries when entities are no longer relevant', () => {
    const sentPayloads: Array<{ playerId: string; payload: string }> = []
    const diagnostics = createInitialSnapshotDiagnostics()
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const entity = {
      id: 'player-1',
      type: 'player',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }
    const snapshots = new Map<string, Map<string, Record<string, unknown>>>()
    const staleStore = new Map<string, Record<string, unknown>>([['stale_entity', { id: 'stale_entity' }]])
    snapshots.set(player.id, staleStore)

    broadcastWorldDelta({
      tick: 11,
      timestamp: 123467,
      round: null,
      events: [],
      players: [player],
      entities: [entity],
      snapshots,
      snapshotDiagnostics: diagnostics,
      relevanceRadius: 100,
      canSendToPlayer: () => true,
      sendToPlayer: (playerToSend, payload) => {
        sentPayloads.push({ playerId: playerToSend.id, payload })
      },
      lastProcessedInputSeqForPlayer: () => 0,
      lastProcessedInputTickForPlayer: () => 0,
      cloneStatusMovementModifier: (modifier) => ({ ...(modifier as object) }),
      statusMovementModifiersEqual: () => true,
    })

    expect(sentPayloads).toHaveLength(1)
    expect(staleStore.has('stale_entity')).toBe(false)
    expect(staleStore.has('player-1')).toBe(true)
  })

  it('counts iterable values correctly', () => {
    expect(countIterable([1, 2, 3])).toBe(3)
    expect(countIterable(new Set(['a', 'b']))).toBe(2)
  })

  it('determines entity relevance based on radius', () => {
    const player = { id: 'player-1', position: { x: 0, y: 0, z: 0 } }
    const nearbyEntity = { id: 'entity-1', position: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }
    const farEntity = { id: 'entity-2', position: { x: 100, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }

    expect(isEntityRelevantToPlayer(player, nearbyEntity, 5)).toBe(true)
    expect(isEntityRelevantToPlayer(player, farEntity, 5)).toBe(false)
  })

  it('computes snapshot delta results and array equality support', () => {
    const current = {
      id: 'player-1',
      type: 'player',
      position: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      health: 100,
      equipment: ['pistol'],
      statusMovementModifier: { mode: 'run' },
    }

    const fullDelta = computeDelta(current, undefined, () => true)
    expect(fullDelta).toMatchObject({ id: 'player-1', health: 100 })

    const unchangedPrevious = { ...current }
    expect(computeDelta(current, unchangedPrevious, () => true)).toBeNull()

    const changedPrevious = { ...current, health: 90, equipment: ['shotgun'] }
    const delta = computeDelta(current, changedPrevious, () => false)
    expect(delta).toMatchObject({ health: 100, equipment: ['pistol'], statusMovementModifier: current.statusMovementModifier })
    expect(arraysEqual(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(arraysEqual(['a'], ['b'])).toBe(false)
  })
})
