import { type Vec3 } from '../sessionContracts';
import { type CollisionAuthoritySystem } from '../collision/CollisionAuthoritySystem';

/**
 * Encapsulates collision and movement validation logic
 */
export class CollisionHelpers {
  /**
   * Resolve desired movement with collision checking
   * Tries full movement first, then progressively simpler paths
   */
  static resolveMovement(
    playerId: string,
    position: Vec3,
    desiredMovement: Vec3,
    radius: number,
    collisionAuthority: CollisionAuthoritySystem,
    playerHalfHeight: number = 0.9,
  ): Vec3 {
    const tryPosition = (candidate: Vec3): boolean => 
      CollisionHelpers.isMovementPositionValid(
        playerId,
        candidate,
        radius,
        collisionAuthority,
        playerHalfHeight,
      );

    const full = {
      x: position.x + desiredMovement.x,
      y: position.y + desiredMovement.y,
      z: position.z + desiredMovement.z,
    };
    if (tryPosition(full)) return full;

    const candidates: Vec3[] = [
      { x: position.x + desiredMovement.x, y: position.y + desiredMovement.y, z: position.z },
      { x: position.x, y: position.y + desiredMovement.y, z: position.z + desiredMovement.z },
      { x: position.x + desiredMovement.x, y: position.y, z: position.z + desiredMovement.z },
      { x: position.x + desiredMovement.x, y: position.y, z: position.z },
      { x: position.x, y: position.y + desiredMovement.y, z: position.z },
      { x: position.x, y: position.y, z: position.z + desiredMovement.z },
    ];

    let bestCandidate: Vec3 | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (!tryPosition(candidate)) continue;
      const dx = candidate.x - full.x;
      const dy = candidate.y - full.y;
      const dz = candidate.z - full.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestCandidate = candidate;
      }
    }
    return bestCandidate ?? { ...position };
  }

  /**
   * Check if movement position is valid in collision system
   */
  static isMovementPositionValid(
    playerId: string,
    position: Vec3,
    radius: number,
    collisionAuthority: CollisionAuthoritySystem,
    playerHalfHeight: number = 0.9,
  ): boolean {
    void playerId;
    return collisionAuthority.isPositionValid(position, radius, undefined, playerHalfHeight);
  }
}
