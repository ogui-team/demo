/**
 * ColliderComponent
 * Describes the collision shape of an EngineObject.
 * Used by raycasting, hit detection, and physics queries.
 *
 * The engine stores this in StateManager so server-side validation
 * can replicate the same collision shapes without a physics library.
 */

export type ColliderShape = 'box' | 'sphere' | 'capsule';

export interface ColliderSize {
  // box
  width?: number;
  height?: number;
  depth?: number;
  // sphere
  radius?: number;
  // capsule
  capsuleRadius?: number;
  capsuleHeight?: number;
}

export interface ColliderComponent {
  readonly type: 'collider';
  shape: ColliderShape;
  size: ColliderSize;
  /** Offset from the entity root position */
  offset?: { x: number; y: number; z: number };
  /** If true raycasts will hit this object but it won't block movement */
  isTrigger?: boolean;
  /** Layer mask for selective collision queries */
  layer?: number;
  /** Visible debug wireframe (editor only) */
  showDebug?: boolean;
}

export function createBoxCollider(
  width = 1,
  height = 1,
  depth = 1,
  options: Partial<Omit<ColliderComponent, 'type' | 'shape' | 'size'>> = {},
): ColliderComponent {
  return { type: 'collider', shape: 'box', size: { width, height, depth }, ...options };
}

export function createSphereCollider(
  radius = 0.5,
  options: Partial<Omit<ColliderComponent, 'type' | 'shape' | 'size'>> = {},
): ColliderComponent {
  return { type: 'collider', shape: 'sphere', size: { radius }, ...options };
}

export function createCapsuleCollider(
  radius = 0.4,
  height = 1.2,
  options: Partial<Omit<ColliderComponent, 'type' | 'shape' | 'size'>> = {},
): ColliderComponent {
  return { type: 'collider', shape: 'capsule', size: { capsuleRadius: radius, capsuleHeight: height }, ...options };
}
