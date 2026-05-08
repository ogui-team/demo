import {
  validateServerWorldIntegrity,
  generateWorldIntegrityDiagnostic,
  findOrphanedEntities,
} from '../../server/src/diagnostics/WorldIntegrityValidator'

describe('WorldIntegrityValidator', () => {
  const boxA = {
    id: 'box-a',
    position: { x: 1, y: 2, z: 3 },
    halfExtents: { x: 1, y: 1, z: 1 },
  }
  const boxB = {
    id: 'box-b',
    position: { x: 4, y: 5, z: 6 },
    halfExtents: { x: 2, y: 2, z: 2 },
  }

  it('returns no issues when all boxes are replicated', () => {
    const report = validateServerWorldIntegrity([boxA, boxB], new Set(['box-a', 'box-b']))

    expect(report.serverStaticColliders).toBe(2)
    expect(report.clientReplicatedEntities).toBe(2)
    expect(report.unreplicatedStaticColliders).toHaveLength(0)
    expect(report.issues).toHaveLength(0)
  })

  it('reports ghost colliders and logs an error when a box is missing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const report = validateServerWorldIntegrity([boxA, boxB], new Set(['box-a']))

    expect(report.unreplicatedStaticColliders).toEqual([boxB])
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0]).toContain('box-b')
    expect(spy).toHaveBeenCalled()

    spy.mockRestore()
  })

  it('finds orphaned entities by missing networkEntityId and unsupported type', () => {
    const result = findOrphanedEntities(
      [
        { id: 'ent-1', networkEntityId: 'n1', type: 'static_collider' },
        { id: 'ent-2' },
        { id: 'ent-3', networkEntityId: 'n3', type: 'unknown_type' },
      ],
      new Set(['static_collider']),
    )

    expect(result).toEqual([
      { id: 'ent-2', reason: 'Missing networkEntityId - will not be sent to client' },
      { id: 'ent-3', reason: 'Entity type "unknown_type" not in allowed replication list' },
    ])
  })

  it('returns no issues and does not log when all entities are replicated', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const report = validateServerWorldIntegrity([boxA, boxB], new Set(['box-a', 'box-b']))

    expect(report.issues).toHaveLength(0)
    expect(spy).not.toHaveBeenCalled()

    spy.mockRestore()
  })

  it('generates a diagnostic string with no issues and counts only', () => {
    const report = {
      timestamp: 1672531200000,
      serverStaticColliders: 2,
      serverDynamicColliders: 0,
      clientReplicatedEntities: 2,
      unreplicatedStaticColliders: [],
      orphanedEntities: [],
      issues: [],
    }

    const diagnostic = generateWorldIntegrityDiagnostic(report)

    expect(diagnostic).toContain('=== WORLD INTEGRITY DIAGNOSTIC ===')
    expect(diagnostic).toContain('Timestamp: 2023-01-01T00:00:00.000Z')
    expect(diagnostic).toContain('Static Colliders: 2')
    expect(diagnostic).toContain('Dynamic Colliders: 0')
    expect(diagnostic).toContain('Replicated Entities: 2')
    expect(diagnostic).toContain('✓ No issues detected')
    expect(diagnostic).not.toContain('UNREPLICATED STATIC COLLIDERS')
    expect(diagnostic).not.toContain('ORPHANED ENTITIES')
  })

  it('generates a diagnostic string with issues, unreplicated static colliders, and orphaned entities', () => {
    const report = {
      timestamp: 1672531200000,
      serverStaticColliders: 2,
      serverDynamicColliders: 0,
      clientReplicatedEntities: 1,
      unreplicatedStaticColliders: [boxB],
      orphanedEntities: [
        { id: 'ent-2', reason: 'Missing networkEntityId - will not be sent to client' },
      ],
      issues: ['GHOST COLLIDER: Static collision box "box-b" exists on server but NOT in client snapshots'],
    }

    const diagnostic = generateWorldIntegrityDiagnostic(report)

    expect(diagnostic).toContain('ISSUES FOUND:')
    expect(diagnostic).toContain('✗ GHOST COLLIDER: Static collision box "box-b" exists on server but NOT in client snapshots')
    expect(diagnostic).toContain('UNREPLICATED STATIC COLLIDERS (GHOST GEOMETRY):')
    expect(diagnostic).toContain(' - box-b @ (4.00, 5.00, 6.00)')
    expect(diagnostic).toContain('ORPHANED ENTITIES:')
    expect(diagnostic).toContain(' - ent-2: Missing networkEntityId - will not be sent to client')
  })

  it('does not mark entities with allowed replication type as orphaned', () => {
    const result = findOrphanedEntities(
      [{ id: 'ent-4', networkEntityId: 'n4', type: 'static_collider' }],
      new Set(['static_collider']),
    )

    expect(result).toHaveLength(0)
  })
})
