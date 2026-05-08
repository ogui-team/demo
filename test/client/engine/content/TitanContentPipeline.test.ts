import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@engine/1-kernel/core/public-api', () => ({
  gameBus: {
    emit: vi.fn(),
  },
}))

import { TitanContentPipeline } from '../../../../client/src/4-runtime/content/TitanContentPipeline'
import { clearRegistry, getAsset, listRuntimeAssets, registerAsset } from '../../../../client/src/2-systems/gameplay/systems/AssetRegistry'

const prefabDefinition = {
  entityType: 'tree_oak',
  assetKey: 'tree_oak',
  color: 0x88aa44,
  pickup: false,
}

describe('TitanContentPipeline', () => {
  const editorMenu = { setSpawnLibrary: vi.fn() }
  const prefabSystem = {
    listPrefabs: vi.fn(() => ['tree_oak']),
    getPrefab: vi.fn((name: string) => (name === 'tree_oak' ? prefabDefinition : null)),
    remove: vi.fn(),
  }
  const spawnSystem = {
    spawnPrefab: vi.fn((prefabId: string) => ({ id: `spawned-${prefabId}`, prefabId })),
  }
  const saveLoadManager = {
    serializeWorld: vi.fn(() => ({ settings: { difficulty: 'easy' }, engineState: { version: '1.0' }, systemData: {} })),
    loadMap: vi.fn(() => ({ success: true, entitiesCreated: 0, settingsApplied: 0 })),
    listMaps: vi.fn(() => ['legacy-map']),
    deleteMap: vi.fn(() => false),
    exportMap: vi.fn(() => '{