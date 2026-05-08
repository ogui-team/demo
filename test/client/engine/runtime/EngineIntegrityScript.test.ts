import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@engine/core/public-api', () => ({
  gameBus: { emit: vi.fn() },
  listSystems: vi.fn(),
}))

import {
  EngineIntegrityValidator,
  initializeEngineIntegrityValidation,
  getEngineIntegrityReport,
} from '../../../../client/src/engine/runtime/EngineIntegrityScript'

describe('EngineIntegrityValidator', () => {
  let engineApi: Awaited<ReturnType<typeof vi.importMock>>

  beforeEach(async () => {
    vi.clearAllMocks()
    engineApi = await vi.importMock('@engine/core/public-api')
  })

  it('passes when systems implement update and valid status', () => {
    engineApi.listSystems.mockReturnValue([
      {
        name: 'GoodSystem',
        system: { update: vi.fn() },
        metadata: { info: 'ok' },
        status: 'active',
      },
    ])

    const validator = new EngineIntegrityValidator()
    const report = validator.validate()

    expect(report.totalSystems).toBe(1)
    expect(report.passed).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.warnings).toHaveLength(0)
    expect(report.details[0]).toMatchObject({
      systemName: 'GoodSystem',
      status: 'PASS',
      interfacesImplemented: expect.arrayContaining(['ISystem.update()', 'SystemDebugMetadata']),
    })
  })

  it('fails when system status is invalid and warns when update is missing', () => {
    engineApi.listSystems.mockReturnValue([
      {
        name: 'BadSystem',
        system: {},
        metadata: null,
        status: 'unknown',
      },
    ])

    const validator = new EngineIntegrityValidator()
    const report = validator.validate()

    expect(report.totalSystems).toBe(1)
    expect(report.passed).toBe(0)
    expect(report.failed).toBe(1)
    expect(report.errors[0]).toContain('Invalid system status: unknown')
    expect(report.details[0].status).toBe('FAIL')
  })

  it('initializes global validation and emits a stateMutation event', () => {
    engineApi.listSystems.mockReturnValue([])

    initializeEngineIntegrityValidation()

    expect(engineApi.gameBus.emit).toHaveBeenCalledWith('stateMutation', expect.objectContaining({
      source: 'engineIntegrityValidator',
      path: 'engine.integrity',
    }))
    const globalReport = getEngineIntegrityReport()
    expect(globalReport).not.toBeNull()
    expect(globalReport?.totalSystems).toBe(0)
  })
})
