import { type Vec3 } from '../sessionContracts';
import { PHYSICS_CONSTANTS } from '../PhysicsConstants';
import { type PlayerState } from '../core/GameSession';
import { validatePlayerRayTarget, type EntityHistoryFrame } from './combatValidationRuntime';
import { type CollisionHistoryFrame, CollisionAuthoritySystem } from '../collision/CollisionAuthoritySystem';
import { getWeaponRule, sanitizeWeaponId } from '../rules/WeaponRules';
import { type EntityState } from '../core/GameSession';
import { ABILITY_VALIDATION_PROFILES } from '../rules/AbilityRules';

const PLAYER_COLLISION_RADIUS = PHYSICS_CONSTANTS.PLAYER_COLLISION_RADIUS;
const PLAYER_EYE_HEIGHT = PHYSICS_CONSTANTS.PLAYER_EYE_HEIGHT;
const SHIELD_DASH_HORIZONTAL_IMPULSE = PHYSICS_CONSTANTS.SHIELD_DASH_HORIZONTAL_IMPULSE;

export interface PlayerValidationRuntimeOptions {
  collisionAuthority: CollisionAuthoritySystem;
  gameSession: {
    findEntityHistoryFrame: (timestamp: number) => EntityHistoryFrame | null;
    findCollisionHistoryFrame: (timestamp: number) => CollisionHistoryFrame | null;
    players: Map<string, PlayerState>;
    entities: Map<string, EntityState>;
    abilityCooldowns: Map<string, Map<string, number>>;
    activeSummons: Map<string, Array<{ abilityId: string; expiresAt: number }>>;
  };
}

/**
 * Sanitize a rotation angle to the range [-π, π]
 */
export function sanitizeAngle(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.atan2(Math.sin(value), Math.cos(value));
}

/**
 * Sanitize a pitch angle to the range [-π/2.5, π/2.5]
 */
export function sanitizePitch(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, value));
}

/**
 * Sanitize optional Vec3 from user input
 */
export function sanitizeOptionalVec3(value: unknown): Vec3 | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<Vec3>;
  if (![candidate.x, candidate.y, candidate.z].every((axis) => typeof axis === 'number' && Number.isFinite(axis))) {
    return null;
  }
  return { x: candidate.x as number, y: candidate.y as number, z: candidate.z as number };
}

/**
 * Sanitize origin position from user input, with fallback to player eye height
 */
export function sanitizeOrigin(player: PlayerState, raw: unknown): Vec3 {
  const fallback = { x: player.position.x, y: player.position.y + PLAYER_EYE_HEIGHT, z: player.position.z };
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Partial<Vec3>;
  if (![candidate.x, candidate.y, candidate.z].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return fallback;
  }

  const dx = (candidate.x as number) - fallback.x;
  const dy = (candidate.y as number) - fallback.y;
  const dz = (candidate.z as number) - fallback.z;
  const distanceSq = dx * dx + dy * dy + dz * dz;
  if (distanceSq > 36) return fallback; // Max 6 units from player eye

  return { x: candidate.x as number, y: candidate.y as number, z: candidate.z as number };
}

/**
 * Sanitize direction vector, normalizing and validating
 */
export function sanitizeDirection(raw: unknown): Vec3 {
  const fallback = { x: 0, y: 0, z: -1 };
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Partial<Vec3>;
  if (![candidate.x, candidate.y, candidate.z].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return fallback;
  }

  const x = candidate.x as number;
  const y = candidate.y as number;
  const z = candidate.z as number;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length <= 0.0001) return fallback;

  return { x: x / length, y: y / length, z: z / length };
}

/**
 * Sanitize timestamp, falling back to current time
 */
export function sanitizeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

/**
 * Read finite number from user input
 */
export function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Clamp value to [0, 1] range
 */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Calculate distance between two 3D points
 */
export function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(
    (a.x - b.x) * (a.x - b.x)
    + (a.y - b.y) * (a.y - b.y)
    + (a.z - b.z) * (a.z - b.z),
  );
}

/**
 * Normalize planar direction with fallback to player's facing direction
 */
export function normalizePlanarDirection(direction: Vec3, fallbackYaw: number): Vec3 {
  const length = Math.hypot(direction.x, direction.z);
  if (length <= 0.00001) {
    return {
      x: -Math.sin(fallbackYaw),
      y: 0,
      z: -Math.cos(fallbackYaw),
    };
  }
  return {
    x: direction.x / length,
    y: 0,
    z: direction.z / length,
  };
}

/**
 * Validate hitscan attack from player
 */
export function validateHitscan(
  playerId: string,
  weaponId: string,
  origin: Vec3,
  direction: Vec3,
  timestamp: number,
  options: PlayerValidationRuntimeOptions,
): string | null {
  const rule = getWeaponRule(weaponId);
  return validatePlayerRayTargetFn(playerId, origin, direction, rule.range, timestamp, options);
}

/**
 * Validate player ray target (for hitscan and abilities)
 */
export function validatePlayerRayTargetFn(
  playerId: string,
  origin: Vec3,
  direction: Vec3,
  range: number,
  timestamp: number,
  options: PlayerValidationRuntimeOptions,
): string | null {
  const entityFrame = options.gameSession.findEntityHistoryFrame(timestamp);
  const collisionFrame = options.gameSession.findCollisionHistoryFrame(timestamp);
  return validatePlayerRayTarget({
    playerId,
    players: options.gameSession.players,
    entities: options.gameSession.entities,
    entityFrame,
    collisionFrame,
    collisionAuthority: options.collisionAuthority,
    origin,
    direction,
    range,
  });
}

