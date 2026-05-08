import { applyReplicatedState, getReplicatedState } from '../../0-foundation/reflection';
import { Entity, Transform, Vector3, EntityManager } from '@engine/1-kernel/core/public-api';
import type { NetworkReplicatedEntityState } from './NetworkRuntimeContracts';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';

export interface ReplicationBinding {
  entity: Entity;
  instance?: object;
  velocityProvider?: () => Vector3 | undefined;
}

function cloneVector(vector: Vector3 | undefined): Vector3 | undefined {
  if (!vector) return undefined;
  return { x: vector.x, y: vector.y, z: vector.z };
}

function cloneTransform(transform: Transform): Transform {
  return {
    position: { ...transform.position },
    rotation: { ...transform.rotation },
    scale: transform.scale ? { ...transform.scale } : undefined,
  };
}

function flattenSnapshot(snapshot: NetworkReplicatedEntityState): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};
  if (snapshot.transform) {
    flattened['transform.position.x'] = snapshot.transform.position.x;
    flattened['transform.position.y'] = snapshot.transform.position.y;
    flattened['transform.position.z'] = snapshot.transform.position.z;
    flattened['transform.rotation.x'] = snapshot.transform.rotation.x;
    flattened['transform.rotation.y'] = snapshot.transform.rotation.y;
    flattened['transform.rotation.z'] = snapshot.transform.rotation.z;
    flattened['transform.scale.x'] = snapshot.transform.scale?.x ?? 1;
    flattened['transform.scale.y'] = snapshot.transform.scale?.y ?? 1;
    flattened['transform.scale.z'] = snapshot.transform.scale?.z ?? 1;
  }
  if (snapshot.velocity) {
    flattened['velocity.x'] = snapshot.velocity.x;
    flattened['velocity.y'] = snapshot.velocity.y;
    flattened['velocity.z'] = snapshot.velocity.z;
  }
  for (const [key, value] of Object.entries(snapshot.replicated ?? {})) {
    flattened[`replicated.${key}`] = value;
  }
  return flattened;
}

function hasDelta(previous: Record<string, unknown> | undefined, next: Record<string, unknown>): boolean {
  if (!previous) return true;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (!Object.is(previous[key], next[key])) {
      return true;
    }
  }
  return false;
}

