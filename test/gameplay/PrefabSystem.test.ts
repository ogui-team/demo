import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { gameBus } from '../../client/src/1-kernel/core/EventBus'
import { PrefabSystem } from '../../client/src/2-systems/gameplay/systems/PrefabSystem'
import * as AssetRegistry from '../../client/src/2-systems/gameplay/systems/AssetRegistry'

vi.mock('../../client/src/assets/models', () => ({ registerBuiltinModelAssets: vi.fn() }))
vi.mock('../../client/src/assets/prefabs', () => ({ BUILTIN_PREFABS: {} }))

describe('PrefabSystem', () => {
  let scene: THREE.Scene
  let stateManager: { set: ReturnType<typeof vi.fn> }
  let objectCreator: any
  let entityManager: any
  let prefabSystem: PrefabSystem
  let targetEntity: any

  beforeEach(() => {
    gameBus.clear()
    scene = new THREE.Scene()
    stateManager = { set: vi.fn() }
    targetEntity = {
      id: 'ent1',
      addComponent: vi.fn(),
      getComponent: vi.fn(() => undefined),
      getPosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    }
    entityManager = {
      onEntityDestroyed: vi.fn(() => undefined),
      getEntity: vi.fn((id: string) => (id === 'ent1' ? targetEntity : undefined)),
      getEntities: vi.fn(() => [targetEntity]),
      destroyEntity: vi.fn(() => true),
    }
    objectCreator = {
      savePrefab: vi.fn(),
      spawn: vi.fn(() => 'obj1'),
      get: vi.fn(() => ({ id: 'obj1', entityId: 'ent1', children: [] })),
      update: vi.fn(),
      remove: vi.fn(),
      attachClient: vi.fn(),
    }
    vi.spyOn(AssetRegistry, 'hasAsset').mockReturnValue(true)
    vi.spyOn(AssetRegistry, 'invalidateAsset').mockImplementation(() => undefined)
    vi.spyOn(AssetRegistry, 'listRegisteredAssets').mockReturnValue([{ key: 'test_asset' }])
    prefabSystem = new PrefabSystem({
      scene,
      entityManager,
      stateManager,
      objectFactory: objectCreator,
      enableLogging: false,
    })
  })

  it('registers and lists prefabs', () => {
    prefabSystem.registerPrefab('box', {
      name: 'Box',
      entityType: 'box',
      networked: true,
    })

    expect(prefabSystem.listPrefabs()).toEqual(['box'])
    expect(prefabSystem.getPrefab('box')).toMatchObject({ name: 'box', entityType: 'box' })
    expect(stateManager.set).toHaveBeenCalledWith('prefabRegistry.box', expect.any(Object))
    expect(objectCreator.savePrefab).toHaveBeenCalledWith('box', expect.any(Object))
  })

  it('creates a prefab instance and emits prefabCreated', () => {
    prefabSystem.registerPrefab('box', {
      name: 'Box',
      entityType: 'box',
      networked: true,
    })
    const created = vi.fn()
    gameBus.on('prefabCreated', created)

    const entity = prefabSystem.create('box', { x: 1, y: 2, z: 3 })

    expect(entity).toBe(targetEntity)
    expect(entity.addComponent).toHaveBeenCalledWith(expect.objectContaining({ name: 'prefab' }))
    expect(stateManager.set).toHaveBeenCalledWith('prefabInstances.ent1', expect.objectContaining({ entityId: 'ent1', prefabName: 'box' }))
    expect(created).toHaveBeenCalledOnce()
  })

  it('propagates runtime prefab metadata into the prefab component on create', () => {
    prefabSystem.registerPrefab('box_meta', {
      name: 'box_meta',
      entityType: 'box',
      networked: true,
      tags: ['wall'],
      metadata: {
        runtimeMetadata: {
          collisionClass: 'static',
          affinities: ['medieval'],
        },
        editorMetadata: {
          category: 'Environment',
        },
      },
    })

    prefabSystem.create('box_meta', { x: 0, y: 0, z: 0 })

    expect(targetEntity.addComponent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'prefab',
      data: expect.objectContaining({
        prefabName: 'box_meta',
        tags: ['wall'],
        metadata: {
          collisionClass: 'static',
          affinities: ['medieval'],
        },
      }),
    }))
  })

  it('stores editor metadata separately and does not leak it into runtime component data', () => {
    prefabSystem.registerPrefab('box_meta_editor', {
      name: 'box_meta_editor',
      entityType: 'box',
      networked: true,
      metadata: {
        runtimeMetadata: { streamingCost: 2 },
        editorMetadata: { category: 'Decor', iconKey: 'box_icon' },
      },
    })

    prefabSystem.create('box_meta_editor', { x: 0, y: 0, z: 0 })

    expect(targetEntity.addComponent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'prefab',
      data: expect.objectContaining({
        metadata: { streamingCost: 2 },
      }),
    }))
    expect(targetEntity.addComponent).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'prefab',
      data: expect.objectContaining({
        metadata: expect.objectContaining({ iconKey: 'box_icon' }),
      }),
    }))
  })

  it('generates a stable content hash for a prefab definition', () => {
    prefabSystem.registerPrefab('box_hash', {
      name: 'box_hash',
      entityType: 'box',
      networked: true,
      metadata: {
        runtimeMetadata: { streamingCost: 2 },
      },
    })

    expect(prefabSystem.getPrefabContentHash('box_hash')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('createByEntityType returns null for unknown prefabs', () => {
    const result = prefabSystem.createByEntityType('unknown', { x: 0, y: 0, z: 0 })
    expect(result).toBeNull()
  })

  it('tryCreate returns null when creation fails', () => {
    prefabSystem.registerPrefab('box', {
      name: 'Box',
      entityType: 'box',
      networked: true,
    })
    objectCreator.get.mockReturnValueOnce(undefined)

    const result = prefabSystem.tryCreate('box', { x: 0, y: 0, z: 0 })
    expect(result).toBeNull()
  })

  it('duplicates an existing prefab instance', () => {
    prefabSystem.registerPrefab('box', {
      name: 'Box',
      entityType: 'box',
      networked: true,
    })
    prefabSystem.create('box', { x: 0, y: 0, z: 0 })

    const duplicate = prefabSystem.duplicate('ent1', { x: 5, y: 5, z: 5 })
    expect(duplicate).toBe(targetEntity)
    expect(objectCreator.spawn).toHaveBeenCalledTimes(2)
  })

  it('remove returns false for unknown entity and true for known instance', () => {
    expect(prefabSystem.remove('missing')).toBe(false)
    prefabSystem.registerPrefab('box', {
      name: 'Box',
      entityType: 'box',
      networked: true,
    })
    prefabSystem.create('box', { x: 0, y: 0, z: 0 })

    expect(prefabSystem.remove('ent1')).toBe(true)
    expect(objectCreator.remove).toHaveBeenCalledWith('obj1')
  })

  it('exports and imports prefab registry state', () => {
    prefabSystem.registerPrefab('box', {
      name: 'Box',
      entityType: 'box',
      networked: true,
    })

    const snapshot = prefabSystem.exportState()
    const secondSystem = new PrefabSystem({
      scene,
      entityManager,
      stateManager,
      objectFactory: objectCreator,
      enableLogging: false,
    })

    secondSystem.importState(snapshot)
    expect(secondSystem.listPrefabs()).toContain('box')
  })

  it('hot reloads builtin prefabs and invalidates registered assets', () => {
    prefabSystem.hotReloadBuiltinPrefabs()
    expect(AssetRegistry.listRegisteredAssets()).toEqual([{ key: 'test_asset' }])
    expect(AssetRegistry.invalidateAsset).toHaveBeenCalledWith('test_asset')
  })

  it('attaches a client and forwards update to the object factory', () => {
    const client = { id: 'client-1' }
    prefabSystem.attachClient(client as any)
    expect(objectCreator.attachClient).toHaveBeenCalledWith(client)

    prefabSystem.update(0.42)
    expect(objectCreator.update).toHaveBeenCalledWith(0.42)
  })

  it('reports debug state with registered prefabs and runtime flags', () => {
    prefabSystem.registerPrefab('box', {
      name: 'Box',
      entityType: 'box',
      networked: true,
    })

    const debugState = prefabSystem.getDebugState()
    expect(debugState.metrics.registeredPrefabs).toBe(1)
    expect(debugState.metrics.liveInstances).toBe(0)
    expect(debugState.metrics.hasSystemContext).toBe(false)
  })

  it('finds legacy grunt entity replacements when the replacement prefab exists', () => {
    prefabSystem.registerPrefab('universal_dummy', {
      name: 'universal_dummy',
      entityType: 'dummy',
      networked: true,
    })

    expect(prefabSystem.findPrefabNameByEntityType('legacy_grunt_enemy')).toBe('universal_dummy')
  })

  it('createByEntityType returns null for legacy grunt entity types and emits stale drop event', () => {
    const staleSpy = vi.fn()
    gameBus.on('STALE_SNAPSHOT_ENTITY_DROPPED', staleSpy)

    expect(prefabSystem.createByEntityType('some_grunt_asset', { x: 0, y: 0, z: 0 })).toBeNull()
    expect(staleSpy).toHaveBeenCalledOnce()
  })

  it('validateAllPrefabs returns issues for invalid prefabs and persists validation state', () => {
    prefabSystem.registerPrefab('bad-collider', {
      name: 'bad-collider',
      entityType: 'bad',
      networked: true,
      collider: { shape: 'triangle' as any, size: {} },
    })

    const result = prefabSystem.validateAllPrefabs()
    expect(result['bad-collider']).toContain('Unsupported collider shape: triangle')
    expect(stateManager.set).toHaveBeenCalledWith('prefabRegistryValidation', expect.any(Object))
  })

  it('rebuildFromEntityManager restores prefab instances from existing entities', () => {
    const existingEntity = {
      id: 'ent2',
      getComponent: vi.fn(() => ({ data: { prefabName: 'box' } })),
      getPosition: vi.fn(() => ({ x: 7, y: 8, z: 9 })),
    }
    entityManager.getEntities.mockReturnValueOnce([existingEntity])
    prefabSystem.rebuildFromEntityManager()

    expect(prefabSystem.remove('ent2')).toBe(true)
    expect(objectCreator.remove).toHaveBeenCalledWith('ent2')
  })

  it('getPrefab returns a deep clone so callers cannot mutate internal state', () => {
    prefabSystem.registerPrefab('box', {
      name: 'Box',
      entityType: 'box',
      networked: true,
    })

    const prefab = prefabSystem.getPrefab('box')!
    prefab.color = 0x123456

    expect(prefabSystem.getPrefab('box')?.color).not.toBe(0x123456)
  })
})

