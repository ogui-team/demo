import { gameBus } from '../../client/src/engine/core/EventBus'
import { LifetimeScript, ScriptingSystem, SpinScript } from '../../client/src/engine/core/ScriptingSystem'

describe('ScriptingSystem', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    emitSpy = vi.spyOn(gameBus, 'emit')
    emitSpy.mockClear()
  })

  it('attaches a script, updates state, and dispatches events', () => {
    const scripting = new ScriptingSystem()
    const api = {
      spawnObject: vi.fn(() => 'spawned'),
      getTransform: vi.fn(() => ({ position: { x: 0, y: 0, z: 0 } })),
      sendEvent: vi.fn(),
      playAudio: vi.fn(),
    }
    scripting.setAPI(api)

    const instanceId = scripting.attach('obj1', {
      onSpawn(scriptApi) {
        scriptApi.setState('counter', 1)
      },
      onUpdate(scriptApi, dt) {
        scriptApi.setState('counter', (scriptApi.getState('counter') as number) + dt)
      },
      onHit(scriptApi, data) {
        scriptApi.setState('hit', data)
      },
      onDestroy(scriptApi) {
        scriptApi.setState('destroyed', true)
      },
    })

    expect(instanceId).toMatch(/^si_\d+$/)
    scripting.update(0.5)
    scripting.dispatch('obj1', 'onHit', { damage: 10 })
    scripting.detach(instanceId)

    const debugState = scripting.getDebugState()
    expect(debugState.metrics.instanceCount).toBe(0)
    expect(emitSpy).toHaveBeenCalledWith('stateMutation', expect.objectContaining({ source: 'scriptingSystem', path: 'scripts.events.onHit' }))
  })

  it('registers and attaches templates by ID', () => {
    const scripting = new ScriptingSystem()
    scripting.setAPI({ spawnObject: vi.fn(), getTransform: vi.fn(), sendEvent: vi.fn(), playAudio: vi.fn() })

    scripting.registerTemplate('lifetime', LifetimeScript(1))
    expect(scripting.listTemplates()).toContain('lifetime')

    const instanceId = scripting.attachByTemplateId('obj2', 'lifetime')
    expect(instanceId).toMatch(/^si_\d+$/)
  })

  it('uses built-in spin script to update state each frame', () => {
    const scripting = new ScriptingSystem()
    scripting.setAPI({ spawnObject: vi.fn(), getTransform: vi.fn(), sendEvent: vi.fn(), playAudio: vi.fn() })

    const instanceId = scripting.attach('obj3', SpinScript(2))
    scripting.update(0.1)

    expect(scripting.getDebugState().metrics.instanceCount).toBe(1)
    scripting.detach(instanceId)
  })
})
