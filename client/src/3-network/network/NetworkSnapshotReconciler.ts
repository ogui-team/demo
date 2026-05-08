import { EntityRegistry } from '@engine/1-kernel/core/public-api';
import { KernelCommandQueue } from '@engine/1-kernel/core/public-api';
import { PositionStorage } from '@engine/1-kernel/core/public-api';
import { VelocityStorage } from '@engine/1-kernel/core/public-api';
import type { AuthoritativeSnapshot, SimulationCommandSource } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { SnapshotVisibilityDebugger } from './SnapshotVisibilityDebugger';
import { VisualDriftCompensation } from './VisualDriftCompensation'; // MILESTONE 2: Visual compensation
import { DeterminismValidator } from './DeterminismValidator'; // MILESTONE 4: Determinism checking

export class NetworkSnapshotReconciler {
  private static readonly CORRECTION_LERP_FACTOR = 0.15; // Increased from 0.15 → kept at 0.15 for consistency
  private static readonly PERF_WARNING_DISTANCE = 0.35;
  private static readonly PERF_WARNING_STREAK = 8;

  private readonly entityRegistry: EntityRegistry;
  private readonly commandQueue: KernelCommandQueue;
  private readonly positionStorage: PositionStorage;
  private readonly velocityStorage: VelocityStorage;
  private readonly source: SimulationCommandSource;
  private readonly debugger: SnapshotVisibilityDebugger;
  private readonly visualDriftCompensation: VisualDriftCompensation; // MILESTONE 2: Track visual offsets
  private readonly determinismValidator: DeterminismValidator; // MILESTONE 4: Validate position hash
  private readonly errorThreshold = 0.05;
  private readonly sustainedHighDrift = new Map<string | number, number>();
  private currentTick = 0;

  constructor(
    entityRegistry: EntityRegistry,
    commandQueue: KernelCommandQueue,
    positionStorage: PositionStorage,
    velocityStorage: VelocityStorage,
    source: SimulationCommandSource = 'server',
  ) {
    this.entityRegistry = entityRegistry;
    this.commandQueue = commandQueue;
    this.positionStorage = positionStorage;
    this.velocityStorage = velocityStorage;
    this.source = source;
    this.debugger = new SnapshotVisibilityDebugger(entityRegistry, undefined, true);
    this.visualDriftCompensation = new VisualDriftCompensation(); // MILESTONE 2: Initialize compensation system
    this.determinismValidator = new DeterminismValidator(positionStorage, entityRegistry); // MILESTONE 4: Initialize validator
  }

  setCurrentTick(tick: number): void {
    this.currentTick = tick;
  }

  processSnapshot(snapshot: AuthoritativeSnapshot): void {
    // Run visibility audit before reconciliation
    const report = this.debugger.auditSnapshot(snapshot);

    // Log warnings if issues detected
    if (report.mappingMissing > 0) {
      console.warn(
        `[SNAPSHOT_AUDIT] ⚠️  ${report.mappingMissing} entities missing kernel handles - will spawn ghosts!`
      );
    }

    if (report.ghostEntities.length > 0) {
      console.error(
        `[SNAPSHOT_AUDIT] 🚨 GHOST ENTITIES DETECTED: ${report.ghostEntities.join(', ')}`
      );
    }

    // MILESTONE 4: Validate determinism hash before reconciliation
    const validationResult = this.determinismValidator.validateSnapshot(snapshot as any);
    if (!validationResult.isValid) {
      console.warn('[DETERMINISM_VALIDATOR] Snapshot hash mismatch detected and corrected', {
        tick: this.currentTick,
        validationResult,
      });
    }

    this.reconcileSnapshot(snapshot);
  }

