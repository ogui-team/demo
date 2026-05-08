export const SNAPSHOT_SCHEMA_VERSION = 2;
export const SNAPSHOT_DELTA_MODE = 'sparse-entity-delta-v1' as const;

export interface SnapshotProtocolHandshake {
  snapshotSchemaVersion: number;
}

export interface SnapshotEnvelopeContract {
  schemaVersion: number;
  deltaMode: typeof SNAPSHOT_DELTA_MODE;
  tick: number;
  ack: number;
  timestamp: number;
  entities: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}

export function isSupportedSnapshotSchema(version: number | undefined): boolean {
  return version === SNAPSHOT_SCHEMA_VERSION;
}
