import { gameBus } from '@engine/1-kernel/core/public-api';
import type { Entity, Vector3 } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import type { ActorLifecycleState, ActorMotionProfile } from './ActorContract';

interface CharacterEntityManagerAdapter {
  getEntities(): Entity[];
  getEntity(id: string): Entity | undefined;
}

interface CharacterEntityRendererAdapter {
  syncEntity(entity: Entity): void;
}

interface SpatialPartitionAdapter {
  getRelevantEntityIds(center: Vector3, radius: number): string[];
  markUsed(id: string, timestamp?: number): void;
}

interface WorldObjectAuthorityAdapter {
  isServerReplicatedEntity(entityId: string): boolean;
  syncOwnedEntity(entity: Entity): boolean;
}

interface CharacterActorRecord {
  homePosition: Vector3;
  profileId: string;
  syncCooldown: number;
  lifecycleState: ActorLifecycleState;
}

export interface CharacterActorProfile extends ActorMotionProfile {
  id: string;
  matches(entity: Entity): boolean;
}

export interface CharacterActorSystemConfig {
  entityManager: CharacterEntityManagerAdapter;
  entityRenderer: CharacterEntityRendererAdapter;
  getPlayerEntity: () => Entity | null;
  isEnabled: () => boolean;
  worldObjectAuthority?: WorldObjectAuthorityAdapter | null;
  spatialPartition?: SpatialPartitionAdapter | null;
  profiles: CharacterActorProfile[];
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export class CharacterActorSystem {
  private readonly entityManager: CharacterEntityManagerAdapter;
  private readonly entityRenderer: CharacterEntityRendererAdapter;
  private readonly getPlayerEntity: () => Entity | null;
  private readonly isEnabled: () => boolean;
  private readonly worldObjectAuthority: WorldObjectAuthorityAdapter | null;
  private readonly spatialPartition: SpatialPartitionAdapter | null;
  private readonly profiles: CharacterActorProfile[];
  private readonly trackedActors = new Map<string, CharacterActorRecord>();
  private systemContext: SystemContext | null = null;
  private lastUpdatedActors = 0;
  private lastMovedActors = 0;
  private lastSpatialCandidates = 0;
  private lastSpatialQueries = 0;

  constructor(config: CharacterActorSystemConfig) {
    this.entityManager = config.entityManager;
    this.entityRenderer = config.entityRenderer;
    this.getPlayerEntity = config.getPlayerEntity;
    this.isEnabled = config.isEnabled;
    this.worldObjectAuthority = config.worldObjectAuthority ?? null;
    this.spatialPartition = config.spatialPartition ?? null;
    this.profiles = [...config.profiles];
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: this.getDiagnostics(),
    };
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      profileCount: this.profiles.length,
      trackedActors: this.trackedActors.size,
      lastUpdatedActors: this.lastUpdatedActors,
      lastMovedActors: this.lastMovedActors,
      lastSpatialCandidates: this.lastSpatialCandidates,
      lastSpatialQueries: this.lastSpatialQueries,
      hasSystemContext: this.systemContext !== null,
    };
  }

  clearRuntimeState(): void {
    this.trackedActors.clear();
    this.lastUpdatedActors = 0;
    this.lastMovedActors = 0;
    this.lastSpatialCandidates = 0;
    this.lastSpatialQueries = 0;
  }

  update(dt: number): void {
    if (!this.isEnabled()) return;

    const playerEntity = this.getPlayerEntity();
    const playerPosition = playerEntity?.getPosition() ?? null;
    const safeDt = Math.min(Math.max(dt, 0), 0.1);
    const candidateIds = this.collectCandidateIds(playerPosition);
    const activeIds = new Set<string>();
    let updatedActors = 0;
    let movedActors = 0;

    for (const entityId of candidateIds) {
      try {
        const entity = this.entityManager.getEntity(entityId);
        if (!entity || !entity.isActive) continue;
        const profile = this.resolveProfile(entity);
        if (!profile) continue;
        if (this.getWorldObjectAuthority()?.isServerReplicatedEntity(entity.id)) continue;

        activeIds.add(entity.id);
        const record = this.ensureRecord(entity, profile.id);
        record.syncCooldown = Math.max(0, record.syncCooldown - safeDt);

        const currentPosition = entity.getPosition();
        const goal = this.resolveGoal(currentPosition, record.homePosition, playerPosition, profile);
        const stopRange = goal === playerPosition ? profile.stopRange : profile.returnRange;
        const dx = goal.x - currentPosition.x;
        const dz = goal.z - currentPosition.z;
        const distance = Math.hypot(dx, dz);

        let nextPosition = currentPosition;
        let nextYaw = entity.getRotation().y;
        let moved = false;

        if (distance > stopRange + 0.01) {
          const step = Math.min(profile.moveSpeed * safeDt, Math.max(0, distance - stopRange));
          nextPosition = {
            x: currentPosition.x + (dx / distance) * step,
            y: currentPosition.y,
            z: currentPosition.z + (dz / distance) * step,
          };
          nextYaw = Math.atan2(-dx, -dz);
          moved = true;
        } else if (distance > 0.001) {
          nextYaw = Math.atan2(-dx, -dz);
        }

        const yawChanged = Math.abs(angleDelta(nextYaw, entity.getRotation().y)) > 0.02;
        if (!moved && !yawChanged) continue;

        if (moved) {
          entity.setPosition(nextPosition);
          this.getSpatialPartition()?.markUsed(entity.id);
          movedActors += 1;
        }
        entity.setRotation({ x: 0, y: nextYaw, z: 0 });
        this.entityRenderer.syncEntity(entity);
        updatedActors += 1;

        if (record.syncCooldown <= 0 && this.getWorldObjectAuthority()?.syncOwnedEntity(entity)) {
          record.syncCooldown = profile.syncInterval;
        }
      } catch (error) {
        console.error(`[CharacterActorSystem] Skipping actor update for "${entityId}"`, error);
      }
    }

    for (const trackedId of [...this.trackedActors.keys()]) {
      if (!activeIds.has(trackedId) && !this.getEntityManager().getEntity(trackedId)) {
        this.trackedActors.delete(trackedId);
      }
    }

    this.lastUpdatedActors = updatedActors;
    this.lastMovedActors = movedActors;
    gameBus.emit('characterActorRuntime', {
      action: 'updated',
      trackedActors: this.trackedActors.size,
      updatedActors,
      movedActors,
      spatialCandidates: this.lastSpatialCandidates,
      spatialQueries: this.lastSpatialQueries,
    });
  }

  private collectCandidateIds(playerPosition: Vector3 | null): string[] {
    const candidateIds = new Set<string>();
    this.lastSpatialQueries = 0;

    if (playerPosition && this.spatialPartition && this.profiles.length > 0) {
      const maxDetectionRange = Math.max(...this.profiles.map((profile) => profile.detectionRange));
      for (const id of this.getSpatialPartition()!.getRelevantEntityIds(playerPosition, maxDetectionRange + 4)) {
        candidateIds.add(id);
      }
      this.lastSpatialQueries = 1;
    } else {
      for (const entity of this.getEntityManager().getEntities()) {
        candidateIds.add(entity.id);
      }
    }

    for (const trackedId of this.trackedActors.keys()) {
      candidateIds.add(trackedId);
    }

    this.lastSpatialCandidates = candidateIds.size;
    return [...candidateIds];
  }

  private ensureRecord(entity: Entity, profileId: string): CharacterActorRecord {
    const existing = this.trackedActors.get(entity.id);
    if (existing) return existing;

    const created: CharacterActorRecord = {
      homePosition: entity.getPosition(),
      profileId,
      syncCooldown: 0,
      lifecycleState: 'spawned',
    };
    this.trackedActors.set(entity.id, created);
    return created;
  }

  private resolveProfile(entity: Entity): CharacterActorProfile | null {
    return this.profiles.find((profile) => profile.matches(entity)) ?? null;
  }

  private resolveGoal(
    currentPosition: Vector3,
    homePosition: Vector3,
    playerPosition: Vector3 | null,
    profile: CharacterActorProfile,
  ): Vector3 {
    if (!playerPosition) return homePosition;
    const dx = playerPosition.x - currentPosition.x;
    const dz = playerPosition.z - currentPosition.z;
    const playerDistance = Math.hypot(dx, dz);
    return playerDistance <= profile.detectionRange ? playerPosition : homePosition;
  }

  private getEntityManager(): CharacterEntityManagerAdapter {
    return (this.systemContext?.entityManager as CharacterEntityManagerAdapter | null) ?? this.entityManager;
  }

  private getWorldObjectAuthority(): WorldObjectAuthorityAdapter | null {
    return (this.systemContext?.systems?.worldObjectAuthorityService as WorldObjectAuthorityAdapter | null | undefined)
      ?? this.worldObjectAuthority;
  }

  private getSpatialPartition(): SpatialPartitionAdapter | null {
    return (this.systemContext?.systems?.spatialPartitionSystem as SpatialPartitionAdapter | null | undefined)
      ?? this.spatialPartition;
  }

  dispose(): void {
    // Clear all tracked actors
    this.trackedActors.clear();
    // Reset state
    this.systemContext = null;
    this.lastUpdatedActors = 0;
    this.lastMovedActors = 0;
    this.lastSpatialCandidates = 0;
    this.lastSpatialQueries = 0;
  }
}