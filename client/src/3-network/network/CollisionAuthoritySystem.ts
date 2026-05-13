import {
  CollisionBox,
  CollisionConfigMetadata,
  CollisionVector3,
  getCollisionConfigMetadata,
  getMapCollisionLayout,
  hasMapCollisionLayout,
  MapCollisionLayout,
} from './MapCollisionData';
import { gameBus } from '@engine/1-kernel/core/public-api';

export interface CollisionAuthorityHandshake {
  version: number;
  checksum: string;
}

export type RemotePredictionMode = 'deterministic' | 'server_only';

function cloneBox(box: CollisionBox): CollisionBox {
  return {
    id: box.id,
    position: { ...box.position },
    halfExtents: { ...box.halfExtents },
  };
}

export class CollisionAuthoritySystem {
  private readonly metadata: CollisionConfigMetadata;
  private staticLayout: MapCollisionLayout;
  private hasStaticLayout = true;
  private remotePredictionMode: RemotePredictionMode = 'deterministic';
  private readonly dynamicColliders = new Map<string, { box: CollisionBox; deterministic: boolean }>();

  constructor() {
    this.metadata = getCollisionConfigMetadata();
    this.staticLayout = getMapCollisionLayout('freeplay_test', 'bootstrap');
  }

  getHandshake(): CollisionAuthorityHandshake {
    return {
      version: this.metadata.version,
      checksum: this.metadata.checksum,
    };
  }

  getVersion(): number {
    return this.metadata.version;
  }

  getChecksum(): string {
    return this.metadata.checksum;
  }

  setStaticLayout(mapId: string, sessionId: string): void {
    const previousMapId = this.staticLayout.mapId;
    const previousBoxCount = this.staticLayout.boxes.length;
    
    this.hasStaticLayout = hasMapCollisionLayout(mapId);
    this.staticLayout = getMapCollisionLayout(mapId, sessionId);
    
    // Gate 1A: MODE-SCOPED COLLISION - Log collision changes
    const newBoxCount = this.staticLayout.boxes.length;
    console.log(
      `[Collision] Layout change: ${previousMapId}(${previousBoxCount} boxes) → ${mapId}(${newBoxCount} boxes) [session:${sessionId}]`
    );
    
    gameBus.emit('stateMutation', {
      source: 'CollisionAuthoritySystem',
      path: 'collisionAuthority.staticLayout',
      changedCount: 1,
    });
  }

  clearStaticLayout(sessionId = 'editor'): void {
    this.hasStaticLayout = false;
    this.staticLayout = {
      mapId: 'editor',
      sessionId,
      bounds: null,
      boxes: [],
    };
    gameBus.emit('stateMutation', {
      source: 'CollisionAuthoritySystem',
      path: 'collisionAuthority.staticLayout',
      changedCount: 1,
    });
  }

  getStaticLayout(): MapCollisionLayout {
    return {
      ...this.staticLayout,
      boxes: this.staticLayout.boxes.map(cloneBox),
    };
  }

  setRemotePredictionMode(mode: RemotePredictionMode): void {
    this.remotePredictionMode = mode;
    gameBus.emit('stateMutation', {
      source: 'CollisionAuthoritySystem',
      path: 'collisionAuthority.remotePredictionMode',
      changedCount: 1,
    });
  }

  canPredictMovement(authorityMode: 'local' | 'remote'): boolean {
    if (authorityMode === 'local') return true;
    return this.remotePredictionMode === 'deterministic' && this.hasStaticLayout;
  }

  upsertDynamicCollider(id: string, position: CollisionVector3, halfExtents: CollisionVector3, deterministic = true): void {
    this.dynamicColliders.set(id, {
      box: {
        id,
        position: { ...position },
        halfExtents: { ...halfExtents },
      },
      deterministic,
    });
    gameBus.emit('stateMutation', {
      source: 'CollisionAuthoritySystem',
      path: 'collisionAuthority.dynamicColliders',
      changedCount: 1,
    });
  }

  removeDynamicCollider(id: string): void {
    this.dynamicColliders.delete(id);
    gameBus.emit('stateMutation', {
      source: 'CollisionAuthoritySystem',
      path: 'collisionAuthority.dynamicColliders',
      changedCount: 1,
    });
  }

  /** Update many colliders at once, emitting only a single stateMutation event. */
  batchUpsertDynamicColliders(entries: Array<{ id: string; position: CollisionVector3; halfExtents: CollisionVector3 }>): void {
    for (const { id, position, halfExtents } of entries) {
      this.dynamicColliders.set(id, {
        box: { id, position: { ...position }, halfExtents: { ...halfExtents } },
        deterministic: false,
      });
    }
    if (entries.length > 0) {
      gameBus.emit('stateMutation', {
        source: 'CollisionAuthoritySystem',
        path: 'collisionAuthority.dynamicColliders',
        changedCount: entries.length,
      });
    }
  }

