import { SnapshotVisibilityDebugger } from '../../client/src/engine/network/SnapshotVisibilityDebugger'

describe('SnapshotVisibilityDebugger', () => {
  const entityRegistry = {
    getHandleByNetworkId: vi.fn((id: string | number) => (id === 'known' ? 12 : null)),
  }
  const meshBindingTable = {
    getMeshForHandle: vi.fn((handle: number) => (handle === 12 ? { name: 'avatar_mesh' } : null)),
  }

  it('audits snapshot with mapped and missing entities correctly', () => {
    const debuggerInstance = new SnapshotVisibilityDebugger(entityRegistry as any, meshBindingTable as any, false)
    const snapshot = {
      entities: [
        { networkEntityId: 'known', position: { x: 0, y: 0, z: 0 } },
        { networkEntityId: 'missing', position: { x: 1, y: 0, z: 0 } },
      ],
    }

    const report = debuggerInstance.auditSnapshot(snapshot as any)
    expect(report.receivedEntityCount).toBe(2)
    expect(report.mappedSuccessfully).toBe(1)
    expect(report.mappingMissing).toBe(1)
    expect(report.meshBindingFound).toBe(1)
    expect(debuggerInstance.hasMissingMappings()).toBe(true)
    expect(debuggerInstance.getLastReport()).toEqual(report)
  })

  it('prints reports safely when no report exists or after audit', () => {
    const debuggerInstance = new SnapshotVisibilityDebugger(entityRegistry as any, meshBindingTable as any, false)
    debuggerInstance.printReport(null as any)
    const snapshot = { entities: [] }
    const report = debuggerInstance.auditSnapshot(snapshot as any)
    debuggerInstance.printReport(report)
    expect(report.receivedEntityCount).toBe(0)
  })
})
