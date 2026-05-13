import { PHYSICS_CONSTANTS } from '../../PhysicsConstants';
import { Entity, Vector3 } from '../../1-kernel/core/Entity';
import type { MovementFeelDebugConfig, MovementTuningConfig, ResolvedMovementTuningConfig } from './MovementTuningConfig';
import {
  applyMovementFeelDebugConfig,
  DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG,
  DEFAULT_MOVEMENT_TUNING_CONFIG,
} from './MovementTuningConfig';
import type { StatusMovementModifier } from './MovementModifierContracts';

export interface MovementRuntimeState {
  velocity: Vector3;
  lastCorrectionDistance: number;
  lastCorrectionTick: number;
  sustainedHighDriftFrames: number;
  groundHeight: number;
  isAirborne: boolean;
  isCrouching: boolean;
  jumpRequested: boolean;
  sprintRequested: boolean;
  airControlEnabled: boolean;
  jumpBufferRemaining: number;
  coyoteTimeRemaining: number;
  lastJumpImpulse: number;
  positionError: Vector3;
  positionErrorDecayRemaining: number;
  lastReconciliationTime: number;
}

export interface MovementCollisionContext {
  entity: Entity;
  currentPosition: Vector3;
  desiredMovement: Vector3;
  input: Record<string, unknown>;
  dt: number;
  radius: number;
  height: number;
}

export interface MovementBinding {
  playerId: string;
  entity: Entity;
  movementSpeed?: number;
  acceleration?: number;
  collisionRadius?: number;
}

export interface MovementIntent {
  horizontalImpulse: number;
  direction: Vector3;
  jump?: boolean;
  crouch?: boolean;
  verticalImpulse?: number;
}

const MOVEMENT_JUMP_BUFFER_SECONDS = PHYSICS_CONSTANTS.PLAYER_JUMP_BUFFER_SECONDS;
const MOVEMENT_COYOTE_TIME_SECONDS = PHYSICS_CONSTANTS.PLAYER_COYOTE_TIME_SECONDS;

export interface SpatialPartitionAdapter {
  updateEntry(id: string, position: Vector3, options?: {
    radius?: number;
    tags?: string[];
    isActive?: boolean;
    lastUsedTime?: number;
  }): void;
}

export interface ApplyInputParams {
  binding: MovementBinding;
  input: Record<string, unknown>;
  dt: number;
  currentTick: number;
  movementState: Map<string, MovementRuntimeState>;
  collisionResolver: ((context: MovementCollisionContext) => Vector3) | null;
  movementFeelDebugConfigs: Map<string, MovementFeelDebugConfig>;
  resolvedMovementTuningScratch: ResolvedMovementTuningConfig;
  pendingMovementIntent: Map<string, MovementIntent>;
  resolveStatusMovementModifier: (playerId: string) => ResolvedStatusMovementModifier;
  localPlayerId: string | null;
  spatialPartition: SpatialPartitionAdapter;
}

export interface ApplyRotationParams {
  binding: MovementBinding;
  input: Record<string, unknown>;
  movementState: Map<string, MovementRuntimeState>;
  currentTick: number;
}

export interface ResolvedStatusMovementModifier {
  speedMultiplier: number;
  blockMovement: boolean;
  impulseOverride: Vector3 | null;
}

export function createMovementRuntimeState(tick: number): MovementRuntimeState {
  return {
    velocity: { x: 0, y: 0, z: 0 },
    lastCorrectionDistance: 0,
    lastCorrectionTick: tick,
    sustainedHighDriftFrames: 0,
    groundHeight: -999,
    isAirborne: false,
    isCrouching: false,
    jumpRequested: false,
    sprintRequested: false,
    airControlEnabled: true,
    jumpBufferRemaining: 0,
    coyoteTimeRemaining: 0,
    lastJumpImpulse: 0,
    positionError: { x: 0, y: 0, z: 0 },
    positionErrorDecayRemaining: 0,
    lastReconciliationTime: Engine.time.now(),
  };
}

