/**
 * Entity Attributes System
 * Manages properties like hitbox state, scripting flags, and other entity metadata
 * 
 * Attributes are stored separately in StateManager, NOT in rendering
 * This allows attributes to change independently of visual representation
 */

import { StateManager } from '../../0-foundation/foundation/state/StateManager';
import { Entity } from './Entity';

export interface EntityAttributes {
  hasHitbox: boolean;
  isScriptGate: boolean;
  isInvisible: boolean;
  isStatic: boolean;
  tags: string[];
  metadata: Record<string, any>;
}

/**
 * Initialize default attributes for entity
 */
export function initializeEntityAttributes(
  entity: Entity,
  stateManager: StateManager,
  attributes?: Partial<EntityAttributes>
): void {
  const defaultAttributes: EntityAttributes = {
    hasHitbox: true,
    isScriptGate: false,
    isInvisible: false,
    isStatic: false,
    tags: [],
    metadata: {},
  };

  const finalAttributes = { ...defaultAttributes, ...(attributes || {}) };

  // Store in StateManager under entities.<id>.attributes
  stateManager.set(`entities.${entity.id}.attributes`, finalAttributes);
}

/**
 * Get entity attributes from StateManager
 */
export function getEntityAttributes(entity: Entity, stateManager: StateManager): EntityAttributes {
  const attrs = stateManager.get(`entities.${entity.id}.attributes`);
  if (!attrs) {
    // Return defaults if not set
    return {
      hasHitbox: true,
      isScriptGate: false,
      isInvisible: false,
      isStatic: false,
      tags: [],
      metadata: {},
    };
  }
  return attrs as EntityAttributes;
}

/**
 * Set entity attributes
 */
export function setEntityAttributes(
  entity: Entity,
  stateManager: StateManager,
  attributes: Partial<EntityAttributes>
): void {
  const current = getEntityAttributes(entity, stateManager);
  const updated = { ...current, ...attributes };
  stateManager.set(`entities.${entity.id}.attributes`, updated);
}

/**
 * Get specific attribute
 */
export function getEntityAttribute<K extends keyof EntityAttributes>(
  entity: Entity,
  stateManager: StateManager,
  key: K
): EntityAttributes[K] {
  const attrs = getEntityAttributes(entity, stateManager);
  return attrs[key];
}

/**
 * Set specific attribute
 */
export function setEntityAttribute<K extends keyof EntityAttributes>(
  entity: Entity,
  stateManager: StateManager,
  key: K,
  value: EntityAttributes[K]
): void {
  const current = getEntityAttributes(entity, stateManager);
  const updated = { ...current, [key]: value };
  stateManager.set(`entities.${entity.id}.attributes`, updated);
}

/**
 * Check if entity has hitbox
 */
export function hasHitbox(entity: Entity, stateManager: StateManager): boolean {
  return getEntityAttribute(entity, stateManager, 'hasHitbox');
}

/**
 * Set hitbox state
 */
export function setHitbox(entity: Entity, stateManager: StateManager, hasHitbox: boolean): void {
  setEntityAttribute(entity, stateManager, 'hasHitbox', hasHitbox);
}

/**
 * Check if entity is a script gate
 */
export function isScriptGate(entity: Entity, stateManager: StateManager): boolean {
  return getEntityAttribute(entity, stateManager, 'isScriptGate');
}

/**
 * Set script gate state
 */
export function setScriptGate(entity: Entity, stateManager: StateManager, isGate: boolean): void {
  setEntityAttribute(entity, stateManager, 'isScriptGate', isGate);
}

/**
 * Check if entity is invisible
 */
export function isInvisible(entity: Entity, stateManager: StateManager): boolean {
  return getEntityAttribute(entity, stateManager, 'isInvisible');
}

/**
 * Set visibility
 */
export function setInvisible(entity: Entity, stateManager: StateManager, invisible: boolean): void {
  setEntityAttribute(entity, stateManager, 'isInvisible', invisible);
}

/**
 * Add tag to entity
 */
export function addTag(entity: Entity, stateManager: StateManager, tag: string): void {
  const current = getEntityAttributes(entity, stateManager);
  const tags = [...new Set([...current.tags, tag])]; // Deduplicate
  setEntityAttribute(entity, stateManager, 'tags', tags);
}

/**
 * Remove tag from entity
 */
export function removeTag(entity: Entity, stateManager: StateManager, tag: string): void {
  const current = getEntityAttributes(entity, stateManager);
  const tags = current.tags.filter((t) => t !== tag);
  setEntityAttribute(entity, stateManager, 'tags', tags);
}

/**
 * Check if entity has tag
 */
export function hasTag(entity: Entity, stateManager: StateManager, tag: string): boolean {
  const attrs = getEntityAttributes(entity, stateManager);
  return attrs.tags.includes(tag);
}

/**
 * Set custom metadata
 */
export function setMetadata(
  entity: Entity,
  stateManager: StateManager,
  key: string,
  value: any
): void {
  const current = getEntityAttributes(entity, stateManager);
  const metadata = { ...current.metadata, [key]: value };
  setEntityAttribute(entity, stateManager, 'metadata', metadata);
}

/**
 * Get custom metadata
 */
export function getMetadata(entity: Entity, stateManager: StateManager, key: string): any {
  const attrs = getEntityAttributes(entity, stateManager);
  return attrs.metadata[key];
}

/**
 * Subscribe to attribute changes
 */
export function subscribeToAttributes(
  entity: Entity,
  stateManager: StateManager,
  callback: (newAttrs: EntityAttributes, oldAttrs: EntityAttributes) => void
): () => void {
  return stateManager.subscribe(`entities.${entity.id}.attributes`, (newValue, oldValue) => {
    callback(newValue as EntityAttributes, oldValue as EntityAttributes);
  });
}
