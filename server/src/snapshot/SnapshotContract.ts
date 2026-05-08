export const SNAPSHOT_SCHEMA_VERSION = 2;
export const SNAPSHOT_DELTA_MODE = 'sparse-entity-delta-v1' as const;

export interface SnapshotProtocolHandshake {
  snapshotSchemaVersion: number;
}
