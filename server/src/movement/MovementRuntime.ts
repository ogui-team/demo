import { type PlayerStatusMovementModifier } from '../rules/AbilityRules';
import { PHYSICS_CONSTANTS } from '../PhysicsConstants';
import { type PlayerMovementIntent } from '../gameplay/GameplayTypes';
import { type Vec3 } from '../sessionContracts';

export interface PlayerInputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  airControl: boolean;
  yaw: number;
  pitch: number;
}

export interface MovementRuntimePlayer {
  id: string;
  position: Vec3;
  rotation: Vec3;
  velocity: Vec3;
  isCrouching: boolean;
  isAirborne: boolean;
  groundHeight: number;
  currentInput: PlayerInputState;
  pendingMovementIntent?: PlayerMovementIntent | null;
  jumpBufferRemaining: number;
  coyoteTimeRemaining: number;
  statusMovementModifier?: PlayerStatusMovementModifier | null;
}

export interface MovementRuntimeConfig {
  playerMoveSpeed: number;
  playerMoveAcceleration: number;
  playerJumpImpulse: number;
  playerGravity: number;
  playerJumpBufferSeconds: number;
  playerCoyoteTimeSeconds: number;
  playerAirControlFactor: number;
  playerCollisionRadius: number;
  playerCrouchHalfHeight: number;
  playerEyeHeight: number;
}

interface SanitizePlayerInputOptions {
  input: Record<string, unknown>;
  currentRotation: Vec3;
  readFiniteNumber: (value: unknown) => number | undefined;
  sanitizeAngle: (value: number | undefined, fallback: number) => number;
  sanitizePitch: (value: number | undefined, fallback: number) => number;
}

interface ApplyPlayerMovementStepOptions<TPlayer extends MovementRuntimePlayer> {
  player: TPlayer;
  step: number;
  now: number;
  tick: number;
  config: MovementRuntimeConfig;
  resolveMovement: (playerId: string, position: Vec3, desiredMovement: Vec3, radius: number, playerHalfHeight: number) => Vec3;
  refreshPlayerStatusMovementModifier: (player: TPlayer, now: number) => void;
  syncPlayerEntity: (playerId: string) => void;
}

export function createIdleInputState(): PlayerInputState {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    crouch: false,
    sprint: false,
    airControl: true,
    yaw: 0,
    pitch: 0,
  };
}

export function sanitizePlayerInput(options: SanitizePlayerInputOptions): PlayerInputState {
  const movementIntent = options.input.movementIntent && typeof options.input.movementIntent === 'object'
    ? options.input.movementIntent as { jump?: unknown; crouch?: unknown }
    : null;
  return {
    forward: !!options.input.forward,
    backward: !!options.input.backward,
    left: !!options.input.left,
    right: !!options.input.right,
    jump: typeof movementIntent?.jump === 'boolean' ? movementIntent.jump : !!options.input.jump,
    crouch: typeof movementIntent?.crouch === 'boolean' ? movementIntent.crouch : !!options.input.crouch,
    sprint: !!options.input.sprint,
    airControl: options.input.airControl !== false,
    yaw: options.sanitizeAngle(options.readFiniteNumber(options.input.yaw), options.currentRotation.y),
    pitch: options.sanitizePitch(options.readFiniteNumber(options.input.pitch), options.currentRotation.x),
  };
}

