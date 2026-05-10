/**
 * SnapshotVisibilityDebugger.ts
 * 
 * Sprint-A: Implements diagnostic logging for entity mapping in multiplayer snapshots.
 * 
 * Purpose: Trace the complete flow of AUTHORITATIVE_SNAPSHOT processing to ensure:
 * 1. Received entity IDs are correctly logged
 * 2. NetworkId → LocalHandle mapping succeeds (or fails with clear diagnostics)
 * 3. Ghost entities (incorrectly spawned duplicates) are detected
 * 4. Mesh binding validation confirms visualization
 * 
 * Output Format:
 *   [SNAPSHOT_VISIBILITY] Received 5 entities
 *   [ENTITY_MAPPING] networkId=player_01 → handle=1234 ✓ (found)
 *   [ENTITY_MAPPING] networkId=player_02 → handle=-1 ✗ (MISSING - spawning)
 *   [MESH_BINDING] handle=1234 → mesh=Avatar_Player_01 BOUND
 *   [MESH_BINDING] handle=5678 → mesh NOT FOUND (ghost entity!)
 */

import type { EntityRegistry } from '@engine/1-kernel/core/public-api';
import type { MeshBindingTable } from '../../2-systems/render/MeshBindingTable';
import type { AuthoritativeSnapshot } from '@engine/1-kernel/core/public-api';

export interface SnapshotVisibilityReport {
  tick?: number;
  timestamp: number;
  receivedEntityCount: number;
  mappedSuccessfully: number;
  mappingMissing: number;
  meshBindingFound: number;
  meshBindingMissing: number;
  ghostEntities: (string | number)[];
  details: SnapshotEntityMapping[];
}

export interface SnapshotEntityMapping {
  networkEntityId: string | number;
  kernelHandle: number | null;
  isMapped: boolean;
  meshBound: boolean;
  meshName?: string;
  status: 'OK' | 'MISSING_HANDLE' | 'MISSING_MESH' | 'GHOST';
}

export class SnapshotVisibilityDebugger {
  private readonly entityRegistry: EntityRegistry;
  private readonly meshBindingTable: MeshBindingTable | null;
  private readonly isVerbose: boolean;

  private lastReport: SnapshotVisibilityReport | null = null;

  constructor(
    entityRegistry: EntityRegistry,
    meshBindingTable?: MeshBindingTable,
    isVerbose: boolean = true
  ) {
    this.entityRegistry = entityRegistry;
    this.meshBindingTable = meshBindingTable ?? null;
    this.isVerbose = isVerbose;
  }

  /**
   * Process an incoming snapshot and generate visibility report.
   */
  auditSnapshot(snapshot: AuthoritativeSnapshot): SnapshotVisibilityReport {
    const startTime = performance.now();
    const report: SnapshotVisibilityReport = {
      timestamp: Engine.time.now(),
      receivedEntityCount: snapshot.entities.length,
      mappedSuccessfully: 0,
      mappingMissing: 0,
      meshBindingFound: 0,
      meshBindingMissing: 0,
      ghostEntities: [],
      details: [],
    };

    if (this.isVerbose) {
      console.log(`\n[SNAPSHOT_VISIBILITY] ─── Snapshot Audit ───`);
      console.log(`[SNAPSHOT_VISIBILITY] Received ${snapshot.entities.length} entities`);
    }

    // Audit each entity in snapshot
    for (const entity of snapshot.entities) {
      const mapping = this.auditEntity(entity);
      report.details.push(mapping);

      if (mapping.isMapped) {
        report.mappedSuccessfully++;
        if (mapping.meshBound) {
          report.meshBindingFound++;
        } else {
          report.meshBindingMissing++;
        }
      } else {
        report.mappingMissing++;
      }

      if (mapping.status === 'GHOST') {
        report.ghostEntities.push(entity.networkEntityId);
      }

      // Log each entity if verbose
      if (this.isVerbose) {
        const statusIcon = mapping.isMapped ? '✓' : '✗';
        const meshIcon = mapping.meshBound ? '✓' : '✗';
        const netIdStr = String(mapping.networkEntityId).padEnd(16);
        const handleStr = String(mapping.kernelHandle).padEnd(5);
        console.log(
          `[ENTITY_MAPPING] ${netIdStr} → handle=${handleStr} ${statusIcon} | mesh=${meshIcon}`
        );
      }
    }

    // Print summary
    if (this.isVerbose) {
      console.log(`\n[SNAPSHOT_SUMMARY]`);
      console.log(`  Mapped Successfully: ${report.mappedSuccessfully}/${report.receivedEntityCount}`);
      console.log(`  Mapping Missing:     ${report.mappingMissing}/${report.receivedEntityCount}`);
      console.log(`  Mesh Bound:          ${report.meshBindingFound}/${report.mappedSuccessfully}`);
      if (report.ghostEntities.length > 0) {
        console.warn(`  ⚠️  GHOST ENTITIES: ${report.ghostEntities.join(', ')}`);
      }
      console.log(`  Duration: ${(performance.now() - startTime).toFixed(2)}ms\n`);
    }

    this.lastReport = report;
    return report;
  }

