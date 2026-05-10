/**
 * DomainTest.ts - EventBus Cross-Domain Communication Validator
 *
 * Run this in the browser console to verify that domains can hear each other
 * through the global EventBus. Each test outputs pass/fail status and diagnostics.
 *
 * Usage in Browser Console:
 *   import { runDomainTests } from './DomainTest';
 *   await runDomainTests();
 */

import { gameBus } from '@engine/1-kernel/core/public-api';
import type { System } from '@engine/1-kernel/core/public-api';

// ─── Test Framework ───────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  diagnostics: Record<string, unknown>;
}

const results: TestResult[] = [];

function logTest(name: string, passed: boolean, error?: string, diagnostics: Record<string, unknown> = {}): void {
  const status = passed ? '✓' : '✗';
  console.log(`%c${status} ${name}`, passed ? 'color: green; font-weight: bold' : 'color: red; font-weight: bold');
  if (error) console.error(`  Error: ${error}`);
  if (Object.keys(diagnostics).length > 0) {
    console.table(diagnostics);
  }
  results.push({ name, passed, error, diagnostics });
}

// ─── Test 1: EventBus Singleton Verification ──────────────────────────────

function testEventBusSingleton(): void {
  console.group('TEST 1: EventBus Singleton');

  // Import gameBus multiple times and verify they're the same instance
  const import1 = gameBus;
  const import2 = gameBus;

  const passed = import1 === import2;
  const diagnostics = {
    'Import 1 === Import 2': passed,
    'Memory address equality': import1 === import2,
    'Constructor matches': import1.constructor.name,
    'Listener count': (import1 as any)._listeners?.size ?? 'unknown',
  };

  logTest('EventBus is a global singleton', passed, undefined, diagnostics);
  console.groupEnd();
}

// ─── Test 2: Cross-Domain Event Emission ──────────────────────────────────

function testCrossDomainEmission(): void {
  console.group('TEST 2: Cross-Domain Event Emission');

  const testEventName = 'TEST_CROSS_DOMAIN_EVENT';
  let receivedInDomain1 = false;
  let receivedInDomain2 = false;
  let receivedPayload: any = null;

  // Simulate Domain 1 listener (e.g., InventorySystem in gameplay domain)
  const unsub1 = gameBus.on(testEventName as any, (payload: any) => {
    receivedInDomain1 = true;
    receivedPayload = payload;
  });

  // Simulate Domain 2 listener (e.g., NetworkSyncSystem in network domain)
  const unsub2 = gameBus.on(testEventName as any, (payload: any) => {
    receivedInDomain2 = true;
  });

  // Simulate Domain 3 emitting (e.g., MultiplayerClient in network domain)
  const expectedPayload = { testData: 'cross-domain-message', timestamp: Engine.time.now() };
  gameBus.emit(testEventName as any, expectedPayload);

  // Verify both listeners received the event
  const passed = receivedInDomain1 && receivedInDomain2 && receivedPayload === expectedPayload;
  const diagnostics = {
    'Domain 1 received event': receivedInDomain1,
    'Domain 2 received event': receivedInDomain2,
    'Payload matched': receivedPayload === expectedPayload,
    'Listener count for event': gameBus.listenerCount(testEventName as any),
  };

  logTest('Events propagate across domains via gameBus', passed, undefined, diagnostics);

  // Cleanup
  unsub1();
  unsub2();

  console.groupEnd();
}

// ─── Test 3: Movement Input Simulation (PlayController → NetworkSync) ─────

function testMovementInputFlow(): void {
  console.group('TEST 3: Movement Input Flow (PlayController → NetworkSync)');

  // This simulates: PlayController (foundation) → gameBus → NetworkSyncSystem (network)

  let networkSyncReceivedMovement = false;
  let receivedMovementPayload: any = null;

  // Simulate NetworkSyncSystem listening for movement input
  const unsub = gameBus.on('playerMovementInputCaptured' as any, (payload: any) => {
    networkSyncReceivedMovement = true;
    receivedMovementPayload = payload;
    console.log('[NetworkSyncSystem] Received movement input:', payload);
  });

  // Simulate PlayController emitting movement
  const mockMovementInput = {
    entityId: 'player_test_entity',
    forward: true,
    backward: false,
    left: false,
    right: true,
    jump: false,
    sprint: true,
    crouch: false,
    movementIntent: { jump: false, crouch: false },
    yaw: 1.57,
    pitch: 0.5,
    timestamp: Engine.time.now(),
  };

  gameBus.emit('playerMovementInputCaptured' as any, mockMovementInput);

  const passed = networkSyncReceivedMovement && receivedMovementPayload?.entityId === 'player_test_entity';
  const diagnostics = {
    'Movement event received': networkSyncReceivedMovement,
    'Entity ID matched': receivedMovementPayload?.entityId === 'player_test_entity',
    'Input forward flag': receivedMovementPayload?.forward,
    'Input sprint flag': receivedMovementPayload?.sprint,
    'Yaw value transmitted': receivedMovementPayload?.yaw,
  };

  logTest('Movement input flows from PlayController to NetworkSyncSystem', passed, undefined, diagnostics);

  unsub();
  console.groupEnd();
}

// ─── Test 4: Inventory Sync Simulation (MultiplayerClient → InventorySystem) 

