import type { MapCollisionLayout, CollisionBox, CollisionVector3 } from './MapCollisionData';

/**
 * WorldGeometryCoordinator - Collision Geometry Management
 * 
 * Purpose: Manage map collision data lifecycle and prevent invisible geometry leakage
 * between Freeplay and Multiplayer modes.
 * 
 * Problem: Collision data persists across mode switches, causing runtime violations.
 * Solution: Explicit flush() on mode transition to purge residual collision boxes.
 * 
 * Pattern: State machine with MAP_LOADED → flush() → GEOMETRY_CLEAN
 */
export class WorldGeometryCoordinator {
  private currentMap: MapCollisionLayout | null = null;
  private colliderBuffer: CollisionBox[] = [];
  private isClean = true;

  /**
   * Load collision geometry from map source.
   * Only Multiplayer Map Source allowed (Freeplay collision discarded on transition).
   */
  loadMapCollision(
    mapId: string,
    sessionId: string,
    boxes: CollisionBox[],
    bounds?: { halfWidth: number; halfDepth: number } | null
  ): void {
    this.currentMap = {
      mapId,
      sessionId,
      bounds: bounds ?? null,
      boxes: [...boxes], // Deep copy to prevent external mutation
    };

    this.colliderBuffer = [...boxes];
    this.isClean = true;

    console.log('[WorldGeometryCoordinator] Map collision loaded:', {
      mapId,
      boxCount: boxes.length,
      bounds,
    });
  }

  /**
   * Flush all collision geometry.
   * 
   * Called when switching modes (Freeplay → Multiplayer or vice versa).
   * Ensures NO residual bits remain in collision buffer.
   * 
   * Procedure:
   * 1. Clear collider buffer (zero all boxes)
   * 2. Mark current map as null
   * 3. Set clean flag
   * 4. Validate empty state
   */
  flush(): void {
    console.log('[WorldGeometryCoordinator] FLUSHING collision geometry...');

    // Phase 1: Zero the collider buffer
    this.colliderBuffer.length = 0;

    // Phase 2: Release map reference
    if (this.currentMap) {
      const mapId = this.currentMap.mapId;
      const boxCount = this.currentMap.boxes.length;

      this.currentMap.boxes.length = 0;
      this.currentMap = null;

      console.log('[WorldGeometryCoordinator] Flushed:', {
        mapId,
        boxesCleared: boxCount,
      });
    }

    // Phase 3: Mark clean
    this.isClean = true;

    // Phase 4: Validation
    this.validateGeometryState();
  }

  /**
   * Reinitialize collision from Multiplayer Map Source (authoritative).
   * 
   * Call after flush() to establish clean state before loading new map.
   * Ensures transition sequence:
   *   Mode Switch → flush() → reinitializeFromMultiplayer() → ready
   */
  reinitializeFromMultiplayer(
    mapId: string,
    sessionId: string,
    boxes: CollisionBox[],
    bounds?: { halfWidth: number; halfDepth: number } | null
  ): void {
    if (!this.isClean) {
      console.warn(
        '[WorldGeometryCoordinator] Reinitialize called on unclean state. Forcing flush first.'
      );
      this.flush();
    }

    this.loadMapCollision(mapId, sessionId, boxes, bounds);
  }

  /**
   * Get current collision boxes (read-only view).
   */
  getColliders(): ReadonlyArray<CollisionBox> {
    return this.colliderBuffer;
  }

  /**
   * Get current map metadata.
   */
  getCurrentMap(): Readonly<MapCollisionLayout> | null {
    return this.currentMap;
  }

  /**
   * Query: Is geometry state clean (no residual bits)?
   */
  isGeometryClean(): boolean {
    return this.isClean && this.colliderBuffer.length === 0;
  }

  /**
   * Validation: Audit collision buffer for integrity.
   * 
   * Checks:
   * 1. Buffer size consistency
   * 2. No NaN/Infinity in positions/extents
   * 3. Positive half-extents
   * 4. No duplicate box IDs
   * 
   * Throws on violation (hard fail).
   */
  private validateGeometryState(): void {
    if (this.colliderBuffer.length === 0 && this.currentMap === null) {
      // Clean state verified ✓
      return;
    }

    if (!this.currentMap) {
      throw new Error('[WorldGeometryCoordinator] Inconsistent state: boxes exist but map is null');
    }

    if (this.colliderBuffer.length !== this.currentMap.boxes.length) {
      throw new Error(
        `[WorldGeometryCoordinator] Buffer/map size mismatch: ${this.colliderBuffer.length} vs ${this.currentMap.boxes.length}`
      );
    }

    // Validate each box
    const seenIds = new Set<string>();
    for (const box of this.colliderBuffer) {
      // Check for duplicates
      if (seenIds.has(box.id)) {
        throw new Error(`[WorldGeometryCoordinator] Duplicate box ID: ${box.id}`);
      }
      seenIds.add(box.id);

      // Check position validity
      this.validateVector3(box.position, 'position');

      // Check extents validity and positivity
      this.validateVector3(box.halfExtents, 'halfExtents');
      if (box.halfExtents.x <= 0 || box.halfExtents.y <= 0 || box.halfExtents.z <= 0) {
        throw new Error(`[WorldGeometryCoordinator] Non-positive half-extents: ${box.id}`);
      }
    }

    console.log('[WorldGeometryCoordinator] Geometry validation passed:', {
      boxCount: this.colliderBuffer.length,
      uniqueIds: seenIds.size,
    });
  }

  /**
   * Validate a 3D vector has no NaN/Infinity.
   */
  private validateVector3(vec: CollisionVector3, name: string): void {
    if (!isFinite(vec.x) || !isFinite(vec.y) || !isFinite(vec.z)) {
      throw new Error(
        `[WorldGeometryCoordinator] Invalid ${name}: ${JSON.stringify(vec)} (NaN or Infinity)`
      );
    }
  }

  /**
   * Debug: Dump current collision state.
   */
  dump(): object {
    return {
      isClean: this.isClean,
      mapId: this.currentMap?.mapId ?? null,
      sessionId: this.currentMap?.sessionId ?? null,
      boxCount: this.colliderBuffer.length,
      bounds: this.currentMap?.bounds ?? null,
      boxes: this.colliderBuffer.map((box) => ({
        id: box.id,
        pos: box.position,
        extents: box.halfExtents,
      })),
    };
  }
}

/**
 * Singleton instance (accessed globally)
 */
let coordinator: WorldGeometryCoordinator | null = null;

export function getWorldGeometryCoordinator(): WorldGeometryCoordinator {
  if (!coordinator) {
    coordinator = new WorldGeometryCoordinator();
    console.log('[WorldGeometryCoordinator] Singleton initialized');
  }
  return coordinator;
}

export function resetWorldGeometryCoordinator(): void {
  if (coordinator) {
    coordinator.flush();
    coordinator = null;
    console.log('[WorldGeometryCoordinator] Singleton reset');
  }
}
