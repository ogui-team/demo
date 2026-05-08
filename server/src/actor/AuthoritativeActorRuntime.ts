import type { ActorMotionProfile, ActorRecord } from './ActorContract';
import type { Vector3 as Vec3 } from '@shared/contracts';
export type { Vec3 };

export interface RuntimeWorldObjectState {
  id: string;
  entityType: string;
  position: Vec3;
  rotation: Vec3;
  renderData: {
    meshType: string;
    color: number;
    geometry: Record<string, unknown>;
  };
}

export interface AuthoritativeActorRuntimeHost {
  sessionId: string;
  hasActiveActors(): boolean;
  resolveMovement(actor: RuntimeActorRecord, desiredStep: Vec3, halfExtents: Vec3, collisionRadius: number): Vec3;
  upsertWorldObject(object: RuntimeWorldObjectState, halfExtents: Vec3): boolean;
  removeWorldObject(id: string): boolean;
  broadcastWorldObjectPlacedOrUpdated(object: RuntimeWorldObjectState, existed: boolean): void;
  broadcastWorldObjectRemoved(id: string): void;
}

export interface AuthoritativeActorProfile {
  id: string;
  entityType: string;
  halfExtents: Vec3;
  collisionRadius: number;
  renderData: RuntimeWorldObjectState['renderData'];
  motion: ActorMotionProfile;
  createObjectId(sessionId: string): string;
  resolveSpawnPosition(): Vec3;
  resolveGoal(actor: RuntimeActorRecord): { position: Vec3; stopRange: number };
}

export interface RuntimeActorRecord extends ActorRecord {
  halfExtents: Vec3;
  collisionRadius: number;
}

export class AuthoritativeActorRuntime {
  private readonly host: AuthoritativeActorRuntimeHost;
  private readonly profiles = new Map<string, AuthoritativeActorProfile>();
  private readonly actors = new Map<string, RuntimeActorRecord>();
  private lastUpdatedActors = 0;
  private lastMovedActors = 0;

  constructor(host: AuthoritativeActorRuntimeHost) {
    this.host = host;
  }

  registerProfile(profile: AuthoritativeActorProfile): void {
    this.profiles.set(profile.id, profile);
  }

  ensureSingleton(profileId: string): RuntimeActorRecord | null {
    if (!this.host.hasActiveActors()) {
      this.destroyActor(profileId);
      return null;
    }

    const existing = this.actors.get(profileId);
    if (existing) return existing;

    const profile = this.profiles.get(profileId);
    if (!profile) return null;

    const spawnPosition = profile.resolveSpawnPosition();
    const actor: RuntimeActorRecord = {
      id: profileId,
      profileId,
      entityType: profile.entityType,
      lifecycleState: 'spawned',
      objectId: profile.createObjectId(this.host.sessionId),
      position: { ...spawnPosition },
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      spawnPosition: { ...spawnPosition },
      motion: { ...profile.motion },
      halfExtents: { ...profile.halfExtents },
      collisionRadius: profile.collisionRadius,
      x: 0,
      y: 0,
      z: 0,
    };

    this.actors.set(profileId, actor);
    const worldObject = this.toWorldObject(profile, actor);
    const existed = this.host.upsertWorldObject(worldObject, actor.halfExtents);
    this.host.broadcastWorldObjectPlacedOrUpdated(worldObject, existed);
    actor.lifecycleState = 'active';
    return actor;
  }

  destroyActor(profileId: string): void {
    const actor = this.actors.get(profileId);
    if (!actor) return;
    actor.lifecycleState = 'destroyed';
    this.actors.delete(profileId);
    if (this.host.removeWorldObject(actor.objectId)) {
      this.host.broadcastWorldObjectRemoved(actor.objectId);
    }
  }

  update(dt: number): void {
    let updatedActors = 0;
    let movedActors = 0;

    for (const actor of this.actors.values()) {
      const profile = this.profiles.get(actor.profileId);
      if (!profile) continue;

      const goal = profile.resolveGoal(actor);
      const dx = goal.position.x - actor.position.x;
      const dz = goal.position.z - actor.position.z;
      const distance = Math.hypot(dx, dz);

      let nextPosition = { ...actor.position };
      let nextVelocity = { x: 0, y: 0, z: 0 };
      if (distance > goal.stopRange + 0.05) {
        const moveDistance = Math.min(actor.motion.moveSpeed * dt, Math.max(0, distance - goal.stopRange));
        const desiredStep = {
          x: (dx / distance) * moveDistance,
          y: 0,
          z: (dz / distance) * moveDistance,
        };
        nextPosition = this.host.resolveMovement(actor, desiredStep, actor.halfExtents, actor.collisionRadius);
        nextVelocity = {
          x: (nextPosition.x - actor.position.x) / Math.max(dt, 0.0001),
          y: 0,
          z: (nextPosition.z - actor.position.z) / Math.max(dt, 0.0001),
        };
      }

      let nextYaw = actor.rotation.y;
      const faceDx = goal.position.x - nextPosition.x;
      const faceDz = goal.position.z - nextPosition.z;
      if (Math.hypot(faceDx, faceDz) > 0.001) {
        nextYaw = Math.atan2(-faceDx, -faceDz);
      }

      const positionChanged = distanceBetween(actor.position, nextPosition) > 0.01;
      const rotationDelta = Math.abs(Math.atan2(Math.sin(nextYaw - actor.rotation.y), Math.cos(nextYaw - actor.rotation.y)));
      if (!positionChanged && rotationDelta <= 0.02) {
        continue;
      }

      actor.position = nextPosition;
      actor.velocity = nextVelocity;
      actor.rotation = { x: 0, y: nextYaw, z: 0 };
      const worldObject = this.toWorldObject(profile, actor);
      this.host.upsertWorldObject(worldObject, actor.halfExtents);
      this.host.broadcastWorldObjectPlacedOrUpdated(worldObject, true);
      updatedActors += 1;
      if (positionChanged) movedActors += 1;
    }

    this.lastUpdatedActors = updatedActors;
    this.lastMovedActors = movedActors;
  }

  getActorCount(): number {
    return this.actors.size;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      actorCount: this.actors.size,
      lastUpdatedActors: this.lastUpdatedActors,
      lastMovedActors: this.lastMovedActors,
      profileCount: this.profiles.size,
    };
  }

  private toWorldObject(profile: AuthoritativeActorProfile, actor: RuntimeActorRecord): RuntimeWorldObjectState {
    return {
      id: actor.objectId,
      entityType: actor.entityType,
      position: { ...actor.position },
      rotation: { ...actor.rotation },
      renderData: {
        meshType: profile.renderData.meshType,
        color: profile.renderData.color,
        geometry: { ...profile.renderData.geometry },
      },
    };
  }
}

function distanceBetween(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}
