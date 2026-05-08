
const mocks = vi.hoisted(() => ({
  gameBusEmit: vi.fn(),
  normalizeAvatarAppearance: vi.fn(() => ({ skin: 'default' })),
}))

vi.mock('@engine/core/public-api', () => ({
  gameBus: {
    emit: mocks.gameBusEmit,
  },
}))

vi.mock('../../../client/src/engine/gameplay/game/AvatarBuilder', () => ({
  normalizeAvatarAppearance: mocks.normalizeAvatarAppearance,
}))

import { hydrateStateManager, getSchemaDefault, SCHEMA_PATHS, StateHydrationGuard, STATE_LOADING } from '../../../client/src/engine/foundation/state/hydrateStateManager'
import { StateManager } from '../../../client/src/engine/foundation/state/StateManager'

describe('hydrateStateManager', () => {
  beforeEach(() => {
    mocks.gameBusEmit.mockClear()
    mocks.normalizeAvatarAppearance.mockClear()
  })

  it('returns schema defaults for known paths and false for unknown paths', () => {
    const known = getSchemaDefault(SCHEMA_PATHS.CAMERA_FOV)
    const unknown = getSchemaDefault('does.not.exist')

    expect(known.found).toBe(true)
    expect(typeof known.value).toBe('number')
    expect(unknown.found).toBe(false)
    expect(unknown.value).toBeUndefined()
  })

  it('hydrates missing state paths and emits hydration completion', () => {
    const stateManager = new StateManager({})

    hydrateStateManager(stateManager)

    expect(stateManager.isHydrated).toBe(true)
    expect(stateManager.get('camera.fov')).toBe(75)
    expect(mocks.gameBusEmit).toHaveBeenCalledWith('STATE_HYDRATION_COMPLETE', expect.objectContaining({ source: 'hydrateStateManager', filledCount: expect.any(Number) }))
    expect(mocks.normalizeAvatarAppearance).toHaveBeenCalledTimes(2)
  })

  it('skips hydration if the manager is already hydrated', () => {
    const stateManager = new StateManager({})
    stateManager.markHydrated()

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    hydrateStateManager(stateManager)

    expect(warnSpy).toHaveBeenCalled()
    expect(mocks.gameBusEmit).not.toHaveBeenCalledWith('STATE_HYDRATION_COMPLETE', expect.anything())

    warnSpy.mockRestore()
  })

  it('preserves existing provided values and fills missing schema defaults', () => {
    const stateManager = new StateManager({ camera: { fov: 35 } })

    hydrateStateManager(stateManager)

    expect(stateManager.get('camera.fov')).toBe(35)
    expect(stateManager.get('camera.position')).toEqual({ x: 0, y: 5, z: 10 })
    expect(stateManager.isHydrated).toBe(true)
  })

  it('returns STATE_LOADING before hydration and emits UI_LOADING_STATE', () => {
    const stateManager = new StateManager({})
    const guard = new StateHydrationGuard(stateManager)

    const result = guard.read(SCHEMA_PATHS.CAMERA_FOV)

    expect(result).toBe(STATE_LOADING)
    expect(mocks.gameBusEmit).toHaveBeenCalledWith('UI_LOADING_STATE', expect.objectContaining({ reason: 'STATE_NOT_HYDRATED' }))
  })

  it('returns schema defaults after hydration for missing paths', () => {
    const stateManager = new StateManager({})
    const guard = new StateHydrationGuard(stateManager)

    hydrateStateManager(stateManager)

    const value = guard.read(SCHEMA_PATHS.CAMERA_FOV)
    expect(value).toBe(75)
  })
})
