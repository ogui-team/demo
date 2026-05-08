export type ActorLifecycleState = 'spawned' | 'active' | 'destroyed';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface ActorMotionProfile {
  moveSpeed: number;
  detectionRange: number;
  stopRange: number;
  returnRange: number;
  syncInterval: number;
}

export interface ActorRecord extends Vec3Like {
  id: string;
  profileId: string;
  entityType: string;
  lifecycleState: ActorLifecycleState;
  objectId: string;
  position: Vec3Like;
  rotation: Vec3Like;
  velocity: Vec3Like;
  spawnPosition: Vec3Like;
  motion: ActorMotionProfile;
}
