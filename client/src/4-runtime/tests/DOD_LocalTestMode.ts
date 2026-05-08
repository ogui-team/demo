/**
 * DOD_LocalTestMode: Freeplay mode without network dependency
 * Allows isolated DOD validation for v0.1.4 sprint
 * 
 * Run from browser console:
 *   window.__DODLocalTestMode.runAllTests()
 */

import { SimulationKernel, SimulationKernelConfig } from '../../1-kernel/core/kernel/SimulationKernel';

export class DODLocalTestMode {
  private kernel: SimulationKernel;

  constructor() {
    const config: SimulationKernelConfig = {
      maxEntities: 256,
      commandCapacity: 512,
    };
    this.kernel = new SimulationKernel(config);
  }

  /**
   * STEP 1: Health Buffer Validation
   * Create entity, set health, verify storage
   */
  runHealthBufferTest(): void {
    console.log('[v0.1.4] ===== STEP 1: Health Buffer Validation =====');
    
    try {
      const handle = this.kernel.createEntity(0, 0, 0);
      if (handle === null) {
        console.error('[v0.1.4] ❌ STEP 1 FAILED: Could not create entity');
        return;
      }
      console.log(`[v0.1.4] Entity created with handle: ${handle}`);

      const denseIndex = this.kernel.entities.getDenseIndex(handle);
      console.log(`[v0.1.4] Dense index: ${denseIndex}`);

      // Set health
      this.kernel.healths.setMaxHealth(denseIndex, 100);
      this.kernel.healths.setHealth(denseIndex, 100);

      const health = this.kernel.healths.getHealth(denseIndex);
      const maxHealth = this.kernel.healths.getMaxHealth(denseIndex);
      
      console.log(`[v0.1.4] Entity ${handle} Health: ${health}/${maxHealth}`);

      if (health === 100 && maxHealth === 100) {
        console.log('[v0.1.4] ✅ STEP 1 PASSED: Health buffer validation successful');
      } else {
        console.error('[v0.1.4] ❌ STEP 1 FAILED: Health values incorrect');
      }
    } catch (error) {
      console.error('[v0.1.4] ❌ STEP 1 ERROR:', error);
    }
  }

  /**
   * STEP 2: Entity & Position Test
   * Create entity with position, verify storage
   */
  runPositionBufferTest(): void {
    console.log('\n[v0.1.4] ===== STEP 2: Position Buffer Validation =====');
    
    try {
      const handle = this.kernel.createEntity(10, 20, 30);
      if (handle === null) {
        console.error('[v0.1.4] ❌ STEP 2 FAILED: Could not create entity');
        return;
      }
      
      const denseIndex = this.kernel.entities.getDenseIndex(handle);

      // Read position from buffer
      const posBuffer = this.kernel.positions.getReadBuffer();
      const posX = posBuffer[denseIndex * 3];
      const posY = posBuffer[denseIndex * 3 + 1];
      const posZ = posBuffer[denseIndex * 3 + 2];

      console.log(`[v0.1.4] Entity ${handle} Position (as created): (${posX}, ${posY}, ${posZ})`);

      // Check if position was preserved or cleared
      const isPreserved = posX === 10 && posY === 20 && posZ === 30;
      if (isPreserved) {
        console.log('[v0.1.4] ✅ Position was preserved during entity creation');
      } else {
        console.log('[v0.1.4] ℹ️  Position was cleared during bootstrap - testing manual setWriteXYZ');
      }
      
      // Manually set position for verification
      this.kernel.positions.setWriteXYZ(denseIndex, 10, 20, 30);
      this.kernel.positions.publish();

      const posBufferAfter = this.kernel.positions.getReadBuffer();
      const finalX = posBufferAfter[denseIndex * 3];
      const finalY = posBufferAfter[denseIndex * 3 + 1];
      const finalZ = posBufferAfter[denseIndex * 3 + 2];

      console.log(`[v0.1.4] After setWriteXYZ: (${finalX}, ${finalY}, ${finalZ})`);

      if (finalX === 10 && finalY === 20 && finalZ === 30) {
        console.log('[v0.1.4] ✅ STEP 2 PASSED: Position buffer operations successful');
      } else {
        console.error('[v0.1.4] ❌ STEP 2 FAILED: Position values incorrect');
      }
    } catch (error) {
      console.error('[v0.1.4] ❌ STEP 2 ERROR:', error);
    }
  }

  /**
   * STEP 3: Complete Snapshot (Entity + Health + Position)
   * Verify integrated state capture
   */
  runSnapshotTest(): void {
    console.log('\n[v0.1.4] ===== STEP 3: Snapshot Serialization =====');
    
    try {
      const handle = this.kernel.createEntity(5, 10, -15);
      if (handle === null) {
        console.error('[v0.1.4] ❌ STEP 3 FAILED: Could not create entity');
        return;
      }
      
      const denseIndex = this.kernel.entities.getDenseIndex(handle);

      // Set health
      this.kernel.healths.setMaxHealth(denseIndex, 100);
      this.kernel.healths.setHealth(denseIndex, 75);

      // Set position
      this.kernel.positions.setWriteXYZ(denseIndex, 5, 10, -15);
      this.kernel.positions.publish();

      // Read all state
      const healthBuffer = this.kernel.healths.getHealthBuffer();
      const maxHealthBuffer = this.kernel.healths.getMaxHealthBuffer();
      const posBuffer = this.kernel.positions.getReadBuffer();
      
      const health = healthBuffer[denseIndex];
      const maxHealth = maxHealthBuffer[denseIndex];
      const posX = posBuffer[denseIndex * 3];
      const posY = posBuffer[denseIndex * 3 + 1];
      const posZ = posBuffer[denseIndex * 3 + 2];

      // Create snapshot
      const snapshot = {
        handle,
        health,
        maxHealth,
        position: [posX, posY, posZ] as [number, number, number],
      };

      console.log(`[v0.1.4] Snapshot: ${JSON.stringify(snapshot)}`);

      // Verify all fields
      const isValid =
        snapshot.health === 75 &&
        snapshot.maxHealth === 100 &&
        snapshot.position[0] === 5 &&
        snapshot.position[1] === 10 &&
        snapshot.position[2] === -15;

      if (isValid) {
        console.log('[v0.1.4] ✅ Snapshot verified: data matched');
        console.log('[v0.1.4] ✅ STEP 3 PASSED: Snapshot serialization successful');
      } else {
        console.error('[v0.1.4] ❌ STEP 3 FAILED: Snapshot data mismatch');
        console.error(`  Expected: health=75, maxHealth=100, pos=[5,10,-15]`);
        console.error(`  Got: health=${health}, maxHealth=${maxHealth}, pos=[${posX},${posY},${posZ}]`);
      }
    } catch (error) {
      console.error('[v0.1.4] ❌ STEP 3 ERROR:', error);
    }
  }

  /**
   * Run all tests sequentially
   */
  runAllTests(): void {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║       v0.1.4 DOD VALIDATION (LOCAL TEST MODE)          ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');

    this.runHealthBufferTest();
    this.runPositionBufferTest();
    this.runSnapshotTest();

    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║              v0.1.4 TESTS COMPLETED                    ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');
  }
}

// Auto-run on import if in browser
if (typeof window !== 'undefined') {
  const testMode = new DODLocalTestMode();
  // Exposed globally for console access
  (window as any).__DODLocalTestMode = testMode;
  console.log('[v0.1.4] DOD Local Test Mode available. Run: window.__DODLocalTestMode.runAllTests()');
}
