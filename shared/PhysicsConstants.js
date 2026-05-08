"use strict";
/**
 * UNIFIED PHYSICS CONSTANTS
 *
 * Single source of truth for all physics values.
 * Used by both CLIENT (prediction) and SERVER (authority).
 *
 * CRITICAL: Any change here must maintain client-server parity!
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePhysicsConstants = exports.PHYSICS_CONSTANTS = void 0;
exports.PHYSICS_CONSTANTS = {
    // ─ PLAYER MOVEMENT ─
    PLAYER_MOVE_SPEED: 6,
    PLAYER_MOVE_ACCELERATION: 28,
    PLAYER_DECELERATION: 28,
    PLAYER_FRICTION: 0,
    // ─ PLAYER GRAVITY & JUMPING ─
    PLAYER_GRAVITY: 9.8,
    PLAYER_JUMP_IMPULSE: 3.8,
    PLAYER_JUMP_BUFFER_SECONDS: 0.12,
    PLAYER_COYOTE_TIME_SECONDS: 0.09,
    // ─ PLAYER PHYSICS PROPERTIES ─
    PLAYER_COLLISION_RADIUS: 0.8,
    PLAYER_EYE_HEIGHT: 1.65,
    PLAYER_CROUCH_HALF_HEIGHT: 0.9,
    PLAYER_CROUCH_SPEED_MULTIPLIER: 0.5,
    // ─ AIR CONTROL ─
    PLAYER_AIR_CONTROL_FACTOR: 0.45,
    // ─ ABILITY IMPULSES ─
    SHIELD_DASH_HORIZONTAL_IMPULSE: 10,
    // ─ GROUND DETECTION ─
    GROUND_DETECTION_THRESHOLD: 0.01,
    // ─ CLIENT-SIDE RECONCILIATION ─
    // These are client-only for prediction smoothing (not gameplay-critical)
    CLIENT_POSITION_ERROR_DECAY_MS: 100,
    CLIENT_POSITION_ERROR_DECAY_FACTOR: 0.1,
    CLIENT_POSITION_ERROR_MAX_DRIFT_PER_FRAME: 0.1,
    CLIENT_CORRECTION_THRESHOLD: 0.05,
    CLIENT_LOCAL_VELOCITY_STOP_THRESHOLD: 0.001,
    CLIENT_RECONCILIATION_LERP_FACTOR: 0.35,
    CLIENT_DESYNC_WARNING_DISTANCE: 0.35,
    CLIENT_DESYNC_WARNING_STREAK: 8, // frames before warning triggers
};
/**
 * Validate constants are reasonable
 */
function validatePhysicsConstants() {
    const c = exports.PHYSICS_CONSTANTS;
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
exports.validatePhysicsConstants = validatePhysicsConstants;
//# sourceMappingURL=PhysicsConstants.js.map