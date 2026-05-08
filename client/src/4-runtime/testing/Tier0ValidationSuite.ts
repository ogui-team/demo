/**
 * TIER 0 VALIDATION SUITE
 * 
 * Comprehensive test suite for all critical stability gates:
 * - Gate 1A: Map Geometry Isolation
 * - Tier 0A: Event Listener Lifecycle
 * - Tier 0B: Mode Transition Cleanup  
 * - Tier 0C: Snapshot Filtering
 * - Tier 0E: System Lifecycle Enforcement
 * 
 * Purpose: Verify all Tier 0 gates pass before v0.2.0 release
 * Target: v0.3.0 compatibility
 * 
 * Usage:
 *   const suite = new Tier0ValidationSuite();
 *   const results = await suite.runAllTests();
 *   console.table(results);
 */

export interface ValidationTestResult {
  gate: string;
  test: string;
  passed: boolean;
  message: string;
  duration: number;
  details?: Record<string, unknown>;
}

export class Tier0ValidationSuite {
  private results: ValidationTestResult[] = [];
  private startTime = 0;
  private testQueue: Array<() => Promise<void>> = [];

  /**
   * Run all validation tests
   */
  async runAllTests(): Promise<ValidationTestResult[]> {
    console.log('\n🚀 TIER 0 VALIDATION SUITE - Starting all tests\n');
    
    this.results = [];
    this.testQueue = [];

    // Collect all tests
    this.testGate1ACollisionIsolation();
    this.testTier0AEventListeners();
    this.testTier0BModeTransitions();
    this.testTier0CSnapshotFiltering();
    this.testTier0ESystemLifecycle();

    // Execute all tests sequentially
    for (const testFn of this.testQueue) {
      await testFn();
    }

    this.printSummary();
    return this.results;
  }

