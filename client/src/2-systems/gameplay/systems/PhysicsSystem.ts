/**
 * PhysicsSystem
 * AABB and Sphere collision detection, raycasting, and physics body management.
 *
 * Integrates with TransformSystem (reads/writes entity positions via Vector3) and
 * SceneGraph (spatial queries). No external physics library — intentionally kept
 * simple for PS1-era game-feel.
 *
 * Usage:
 *   import { PhysicsSystem } from './systems/PhysicsSystem';
 *
 *   const physics = new PhysicsSystem();
 *   physics.addBody(entity.id, { shape: 'aabb', halfExtents: { x: 0.5, y: 1, z: 0.5 }, layer: 'player' });
 *   physics.onCollision((a, b, info) => { ... });
 *   onUpdate((dt) => physics.update(entityPositionMap, dt));
 */

import { Vector3 } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { RapierPhysicsKernel } from './RapierPhysicsKernel';

// ─── Collision layers ─────────────────────────────────────────────────────────

export type CollisionLayer = 'player' | 'enemy' | 'projectile' | 'environment' | 'trigger' | string;

export type PhysicsBackendMode = 'legacy' | 'rapier';

/** Pairs that should be tested. Everything not listed is skipped. */
const COLLISION_MATRIX: Array<[CollisionLayer, CollisionLayer]> = [
  ['player',     'environment'],
  ['player',     'enemy'],
  ['player',     'trigger'],
  ['enemy',      'environment'],
  ['enemy',      'trigger'],
  ['projectile', 'player'],
  ['projectile', 'enemy'],
  ['projectile', 'environment'],
];

// ─── Body shapes ──────────────────────────────────────────────────────────────

export interface AABBShape {
  shape: 'aabb';
  /** Half-extents from the body's centre. */
  halfExtents: Vector3;
}

export interface SphereShape {
  shape: 'sphere';
  radius: number;
}

export type CollisionShape = AABBShape | SphereShape;

export interface PhysicsBodyConfig {
  shape: 'aabb' | 'sphere';
  /** For AABB */
  halfExtents?: Vector3;
  /** For Sphere */
  radius?: number;
  layer?: CollisionLayer;
  /** Static bodies never move but everything still collides with them. */
  isStatic?: boolean;
  /** isTrigger = no resolution, only events. */
  isTrigger?: boolean;
  /** Bodies with isSensor only raise events, not collision responses. Same as trigger. */
  isSensor?: boolean;
}

export interface PhysicsBody {
  entityId: string;
  shape: CollisionShape;
  layer: CollisionLayer;
  isStatic: boolean;
  isTrigger: boolean;
  /** Set by PhysicsSystem every frame from the entity position map. */
  position: Vector3;
  /** Velocity applied to dynamic bodies. In world units/second. */
  velocity: Vector3;
  /** Accumulated forces (applied once then cleared). */
  force: Vector3;
  mass: number;
  /** Friction coefficient 0..1 */
  friction: number;
  /** Gravity scale multiplier (0 = no gravity) */
  gravityScale: number;
  /** Whether this body is touching the ground. */
  grounded: boolean;
}

export interface CollisionInfo {
  /** Normalised separation axis pointing from B toward A. */
  normal: Vector3;
  /** Overlap depth along the normal. */
  depth: number;
}

export interface CollisionEvent {
  entityA: string;
  entityB: string;
  info: CollisionInfo;
}

export type CollisionCallback = (event: CollisionEvent) => void;

// ─── Raycast ──────────────────────────────────────────────────────────────────

export interface RaycastHit {
  entityId: string;
  /** Distance from ray origin. */
  distance: number;
  /** World-space hit point. */
  point: Vector3;
  /** Surface normal at hit point. */
  normal: Vector3;
}

export interface RaycastConfig {
  /** Maximum ray distance. Default 1000. */
  maxDistance?: number;
  /** Only test bodies on these layers. */
  layerMask?: CollisionLayer[];
  /** Entities to skip. */
  ignore?: string[];
}

