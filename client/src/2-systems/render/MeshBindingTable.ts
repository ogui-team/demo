import * as THREE from 'three';
import type { EntityHandle } from '@engine/1-kernel/core/public-api';
import type { EntityRegistry } from '@engine/1-kernel/core/public-api';
import type { PositionStorage } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';

interface MeshBindingRecord {
  handle: EntityHandle;
  mesh: THREE.Mesh;
}

export class MeshBindingTable {
  private readonly bindings = new Map<string, MeshBindingRecord>();
  private readonly entityRegistry: EntityRegistry | null;
  private readonly positionStorage: PositionStorage | null;

  constructor(entityRegistry?: EntityRegistry, positionStorage?: PositionStorage) {
    this.entityRegistry = entityRegistry ?? null;
    this.positionStorage = positionStorage ?? null;
  }

  /**
   * Bind a mesh to an entity handle.
   * ─ ATOMIC BINDING WATCHDOG: Verify binding integrity BEFORE accepting
   */
  bind(entityId: string, handle: EntityHandle, mesh: THREE.Mesh): void {
    // ─ ATOMIC BINDING WATCHDOG: Verify binding integrity BEFORE accepting ─
    const verification = this.verifyBinding(handle, mesh, entityId);
    
    if (!verification.success) {
      console.error('[BINDING_FAILED]', {
        entityId,
        handle,
        reason: verification.failures.join('; '),
        timestamp: Engine.time.now(),
      });
      // Don't bind if verification fails - hide the mesh instead of showing white fallback
      mesh.visible = false;
      return;
    }

    const existingEntityBinding = this.bindings.get(entityId);
    if (existingEntityBinding && existingEntityBinding.mesh !== mesh) {
      this.removeBoundMesh(existingEntityBinding.mesh);
    }

    for (const [boundEntityId, binding] of [...this.bindings.entries()]) {
      if (boundEntityId === entityId) {
        continue;
      }
      if (binding.handle !== handle) {
        continue;
      }

      this.removeBoundMesh(binding.mesh);
      this.bindings.delete(boundEntityId);
      console.warn('[BINDING_REPLACED]', {
        replacedEntityId: boundEntityId,
        entityId,
        handle,
        timestamp: Engine.time.now(),
      });
    }
    
    console.log('[BINDING_SUCCESS]', { entityId, handle, meshName: mesh.name || 'unnamed', timestamp: Engine.time.now() });
    this.bindings.set(entityId, { handle, mesh });
  }

  /**
   * ATOMIC BINDING WATCHDOG: Verify that binding conditions are met.
   * ─ Checks: Handle exists in registry, mesh exists, mesh in scene, mesh visible
   */
  private verifyBinding(handle: EntityHandle, mesh: THREE.Mesh | null, entityId: string): { success: boolean; failures: string[] } {
    const failures: string[] = [];
    
    // Check 1: Handle must exist in EntityRegistry
    if (this.entityRegistry) {
      const denseIdx = this.entityRegistry.getDenseIndex(handle);
      if (denseIdx < 0) {
        failures.push(`Handle ${handle} not found in EntityRegistry`);
      }
    }
    
    // Check 2: Mesh must exist
    if (!mesh) {
      failures.push('Mesh object is null/undefined');
      return { success: false, failures };
    }
    
    // Check 3: Mesh must be in scene (has parent)
    if (!mesh.parent) {
      failures.push('Mesh has no parent (not in scene)');
    }
    
    if (failures.length > 0) {
      console.warn('[BINDING_FAILURE]', {
        entityId,
        handle,
        meshExists: !!mesh,
        inScene: !!mesh?.parent,
        visible: !!mesh?.visible,
        failures,
        timestamp: Engine.time.now(),
      });
    }
    
    return { success: failures.length === 0, failures };
  }

  /**
   * Direct bind when verification already done (bypass watchdog).
   */
  bindVerified(entityId: string, handle: EntityHandle, mesh: THREE.Mesh): void {
    for (const [boundEntityId, binding] of [...this.bindings.entries()]) {
      if (boundEntityId === entityId) {
        continue;
      }
      if (binding.handle !== handle) {
        continue;
      }
      this.removeBoundMesh(binding.mesh);
      this.bindings.delete(boundEntityId);
    }
    this.bindings.set(entityId, { handle, mesh });
  }

  unbind(entityId: string): void {
    this.bindings.delete(entityId);
  }

  updateHandle(entityId: string, newHandle: EntityHandle): void {
    const binding = this.bindings.get(entityId);
    if (binding) {
      binding.handle = newHandle;
    }
  }

