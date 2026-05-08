/**
 * SnapshotFilter: Entity filtering logic for snapshot broadcasting
 * 
 * Determines which entities should be included in snapshot broadcasts
 * and handles filtering based on entity type and world object allowance.
 * 
 * Special handling: Grunts (server-side only enemies) are completely filtered out.
 */

import type { EntityState } from '../core/GameSession';
import type { WorldObjectState } from '../world/WorldObjects';

const SNAPSHOT_ALLOWED_ENTITY_TYPES = new Set(['player', 'static_collider']);
const SNAPSHOT_ALLOWED_WORLD_OBJECT_TYPES = new Set(['player', 'static_collider', 'barrier', 'box', 'sphere', 'tree', 'prop', 'pickup', 'interactable', 'world_object']);
const SNAPSHOT_RELEVANCE_RADIUS = 72;

/**
 * Check if an entity should be included in snapshot broadcasts.
 * Currently only allows 'player' type entities.
 * Special: Grunts (enemy entities) are completely filtered out.
 */
export function isEntityAllowedForSnapshot(entity: EntityState): boolean {
  const normalizedType = entity.type.toLowerCase();
  
  // ─ GRUNT FILTER: Completely exclude all grunt entities from snapshots
  // Grunts are server-side only; client must never receive them
  const isGrunt = normalizedType === 'prefab_enemygrunt' 
    || normalizedType.includes('grunt')
    || entity.type === 'Prefab_EnemyGrunt'
    || entity.id?.includes?.('npc_enemy_grunt');
  
  if (isGrunt) {
    // ─ DEATH-SPIRAL-RESILIENCE: Log filtered grunts for debugging
    console.warn('[SERVER] Filtered legacy grunt from snapshot', {
      entityId: entity.id,
      entityType: entity.type,
      normalizedType,
      timestamp: Date.now(),
    });
    return false;
  }
  
  return SNAPSHOT_ALLOWED_ENTITY_TYPES.has(entity.type);
}

/**
 * Check if a world object should be included in snapshot broadcasts.
 * Keep static/editor-authored world objects available to late joiners.
 */
export function isWorldObjectAllowedForSnapshot(worldObject: WorldObjectState): boolean {
  const normalizedType = worldObject.entityType.toLowerCase();
  const isGrunt = normalizedType === 'prefab_enemygrunt'
    || normalizedType.includes('grunt')
    || worldObject.entityType === 'Prefab_EnemyGrunt'
    || worldObject.id?.includes?.('npc_enemy_grunt');

  if (isGrunt) {
    return false;
  }

  return SNAPSHOT_ALLOWED_WORLD_OBJECT_TYPES.has(normalizedType);
}

/**
 * Filter entities and world objects based on snapshot allowance rules.
 */
export function filterAllowedEntities(
  entities: EntityState[],
  worldObjects: WorldObjectState[]
): { entities: EntityState[]; worldObjects: WorldObjectState[] } {
  return {
    entities: entities.filter(isEntityAllowedForSnapshot),
    worldObjects: worldObjects.filter(isWorldObjectAllowedForSnapshot),
  };
}

/**
 * Get diagnostic info about snapshot filtering.
 */
export function getSnapshotFilterDiagnostics(): Record<string, unknown> {
  return {
    allowedEntityTypes: Array.from(SNAPSHOT_ALLOWED_ENTITY_TYPES),
    relevanceRadius: SNAPSHOT_RELEVANCE_RADIUS,
  };
}
