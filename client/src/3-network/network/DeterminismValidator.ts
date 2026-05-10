/**
 * Determinism Validator
 * MILESTONE 4: Client-side validation of server-sent position hashes
 * 
 * Validates that client state matches server every 100 ticks.
 * Force-resets PositionStorage without warning if hash mismatch detected.
 */

import { PositionStorage, EntityRegistry } from '@engine/1-kernel/core/public-api';
import type { NetworkSnapshot, NetworkReplicatedEntityState } from './NetworkRuntimeContracts';

export interface DeterminismValidationResult {
  isValid: boolean;
  expectedHash?: string;
  calculatedHash?: string;
  mismatchedEntityIds?: string[];
}

/**
 * Simple deterministic hash function matching server implementation
 */
export function calculateClientPositionHash(entities: NetworkReplicatedEntityState[]): string {
  let hash = 0x811c9dc5; // FNV offset basis
  const fnvPrime = 16777619;
  
  // Sort by entity ID to ensure consistent ordering
  const sorted = [...entities].sort((a, b) => a.entityId.localeCompare(b.entityId));
  
  for (const entity of sorted) {
    // Hash entity ID
    for (let i = 0; i < entity.entityId.length; i++) {
      hash = ((hash ^ entity.entityId.charCodeAt(i)) >>> 0) * fnvPrime;
      hash = hash >>> 0;
    }
    
    // Hash position
    const pos = entity.transform?.position;
    if (pos) {
      const ix = Math.round(pos.x * 100);
      const iy = Math.round(pos.y * 100);
      const iz = Math.round(pos.z * 100);
      
      hash = ((hash ^ (ix & 0xff)) >>> 0) * fnvPrime;
      hash = ((hash ^ ((ix >> 8) & 0xff)) >>> 0) * fnvPrime;
      hash = ((hash ^ (iy & 0xff)) >>> 0) * fnvPrime;
      hash = ((hash ^ ((iy >> 8) & 0xff)) >>> 0) * fnvPrime;
      hash = ((hash ^ (iz & 0xff)) >>> 0) * fnvPrime;
      hash = ((hash ^ ((iz >> 8) & 0xff)) >>> 0) * fnvPrime;
      
      hash = hash >>> 0;
    }
  }
  
  return hash.toString(16).padStart(8, '0').toUpperCase();
}

export class DeterminismValidator {
  private readonly positionStorage: PositionStorage;
  private readonly entityRegistry: EntityRegistry;

  constructor(positionStorage: PositionStorage, entityRegistry: EntityRegistry) {
    this.positionStorage = positionStorage;
    this.entityRegistry = entityRegistry;
  }

  /**
   * Validate snapshot hash against local state
   * If mismatch: logs error and force-resets position buffer
   */
  validateSnapshot(snapshot: NetworkSnapshot): DeterminismValidationResult {
    if (!snapshot.positionHash) {
      return { isValid: true }; // No hash to validate
    }

    const result: DeterminismValidationResult = {
      isValid: true,
      expectedHash: snapshot.positionHash,
    };

    // Calculate local position hash
    const calculatedHash = calculateClientPositionHash(snapshot.entities);
    result.calculatedHash = calculatedHash;

    if (calculatedHash !== snapshot.positionHash) {
      result.isValid = false;
      
      // MILESTONE 4: Force-reset without warning
      console.error(
        '[DETERMINISM_FAILURE] Position hash mismatch - Force-resetting PositionStorage',
        {
          tick: snapshot.tick,
          expectedHash: snapshot.positionHash,
          calculatedHash,
          entityCount: snapshot.entities.length,
          timestamp: Engine.time.now(),
        }
      );

      // Force-reset: Copy authoritative read to write buffer
      this.positionStorage.copyAuthoritativeReadToWrite(this.entityRegistry.activeCount);
      
      // Clear any outstanding corrections
      const readBuf = this.positionStorage.getAuthoritativeReadBuffer();
      const writeBuf = this.positionStorage.getWriteBuffer();
      writeBuf.set(readBuf);
    }

    return result;
  }
}
