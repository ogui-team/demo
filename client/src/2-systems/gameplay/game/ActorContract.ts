import type { Vector3 } from '@engine/1-kernel/core/public-api';

export type ActorLifecycleState = 'spawned' | 'active' | 'destroyed';

export interface ActorMotionProfile {
  moveSpeed: number;
  detectionRange: number;
  stopRange: number;
  returnRange: number;
  syncInterval: number;
}

export interface ActorTransformState {
  position: Vector3;
  rotation: Vector3;
  velocity: Vector3;
}

export interface ActorRecord extends ActorTransformState {
  id: string;
  profileId: string;
  entityType: string;
  lifecycleState: ActorLifecycleState;
  spawnPosition: Vector3;
  motion: ActorMotionProfile;
}
