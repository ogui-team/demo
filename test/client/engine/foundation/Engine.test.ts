import { beforeEach, describe, expect, it, vi } from 'vitest'

const engineImportPath = '../../../../client/src/engine/foundation/Engine'

describe('Engine foundation helpers', () => {
  let consoleError: ReturnType<typeof vi.spyOn>
  let consoleWarn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('returns default config and applies updates', async () => {
    const Engine = await import(engineImportPath)

    const original = Engine.getConfig()
    expect(original.fogDensity).toBe(0.08)
    expect(original.fogColor).toBe(0x1a1a1a)

    Engine.setConfig({ fogDensity: 0.25, ambientLightIntensity: 0.8 })
    const updated = Engine.getConfig()
    expect(updated.fogDensity).toBe(0.25)
    expect(updated.ambientLightIntensity).toBe(0.8)
  })

  it('toggles graphics pipeline mode as expected', async () => {
    const Engine = await import(engineImportPath)

    expect(Engine.getGraphicsPipeline()).toBe('PS1')

    Engine.toggleGraphicsPipeline()
    expect(Engine.getGraphicsPipeline()).toBe('CrunchyModern')

    Engine.setGraphicsPipeline(false)
    expect(Engine.getGraphicsPipeline()).toBe('PS1')
  })

  it('fails engine state operations when state manager is unavailable', async () => {
    const Engine = await import(engineImportPath)

    expect(Engine.getEngineState('test.path')).toBeNull()
    expect(Engine.setEngineState('test.path', 123)).toBe(false)
    expect(Engine.updateEngineState({ foo: 'bar' })).toEqual({})

    const unsubscribe = Engine.subscribeToEngineState('test.path', () => {})
    expect(typeof unsubscribe).toBe('function')
    expect(consoleError).toHaveBeenCalled()
  })

  it('reports failed app state transitions when EngineController is missing', async () => {
    const Engine = await import(engineImportPath)

    expect(Engine.transitionAppState('play')).toBe(false)
    expect(consoleError).toHaveBeenCalledWith('[Engine] EngineController not initialised')
  })

  it('warns when creating a local player entity without an entity manager', async () => {
    const Engine = await import(engineImportPath)

    Engine.createLocalPlayerEntity(0xff00ff)
    expect(consoleWarn).toHaveBeenCalledWith('[Engine] EntityManager not available')
  })

  it('returns safe defaults when SaveLoadManager is not initialized', async () => {
    const Engine = await import(engineImportPath)

    expect(Engine.saveMap('test')).toBe(false)
    expect(Engine.loadMap('missing')).toEqual({ success: false, entitiesCreated: 0, settingsApplied: 0 })
    expect(Engine.listMaps()).toEqual([])
    expect(Engine.deleteMap('missing')).toBe(false)
    expect(Engine.exportMap('missing')).toBe('')
    expect(Engine.importMap('{}')).toEqual({ success: false, entitiesCreated: 0, settingsApplied: 0 })
    expect(Engine.getMapInfo('missing')).toBeNull()
    expect(consoleWarn).toHaveBeenCalled()
  })
})
