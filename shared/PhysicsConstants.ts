/**
 * UNIFIED PHYSICS CONSTANTS
 * 
 * Single source of truth for all physics values.
 * Used by both CLIENT (prediction) and SERVER (authority).
 * 
 * CRITICAL: Any change here must maintain client-server parity!
 */

export const PHYSICS_CONSTANTS = {
  // ─ PLAYER MOVEMENT ─
  PLAYER_MOVE_SPEED: 6, // units/sec - max horizontal speed
  PLAYER_MOVE_ACCELERATION: 28, // units/sec² - horizontal acceleration
  PLAYER_DECELERATION: 28, // units/sec² - deceleration when no input
  PLAYER_FRICTION: 0, // friction multiplier (0 = no friction)
  
  // ─ PLAYER GRAVITY & JUMPING ─
  PLAYER_GRAVITY: 9.8, // units/sec² - downward acceleration
  PLAYER_JUMP_IMPULSE: 3.8, // units/sec - jump velocity applied
  PLAYER_JUMP_BUFFER_SECONDS: 0.12, // 120ms - grace window for buffered jumps
  PLAYER_COYOTE_TIME_SECONDS: 0.09, // 90ms - grace time after leaving ground
  
  // ─ PLAYER PHYSICS PROPERTIES ─
  PLAYER_COLLISION_RADIUS: 0.8, // units - collision sphere radius
  PLAYER_EYE_HEIGHT: 1.65, // units - standing camera height (not crouch)
  PLAYER_CROUCH_HALF_HEIGHT: 0.9, // units - crouch capsule half-height
  PLAYER_CROUCH_SPEED_MULTIPLIER: 0.5, // 50% speed when crouching
  
  // ─ AIR CONTROL ─
  PLAYER_AIR_CONTROL_FACTOR: 0.45, // 45% movement control while airborne
  
  // ─ ABILITY IMPULSES ─
  SHIELD_DASH_HORIZONTAL_IMPULSE: 10, // units/sec - shield dash velocity
  
  // ─ GROUND DETECTION ─
  GROUND_DETECTION_THRESHOLD: 0.01, // units - epsilon for ground raycast
  
  // ─ CLIENT-SIDE RECONCILIATION ─
  // These are client-only for prediction smoothing (not gameplay-critical)
  CLIENT_POSITION_ERROR_DECAY_MS: 100, // milliseconds - decay window
  CLIENT_POSITION_ERROR_DECAY_FACTOR: 0.1, // exponential falloff per frame
  CLIENT_POSITION_ERROR_MAX_DRIFT_PER_FRAME: 0.1, // 10cm max drift
  CLIENT_CORRECTION_THRESHOLD: 0.05, // 5cm minimum to trigger correction
  CLIENT_LOCAL_VELOCITY_STOP_THRESHOLD: 0.001, // velocity near-zero threshold
  CLIENT_RECONCILIATION_LERP_FACTOR: 0.35, // blend factor for corrections
  CLIENT_DESYNC_WARNING_DISTANCE: 0.35, // 35cm before warning
  CLIENT_DESYNC_WARNING_STREAK: 8, // frames before warning triggers
} as const;

export type PhysicsConstantsType = typeof PHYSICS_CONSTANTS;

/**
 * Validate constants are reasonable
 */
export function validatePhysicsConstants(): void {
  const c = PHYSICS_CONSTANTS;
  
  // Jump should be positive and reasonable
  if (c.PLAYER_JUMP_IMPULSE <= 0 || c.PLAYER_JUMP_IMPULSE > 50) {
    throw new Error(`Invalid PLAYER_JUMP_IMPULSE: ${c.PLAYER_JUMP_IMPULSE}`);
  }
  
  // Gravity should be positive
  if (c.PLAYER_GRAVITY <= 0) {
    throw new Error(`Invalid PLAYER_GRAVITY: ${c.PLAYER_GRAVITY}`);
  }
  
  // Speed should be reasonable
  if (c.PLAYER_MOVE_SPEED <= 0 || c.PLAYER_MOVE_SPEED > 100) {
    throw new Error(`Invalid PLAYER_MOVE_SPEED: ${c.PLAYER_MOVE_SPEED}`);
  }
  
  // Air control between 0 and 1
  if (c.PLAYER_AIR_CONTROL_FACTOR < 0 || c.PLAYER_AIR_CONTROL_FACTOR > 1) {
    throw new Error(`Invalid PLAYER_AIR_CONTROL_FACTOR: ${c.PLAYER_AIR_CONTROL_FACTOR}`);
  }
}
