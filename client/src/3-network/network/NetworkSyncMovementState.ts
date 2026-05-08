import { PHYSICS_CONSTANTS } from '../../PhysicsConstants';
import type { MovementRuntimeState } from './NetworkMovementPrediction';
import type { NetworkReplicatedEntityState } from './NetworkRuntimeContracts';

const MOVEMENT_COYOTE_TIME_SECONDS = PHYSICS_CONSTANTS.PLAYER_COYOTE_TIME_SECONDS;

export function applyAuthoritativeMovementState(
  runtime: MovementRuntimeState,
  authoritative: NetworkReplicatedEntityState,
  currentPosition: { x: number; y: number; z: number },
): void {
  const movementState = authoritative.replicated?.movementState;
  if (movementState && typeof movementState === 'object') {
    const raw = movementState as { isCrouching?: unknown; isAirborne?: unknown; isGrounded?: unknown };
    if (typeof raw.isCrouching === 'boolean') {
      runtime.isCrouching = raw.isCrouching;
    }
    if (typeof raw.isGrounded === 'boolean') {
      runtime.isAirborne = !raw.isGrounded;
      if (raw.isGrounded) {
        runtime.groundHeight = authoritative.transform?.position.y ?? currentPosition.y;
        runtime.coyoteTimeRemaining = MOVEMENT_COYOTE_TIME_SECONDS;
        if (runtime.velocity.y < 0) {
          runtime.velocity.y = 0;
        }
      } else if (authoritative.transform) {
        runtime.groundHeight = Math.min(
          runtime.groundHeight,
          authoritative.transform.position.y - (PHYSICS_CONSTANTS.GROUND_DETECTION_THRESHOLD + 0.01),
        );
      }
    }
    if (typeof raw.isAirborne === 'boolean') {
      runtime.isAirborne = raw.isAirborne;
      if (raw.isAirborne && authoritative.transform) {
        runtime.groundHeight = Math.min(
          runtime.groundHeight,
          authoritative.transform.position.y - (PHYSICS_CONSTANTS.GROUND_DETECTION_THRESHOLD + 0.01),
        );
      }
    }
  }

  if (currentPosition.y <= runtime.groundHeight + PHYSICS_CONSTANTS.GROUND_DETECTION_THRESHOLD && runtime.velocity.y <= 0) {
    runtime.groundHeight = currentPosition.y;
    runtime.coyoteTimeRemaining = MOVEMENT_COYOTE_TIME_SECONDS;
  }
}
