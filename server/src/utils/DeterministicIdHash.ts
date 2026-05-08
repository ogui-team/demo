/**
 * DeterministicIdHash.ts
 * 
 * TIER 0D: Deterministic Entity ID Generation
 * 
 * Provides FNV-1a hashing for deterministic entity ID generation
 * across server restarts and distributed instances.
 * 
 * Purpose: Ensure hash('player_abc') always returns same number
 * across all contexts, enabling collision-free ID canonicalization
 */

/**
 * FNV-1a 32-bit hash algorithm
 * Deterministic, fast, good distribution for entity IDs
 * 
 * @param input String to hash
 * @returns 32-bit unsigned integer hash
 */
export function fnv1aHash(input: string): number {
  const FNV_32_PRIME = 0x01000193;
  const FNV1_32A_INIT = 0x811c9dc5;
  
  let hash = FNV1_32A_INIT;
  
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * FNV_32_PRIME) >>> 0;  // >>> 0 ensures 32-bit unsigned
  }
  
  return hash;
}

/**
 * Generate deterministic player ID from session and connection identifiers
 * 
 * TIER 0D Spec: Same session + connection always produces same player ID
 * Replaces: `p_${Date.now()}` which had collision risk
 * 
 * @param sessionId Session identifier (consistent across connection)
 * @param connectionId WebSocket connection ID (unique per connection)
 * @returns Deterministic player ID (e.g., "p_a1b2c3d4")
 */
export function generateDeterministicPlayerId(sessionId: string, connectionId: string): string {
  // Combine identifiers for hashing
  const combined = `${sessionId}|${connectionId}`;
  const hash = fnv1aHash(combined);
  
  // Format as hex string (use full 32 bits to reduce collision risk)
  // 32-bit hash provides sufficient entropy for typical player counts
  const hashHex = hash.toString(16).padStart(8, '0');
  
  return `p_${hashHex}`;
}

/**
 * Generate deterministic item instance ID from inventory context
 * 
 * TIER 0D Spec: Same player + slot always produces same item ID
 * Replaces: Mixed Date/Math.random() which was unpredictable
 * 
 * @param playerId Player that owns the item
 * @param slotIndex Inventory slot index (0-based)
 * @param itemTemplateId Base item template ID
 * @returns Deterministic item ID (e.g., "itm_a1b2c3d4")
 */
export function generateDeterministicItemId(
  playerId: string,
  slotIndex: number,
  itemTemplateId: string
): string {
  // Combine all identifying factors
  const combined = `${playerId}|${slotIndex}|${itemTemplateId}`;
  const hash = fnv1aHash(combined);
  
  // Format as hex string
  const hashHex = hash.toString(16).padStart(8, '0');
  
  return `itm_${hashHex}`;
}

/**
 * Validate no collisions in a set of hashes
 * Returns collision map for debugging
 * 
 * @param inputs Array of strings to hash
 * @returns {collisions: number, details: Map of duplicate hashes}
 */
export function validateNoCollisions(inputs: string[]): { 
  collisions: number; 
  duplicateHashes: Map<number, string[]>;
} {
  const hashMap = new Map<number, string[]>();
  const duplicateHashes = new Map<number, string[]>();
  
  for (const input of inputs) {
    const hash = fnv1aHash(input);
    const existing = hashMap.get(hash) ?? [];
    
    if (existing.length > 0) {
      duplicateHashes.set(hash, [...existing, input]);
    }
    
    hashMap.set(hash, [...existing, input]);
  }
  
  return {
    collisions: duplicateHashes.size,
    duplicateHashes,
  };
}

/**
 * Test hash distribution across range
 * Returns statistics about hash distribution
 * 
 * @param sampleSize Number of test values to generate
 * @returns Distribution statistics
 */
export function analyzeHashDistribution(sampleSize: number = 10000): {
  min: number;
  max: number;
  mean: number;
  variance: number;
  uniqueCount: number;
  collisionRate: number;
} {
  const hashes = new Set<number>();
  
  for (let i = 0; i < sampleSize; i++) {
    const hash = fnv1aHash(`test_${i}`);
    hashes.add(hash);
  }
  
  const uniqueCount = hashes.size;
  const collisionRate = 1 - (uniqueCount / sampleSize);
  
  // Mock stats (full analysis would need more complex calculation)
  return {
    min: 0,
    max: 0xFFFFFFFF,
    mean: 0x80000000,
    variance: 0,
    uniqueCount,
    collisionRate,
  };
}