export function buildBaseMovementTuning(binding: MovementBinding | undefined): MovementTuningConfig {
  return {
    acceleration: binding?.acceleration ?? DEFAULT_MOVEMENT_TUNING_CONFIG.acceleration,
    deceleration: DEFAULT_MOVEMENT_TUNING_CONFIG.deceleration,
    maxSpeed: binding?.movementSpeed ?? DEFAULT_MOVEMENT_TUNING_CONFIG.maxSpeed,
    airControl: DEFAULT_MOVEMENT_TUNING_CONFIG.airControl,
    friction: DEFAULT_MOVEMENT_TUNING_CONFIG.friction,
    jumpImpulse: DEFAULT_MOVEMENT_TUNING_CONFIG.jumpImpulse,
    gravityScale: DEFAULT_MOVEMENT_TUNING_CONFIG.gravityScale,
  };
}

export function resolveMovementTuning(
  binding: MovementBinding | undefined,
  movementFeelDebugConfigs: Map<string, MovementFeelDebugConfig>,
  scratch: ResolvedMovementTuningConfig,
): ResolvedMovementTuningConfig {
  return applyMovementFeelDebugConfig(
    buildBaseMovementTuning(binding),
    movementFeelDebugConfigs.get(binding?.playerId ?? '') ?? DEFAULT_MOVEMENT_FEEL_DEBUG_CONFIG,
    scratch,
  );
}

export function normalizeStatusMovementModifier(modifier: StatusMovementModifier | null | undefined): StatusMovementModifier | null {
  if (!modifier) return null;

  const normalized: StatusMovementModifier = {};
  if (typeof modifier.speedMultiplier === 'number' && Number.isFinite(modifier.speedMultiplier)) {
    normalized.speedMultiplier = Math.max(0, modifier.speedMultiplier);
  }
  if (modifier.blockMovement === true) {
    normalized.blockMovement = true;
  }

  const impulseOverride = modifier.impulseOverride;
  if (impulseOverride
    && typeof impulseOverride.x === 'number'
    && typeof impulseOverride.y === 'number'
    && typeof impulseOverride.z === 'number') {
    normalized.impulseOverride = {
      x: impulseOverride.x,
      y: impulseOverride.y,
      z: impulseOverride.z,
    };
  }

  return normalized.speedMultiplier !== undefined
    || normalized.blockMovement === true
    || normalized.impulseOverride !== undefined
    ? normalized
    : null;
}

export function parseStatusMovementModifier(raw: unknown): StatusMovementModifier | null {
  if (!raw || typeof raw !== 'object') return null;
  return normalizeStatusMovementModifier(raw as StatusMovementModifier);
}

export function resolveStatusMovementModifier(
  playerId: string,
  statusMovementModifiers: Map<string, StatusMovementModifier>,
  derivedStatusMovementModifiers: Map<string, StatusMovementModifier>,
  debugStatusMovementModifiers: Map<string, StatusMovementModifier>,
): ResolvedStatusMovementModifier {
  const resolved: ResolvedStatusMovementModifier = {
    speedMultiplier: 1,
    blockMovement: false,
    impulseOverride: null,
  };

  mergeResolvedStatusMovementModifier(resolved, statusMovementModifiers.get(playerId));
  mergeResolvedStatusMovementModifier(resolved, derivedStatusMovementModifiers.get(playerId));
  mergeResolvedStatusMovementModifier(resolved, debugStatusMovementModifiers.get(playerId));
  return resolved;
}

export function mergeResolvedStatusMovementModifier(
  target: ResolvedStatusMovementModifier,
  modifier: StatusMovementModifier | undefined,
): void {
  if (!modifier) return;

  if (typeof modifier.speedMultiplier === 'number') {
    target.speedMultiplier = Math.min(target.speedMultiplier, Math.max(0, modifier.speedMultiplier));
  }
  if (modifier.blockMovement === true) {
    target.blockMovement = true;
    target.speedMultiplier = 0;
  }
  if (modifier.impulseOverride) {
    target.impulseOverride = {
      x: modifier.impulseOverride.x,
      y: modifier.impulseOverride.y,
      z: modifier.impulseOverride.z,
    };
  }
}

