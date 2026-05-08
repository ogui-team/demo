/**
 * UNIFIED PHYSICS CONSTANTS
 *
 * Single source of truth for all physics values.
 * Used by both CLIENT (prediction) and SERVER (authority).
 *
 * CRITICAL: Any change here must maintain client-server parity!
 */
export declare const PHYSICS_CONSTANTS: {
    readonly PLAYER_MOVE_SPEED: 6;
    readonly PLAYER_MOVE_ACCELERATION: 28;
    readonly PLAYER_DECELERATION: 28;
    readonly PLAYER_FRICTION: 0;
    readonly PLAYER_GRAVITY: 9.8;
    readonly PLAYER_JUMP_IMPULSE: 3.8;
    readonly PLAYER_JUMP_BUFFER_SECONDS: 0.12;
    readonly PLAYER_COYOTE_TIME_SECONDS: 0.09;
    readonly PLAYER_COLLISION_RADIUS: 0.8;
    readonly PLAYER_EYE_HEIGHT: 1.65;
    readonly PLAYER_CROUCH_HALF_HEIGHT: 0.9;
    readonly PLAYER_CROUCH_SPEED_MULTIPLIER: 0.5;
    readonly PLAYER_AIR_CONTROL_FACTOR: 0.45;
    readonly SHIELD_DASH_HORIZONTAL_IMPULSE: 10;
    readonly GROUND_DETECTION_THRESHOLD: 0.01;
    readonly CLIENT_POSITION_ERROR_DECAY_MS: 100;
    readonly CLIENT_POSITION_ERROR_DECAY_FACTOR: 0.1;
    readonly CLIENT_POSITION_ERROR_MAX_DRIFT_PER_FRAME: 0.1;
    readonly CLIENT_CORRECTION_THRESHOLD: 0.05;
    readonly CLIENT_LOCAL_VELOCITY_STOP_THRESHOLD: 0.001;
    readonly CLIENT_RECONCILIATION_LERP_FACTOR: 0.35;
    readonly CLIENT_DESYNC_WARNING_DISTANCE: 0.35;
    readonly CLIENT_DESYNC_WARNING_STREAK: 8;
};
export type PhysicsConstantsType = typeof PHYSICS_CONSTANTS;
/**
 * Validate constants are reasonable
 */
export declare function validatePhysicsConstants(): void;
//# sourceMappingURL=PhysicsConstants.d.ts.map