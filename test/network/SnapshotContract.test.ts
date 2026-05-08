import {
  SNAPSHOT_DELTA_MODE,
  SNAPSHOT_SCHEMA_VERSION,
  isSupportedSnapshotSchema,
} from '../../client/src/engine/network/SnapshotContract'

describe('SnapshotContract', () => {
  it('exposes snapshot schema version and delta mode constants', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(2)
    expect(SNAPSHOT_DELTA_MODE).toBe('sparse-entity-delta-v1')
  })

  it('validates supported schema versions accurately', () => {
    expect(isSupportedSnapshotSchema(2)).toBe(true)
    expect(isSupportedSnapshotSchema(1)).toBe(false)
    expect(isSupportedSnapshotSchema(undefined)).toBe(false)
  })
})
