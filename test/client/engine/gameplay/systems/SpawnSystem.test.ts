import { describe, expect, it, vi } from 'vitest'
import { SpawnSystem } from '@engine/gameplay/systems/SpawnSystem'

type Vector3 = { x: number; y: number; z: number }

type Entity = {
  addComponent: (component: { name: string; data: unknown }) => void;
}

const makeEntity = (position: Vector3): { getPosition: () => Vector3 } => ({
  getPosition: () => position,
})

const makePrefabSystem = () => ({
  create: vi.fn((prefabName: string, position: Vector3) => ({
    id: `entity-${prefabName}`,
    prefabName,
    position,
    addComponent: vi.fn(),
  } as unknown as Entity)),
})

const makeRegistrar = () => ({
  reserveHandleForPlayer: vi.fn(() => true),
  registerNetworkEntityIdMapping: vi.fn(() => true),
})

describe('SpawnSystem', () => {
  it('registers, exports, imports, and clears spawn points', () => {
    const prefabSystem = makePrefabSystem()
    const manager = { getEntities: () => [] }
    const spawnSystem = new SpawnSystem(manager, prefabSystem)

    const id = spawnSystem.registerSpawnPoint({
      id: 'spawn-test',
      position: { x: 1, y: 0, z: 1 },
      weight: 0.001,
      radius: 0.1,
      tags: ['alpha'],
    })

    expect(id).toBe('spawn-test')
    expect(spawnSystem.listSpawnPoints()).toHaveLength(1)
    expect(spawnSystem.listSpawnPoints()[0]).toMatchObject({
      id: 'spawn-test',
      position: { x: 1, y: 0, z: 1 },
      weight: 0.01,
      radius: 0.25,
      tags: ['alpha'],
    })

    expect(spawnSystem.getDebugState().pointCount).toBe(1)
    expect(spawnSystem.getDiagnostics().pointCount).toBe(1)

    const exported = spawnSystem.exportState()
    spawnSystem.clearSpawnPoints()
    expect(spawnSystem.listSpawnPoints()).toHaveLength(0)

    spawnSystem.importState(exported)
    expect(spawnSystem.listSpawnPoints()).toHaveLength(1)
    expect(spawnSystem.listSpawnPoints()[0].id).toBe('spawn-test')
  })

  it('returns a matching spawn position for eligible points and preferred position', () => {
    const prefabSystem = makePrefabSystem()
    const nearbyEntity = makeEntity({ x: 10, y: 0, z: 10 })
    const manager = { getEntities: () => [nearbyEntity] }
    const spawnSystem = new SpawnSystem(manager, prefabSystem)

    spawnSystem.registerSpawnPoint({
      id: 'spawn-1',
      position: { x: 2, y: 1, z: 2 },
      weight: 1,
      radius: 0.5,
      tags: ['player'],
    })

    const result = spawnSystem.findSpawnPosition({
      tag: 'player',
      preferredPosition: { x: 0, y: 1, z: 0 },
    })

    expect(result).toEqual({ x: 2, y: 1, z: 2 })
  })

  it('spawns prefabs with network registration when available', () => {
    const prefabSystem = makePrefabSystem()
    const registrar = makeRegistrar()
    const manager = { getEntities: () => [] }
    const spawnSystem = new SpawnSystem(manager, prefabSystem)

    spawnSystem.init({
      entityManager: manager,
      systems: {
        prefabSystem,
        networkSyncSystem: { getNetworkEntityIdRegistrar: () => registrar },
      },
    } as any)

    const entity = spawnSystem.spawnPrefab('hero', {
      playerId: 'player-1',
      networkEntityId: 'net-123',
      position: { x: 5, y: 1, z: 5 },
    })

    expect(registrar.reserveHandleForPlayer).toHaveBeenCalledWith('player-1')
    expect(registrar.registerNetworkEntityIdMapping).toHaveBeenCalledWith('player-1', 'net-123')
    expect(prefabSystem.create).toHaveBeenCalledWith('hero', { x: 5, y: 1, z: 5 })
    expect(entity).toHaveProperty('addComponent')
  })

  it('spawns player avatars and adds local player components when requested', () => {
    const prefabSystem = makePrefabSystem()
    const manager = { getEntities: () => [] }
    const spawnSystem = new SpawnSystem(manager, prefabSystem)
    const player = spawnSystem.spawnPlayer('player-2', 'player_v1', {
      localControlled: true,
      position: { x: 0, y: 1, z: 0 },
    })

    expect(prefabSystem.create).toHaveBeenCalledWith('player_v1', { x: 0, y: 1, z: 0 })
    expect(player.addComponent).toHaveBeenCalledTimes(2)
    expect(player.addComponent).toHaveBeenCalledWith(expect.objectContaining({ name: 'dodPlayerAvatar' }))
    expect(player.addComponent).toHaveBeenCalledWith(expect.objectContaining({ name: 'localPlayer' }))
  })
})