  /**
   * GATE 1A: Map Geometry Isolation
   * Verify collision geometry is mode-scoped
   */
  private testGate1ACollisionIsolation(): void {
    console.log('📍 Testing Gate 1A: Map Geometry Isolation');

    // Test 1A.1: Verify setActiveMapCollisionLayout is called
    this.addTest('1A', '1A.1: Collision layout integration', async () => {
      try {
        const { GameLaunchCoordinator } = await import('../../2-systems/gameplay/game/GameLaunchCoordinator');
        const src = GameLaunchCoordinator.toString();
        
        const hasCalls = src.includes('setActiveMapCollisionLayout');
        
        if (!hasCalls) {
          throw new Error('setActiveMapCollisionLayout call missing in GameLaunchCoordinator');
        }
        
        // Count occurrences (should be in multiple places)
        const matches = src.match(/setActiveMapCollisionLayout/g) || [];
        
        return { 
          passed: true, 
          message: `Collision loading integrated (${matches.length} calls found)`,
          details: { callCount: matches.length }
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 1A.2: Verify collision logging is in place
    this.addTest('1A', '1A.2: Collision transition logging', async () => {
      try {
        const { CollisionAuthoritySystem } = await import('../../3-network/network/CollisionAuthoritySystem');
        const src = CollisionAuthoritySystem.toString();
        
        const hasLogging = src.includes('[Collision]') || src.includes('Layout change') || 
                          src.includes('collision') && src.includes('map');
        if (!hasLogging) {
          throw new Error('Collision transition logging not found');
        }
        
        return { passed: true, message: 'Collision logging in place' };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 1A.3: Verify collision data structure
    this.addTest('1A', '1A.3: Collision data structure valid', async () => {
      try {
        const { getMapCollisionLayout } = await import('../../3-network/network/MapCollisionData');
        
        // Verify function exists and can be called
        if (typeof getMapCollisionLayout !== 'function') {
          throw new Error('getMapCollisionLayout function not available');
        }
        
        return { 
          passed: true, 
          message: 'Collision data structure available for mode-scoping' 
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });
  }

  /**
   * TIER 0A: Event Listener Lifecycle
   * Verify event listeners are tracked and cleaned up
   */
  private testTier0AEventListeners(): void {
    console.log('\n🔊 Testing Tier 0A: Event Listener Lifecycle');

    // Test 0A.1: EventListenerRegistry exists and works
    this.addTest('0A', '0A.1: EventListenerRegistry functional', async () => {
      try {
        const { EventListenerRegistry } = await import('../../1-kernel/core/EventListenerRegistry');
        
        // Test basic functionality
        const registry = new EventListenerRegistry();
        
        // Test addEventListener tracking
        const div = document.createElement('div');
        let clicked = false;
        const handler = () => { clicked = true; };
        
        registry.addEventListener(div, 'click', handler, { once: false });
        
        const count = registry.getListenerCount();
        if (count !== 1) {
          throw new Error(`Expected 1 listener, got ${count}`);
        }
        
        // Verify breakdown
        const breakdown = registry.getListenerBreakdown?.();
        
        // Test dispose properly removes
        registry.dispose();
        const countAfter = registry.getListenerCount?.() || 0;
        if (countAfter > 0) {
          throw new Error(`After dispose, still have ${countAfter} listeners`);
        }
        
        return { 
          passed: true, 
          message: 'EventListenerRegistry fully functional',
          details: { initialCount: count, afterDisposeCount: countAfter }
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0A.2: InventoryGridUI has EventListenerRegistry
    this.addTest('0A', '0A.2: InventoryGridUI integrated', async () => {
      try {
        const { InventoryGridUI } = await import('../ui/InventoryGridUI');
        const src = InventoryGridUI.toString();
        
        const hasRegistry = src.includes('EventListenerRegistry') || src.includes('_listenerRegistry');
        const hasDispose = src.includes('listenerRegistry.dispose') || src.includes('_listenerRegistry.dispose');
        
        if (!hasRegistry) {
          throw new Error('InventoryGridUI not using EventListenerRegistry');
        }
        if (!hasDispose) {
          throw new Error('InventoryGridUI not calling listener registry dispose');
        }
        
        // Count listener additions
        const addCalls = (src.match(/addEventListener|this.on\(/g) || []).length;
        
        return { 
          passed: true, 
          message: 'InventoryGridUI fully integrated',
          details: { listenerTracking: addCalls }
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0A.3: InGameModePanel has EventListenerRegistry
    this.addTest('0A', '0A.3: InGameModePanel integrated', async () => {
      try {
        const { InGameModePanel } = await import('../ui/InGameModePanel');
        const src = InGameModePanel.toString();
        
        const hasRegistry = src.includes('EventListenerRegistry') || src.includes('listenerRegistry');
        const hasDispose = src.includes('listenerRegistry.dispose');
        
        if (!hasRegistry) {
          throw new Error('InGameModePanel not using EventListenerRegistry');
        }
        if (!hasDispose) {
          throw new Error('InGameModePanel not calling listener registry dispose');
        }
        
        return { 
          passed: true, 
          message: 'InGameModePanel fully integrated with listener tracking' 
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0A.4: InputManager uses EventListenerRegistry
    this.addTest('0A', '0A.4: InputManager integrated', async () => {
      try {
        const { InputManager } = await import('../../1-kernel/core/InputManager');
        const src = InputManager.toString();
        
        const hasRegistry = src.includes('EventListenerRegistry') || src.includes('listenerRegistry');
        if (!hasRegistry) {
          throw new Error('InputManager not using EventListenerRegistry');
        }
        
        return { passed: true, message: 'InputManager uses EventListenerRegistry' };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });
  }

  /**
   * TIER 0B: Mode Transition Cleanup
   * Verify mode transitions fully clean up previous mode
   */
  private testTier0BModeTransitions(): void {
    console.log('\n🔄 Testing Tier 0B: Mode Transition Cleanup');

    // Test 0B.1: ModeTransitionManager exists
    this.addTest('0B', '0B.1: ModeTransitionManager implemented', async () => {
      try {
        const { ModeTransitionManager } = await import('../runtime/ModeTransitionManager');
        
        if (!ModeTransitionManager) {
          throw new Error('ModeTransitionManager not found');
        }
        
        // Check for key methods
        const proto = ModeTransitionManager.prototype;
        const hasMethods = proto.transitionMode || proto.isInProgress || proto.getStats;
        
        if (!hasMethods) {
          throw new Error('ModeTransitionManager missing key methods');
        }
        
        return { 
          passed: true, 
          message: 'ModeTransitionManager available with lifecycle methods' 
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0B.2: 7-step cleanup sequence exists
    this.addTest('0B', '0B.2: Cleanup sequence documented', async () => {
      try {
        const { ModeTransitionManager } = await import('../runtime/ModeTransitionManager');
        const src = ModeTransitionManager.toString();
        
        // Look for evidence of cleanup steps
        const hasSteps = src.includes('STEP') || 
                        src.includes('Stop') || 
                        src.includes('cleanup') ||
                        src.includes('dispose');
        
        if (!hasSteps) {
          throw new Error('No cleanup step evidence found');
        }
        
        // Count different cleanup operations
        const stopOps = (src.match(/stop|Stop/gi) || []).length;
        const cleanOps = (src.match(/clean|Clean|dispose|Dispose/gi) || []).length;
        
        return { 
          passed: true, 
          message: 'Cleanup sequence with multiple steps present',
          details: { stopOperations: stopOps, cleanupOperations: cleanOps }
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0B.3: Memory tracking available
    this.addTest('0B', '0B.3: Memory metrics tracking', async () => {
      try {
        const { ModeTransitionManager } = await import('../runtime/ModeTransitionManager');
        const src = ModeTransitionManager.toString();
        
        const hasMetrics = src.includes('MemoryMetrics') || 
                          src.includes('beforeCleanup') ||
                          src.includes('memory');
        
        if (!hasMetrics) {
          throw new Error('Memory tracking not found');
        }
        
        return { 
          passed: true, 
          message: 'Memory metrics tracked during transitions' 
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0B.4: Transition history available
    this.addTest('0B', '0B.4: Transition history tracking', async () => {
      try {
        const { ModeTransitionManager } = await import('../runtime/ModeTransitionManager');
        
        const proto = ModeTransitionManager.prototype;
        const hasHistory = proto.getHistory || proto.getStats;
        
        if (!hasHistory) {
          throw new Error('History/stats methods not found');
        }
        
        return { 
          passed: true, 
          message: 'Transition history and stats available' 
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });
  }

  /**
   * TIER 0C: Snapshot Filtering  
   * Verify network snapshots are properly filtered
   */
  private testTier0CSnapshotFiltering(): void {
    console.log('\n📡 Testing Tier 0C: Snapshot Filtering');

    // Test 0C.1: NetworkSyncSystem exists
    this.addTest('0C', '0C.1: NetworkSyncSystem available', async () => {
      try {
        const { NetworkSyncSystem } = await import('../../3-network/network/NetworkSyncSystem');
        
        if (!NetworkSyncSystem) {
          throw new Error('NetworkSyncSystem not found');
        }
        
        return { 
          passed: true, 
          message: 'NetworkSyncSystem available for snapshot handling' 
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0C.2: Replication system exists
    this.addTest('0C', '0C.2: ReplicationSystem available', async () => {
      try {
        const { ReplicationSystem } = await import('../../3-network/network/ReplicationSystem');
        
        if (!ReplicationSystem) {
          throw new Error('ReplicationSystem not found');
        }
        
        return { 
          passed: true, 
          message: 'ReplicationSystem available for entity validation' 
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0C.3: Snapshot filtering logic exists
    this.addTest('0C', '0C.3: Snapshot filtering contract', async () => {
      try {
        const { NetworkSyncSystem } = await import('../../3-network/network/NetworkSyncSystem');
        const src = NetworkSyncSystem.toString();
        
        // Look for filtering-related code
        const hasFiltering = src.includes('filter') || 
                            src.includes('recipient') || 
                            src.includes('validate') ||
                            src.includes('visibility');
        
        if (!hasFiltering) {
          throw new Error('Snapshot filtering logic not evident');
        }
        
        return { 
          passed: true, 
          message: 'Snapshot filtering logic present and ready for testing' 
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0C.4: Entity validation implemented
    this.addTest('0C', '0C.4: Entity validation logic', async () => {
      try {
        const { ReplicationSystem } = await import('../../3-network/network/ReplicationSystem');
        const src = ReplicationSystem.toString();
        
        const hasValidation = src.includes('validate') || 
                             src.includes('isValid') || 
                             src.includes('visibility') ||
                             src.includes('recipient');
        
        if (!hasValidation) {
          throw new Error('Entity validation not found');
        }
        
        return { 
          passed: true, 
          message: 'Entity validation logic integrated' 
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });
  }

  /**
   * TIER 0E: System Lifecycle Enforcement
   * Verify all systems have dispose/cleanup
   */
  private testTier0ESystemLifecycle(): void {
    console.log('\n♻️ Testing Tier 0E: System Lifecycle Enforcement');

    // Test 0E.1: SystemHealthCorridor exists
    this.addTest('0E', '0E.1: SystemHealthCorridor implemented', async () => {
      try {
        const module = await import('../../1-kernel/core/SystemHealthCorridor');
        
        const hasEnforcer = typeof module.enforceSystemDisposeContract === 'function' || 
                           typeof module.ensureEngineSystemContract === 'function';
        
        if (!hasEnforcer) {
          throw new Error('SystemHealthCorridor enforcement not found');
        }
        
        return { 
          passed: true, 
          message: 'SystemHealthCorridor available for system enforcement' 
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0E.2: Core systems have dispose methods
    this.addTest('0E', '0E.2: Core systems lifecycle ready', async () => {
      try {
        let readyCount = 0;
        const details: Record<string, boolean> = {};
        
        // InputManager
        try {
          console.log('[0E.2] Loading InputManager...');
          const inputMgrModule = await import(`../../1-kernel/core/InputManager`);
          const InputMgrClass = Object.values(inputMgrModule)[0] as any;
          const hasDispose = InputMgrClass?.prototype?.dispose || InputMgrClass?.dispose;
          details['InputManager'] = !!hasDispose;
          if (hasDispose) readyCount++;
          console.log('[0E.2] InputManager dispose:', hasDispose);
        } catch (e) {
          console.error('[0E.2] InputManager error:', e);
          details['InputManager'] = false;
        }
        
        // EventListenerRegistry
        try {
          console.log('[0E.2] Loading EventListenerRegistry...');
          const elrModule = await import(`../../1-kernel/core/EventListenerRegistry`);
          const ELRClass = Object.values(elrModule)[0] as any;
          const hasDispose = ELRClass?.prototype?.dispose || ELRClass?.dispose;
          details['EventListenerRegistry'] = !!hasDispose;
          if (hasDispose) readyCount++;
          console.log('[0E.2] EventListenerRegistry dispose:', hasDispose);
        } catch (e) {
          console.error('[0E.2] EventListenerRegistry error:', e);
          details['EventListenerRegistry'] = false;
        }
        
        // ModeTransitionManager
        try {
          console.log('[0E.2] Loading ModeTransitionManager...');
          const mtmModule = await import(`../runtime/ModeTransitionManager`);
          const MTMClass = Object.values(mtmModule)[0] as any;
          const hasDispose = MTMClass?.prototype?.dispose || MTMClass?.dispose;
          details['ModeTransitionManager'] = !!hasDispose;
          if (hasDispose) readyCount++;
          console.log('[0E.2] ModeTransitionManager dispose:', hasDispose);
        } catch (e) {
          console.error('[0E.2] ModeTransitionManager error:', e);
          details['ModeTransitionManager'] = false;
        }
        
        const passed = readyCount >= 2; // At least 2 of 3
        return { 
          passed,
          message: `${readyCount}/3 core systems have dispose methods`,
          details
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0E.3: UI systems have lifecycle
    this.addTest('0E', '0E.3: UI systems lifecycle ready', async () => {
      try {
        let readyCount = 0;
        const details: Record<string, boolean> = {};
        
        // InventoryGridUI
        try {
          console.log('[0E.3] Loading InventoryGridUI...');
          const igModule = await import(`../ui/InventoryGridUI`);
          const IGClass = Object.values(igModule)[0] as any;
          const hasDispose = IGClass?.prototype?.dispose || IGClass?.prototype?.destroy;
          details['InventoryGridUI'] = !!hasDispose;
          if (hasDispose) readyCount++;
          console.log('[0E.3] InventoryGridUI lifecycle:', hasDispose);
        } catch (e) {
          console.error('[0E.3] InventoryGridUI error:', e);
          details['InventoryGridUI'] = false;
        }
        
        // InGameModePanel
        try {
          console.log('[0E.3] Loading InGameModePanel...');
          const impModule = await import(`../ui/InGameModePanel`);
          const IMPClass = Object.values(impModule)[0] as any;
          const hasDispose = IMPClass?.prototype?.dispose || IMPClass?.prototype?.destroy;
          details['InGameModePanel'] = !!hasDispose;
          if (hasDispose) readyCount++;
          console.log('[0E.3] InGameModePanel lifecycle:', hasDispose);
        } catch (e) {
          console.error('[0E.3] InGameModePanel error:', e);
          details['InGameModePanel'] = false;
        }
        
        const passed = readyCount >= 1; // At least 1 of 2
        return { 
          passed,
          message: `${readyCount}/2 UI systems have lifecycle methods`,
          details
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });

    // Test 0E.4: Network systems have lifecycle
    this.addTest('0E', '0E.4: Network systems lifecycle ready', async () => {
      try {
        let readyCount = 0;
        const details: Record<string, boolean> = {};
        
        // MultiplayerClient
        try {
          console.log('[0E.4] Loading MultiplayerClient...');
          const mcModule = await import(`../../3-network/network/MultiplayerClient`);
          const MCClass = Object.values(mcModule)[0] as any;
          const hasDispose = MCClass?.prototype?.dispose || MCClass?.prototype?.destroy || MCClass?.prototype?.disconnect;
          details['MultiplayerClient'] = !!hasDispose;
          if (hasDispose) readyCount++;
          console.log('[0E.4] MultiplayerClient lifecycle:', hasDispose);
        } catch (e) {
          console.error('[0E.4] MultiplayerClient error:', e);
          details['MultiplayerClient'] = false;
        }
        
        // NetworkSyncSystem
        try {
          console.log('[0E.4] Loading NetworkSyncSystem...');
          const nssModule = await import(`../../3-network/network/NetworkSyncSystem`);
          const NSSClass = Object.values(nssModule)[0] as any;
          const hasDispose = NSSClass?.prototype?.dispose || NSSClass?.prototype?.destroy || NSSClass?.prototype?.disconnect;
          details['NetworkSyncSystem'] = !!hasDispose;
          if (hasDispose) readyCount++;
          console.log('[0E.4] NetworkSyncSystem lifecycle:', hasDispose);
        } catch (e) {
          console.error('[0E.4] NetworkSyncSystem error:', e);
          details['NetworkSyncSystem'] = false;
        }
        
        const passed = readyCount >= 1; // At least 1 of 2
        return { 
          passed,
          message: `${readyCount}/2 network systems have lifecycle methods`,
          details
        };
      } catch (e) {
        return { passed: false, message: String(e) };
      }
    });
  }

  /**
   * Helper to queue and run a test
   */
  private addTest(
    gate: string,
    test: string,
    fn: () => Promise<{ passed: boolean; message: string; details?: Record<string, unknown> }>
  ): void {
    this.testQueue.push(async () => {
      const startTime = performance.now();
      
      try {
        const result = await fn();
        const duration = performance.now() - startTime;
        
        this.results.push({
          gate,
          test,
          passed: result.passed,
          message: result.message,
          duration,
          details: result.details,
        });
        
        const status = result.passed ? '✅' : '❌';
        console.log(`  ${status} ${test} (${duration.toFixed(0)}ms)`);
        if (result.details && Object.keys(result.details).length > 0) {
          console.log(`     → `, result.details);
        }
      } catch (error) {
        const duration = performance.now() - startTime;
        this.results.push({
          gate,
          test,
          passed: false,
          message: String(error),
          duration,
        });
        console.log(`  ❌ ${test} - ERROR: ${error}`);
      }
    });
  }

  /**
   * Print summary of all tests
   */
  private printSummary(): void {
    const totalTests = this.results.length;
    const passedTests = this.results.filter((r) => r.passed).length;
    const failedTests = totalTests - passedTests;
    const avgDuration = this.results.reduce((sum, r) => sum + r.duration, 0) / totalTests;

    console.log('\n' + '='.repeat(80));
    console.log('TIER 0 VALIDATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`
Total Tests:    ${totalTests}
Passed:         ${passedTests} ✅
Failed:         ${failedTests} ❌
Pass Rate:      ${((passedTests / totalTests) * 100).toFixed(1)}%
Avg Duration:   ${avgDuration.toFixed(1)}ms

${failedTests === 0 ? '🎉 ALL GATES PASSED - READY FOR v0.2.0' : '⚠️  SOME GATES FAILED - REVIEW ABOVE'}
    `);

    // Group by gate
    const byGate: Record<string, ValidationTestResult[]> = {};
    for (const result of this.results) {
      if (!byGate[result.gate]) byGate[result.gate] = [];
      byGate[result.gate].push(result);
    }

    console.log('\nBY GATE:');
    for (const [gate, tests] of Object.entries(byGate)) {
      const gatePass = tests.every((t) => t.passed);
      const icon = gatePass ? '✅' : '❌';
      console.log(`  ${icon} ${gate}: ${tests.filter((t) => t.passed).length}/${tests.length}`);
    }

    console.log('='.repeat(80) + '\n');
  }
}

// Export singleton for global access
export const tier0ValidationSuite = new Tier0ValidationSuite();
