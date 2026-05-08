/**
 * Determinism Hash Calculator
 * MILESTONE 4: Server-Client parity validation
 * 
 * Calculates hash of player positions for determinism checking.
 * Every 100 ticks, server sends hash; client validates against local state.
 * Mismatch triggers force-reset without warning.
 */

export interface PositionHashData {
  playerId: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Simple deterministic hash function for position data
 * Uses Fowler-Noll-Vo 32-bit hash for determinism
 */
export function calculatePositionHash(positions: PositionHashData[]): string {
  let hash = 0x811c9dc5; // FNV offset basis
  const fnvPrime = 16777619;
  
  // Sort by playerId to ensure consistent ordering
  const sorted = [...positions].sort((a, b) => a.playerId.localeCompare(b.playerId));
  
  for (const pos of sorted) {
    // Hash player ID
    for (let i = 0; i < pos.playerId.length; i++) {
      hash = ((hash ^ pos.playerId.charCodeAt(i)) >>> 0) * fnvPrime;
      hash = hash >>> 0; // Ensure 32-bit unsigned
    }
    
    // Hash coordinates as fixed-point integers (2 decimal places)
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
  
  return hash.toString(16).padStart(8, '0').toUpperCase();
}

/**
 * Check if hash should be included in snapshot (every 100 ticks)
 */
export function shouldIncludeDeterminismHash(tick: number): boolean {
  return tick % 100 === 0;
}
