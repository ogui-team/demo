import { PHYSICS_CONSTANTS } from '../../PhysicsConstants';
import { Entity, Vector3 } from '../../1-kernel/core/Entity';
import type { StatusMovementModifier } from './MovementModifierContracts';
import type { MovementFeelDebugConfig, MovementTuningConfig, ResolvedMovementTuningConfig } from './MovementTuningConfig';

export interface NetworkManagerAdapter {
  onInputCommand(callback: (command: unknown) => void): () => void;
  onSnapshot(callback: (snapshot: unknown) => void): () => void;
  onHitValidationResult(callback: (result: unknown) => void): () => void;
  onHitValidationRequest(callback: (request: unknown) => void): () => void;
  onAbilityRequest(callback: (request: unknown) => void): () => void;
  onAbilityValidation(callback: (validation: unknown) => void): () => void;
  nextInputSequence(): number;
  sendInputCommand(command: unknown): void;
  sendAbilityRequest(request: unknown): void;
  sendHitValidationRequest(request: unknown): void;
  getLocalPlayerId(): string;
  sendSnapshot(snapshot: unknown): void;
  sendHitValidationResult(result: unknown): void;
  sendAbilityValidation(validation: unknown): void;
}

export interface NetworkSyncEntityManagerAdapter {
  getEntities(): Entity[];
}

interface ReplicationBindingAdapter {
  entity: Entity;
  instance?: object;
  velocityProvider?: () => Vector3;
}

export interface ReplicationSystemAdapter {
  unregisterBinding(entityId: string): void;
  registerBinding(entityId: string, binding: ReplicationBindingAdapter): void;
  applySnapshots(snapshots: unknown[]): string[];
  applySnapshot(snapshot: unknown, options?: { preservePosition?: boolean; preserveRotation?: boolean }): boolean;
  captureSnapshots(entityIds?: string[], tick?: number, deltaOnly?: boolean): unknown[];
}

export interface SpatialPartitionAdapter {
  updateEntry(id: string, position: Vector3, options?: {
    radius?: number;
    tags?: string[];
    isActive?: boolean;
    lastUsedTime?: number;
  }): void;
  markUsed(id: string, timestamp?: number): void;
  getRelevantEntityIds(center: Vector3, radius: number): string[];
}

export interface NetworkEntityIdRegistrar {
  reserveHandleForPlayer(playerId: string): boolean;
  registerNetworkEntityIdMapping(playerId: string, networkEntityId: string | number): boolean;
  hasHandleForNetworkEntityId(networkEntityId: string | number): boolean;
}

export interface NetworkSyncBinding {
  playerId: string;
  entity: Entity;
  movementSpeed?: number;
  acceleration?: number;
  collisionRadius?: number;
  replicatedInstance?: object;
  networkEntityId?: string;
}

export interface NetworkMovementIntent {
  horizontalImpulse: number;
  direction: Vector3;
  jump?: boolean;
  crouch?: boolean;
  verticalImpulse?: number;
}

export interface MovementAuthorityDebugState {
  playerId: string | null;
  entityId: string | null;
  networkEntityId: string | null;
  currentPosition: Vector3 | null;
  movementIntent: NetworkMovementIntent | null;
  statusMovementModifier: StatusMovementModifier | null;
  derivedStatusMovementModifier: StatusMovementModifier | null;
  debugStatusMovementModifier: StatusMovementModifier | null;
  effectiveStatusMovementModifier: StatusMovementModifier | null;
}

export interface MovementTuningDebugState {
  playerId: string | null;
  base: MovementTuningConfig | null;
  live: ResolvedMovementTuningConfig | null;
  hasDebugOverride: boolean;
  hooks: {
    jumpPrepared: boolean;
    sprintPrepared: boolean;
    airControlPrepared: boolean;
    jumpRequested: boolean;
    sprintRequested: boolean;
    airborne: boolean;
    airControlEnabled: boolean;
    lastJumpImpulse: number;
  } | null;
}

export interface NetworkSyncConfig {
  networkManager: NetworkManagerAdapter;
  entityManager: NetworkSyncEntityManagerAdapter;
  replicationSystem: ReplicationSystemAdapter;
  spatialPartition: SpatialPartitionAdapter;
  tickRate?: number;
  historySeconds?: number;
  relevanceRadius?: number;
  simulateAuthority?: boolean;
}

export type NetworkAuthorityMode = 'local' | 'remote';
export type RemotePredictionMode = 'full' | 'rotation-only';

export interface HistoryFrame {
  tick: number;
  timestamp: number;
  entities: Map<string, unknown>;
}

export interface PendingAuthorityBinding {
  playerId: string;
  networkEntityId: string;
  queuedAt: number;
  lastCheckAt: number;
  checkCount: number;
}

export interface ResolvedStatusMovementModifier {
  speedMultiplier: number;
  blockMovement: boolean;
  impulseOverride: Vector3 | null;
}

export function cloneVector(vector: Vector3 | undefined): Vector3 {
  if (!vector) return { x: 0, y: 0, z: 0 };
  return { x: vector.x, y: vector.y, z: vector.z };
}

export const MOVEMENT_JUMP_BUFFER_SECONDS = PHYSICS_CONSTANTS.PLAYER_JUMP_BUFFER_SECONDS;
export const MOVEMENT_COYOTE_TIME_SECONDS = PHYSICS_CONSTANTS.PLAYER_COYOTE_TIME_SECONDS;
export const LOCAL_RECONCILIATION_LERP_FACTOR = PHYSICS_CONSTANTS.CLIENT_RECONCILIATION_LERP_FACTOR;
export const LOCAL_DESYNC_WARNING_DISTANCE = PHYSICS_CONSTANTS.CLIENT_DESYNC_WARNING_DISTANCE;
export const LOCAL_DESYNC_WARNING_STREAK = PHYSICS_CONSTANTS.CLIENT_DESYNC_WARNING_STREAK;
export const LOCAL_VELOCITY_STOP_THRESHOLD = PHYSICS_CONSTANTS.CLIENT_LOCAL_VELOCITY_STOP_THRESHOLD;
export const CORRECTION_THRESHOLD = PHYSICS_CONSTANTS.CLIENT_CORRECTION_THRESHOLD;
export const POSITION_ERROR_DECAY_MS = PHYSICS_CONSTANTS.CLIENT_POSITION_ERROR_DECAY_MS;
export const POSITION_ERROR_DECAY_FACTOR = PHYSICS_CONSTANTS.CLIENT_POSITION_ERROR_DECAY_FACTOR;
