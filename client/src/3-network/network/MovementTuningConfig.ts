import { PHYSICS_CONSTANTS } from '../../PhysicsConstants';

export interface MovementTuningConfig {
  acceleration: number;
  deceleration: number;
  maxSpeed: number;
  airControl: number;
  friction: number;
  jumpImpulse: number;
  gravityScale: number;
}

export interface MovementFeelDebugConfig {
  speedMultiplier: number;
  accelerationMultiplier: number;
  frictionMultiplier: number;
  floatiness: number;
  airControlEnabled: boolean;
}

export interface ResolvedMovementTuningConfig extends MovementTuningConfig {
  speedMultiplier: number;
  accelerationMultiplier: number;
  frictionMultiplier: number;
  floatiness: number;
  airControlEnabled: boolean;
}

export const DEFAULT_MOVEMENT_TUNING_CONFIG: Readonly<MovementTuningConfig> = Object.freeze({
  acceleration: PHYSICS_CONSTANTS.PLAYER_MOVE_ACCELERATION,
  deceleration: PHYSICS_CONSTANTS.PLAYER_DECELERATION,
  maxSpeed: PHYSICS_CONSTANTS.PLAYER_MOVE_SPEED,
  airControl: PHYSICS_CONSTANTS.PLAYER_AIR_CONTROL_FACTOR, // FIX: Was 0.35, now 0.45 (matches server)
  friction: PHYSICS_CONSTANTS.PLAYER_FRICTION,
  jumpImpulse: PHYSICS_CONSTANTS.PLAYER_JUMP_IMPULSE, // CRITICAL FIX: Was 8, now 3.8 (matches server!)
  gravityScale: 1, // Multiplier: applies PLAYER_GRAVITY * 1 = 9.8
});

export const DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG: Readonly<MovementFeelDebugConfig> = Object.freeze({
  speedMultiplier: 1,
  accelerationMultiplier: 1,
  frictionMultiplier: 1,
  floatiness: 0,
  airControlEnabled: true,
});

export const MOVEMENT_FEEL_DEBUG_LIMITS = Object.freeze({
  speedMultiplier: { min: 0.5, max: 1.6, step: 0.05 },
  accelerationMultiplier: { min: 0.5, max: 2.0, step: 0.05 },
  frictionMultiplier: { min: 0.25, max: 2.0, step: 0.05 },
  floatiness: { min: 0, max: 1, step: 0.05 },
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeMovementFeelDebugConfig(config: MovementFeelDebugConfig): MovementFeelDebugConfig {
  return {
    speedMultiplier: clamp(config.speedMultiplier, MOVEMENT_FEEL_DEBUG_LIMITS.speedMultiplier.min, MOVEMENT_FEEL_DEBUG_LIMITS.speedMultiplier.max),
    accelerationMultiplier: clamp(config.accelerationMultiplier, MOVEMENT_FEEL_DEBUG_LIMITS.accelerationMultiplier.min, MOVEMENT_FEEL_DEBUG_LIMITS.accelerationMultiplier.max),
    frictionMultiplier: clamp(config.frictionMultiplier, MOVEMENT_FEEL_DEBUG_LIMITS.frictionMultiplier.min, MOVEMENT_FEEL_DEBUG_LIMITS.frictionMultiplier.max),
    floatiness: clamp(config.floatiness, MOVEMENT_FEEL_DEBUG_LIMITS.floatiness.min, MOVEMENT_FEEL_DEBUG_LIMITS.floatiness.max),
    airControlEnabled: config.airControlEnabled !== false,
  };
}

export function hasMovementFeelDebugOverride(config: MovementFeelDebugConfig): boolean {
  return config.speedMultiplier !== DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.speedMultiplier
    || config.accelerationMultiplier !== DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.accelerationMultiplier
    || config.frictionMultiplier !== DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.frictionMultiplier
    || config.floatiness !== DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.floatiness
    || config.airControlEnabled !== DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG.airControlEnabled;
}

export function createResolvedMovementTuningConfig(): ResolvedMovementTuningConfig {
  return {
    ...DEFAULT_MOVEMENT_TUNING_CONFIG,
    ...DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG,
  };
}

export function applyMovementFeelDebugConfig(
  base: MovementTuningConfig,
  debug: MovementFeelDebugConfig,
  target: ResolvedMovementTuningConfig,
): ResolvedMovementTuningConfig {
  const sanitized = sanitizeMovementFeelDebugConfig(debug);
  const floatinessDecelerationScale = Math.max(0.2, 1 - sanitized.floatiness * 0.4);
  const frictionOffset = Math.max(0, (sanitized.frictionMultiplier - 1) * 8 + sanitized.floatiness * 2.5);

  target.acceleration = base.acceleration * sanitized.accelerationMultiplier;
  target.deceleration = base.deceleration * sanitized.accelerationMultiplier * floatinessDecelerationScale;
  target.maxSpeed = base.maxSpeed * sanitized.speedMultiplier;
  target.airControl = sanitized.airControlEnabled
    ? Math.min(1, base.airControl + sanitized.floatiness * 0.25)
    : 0;
  target.friction = Math.max(0, base.friction + frictionOffset);
  target.jumpImpulse = base.jumpImpulse * (1 + sanitized.floatiness * 0.2);
  target.gravityScale = base.gravityScale * Math.max(0.35, 1 - sanitized.floatiness * 0.45);
  target.speedMultiplier = sanitized.speedMultiplier;
  target.accelerationMultiplier = sanitized.accelerationMultiplier;
  target.frictionMultiplier = sanitized.frictionMultiplier;
  target.floatiness = sanitized.floatiness;
  target.airControlEnabled = sanitized.airControlEnabled;
  return target;
}