export {
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_DELTA_MODE,
} from '@shared/contracts';
export type {
  SnapshotProtocolHandshake,
  SnapshotEnvelopeContract,
} from '@shared/contracts';

import { SNAPSHOT_SCHEMA_VERSION } from '@shared/contracts';

export function isSupportedSnapshotSchema(version: number | undefined): boolean {
  return version === SNAPSHOT_SCHEMA_VERSION;
}