export interface OverlapQueryConfig {
  /** Only include bodies on these layers. */
  layerMask?: CollisionLayer[];
  /** Entity IDs to skip from results. */
  ignore?: string[];
  /** Include trigger/sensor bodies in results. Default false. */
  includeTriggers?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function v3add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function v3sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function v3scale(v: Vector3, s: number): Vector3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function v3dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function v3len(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function v3norm(v: Vector3): Vector3 {
  const l = v3len(v);
  if (l === 0) return { x: 0, y: 1, z: 0 };
  return v3scale(v, 1 / l);
}
function v3lerp(a: Vector3, b: Vector3, t: number): Vector3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function resolvePhysicsBackendMode(): PhysicsBackendMode {
  const globalOverride = (globalThis as any).__physicsBackend;
  if (globalOverride === 'rapier' || globalOverride === 'legacy') {
    return globalOverride;
  }

  const envValue = typeof process !== 'undefined'
    ? ((process as any).env?.PHYSICS_BACKEND ?? null)
    : null;
  if (envValue === 'rapier') {
    return 'rapier';
  }

  return 'legacy';
}

// ─── Narrow-phase ─────────────────────────────────────────────────────────────

function aabbVsAabb(
  posA: Vector3, extA: Vector3,
  posB: Vector3, extB: Vector3,
): CollisionInfo | null {
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  const dz = posB.z - posA.z;
  const ox = extA.x + extB.x - Math.abs(dx);
  const oy = extA.y + extB.y - Math.abs(dy);
  const oz = extA.z + extB.z - Math.abs(dz);
  if (ox <= 0 || oy <= 0 || oz <= 0) return null;

  // Minimum overlap axis
  let nx = 0, ny = 0, nz = 0, depth = 0;
  if (ox <= oy && ox <= oz) { depth = ox; nx = dx < 0 ? 1 : -1; }
  else if (oy <= ox && oy <= oz) { depth = oy; ny = dy < 0 ? 1 : -1; }
  else { depth = oz; nz = dz < 0 ? 1 : -1; }

  return { normal: { x: nx, y: ny, z: nz }, depth };
}

function sphereVsSphere(
  posA: Vector3, rA: number,
  posB: Vector3, rB: number,
): CollisionInfo | null {
  const d = v3sub(posA, posB);
  const dist = v3len(d);
  const sumR = rA + rB;
  if (dist >= sumR) return null;
  const depth = sumR - dist;
  const normal = dist > 0 ? v3norm(d) : { x: 0, y: 1, z: 0 };
  return { normal, depth };
}

function sphereVsAabb(
  spherePos: Vector3, radius: number,
  aabbPos: Vector3, extents: Vector3,
): CollisionInfo | null {
  // Closest point on AABB to sphere centre
  const cx = Math.max(aabbPos.x - extents.x, Math.min(spherePos.x, aabbPos.x + extents.x));
  const cy = Math.max(aabbPos.y - extents.y, Math.min(spherePos.y, aabbPos.y + extents.y));
  const cz = Math.max(aabbPos.z - extents.z, Math.min(spherePos.z, aabbPos.z + extents.z));
  const d = v3sub(spherePos, { x: cx, y: cy, z: cz });
  const dist = v3len(d);
  if (dist >= radius) return null;
  const depth = radius - dist;
  const normal = dist > 0 ? v3norm(d) : { x: 0, y: 1, z: 0 };
  return { normal, depth };
}

// ─── PhysicsSystem ────────────────────────────────────────────────────────────

export class PhysicsSystem {
  private bodies: Map<string, PhysicsBody> = new Map();
  private collisionCallbacks: CollisionCallback[] = [];
  private triggerEnterCallbacks: CollisionCallback[] = [];
  private triggerExitCallbacks: CollisionCallback[] = [];
  private lastCollisionCount = 0;
  private lastTriggerEnterCount = 0;
  private lastTriggerExitCount = 0;
  private lastDynamicBodyCount = 0;
  private backendMode: PhysicsBackendMode;
  private rapierKernel: RapierPhysicsKernel | null;
  private lastMirroredGravity: Vector3 = { x: 0, y: -9.8, z: 0 };

  /** Pairs currently touching (for trigger-enter/exit tracking). */
  private activePairs: Set<string> = new Set();

  /** Gravity vector. Default: -9.8 m/s² downward. */
  gravity: Vector3 = { x: 0, y: -9.8, z: 0 };

  /** Maximum slope angle (degrees) treated as ground. */
  maxSlopeAngle: number = 46;

  constructor() {
    this.backendMode = 'legacy';
    this.rapierKernel = null;
    this.switchBackend(resolvePhysicsBackendMode());
  }

  getBackendMode(): PhysicsBackendMode {
    return this.backendMode;
  }

  switchBackend(nextMode: PhysicsBackendMode): void {
    if (this.backendMode === nextMode) {
      return;
    }

    this.rapierKernel?.clear();
    this.rapierKernel = nextMode === 'rapier'
      ? new RapierPhysicsKernel(this.gravity)
      : null;
    this.backendMode = nextMode;
    this.lastMirroredGravity = { ...this.gravity };
  }

  // ─── Body management ────────────────────────────────────────────────────────

  addBody(entityId: string, config: PhysicsBodyConfig): PhysicsBody {
    let shape: CollisionShape;
    if (config.shape === 'sphere') {
      shape = { shape: 'sphere', radius: config.radius ?? 0.5 };
    } else {
      shape = { shape: 'aabb', halfExtents: config.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 } };
    }

    const body: PhysicsBody = {
      entityId,
      shape,
      layer: config.layer ?? 'environment',
      isStatic: config.isStatic ?? false,
      isTrigger: (config.isTrigger || config.isSensor) ?? false,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      force: { x: 0, y: 0, z: 0 },
      mass: 1,
      friction: 0.85,
      gravityScale: config.isStatic ? 0 : 1,
      grounded: false,
    };

    this.bodies.set(entityId, body);
    this.rapierKernel?.upsertBody(entityId, config, body);
    gameBus.emit('stateMutation', {
      source: 'PhysicsSystem',
      path: 'physics.bodyAdded',
      changedCount: 1,
    });
    return body;
  }

  removeBody(entityId: string): void {
    this.bodies.delete(entityId);
    this.rapierKernel?.removeBody(entityId);
    // Remove any active pair involving this entity
    this.activePairs.forEach((key) => {
      if (key.includes(entityId)) this.activePairs.delete(key);
    });
    gameBus.emit('stateMutation', {
      source: 'PhysicsSystem',
      path: 'physics.bodyRemoved',
      changedCount: 1,
    });
  }

  getBody(entityId: string): PhysicsBody | undefined {
    return this.bodies.get(entityId);
  }

  hasBody(entityId: string): boolean {
    return this.bodies.has(entityId);
  }

  getBodyIds(): string[] {
    return [...this.bodies.keys()];
  }

  // ─── Forces & velocity ───────────────────────────────────────────────────────

  applyForce(entityId: string, force: Vector3): void {
    const body = this.bodies.get(entityId);
    if (!body || body.isStatic) return;
    body.force.x += force.x;
    body.force.y += force.y;
    body.force.z += force.z;
  }

  setVelocity(entityId: string, vel: Vector3): void {
    const body = this.bodies.get(entityId);
    if (!body) return;
    body.velocity = { ...vel };
  }

  addVelocity(entityId: string, delta: Vector3): void {
    const body = this.bodies.get(entityId);
    if (!body) return;
    body.velocity.x += delta.x;
    body.velocity.y += delta.y;
    body.velocity.z += delta.z;
  }

  getVelocity(entityId: string): Vector3 {
    return { ...(this.bodies.get(entityId)?.velocity ?? { x: 0, y: 0, z: 0 }) };
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  /**
   * Main update. Call once per frame.
   * @param entityPositions  Current world positions keyed by entity ID.
   * @param deltaTime        Seconds since last frame.
   * @returns                New positions for dynamic bodies (caller applies them).
   */
  update(
    entityPositions: Map<string, Vector3>,
    deltaTime: number,
  ): Map<string, Vector3> {
    if (
      this.gravity.x !== this.lastMirroredGravity.x ||
      this.gravity.y !== this.lastMirroredGravity.y ||
      this.gravity.z !== this.lastMirroredGravity.z
    ) {
      this.rapierKernel?.onGravityChanged(this.gravity);
      this.lastMirroredGravity = { ...this.gravity };
    }

    const dt = Math.min(deltaTime, 0.05); // cap integration step

    // 1. Sync positions from the game world
    entityPositions.forEach((pos, id) => {
      const body = this.bodies.get(id);
      if (body) body.position = { ...pos };
      this.rapierKernel?.syncBodyPose(id, pos);
    });

    this.rapierKernel?.step();

    // 2. Integrate dynamic bodies
    this.bodies.forEach((body) => {
      if (body.isStatic) return;

      // Apply gravity
      body.velocity.x += this.gravity.x * body.gravityScale * dt;
      body.velocity.y += this.gravity.y * body.gravityScale * dt;
      body.velocity.z += this.gravity.z * body.gravityScale * dt;

      // Apply accumulated forces  (F = ma => a = F/m)
      body.velocity.x += (body.force.x / body.mass) * dt;
      body.velocity.y += (body.force.y / body.mass) * dt;
      body.velocity.z += (body.force.z / body.mass) * dt;
      body.force = { x: 0, y: 0, z: 0 };

      // Integrate
      body.position.x += body.velocity.x * dt;
      body.position.y += body.velocity.y * dt;
      body.position.z += body.velocity.z * dt;

      // Horizontal friction (when grounded)
      if (body.grounded) {
        body.velocity.x *= body.friction;
        body.velocity.z *= body.friction;
      }

      body.grounded = false; // reset each frame; collision resolution sets it back
    });

    // 3. Collision detection & resolution
    this._detectAndResolve();

    // 4. Build output position map for dynamic bodies
    const result = new Map<string, Vector3>();
    this.bodies.forEach((body) => {
      if (!body.isStatic) result.set(body.entityId, { ...body.position });
    });
    this.lastDynamicBodyCount = result.size;

    return result;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        backendMode: this.backendMode,
        bodyCount: this.bodies.size,
        activePairs: this.activePairs.size,
        dynamicBodies: this.lastDynamicBodyCount,
        lastCollisionCount: this.lastCollisionCount,
        lastTriggerEnterCount: this.lastTriggerEnterCount,
        lastTriggerExitCount: this.lastTriggerExitCount,
        gravity: this.gravity,
        maxSlopeAngle: this.maxSlopeAngle,
        rapier: this.rapierKernel?.getDiagnostics() ?? null,
      },
    };
  }