export function toStatusMovementModifier(resolved: ResolvedStatusMovementModifier): StatusMovementModifier | null {
  if (!resolved.blockMovement && resolved.speedMultiplier >= 0.999 && !resolved.impulseOverride) {
    return null;
  }

  const modifier: StatusMovementModifier = {};
  if (resolved.blockMovement) {
    modifier.blockMovement = true;
  }
  if (resolved.speedMultiplier < 0.999) {
    modifier.speedMultiplier = resolved.speedMultiplier;
  }
  if (resolved.impulseOverride) {
    modifier.impulseOverride = {
      x: resolved.impulseOverride.x,
      y: resolved.impulseOverride.y,
      z: resolved.impulseOverride.z,
    };
  }
  return modifier;
}

export function normalizePlanarIntentDirection(direction: Vector3): Vector3 {
  const length = Math.hypot(direction.x, direction.z);
  if (length <= 0.00001) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: direction.x / length,
    y: 0,
    z: direction.z / length,
  };
}

export function applyInput(params: ApplyInputParams): void {
  const {
    binding,
    input,
    dt,
    currentTick,
    movementState,
    collisionResolver,
    movementFeelDebugConfigs,
    resolvedMovementTuningScratch,
    pendingMovementIntent,
    resolveStatusMovementModifier,
    localPlayerId,
    spatialPartition,
  } = params;

  const runtime = movementState.get(binding.playerId) ?? createMovementRuntimeState(currentTick);
  const currentPosition = binding.entity.getPosition();
  const yaw = typeof input.yaw === 'number' ? input.yaw : binding.entity.getRotation().y;
  const pitch = typeof input.pitch === 'number' ? input.pitch : binding.entity.getRotation().x;
  const tuning = resolveMovementTuning(binding, movementFeelDebugConfigs, resolvedMovementTuningScratch);
  const sprintRequested = input.sprint === true;
  const inlineMovementIntent = readInlineMovementIntent(input);
  const jumpRequested = inlineMovementIntent.jump;
  const crouchRequested = inlineMovementIntent.crouch
    && (!runtime.isAirborne || runtime.velocity.y <= 0 || currentPosition.y <= runtime.groundHeight + 0.05);
  const airControlEnabled = input.airControl !== false;
  const sprintSpeedMultiplier = resolveSprintSpeedMultiplier(sprintRequested);
  const sprintAccelerationMultiplier = resolveSprintAccelerationMultiplier(sprintRequested);
  const crouchSpeedMultiplier = crouchRequested ? 0.5 : 1;
  const speed = tuning.maxSpeed * sprintSpeedMultiplier * crouchSpeedMultiplier;
  const acceleration = tuning.acceleration * sprintAccelerationMultiplier * crouchSpeedMultiplier;
  const jumpPressed = jumpRequested && !runtime.jumpRequested;
  runtime.sprintRequested = sprintRequested;
  runtime.jumpRequested = jumpRequested;
  runtime.airControlEnabled = airControlEnabled;
  runtime.isCrouching = crouchRequested;

  if (runtime.groundHeight < -100) {
    runtime.groundHeight = currentPosition.y;
  }

  if (currentPosition.y <= runtime.groundHeight + PHYSICS_CONSTANTS.GROUND_DETECTION_THRESHOLD && runtime.velocity.y <= 0) {
    runtime.groundHeight = currentPosition.y;
    runtime.velocity.y = 0;
    runtime.isAirborne = false;
    runtime.coyoteTimeRemaining = MOVEMENT_COYOTE_TIME_SECONDS;
  } else {
    runtime.isAirborne = true;
    runtime.coyoteTimeRemaining = Math.max(0, runtime.coyoteTimeRemaining - dt);
  }

  if (jumpPressed) {
    runtime.jumpBufferRemaining = MOVEMENT_JUMP_BUFFER_SECONDS;
  } else {
    runtime.jumpBufferRemaining = Math.max(0, runtime.jumpBufferRemaining - dt);
  }

  let wishVelocity: Vector3 = { x: 0, y: 0, z: 0 };
  if (input.forward) { wishVelocity.x -= Math.sin(yaw) * speed; wishVelocity.z -= Math.cos(yaw) * speed; }
  if (input.backward) { wishVelocity.x += Math.sin(yaw) * speed; wishVelocity.z += Math.cos(yaw) * speed; }
  if (input.left) { wishVelocity.x -= Math.cos(yaw) * speed; wishVelocity.z += Math.sin(yaw) * speed; }
  if (input.right) { wishVelocity.x += Math.cos(yaw) * speed; wishVelocity.z -= Math.sin(yaw) * speed; }
  wishVelocity = clampMagnitude(wishVelocity, speed);

  if (Math.abs(wishVelocity.x) > 0.00001 || Math.abs(wishVelocity.z) > 0.00001) {
    const controlFactor = runtime.isAirborne
      ? (runtime.airControlEnabled ? tuning.airControl : 0)
      : 1;
    const velocityDelta = {
      x: wishVelocity.x - runtime.velocity.x,
      y: 0,
      z: wishVelocity.z - runtime.velocity.z,
    };
    const maxVelocityDelta = acceleration * Math.max(0, controlFactor) * dt;
    const appliedVelocityDelta = clampMagnitude(velocityDelta, maxVelocityDelta);
    const planarVelocity = clampMagnitude({
      x: runtime.velocity.x + appliedVelocityDelta.x,
      y: 0,
      z: runtime.velocity.z + appliedVelocityDelta.z,
    }, speed);
    runtime.velocity = {
      x: planarVelocity.x,
      y: runtime.velocity.y,
      z: planarVelocity.z,
    };
  } else {
    const planarVelocity = applyPlanarDamping(
      runtime.velocity,
      PHYSICS_CONSTANTS.PLAYER_DECELERATION,
      PHYSICS_CONSTANTS.PLAYER_FRICTION,
      dt,
    );

    if (Math.abs(planarVelocity.x) < 0.01 && Math.abs(planarVelocity.z) < 0.01) {
      runtime.velocity.x = 0;
      runtime.velocity.z = 0;
    } else {
      runtime.velocity.x = planarVelocity.x;
      runtime.velocity.z = planarVelocity.z;
    }
  }

  const intent = pendingMovementIntent.get(binding.playerId);
  let jumpImpulse = tuning.jumpImpulse;
  if (intent && (intent.horizontalImpulse > 0 || intent.jump || intent.crouch)) {
    if (intent.horizontalImpulse > 0) {
      const intentDirectionMagnitude = Math.hypot(intent.direction.x, intent.direction.z);
      if (intentDirectionMagnitude > 0.00001) {
        runtime.velocity.x += intent.direction.x * intent.horizontalImpulse;
        runtime.velocity.z += intent.direction.z * intent.horizontalImpulse;
      } else {
        console.warn('[MovementDebug] Ignored queued horizontal impulse with zero planar direction', {
          playerId: binding.playerId,
          intent,
          currentPosition,
        });
      }
    }
    if (intent.jump) {
      runtime.jumpBufferRemaining = MOVEMENT_JUMP_BUFFER_SECONDS;
      jumpImpulse = intent.verticalImpulse ?? tuning.jumpImpulse;
    }
    if (intent.crouch) {
      runtime.isCrouching = true;
    }
    pendingMovementIntent.delete(binding.playerId);
  }

  if (runtime.jumpBufferRemaining > 0 && (!runtime.isAirborne || runtime.coyoteTimeRemaining > 0)) {
    runtime.lastJumpImpulse = jumpImpulse;
    runtime.velocity.y = jumpImpulse;
    runtime.isAirborne = true;
    runtime.jumpBufferRemaining = 0;
    runtime.coyoteTimeRemaining = 0;

    console.log('[JUMP_DEBUG] Jump applied in client prediction', {
      playerId: binding.playerId,
      jumpImpulse,
      positionBefore: {
        x: currentPosition.x.toFixed(2),
        y: currentPosition.y.toFixed(2),
        z: currentPosition.z.toFixed(2),
      },
      velocityAfter: {
        x: runtime.velocity.x.toFixed(2),
        y: runtime.velocity.y.toFixed(2),
        z: runtime.velocity.z.toFixed(2),
      },
      wasAirborne: runtime.isAirborne,
      hadCoyote: runtime.coyoteTimeRemaining > 0,
    });
  }

  if (runtime.isAirborne) {
    runtime.velocity.y -= tuning.gravityScale * PHYSICS_CONSTANTS.PLAYER_GRAVITY * dt;
  }

  const statusMovementModifier = resolveStatusMovementModifier(binding.playerId);
  if (statusMovementModifier.blockMovement) {
    runtime.velocity.x = 0;
    runtime.velocity.z = 0;
  } else if (statusMovementModifier.speedMultiplier < 0.999) {
    runtime.velocity.x *= statusMovementModifier.speedMultiplier;
    runtime.velocity.z *= statusMovementModifier.speedMultiplier;
  }
  if (statusMovementModifier.impulseOverride) {
    runtime.velocity.x = statusMovementModifier.impulseOverride.x;
    runtime.velocity.z = statusMovementModifier.impulseOverride.z;
  }

  let movement: Vector3 = {
    x: runtime.velocity.x * dt,
    y: runtime.velocity.y * dt,
    z: runtime.velocity.z * dt,
  };
  if (collisionResolver) {
    const desiredYBeforeResolver = movement.y;
    movement = collisionResolver({
      entity: binding.entity,
      currentPosition,
      desiredMovement: movement,
      input,
      dt,
      radius: binding.collisionRadius ?? 0.8,
      height: crouchRequested ? 0.9 : 1.6,
    });
    runtime.velocity = dt > 0
      ? { x: movement.x / dt, y: movement.y / dt, z: movement.z / dt }
      : runtime.velocity;

    // Floor detection via collision resolver: if the resolver clamped Y upward
    // (i.e., returned a less-negative delta than requested), the player's feet
    // hit a box surface.  Update groundHeight so the movement system knows where
    // the floor is — critical for elevated spawns and multi-level geometry.
    if (desiredYBeforeResolver < -0.001 && movement.y > desiredYBeforeResolver + 0.001) {
      const detectedGroundY = currentPosition.y + movement.y;
      runtime.groundHeight = detectedGroundY;
      runtime.velocity.y = 0;
      movement.y = 0;
      runtime.isAirborne = false;
      runtime.coyoteTimeRemaining = MOVEMENT_COYOTE_TIME_SECONDS;
    }
  }

  if (!isFiniteVector(movement) || !isFiniteVector(runtime.velocity)) {
    movement = { x: 0, y: 0, z: 0 };
    runtime.velocity = { x: 0, y: 0, z: 0 };
    runtime.jumpBufferRemaining = 0;
    runtime.coyoteTimeRemaining = 0;
    runtime.isAirborne = false;
  }

  const nextPosition: Vector3 = {
    x: currentPosition.x + movement.x,
    y: currentPosition.y + movement.y,
    z: currentPosition.z + movement.z,
  };
  if (!Number.isFinite(nextPosition.x) || !Number.isFinite(nextPosition.y) || !Number.isFinite(nextPosition.z)) {
    nextPosition.x = currentPosition.x;
    nextPosition.y = currentPosition.y;
    nextPosition.z = currentPosition.z;
    runtime.velocity = { x: 0, y: 0, z: 0 };
  }

  if (nextPosition.y <= runtime.groundHeight + PHYSICS_CONSTANTS.GROUND_DETECTION_THRESHOLD) {
    nextPosition.y = runtime.groundHeight;
    if (runtime.velocity.y <= 0) {
      runtime.velocity.y = 0;
      runtime.isAirborne = false;
      runtime.coyoteTimeRemaining = MOVEMENT_COYOTE_TIME_SECONDS;
    }
  } else if (runtime.velocity.y < 0) {
    runtime.isAirborne = true;
  }

  binding.entity.setPosition(nextPosition);
  binding.entity.setRotation({
    ...binding.entity.getRotation(),
    x: pitch,
    y: yaw,
  });

  movementState.set(binding.playerId, runtime);
  spatialPartition.updateEntry(binding.entity.id, binding.entity.getPosition(), {
    radius: binding.collisionRadius ?? 0.8,
    tags: [binding.entity.type, binding.playerId === localPlayerId ? 'local' : 'networked'],
    isActive: binding.entity.isActive,
    lastUsedTime: binding.entity.lastUsedTime,
  });
}

