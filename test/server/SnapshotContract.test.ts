import { SNAPSHOT_SCHEMA_VERSION, SNAPSHOT_DELTA_MODE } from '../../server/src/snapshot/SnapshotContract'

describe('SnapshotContract', () => {
  it('exports snapshot version and delta mode constants', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(2)
    expect(SNAPSHOT_DELTA_MODE).toBe('sparse-entity-delta-v1')
  })
})