export function applyPlayerMovementStep<TPlayer extends MovementRuntimePlayer>(options: ApplyPlayerMovementStepOptions<TPlayer>): void {
  const { player, step, now, tick, config } = options;
  const input = player.currentInput ?? createIdleInputState();
  const movementIntent = player.pendingMovementIntent;
  const crouchRequested = input.crouch || movementIntent?.crouch === true;
  const wasCrouching = player.isCrouching;

  if (player.position.y <= player.groundHeight + PHYSICS_CONSTANTS.GROUND_DETECTION_THRESHOLD && player.velocity.y <= 0) {
    player.velocity.y = 0;
    player.isAirborne = false;
    player.coyoteTimeRemaining = config.playerCoyoteTimeSeconds;
  } else {
    player.isAirborne = true;
    player.coyoteTimeRemaining = Math.max(0, player.coyoteTimeRemaining - step);
  }
  player.jumpBufferRemaining = Math.max(0, player.jumpBufferRemaining - step);

  let wishVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  const crouchSpeedMultiplier = crouchRequested ? 0.5 : 1;
  const movementSpeed = config.playerMoveSpeed * crouchSpeedMultiplier;
  const movementAcceleration = config.playerMoveAcceleration * crouchSpeedMultiplier;
  if (input.forward) { wishVelocity.x -= Math.sin(input.yaw) * movementSpeed; wishVelocity.z -= Math.cos(input.yaw) * movementSpeed; }
  if (input.backward) { wishVelocity.x += Math.sin(input.yaw) * movementSpeed; wishVelocity.z += Math.cos(input.yaw) * movementSpeed; }
  if (input.left) { wishVelocity.x -= Math.cos(input.yaw) * movementSpeed; wishVelocity.z += Math.sin(input.yaw) * movementSpeed; }
  if (input.right) { wishVelocity.x += Math.cos(input.yaw) * movementSpeed; wishVelocity.z -= Math.sin(input.yaw) * movementSpeed; }
  wishVelocity = clampHorizontalMagnitude(wishVelocity, movementSpeed);

  const controlFactor = player.isAirborne ? (input.airControl ? config.playerAirControlFactor : 0) : 1;
  const velocityDelta = {
    x: wishVelocity.x - player.velocity.x,
    y: 0,
    z: wishVelocity.z - player.velocity.z,
  };
  const appliedVelocityDelta = clampHorizontalMagnitude(
    velocityDelta,
    movementAcceleration * Math.max(0, controlFactor) * step,
  );
  let nextVelocity = clampHorizontalMagnitude({
    x: player.velocity.x + appliedVelocityDelta.x,
    y: player.velocity.y,
    z: player.velocity.z + appliedVelocityDelta.z,
  }, movementSpeed);

  const noHorizontalInput = Math.abs(wishVelocity.x) <= 0.00001 && Math.abs(wishVelocity.z) <= 0.00001;
  if (noHorizontalInput && !player.isAirborne) {
    nextVelocity = applyHorizontalDeceleration(nextVelocity, PHYSICS_CONSTANTS.PLAYER_DECELERATION, PHYSICS_CONSTANTS.PLAYER_FRICTION, step);
    if (Math.abs(nextVelocity.x) < 0.01) nextVelocity.x = 0;
    if (Math.abs(nextVelocity.z) < 0.01) nextVelocity.z = 0;
  }

  let jumpImpulse = config.playerJumpImpulse;
  let consumedMovementIntent = false;
  if (movementIntent && movementIntent.horizontalImpulse > 0) {
    nextVelocity.x += movementIntent.direction.x * movementIntent.horizontalImpulse;
    nextVelocity.z += movementIntent.direction.z * movementIntent.horizontalImpulse;
    consumedMovementIntent = true;
  }
  if (movementIntent?.jump) {
    player.jumpBufferRemaining = Math.max(player.jumpBufferRemaining, config.playerJumpBufferSeconds);
    jumpImpulse = movementIntent.verticalImpulse ?? config.playerJumpImpulse;
    consumedMovementIntent = true;
  }
  if (movementIntent?.crouch) {
    consumedMovementIntent = true;
  }
  if (consumedMovementIntent) {
    player.pendingMovementIntent = null;
  }

  options.refreshPlayerStatusMovementModifier(player, now);
  const statusMovementModifier = player.statusMovementModifier;
  if (statusMovementModifier?.blockMovement) {
    nextVelocity.x = 0;
    nextVelocity.z = 0;
  } else if (typeof statusMovementModifier?.speedMultiplier === 'number' && statusMovementModifier.speedMultiplier < 1) {
    nextVelocity.x *= statusMovementModifier.speedMultiplier;
    nextVelocity.z *= statusMovementModifier.speedMultiplier;
  }
  if (statusMovementModifier?.impulseOverride) {
    nextVelocity.x = statusMovementModifier.impulseOverride.x;
    nextVelocity.z = statusMovementModifier.impulseOverride.z;
  }

  const canConsumeJump = !player.isAirborne || player.coyoteTimeRemaining > 0;
  if (player.jumpBufferRemaining > 0 && canConsumeJump) {
    nextVelocity.y = jumpImpulse;
    player.jumpBufferRemaining = 0;
    player.coyoteTimeRemaining = 0;
    player.isAirborne = true;
    console.log('[MovementResolve] jump applied', {
      playerId: player.id,
      tick,
      crouch: crouchRequested,
      jumpImpulse,
    });
  }

  if (player.isAirborne) {
    nextVelocity.y -= config.playerGravity * step;
  }

  const resolvedPosition = options.resolveMovement(
    player.id,
    player.position,
    {
      x: nextVelocity.x * step,
      y: nextVelocity.y * step,
      z: nextVelocity.z * step,
    },
    config.playerCollisionRadius,
    crouchRequested ? config.playerCrouchHalfHeight : config.playerEyeHeight,
  );

  if (resolvedPosition.y <= player.groundHeight + PHYSICS_CONSTANTS.GROUND_DETECTION_THRESHOLD) {
    resolvedPosition.y = player.groundHeight;
    player.groundHeight = Math.max(player.groundHeight, resolvedPosition.y);
    if (nextVelocity.y <= 0) {
      nextVelocity.y = 0;
      player.isAirborne = false;
      player.coyoteTimeRemaining = config.playerCoyoteTimeSeconds;
    }
  } else if (nextVelocity.y < 0) {
    player.isAirborne = true;
  }

  const finalVelocity = {
    x: (resolvedPosition.x - player.position.x) / step,
    y: (resolvedPosition.y - player.position.y) / step,
    z: (resolvedPosition.z - player.position.z) / step,
  };
  if (resolvedPosition.y === player.groundHeight && nextVelocity.y === 0) {
    finalVelocity.y = 0;
  }
  player.velocity = finalVelocity;
  player.position = resolvedPosition;
  player.rotation.x = input.pitch;
  player.rotation.y = input.yaw;
  player.isCrouching = crouchRequested;
  if (wasCrouching !== player.isCrouching) {
    console.log('[MovementResolve] crouch state', {
      playerId: player.id,
      tick,
      crouching: player.isCrouching,
      grounded: !player.isAirborne,
    });
  }
  options.syncPlayerEntity(player.id);
}

export function applyHorizontalDeceleration(vector: Vec3, deceleration: number, friction: number, step: number): Vec3 {
  const planarSpeed = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
  if (planarSpeed <= 0.00001) {
    return { x: 0, y: vector.y, z: 0 };
  }

  const speedDrop = Math.min(planarSpeed, (deceleration + planarSpeed * friction) * step);
  const nextSpeed = Math.max(0, planarSpeed - speedDrop);
  const scale = planarSpeed > 0 ? nextSpeed / planarSpeed : 0;
  return {
    x: vector.x * scale,
    y: vector.y,
    z: vector.z * scale,
  };
}

export function clampHorizontalMagnitude(vector: Vec3, maxMagnitude: number): Vec3 {
  const magnitude = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
  if (magnitude <= maxMagnitude || magnitude <= 0.00001) {
    return { ...vector };
  }
  const scale = maxMagnitude / magnitude;
  return { x: vector.x * scale, y: vector.y, z: vector.z * scale };
}