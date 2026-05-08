import { type CollisionHistoryFrame, type CollisionAuthoritySystem } from '../collision/CollisionAuthoritySystem';
import { type Vec3 } from '../sessionContracts';
import { type EntityState, type PlayerState } from '../core/GameSession';

export interface EntityHistoryFrame {
  tick: number;
  timestamp: number;
  entities: Map<string, EntityState>;
}

interface ValidatePlayerRayTargetOptions {
  playerId: string;
  players: Iterable<[string, PlayerState]>;
  entities: ReadonlyMap<string, EntityState>;
  entityFrame: EntityHistoryFrame | null;
  collisionFrame: CollisionHistoryFrame | null;
  collisionAuthority: Pick<CollisionAuthoritySystem, 'raycast'>;
  origin: Vec3;
  direction: Vec3;
  range: number;
}

export function captureEntityHistoryFrame(
  entities: ReadonlyMap<string, EntityState>,
  tick: number,
  timestamp: number,
): EntityHistoryFrame {
  const snapshot = new Map<string, EntityState>();
  for (const [entityId, entity] of entities) {
    snapshot.set(entityId, {
      ...entity,
      position: { ...entity.position },
      rotation: { ...entity.rotation },
      velocity: entity.velocity ? { ...entity.velocity } : undefined,
    });
  }

  return {
    tick,
    timestamp,
    entities: snapshot,
  };
}

export function findClosestHistoryFrame<TFrame extends { timestamp: number }>(
  frames: readonly TFrame[],
  timestamp: number,
): TFrame | null {
  let best: TFrame | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const frame of frames) {
    const distance = Math.abs(frame.timestamp - timestamp);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = frame;
    }
  }

  return best;
}

export function validatePlayerRayTarget(options: ValidatePlayerRayTargetOptions): string | null {
  let bestTargetId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [targetId, target] of options.players) {
    if (targetId === options.playerId || target.dead) continue;
    const snapshot = options.entityFrame?.entities.get(targetId) ?? options.entities.get(targetId);
    if (!snapshot?.position) continue;
    const center = { x: snapshot.position.x, y: snapshot.position.y + 1, z: snapshot.position.z };
    const toTarget = {
      x: center.x - options.origin.x,
      y: center.y - options.origin.y,
      z: center.z - options.origin.z,
    };
    const projection = toTarget.x * options.direction.x + toTarget.y * options.direction.y + toTarget.z * options.direction.z;
    if (projection < 0 || projection > options.range) continue;
    const closest = {
      x: options.origin.x + options.direction.x * projection,
      y: options.origin.y + options.direction.y * projection,
      z: options.origin.z + options.direction.z * projection,
    };
    const dx = center.x - closest.x;
    const dy = center.y - closest.y;
    const dz = center.z - closest.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > 1.4 * 1.4) continue;
    if (projection < bestDistance) {
      bestDistance = projection;
      bestTargetId = targetId;
    }
  }

  const geometryHit = options.collisionAuthority.raycast(
    options.origin,
    options.direction,
    Math.min(bestDistance, options.range),
    options.collisionFrame ?? undefined,
  );
  const geometryHitDistance = geometryHit?.distance ?? null;
  if (geometryHitDistance !== null && geometryHitDistance <= bestDistance) {
    return null;
  }

  return bestTargetId;
}