  /**
   * Rebind mesh from old handle to new handle.
   * ─ ATOMIC BINDING WATCHDOG: Synchronous rebind with buffer alignment verification
   * Critical for player respawns when kernel handle changes but entity/mesh persists.
   */
  rebind(oldHandle: EntityHandle, newHandle: EntityHandle): boolean {
    for (const [entityId, binding] of this.bindings.entries()) {
      if (binding.handle === oldHandle) {
        const meshName = (binding.mesh as any).name || 'unnamed';
        
        // ─ BUFFER ALIGNMENT CHECK: Verify PositionStorage has data at both handles ─
        let oldPositionEmpty = false;
        let newPositionEmpty = false;
        let bufferAlignmentWarning = '';
        
        if (this.positionStorage) {
          const oldDenseIdx = this.entityRegistry?.getDenseIndex(oldHandle) ?? -1;
          const newDenseIdx = this.entityRegistry?.getDenseIndex(newHandle) ?? -1;
          
          if (oldDenseIdx >= 0) {
            const oldPos = this.positionStorage.getAuthoritativeReadBuffer();
            const oldBase = oldDenseIdx * 3;
            const oldX = oldPos[oldBase], oldY = oldPos[oldBase + 1], oldZ = oldPos[oldBase + 2];
            oldPositionEmpty = oldX === 0 && oldY === 0 && oldZ === 0;
          }
          
          if (newDenseIdx >= 0) {
            const newPos = this.positionStorage.getAuthoritativeReadBuffer();
            const newBase = newDenseIdx * 3;
            const newX = newPos[newBase], newY = newPos[newBase + 1], newZ = newPos[newBase + 2];
            newPositionEmpty = newX === 0 && newY === 0 && newZ === 0;
          }
          
          if (oldPositionEmpty && !newPositionEmpty) {
            bufferAlignmentWarning = ' ⚠️ WARNING: oldHandle position was empty, newHandle has data (copy may have failed)';
          } else if (!oldPositionEmpty && newPositionEmpty) {
            bufferAlignmentWarning = ' ⚠️ WARNING: oldHandle has data but newHandle is empty (async copy?)';
          }
        }
        
        // ─ SYNCHRONOUS REBIND: Update handle IMMEDIATELY ─
        const oldHandleValue = binding.handle;
        binding.handle = newHandle;
        binding.mesh.visible = true;
        
        const rebindInfo = {
          entityId,
          oldHandle,
          newHandle,
          meshName,
          visible: binding.mesh.visible,
          oldPositionEmpty,
          newPositionEmpty,
        };
        
        console.log(`[MeshBindingTable:rebind] SYNCHRONOUS REBIND${bufferAlignmentWarning}`, rebindInfo);
        
        // ─ EMIT ENTITY_REBOUND to coordinate binding persistence across systems (SYNCHRONOUS) ─
        gameBus.emit('ENTITY_REBOUND', {
          entityId,
          oldHandle,
          newHandle,
          meshName,
          timestamp: Engine.time.now(),
          reason: 'snapshot_reconciliation_handle_migration',
          bufferAlignmentWarning,
        } as any);
        
        return true;
      }
    }
    console.warn('[MeshBindingTable:rebind] No binding found for oldHandle', { oldHandle, newHandle });
    return false;
  }

  clear(): void {
    this.bindings.clear();
  }

  size(): number {
    return this.bindings.size;
  }

  /**
   * Get mesh info for a given kernel handle.
   * Returns {mesh, name} or null if not found.
   */
  getMeshForHandle(handle: EntityHandle): { mesh: THREE.Mesh; name?: string } | null {
    for (const [entityId, binding] of this.bindings.entries()) {
      if (binding.handle === handle) {
        return {
          mesh: binding.mesh,
          name: entityId,
        };
      }
    }
    return null;
  }

  /**
   * Check if a handle has a mesh binding.
   */
  hasMeshForHandle(handle: EntityHandle): boolean {
    for (const binding of this.bindings.values()) {
      if (binding.handle === handle) {
        return true;
      }
    }
    return false;
  }

  syncFromPositionBuffer(positionBuffer: Float32Array, registry: EntityRegistry): void {
    for (const binding of this.bindings.values()) {
      const dense = registry.getDenseIndex(binding.handle);
      if (dense < 0) {
        continue;
      }
      const base = dense * 3;
      binding.mesh.position.set(
        positionBuffer[base],
        positionBuffer[base + 1],
        positionBuffer[base + 2],
      );
    }
  }

  private removeBoundMesh(mesh: THREE.Mesh): void {
    const parent = mesh.parent;
    if (parent) {
      parent.remove(mesh);
    }

    if (mesh.userData.sharedAssetInstance) {
      return;
    }

    mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
  }
}
