import { EngineDiagnostics } from '../../client/src/engine/core/EngineDiagnostics'

describe('EngineDiagnostics', () => {
  it('computes diagnostics from renderer and entity manager', () => {
    const renderer = { info: { render: { calls: 12 } } } as any
    const entityManager = { getEntityCount: () => 7 } as any
    const diagnostics = new EngineDiagnostics(renderer, entityManager)

    diagnostics.update(0.6)
    const stats = diagnostics.getDiagnostics()

    expect(stats.fps).toBeGreaterThanOrEqual(0)
    expect(stats.entityCount).toBe(7)
    expect(stats.drawCalls).toBe(12)
    expect(stats.activeSystems).toEqual(expect.any(Array))
  })
})
