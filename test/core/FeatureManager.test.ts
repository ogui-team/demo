import { FeatureManager, FEATURE_META } from '../../client/src/engine/core/FeatureManager'
import { gameBus } from '../../client/src/engine/core/EventBus'

describe('FeatureManager', () => {
  beforeEach(() => {
    FeatureManager.reset()
    localStorage.clear()
    gameBus.clear()
    vi.restoreAllMocks()
  })

  it('defaults to engine feature config and metadata is available', () => {
    expect(FeatureManager.isEnabled('enemyAI')).toBe(true)
    expect(FeatureManager.isEnabled('audio')).toBe(false)
    expect(FEATURE_META.weapons.label).toBe('Weapons')
    expect(FEATURE_META.fog.hotkey).toBe('f')
  })

  it('toggles a feature and notifies subscribers', () => {
    const featureSpy = vi.fn()
    const anySpy = vi.fn()

    const unsub = FeatureManager.onChanged('fog', featureSpy)
    const anyUnsub = FeatureManager.onAnyChanged(anySpy)

    FeatureManager.disable('fog')
    expect(FeatureManager.isEnabled('fog')).toBe(false)
    expect(featureSpy).toHaveBeenCalledWith(false, 'fog')
    expect(anySpy).toHaveBeenCalledWith(false, 'fog')

    unsub()
    anyUnsub()

    FeatureManager.enable('fog')
    expect(featureSpy).toHaveBeenCalledTimes(1)
    expect(anySpy).toHaveBeenCalledTimes(1)
  })

  it('configures partial settings and emits only changed keys', () => {
    const changed = vi.fn()
    FeatureManager.onAnyChanged(changed)

    FeatureManager.configure({ audio: true, fog: true })
    expect(FeatureManager.isEnabled('audio')).toBe(true)
    expect(FeatureManager.isEnabled('fog')).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledWith(true, 'audio')
  })

  it('persists and loads feature state from localStorage', () => {
    localStorage.setItem('engine_features', JSON.stringify({ multiplayer: true, audio: true }))
    FeatureManager.load()

    expect(FeatureManager.isEnabled('multiplayer')).toBe(true)
    expect(FeatureManager.isEnabled('audio')).toBe(true)
  })

  it('ignores malformed persisted config and does not throw', () => {
    localStorage.setItem('engine_features', 'not-json')
    expect(() => FeatureManager.load()).not.toThrow()
  })

  it('reports debug state with system context and subscriber metrics', () => {
    FeatureManager.init({} as any)
    const debugState = FeatureManager.getDebugState()

    expect(debugState.status).toBe('active')
    expect(debugState.metrics.hasSystemContext).toBe(true)
    expect(debugState.metrics.totalFeatures).toBe(Object.keys(FEATURE_META).length)
  })

  it('does not emit change events for unchanged configure values', () => {
    const changed = vi.fn()
    FeatureManager.onAnyChanged(changed)

    FeatureManager.configure({ enemyAI: true })
    expect(changed).not.toHaveBeenCalled()
  })

  it('allows unsubscribing from feature change listeners', () => {
    const featureSpy = vi.fn()
    const anySpy = vi.fn()

    const unsub = FeatureManager.onChanged('fog', featureSpy)
    const anyUnsub = FeatureManager.onAnyChanged(anySpy)
    unsub()
    anyUnsub()

    FeatureManager.disable('fog')
    expect(featureSpy).not.toHaveBeenCalled()
    expect(anySpy).not.toHaveBeenCalled()
  })

  it('reports capabilities after initializing system context', () => {
    FeatureManager.setSystemContext({} as any)
    const capabilities = FeatureManager.getCapabilities()

    expect(capabilities.usesSystemContext).toBe(true)
    expect(capabilities.usesEventBus).toBe(true)
    expect(capabilities.exposesDebug).toBe(true)
  })

  it('reset returns features to default state', () => {
    FeatureManager.disable('enemyAI')
    expect(FeatureManager.isEnabled('enemyAI')).toBe(false)

    FeatureManager.reset()
    expect(FeatureManager.isEnabled('enemyAI')).toBe(true)
  })

  it('toggles a feature state and returns the next value', () => {
    expect(FeatureManager.toggle('fog')).toBe(false)
    expect(FeatureManager.isEnabled('fog')).toBe(false)
    expect(FeatureManager.toggle('fog')).toBe(true)
  })

  it('save ignores localStorage failure and does not throw', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    expect(() => FeatureManager.save()).not.toThrow()
    spy.mockRestore()
  })

  it('onEnterEditor and onEnterPlay re-emits current state', () => {
    const anySpy = vi.fn()
    FeatureManager.onAnyChanged(anySpy)

    FeatureManager.onEnterEditor()
    FeatureManager.onEnterPlay()

    expect(anySpy).toHaveBeenCalled()
  })
})
