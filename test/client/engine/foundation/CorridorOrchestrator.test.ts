import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@engine/core/public-api', () => ({
  getSystem: vi.fn(() => null),
  getSystemStateSnapshot: vi.fn((id: string) => ({ snapshotId: id })),
  listSystems: vi.fn(() => []),
  markSystemError: vi.fn(),
  registerSystem: vi.fn(),
  bindSystemContext: vi.fn(),
  createNetworkFacade: vi.fn(() => ({})),
  createReplicationFacade: vi.fn(() => ({})),
  createSystemAccessProxy: vi.fn(() => ({})),
}))

vi.mock('../../../../client/src/engine/diagnostics/debug/SystemValidator', () => ({
  validateEngineRuntime: vi.fn((deps: any) => ({ status: 'ok', checked: Object.keys(deps) })),
}))

vi.mock('../../../../client/src/engine/audit/RuntimeCapabilityAudit', () => ({
  runRuntimeCapabilityAuditHook: vi.fn(),
}))

describe('CorridorOrchestrator', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('creates an audit aligned manifest and applies overrides', async () => {
    const { createAuditAlignedManifest } = await import('../../../../client/src/engine/foundation/CorridorOrchestrator')

    const entries = createAuditAlignedManifest({
      engine: {},
      entityManager: {},
    }, {
      engine: { enabled: true, order: 5 },
      entityManager: { enabled: false },
    })

    const engineEntry = entries.find((entry) => entry.id === 'engine')
    const entityEntry = entries.find((entry) => entry.id === 'entityManager')

    expect(engineEntry?.enabled).toBe(true)
    expect(engineEntry?.order).toBe(5)
    expect(entityEntry?.enabled).toBe(false)
    expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'engine' })]))
  })

  it('orchestrates a manifest and records missing dependencies without strict mode', async () => {
    const { orchestrateCorridorManifest } = await import('../../../../client/src/engine/foundation/CorridorOrchestrator')
    const publicApi = await import('@engine/core/public-api')
    const mockedGetSystem = vi.mocked(publicApi.getSystem)
    const mockedListSystems = vi.mocked(publicApi.listSystems)
    const mockedRegisterSystem = vi.mocked(publicApi.registerSystem)

    mockedGetSystem.mockImplementation((name: string) => (name === 'dependencyA' ? {} : null))
    mockedListSystems.mockReturnValue([])

    const manifest = [
      {
        id: 'testSystem',
        system: { init: vi.fn() },
        order: 1,
        dependencies: ['dependencyA', 'dependencyB'],
      },
    ]

    const result = orchestrateCorridorManifest({
      manifest,
      contextDeps: {
        eventBus: {},
        entityManager: null,
        networkManager: null,
        networkSyncSystem: null,
        replicationSystem: null,
        multiplayerClient: null,
        resourceManager: null,
        resolveSystem: mockedGetSystem,
      },
      systemContext: {},
      strictDependencies: false,
    })

    expect(mockedRegisterSystem).toHaveBeenCalledWith('testSystem', manifest[0].system, expect.any(Object))
    expect(result.missingDependencies).toEqual({ testSystem: ['dependencyB'] })
    expect(result.failedIds).toEqual([])
    expect(result.skippedIds).toEqual([])
    expect(result.registrySnapshots).toEqual({ testSystem: { snapshotId: 'testSystem' } })
  })

  it('fails strict dependency validation and skips init for missing dependencies', async () => {
    const { orchestrateCorridorManifest } = await import('../../../../client/src/engine/foundation/CorridorOrchestrator')
    const publicApi = await import('@engine/core/public-api')
    const mockedGetSystem = vi.mocked(publicApi.getSystem)
    const mockedListSystems = vi.mocked(publicApi.listSystems)
    const mockedMarkSystemError = vi.mocked(publicApi.markSystemError)

    mockedGetSystem.mockReturnValue(null)
    mockedListSystems.mockReturnValue([])

    const manifest = [
      {
        id: 'strictSystem',
        system: { init: vi.fn() },
        order: 1,
        dependencies: ['absentDependency'],
      },
    ]

    const result = orchestrateCorridorManifest({
      manifest,
      contextDeps: {
        eventBus: {},
        entityManager: null,
        networkManager: null,
        networkSyncSystem: null,
        replicationSystem: null,
        multiplayerClient: null,
        resourceManager: null,
        resolveSystem: mockedGetSystem,
      },
      systemContext: {},
      strictDependencies: true,
    })

    expect(result.failedIds).toContain('strictSystem')
    expect(mockedMarkSystemError).toHaveBeenCalled()
    expect(result.skippedIds).toEqual([])
  })

  it('runs engine audit placeholder and runtime hook correctly', async () => {
    const { runEngineAuditPlaceholder } = await import('../../../../client/src/engine/foundation/CorridorOrchestrator')
    const mockedRunRuntimeCapabilityAuditHook = vi.mocked((await import('../../../../client/src/engine/audit/RuntimeCapabilityAudit')).runRuntimeCapabilityAuditHook)
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    runEngineAuditPlaceholder({ enableRuntimeHook: true })
    expect(mockedRunRuntimeCapabilityAuditHook).toHaveBeenCalled()

    runEngineAuditPlaceholder({ command: 'custom', reportPath: 'customPath' })
    expect(consoleInfo).toHaveBeenCalledWith(
      '[CorridorOrchestrator] Audit placeholder: run "custom" and inspect "customPath" for the latest capability snapshot.',
    )
  })
})
