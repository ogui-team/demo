import { SaveLoadManager } from '../../client/src/engine/core/SaveLoadManager'

describe('SaveLoadManager', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  function makeEntityManager() {
    return {
      serialize: () => [
        {
          id: 'e1',
          type: 'actor',
          active: true,
          transform: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          components: { health: { name: 'health', data: { hp: 100 } } },
        },
      ],
      clear: () => undefined,
      deserialize: (_entities: unknown[]) => undefined,
      getEntities: () => [{ id: 'e1' }],
    } as any
  }

  function makeStateManager() {
    let state = {
      mode: 'editor',
      fog: { density: 0.1, color: 123, enabled: true },
      lighting: { ambientIntensity: 0.5, directionalIntensity: 0.7 },
      camera: { position: { x: 0, y: 1, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, fov: 60 },
      atmosphericEffects: { fogPulsing: true, lightingFlicker: true, postProcessing: true, cameraEffects: true },
    }
    return {
      getState: () => state,
      snapshot: () => state,
      reset: (initialState: Record<string, any>) => { state = initialState },
      update: (updates: Record<string, unknown>) => updates as Record<string, boolean>,
    } as any
  }

  it('serializes world state and can save/load maps', () => {
    const manager = new SaveLoadManager(makeEntityManager(), makeStateManager(), null, { enableLogging: false })
    const saved = manager.serializeWorld()

    expect(saved.version).toBe('2.0')
    expect(saved.entities).toHaveLength(1)
    expect(saved.settings.mode).toBe('editor')

    expect(manager.saveMap('test-world')).toBe(true)
    expect(localStorage.getItem('world_test-world')).not.toBeNull()

    const result = manager.loadMap('test-world')
    expect(result.success).toBe(true)
    expect(result.entitiesCreated).toBe(1)
    expect(result.settingsApplied).toBeGreaterThan(0)
    expect(manager.listMaps()).toContain('test-world')
    expect(manager.deleteMap('test-world')).toBe(true)
  })

  it('returns failure when loading a missing map', () => {
    const manager = new SaveLoadManager(makeEntityManager(), makeStateManager(), null, { enableLogging: false })
    const result = manager.loadMap('missing')
    expect(result.success).toBe(false)
    expect(result.entitiesCreated).toBe(0)
  })
})
