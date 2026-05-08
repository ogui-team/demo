/**
 * Transform System
 * Central management of entity transforms through StateManager
 * 
 * All position, rotation, and scale modifications route through StateManager
 * to maintain consistency across editor, multiplayer, and save/load systems.
 */

import { StateManager } from '../../0-foundation/foundation/state/StateManager';
import { Entity, Vector3, Transform } from './Entity';

/**
 * Initialize entity transform in StateManager
 * Called when entity is created
 */
export function initializeEntityTransform(
  entity: Entity,
  stateManager: StateManager,
  transform?: Partial<Transform>
): void {
  const baseTransform = entity.getTransform();
  const finalTransform = { ...baseTransform, ...(transform || {}) };

  // Register entity's transform in StateManager under "entities.<id>"
  stateManager.set(`entities.${entity.id}.position`, finalTransform.position);
  stateManager.set(`entities.${entity.id}.rotation`, finalTransform.rotation);
  stateManager.set(`entities.${entity.id}.scale`, finalTransform.scale || { x: 1, y: 1, z: 1 });
  stateManager.set(`entities.${entity.id}.id`, entity.id);
  stateManager.set(`entities.${entity.id}.type`, entity.type);
}

/**
 * Sync entity's local transform with StateManager
 * Used when entity needs to reflect current StateManager state
 */
export function syncEntityTransformFromState(entity: Entity, stateManager: StateManager): void {
  const position = stateManager.get(`entities.${entity.id}.position`);
  const rotation = stateManager.get(`entities.${entity.id}.rotation`);
  const scale = stateManager.get(`entities.${entity.id}.scale`);

  if (position) entity.setPosition(position as Vector3);
  if (rotation) entity.setRotation(rotation as Vector3);
  if (scale) entity.setScale(scale as Vector3);
}

/**
 * Get entity position from StateManager
 */
export function getPosition(entity: Entity, stateManager: StateManager): Vector3 {
  const pos = stateManager.get(`entities.${entity.id}.position`);
  return pos ? { ...pos } : entity.getPosition();
}

/**
 * Set entity position through StateManager
 * Updates both StateManager and local entity
 */
export function setPosition(entity: Entity, stateManager: StateManager, position: Vector3): void {
  entity.setPosition(position);
  stateManager.set(`entities.${entity.id}.position`, { ...position });
}

/**
 * Get entity rotation from StateManager
 */
export function getRotation(entity: Entity, stateManager: StateManager): Vector3 {
  const rot = stateManager.get(`entities.${entity.id}.rotation`);
  return rot ? { ...rot } : entity.getRotation();
}

/**
 * Set entity rotation through StateManager
 */
export function setRotation(entity: Entity, stateManager: StateManager, rotation: Vector3): void {
  entity.setRotation(rotation);
  stateManager.set(`entities.${entity.id}.rotation`, { ...rotation });
}

/**
 * Get entity scale from StateManager
 */
export function getScale(entity: Entity, stateManager: StateManager): Vector3 {
  const scale = stateManager.get(`entities.${entity.id}.scale`);
  return scale ? { ...scale } : entity.getScale();
}

/**
 * Set entity scale through StateManager
 */
export function setScale(entity: Entity, stateManager: StateManager, scale: Vector3): void {
  entity.setScale(scale);
  stateManager.set(`entities.${entity.id}.scale`, { ...scale });
}

/**
 * Translate (move) entity relative to current position
 * Goes through StateManager for consistency
 */
export function translate(
  entity: Entity,
  stateManager: StateManager,
  dx: number,
  dy: number,
  dz: number
): void {
  const pos = getPosition(entity, stateManager);
  setPosition(entity, stateManager, {
    x: pos.x + dx,
    y: pos.y + dy,
    z: pos.z + dz,
  });
}

/**
 * Rotate entity around an axis by angle (in radians)
 * Goes through StateManager
 */
