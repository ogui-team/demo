import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../client/src/engine/foundation/Engine', () => ({
  getEntityManager: vi.fn(() => ({
    getEntity: vi.fn(() => null),
    destroyEntity: vi.fn(() => true),
  })),
  getEntityRenderer: vi.fn(() => ({
    syncEntity: vi.fn(),
  })),
}))

import { EditorAuthorityCoordinator } from '../../../../client/src/engine/runtime/EditorAuthorityCoordinator'

describe('EditorAuthorityCoordinator', () => {
  let prefabSystem: any
  let spawnSystem: any
  let mpClient: any
  let undoRedoSystem: any
  let saveLoadManager: any
  let worldRuntime: any
  let worldObjectAuthorityService: any
  let editorMenu: any
  let gizmoSystem: any
  let coordinator: EditorAuthorityCoordinator

  beforeEach(() => {
    vi.clearAllMocks()

    prefabSystem = {
      listPrefabs: vi.fn(() => ['foo_pickup', 'bar_tree']),
      getPrefab: vi.fn((prefabName: string) => {
        return {
          entityType: prefabName,
          tags: prefabName.includes('tree') ? ['prop'] : ['pickup'],
          color: 0x112233,
          assetKey: prefabName.includes('tree') ? 'treeAsset' : undefined,
          minSpacing: 2,
        }
      }),
    }

    spawnSystem = {
      spawnPrefab: vi.fn(),
    }

    mpClient = {
      connected: false,
      sendWorldObjectPlace: vi.fn(),
      sendWorldObjectUpdate: vi.fn(),
    }

    undoRedoSystem = {
      pushCompletedAction: vi.fn(),
    }

    saveLoadManager = {
      serializeWorld: vi.fn(() => 'initial-snapshot'),
      deserializeWorld: vi.fn(),
    }

    worldRuntime = {
      restoreRuntimeSnapshot: vi.fn((_snapshot: unknown, callback: () => void) => {
        callback()
      }),
      isEditorEditableEntity: vi.fn(() => false),
    }

    worldObjectAuthorityService = {
      sendPlacedEntity: vi.fn(),
      trackLocalPlacement: vi.fn(),
      sendRemovedAuthority: vi.fn(),
      syncAuthorityTransformForEntity: vi.fn(),
    }

    editorMenu = {
      setSpawnLibrary: vi.fn(),
      refreshSelectedEntity: vi.fn(),
      setOnSpawnRequested: vi.fn(),
      setOnEntityRemoveRequest: vi.fn(),
      setOnEntityPlaced: vi.fn(),
      setOnEntityRemoved: vi.fn(),
      setOnTransformApplied: vi.fn(),
    }

    gizmoSystem = {
      setOnEntityTransformCommitted: vi.fn(),
    }

    coordinator = new EditorAuthorityCoordinator({
      prefabSystem,
      spawnSystem,
      mpClient,
      undoRedoSystem,
      saveLoadManager,
      worldObjectAuthorityService,
      worldRuntime,
      editorMenu,
      gizmoSystem,
    })
  })

  it('syncEditorPrefabLibrary registers prefab entries and spawns prefabs', () => {
    coordinator.syncEditorPrefabLibrary()

    expect(editorMenu.setSpawnLibrary).toHaveBeenCalledTimes(1)
    const spawnLibrary = editorMenu.setSpawnLibrary.mock.calls[0][0]
    expect(spawnLibrary).toHaveLength(2)
    expect(spawnLibrary[0]).toMatchObject({ id: 'foo_pickup', category: 'Pickups' })

    spawnLibrary[0].spawn({ x: 1, y: 2, z: 3 })
    expect(spawnSystem.spawnPrefab).toHaveBeenCalledWith('foo_pickup', expect.objectContaining({ position: { x: 1, y: 2, z: 3 } }))
    expect(spawnLibrary[0].buildSpawnRequest({ x: 5, y: 6, z: 7 })).toMatchObject({
      entityType: 'foo_pickup',
      position: { x: 5, y: 6, z: 7 },
      rotation: { x: 0, y: 0, z: 0 },
    })
  })

  it('setLastEditorSnapshot updates snapshot and refreshes the prefab library', () => {
    coordinator.setLastEditorSnapshot('new-snapshot')

    expect(editorMenu.setSpawnLibrary).toHaveBeenCalledTimes(1)
    expect(coordinator.getLastEditorSnapshot()).toBe('new-snapshot')
  })

  it('wire registers spawn request callback that only sends when connected', () => {
    coordinator.wire()

    expect(editorMenu.setOnSpawnRequested).toHaveBeenCalledTimes(1)
    const spawnHandler = editorMenu.setOnSpawnRequested.mock.calls[0][0]

    mpClient.connected = false
    expect(spawnHandler({
      entityType: 'foo_pickup',
      position: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      renderData: { meshType: 'box', color: 0xffffff, geometry: { width: 1, height: 1, depth: 1 } },
    })).toBe(false)

    mpClient.connected = true
    expect(spawnHandler({
      entityType: 'foo_pickup',
      position: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      renderData: { meshType: 'box', color: 0xffffff, geometry: { width: 1, height: 1, depth: 1 } },
    })).toBe(true)
    expect(mpClient.sendWorldObjectPlace).toHaveBeenCalledTimes(1)
    expect(mpClient.sendWorldObjectPlace).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'foo_pickup',
      position: { x: 1, y: 1, z: 1 },
    }))
  })
})