  /**
   * Audit a single entity from snapshot.
   */
  private auditEntity(entity: { networkEntityId: number | string; position?: any; velocity?: any }): SnapshotEntityMapping {
    const networkId = entity.networkEntityId;

    // 1. Try to map networkId → kernel handle
    const handle = this.entityRegistry.getHandleByNetworkId(networkId);
    const isMapped = handle !== null;

    let status: 'OK' | 'MISSING_HANDLE' | 'MISSING_MESH' | 'GHOST' = 'OK';
    let meshBound = false;
    let meshName: string | undefined;

    if (!isMapped) {
      status = 'MISSING_HANDLE';
      if (this.isVerbose) {
        console.error(`  [ERROR] NetworkId "${networkId}" has NO kernel handle - will spawn ghost entity!`);
      }
    } else if (this.meshBindingTable) {
      // 2. Check if mesh is bound for this handle
      const meshInfo = this.meshBindingTable.getMeshForHandle(handle!);
      if (meshInfo) {
        meshBound = true;
        meshName = meshInfo.name || 'unnamed_mesh';
      } else {
        status = 'MISSING_MESH';
        if (this.isVerbose) {
          console.warn(`  [WARNING] Handle ${handle} has NO mesh binding - entity won't render!`);
        }
      }
    }

    return {
      networkEntityId: networkId,
      kernelHandle: isMapped ? handle! : null,
      isMapped,
      meshBound,
      meshName,
      status,
    };
  }

  /**
   * Get the last audit report.
   */
  getLastReport(): SnapshotVisibilityReport | null {
    return this.lastReport;
  }

  /**
   * Check if there are missing mappings (indicates ghosting risk).
   */
  hasMissingMappings(): boolean {
    return this.lastReport ? this.lastReport.mappingMissing > 0 : false;
  }

  /**
   * Check if there are ghost entities detected.
   */
  hasGhostEntities(): boolean {
    return this.lastReport ? this.lastReport.ghostEntities.length > 0 : false;
  }

  /**
   * Pretty-print report for debugging.
   */
  printReport(report: SnapshotVisibilityReport = this.lastReport!): void {
    if (!report) {
      console.log('[SnapshotVisibilityDebugger] No report available');
      return;
    }

    console.log('\n═════════════════════════════════════════════════');
    console.log(`  SNAPSHOT VISIBILITY REPORT`);
    console.log('═════════════════════════════════════════════════');
    console.log(`  Received Entities:     ${report.receivedEntityCount}`);
    console.log(`  Mapped Successfully:   ${report.mappedSuccessfully} ✓`);
    console.log(`  Mapping Missing:       ${report.mappingMissing} ✗`);
    console.log(`  Mesh Bound:            ${report.meshBindingFound}`);
    console.log(`  Mesh Missing:          ${report.meshBindingMissing}`);

    if (report.ghostEntities.length > 0) {
      console.warn(`\n  🚨 DETECTED GHOST ENTITIES:`);
      for (const ghostId of report.ghostEntities) {
        console.warn(`     - ${ghostId}`);
      }
    }

    console.log('\n  Entity Details:');
    for (const detail of report.details) {
      const statusSymbol = detail.isMapped ? '✓' : '✗';
      const meshSymbol = detail.meshBound ? '✓' : '✗';
      const netIdStr = String(detail.networkEntityId).padEnd(20);
      const handleStr = String(detail.kernelHandle).padEnd(6);
      console.log(
        `    [${statusSymbol}] ${netIdStr} handle=${handleStr} mesh=${meshSymbol} (${detail.status})`
      );
    }
    console.log('═════════════════════════════════════════════════\n');
  }
}
