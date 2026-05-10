/**
 * Shared snapshot protocol contracts — canonical version constants and
 * handshake interfaces used by both client and server. Modifying
 * SNAPSHOT_SCHEMA_VERSION will affect CRC32 determinism validation.
 */

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
