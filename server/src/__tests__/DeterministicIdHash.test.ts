/**
 * DeterministicIdHash.test.ts
 * 
 * TIER 0D: Entity ID Canonicalization Validation
 * 
 * Exports validation functions that can be run manually or integrated with test runners
 * Validates:
 * 1. Determinism: hash('input') always returns same output
 * 2. Distribution: Hashes evenly distributed
 * 3. Collisions: No collisions in typical ID space
 * 4. Cross-Format: Different ID formats produce unique hashes
 */

import {
  fnv1aHash,
  generateDeterministicPlayerId,
  generateDeterministicItemId,
  validateNoCollisions,
  analyzeHashDistribution,
} from '../utils/DeterministicIdHash';

/**
 * Test: fnv1aHash returns same value for identical inputs
 */
export function testHashDeterminism(): { passed: boolean; message: string } {
  const input = 'player_123';
  const hash1 = fnv1aHash(input);
  const hash2 = fnv1aHash(input);
  const hash3 = fnv1aHash(input);
  
  const passed = hash1 === hash2 && hash2 === hash3;
  return {
    passed,
    message: passed 
      ? `✅ Hash determinism: ${hash1} === ${hash2} === ${hash3}`
      : `❌ Hash not deterministic: ${hash1} vs ${hash2} vs ${hash3}`,
  };
}

/**
 * Test: Different inputs produce different hashes
 */
export function testHashDiversity(): { passed: boolean; message: string } {
  const hash1 = fnv1aHash('player_123');
  const hash2 = fnv1aHash('player_124');
  const hash3 = fnv1aHash('player_222');
  
  const passed = hash1 !== hash2 && hash2 !== hash3 && hash1 !== hash3;
  return {
    passed,
    message: passed
      ? `✅ Hash diversity: ${hash1.toString(16)} !== ${hash2.toString(16)} !== ${hash3.toString(16)}`
      : `❌ Hashes not diverse: ${hash1} ${hash2} ${hash3}`,
  };
}

/**
 * Test: Player IDs are deterministic
 */
export function testPlayerIdDeterminism(): { passed: boolean; message: string } {
  const id1 = generateDeterministicPlayerId('session_abc', 'conn_123');
  const id2 = generateDeterministicPlayerId('session_abc', 'conn_123');
  
  const passed = id1 === id2 && /^p_[a-f0-9]{8}$/.test(id1);
  return {
    passed,
    message: passed
      ? `✅ Player ID determinism: ${id1} === ${id2}`
      : `❌ Player ID not deterministic: ${id1} vs ${id2}`,
  };
}

/**
 * Test: Item IDs are deterministic
 */
export function testItemIdDeterminism(): { passed: boolean; message: string } {
  const id1 = generateDeterministicItemId('p_1234', 0, 'weapon_pistol');
  const id2 = generateDeterministicItemId('p_1234', 0, 'weapon_pistol');
  
  const passed = id1 === id2 && /^itm_[a-f0-9]{8}$/.test(id1);
  return {
    passed,
    message: passed
      ? `✅ Item ID determinism: ${id1} === ${id2}`
      : `❌ Item ID not deterministic: ${id1} vs ${id2}`,
  };
}

/**
 * Test: No collisions in typical player space
 */
export function testPlayerIdCollisions(): { passed: boolean; message: string } {
  const playerIds = new Set<string>();
  let collisions = 0;
  
  for (let i = 0; i < 1000; i++) {
    const id = generateDeterministicPlayerId(`session_${i}`, `conn_${i}`);
    if (playerIds.has(id)) {
      collisions++;
    }
    playerIds.add(id);
  }
  
  const passed = collisions === 0 && playerIds.size === 1000;
  return {
    passed,
    message: passed
      ? `✅ Player ID collisions: 0 in 1000 IDs (0%)`
      : `❌ Player ID collisions: ${collisions} in 1000 IDs (${(collisions * 100 / 1000).toFixed(1)}%)`,
  };
}

/**
 * Test: No collisions in typical item space
 */