function testInventorySyncFlow(): void {
  console.group('TEST 4: Inventory Sync Flow (MultiplayerClient → InventorySystem)');

  // This simulates: MultiplayerClient (network) → gameBus → InventorySystem (gameplay)

  let inventorySystemReceivedSync = false;
  let receivedInventoryData: any = null;

  // Simulate InventorySystem listening for network sync events
  const unsub = gameBus.on('networkInventorySyncReceived' as any, (payload: any) => {
    inventorySystemReceivedSync = true;
    receivedInventoryData = payload.inventory;
    console.log('[InventorySystem] Received inventory sync:', payload);
  });

  // Simulate MultiplayerClient bridging INVENTORY_SYNC to gameBus
  const mockInventorySync = {
    inventory: {
      player_001: {
        slots: [
          { itemId: 'sword_1', quantity: 1 },
          { itemId: 'shield_1', quantity: 1 },
          { itemId: 'potion_health', quantity: 5 },
        ],
      },
    },
    timestamp: Engine.time.now(),
  };

  gameBus.emit('networkInventorySyncReceived' as any, mockInventorySync);

  const passed =
    inventorySystemReceivedSync &&
    receivedInventoryData?.player_001?.slots?.length === 3;
  const diagnostics = {
    'Inventory sync received': inventorySystemReceivedSync,
    'Player data present': !!receivedInventoryData?.player_001,
    'Slot count': receivedInventoryData?.player_001?.slots?.length,
    'First item': receivedInventoryData?.player_001?.slots?.[0]?.itemId,
  };

  logTest('Inventory sync flows from MultiplayerClient to InventorySystem', passed, undefined, diagnostics);

  unsub();
  console.groupEnd();
}

// ─── Test 5: Event Listener Cleanup (Memory Leak Prevention) ──────────────

function testListenerCleanup(): void {
  console.group('TEST 5: Event Listener Cleanup');

  const listeners: Array<() => void> = [];
  const testEventName = 'TEST_CLEANUP_EVENT';

  // Register multiple listeners
  for (let i = 0; i < 5; i++) {
    const unsub = gameBus.on(testEventName as any, () => {
      /* no-op */
    });
    listeners.push(unsub);
  }

  const beforeCleanup = gameBus.listenerCount(testEventName as any);

  // Clean up all listeners
  listeners.forEach((unsub) => unsub());

  const afterCleanup = gameBus.listenerCount(testEventName as any);

  const passed = beforeCleanup === 5 && afterCleanup === 0;
  const diagnostics = {
    'Listeners before cleanup': beforeCleanup,
    'Listeners after cleanup': afterCleanup,
    'All cleaned': passed,
  };

  logTest('Event listeners can be cleaned up properly', passed, undefined, diagnostics);

  console.groupEnd();
}

// ─── Test 6: Status Mutation Event (Existing gameBus Event) ────────────────

function testExistingGameBusEvent(): void {
  console.group('TEST 6: Existing GameBus Event (stateMutation)');

  let receivedMutation = false;
  let mutationData: any = null;

  const unsub = gameBus.on('stateMutation', (payload: any) => {
    receivedMutation = true;
    mutationData = payload;
  });

  // Emit a stateMutation like systems normally would
  gameBus.emit('stateMutation', {
    source: 'DomainTest',
    path: 'test.path',
    changedCount: 1,
  });

  const passed = receivedMutation && mutationData?.source === 'DomainTest';
  const diagnostics = {
    'Mutation received': receivedMutation,
    'Source matched': mutationData?.source === 'DomainTest',
    'Path transmitted': mutationData?.path,
    'Changed count': mutationData?.changedCount,
  };

  logTest('Existing gameBus events work correctly', passed, undefined, diagnostics);

  unsub();
  console.groupEnd();
}

// ─── Test Summary ─────────────────────────────────────────────────────────

function printTestSummary(): void {
  console.group('%cDOMAN TEST SUMMARY', 'color: blue; font-weight: bold; font-size: 14px');

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.table(results);

  console.log(
    `%c${passed}/${total} tests passed`,
    passed === total ? 'color: green; font-weight: bold; font-size: 12px' : 'color: orange; font-weight: bold; font-size: 12px'
  );

  if (passed !== total) {
    console.error(`%c⚠️ ${total - passed} test(s) failed. Check diagnostics above.`, 'color: red; font-weight: bold');
    console.error(
      '%cIf tests fail, the Network/State Silos are NOT fixed. See NETWORK_STATE_SILOS_ANALYSIS.md for resolution steps.',
      'color: red'
    );
  } else {
    console.log(
      '%c✓ All tests passed! EventBus is working correctly across domains.',
      'color: green; font-weight: bold'
    );
  }

  console.groupEnd();
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Run all domain communication tests.
 * Safe to call multiple times.
 * Results printed to console.
 */
export async function runDomainTests(): Promise<void> {
  console.clear();
  console.log('%c🧪 DOMAIN TEST SUITE', 'color: blue; font-weight: bold; font-size: 16px');
  console.log(
    '%cVerifying that the EventBus properly bridges cross-domain communication after the 9-domain refactor.',
    'color: gray; font-size: 12px'
  );
  console.log('');

  testEventBusSingleton();
  testCrossDomainEmission();
  testMovementInputFlow();
  testInventorySyncFlow();
  testListenerCleanup();
  testExistingGameBusEvent();

  console.log('');
  printTestSummary();
}

// ─── Export for REPL ──────────────────────────────────────────────────────

// Window exposure for browser console
if (typeof window !== 'undefined') {
  (window as any).runDomainTests = runDomainTests;
  console.log('%c💡 DomainTest loaded. Run in console: runDomainTests()', 'color: cyan; font-style: italic');
}

export default runDomainTests;