export function rotateAxis(
  entity: Entity,
  stateManager: StateManager,
  axis: 'x' | 'y' | 'z',
  angle: number
): void {
  const rot = getRotation(entity, stateManager);
  const newRot = { ...rot };
  newRot[axis] += angle;
  setRotation(entity, stateManager, newRot);
}

/**
 * Scale entity uniformly or per-axis
 * Goes through StateManager
 */
export function scale(
  entity: Entity,
  stateManager: StateManager,
  scaleX: number,
  scaleY?: number,
  scaleZ?: number
): void {
  const currentScale = getScale(entity, stateManager);
  setScale(entity, stateManager, {
    x: currentScale.x * scaleX,
    y: currentScale.y * (scaleY ?? scaleX),
    z: currentScale.z * (scaleZ ?? scaleX),
  });
}

/**
 * Set absolute position (vector)
 */
export function setPositionVec(
  entity: Entity,
  stateManager: StateManager,
  position: Vector3
): void {
  setPosition(entity, stateManager, { ...position });
}

/**
 * Get full transform from StateManager
 */
export function getTransform(entity: Entity, stateManager: StateManager): Transform {
  return {
    position: getPosition(entity, stateManager),
    rotation: getRotation(entity, stateManager),
    scale: getScale(entity, stateManager),
  };
}

/**
 * Set full transform through StateManager
 */
export function setTransform(
  entity: Entity,
  stateManager: StateManager,
  transform: Partial<Transform>
): void {
  if (transform.position) {
    setPosition(entity, stateManager, transform.position);
  }
  if (transform.rotation) {
    setRotation(entity, stateManager, transform.rotation);
  }
  if (transform.scale) {
    setScale(entity, stateManager, transform.scale);
  }
}

/**
 * Clean up entity transform from StateManager
 * Called when entity is destroyed
 */
export function removeEntityTransform(entity: Entity, stateManager: StateManager): void {
  const removable = stateManager as StateManager & { remove?: (path: string) => boolean };
  if (typeof removable.remove === 'function') {
    removable.remove(`entities.${entity.id}`);
    return;
  }

  stateManager.set(`entities.${entity.id}.position`, undefined as unknown as Vector3);
  stateManager.set(`entities.${entity.id}.rotation`, undefined as unknown as Vector3);
  stateManager.set(`entities.${entity.id}.scale`, undefined as unknown as Vector3);
  stateManager.set(`entities.${entity.id}.id`, undefined as unknown as string);
  stateManager.set(`entities.${entity.id}.type`, undefined as unknown as string);
}

/**
 * Subscribe to transform changes for an entity
 * Useful for reactive UI or multiplayer state sync
 */
export function subscribeToTransform(
  entity: Entity,
  stateManager: StateManager,
  callback: (newTransform: Transform, oldTransform: Transform) => void
): () => void {
  const unsubscribers: Array<() => void> = [];

  unsubscribers.push(
    stateManager.subscribe(`entities.${entity.id}.position`, (newPos, oldPos) => {
      const newTransform = getTransform(entity, stateManager);
      const oldTransform = {
        position: oldPos as Vector3,
        rotation: getRotation(entity, stateManager),
        scale: getScale(entity, stateManager),
      };
      callback(newTransform, oldTransform);
    })
  );

  unsubscribers.push(
    stateManager.subscribe(`entities.${entity.id}.rotation`, (newRot, oldRot) => {
      const newTransform = getTransform(entity, stateManager);
      const oldTransform = {
        position: getPosition(entity, stateManager),
        rotation: oldRot as Vector3,
        scale: getScale(entity, stateManager),
      };
      callback(newTransform, oldTransform);
    })
  );

  unsubscribers.push(
    stateManager.subscribe(`entities.${entity.id}.scale`, (newScale, oldScale) => {
      const newTransform = getTransform(entity, stateManager);
      const oldTransform = {
        position: getPosition(entity, stateManager),
        rotation: getRotation(entity, stateManager),
        scale: oldScale as Vector3,
      };
      callback(newTransform, oldTransform);
    })
  );

  // Return function to unsubscribe from all
  return () => {
    unsubscribers.forEach((fn) => fn());
  };
}

