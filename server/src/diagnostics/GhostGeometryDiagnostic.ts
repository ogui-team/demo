/**
 * Ghost Geometry Diagnostic Module
 * 
 * On server startup, this module:
 * 1. Loads all collision data from mapColliders.json
 * 2. Identifies which colliders are replicated vs orphaned
 * 3. Reports ghost geometry that will cause invisible walls
 * 
 * CRITICAL FIX: For static colliders to be visible on client, they must:
 * - Be converted to WorldObjectState entities with networkEntityId
 * - Be marked as replicable in SnapshotFilter
 * - Include mesh/visual data in snapshot
 */

import type { CollisionBox, MapCollisionLayout } from '../collision/MapCollisionData';
import { validateServerWorldIntegrity, generateWorldIntegrityDiagnostic } from './WorldIntegrityValidator';

export interface GhostGeometryDiagnostic {
  mapId: string;
  sessionId: string;
  isValid: boolean;
  ghostColliderCount: number;
  details: string;
}

/**
 * Analyze collision data and identify ghost geometry issues
 * Call this in GameSession.constructor() after collision loading
 */
export function analyzeGhostGeometry(
  mapCollisionLayout: MapCollisionLayout,
  replicatedEntityIds: Set<string>,
  mapId: string,
  sessionId: string
): GhostGeometryDiagnostic {
  const report = validateServerWorldIntegrity(mapCollisionLayout.boxes, replicatedEntityIds);

  const diagnostic: GhostGeometryDiagnostic = {
    mapId,
    sessionId,
    isValid: report.unreplicatedStaticColliders.length === 0,
    ghostColliderCount: report.unreplicatedStaticColliders.length,
    details: generateWorldIntegrityDiagnostic(report),
  };

  if (!diagnostic.isValid) {
    console.error('[GHOST_GEOMETRY_DETECTED]', {
      mapId,
      sessionId,
      ghostCount: diagnostic.ghostColliderCount,
      details: diagnostic.details,
      suggestedFix: [
        'The server has collision boxes that are not replicated to the client.',
        'These cause "invisible walls" that players collide with but cannot see.',
        'FIX: Convert static collision boxes to WorldObjectState entities',
        'Then add them to SnapshotFilter SNAPSHOT_ALLOWED_ENTITY_TYPES',
        'Include mesh/visual data in snapshot for client rendering',
      ].join('\n'),
    });
  }

  return diagnostic;
}

/**
 * Create WorldObjectState entities from collision boxes
 * This is the fix for ghost geometry: make static colliders replicable
 */
export function createReplicableCollisionObjects(
  collisionBoxes: CollisionBox[]
): Array<{
  id: string;
  entityType: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  networkEntityId: string;
  metadata: {
    colliderHalfExtents: { x: number; y: number; z: number };
    isStaticCollider: true;
  };
}> {
  return collisionBoxes.map((box) => ({
    id: box.id,
    entityType: 'static_collider',
    position: { ...box.position },
    rotation: { x: 0, y: 0, z: 0 },
    networkEntityId: box.id, // KEY FIX: Give it a networkEntityId so it gets replicated
    metadata: {
      colliderHalfExtents: { ...box.halfExtents },
      isStaticCollider: true,
    },
  }));
}

/**
 * Recommended changes to fix ghost geometry:
 * 
 * 1. In GameSession.constructor(), after loading CollisionAuthoritySystem:
 *    - Call analyzeGhostGeometry() to detect the issue
 *    - Create WorldObjectState entities for all static colliders
 *    - Add these to this.worldObjects Map
 * 
 * 2. In SnapshotFilter.ts, update isWorldObjectAllowedForSnapshot():
 *    - Add 'static_collider' to SNAPSHOT_ALLOWED_ENTITY_TYPES
 *    - This makes them included in snapshots sent to client
 * 
 * 3. On client, in ClientWorldRuntimeCoordinator:
 *    - When receiving 'static_collider' entities in snapshot,
 *    - Create visual meshes (semi-transparent boxes) to match physics
 *    - Or just render debug visualization if no custom mesh needed
 * 
 * RESULT: Players will see the walls they're colliding with
 */