  // ─── Raycasting ──────────────────────────────────────────────────────────────

  /**
   * Cast a ray and return all hits sorted by distance.
   */
  raycast(origin: Vector3, direction: Vector3, cfg: RaycastConfig = {}): RaycastHit[] {
    if (this.backendMode === 'rapier' && this.rapierKernel?.isReady()) {
      const rapierHits = this.rapierKernel.raycast(origin, direction, cfg);
      if (rapierHits) {
        return rapierHits;
      }
    }

    const maxDist = cfg.maxDistance ?? 1000;
    const dir = v3norm(direction);
    const hits: RaycastHit[] = [];

    this.bodies.forEach((body) => {
      if (cfg.ignore?.includes(body.entityId)) return;
      if (cfg.layerMask && !cfg.layerMask.includes(body.layer)) return;

      const hit = this._rayVsBody(origin, dir, maxDist, body);
      if (hit) hits.push(hit);
    });

    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }

  /** Convenience: return only the closest hit or null. */
  raycastFirst(origin: Vector3, direction: Vector3, cfg: RaycastConfig = {}): RaycastHit | null {
    const hits = this.raycast(origin, direction, cfg);
    return hits[0] ?? null;
  }

  // ─── Events ──────────────────────────────────────────────────────────────────

  onCollision(cb: CollisionCallback): () => void {
    this.collisionCallbacks.push(cb);
    return () => { this.collisionCallbacks = this.collisionCallbacks.filter((c) => c !== cb); };
  }

