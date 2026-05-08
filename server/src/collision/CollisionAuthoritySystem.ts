import {
  CollisionBox,
  CollisionConfigMetadata,
  CollisionVector3,
  getCollisionConfigMetadata,
  getMapCollisionLayout,
  hasMapCollisionLayout,
  MapCollisionLayout,
} from './MapCollisionData';
import { EventEmitter } from 'events';

export interface CollisionAuthorityHandshake {
  version: number;
  checksum: string;
}

export interface CollisionHistoryFrame {
  tick: number;
  timestamp: number;
  dynamicBoxes: CollisionBox[];
}

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
  private readonly dynamicColliders = new Map<string, CollisionBox>();
  private readonly events = new EventEmitter();
  private mutationCount = 0;

  constructor(mapId: string, sessionId: string) {
    this.metadata = getCollisionConfigMetadata();
    this.hasStaticLayout = hasMapCollisionLayout(mapId);
    this.staticLayout = getMapCollisionLayout(mapId, sessionId);
  }

  getHandshake(): CollisionAuthorityHandshake {
    return {
      version: this.metadata.version,
      checksum: this.metadata.checksum,
    };
  }

  getBounds(): { halfWidth: number; halfDepth: number } | null {
    return this.staticLayout.bounds ? { ...this.staticLayout.bounds } : null;
  }

  hasDeterministicStaticLayout(): boolean {
    return this.hasStaticLayout;
  }

  getStaticLayout(): MapCollisionLayout {
    return { ...this.staticLayout, boxes: this.staticLayout.boxes.map(cloneBox) };
  }

  upsertDynamicCollider(id: string, position: CollisionVector3, halfExtents: CollisionVector3): void {
    this.dynamicColliders.set(id, {
      id,
      position: { ...position },
      halfExtents: { ...halfExtents },
    });
    this.mutationCount += 1;
    this.events.emit('changed', { action: 'upsert', id });
  }

  removeDynamicCollider(id: string): void {
    this.dynamicColliders.delete(id);
    this.mutationCount += 1;
    this.events.emit('changed', { action: 'remove', id });
  }

  clearDynamicColliders(): void {
    this.dynamicColliders.clear();
    this.mutationCount += 1;
    this.events.emit('changed', { action: 'clear' });
  }

  onChanged(listener: (payload: { action: string; id?: string }) => void): () => void {
    this.events.on('changed', listener);
    return () => {
      this.events.off('changed', listener);
    };
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        version: this.metadata.version,
        checksum: this.metadata.checksum,
        hasStaticLayout: this.hasStaticLayout,
        staticColliderCount: this.staticLayout.boxes.length,
        dynamicColliderCount: this.dynamicColliders.size,
        mutationCount: this.mutationCount,
      },
    };
  }

  captureCollisionHistoryFrame(tick: number, timestamp: number): CollisionHistoryFrame {
    return {
      tick,
      timestamp,
      dynamicBoxes: Array.from(this.dynamicColliders.values()).map(cloneBox),
    };
  }

  getCombinedCollisionBoxes(frame?: CollisionHistoryFrame): CollisionBox[] {
    const boxes = this.staticLayout.boxes.map(cloneBox);
    const dynamicBoxes = frame?.dynamicBoxes ?? Array.from(this.dynamicColliders.values());
    for (const box of dynamicBoxes) {
      boxes.push(cloneBox(box));
    }
    return boxes;
  }

  isPositionValid(position: CollisionVector3, radius: number, frame?: CollisionHistoryFrame, playerHalfHeight = 1): boolean {
    const bounds = this.staticLayout.bounds;
    if (bounds) {
      if (Math.abs(position.x) > bounds.halfWidth - radius || Math.abs(position.z) > bounds.halfDepth - radius) {
        return false;
      }
    }

    return !this.getCombinedCollisionBoxes(frame).some((box) => {
      const dx = Math.max(Math.abs(position.x - box.position.x) - box.halfExtents.x, 0);
      const dz = Math.max(Math.abs(position.z - box.position.z) - box.halfExtents.z, 0);
      const dy = Math.abs(position.y - box.position.y);
      if (dy > box.halfExtents.y + playerHalfHeight) return false;
      return dx * dx + dz * dz < radius * radius;
    });
  }

  raycast(origin: CollisionVector3, direction: CollisionVector3, maxDistance: number, frame?: CollisionHistoryFrame): { colliderId: string; distance: number } | null {
    let nearestHit: { colliderId: string; distance: number } | null = null;
    for (const box of this.getCombinedCollisionBoxes(frame)) {
      const hitDistance = this.rayIntersectsAabb(origin, direction, maxDistance, box.position, box.halfExtents);
      if (hitDistance === null) continue;
      if (!nearestHit || hitDistance < nearestHit.distance) {
        nearestHit = { colliderId: box.id, distance: hitDistance };
      }
    }
    return nearestHit;
  }

  simulateProjectile(origin: CollisionVector3, direction: CollisionVector3, speed: number, lifetimeSeconds: number, stepSeconds = 0.05, frame?: CollisionHistoryFrame): { hit: boolean; distance: number } {
    const maxDistance = speed * lifetimeSeconds;
    const hit = this.raycast(origin, direction, maxDistance, frame);
    if (hit) {
      return { hit: true, distance: hit.distance };
    }
    return { hit: false, distance: maxDistance };
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