export function applyRotation(params: ApplyRotationParams): void {
  const runtime = params.movementState.get(params.binding.playerId) ?? createMovementRuntimeState(params.currentTick);
  const yaw = typeof params.input.yaw === 'number' ? params.input.yaw : params.binding.entity.getRotation().y;
  const pitch = typeof params.input.pitch === 'number' ? params.input.pitch : params.binding.entity.getRotation().x;
  const inlineMovementIntent = readInlineMovementIntent(params.input);
  runtime.velocity = { x: 0, y: 0, z: 0 };
  runtime.isCrouching = inlineMovementIntent.crouch;
  params.binding.entity.setRotation({
    ...params.binding.entity.getRotation(),
    x: pitch,
    y: yaw,
  });
  params.movementState.set(params.binding.playerId, runtime);
}

function readInlineMovementIntent(input: Record<string, unknown>): { jump: boolean; crouch: boolean } {
  const movementIntent = input.movementIntent;
  if (movementIntent && typeof movementIntent === 'object') {
    const raw = movementIntent as { jump?: unknown; crouch?: unknown };
    return {
      jump: typeof raw.jump === 'boolean' ? raw.jump : input.jump === true,
      crouch: typeof raw.crouch === 'boolean' ? raw.crouch : input.crouch === true,
    };
  }
  return {
    jump: input.jump === true,
    crouch: input.crouch === true,
  };
}