/**
 * Validate ability usage (cooldown, mana, range, delivery method)
 */
export function validateAbilityUse(
  player: PlayerState,
  abilityId: string,
  data: Record<string, unknown>,
  now: number,
  options: PlayerValidationRuntimeOptions,
): { accepted: boolean; cooldownSec: number; manaCost: number } {
  const profile = ABILITY_VALIDATION_PROFILES[abilityId];
  if (!profile) return { accepted: false, cooldownSec: 0, manaCost: 0 };
  if (player.mana < profile.manaCost) return { accepted: false, cooldownSec: 0, manaCost: 0 };

  const cooldowns = options.gameSession.abilityCooldowns.get(player.id) ?? new Map<string, number>();
  const readyAt = cooldowns.get(abilityId) ?? 0;
  if (readyAt > now) return { accepted: false, cooldownSec: 0, manaCost: 0 };

  const origin = sanitizeOrigin(player, data.origin);
  const direction = sanitizeDirection(data.direction);
  const distanceFromCaster = distance(origin, {
    x: player.position.x,
    y: player.position.y + PLAYER_EYE_HEIGHT,
    z: player.position.z,
  });
  if (distanceFromCaster > 6) return { accepted: false, cooldownSec: 0, manaCost: 0 };

  if (profile.delivery === 'Hitscan') {
    const maxRange = profile.maxRange ?? 40;
    const geometryHitDistance = options.collisionAuthority.raycast(origin, direction, maxRange)?.distance ?? null;
    if (geometryHitDistance !== null && geometryHitDistance < maxRange * 0.1) {
      return { accepted: false, cooldownSec: 0, manaCost: 0 };
    }
  }

  if (profile.delivery === 'Projectile') {
    const projectileSpeed = readFiniteNumber(data.projectileSpeed) ?? profile.projectileSpeed ?? 0;
    const projectileLifetime = readFiniteNumber(data.lifetime) ?? profile.maxLifetimeSec ?? 0;
    if (projectileSpeed > (profile.projectileSpeed ?? projectileSpeed) * 1.1) {
      return { accepted: false, cooldownSec: 0, manaCost: 0 };
    }
    if (projectileLifetime > (profile.maxLifetimeSec ?? projectileLifetime) * 1.1) {
      return { accepted: false, cooldownSec: 0, manaCost: 0 };
    }
    const projectileResult = options.collisionAuthority.simulateProjectile(origin, direction, projectileSpeed, projectileLifetime);
    if (projectileResult.hit && projectileResult.distance < Math.max(0.5, projectileSpeed * 0.05)) {
      return { accepted: false, cooldownSec: 0, manaCost: 0 };
    }
  }

  if (profile.delivery === 'AoE') {
    const radius = readFiniteNumber(data.radius) ?? profile.maxRadius ?? 0;
    if (profile.maxRadius && radius > profile.maxRadius) {
      return { accepted: false, cooldownSec: 0, manaCost: 0 };
    }
    const targetPosition = sanitizeOptionalVec3(data.targetPosition) ?? origin;
    if (distance(player.position, targetPosition) > (profile.maxRange ?? 0) + PLAYER_EYE_HEIGHT) {
      return { accepted: false, cooldownSec: 0, manaCost: 0 };
    }
  }

  if (profile.delivery === 'Summon') {
    const summonPosition = sanitizeOptionalVec3(data.targetPosition) ?? player.position;
    if (distance(player.position, summonPosition) > (profile.maxRange ?? 0) + PLAYER_COLLISION_RADIUS) {
      return { accepted: false, cooldownSec: 0, manaCost: 0 };
    }
    const active = (options.gameSession.activeSummons.get(player.id) ?? []).filter((summon) => summon.expiresAt > now);
    if (profile.maxActiveSummons && active.filter((summon) => summon.abilityId === abilityId).length >= profile.maxActiveSummons) {
      return { accepted: false, cooldownSec: 0, manaCost: 0 };
    }
    active.push({ abilityId, expiresAt: now + Math.round((profile.maxLifetimeSec ?? 30) * 1000) });
    options.gameSession.activeSummons.set(player.id, active);
  }

  const newCooldown = now + Math.round(profile.cooldownSec * 1000);
  const newCooldowns = new Map(cooldowns);
  newCooldowns.set(abilityId, newCooldown);
  options.gameSession.abilityCooldowns.set(player.id, newCooldowns);
  return { accepted: true, cooldownSec: profile.cooldownSec, manaCost: profile.manaCost };
}

/**
 * Build movement intent from shield dash ability
 */
export function buildAbilityMovementIntent(player: PlayerState, abilityId: string, data: Record<string, unknown>): { horizontalImpulse: number; direction: Vec3; jump: boolean; crouch: boolean } | undefined {
  switch (abilityId) {
    case 'ability_shield_dash': {
      const direction = sanitizeDirection(data.direction);
      const planarDirection = normalizePlanarDirection(direction, player.rotation.y);
      return {
        horizontalImpulse: 25, // SHIELD_DASH_HORIZONTAL_IMPULSE
        direction: planarDirection,
        jump: false,
        crouch: false,
      };
    }
    default:
      return undefined;
  }
}