  clearDynamicColliders(): void {
    this.dynamicColliders.clear();
    gameBus.emit('stateMutation', {
      source: 'CollisionAuthoritySystem',
      path: 'collisionAuthority.dynamicColliders',
      changedCount: 1,
    });
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        version: this.metadata.version,
        checksum: this.metadata.checksum,
        hasStaticLayout: this.hasStaticLayout,
        remotePredictionMode: this.remotePredictionMode,
        dynamicColliderCount: this.dynamicColliders.size,
        staticColliderCount: this.staticLayout.boxes.length,
      },
    };
  }

  getBounds(): { halfWidth: number; halfDepth: number } | null {
    return this.staticLayout.bounds ? { ...this.staticLayout.bounds } : null;
  }

  getCombinedCollisionBoxes(options: { includeNonDeterministic?: boolean } = {}): CollisionBox[] {
    const includeNonDeterministic = options.includeNonDeterministic ?? true;
    const boxes = this.staticLayout.boxes.map(cloneBox);
    for (const { box, deterministic } of this.dynamicColliders.values()) {
      if (!includeNonDeterministic && !deterministic) continue;
      boxes.push(cloneBox(box));
    }
    return boxes;
  }

  isPositionValid(position: CollisionVector3, radius: number, options: { includeNonDeterministic?: boolean; height?: number } = {}): boolean {
    const playerHalfHeight = options.height ?? 1.6;
    const bounds = this.staticLayout.bounds;
    if (bounds) {
      if (Math.abs(position.x) > bounds.halfWidth - radius || Math.abs(position.z) > bounds.halfDepth - radius) {
        return false;
      }
    }

    return !this.getCombinedCollisionBoxes(options).some((box) => {
      const dx = Math.max(Math.abs(position.x - box.position.x) - box.halfExtents.x, 0);
      const dz = Math.max(Math.abs(position.z - box.position.z) - box.halfExtents.z, 0);
      const dy = Math.abs(position.y - box.position.y);
      if (dy > box.halfExtents.y + playerHalfHeight) return false;
      return dx * dx + dz * dz < radius * radius;
    });
  }

  /**
   * Find the highest floor Y below a given position.
   * Returns the Y level where the player's feet would land, or null if no floor found.
   * @param position  Player center position
   * @param radius    Player XZ collision radius
   * @param halfH     Half-height of the player (used as feet offset below center)
   */
  findFloorY(
    position: CollisionVector3,
    radius: number,
    halfH: number,
    options: { includeNonDeterministic?: boolean } = {},
  ): number | null {
    const feetY = position.y - halfH;
    let highestFloorY: number | null = null;

    for (const box of this.getCombinedCollisionBoxes(options)) {
      const boxTopY = box.position.y + box.halfExtents.y;
      if (boxTopY > feetY + 0.05) continue; // Box top is above player's feet — skip
      const dx = Math.max(Math.abs(position.x - box.position.x) - box.halfExtents.x, 0);
      const dz = Math.max(Math.abs(position.z - box.position.z) - box.halfExtents.z, 0);
      if (dx * dx + dz * dz > radius * radius) continue; // Not horizontally under player
      if (highestFloorY === null || boxTopY > highestFloorY) {
        highestFloorY = boxTopY;
      }
    }
    return highestFloorY;
  }

  resolveMovement(
    currentPosition: CollisionVector3,
    desiredMovement: CollisionVector3,
    radius: number,
    options: { includeNonDeterministic?: boolean; height?: number } = {},
  ): CollisionVector3 {
    const fullPosition = {
      x: currentPosition.x + desiredMovement.x,
      y: currentPosition.y,
      z: currentPosition.z + desiredMovement.z,
    };

    // ── Y floor detection ────────────────────────────────────────────────────
    // When the player is falling, find if they would pass through a box top.
    // The "height" option is used as a half-height offset to locate the player's feet.
    let resolvedY = desiredMovement.y;
    if (desiredMovement.y < 0) {
      const halfH = (options.height ?? 1.6) * 0.5;
      const feetY = currentPosition.y - halfH;
      const newFeetY = feetY + desiredMovement.y;

      for (const box of this.getCombinedCollisionBoxes(options)) {
        const boxTopY = box.position.y + box.halfExtents.y;
        if (boxTopY > feetY + 0.02) continue; // Box above player's feet, skip
        if (boxTopY < newFeetY) continue;      // Player won't reach this box
        // Check horizontal overlap (feet XZ vs box XZ, expanded by radius)
        const dx = Math.max(Math.abs(currentPosition.x + desiredMovement.x - box.position.x) - box.halfExtents.x, 0);
        const dz = Math.max(Math.abs(currentPosition.z + desiredMovement.z - box.position.z) - box.halfExtents.z, 0);
        if (dx * dx + dz * dz > radius * radius) continue;
        // Floor hit — clamp Y so feet land exactly on box top
        const clampedY = boxTopY - feetY; // delta to bring feet to box top
        if (clampedY > resolvedY) resolvedY = clampedY;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    if (this.isPositionValid(fullPosition, radius, options)) {
      return { ...desiredMovement, y: resolvedY };
    }

    const candidates: Array<{ vector: CollisionVector3; delta: CollisionVector3 }> = [
      {
        vector: { x: currentPosition.x + desiredMovement.x, y: currentPosition.y, z: currentPosition.z },
        delta: { x: desiredMovement.x, y: 0, z: 0 },
      },
      {
        vector: { x: currentPosition.x, y: currentPosition.y, z: currentPosition.z + desiredMovement.z },
        delta: { x: 0, y: 0, z: desiredMovement.z },
      },
    ];

    let bestCandidate: { vector: CollisionVector3; delta: CollisionVector3 } | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (!this.isPositionValid(candidate.vector, radius, options)) continue;
      const dx = candidate.vector.x - fullPosition.x;
      const dz = candidate.vector.z - fullPosition.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) return { ...bestCandidate.delta, y: resolvedY };

    // All standard slide options failed. The player may be surrounded by dynamic (enemy)
    // colliders. Compute a gentle push-out vector away from the nearest non-deterministic
    // blocker so the player can slide past enemies instead of getting permanently stuck.
    const escapeVec = this._computeEscapeFromDynamicBlockers(currentPosition, radius, options);
    if (escapeVec) return { ...escapeVec, y: resolvedY };

    return { x: 0, y: resolvedY, z: 0 };
  }

  /**
   * When the player is hemmed in by enemy bodies on all sides, find the nearest
   * non-deterministic (enemy) dynamic collider and nudge the player away from it.
   * The escape direction is validated against static-only geometry so the player
   * cannot be pushed into a wall by this step.
   */
  private _computeEscapeFromDynamicBlockers(
    position: CollisionVector3,
    radius: number,
    options: { includeNonDeterministic?: boolean; height?: number },
  ): CollisionVector3 | null {
    let nearestBox: CollisionBox | null = null;
    let minDistSq = Number.POSITIVE_INFINITY;

    for (const { box, deterministic } of this.dynamicColliders.values()) {
      if (deterministic) continue; // Only escape non-deterministic (enemy) colliders
      const dx = position.x - box.position.x;
      const dz = position.z - box.position.z;
      const distSq = dx * dx + dz * dz;
      const combined = radius + Math.max(box.halfExtents.x, box.halfExtents.z);
      if (distSq < combined * combined && distSq < minDistSq) {
        minDistSq = distSq;
        nearestBox = box;
      }
    }

    if (!nearestBox) return null;

    const dx = position.x - nearestBox.position.x;
    const dz = position.z - nearestBox.position.z;
    const dist = Math.sqrt(minDistSq);
    const nx = dist > 0.001 ? dx / dist : 1;
    const nz = dist > 0.001 ? dz / dist : 0;

    const nudge = 0.06; // small per-frame escape step (world units)
    const escapeX = nx * nudge;
    const escapeZ = nz * nudge;

    // Validate: the escape move must not push us into a static wall
    const staticOnlyOpts = { ...options, includeNonDeterministic: false };
    const escapedPos: CollisionVector3 = { x: position.x + escapeX, y: position.y, z: position.z + escapeZ };
    if (!this.isPositionValid(escapedPos, radius, staticOnlyOpts)) return null;

    return { x: escapeX, y: 0, z: escapeZ };
  }

  raycast(origin: CollisionVector3, direction: CollisionVector3, maxDistance: number, options: { includeNonDeterministic?: boolean } = {}): { colliderId: string; distance: number } | null {
    let nearestHit: { colliderId: string; distance: number } | null = null;
    for (const box of this.getCombinedCollisionBoxes(options)) {
      const hitDistance = this.rayIntersectsAabb(origin, direction, maxDistance, box.position, box.halfExtents);
      if (hitDistance === null) continue;
      if (!nearestHit || hitDistance < nearestHit.distance) {
        nearestHit = { colliderId: box.id, distance: hitDistance };
      }
    }
    return nearestHit;
  }

  private rayIntersectsAabb(origin: CollisionVector3, direction: CollisionVector3, maxDistance: number, center: CollisionVector3, halfExtents: CollisionVector3): number | null {
    let tMin = 0;
    let tMax = maxDistance;
    const axes: Array<keyof CollisionVector3> = ['x', 'y', 'z'];

    for (const axis of axes) {
      const min = center[axis] - halfExtents[axis];
      const max = center[axis] + halfExtents[axis];
      const dir = direction[axis];
      const ori = origin[axis];

      if (Math.abs(dir) < 0.00001) {
        if (ori < min || ori > max) return null;
        continue;
      }

      let t1 = (min - ori) / dir;
      let t2 = (max - ori) / dir;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    }

    return tMin <= maxDistance ? tMin : null;
  }
}