  onTriggerEnter(cb: CollisionCallback): () => void {
    this.triggerEnterCallbacks.push(cb);
    return () => { this.triggerEnterCallbacks = this.triggerEnterCallbacks.filter((c) => c !== cb); };
  }

  onTriggerExit(cb: CollisionCallback): () => void {
    this.triggerExitCallbacks.push(cb);
    return () => { this.triggerExitCallbacks = this.triggerExitCallbacks.filter((c) => c !== cb); };
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private _pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  private _shouldTest(layerA: CollisionLayer, layerB: CollisionLayer): boolean {
    return COLLISION_MATRIX.some(
      ([l1, l2]) => (l1 === layerA && l2 === layerB) || (l1 === layerB && l2 === layerA),
    );
  }

  private _testPair(bodyA: PhysicsBody, bodyB: PhysicsBody): CollisionInfo | null {
    const sA = bodyA.shape;
    const sB = bodyB.shape;

    if (sA.shape === 'aabb' && sB.shape === 'aabb') {
      return aabbVsAabb(bodyA.position, sA.halfExtents, bodyB.position, sB.halfExtents);
    }
    if (sA.shape === 'sphere' && sB.shape === 'sphere') {
      return sphereVsSphere(bodyA.position, sA.radius, bodyB.position, sB.radius);
    }
    if (sA.shape === 'sphere' && sB.shape === 'aabb') {
      return sphereVsAabb(bodyA.position, sA.radius, bodyB.position, sB.halfExtents);
    }
    if (sA.shape === 'aabb' && sB.shape === 'sphere') {
      const info = sphereVsAabb(bodyB.position, sB.radius, bodyA.position, sA.halfExtents);
      if (info) return { normal: v3scale(info.normal, -1), depth: info.depth };
      return null;
    }
    return null;
  }

  private _detectAndResolve(): void {
    const bodies = Array.from(this.bodies.values());
    const newActivePairs = new Set<string>();
    let collisionCount = 0;
    let triggerEnterCount = 0;
    let triggerExitCount = 0;

    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];

        if (!this._shouldTest(a.layer, b.layer)) continue;
        if (a.isStatic && b.isStatic) continue;

        const info = this._testPair(a, b);
        if (!info) continue;

        const key = this._pairKey(a.entityId, b.entityId);
        const isTrigger = a.isTrigger || b.isTrigger;

        if (isTrigger) {
          if (!this.activePairs.has(key)) {
            triggerEnterCount += 1;
            this.triggerEnterCallbacks.forEach((cb) => cb({ entityA: a.entityId, entityB: b.entityId, info }));
          }
          newActivePairs.add(key);
        } else {
          // Solid collision — resolve penetration
          this._resolve(a, b, info);
          collisionCount += 1;
          this.collisionCallbacks.forEach((cb) => cb({ entityA: a.entityId, entityB: b.entityId, info }));
        }
      }
    }

    // Trigger exit
    this.activePairs.forEach((key) => {
      if (!newActivePairs.has(key)) {
        const [idA, idB] = key.split('|');
        const a = this.bodies.get(idA);
        const b = this.bodies.get(idB);
        const info: CollisionInfo = { normal: { x: 0, y: 1, z: 0 }, depth: 0 };
        if (a && b) {
          triggerExitCount += 1;
          this.triggerExitCallbacks.forEach((cb) => cb({ entityA: idA, entityB: idB, info }));
        }
      }
    });
    this.activePairs = newActivePairs;
    this.lastCollisionCount = collisionCount;
    this.lastTriggerEnterCount = triggerEnterCount;
    this.lastTriggerExitCount = triggerExitCount;
  }

  private _resolve(a: PhysicsBody, b: PhysicsBody, info: CollisionInfo): void {
    const { normal, depth } = info;

    // Push apart — distribute based on mass (static = infinite mass)
    const totalMass = (a.isStatic ? 0 : 1) + (b.isStatic ? 0 : 1);
    if (totalMass === 0) return;

    const ratioA = a.isStatic ? 0 : 1 / totalMass;
    const ratioB = b.isStatic ? 0 : 1 / totalMass;
    const push = depth + 0.001; // small bias to prevent re-collision next frame

    if (!a.isStatic) {
      a.position.x += normal.x * push * ratioA;
      a.position.y += normal.y * push * ratioA;
      a.position.z += normal.z * push * ratioA;
    }
    if (!b.isStatic) {
      b.position.x -= normal.x * push * ratioB;
      b.position.y -= normal.y * push * ratioB;
      b.position.z -= normal.z * push * ratioB;
    }

    // Stop velocity component along normal (inelastic collision)
    const relVel = v3sub(a.velocity, b.velocity);
    const relVelAlongNormal = v3dot(relVel, normal);
    if (relVelAlongNormal < 0) {
      const impulse = relVelAlongNormal;
      if (!a.isStatic) {
        a.velocity.x -= normal.x * impulse * ratioA;
        a.velocity.y -= normal.y * impulse * ratioA;
        a.velocity.z -= normal.z * impulse * ratioA;
      }
      if (!b.isStatic) {
        b.velocity.x += normal.x * impulse * ratioB;
        b.velocity.y += normal.y * impulse * ratioB;
        b.velocity.z += normal.z * impulse * ratioB;
      }
    }

    // Mark grounded when normal has significant upward component
    const upDot = v3dot(normal, { x: 0, y: 1, z: 0 });
    const slopeThreshold = Math.cos((this.maxSlopeAngle * Math.PI) / 180);
    if (!a.isStatic && upDot > slopeThreshold)  a.grounded = true;
    if (!b.isStatic && upDot < -slopeThreshold) b.grounded = true;
  }

  private _rayVsBody(
    origin: Vector3,
    dir: Vector3,
    maxDist: number,
    body: PhysicsBody,
  ): RaycastHit | null {
    if (body.shape.shape === 'sphere') {
      return this._rayVsSphere(origin, dir, maxDist, body);
    }
    return this._rayVsAabb(origin, dir, maxDist, body);
  }

  private _rayVsAabb(
    origin: Vector3,
    dir: Vector3,
    maxDist: number,
    body: PhysicsBody,
  ): RaycastHit | null {
    const ext = (body.shape as AABBShape).halfExtents;
    const min = v3sub(body.position, ext);
    const max = v3add(body.position, ext);

    let tMin = 0;
    let tMax = maxDist;
    let hitNormal: Vector3 = { x: 0, y: 1, z: 0 };

    const axes: Array<keyof Vector3> = ['x', 'y', 'z'];
    for (const axis of axes) {
      const d = dir[axis];
      const o = origin[axis];
      const mn = min[axis];
      const mx = max[axis];
      if (Math.abs(d) < 1e-10) {
        if (o < mn || o > mx) return null;
      } else {
        let t1 = (mn - o) / d;
        let t2 = (mx - o) / d;
        let n: Vector3 = { x: 0, y: 0, z: 0 };
        if (t1 > t2) { [t1, t2] = [t2, t1]; n[axis] = 1; } else { n[axis] = -1; }
        if (t1 > tMin) { tMin = t1; hitNormal = n; }
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
      }
    }
    if (tMin < 0) return null;
    const point = v3add(origin, v3scale(dir, tMin));
    return { entityId: body.entityId, distance: tMin, point, normal: hitNormal };
  }

  private _rayVsSphere(
    origin: Vector3,
    dir: Vector3,
    maxDist: number,
    body: PhysicsBody,
  ): RaycastHit | null {
    const r = (body.shape as SphereShape).radius;
    const oc = v3sub(origin, body.position);
    const b = v3dot(oc, dir);
    const c = v3dot(oc, oc) - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > maxDist) return null;
    const point = v3add(origin, v3scale(dir, t));
    const normal = v3norm(v3sub(point, body.position));
    return { entityId: body.entityId, distance: t, point, normal };
  }

  // ─── Spatial queries ─────────────────────────────────────────────────────────

  private _sphereIntersectsBody(centre: Vector3, radius: number, body: PhysicsBody): boolean {
    if (body.shape.shape === 'sphere') {
      const d = v3len(v3sub(centre, body.position));
      return d < radius + body.shape.radius;
    }
    return sphereVsAabb(centre, radius, body.position, body.shape.halfExtents) !== null;
  }

  /** All entities whose bodies overlap this sphere. */
  overlapSphere(centre: Vector3, radius: number, layerMask?: CollisionLayer[]): string[] {
    const results: string[] = [];
    this.bodies.forEach((body) => {
      if (layerMask && !layerMask.includes(body.layer)) return;
      if (this._sphereIntersectsBody(centre, radius, body)) {
        results.push(body.entityId);
      }
    });
    return results;
  }

  /**
   * Filterable sphere overlap query that preserves the existing overlapSphere API.
   */
  overlapSphereFiltered(centre: Vector3, radius: number, query: OverlapQueryConfig = {}): string[] {
    const results: string[] = [];
    this.bodies.forEach((body) => {
      if (query.layerMask && !query.layerMask.includes(body.layer)) return;
      if (query.ignore?.includes(body.entityId)) return;
      if (!query.includeTriggers && body.isTrigger) return;
      if (this._sphereIntersectsBody(centre, radius, body)) {
        results.push(body.entityId);
      }
    });
    return results;
  }

  /**
   * Ring/donut query in XZ space.
   * Includes entities with distance in [innerRadius, outerRadius].
   */
  overlapRing(
    centre: Vector3,
    innerRadius: number,
    outerRadius: number,
    query: OverlapQueryConfig = {},
  ): string[] {
    const results: string[] = [];
    const minR = Math.max(0, Math.min(innerRadius, outerRadius));
    const maxR = Math.max(innerRadius, outerRadius);

    this.bodies.forEach((body) => {
      if (query.layerMask && !query.layerMask.includes(body.layer)) return;
      if (query.ignore?.includes(body.entityId)) return;
      if (!query.includeTriggers && body.isTrigger) return;

      const dx = body.position.x - centre.x;
      const dz = body.position.z - centre.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const bodyRadius = body.shape.shape === 'sphere'
        ? (body.shape as SphereShape).radius
        : v3len((body.shape as AABBShape).halfExtents);

      if (dist + bodyRadius >= minR && dist <= maxR + bodyRadius) {
        results.push(body.entityId);
      }
    });

    return results;
  }

  /**
   * Cone query in XZ space, useful for directional AoE / cleave attacks.
   */
  overlapCone(
    origin: Vector3,
    direction: Vector3,
    range: number,
    angleDeg: number,
    query: OverlapQueryConfig = {},
  ): string[] {
    const results: string[] = [];
    const dir = v3norm({ x: direction.x, y: 0, z: direction.z });
    const cosHalf = Math.cos((Math.max(0, angleDeg) * Math.PI) / 360);

    this.bodies.forEach((body) => {
      if (query.layerMask && !query.layerMask.includes(body.layer)) return;
      if (query.ignore?.includes(body.entityId)) return;
      if (!query.includeTriggers && body.isTrigger) return;

      const to = {
        x: body.position.x - origin.x,
        y: 0,
        z: body.position.z - origin.z,
      };
      const dist = v3len(to);
      if (dist > range) return;
      if (dist <= 1e-5) {
        results.push(body.entityId);
        return;
      }

      const toNorm = v3norm(to);
      const dot = dir.x * toNorm.x + dir.z * toNorm.z;
      if (dot >= cosHalf) results.push(body.entityId);
    });

    return results;
  }

  /** Convenience: are two specific bodies currently overlapping? */
  isOverlapping(entityA: string, entityB: string): boolean {
    const a = this.bodies.get(entityA);
    const b = this.bodies.get(entityB);
    if (!a || !b) return false;
    return this._testPair(a, b) !== null;
  }

  /** Linearly interpolate a body toward a target position (used by AI). */
  moveToward(entityId: string, target: Vector3, speed: number, dt: number): void {
    const body = this.bodies.get(entityId);
    if (!body) return;
    const dir = v3sub(target, body.position);
    const dist = v3len(dir);
    if (dist < 0.01) return;
    const step = Math.min(speed * dt, dist);
    const norm = v3scale(dir, 1 / dist);
    body.position = v3lerp(body.position, v3add(body.position, v3scale(norm, step)), 1);
  }

  /**
   * TIER 0B: Clear all physics state for mode transition cleanup
   * Removes all bodies and resets collision tracking
   * Called during ModeTransitionManager cleanup sequence (STEP 5)
   */
  clear(): void {
    // Clear all physics bodies
    this.bodies.clear();
    this.rapierKernel?.clear();

    // Clear collision tracking
    this.activePairs.clear();

    // Clear callback arrays
    this.collisionCallbacks = [];
    this.triggerEnterCallbacks = [];
    this.triggerExitCallbacks = [];

    // Reset statistics
    this.lastCollisionCount = 0;
    this.lastTriggerEnterCount = 0;
    this.lastTriggerExitCount = 0;
    this.lastDynamicBodyCount = 0;

    console.log('[PhysicsSystem] Cleared all physics state (TIER 0B cleanup)');
  }
}