function applyPlanarDamping(velocity: Vector3, deceleration: number, friction: number, dt: number): Vector3 {
  const planarSpeed = Math.hypot(velocity.x, velocity.z);
  if (planarSpeed <= 0.00001) {
    return { x: 0, y: 0, z: 0 };
  }

  const speedDrop = Math.min(planarSpeed, (deceleration + planarSpeed * friction) * dt);
  const nextSpeed = Math.max(0, planarSpeed - speedDrop);
  const scale = planarSpeed > 0 ? nextSpeed / planarSpeed : 0;
  return {
    x: velocity.x * scale,
    y: 0,
    z: velocity.z * scale,
  };
}

function resolveSprintSpeedMultiplier(_sprintRequested: boolean): number {
  return 1;
}

function resolveSprintAccelerationMultiplier(_sprintRequested: boolean): number {
  return 1;
}

export function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

export function subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function magnitude(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

export function lerpVector(from: Vector3, to: Vector3, alpha: number): Vector3 {
  return {
    x: from.x + (to.x - from.x) * alpha,
    y: from.y + (to.y - from.y) * alpha,
    z: from.z + (to.z - from.z) * alpha,
  };
}

export function isFiniteVector(vector: Vector3 | null | undefined): vector is Vector3 {
  return !!vector
    && Number.isFinite(vector.x)
    && Number.isFinite(vector.y)
    && Number.isFinite(vector.z);
}

export function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function clampMagnitude(vector: Vector3, maxValue: number): Vector3 {
  const current = magnitude(vector);
  if (current <= maxValue || current <= 0.00001) {
    return { ...vector };
  }
  const scale = maxValue / current;
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  };
}
