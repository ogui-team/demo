import { PHYSICS_CONSTANTS } from '../../PhysicsConstants';

const POSITION_ERROR_DECAY_MS = PHYSICS_CONSTANTS.CLIENT_POSITION_ERROR_DECAY_MS;
const POSITION_ERROR_DECAY_FACTOR = PHYSICS_CONSTANTS.CLIENT_POSITION_ERROR_DECAY_FACTOR;

export function applyPositionErrorDecay(context: any, dt: number): void {
  if (!context.visualCorrectionEnabled) {
    return;
  }

  const dtMs = dt * 1000;

  context.movementState.forEach((runtime: any, playerId: string) => {
    if (runtime.positionErrorDecayRemaining <= 0) {
      return;
    }

    runtime.positionErrorDecayRemaining -= dtMs;

    const maxPositionDriftPerFrame = 0.1;
    const currentErrorMagnitude = Math.hypot(
      runtime.positionError.x,
      Math.hypot(runtime.positionError.y, runtime.positionError.z),
    );

    const decayAmount = POSITION_ERROR_DECAY_FACTOR;
    const correction = {
      x: runtime.positionError.x * decayAmount,
      y: runtime.positionError.y * decayAmount,
      z: runtime.positionError.z * decayAmount,
    };

    const correctionMagnitude = Math.hypot(
      correction.x,
      Math.hypot(correction.y, correction.z),
    );

    if (correctionMagnitude > maxPositionDriftPerFrame) {
      const scale = maxPositionDriftPerFrame / correctionMagnitude;
      correction.x *= scale;
      correction.y *= scale;
      correction.z *= scale;
    }

    runtime.positionError.x -= correction.x;
    runtime.positionError.y -= correction.y;
    runtime.positionError.z -= correction.z;

    const binding = context.bindings.get(playerId);
    if (!binding) {
      runtime.positionErrorDecayRemaining = 0;
      return;
    }

    const currentPos = binding.entity.getPosition();
    const correctedPos = {
      x: currentPos.x + correction.x,
      y: currentPos.y + correction.y,
      z: currentPos.z + correction.z,
    };

    const errorMagnitude = Math.hypot(
      runtime.positionError.x,
      runtime.positionError.y,
      runtime.positionError.z,
    );

    if (errorMagnitude > 0.00001) {
      binding.entity.setPosition(correctedPos);
    }

    if (runtime.positionErrorDecayRemaining <= 0) {
      runtime.positionError = { x: 0, y: 0, z: 0 };
      runtime.positionErrorDecayRemaining = 0;
    }
  });
}
