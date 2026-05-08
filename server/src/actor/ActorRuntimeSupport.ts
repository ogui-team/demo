import { type RuntimeActorRecord } from './AuthoritativeActorRuntime';
import { type Vec3 } from '../sessionContracts';

interface ActorPositionPlayer {
  dead: boolean;
  position: Vec3;
}

interface ResolveActorMovementOptions {
  actor: RuntimeActorRecord;
  desiredStep: Vec3;
  halfExtents: Vec3;
  collisionRadius: number;
  isActorPositionUsable: (position: Vec3, collisionRadius: number) => boolean;
  removeDynamicCollider: (objectId: string) => void;
  upsertDynamicCollider: (objectId: string, position: Vec3, halfExtents: Vec3) => void;
}

interface GetDefaultActorSpawnPointOptions {
  spawnPoints: Vec3[];
  collisionRadius: number;
  isActorPositionUsable: (position: Vec3, collisionRadius: number) => boolean;
  fallbackSpawnPoint: () => Vec3;
}

export function resolveActorMovement(options: ResolveActorMovementOptions): Vec3 {
  const { actor, desiredStep, halfExtents, collisionRadius } = options;
  const base = actor.position;
  options.removeDynamicCollider(actor.objectId);

  const tryPosition = (candidate: Vec3): boolean => options.isActorPositionUsable(candidate, collisionRadius);
  const full = {
    x: base.x + desiredStep.x,
    y: base.y,
    z: base.z + desiredStep.z,
  };

  let resolved = { ...base };
  if (tryPosition(full)) {
    resolved = full;
  } else {
    const xOnly = { x: base.x + desiredStep.x, y: base.y, z: base.z };
    const zOnly = { x: base.x, y: base.y, z: base.z + desiredStep.z };
    if (tryPosition(xOnly) && tryPosition({ x: xOnly.x, y: xOnly.y, z: base.z + desiredStep.z })) {
      resolved = { x: xOnly.x, y: base.y, z: base.z + desiredStep.z };
    } else if (tryPosition(zOnly) && tryPosition({ x: base.x + desiredStep.x, y: zOnly.y, z: zOnly.z })) {
      resolved = { x: base.x + desiredStep.x, y: base.y, z: zOnly.z };
    } else if (tryPosition(xOnly)) {
      resolved = xOnly;
    } else if (tryPosition(zOnly)) {
      resolved = zOnly;
    }
  }

  options.upsertDynamicCollider(actor.objectId, resolved, halfExtents);
  return resolved;
}

export function isActorPositionUsable<TPlayer extends ActorPositionPlayer>(
  position: Vec3,
  collisionRadius: number,
  isPositionValid: (position: Vec3, collisionRadius: number) => boolean,
  players: Iterable<TPlayer>,
  playerCollisionRadius: number,
): boolean {
  if (!isPositionValid(position, collisionRadius)) {
    return false;
  }

  const minSpacing = playerCollisionRadius + collisionRadius;
  const minSpacingSq = minSpacing * minSpacing;
  for (const player of players) {
    if (player.dead) continue;
    const dx = player.position.x - position.x;
    const dz = player.position.z - position.z;
    if (dx * dx + dz * dz < minSpacingSq) {
      return false;
    }
  }

  return true;
}

export function findClosestActivePlayer<TPlayer extends ActorPositionPlayer>(
  players: Iterable<TPlayer>,
  origin: Vec3,
  maxRange: number,
): TPlayer | null {
  let bestPlayer: TPlayer | null = null;
  let bestDistanceSq = maxRange * maxRange;

  for (const player of players) {
    if (player.dead) continue;
    const dx = player.position.x - origin.x;
    const dz = player.position.z - origin.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestPlayer = player;
    }
  }

  return bestPlayer;
}

export function getDefaultActorSpawnPoint(options: GetDefaultActorSpawnPointOptions): Vec3 {
  const defaultY = options.spawnPoints[0]?.y ?? 1;
  const primary = { x: 0, y: defaultY, z: 0 };
  if (options.isActorPositionUsable(primary, options.collisionRadius)) {
    return primary;
  }

  const nearbyPrimary = findNearbyValidActorSpawn(primary, options.collisionRadius, options.isActorPositionUsable);
  if (nearbyPrimary) {
    return nearbyPrimary;
  }

  const fallback = options.fallbackSpawnPoint();
  return findNearbyValidActorSpawn(fallback, options.collisionRadius, options.isActorPositionUsable) ?? fallback;
}

function findNearbyValidActorSpawn(
  origin: Vec3,
  collisionRadius: number,
  isActorPositionUsableFn: (position: Vec3, collisionRadius: number) => boolean,
): Vec3 | null {
  const radii = [2, 4, 6, 8, 10, 12];
  const steps = 16;

  for (const radius of radii) {
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const candidate = {
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y,
        z: origin.z + Math.sin(angle) * radius,
      };
      if (isActorPositionUsableFn(candidate, collisionRadius)) {
        return candidate;
      }
    }
  }

  return null;
}