/**
 * TransformSystem - High-level API for transform management
 * Coordinates entities, transforms, and StateManager
 */
export class TransformSystem {
  private stateManager: StateManager;
  private entityTransforms: Map<string, Transform> = new Map();

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Register a new entity with the transform system
   */
  registerEntity(entity: Entity, transform?: Partial<Transform>): void {
    initializeEntityTransform(entity, this.stateManager, transform);
    const fullTransform = getTransform(entity, this.stateManager);
    this.entityTransforms.set(entity.id, fullTransform);
  }

  /**
   * Unregister entity from transform system
   */
  unregisterEntity(entity: Entity): void {
    removeEntityTransform(entity, this.stateManager);
    this.entityTransforms.delete(entity.id);
  }

  /**
   * Get entity position
   */
  getPosition(entity: Entity): Vector3 {
    return getPosition(entity, this.stateManager);
  }

  /**
   * Set entity position
   */
  setPosition(entity: Entity, position: Vector3): void {
    setPosition(entity, this.stateManager, position);
    const transform = getTransform(entity, this.stateManager);
    this.entityTransforms.set(entity.id, transform);
  }

  /**
   * Get entity rotation
   */
  getRotation(entity: Entity): Vector3 {
    return getRotation(entity, this.stateManager);
  }

  /**
   * Set entity rotation
   */
  setRotation(entity: Entity, rotation: Vector3): void {
    setRotation(entity, this.stateManager, rotation);
    const transform = getTransform(entity, this.stateManager);
    this.entityTransforms.set(entity.id, transform);
  }

  /**
   * Get entity scale
   */
  getScale(entity: Entity): Vector3 {
    return getScale(entity, this.stateManager);
  }

  /**
   * Set entity scale
   */
  setScale(entity: Entity, scale: Vector3): void {
    setScale(entity, this.stateManager, scale);
    const transform = getTransform(entity, this.stateManager);
    this.entityTransforms.set(entity.id, transform);
  }

  /**
   * Translate entity
   */
  translate(entity: Entity, dx: number, dy: number, dz: number): void {
    translate(entity, this.stateManager, dx, dy, dz);
    const transform = getTransform(entity, this.stateManager);
    this.entityTransforms.set(entity.id, transform);
  }

  /**
   * Rotate entity
   */
  rotateAxis(entity: Entity, axis: 'x' | 'y' | 'z', angle: number): void {
    rotateAxis(entity, this.stateManager, axis, angle);
    const transform = getTransform(entity, this.stateManager);
    this.entityTransforms.set(entity.id, transform);
  }

  /**
   * Scale entity
   */
  scale(entity: Entity, scaleX: number, scaleY?: number, scaleZ?: number): void {
    scale(entity, this.stateManager, scaleX, scaleY, scaleZ);
    const transform = getTransform(entity, this.stateManager);
    this.entityTransforms.set(entity.id, transform);
  }

  /**
   * Get full transform
   */
  getTransform(entity: Entity): Transform {
    return getTransform(entity, this.stateManager);
  }

  /**
   * Set full transform
   */
  setTransform(entity: Entity, transform: Partial<Transform>): void {
    setTransform(entity, this.stateManager, transform);
    const fullTransform = getTransform(entity, this.stateManager);
    this.entityTransforms.set(entity.id, fullTransform);
  }

  /**
   * Subscribe to transform changes
   */
  subscribe(
    entity: Entity,
    callback: (newTransform: Transform, oldTransform: Transform) => void
  ): () => void {
    return subscribeToTransform(entity, this.stateManager, callback);
  }

  /**
   * Get all entity transforms (snapshot)
   */
  getAllTransforms(): Map<string, Transform> {
    return new Map(this.entityTransforms);
  }

  /**
   * Sync entity from StateManager
   * Used to restore state
   */
  syncFromState(entity: Entity): void {
    syncEntityTransformFromState(entity, this.stateManager);
    const transform = getTransform(entity, this.stateManager);
    this.entityTransforms.set(entity.id, transform);
  }
}
