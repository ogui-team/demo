/**
 * World Integrity Validator
 * Compares server-side physics entities with client-side replicated state
 * 
 * Purpose: Identify "ghost geometry" - physics colliders that exist on server
 * but have no corresponding mesh on client (invisible walls)
 */

import type { CollisionBox } from '../../../server/src/collision/MapCollisionData';

export interface WorldIntegrityReport {
  timestamp: number;
  serverStaticColliders: number;
  serverDynamicColliders: number;
  clientReplicatedEntities: number;
  unreplicatedStaticColliders: CollisionBox[];
  orphanedEntities: Array<{
    id: string;
    reason: string;
  }>;
  issues: string[];
}

/**
 * Server-side integrity validator
 * Should be called on GameSession startup
 */
export function validateServerWorldIntegrity(
  collisionBoxes: CollisionBox[],
  replicatedEntityIds: Set<string>
): WorldIntegrityReport {
  const report: WorldIntegrityReport = {
    timestamp: Date.now(),
    serverStaticColliders: collisionBoxes.length,
    serverDynamicColliders: 0,
    clientReplicatedEntities: replicatedEntityIds.size,
    unreplicatedStaticColliders: [],
    orphanedEntities: [],
    issues: [],
  };

  // Identify static colliders that are NOT in replicated entities
  for (const box of collisionBoxes) {
    if (!replicatedEntityIds.has(box.id)) {
      report.unreplicatedStaticColliders.push(box);
      report.issues.push(
        `GHOST COLLIDER: Static collision box "${box.id}" exists on server but NOT in client snapshots`
      );
    }
  }

  // Log findings
  if (report.unreplicatedStaticColliders.length > 0) {
    console.error(
      `[WORLD_INTEGRITY] ⚠️ GHOST GEOMETRY DETECTED: ${report.unreplicatedStaticColliders.length} collision boxes are not replicated to client!`,
      {
        unreplicatedBoxes: report.unreplicatedStaticColliders.map((b) => ({
          id: b.id,
          position: b.position,
          halfExtents: b.halfExtents,
        })),
        report,
      }
    );
  }

  return report;
}

/**
 * Identify entities in EntityRegistry that have no networkEntityId
 * These are "orphaned" - they won't be replicated to client
 */
export function findOrphanedEntities(
  allEntities: Array<{ id: string; networkEntityId?: string }>,
  allowedReplicationTypes: Set<string>
): Array<{ id: string; reason: string }> {
  const orphaned: Array<{ id: string; reason: string }> = [];

  for (const entity of allEntities) {
    if (!entity.networkEntityId) {
      orphaned.push({
        id: entity.id,
        reason: 'Missing networkEntityId - will not be sent to client',
      });
    } else if (!allowedReplicationTypes.has((entity as any).type)) {
      orphaned.push({
        id: entity.id,
        reason: `Entity type "${(entity as any).type}" not in allowed replication list`,
      });
    }
  }

  return orphaned;
}

/**
 * Generate a diagnostic report comparing server and client state
 */
export function generateWorldIntegrityDiagnostic(report: WorldIntegrityReport): string {
  const lines: string[] = [
    '=== WORLD INTEGRITY DIAGNOSTIC ===',
    `Timestamp: ${new Date(report.timestamp).toISOString()}`,
    '',
    'SERVER STATE:',
    `  Static Colliders: ${report.serverStaticColliders}`,
    `  Dynamic Colliders: ${report.serverDynamicColliders}`,
    '',
    'CLIENT STATE:',
    `  Replicated Entities: ${report.clientReplicatedEntities}`,
    '',
    'ISSUES FOUND:',
  ];

  if (report.issues.length === 0) {
    lines.push('  ✓ No issues detected');
  } else {
    for (const issue of report.issues) {
      lines.push(`  ✗ ${issue}`);
    }
  }

  if (report.unreplicatedStaticColliders.length > 0) {
    lines.push('', 'UNREPLICATED STATIC COLLIDERS (GHOST GEOMETRY):');
    for (const box of report.unreplicatedStaticColliders) {
      lines.push(
        `  - ${box.id} @ (${box.position.x.toFixed(2)}, ${box.position.y.toFixed(2)}, ${box.position.z.toFixed(2)})`
      );
    }
  }

  if (report.orphanedEntities.length > 0) {
    lines.push('', 'ORPHANED ENTITIES:');
    for (const entity of report.orphanedEntities) {
      lines.push(`  - ${entity.id}: ${entity.reason}`);
    }
  }

  return lines.join('\n');
}
