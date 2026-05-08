import type { Vector3 } from '@engine/1-kernel/core/public-api';

export interface StatusMovementModifier {
  /**
   * Index signature required so instances of this interface are assignable to
   * `Record<string, unknown>` — used by `DebugOverlay.formatStatusModifier()`
   * and any generic state-serialisation path that accepts `Record<string, unknown>`.
   * All named properties below are subtypes of `unknown`, so there is no conflict.
   */
  [key: string]: unknown;
  speedMultiplier?: number;
  blockMovement?: boolean;
  impulseOverride?: Vector3;
}