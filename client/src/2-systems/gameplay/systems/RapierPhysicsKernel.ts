import type { Vector3 } from '@engine/1-kernel/core/public-api';
import type {
  CollisionLayer,
  PhysicsBody,
  PhysicsBodyConfig,
  RaycastConfig,
  RaycastHit,
} from './PhysicsSystem';

interface RapierRuntime {
  World: new (gravity: { x: number; y: number; z: number }) => unknown;
  RigidBodyDesc: {
    fixed: () => unknown;
    dynamic: () => unknown;
    kinematicPositionBased: () => unknown;
  };
  ColliderDesc: {
    cuboid: (hx: number, hy: number, hz: number) => unknown;
    ball: (r: number) => unknown;
  };
  init: () => Promise<void>;
}

interface RapierBodyRecord {
  body: unknown;
  collider: unknown;
}

interface RapierBodyMeta {
  layer: CollisionLayer;
  isTrigger: boolean;
}

function v3len(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function v3norm(v: Vector3): Vector3 {
  const len = v3len(v);
  if (len <= 1e-8) {
    return { x: 0, y: 1, z: 0 };
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Minimal Rapier scaffold that mirrors lifecycle calls from PhysicsSystem.
 *
 * NOTE: This kernel is intentionally non-authoritative in milestone 1.
 * Legacy PhysicsSystem remains the active simulation path while this backend
 * is initialized and fed with data for incremental migration.
 */
export class RapierPhysicsKernel {
  private rapier: RapierRuntime | null = null;
  private world: any = null;
  private readonly bodies = new Map<string, RapierBodyRecord>();
  private readonly bodyMeta = new Map<string, RapierBodyMeta>();
  private readonly colliderToEntity = new WeakMap<object, string>();
  private initialized = false;
  private readonly initPromise: Promise<void>;

  constructor(private gravity: Vector3) {
    this.initPromise = this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    try {
      const moduleRef = await import('@dimforge/rapier3d-compat');
      const rapier = moduleRef as unknown as RapierRuntime;
      await rapier.init();
      this.rapier = rapier;
      this.world = new rapier.World({ x: this.gravity.x, y: this.gravity.y, z: this.gravity.z });
      this.initialized = true;
      console.log('[RapierPhysicsKernel] Initialized');
    } catch (error) {
      this.initialized = false;
      this.rapier = null;
      this.world = null;
      console.warn('[RapierPhysicsKernel] Initialization failed; staying passive.', error);
    }
  }

  onGravityChanged(nextGravity: Vector3): void {
    this.gravity = { ...nextGravity };
    if (!this.world) {
      return;
    }
    if ('gravity' in this.world) {
      this.world.gravity = { x: nextGravity.x, y: nextGravity.y, z: nextGravity.z };
    }
  }

  upsertBody(entityId: string, config: PhysicsBodyConfig, bodySnapshot: PhysicsBody): void {
    if (!this.initialized || !this.rapier || !this.world) {
      return;
    }

    if (this.bodies.has(entityId)) {
      this.removeBody(entityId);
    }

    let bodyDesc: any;
    if (config.isStatic) {
      bodyDesc = this.rapier.RigidBodyDesc.fixed();
    } else if (config.isTrigger || config.isSensor) {
      bodyDesc = this.rapier.RigidBodyDesc.kinematicPositionBased();
    } else {
      bodyDesc = this.rapier.RigidBodyDesc.dynamic();
    }

    if (typeof bodyDesc.setTranslation === 'function') {
      bodyDesc = bodyDesc.setTranslation(
        bodySnapshot.position.x,
        bodySnapshot.position.y,
        bodySnapshot.position.z,
      );
    }

    const rigidBody = this.world.createRigidBody(bodyDesc);

    let colliderDesc: any;
    if (config.shape === 'sphere') {
      colliderDesc = this.rapier.ColliderDesc.ball(config.radius ?? 0.5);
    } else {
      const halfExtents = config.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 };
      colliderDesc = this.rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    }

    if (config.isTrigger || config.isSensor) {
      if (typeof colliderDesc.setSensor === 'function') {
        colliderDesc = colliderDesc.setSensor(true);
      }
    }

    const collider = this.world.createCollider(colliderDesc, rigidBody);
    this.bodies.set(entityId, { body: rigidBody, collider });
    this.bodyMeta.set(entityId, {
      layer: config.layer ?? bodySnapshot.layer,
      isTrigger: (config.isTrigger || config.isSensor) ?? false,
    });

    if (collider && typeof collider === 'object') {
      this.colliderToEntity.set(collider as object, entityId);
    }
  }

  syncBodyPose(entityId: string, position: Vector3): void {
    const record = this.bodies.get(entityId);
    if (!record) {
      return;
    }

    const body = record.body as any;
    if (typeof body.setTranslation === 'function') {
      body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    }
  }

  step(): void {
    if (!this.initialized || !this.world) {
      return;
    }
    if (typeof this.world.step === 'function') {
      this.world.step();
    }
  }

  removeBody(entityId: string): void {
    if (!this.world) {
      this.bodies.delete(entityId);
      return;
    }
    const record = this.bodies.get(entityId);
    if (!record) {
      return;
    }

    const body = record.body as any;
    if (typeof this.world.removeRigidBody === 'function') {
      this.world.removeRigidBody(body);
    }

    this.bodies.delete(entityId);
    this.bodyMeta.delete(entityId);
  }

  clear(): void {
    for (const entityId of this.bodies.keys()) {
      this.removeBody(entityId);
    }
    this.bodies.clear();
    this.bodyMeta.clear();
  }

  isReady(): boolean {
    return this.initialized && this.world !== null;
  }

  raycast(origin: Vector3, direction: Vector3, cfg: RaycastConfig = {}): RaycastHit[] | null {
    if (!this.isReady() || !this.rapier || !this.world) {
      return null;
    }

    const RayCtor = (this.rapier as any).Ray;
    if (typeof RayCtor !== 'function') {
      return null;
    }

    if (typeof this.world.intersectionsWithRay !== 'function') {
      return null;
    }

    const maxDistance = cfg.maxDistance ?? 1000;
    const ignore = new Set(cfg.ignore ?? []);
    const layerMask = cfg.layerMask ? new Set(cfg.layerMask) : null;
    const dir = v3norm(direction);
    const ray = new RayCtor(origin, dir);
    const hits: RaycastHit[] = [];

    try {
      this.world.intersectionsWithRay(
        ray,
        maxDistance,
        true,
        (collider: any, rawHit: any) => {
          const entityId = this.resolveEntityId(collider);
          if (!entityId || ignore.has(entityId)) {
            return true;
          }

          const meta = this.bodyMeta.get(entityId);
          if (!meta) {
            return true;
          }
          if (layerMask && !layerMask.has(meta.layer)) {
            return true;
          }

          const toi = typeof rawHit?.toi === 'number' ? rawHit.toi : null;
          if (toi === null || !Number.isFinite(toi) || toi < 0 || toi > maxDistance) {
            return true;
          }

          hits.push({
            entityId,
            distance: toi,
            point: {
              x: origin.x + dir.x * toi,
              y: origin.y + dir.y * toi,
              z: origin.z + dir.z * toi,
            },
            normal: {
              x: typeof rawHit?.normal?.x === 'number' ? rawHit.normal.x : 0,
              y: typeof rawHit?.normal?.y === 'number' ? rawHit.normal.y : 1,
              z: typeof rawHit?.normal?.z === 'number' ? rawHit.normal.z : 0,
            },
          });
          return true;
        },
      );
    } catch (error) {
      console.warn('[RapierPhysicsKernel] Raycast failed; falling back to legacy raycast.', error);
      return null;
    }

    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }

  private resolveEntityId(collider: any): string | null {
    if (!collider) {
      return null;
    }

    if (typeof collider === 'object') {
      const byWeakMap = this.colliderToEntity.get(collider as object);
      if (byWeakMap) {
        return byWeakMap;
      }
    }

    const handle = typeof collider.handle === 'number' ? collider.handle : null;
    if (handle !== null) {
      for (const [entityId, record] of this.bodies) {
        const recordHandle = (record.collider as any)?.handle;
        if (typeof recordHandle === 'number' && recordHandle === handle) {
          return entityId;
        }
      }
    }

    return null;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      initialized: this.initialized,
      mirroredBodies: this.bodies.size,
      initPending: !this.initialized,
      hasWorld: this.world !== null,
      hasRayQuery: this.world !== null && typeof this.world.intersectionsWithRay === 'function',
    };
  }

  getInitPromise(): Promise<void> {
    return this.initPromise;
  }
}