export function testItemIdCollisions(): { passed: boolean; message: string } {
  const itemIds = new Set<string>();
  let collisions = 0;
  
  for (let player = 0; player < 100; player++) {
    for (let slot = 0; slot < 60; slot++) {
      for (const template of ['weapon_pistol', 'weapon_shotgun', 'health_potion']) {
        const id = generateDeterministicItemId(`p_${player}`, slot, template);
        if (itemIds.has(id)) {
          collisions++;
        }
        itemIds.add(id);
      }
    }
  }
  
  const expectedCount = 100 * 60 * 3;
  const passed = collisions === 0 && itemIds.size === expectedCount;
  return {
    passed,
    message: passed
      ? `✅ Item ID collisions: 0 in ${expectedCount} IDs (0%)`
      : `❌ Item ID collisions: ${collisions} in ${expectedCount} IDs (${(collisions * 100 / expectedCount).toFixed(1)}%)`,
  };
}

/**
 * Test: Hash distribution analysis
 */
export function testHashDistribution(): { passed: boolean; message: string } {
  const stats = analyzeHashDistribution(10000);
  const passed = stats.uniqueCount > 9900 && stats.collisionRate < 0.01;
  
  return {
    passed,
    message: passed
      ? `✅ Hash distribution: ${stats.uniqueCount}/10000 unique (${(stats.uniqueCount/100).toFixed(1)}%), collision rate ${(stats.collisionRate * 100).toFixed(2)}%`
      : `❌ Hash distribution poor: ${stats.uniqueCount}/10000 unique, collision rate ${(stats.collisionRate * 100).toFixed(2)}%`,
  };
}

/**
 * Test: Persistence across restarts
 */
export function testPersistenceBehavior(): { passed: boolean; message: string } {
  // Simulate server restart
  const playerIdBefore = generateDeterministicPlayerId('game_session_1', 'conn_player1');
  const itemIdBefore = generateDeterministicItemId(playerIdBefore, 0, 'weapon_pistol');
  
  // Same inputs after "restart"
  const playerIdAfter = generateDeterministicPlayerId('game_session_1', 'conn_player1');
  const itemIdAfter = generateDeterministicItemId(playerIdAfter, 0, 'weapon_pistol');
  
  const passed = playerIdBefore === playerIdAfter && itemIdBefore === itemIdAfter;
  return {
    passed,
    message: passed
      ? `✅ Persistence: IDs stable across restart (player: ${playerIdBefore}, item: ${itemIdBefore})`
      : `❌ Persistence failed: player ${playerIdBefore} vs ${playerIdAfter}, item ${itemIdBefore} vs ${itemIdAfter}`,
  };
}

/**
 * Run all validation tests
 */
export function runAllValidations(): { passed: number; failed: number; tests: Array<{ name: string; result: { passed: boolean; message: string } }> } {
  const tests = [
    { name: 'Hash Determinism', fn: testHashDeterminism },
    { name: 'Hash Diversity', fn: testHashDiversity },
    { name: 'Player ID Determinism', fn: testPlayerIdDeterminism },
    { name: 'Item ID Determinism', fn: testItemIdDeterminism },
    { name: 'Player ID Collisions', fn: testPlayerIdCollisions },
    { name: 'Item ID Collisions', fn: testItemIdCollisions },
    { name: 'Hash Distribution', fn: testHashDistribution },
    { name: 'Persistence Behavior', fn: testPersistenceBehavior },
  ];
  
  const results = tests.map(test => ({
    name: test.name,
    result: test.fn(),
  }));
  
  const passed = results.filter(r => r.result.passed).length;
  const failed = results.filter(r => !r.result.passed).length;
  
  return { passed, failed, tests: results };
}

// If run directly, execute all validations
if (require.main === module) {
  const results = runAllValidations();
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TIER 0D: Entity ID Canonicalization Validation');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  for (const test of results.tests) {
    console.log(`${test.result.passed ? '✅' : '❌'} ${test.name}: ${test.result.message}`);
  }
  
  console.log(`\n───────────────────────────────────────────────────────────────`);
  console.log(`Results: ${results.passed}/${results.tests.length} PASSED, ${results.failed}/${results.tests.length} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  process.exit(results.failed > 0 ? 1 : 0);
}