  private reconcileSnapshot(snapshot: AuthoritativeSnapshot): void {
    const buffersInfo = {
      positionalCapacity: this.positionStorage.maxCapacity,
      velocityCapacity: this.velocityStorage.maxCapacity,
    };
    const authoritativeRead = this.positionStorage.getAuthoritativeReadBuffer();

    for (const entity of snapshot.entities) {
      const handle = this.entityRegistry.getHandleByNetworkId(entity.networkEntityId);
      if (handle == null) {
        console.error(`FATAL: Snapshot contains NetId ${entity.networkEntityId} but no Handle exists!`, {
          tick: this.currentTick,
          source: this.source,
          bufferStatus: buffersInfo,
          hasCommandQueue: !!this.commandQueue,
        });
        console.table(this.getActiveHandleDump());
        return;
      }

      if (handle != null) {
        const denseIndex = this.entityRegistry.getDenseIndex(handle);
        if (denseIndex >= 0 && denseIndex < this.positionStorage.maxCapacity) {
          const base = denseIndex * 3;
          const currentPosition = {
            x: authoritativeRead[base],
            y: authoritativeRead[base + 1],
            z: authoritativeRead[base + 2],
          };
          const deltaX = entity.position.x - currentPosition.x;
          const deltaY = entity.position.y - currentPosition.y;
          const deltaZ = entity.position.z - currentPosition.z;
          const distance = Math.sqrt((deltaX * deltaX) + (deltaY * deltaY) + (deltaZ * deltaZ));

          if (distance > this.errorThreshold) {
            const streak = distance >= NetworkSnapshotReconciler.PERF_WARNING_DISTANCE
              ? (this.sustainedHighDrift.get(entity.networkEntityId) ?? 0) + 1
              : 0;
            this.sustainedHighDrift.set(entity.networkEntityId, streak);

            // MILESTONE 2: Direct buffer manipulation for large deltas (no lerp for physics buffer)
            // Strategy: If drift is large enough to cause visible snapping, write DIRECTLY
            // Small errors still get lerped for smoothness, large errors get direct writes
            const isLargeDrift = distance >= NetworkSnapshotReconciler.PERF_WARNING_DISTANCE;
            
            let writeX = entity.position.x;
            let writeY = entity.position.y;
            let writeZ = entity.position.z;
            
            if (!isLargeDrift) {
              // For minor jitter, use lerp to smooth
              const lerpFactor = NetworkSnapshotReconciler.CORRECTION_LERP_FACTOR;
              writeX = currentPosition.x + (deltaX * lerpFactor);
              writeY = currentPosition.y + (deltaY * lerpFactor);
              writeZ = currentPosition.z + (deltaZ * lerpFactor);
            } else {
              // MILESTONE 2: Record visual drift compensation for large snaps
              // This will fade out the visual offset over 300ms, hiding the snap from view
              this.visualDriftCompensation.recordSnap(
                entity.networkEntityId,
                deltaX, // Store the delta (distance snapped)
                deltaY,
                deltaZ,
              );
            }
            // For large drift, writeX/Y/Z remain as entity.position (direct write)

            // Emit event with appropriate lerpFactor (0 for direct write, 0.15 for lerp)
            const eventLerpFactor = isLargeDrift ? 0 : NetworkSnapshotReconciler.CORRECTION_LERP_FACTOR;
            gameBus.emit('SMOOTHNESS_SAMPLE', {
              source: 'network_snapshot_reconciler',
              entityId: entity.networkEntityId,
              tick: this.currentTick,
              correctionDistance: distance,
              lerpFactor: eventLerpFactor,
              threshold: this.errorThreshold,
            });

            if (
              streak >= NetworkSnapshotReconciler.PERF_WARNING_STREAK
              && streak % NetworkSnapshotReconciler.PERF_WARNING_STREAK === 0
            ) {
              console.warn('[PERF_WARNING] Physics Desync Detected', {
                source: 'network_snapshot_reconciler',
                networkEntityId: entity.networkEntityId,
                tick: this.currentTick,
                correctionDistance: distance,
                warningDistance: NetworkSnapshotReconciler.PERF_WARNING_DISTANCE,
                isDirectWrite: isLargeDrift,
                streak,
              });
            }

            this.positionStorage.setAuthoritativeWriteXYZ(
              denseIndex,
              writeX,
              writeY,
              writeZ,
            );
          } else {
            this.sustainedHighDrift.set(entity.networkEntityId, 0);
          }
          
          // ─ JITTER FIX: Apply velocity directly without lerp
          // This ensures velocity matches position correction immediately
          // preventing oscillation between position and velocity updates
          this.velocityStorage.setAuthoritativeXYZ(
            denseIndex,
            entity.velocity.x,
            entity.velocity.y,
            entity.velocity.z,
          );
        } else {
          console.error(`NetworkSnapshotReconciler: Out of Bounds denseIndex ${denseIndex} for networkEntityId ${entity.networkEntityId}`);
        }
      }
    }
    // Do not publish here, kernel will publish authoritative
  }

  private getActiveHandleDump(): Array<{ denseIndex: number; handle: number; networkEntityId: number | null }> {
    const rows: Array<{ denseIndex: number; handle: number; networkEntityId: number | null }> = [];
    this.entityRegistry.forEachDense((denseIndex, handle) => {
      rows.push({
        denseIndex,
        handle,
        networkEntityId: null,
      });
    });
    return rows;
  }

  // MILESTONE 2: Visual drift compensation accessors
  updateVisualDriftCompensation(deltaMs: number): void {
    this.visualDriftCompensation.update(deltaMs);
  }

  getVisualDriftCompensations(): IterableIterator<[string | number, import('./VisualDriftCompensation').VisualDriftOffset]> {
    return this.visualDriftCompensation.getActiveOffsets();
  }

  hasVisualDrift(entityId: string | number): boolean {
    return this.visualDriftCompensation.hasActiveDrift(entityId);
  }
}