export class ReplicationSystem {
  private readonly bindings = new Map<string, ReplicationBinding>();
  private readonly lastSnapshots = new Map<string, Record<string, unknown>>();
  private readonly lastReceivedSnapshotIds = new Set<string>();  // ─ TIER 0C: Ghost entity tracking ─
  private lastCaptureAt = 0;
  private lastCaptureCount = 0;
  private lastDeltaSize = 0;
  private captureRateHz = 0;
  private systemContext: SystemContext | null = null;
  private entityManager: EntityManager | null = null;  // ─ TIER 0C: For entity cleanup ─

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    // ─ TIER 0C: Get entity manager reference for entity cleanup ─
    try {
      this.entityManager = (ctx as any).entityManager ?? null;
    } catch (e) {
      console.warn('[ReplicationSystem] Could not get entityManager from context', e);
    }
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'active',
      active: true,
      metrics: {
        ...this.getDiagnostics(),
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  registerBinding(entityId: string, binding: ReplicationBinding): void {
    this.bindings.set(entityId, binding);
    gameBus.emit('replicationLifecycle', {
      action: 'binding_registered',
      entityId,
    });
  }

  unregisterBinding(entityId: string): void {
    this.bindings.delete(entityId);
    this.lastSnapshots.delete(entityId);
    gameBus.emit('replicationLifecycle', {
      action: 'binding_unregistered',
      entityId,
    });
  }

  hasBinding(entityId: string): boolean {
    return this.bindings.has(entityId);
  }

  captureSnapshots(entityIds: string[] | undefined, tick: number, deltaOnly: boolean = true): NetworkReplicatedEntityState[] {
    const ids = entityIds ?? [...this.bindings.keys()];
    const snapshots: NetworkReplicatedEntityState[] = [];
    const now = Date.now();
    if (this.lastCaptureAt > 0) {
      const elapsedMs = now - this.lastCaptureAt;
      if (elapsedMs > 0) {
        this.captureRateHz = 1000 / elapsedMs;
      }
    }
    this.lastCaptureAt = now;

    for (const entityId of ids) {
      const binding = this.bindings.get(entityId);
      if (!binding) continue;

      const snapshot: NetworkReplicatedEntityState = {
        entityId,
        tick,
        transform: cloneTransform(binding.entity.getTransform()),
        velocity: cloneVector(binding.velocityProvider?.()),
        replicated: binding.instance ? getReplicatedState(binding.instance) : undefined,
      };

      const flattened = flattenSnapshot(snapshot);
      if (!deltaOnly || hasDelta(this.lastSnapshots.get(entityId), flattened)) {
        snapshots.push(snapshot);
      }
      this.lastSnapshots.set(entityId, flattened);
    }

    this.lastCaptureCount = ids.length;
    this.lastDeltaSize = snapshots.length;
    gameBus.emit('replicationLifecycle', {
      action: 'snapshot_captured',
      count: snapshots.length,
      tick,
    });

    return snapshots;
  }

  applySnapshot(snapshot: NetworkReplicatedEntityState, options: { preservePosition?: boolean; preserveRotation?: boolean } = {}): boolean {
    const binding = this.bindings.get(snapshot.entityId);
    if (!binding) return false;

    if (snapshot.transform) {
      const current = binding.entity.getTransform();
      binding.entity.setTransform({
        position: options.preservePosition ? current.position : snapshot.transform.position,
        rotation: options.preserveRotation ? current.rotation : snapshot.transform.rotation,
        scale: snapshot.transform.scale ?? current.scale,
      });
    }
    if (binding.instance && snapshot.replicated) {
      applyReplicatedState(binding.instance, snapshot.replicated);
    }

    this.lastSnapshots.set(snapshot.entityId, flattenSnapshot(snapshot));
    gameBus.emit('replicationLifecycle', {
      action: 'snapshot_applied',
      entityId: snapshot.entityId,
      tick: snapshot.tick,
    });
    return true;
  }

  applySnapshots(snapshots: NetworkReplicatedEntityState[]): string[] {
    const applied: string[] = [];
    for (const snapshot of snapshots) {
      if (this.applySnapshot(snapshot)) {
        applied.push(snapshot.entityId);
      }
    }
    
    // ─ TIER 0C: Ghost Entity Prevention ─
    // When we receive new snapshots, cleanup entities that are no longer in the snapshot
    // This handles entities that moved out of relevance radius on server
    if (snapshots.length > 0) {
      this.cleanupRemovedEntities(snapshots.map(s => s.entityId));
    }
    
    return applied;
  }

  /**
   * TIER 0C: Cleanup entities that were in previous snapshot but not in current
   * This prevents ghost entities from persisting when they leave relevance radius
   */
  private cleanupRemovedEntities(currentSnapshotIds: string[]): void {
    const currentIdSet = new Set(currentSnapshotIds);
    const removedIds: string[] = [];
    
    // Find entities that were in last snapshot but not in current
    for (const previousId of this.lastReceivedSnapshotIds) {
      if (!currentIdSet.has(previousId)) {
        removedIds.push(previousId);
      }
    }
    
    // Delete removed entities from replication system
    if (removedIds.length > 0) {
      console.log('[TIER_0C] Cleaning up removed entities (out of relevance)', {
        removedCount: removedIds.length,
        removedIds: removedIds.slice(0, 10),  // Log first 10
        timestamp: Date.now(),
      });
      
      for (const removedId of removedIds) {
        // Unregister the binding (removes from replication cache)
        const binding = this.bindings.get(removedId);
        if (binding) {
          const entity = binding.entity;
          
          // Try to destroy entity in game world via EntityManager
          if (this.entityManager && entity) {
            try {
              this.entityManager.destroyEntity(entity);
            } catch (e) {
              console.warn('[TIER_0C] Failed to destroy entity during cleanup', {
                entityId: removedId,
                error: String(e),
              });
            }
          }
          
          // Remove from replication tracking
          this.unregisterBinding(removedId);
        }
      }
    }
    
    // Update tracking set for next comparison
    this.lastReceivedSnapshotIds.clear();
    for (const id of currentSnapshotIds) {
      this.lastReceivedSnapshotIds.add(id);
    }
  }

  /**
   * Get currently tracked entity IDs from last snapshot (for debugging)
   */
  getTrackedEntityIds(): string[] {
    return Array.from(this.lastReceivedSnapshotIds);
  }

  getSnapshot(entityId: string): Record<string, unknown> | undefined {
    const snapshot = this.lastSnapshots.get(entityId);
    return snapshot ? { ...snapshot } : undefined;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      bindingCount: this.bindings.size,
      cachedSnapshots: this.lastSnapshots.size,
      snapshotRateHz: Number(this.captureRateHz.toFixed(2)),
      lastCaptureCount: this.lastCaptureCount,
      deltaSize: this.lastDeltaSize,
    };
  }

  /**
   * TIER 0C: Entity validation for snapshot integrity
   * Ensures snapshot consistency before network transmission
   * Validates recipient visibility and entity state validity
   */
  validateSnapshotIntegrity(snapshots: NetworkReplicatedEntityState[], recipient?: string): boolean {
    if (!snapshots || snapshots.length === 0) {
      return true; // Empty snapshots are valid
    }

    for (const snapshot of snapshots) {
      // Validate recipient has visibility access
      if (recipient && !this.isValidRecipient(snapshot.entityId, recipient)) {
        console.warn('[ReplicationSystem] Invalid recipient for entity', {
          entityId: snapshot.entityId,
          recipient,
        });
        return false;
      }

      // Validate entity exists and is valid
      if (!this.hasBinding(snapshot.entityId)) {
        console.warn('[ReplicationSystem] Entity not in replication bindings', {
          entityId: snapshot.entityId,
        });
        return false;
      }

      // Validate snapshot has required fields
      if (!snapshot.entityId || !snapshot.tick) {
        console.warn('[ReplicationSystem] Invalid snapshot structure', snapshot);
        return false;
      }
    }

    return true;
  }

  /**
   * Check if recipient has visibility of entity (stub for full visibility system)
   */
  private isValidRecipient(entityId: string, recipient: string): boolean {
    // For now, accept all recipients. This will be expanded with:
    // - Relevance radius checks
    // - Team/faction visibility rules
    // - Owner-only entity restrictions
    return true;
  }

  update(): void {
    // Intentionally empty. Replication snapshots are captured on demand by NetworkSyncSystem.
  }
}