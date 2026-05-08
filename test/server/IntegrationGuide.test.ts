import { GHOST_GEOMETRY_TOOLKIT, getIntegrationSteps } from '../../server/src/diagnostics/INTEGRATION_GUIDE'

describe('INTEGRATION_GUIDE', () => {
  it('exports the ghost geometry toolkit and integration steps', () => {
    expect(GHOST_GEOMETRY_TOOLKIT).toHaveProperty('WorldIntegrityValidator.ts')
    expect(GHOST_GEOMETRY_TOOLKIT).toHaveProperty('GhostGeometryDiagnostic.ts')
    expect(GHOST_GEOMETRY_TOOLKIT).toHaveProperty('PhysicsDebugVisualizer.ts')

    const steps = getIntegrationSteps()
    expect(Array.isArray(steps)).toBe(true)
    expect(steps[0]).toContain('Import analyzeGhostGeometry')
    expect(steps).toEqual(expect.arrayContaining([expect.stringContaining('PhysicsDebugVisualizer')]))
  })
})
