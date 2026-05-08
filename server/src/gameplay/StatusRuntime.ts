import { type Vec3 } from '../sessionContracts';
import {
  type PlayerDebugStatusOverride,
  type PlayerMovementStatus,
  type PlayerStatusMovementModifier,
} from '../rules/AbilityRules';

const DEFAULT_DEBUG_CHILLED_SPEED_MULTIPLIER = 0.5;

export interface StatusTrackedPlayer {
  rotation: Vec3;
  activeMovementStatuses?: PlayerMovementStatus[];
  statusMovementModifier?: PlayerStatusMovementModifier | null;
  debugStatusOverride?: PlayerDebugStatusOverride | null;
}

export function refreshPlayerStatusMovementModifier(player: StatusTrackedPlayer, now: number): boolean {
  const activeStatuses = (player.activeMovementStatuses ?? []).filter((status) => status.expiresAt > now);
  const statusesChanged = activeStatuses.length !== (player.activeMovementStatuses ?? []).length;
  player.activeMovementStatuses = activeStatuses;

  const nextModifier = buildStatusMovementModifier(player);
  if (!statusesChanged && statusMovementModifiersEqual(player.statusMovementModifier ?? null, nextModifier)) {
    return false;
  }

  player.statusMovementModifier = nextModifier;
  return true;
}

export function buildStatusMovementModifier(
  player: Pick<StatusTrackedPlayer, 'activeMovementStatuses' | 'debugStatusOverride' | 'rotation'>,
): PlayerStatusMovementModifier | null {
  let blockMovement = false;
  let speedMultiplier = 1;
  let impulseOverride: Vec3 | undefined;

  for (const status of player.activeMovementStatuses ?? []) {
    switch (status.statusId) {
      case 'status_rooted':
        blockMovement = true;
        speedMultiplier = 0;
        break;
      case 'status_chilled':
        speedMultiplier = Math.min(speedMultiplier, 0.5);
        break;
      case 'status_electrocuted':
        blockMovement = true;
        speedMultiplier = 0;
        break;
      default:
        break;
    }
  }

  const debugOverride = player.debugStatusOverride;
  if (debugOverride) {
    if (debugOverride.rooted) {
      blockMovement = true;
      speedMultiplier = 0;
    }
    if (debugOverride.chilled) {
      const chilledSpeedMultiplier = Number.isFinite(debugOverride.speedMultiplier)
        ? debugOverride.speedMultiplier
        : DEFAULT_DEBUG_CHILLED_SPEED_MULTIPLIER;
      speedMultiplier = Math.min(speedMultiplier, chilledSpeedMultiplier);
    }
    if (debugOverride.electrocuted) {
      blockMovement = true;
      speedMultiplier = 0;
      if (debugOverride.impulseMagnitude > 0) {
        impulseOverride = {
          x: Math.sin(player.rotation.y) * debugOverride.impulseMagnitude,
          y: 0,
          z: Math.cos(player.rotation.y) * debugOverride.impulseMagnitude,
        };
      }
    }
  }

  if (!blockMovement && speedMultiplier >= 0.999 && !impulseOverride) {
    return null;
  }

  return {
    blockMovement: blockMovement || undefined,
    speedMultiplier,
    impulseOverride,
  };
}

export function buildDebugStatusOverride(
  data: Record<string, unknown>,
  readFiniteNumber: (value: unknown) => number | undefined,
  clamp01: (value: number) => number,
): PlayerDebugStatusOverride | null {
  const rooted = !!data.rooted;
  const chilled = !!data.chilled;
  const electrocuted = !!data.electrocuted;
  if (!rooted && !chilled && !electrocuted) {
    return null;
  }

  return {
    rooted,
    chilled,
    electrocuted,
    speedMultiplier: clamp01(readFiniteNumber(data.speedMultiplier) ?? DEFAULT_DEBUG_CHILLED_SPEED_MULTIPLIER),
    impulseMagnitude: Math.max(0, readFiniteNumber(data.impulseMagnitude) ?? 0),
  };
}

export function cloneStatusMovementModifier(modifier: PlayerStatusMovementModifier): PlayerStatusMovementModifier {
  return {
    speedMultiplier: modifier.speedMultiplier,
    blockMovement: modifier.blockMovement,
    impulseOverride: modifier.impulseOverride ? { ...modifier.impulseOverride } : undefined,
  };
}

export function statusMovementModifiersEqual(
  left: PlayerStatusMovementModifier | null,
  right: PlayerStatusMovementModifier | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftImpulse = left.impulseOverride;
  const rightImpulse = right.impulseOverride;
  return left.speedMultiplier === right.speedMultiplier
    && left.blockMovement === right.blockMovement
    && ((!leftImpulse && !rightImpulse)
      || (!!leftImpulse && !!rightImpulse
        && leftImpulse.x === rightImpulse.x
        && leftImpulse.y === rightImpulse.y
        && leftImpulse.z === rightImpulse.z));
}