import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockRegisterSystem = vi.fn()
const mockRegisterSystemMetadata = vi.fn()

vi.mock('@engine/core/public-api', () => ({
  registerSystem: mockRegisterSystem,
  registerSystemMetadata: mockRegisterSystemMetadata,
}))

describe('RuntimeCapabilityAudit', () => {
  const originalEnv = process.env.DEBUG_ENGINE_AUDIT

  beforeEach(() => {
    vi.resetModules()
    mockRegisterSystem.mockClear()
    mockRegisterSystemMetadata.mockClear()
    process.env.DEBUG_ENGINE_AUDIT = 'true'
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: {
          totalSystems: 2,
          systemsWithIssues: 1,
          missingReplication: 0,
          missingEventBus: 0,
          missingDebugIntegration: 0,
          declaredDetectedMismatches: 0,
          directCouplingViolations: 0,
          systemsUsingSystemContext: 3,
          systemsUsingNetworkFacade: 4,
          averageHealthScore: 88,
        },
      }),
    }) as any
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DEBUG_ENGINE_AUDIT
    } else {
      process.env.DEBUG_ENGINE_AUDIT = originalEnv
    }
    vi.resetAllMocks()
    delete (globalThis as any).fetch
  })

  it('registers the audit system when DEBUG_ENGINE_AUDIT is enabled', async () => {
    const { runRuntimeCapabilityAuditHook } = await import('../../client/src/engine/audit/RuntimeCapabilityAudit')
    runRuntimeCapabilityAuditHook()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRegisterSystem).toHaveBeenCalledTimes(1)
    expect(mockRegisterSystemMetadata).toHaveBeenCalledTimes(1)

    const registeredSystem = mockRegisterSystem.mock.calls[0][1] as any
    expect(registeredSystem.getDiagnostics()).toMatchObject({
      enabled: true,
      reportLoaded: true,
      totalSystems: 2,
      systemsWithIssues: 1,
      systemsUsingSystemContext: 3,
      systemsUsingNetworkFacade: 4,
      averageHealthScore: 88,
      lastError: null,
    })

    runRuntimeCapabilityAuditHook()
    expect(mockRegisterSystem).toHaveBeenCalledTimes(1)
  })

  it('does nothing when DEBUG_ENGINE_AUDIT is not set', async () => {
    process.env.DEBUG_ENGINE_AUDIT = ''
    const { runRuntimeCapabilityAuditHook } = await import('../../client/src/engine/audit/RuntimeCapabilityAudit')
    runRuntimeCapabilityAuditHook()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRegisterSystem).not.toHaveBeenCalled()
    expect(mockRegisterSystemMetadata).not.toHaveBeenCalled()
  })
})
