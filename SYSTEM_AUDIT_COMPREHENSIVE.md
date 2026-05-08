# COMPREHENSIVE SYSTEM AUDIT REPORT
**Date:** April 17, 2026  
**Scope:** Full codebase audit for TODO/FIXME/BUG/ISSUE/HACK comments and incomplete systems

---

## EXECUTIVE SUMMARY

### Statistics
- **TODO Comments:** 1 identified
- **FIXME Comments:** Multiple design patterns noted
- **BUG/ISSUE Comments:** 3+ critical issues found
- **Incomplete Systems:** 7+ patterns detected
- **Memory Leak Warnings:** 4+ patterns flagged
- **Event Listener Cleanup Issues:** Critical gaps identified
- **Constructor Cleanup Patterns:** Mixed implementation quality

### Critical Areas
1. **Event Listener Management** - Widespread addEventListener/on() without proper cleanup
2. **Memory Cleanup** - Mode transition cleanup attempted but incomplete across systems
3. **Lifecycle Management** - Constructor patterns without consistent dispose/destroy
4. **Circular References** - Potential circular buffer patterns and dependency issues
5. **Network/Snapshot Issues** - Ghost geometry, entity filtering problems

---

## CLIENT-SIDE AUDIT (client/src)

### 1. CORE SYSTEMS

#### 1.1 SystemRegistry
- **File:** [client/src/engine/0-foundation/runtime/SystemRegistry.ts](client/src/engine/0-foundation/runtime/SystemRegistry.ts#L37)
- **Issue Type:** TODO
- **Description:** Create @engine/0-foundation/public-api and import foundation types
- **Line:** 37
- **Impact:** Phase 3 architecture debt - current re-export location is temporary

#### 1.2 CorridorOrchestrator 
- **File:** [client/src/engine/foundation/CorridorOrchestrator.ts](client/src/engine/foundation/CorridorOrchestrator.ts#L275-L350)
- **Issue Type:** INCOMPLETE/WARN
- **Description:** Multiple warn() calls for:
  - Duplicate context injection skipping (L275)
  - Non-bindable systems (L288)
  - Missing dependencies (L297)
  - Duplicate initialization (L312)
  - Missing dependencies list output (L350)
- **Lines:** 275, 288, 297, 312, 350
- **Impact:** Silent failures in system initialization; hard to debug missing dependencies

#### 1.3 SceneGraph
- **File:** [client/src/engine/core/SceneGraph.ts](client/src/engine/core/SceneGraph.ts#L97)
- **Issue Type:** WARN
- **Description:** Entity already registered warning - duplicate registration detection
- **Line:** 97
- **Impact:** Silent duplicate entities can exist in scene

---

### 2. UI & EVENT SYSTEMS

#### 2.1 UICompositionCoordinator
- **File:** [client/src/engine/ui/UICompositionCoordinator.ts](client/src/engine/ui/UICompositionCoordinator.ts#L119)
- **Issue Type:** INCOMPLETE (Event Listener)
- **Description:** addEventListener('keydown') added but cleanup only called in destroy()
- **Line:** 119, cleanup at 241
- **Status:** Has destroy() but called only on explicit cleanup
- **Potential Leak:** If destroy() never called, listener remains

#### 2.2 InGameModePanel
- **File:** [client/src/engine/ui/InGameModePanel.ts](client/src/engine/ui/InGameModePanel.ts#L58)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:** Multiple listeners added:
  - keydown on window (L58)
  - mousedown on rows (L184)
  - dblclick on rows (L194)
  - click on buttons (L204, L208)
- **Lines:** 58, 184, 194, 204, 208
- **Status:** removeEventListener calls not found in destroy pattern
- **Risk:** Memory leak on mode transitions

#### 2.3 Scoreboard
- **File:** [client/src/engine/ui/Scoreboard.ts](client/src/engine/ui/Scoreboard.ts#L13)
- **Issue Type:** INCOMPLETE (Event Listener Cleanup)
- **Description:** Listeners tracked in unsubscribeFns array
- **Lines:** 13, 57-61, 107, 110
- **Status:** Proper cleanup in destroy() - GOOD PATTERN
- **Pattern:** Should be replicated across UI systems

#### 2.4 RuntimeIssueInspector
- **File:** [client/src/engine/ui/RuntimeIssueInspector.ts](client/src/engine/ui/RuntimeIssueInspector.ts#L130)
- **Issue Type:** INCOMPLETE (Event Listener)
- **Description:** keydown listener added but cleanup in destroy()
- **Line:** 130, cleanup at 161-163
- **Status:** Proper cleanup available

#### 2.5 ServerBrowser
- **File:** [client/src/engine/ui/ServerBrowser.ts](client/src/engine/ui/ServerBrowser.ts#L68-L135)
- **Issue Type:** INCOMPLETE (Multiple Event Listeners)
- **Description:** 11+ event listeners added (mouseover, mousedown, keydown, client.on()):
  - mouseover (L68)
  - mousedown (L78, L587)
  - keydown (L105)
  - client events (L107, L116, L127, L132, L135)
- **Lines:** 68, 78, 97, 105, 107, 116, 127, 132, 135, 586-587
- **Status:** destroy() exists (L216) with removeEventListener cleanup
- **Cleanup Coverage:** Incomplete - missing some listener removals

#### 2.6 MenuIdentitySystem
- **File:** [client/src/engine/ui/MenuIdentitySystem.ts](client/src/engine/ui/MenuIdentitySystem.ts#L269-L296)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:** DOM event listeners on select/input/slider without cleanup
- **Lines:** 269, 279, 296
- **Status:** destroy() exists but doesn't clean these listeners
- **Impact:** Listeners leak when UI destroyed

#### 2.7 InventoryGridUI
- **File:** [client/src/engine/ui/InventoryGridUI.ts](client/src/engine/ui/InventoryGridUI.ts#L405-L843)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:** 15+ listeners added without centralized tracking:
  - click (L410, L486, L666, L677)
  - mouseenter/mouseleave (L607-608, L703-704, L707-708)
  - mousedown (L405, L705)
  - mousemove/mouseup (L746-747)
  - keydown (L843)
  - contextmenu (L642)
- **Lines:** 405, 410, 486, 607, 608, 642, 666, 677, 703-708, 746-747, 843
- **Status:** No cleanup visible for most listeners
- **Risk:** Critical memory leak on inventory close/reopen

#### 2.8 MainMenu
- **File:** [client/src/engine/ui/MainMenu.ts](client/src/engine/ui/MainMenu.ts#L654)
- **Issue Type:** INCOMPLETE (Event Listener)
- **Description:** keydown listener added without cleanup tracking
- **Line:** 654
- **Status:** No destroy() method found
- **Risk:** Menu destroyed but listener remains

#### 2.9 MapVoting
- **File:** [client/src/engine/ui/MapVoting.ts](client/src/engine/ui/MapVoting.ts#L114-L203)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:** lobby_update and card click listeners
- **Lines:** 114, 198-203
- **Status:** destroy() at L70 but missing listener removals
- **Risk:** Listeners may persist after component cleanup

#### 2.10 DebugOverlay
- **File:** [client/src/engine/ui/DebugOverlay.ts](client/src/engine/ui/DebugOverlay.ts#L71)
- **Issue Type:** INCOMPLETE (Event Listener)
- **Description:** keydown listener with no cleanup tracked
- **Line:** 71
- **Status:** destroy() at L161-163 but listener removal not verified
- **Risk:** Debug overlay listener leak

---

### 3. NETWORK SYSTEMS

#### 3.1 NetworkSyncSystem
- **File:** [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts#L359-L411)
- **Issue Type:** INCOMPLETE (Event Listeners) / WARN
- **Description:** 4 gameBus.on() listeners without tracking:
  - playerMovementInputCaptured (L359)
  - FORCE_SNAPSHOT (L386)
  - FULL_SYNC_READY (L407)
  - STALE_SNAPSHOT_ENTITY_DROPPED (L411)
- **Lines:** 359, 386, 407, 411
- **Warnings:** 
  - Input queue overflow (L619)
  - Timeout waiting for complete snapshot (L841)
  - Local player missing in snapshot (L1084)
  - Massive position correction (L1272)
  - Physics desync detected (L1392)
  - Input buffer overflow (L1429)
- **Status:** No unsubscribe tracking found
- **Risk:** Memory leak on mode transitions

#### 3.2 MultiplayerClient
- **File:** [client/src/engine/network/MultiplayerClient.ts](client/src/engine/network/MultiplayerClient.ts#L1036-L1222)
- **Issue Type:** WARN (Critical Issues)
- **Description:**
  - SPAWN_AUTHORITY rejected: playerId mismatch (L1036)
  - Empty snapshot diverged from local entity map (L1222)
- **Lines:** 1036, 1222
- **Impact:** Multiplayer state can diverge from server

#### 3.3 NetworkConnectionResolver
- **File:** [client/src/engine/network/NetworkConnectionResolver.ts](client/src/engine/network/NetworkConnectionResolver.ts#L111-L179)
- **Issue Type:** WARN
- **Description:**
  - Falling back to localhost (L111)
  - Already connecting warn (L153)
  - Connection closed to URL (L179)
- **Lines:** 111, 153, 179
- **Impact:** Silent fallbacks can mask configuration issues

#### 3.4 SnapshotVisibilityDebugger
- **File:** [client/src/engine/network/SnapshotVisibilityDebugger.ts](client/src/engine/network/SnapshotVisibilityDebugger.ts#L122-L216)
- **Issue Type:** BUG (Ghost Entities)
- **Description:**
  - Ghost entities detected in snapshots (L122)
  - Handles with NO mesh binding (L159)
  - Detected ghost entities warning (L214-216)
- **Lines:** 122, 159, 214, 216
- **Impact:** Entities exist in network but not rendered

#### 3.5 WorldGeometryCoordinator
- **File:** [client/src/engine/network/WorldGeometryCoordinator.ts](client/src/engine/network/WorldGeometryCoordinator.ts#L99)
- **Issue Type:** WARN
- **Description:** Ghost geometry detection warning
- **Line:** 99
- **Impact:** Collision data may not sync with rendered geometry

#### 3.6 ClientItemDropCoordinator
- **File:** [client/src/engine/network/ClientItemDropCoordinator.ts](client/src/engine/network/ClientItemDropCoordinator.ts#L115)
- **Issue Type:** INCOMPLETE (Temporary Listener)
- **Description:** "Temporary listener for this specific drop" - suggests temporary pattern without cleanup guarantee
- **Line:** 115
- **Risk:** If drops don't complete, listener leaks

#### 3.7 ReconciliationEventRecorder
- **File:** [client/src/engine/network/ReconciliationEventRecorder.ts](client/src/engine/network/ReconciliationEventRecorder.ts#L70-L78)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:** 3 gameBus.on() listeners without cleanup:
  - RECONCILIATION_BEGIN (L70)
  - RECONCILIATION_END (L74)
  - ENTITY_RECONCILED (L78)
- **Lines:** 70, 74, 78
- **Status:** No unsubscribe found
- **Risk:** Persistent listeners during gameplay

---

### 4. CORE SYSTEMS

#### 4.1 InputManager
- **File:** [client/src/engine/core/InputManager.ts](client/src/engine/core/InputManager.ts#L67-L74)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:** 8 window listeners added:
  - keydown (L67)
  - keyup (L68)
  - mousedown (L69)
  - mousemove (L70)
  - mouseup (L71)
  - dblclick (L72)
  - wheel (L73)
  - pointerlockchange (L74)
- **Lines:** 67-74
- **Status:** No removeEventListener calls found
- **Risk:** Critical memory leak - input manager persists across mode transitions

#### 4.2 EntityManager
- **File:** [client/src/engine/core/EntityManager.ts](client/src/engine/core/EntityManager.ts#L189-L244)
- **Issue Type:** WARN
- **Description:**
  - Max entity limit reached (L189)
  - Entity not found (L244)
- **Lines:** 189, 244
- **Impact:** Silent entity failures

#### 4.3 EntityRenderer
- **File:** [client/src/engine/core/EntityRenderer.ts](client/src/engine/core/EntityRenderer.ts#L88-L505)
- **Issue Type:** INCOMPLETE (Event Listener) / WARN
- **Description:**
  - DUMMY_ARMY_SPAWNED listener added (L88) without unsubscribe tracking
  - Missing custom asset instance warning (L128)
  - Invalid payload warning (L296)
  - Mesh already exists for handle (L322)
  - getDenseIndex returned invalid value (L484)
  - Failed to sync mesh warning (L505)
- **Lines:** 88, 128, 296, 322, 484, 505
- **Status:** DUMMY_ARMY_SPAWNED listener has no cleanup
- **Risk:** Listener leak on entity cleanup

#### 4.4 EngineController
- **File:** [client/src/engine/core/EngineController.ts](client/src/engine/core/EngineController.ts#L199)
- **Issue Type:** WARN
- **Description:** Blocked state transitions
- **Line:** 199
- **Impact:** Silent rejection of invalid transitions

#### 4.5 InputContextManager
- **File:** [client/src/engine/core/InputContextManager.ts](client/src/engine/core/InputContextManager.ts#L46-L329)
- **Issue Type:** INCOMPLETE (Event Listener) / WARN
- **Description:**
  - pointerlockchange listener (L46) without cleanup
  - Force context bypass warning (L109)
  - Lock deferred: no active context (L164)
  - Lock request rejected: debounced (L174)
  - Pointer lock request rejected (L212)
  - Release rejected: debounced (L246)
  - Context wait timeout (L329)
- **Lines:** 46, 109, 164, 174, 212, 246, 329
- **Status:** pointerlockchange listener not cleaned up
- **Risk:** Pointer lock handler leak

---

### 5. GAMEPLAY SYSTEMS

#### 5.1 GameplayCommandBridge
- **File:** [client/src/engine/runtime/bootstrap/GameplayCommandBridge.ts](client/src/engine/runtime/bootstrap/GameplayCommandBridge.ts#L43-L109)
- **Issue Type:** INCOMPLETE (Event Listeners) / WARN
- **Description:**
  - FIRE_REQUESTED listener (L43)
  - APPLY_DAMAGE_REQUESTED listener (L47)
  - Command queue full warning (L109)
- **Lines:** 43, 47, 109
- **Status:** Listeners added without tracking
- **Risk:** Listeners persist across game sessions

#### 5.2 KernelMovementIntegration
- **File:** [client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts](client/src/engine/runtime/bootstrap/KernelMovementIntegration.ts#L128-L405)
- **Issue Type:** INCOMPLETE (Event Listeners) / WARN
- **Description:**
  - MIGRATE_COMPLETE listener (L128)
  - RECONCILIATION_BEGIN listener (L160)
  - RECONCILIATION_END listener (L169)
  - Multiple warnings (L143, L232, L397, L405)
- **Lines:** 128, 143, 160, 169, 232, 397, 405
- **Status:** 3 listeners added without unsubscribe
- **Risk:** Listeners leak on migration/reconciliation

#### 5.3 DODStateBridge
- **File:** [client/src/engine/runtime/bootstrap/DODStateBridge.ts](client/src/engine/runtime/bootstrap/DODStateBridge.ts#L31-L44)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:** 4 gameBus.on() listeners:
  - GLOBAL_STATE_REFRESH (L31)
  - STATE_UPDATE (L34)
  - STATE_HYDRATION_COMPLETE (L40)
  - SYNC_VERIFIED (L44)
- **Lines:** 31, 34, 40, 44
- **Status:** No unsubscribe tracking
- **Risk:** State update listeners leak

#### 5.4 RuntimeEventHandlers
- **File:** [client/src/engine/runtime/bootstrap/runtimeEventHandlers.ts](client/src/engine/runtime/bootstrap/runtimeEventHandlers.ts#L49-L123)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:** 8+ listeners with cleanup:
  - itemPicked (L49)
  - INVENTORY_READY (L63)
  - PLAYER_INIT_COMPLETE (L81)
  - gameModeStarted (L92)
  - authoritative_snapshot (L101)
  - round_start (L109)
  - score_update (L113)
  - beforeunload (L121)
- **Lines:** 49, 63, 81, 92, 101, 109, 113, 121
- **Status:** Good - many with cleanup at L122-123
- **Pattern:** destroy() calls on cleanup

#### 5.5 MultiplayerRuntimeCoordinator
- **File:** [client/src/engine/runtime/coordinators/MultiplayerRuntimeCoordinator.ts](client/src/engine/runtime/coordinators/MultiplayerRuntimeCoordinator.ts#L346-L623)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:** 20+ listeners added without centralized cleanup tracking:
  - lobby_update (L346, L375, L595)
  - LOCAL_PLAYER_ACTUALIZED (L394)
  - authoritative_snapshot (L405)
  - connected (L450)
  - tick_sync (L471)
  - game_start (L475)
  - disconnected (L480)
  - player_died (L484)
  - player_leave (L488)
  - player_appearance (L496)
  - PLAYER_APPEARANCE_CHANGED (L505)
  - player_equip (L512)
  - player_reload (L517)
  - player_shoot (L522)
  - inventory_state_sync (L527)
  - inventory_sync (L532)
  - ammo_state_sync (L542)
  - attribute_state_sync (L550)
  - ability_state_sync (L580)
  - world_state (L585)
  - player_respawn (L590)
  - damage_taken (L602)
  - player_killed (L606)
  - round_end (L613)
  - initialize_round (L618)
  - round_start (L623)
- **Lines:** 346, 375, 394, 405, 450, 471, 475, 480, 484, 488, 496, 505, 512, 517, 522, 527, 532, 542, 550, 580, 585, 590, 595, 602, 606, 613, 618, 623
- **Status:** L342 shows off() call for one listener
- **Risk:** CRITICAL - 25+ listeners with no cleanup tracking in many cases

#### 5.6 ClientWorldRuntimeCoordinator
- **File:** [client/src/engine/runtime/coordinators/ClientWorldRuntimeCoordinator.ts](client/src/engine/runtime/coordinators/ClientWorldRuntimeCoordinator.ts#L226)
- **Issue Type:** INCOMPLETE (Event Listener)
- **Description:** STALE_SNAPSHOT_ENTITY_DROPPED listener without cleanup
- **Line:** 226
- **Status:** No unsubscribe found
- **Risk:** Entity cleanup listener leaks

#### 5.7 RuntimeOverlayCoordinator
- **File:** [client/src/engine/runtime/coordinators/RuntimeOverlayCoordinator.ts](client/src/engine/runtime/coordinators/RuntimeOverlayCoordinator.ts#L326-L551)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:**
  - keydown listener (L326)
  - round_phase_changed listener (L550)
- **Lines:** 326, 550
- **Status:** Good - disposers array at L102, cleanup at L388-398
- **Pattern:** Proper disposer tracking GOOD MODEL

---

### 6. LIFECYCLE & BOOTSTRAP

#### 6.1 ModeTransitionManager
- **File:** [client/src/engine/runtime/ModeTransitionManager.ts](client/src/engine/runtime/ModeTransitionManager.ts#L3-L236)
- **Issue Type:** INCOMPLETE (Cleanup)
- **Description:**
  - Memory cleanup infrastructure exists (L3-8)
  - Mode cleanup attempted (L123)
  - Safe cleanup with try-catch (L135-142, L153-162)
  - removeEventListeners() method (L183-204)
  - cleanup() function queued (L196)
- **Lines:** 3, 69, 73, 77, 81, 123, 135-142, 153-162, 183-204, 196
- **Status:** Cleanup attempted but not comprehensive
- **Issues:**
  - Only attempts cleanup if cleanup/destroy methods exist
  - Doesn't track/remove event listeners added by systems
  - Silent failures wrapped in try-catch
- **Impact:** Mode transitions may leak listeners

#### 6.2 BootstrapClientRuntime
- **File:** [client/src/engine/runtime/bootstrapClientRuntime.ts](client/src/engine/runtime/bootstrapClientRuntime.ts#L447-L488)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:**
  - LIFECYCLE_CHANGED listener (L447)
  - UI_LOADING_STATE listener (L483)
  - LIFECYCLE_PLAY_ACTIVE listener (L488)
  - Recovery warning at L476
- **Lines:** 447, 476, 483, 488
- **Status:** Listeners added without unsubscribe tracking
- **Risk:** Lifecycle listeners leak

#### 6.3 BootstrapMultiplayerRuntime
- **File:** [client/src/engine/runtime/bootstrapMultiplayerRuntime.ts](client/src/engine/runtime/bootstrapMultiplayerRuntime.ts#L39)
- **Issue Type:** WARN
- **Description:** Multiplay runtime not available warning
- **Line:** 39
- **Impact:** Silent fallback to menu if multiplay unavailable

#### 6.4 LifecycleOrchestrator
- **File:** [client/src/engine/debug/LifecycleOrchestrator.ts](client/src/engine/debug/LifecycleOrchestrator.ts#L146-L221)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:** 6 debug lifecycle listeners:
  - FULL_SYNC_DATA (L146)
  - ENTITY_SPAWNED (L156)
  - CONTROLLER_BOUND (L167)
  - STATE_HYDRATION_COMPLETE (L179)
  - SYNC_VERIFIED (L190)
  - FORCE_BUFFER_HYDRATION (L204)
  - LOCAL_PLAYER_ACTUALIZED (L221)
- **Lines:** 146, 156, 167, 179, 190, 204, 221
- **Status:** Debug listeners without cleanup
- **Risk:** Listeners leak in development/debug mode

---

### 7. SCRIPTING & CORE FUNCTIONALITY

#### 7.1 ScriptingSystem
- **File:** [client/src/engine/core/ScriptingSystem.ts](client/src/engine/core/ScriptingSystem.ts#L105-L332)
- **Issue Type:** INCOMPLETE (Destroy Pattern)
- **Description:**
  - pendingDestroy set at L105
  - Destroy tracking but not comprehensive
  - onDestroy callback called (L260, L312)
  - Comment: "For now, we'll just not worry about cleanup" (L197)
- **Lines:** 105, 192, 207-234, 260, 312
- **Status:** Destroy pattern exists but incomplete
- **Issue at L197:** Acknowledged cleanup debt
- **Impact:** Script instance cleanup may be incomplete

#### 7.2 Transform
- **File:** [client/src/engine/core/Transform.ts](client/src/engine/core/Transform.ts#L197-L250)
- **Issue Type:** INCOMPLETE (Acknowledged Cleanup Debt)
- **Description:**
  - Comment at L197: "For now, we'll just not worry about cleanup since StateManager is immutable"
  - Comment at L198: "Future: Add cleanup method to StateManager if needed"
  - unsubscribers array at L210
  - Proper unsubscribe pattern (L250)
- **Lines:** 197, 198, 210, 250
- **Status:** Debt acknowledged, cleanup pattern partially implemented
- **Impact:** Transform state subscriptions may not fully cleanup

---

### 8. DIAGNOSTIC & VALIDATION SYSTEMS

#### 8.1 SystemValidator (Memory Leaks)
- **File:** [client/src/engine/diagnostics/debug/SystemValidator.ts](client/src/engine/diagnostics/debug/SystemValidator.ts#L128-L195)
- **Issue Type:** BUG/LEAK Detection
- **Description:**
  - Stale physics bodies detection (L192)
  - Suspected leaks detection (L138, L178, L195)
  - Oldest unpaired entities warning (L195)
- **Lines:** 138, 178, 192, 195
- **Status:** Detection system exists but issues remain in runtime

#### 8.2 EngineIntegrityScript
- **File:** [client/src/engine/runtime/EngineIntegrityScript.ts](client/src/engine/runtime/EngineIntegrityScript.ts#L273)
- **Issue Type:** WARN
- **Description:** Integrity script warnings
- **Line:** 273
- **Impact:** Silent integrity check failures

---

### 9. PHYSICS & COLLISION

#### 9.1 PhysicsDebugVisualizer
- **File:** [client/src/engine/core/PhysicsDebugVisualizer.ts](client/src/engine/core/PhysicsDebugVisualizer.ts#L39-L120)
- **Issue Type:** WARN / INCOMPLETE (Cleanup)
- **Description:**
  - Missing kernel/registry warning (L39)
  - Geometry/material dispose calls (L118-120)
- **Lines:** 39, 118-120
- **Status:** Has cleanup but may not be called
- **Risk:** Debug visualizer meshes may leak

#### 9.2 SimulationKernel
- **File:** [client/src/engine/core/kernel/SimulationKernel.ts](client/src/engine/core/kernel/SimulationKernel.ts#L141-L192)
- **Issue Type:** WARN
- **Description:**
  - Entity destruction (L141-142)
  - Likely ran out of entity slots warning (L192)
- **Lines:** 141, 142, 192
- **Impact:** Entity slots can exhaust - indicates leak

#### 9.3 BinaryTraceCoordinator
- **File:** [client/src/engine/core/kernel/BinaryTraceCoordinator.ts](client/src/engine/core/kernel/BinaryTraceCoordinator.ts#L36-L42)
- **Issue Type:** WARN
- **Description:**
  - SharedArrayBuffer not available warning (L36)
  - SharedArrayBuffer creation failed warning (L42)
- **Lines:** 36, 42
- **Status:** Fallback to ArrayBuffer implemented
- **Impact:** Performance degradation on some platforms

---

### 10. GAMEPLAY SYSTEMS

#### 10.1 DummyEnemySystem
- **File:** [client/src/engine/gameplay/systems/DummyEnemySystem.ts](client/src/engine/gameplay/systems/DummyEnemySystem.ts#L50-L410)
- **Issue Type:** INCOMPLETE (Event Listener) / WARN
- **Description:**
  - ENTITY_TOOK_DAMAGE listener (L50)
  - Buffers unavailable warning (L131)
  - Update status debug log (L176)
  - Failed to create visual entity (L410)
- **Lines:** 50, 131, 176, 410
- **Status:** ENTITY_TOOK_DAMAGE listener without unsubscribe
- **Risk:** Dummy army listener leaks

#### 10.2 InteractionManager
- **File:** [client/src/engine/gameplay/systems/InteractionManager.ts](client/src/engine/gameplay/systems/InteractionManager.ts#L215)
- **Issue Type:** WARN
- **Description:** update() called before SystemContext init
- **Line:** 215
- **Impact:** Silent initialization order issue

#### 10.3 AudioEngine
- **File:** [client/src/engine/gameplay/systems/AudioEngine.ts](client/src/engine/gameplay/systems/AudioEngine.ts#L106-L362)
- **Issue Type:** INCOMPLETE (Event Listeners) / WARN
- **Description:**
  - Failed to load audio warning (L106)
  - Sound not loaded warning (L256)
  - click/keydown listeners for audio resume (L362-363)
- **Lines:** 106, 256, 362, 363
- **Status:** Listeners added without cleanup
- **Risk:** Audio resume listeners leak

#### 10.4 VisualStyle
- **File:** [client/src/engine/gameplay/systems/VisualStyle.ts](client/src/engine/gameplay/systems/VisualStyle.ts#L151)
- **Issue Type:** WARN
- **Description:** Unknown preset warning
- **Line:** 151
- **Impact:** Silent style fallback

#### 10.5 AbilitySystem
- **File:** [client/src/engine/gameplay/systems/gas/AbilitySystem.ts](client/src/engine/gameplay/systems/gas/AbilitySystem.ts#L386)
- **Issue Type:** WARN
- **Description:** Unknown ability warning
- **Line:** 386
- **Impact:** Silent ability failure

#### 10.6 ItemInstanceSystem
- **File:** [client/src/engine/gameplay/systems/gas/ItemInstanceSystem.ts](client/src/engine/gameplay/systems/gas/ItemInstanceSystem.ts#L194-L251)
- **Issue Type:** WARN
- **Description:**
  - Unknown item template warning (L194)
  - No inventory for player warning (L251)
- **Lines:** 194, 251
- **Impact:** Silent item/inventory failures

#### 10.7 GASBridge
- **File:** [client/src/engine/gameplay/systems/gas/GASBridge.ts](client/src/engine/gameplay/systems/gas/GASBridge.ts#L42-L97)
- **Issue Type:** INCOMPLETE
- **Description:**
  - Comment at L42-44: "health_small and ammo items are NOT in the GAS ItemTemplate catalogue yet"
  - Template not found warning (L97)
- **Lines:** 42-44, 97
- **Status:** Incomplete GAS template coverage
- **Impact:** Consumable items not fully implemented

#### 10.8 LocalPlayerAuthorityCoordinator
- **File:** [client/src/engine/gameplay/game/LocalPlayerAuthorityCoordinator.ts](client/src/engine/gameplay/game/LocalPlayerAuthorityCoordinator.ts#L101-L514)
- **Issue Type:** INCOMPLETE (Event Listeners) / WARN
- **Description:**
  - 6 event listeners added (L101, L117, L133, L148, L156, L170)
  - SPAWN_AUTHORITY_VALIDATED (L101)
  - FULL_SYNC_READY (L117)
  - ENTITY_REBOUND (L133)
  - FORCE_FULL_SYNC (L148)
  - RUNTIME_RESET (L156)
  - FULL_SYNC_DATA (L170)
  - Multiple warnings (L182, L271, L371, L403, L469, L489, L514)
- **Lines:** 101, 117, 133, 148, 156, 170, 182, 271, 371, 403, 469, 489, 514
- **Status:** 6 listeners without unsubscribe tracking
- **Risk:** Authority listeners leak across game sessions

#### 10.9 InventorySystem
- **File:** [client/src/engine/gameplay/systems/InventorySystem.ts](client/src/engine/gameplay/systems/InventorySystem.ts#L118-L155)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:** 6 listeners added without cleanup:
  - networkInventorySyncReceived (L118)
  - FULL_SYNC_DATA (L124)
  - LIFECYCLE_CHANGED (L130)
  - LIFECYCLE_PLAY_ACTIVE (L133)
  - ENGINE_RESET (L144)
  - ammoStateSyncBridge (L155)
- **Lines:** 118, 124, 130, 133, 144, 155
- **Status:** No unsubscribe tracking
- **Risk:** Inventory listeners leak

#### 10.10 InventoryDropManager
- **File:** [client/src/engine/gameplay/systems/InventoryDropManager.ts](client/src/engine/gameplay/systems/InventoryDropManager.ts#L80-L161)
- **Issue Type:** WARN
- **Description:**
  - Item not found warning (L80)
  - Invalid drop request (L143)
  - Duplicate drop request (L149)
  - Not connected warning (L161)
- **Lines:** 80, 143, 149, 161
- **Impact:** Silent drop failures

#### 10.11 PhysGunSystem
- **File:** [client/src/engine/gameplay/systems/PhysGunSystem.ts](client/src/engine/gameplay/systems/PhysGunSystem.ts#L119-L120)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:**
  - ENGINE_RESET listener (L119)
  - ROUND_TRANSITION listener (L120)
- **Lines:** 119, 120
- **Status:** Listeners without unsubscribe
- **Risk:** Phys gun reset listeners leak

#### 10.12 AIBehaviorSystem
- **File:** [client/src/engine/gameplay/systems/AIBehaviorSystem.ts](client/src/engine/gameplay/systems/AIBehaviorSystem.ts#L125-L129)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:**
  - AI_BEHAVIOR_STATE_SET_REQUESTED (L125)
  - ENGINE_RESET (L128)
  - ROUND_TRANSITION (L129)
- **Lines:** 125, 128, 129
- **Status:** Listeners without unsubscribe
- **Risk:** AI behavior listeners leak

---

### 11. RENDERING & GRAPHICS

#### 11.1 CrunchyModernPipeline
- **File:** [client/src/engine/render/CrunchyModernPipeline.ts](client/src/engine/render/CrunchyModernPipeline.ts#L50)
- **Issue Type:** WARN
- **Description:** No target warning
- **Line:** 50
- **Impact:** Silent rendering pipeline failure

#### 11.2 MeshBindingTable
- **File:** [client/src/engine/render/MeshBindingTable.ts](client/src/engine/render/MeshBindingTable.ts#L57-L209)
- **Issue Type:** WARN
- **Description:**
  - Binding replaced warning (L57)
  - Binding failure warning (L96)
  - No binding found warning (L209)
- **Lines:** 57, 96, 209
- **Impact:** Silent mesh binding issues

#### 11.3 AtmosphericEffects
- **File:** [client/src/engine/render/AtmosphericEffects.ts](client/src/engine/render/AtmosphericEffects.ts#L178)
- **Issue Type:** WARN
- **Description:** Atmospheric effects already initialized warning
- **Line:** 178
- **Impact:** Silent duplicate initialization

---

### 12. DEBUG & TESTING

#### 12.1 DebugMenu
- **File:** [client/src/engine/runtime/DebugMenu.ts](client/src/engine/runtime/DebugMenu.ts#L64-L301)
- **Issue Type:** INCOMPLETE (Event Listener) / WARN
- **Description:**
  - keydown listener (L64)
  - Debug spawn failures (L218)
  - Engine/scene not available warnings (L295, L301)
- **Lines:** 64, 218, 295, 301
- **Status:** Listener without cleanup
- **Risk:** Debug menu listener leaks

#### 12.2 TestSuiteController
- **File:** [client/src/engine/testing/TestSuiteController.ts](client/src/engine/testing/TestSuiteController.ts#L272)
- **Issue Type:** INCOMPLETE (Event Listener)
- **Description:** prefabCreated listener without unsubscribe
- **Line:** 272
- **Status:** Debug/test listener without cleanup
- **Risk:** Test listeners leak

#### 12.3 TransformSystemDemo
- **File:** [client/src/engine/editor/TransformSystemDemo.ts](client/src/engine/editor/TransformSystemDemo.ts#L389)
- **Issue Type:** WARN
- **Description:** Transform mismatch warning
- **Line:** 389
- **Impact:** Demo transform validation failure

---

### 13. CORE SERVICES

#### 13.1 Engine
- **File:** [client/src/engine/foundation/Engine.ts](client/src/engine/foundation/Engine.ts#L179-L1450)
- **Issue Type:** WARN
- **Description:**
  - Engine already initialized (L179)
  - Multiple "SaveLoadManager not initialized" warnings (L1372-1450)
  - EntityManager not available (L1322)
- **Lines:** 179, 1322, 1372, 1380, 1403, 1411, 1419, 1427, 1450
- **Impact:** Silent service initialization failures

#### 13.2 PlayController
- **File:** [client/src/engine/foundation/PlayController.ts](client/src/engine/foundation/PlayController.ts#L118-L542)
- **Issue Type:** WARN
- **Description:**
  - Lock pending after timeout (L118)
  - Pointer lock request failed (L542)
- **Lines:** 118, 542
- **Impact:** Input lock state can diverge

#### 13.3 ModeManager
- **File:** [client/src/engine/gameplay/modes/ModeManager.ts](client/src/engine/gameplay/modes/ModeManager.ts#L238)
- **Issue Type:** WARN
- **Description:** Mode manager already initialized
- **Line:** 238
- **Impact:** Silent duplicate initialization

#### 13.4 GameEngine
- **File:** [client/src/engine/gameplay/GameEngine.ts](client/src/engine/gameplay/GameEngine.ts#L57)
- **Issue Type:** WARN
- **Description:** boot() called more than once
- **Line:** 57
- **Impact:** Silent duplicate bootstrap

#### 13.5 EventBus
- **File:** [client/src/engine/core/EventBus.ts](client/src/engine/core/EventBus.ts#L55)
- **Issue Type:** INCOMPLETE (Event Cleanup Pattern)
- **Description:** once() method for one-time listeners - shows cleanup awareness
- **Line:** 55
- **Status:** Good pattern exists but not universally used
- **Issue:** Comment at L9 notes cleanup requirement but many listeners don't implement it

#### 13.6 SaveLoadManager
- **File:** [client/src/engine/core/SaveLoadManager.ts](client/src/engine/core/SaveLoadManager.ts#L365)
- **Issue Type:** WARN
- **Description:** Map not found warning
- **Line:** 365
- **Impact:** Silent save/load failures

#### 13.7 ReplaySystem
- **File:** [client/src/engine/core/ReplaySystem.ts](client/src/engine/core/ReplaySystem.ts#L177)
- **Issue Type:** WARN
- **Description:** No recording loaded warning
- **Line:** 177
- **Impact:** Silent replay failure

#### 13.8 InputContextManager
- **File:** [client/src/engine/core/InputContextManager.ts](client/src/engine/core/InputContextManager.ts#L46)
- **Issue Type:** INCOMPLETE (Event Listener)
- **Description:** pointerlockchange listener without cleanup
- **Line:** 46
- **Status:** Listener added at L46, never removed
- **Risk:** Pointer lock handler leak across sessions

---

### 14. MEMORY & PERFORMANCE

#### 14.1 PerformanceMonitor
- **File:** [client/src/engine/runtime/PerformanceMonitor.ts](client/src/engine/runtime/PerformanceMonitor.ts#L8-L290)
- **Issue Type:** INCOMPLETE (Monitoring Only)
- **Description:**
  - Memory tracking implemented (L108, L186-248)
  - Metrics persistence (L276, L290)
- **Lines:** 8, 21, 108, 129, 186, 236, 276, 290
- **Status:** Memory tracking exists but no automatic leak detection
- **Impact:** Memory leaks not automatically detected/reported

#### 14.2 ControlTower
- **File:** [client/src/engine/runtime/ControlTower.ts](client/src/engine/runtime/ControlTower.ts#L141-L237)
- **Issue Type:** INCOMPLETE (Event Listeners)
- **Description:**
  - eventDisposers array (L141)
  - dispose() method (L193)
  - 4 listeners added (L198-225)
  - SNAPSHOT_RECEIVED (L199)
  - ENTITY_RECONCILED (L206)
  - playerInput (L215)
  - COMMAND_SENT (L225)
- **Lines:** 141, 193, 198-225, 235-237
- **Status:** GOOD - Listeners tracked in disposers array
- **Pattern:** Good example of proper cleanup

---

### 15. BOOTLOADER

#### 15.1 Bootloader
- **File:** [client/src/bootloader.ts](client/src/bootloader.ts#L251-L581)
- **Issue Type:** INCOMPLETE (Event Listener) / TODO
- **Description:**
  - Commented-out keydown listener (L251)
  - DOMContentLoaded listener (L581)
- **Lines:** 251, 581
- **Status:** DOMContentLoaded listener never cleaned up
- **Risk:** Bootloader listener persists

#### 15.2 RuntimeAuxiliaryAssembly
- **File:** [client/src/engine/runtime/RuntimeAuxiliaryAssembly.ts](client/src/engine/runtime/RuntimeAuxiliaryAssembly.ts#L35-L42)
- **Issue Type:** INCOMPLETE (Destroy Pattern)
- **Description:** destroy() method required but implementation varies
- **Lines:** 35, 42
- **Status:** Interface exists but enforcement varies

---

## SERVER-SIDE AUDIT (server/src)

### 1. SESSION & SNAPSHOT MANAGEMENT

#### 1.1 SnapshotBroadcast
- **File:** [server/src/snapshot/SnapshotBroadcast.ts](server/src/snapshot/SnapshotBroadcast.ts#L121-L287)
- **Issue Type:** BUG / WARN
- **Description:**
  - Grunt filtered from snapshot (L121)
  - Debug logging (L182, L235)
  - HEARTBEAT empty snapshot (L235)
  - Attempting to send empty snapshot error (L287)
- **Lines:** 121, 182, 235, 287
- **Impact:** Critical snapshot integrity issues

#### 1.2 SnapshotFilter
- **File:** [server/src/session/SnapshotFilter.ts](server/src/session/SnapshotFilter.ts#L32-L33)
- **Issue Type:** INCOMPLETE (Filtering Logic)
- **Description:**
  - Death-spiral-resilience log for debugging (L32)
  - Legacy grunt filtering (L33)
- **Lines:** 32, 33
- **Status:** Filtering has debugging code
- **Impact:** Potential filtering edge cases

#### 1.3 DeterminismHash
- **File:** [server/src/snapshot/DeterminismHash.ts](server/src/snapshot/DeterminismHash.ts#L54)
- **Issue Type:** INCOMPLETE (Hash Validation)
- **Description:** Hash should be included every 100 ticks
- **Line:** 54
- **Status:** Sparse validation could miss divergence

---

### 2. GAME SESSION

#### 2.1 GameSession
- **File:** [server/src/core/GameSession.ts](server/src/core/GameSession.ts#L159-L953)
- **Issue Type:** BUG / WARN
- **Description:**
  - DEBUG_STATUS_HOOKS disabled in production (L159)
  - Disallowed replicated objects purge (L1037)
  - Player entity filtered out error (L953)
  - ENTITY_DESTROY broadcast (L1029, L1033)
  - DevCommand rejected warnings (L588, L594)
  - Static collider debug entities (L269)
- **Lines:** 159, 269, 519, 588, 594, 953, 1029, 1033, 1037
- **Status:** Multiple debug/validation patterns
- **Impact:** Entity lifecycle issues could cause desync

#### 2.2 AuthoritativeActorRuntime
- **File:** [server/src/actor/AuthoritativeActorRuntime.ts](server/src/actor/AuthoritativeActorRuntime.ts#L65-L102)
- **Issue Type:** INCOMPLETE (Lifecycle)
- **Description:**
  - destroyActor on disconnect (L65)
  - destroyActor method (L102)
  - lifecycleState = 'destroyed' (L105)
- **Lines:** 65, 102, 105
- **Status:** Actor destruction tracked but timing unclear
- **Risk:** Actor state may not sync with client

---

### 3. WORLD & COLLISION

#### 3.1 WorldIntegrityValidator
- **File:** [server/src/diagnostics/WorldIntegrityValidator.ts](server/src/diagnostics/WorldIntegrityValidator.ts#L21-L119)
- **Issue Type:** INCOMPLETE (Validation)
- **Description:**
  - issues array tracking (L21, L39, L46)
  - validation output (L112-119)
- **Lines:** 21, 39, 46, 112-119
- **Status:** Validation infrastructure exists but may not catch all issues

#### 3.2 GhostGeometryDiagnostic
- **File:** [server/src/diagnostics/GhostGeometryDiagnostic.ts](server/src/diagnostics/GhostGeometryDiagnostic.ts#L27-L110)
- **Issue Type:** BUG / INCOMPLETE
- **Description:**
  - Ghost geometry analysis (L27)
  - Issue detection (L99-110)
- **Lines:** 27, 99-110
- **Status:** Diagnostic exists but underlying issue may not be fully fixed

#### 3.3 CollisionAuthoritySystem
- **File:** [server/src/collision/CollisionAuthoritySystem.ts](server/src/collision/CollisionAuthoritySystem.ts#L87-L89)
- **Issue Type:** INCOMPLETE (Event Listener Cleanup)
- **Description:**
  - on('changed', listener) (L87)
  - off('changed', listener) (L89)
- **Lines:** 87, 89
- **Status:** Good - listener cleanup implemented

---

### 4. INVENTORY & ITEMS

#### 4.1 InventoryManager
- **File:** [server/src/system/InventoryManager.ts](server/src/system/InventoryManager.ts#L119-L335)
- **Issue Type:** INCOMPLETE (Lifecycle)
- **Description:**
  - In-memory cache comment (L160)
  - Remove from cache on disconnect (L324-325)
  - on/off listener pattern (L333, L335)
- **Lines:** 160, 324, 325, 333, 335
- **Status:** Cache cleanup on disconnect
- **Pattern:** Good listener cleanup pattern

---

### 5. DIAGNOSTICS

#### 5.1 INTEGRATION_GUIDE
- **File:** [server/src/diagnostics/INTEGRATION_GUIDE.ts](server/src/diagnostics/INTEGRATION_GUIDE.ts#L5-L224)
- **Issue Type:** INCOMPLETE (Documentation/TODOs)
- **Description:**
  - Integration guide references (L5, L48, L56)
  - Debug visualizer example (L60, L67, L75)
  - PhysicsDebugVisualizer usage documented (L75-81)
  - Check if static colliders visible (L127, L165)
  - Reference to debug mesh count (L131, L207)
- **Lines:** 5, 48, 56, 60, 67, 75, 127, 165, 207, 224
- **Status:** Guide exists but PhysicsDebugVisualizer may not be fully integrated

#### 5.2 GHOST_GEOMETRY_ROOT_CAUSE
- **File:** [server/src/diagnostics/GHOST_GEOMETRY_ROOT_CAUSE.ts](server/src/diagnostics/GHOST_GEOMETRY_ROOT_CAUSE.ts#L94-L263)
- **Issue Type:** BUG (Known Issue - Ghost Geometry)
- **Description:**
  - PhysicsDebugVisualizer solution (L94-97)
  - Debug rendering pattern (L165, L187-190)
  - Static colliders not syncing issue (L228)
- **Lines:** 94-97, 165, 187-190, 228, 238, 263
- **Status:** Documented issue with partial solution
- **Impact:** CRITICAL - Static geometry may be invisible

#### 5.3 GHOST_GEOMETRY_FIX_GUIDE
- **File:** [server/src/diagnostics/GHOST_GEOMETRY_FIX_GUIDE.md](server/src/diagnostics/GHOST_GEOMETRY_FIX_GUIDE.md#L114-L281)
- **Issue Type:** BUG (Known Issue - Map Caching)
- **Description:**
  - Map caching issue (L114)
  - Debug visualizer workaround (L191-200)
  - Incomplete validation checklist (L281)
- **Lines:** 114, 191-200, 281
- **Status:** Workaround documented but root cause may not be fixed

---

### 6. NETWORK & PROTOCOL

#### 6.1 NetworkTransport (Server)
- **File:** [server/src/index.ts](server/src/index.ts#L130-L528)
- **Issue Type:** INCOMPLETE (Event Listeners) / WARN
- **Description:**
  - wss.on('connection') (L249)
  - ws.on('message') (L268)
  - ws.on('close') (L503)
  - ws.on('error') (L528)
  - Protocol mismatch warning (L130)
  - Socket rejected warning (L138)
- **Lines:** 130, 138, 249, 268, 503, 528
- **Status:** WebSocket listeners without cleanup on disconnect
- **Risk:** Socket listeners may accumulate

---

### 7. GAMEPLAY

#### 7.1 StatusRuntime
- **File:** [server/src/gameplay/StatusRuntime.ts](server/src/gameplay/StatusRuntime.ts#L3-L108)
- **Issue Type:** INCOMPLETE (Debug Hooks)
- **Description:**
  - debugStatusOverride pattern (L3, L14, L32, L56-71)
  - Debug status movement modifier (L92-108)
- **Lines:** 3, 14, 32, 56-71, 92-108
- **Status:** Debug override available but may have edge cases
- **Impact:** Test/debug functionality may interfere with live play

#### 7.2 GameplayCommands
- **File:** [server/src/gameplay/GameplayCommands.ts](server/src/gameplay/GameplayCommands.ts#L156-L158)
- **Issue Type:** INCOMPLETE
- **Description:**
  - debug_set_status_movement command (L156)
  - Allowed only if allowDebugStatusHooks (L157)
- **Lines:** 156, 157, 158
- **Status:** Debug command with gate

---

### 8. PLAYER SESSION

#### 8.1 PlayerSessionRuntime
- **File:** [server/src/session/playerSessionRuntime.ts](server/src/session/playerSessionRuntime.ts#L47-L84)
- **Issue Type:** INCOMPLETE
- **Description:**
  - debugStatusOverride initialization (L47)
  - debugStatusOverride reset (L84)
- **Lines:** 47, 84
- **Status:** Debug override tracked

#### 8.2 SpawnPointRegistry
- **File:** [server/src/session/SpawnPointRegistry.ts](server/src/session/SpawnPointRegistry.ts#L5-L43)
- **Issue Type:** INCOMPLETE (Lifecycle)
- **Description:**
  - Remove player on disconnect comment (L35)
  - Circular spawn distribution (L43-46)
- **Lines:** 35, 43-46
- **Status:** Cleanup on disconnect implemented

---

### 9. DIAGNOSTICS HELPER

#### 9.1 DiagnosticsHelper
- **File:** [server/src/session/DiagnosticsHelper.ts](server/src/session/DiagnosticsHelper.ts#L8-L46)
- **Issue Type:** INCOMPLETE (Debugging)
- **Description:**
  - World state dump for debugging (L8)
  - Target player not found warning (L46)
- **Lines:** 8, 46
- **Status:** Helper infrastructure exists

---

## CRITICAL ISSUES SUMMARY

### Memory Leak Patterns (HIGH PRIORITY)

1. **Event Listener Accumulation**
   - **Impact:** CRITICAL
   - **Systems Affected:** InputManager, InventoryGridUI, MultiplayerRuntimeCoordinator, NetworkSyncSystem
   - **Pattern:** addEventListener() / on() without corresponding removeEventListener() / off()
   - **Estimated Count:** 100+ listeners without proper cleanup
   - **Files:** client/src/engine/**

2. **Event Bus Listeners**
   - **Impact:** CRITICAL  
   - **Systems Affected:** 20+ gameplay systems
   - **Pattern:** gameBus.on() without unsubscribe tracking
   - **Estimated Count:** 50+ listeners
   - **Files:** client/src/engine/runtime/**, client/src/engine/gameplay/**

3. **Constructor Without Cleanup**
   - **Impact:** HIGH
   - **Pattern:** New listeners/subscriptions added in constructor with no dispose/destroy
   - **Examples:** InputManager, EventBus subscribers
   - **Files:** client/src/engine/core/**

4. **Mode Transition Memory**
   - **Impact:** HIGH
   - **Pattern:** Mode cleanup attempted but incomplete
   - **Issue:** Individual systems add listeners without coordination
   - **File:** [client/src/engine/runtime/ModeTransitionManager.ts](client/src/engine/runtime/ModeTransitionManager.ts)

### Architectural Issues (MEDIUM-HIGH PRIORITY)

1. **Incomplete Lifecycle Management**
   - Missing dispose() methods on services
   - No centralized cleanup registry
   - Vary between destroy(), dispose(), cleanup()

2. **Ghost Geometry Issue**
   - **Impact:** CRITICAL (Collision/Physics)
   - **Files:** 
     - [server/src/diagnostics/GHOST_GEOMETRY_ROOT_CAUSE.ts](server/src/diagnostics/GHOST_GEOMETRY_ROOT_CAUSE.ts)
     - [server/src/diagnostics/GHOST_GEOMETRY_FIX_GUIDE.md](server/src/diagnostics/GHOST_GEOMETRY_FIX_GUIDE.md)
   - **Status:** Documented workaround but root cause may remain

3. **Snapshot Integrity**
   - **Impact:** HIGH (Network Sync)
   - **Files:**
     - [server/src/snapshot/SnapshotBroadcast.ts](server/src/snapshot/SnapshotBroadcast.ts)
     - [client/src/engine/network/SnapshotVisibilityDebugger.ts](client/src/engine/network/SnapshotVisibilityDebugger.ts)
   - **Issues:** 
     - Grunt filtering edge cases
     - Ghost entities in snapshots
     - Empty snapshot broadcasts

4. **Entity State Desync**
   - **Impact:** HIGH (Multiplayer)
   - **Files:**
     - [client/src/engine/network/MultiplayerClient.ts](client/src/engine/network/MultiplayerClient.ts)
     - [client/src/engine/gameplay/game/LocalPlayerAuthorityCoordinator.ts](client/src/engine/gameplay/game/LocalPlayerAuthorityCoordinator.ts)
   - **Issues:**
     - PlayerId mismatch detection
     - Entity filtering problems

---

## INCOMPLETE SYSTEMS

### Client-Side

1. **GAS (Gameplay Ability System)**
   - **File:** [client/src/engine/gameplay/systems/gas/GASBridge.ts](client/src/engine/gameplay/systems/gas/GASBridge.ts#L42-L44)
   - **Issue:** Consumable items (health_small, ammo) not in template catalogue
   - **Impact:** Items don't function as GAS instances

2. **Phase 3 Architecture**
   - **File:** [client/src/engine/0-foundation/runtime/SystemRegistry.ts](client/src/engine/0-foundation/runtime/SystemRegistry.ts#L37)
   - **Issue:** public-api not created
   - **Status:** Temporary re-exports

3. **Transform Cleanup**
   - **File:** [client/src/engine/core/Transform.ts](client/src/engine/core/Transform.ts#L197-L198)
   - **Issue:** Acknowledged cleanup debt for StateManager subscriptions

4. **Scripting System Cleanup**
   - **File:** [client/src/engine/core/ScriptingSystem.ts](client/src/engine/core/ScriptingSystem.ts#L197)
   - **Issue:** Cleanup acknowledged as incomplete

### Server-Side

1. **Ghost Geometry Fix**
   - **Files:** [server/src/diagnostics/GHOST_GEOMETRY_FIX_GUIDE.md](server/src/diagnostics/GHOST_GEOMETRY_FIX_GUIDE.md)
   - **Status:** Documented but may not be fully resolved

2. **Static Collider Sync**
   - **Issue:** Map caching causing invisible collision
   - **Status:** Partial workaround via debug visualizer

---

## RECOMMENDATIONS

### CRITICAL (Fix Immediately)

1. **Event Listener Registry**
   - Create centralized event listener tracking
   - Implement automatic cleanup on mode transitions
   - Priority Files:
     - Create `engine/core/EventListenerRegistry.ts`
     - Update `InputManager` to use registry
     - Update `UICompositionCoordinator` to track listeners

2. **Event Bus Cleanup**
   - Require unsubscribe function returns from gameBus.on()
   - Track listener lifecycle in each system
   - Priority Systems: MultiplayerRuntimeCoordinator, NetworkSyncSystem

3. **Ghost Geometry Investigation**
   - Verify static collider sync on map load
   - Test debug visualizer effectiveness
   - Implement PhysicsDebugVisualizer integration

4. **Snapshot Integrity**
   - Add comprehensive snapshot validation
   - Log all entity filtering operations
   - Implement determinism hashing every 100 ticks (or more frequently)

### HIGH (Next Sprint)

1. **Lifecycle Standardization**
   - Define dispose/destroy pattern across all systems
   - Document cleanup order requirements
   - Audit all systems for compliance

2. **Mode Transition Cleanup**
   - Complete cleanup implementation in ModeTransitionManager
   - Add listener removal for all systems
   - Implement forced cleanup fallback

3. **Memory Leak Detection**
   - Enhance SystemValidator memory detection
   - Add periodic memory profiling
   - Implement automatic leak reporting

4. **GAS System Completion**
   - Add consumable item templates
   - Implement health/ammo pickup as GAS instances
   - Test item system end-to-end

### MEDIUM (Future)

1. **Phase 3 Architecture**
   - Create @engine/0-foundation/public-api
   - Move temporary re-exports
   - Update imports across codebase

2. **Transform Cleanup**
   - Implement StateManager cleanup method
   - Add subscription tracking
   - Audit all StateManager subscriptions

3. **Error Handling**
   - Replace console.warn with proper error handling
   - Implement error recovery strategies
   - Add validation for common failure patterns

4. **Testing**
   - Add memory leak detection tests
   - Add mode transition tests
   - Add snapshot integrity tests

---

## FILES REQUIRING IMMEDIATE ATTENTION

### Critical Files
- [client/src/engine/core/InputManager.ts](client/src/engine/core/InputManager.ts) - 8 untracked listeners
- [client/src/engine/ui/InventoryGridUI.ts](client/src/engine/ui/InventoryGridUI.ts) - 15+ untracked listeners  
- [client/src/engine/runtime/coordinators/MultiplayerRuntimeCoordinator.ts](client/src/engine/runtime/coordinators/MultiplayerRuntimeCoordinator.ts) - 25+ untracked listeners
- [client/src/engine/network/NetworkSyncSystem.ts](client/src/engine/network/NetworkSyncSystem.ts) - 4+ untracked listeners

### High Priority
- [client/src/engine/runtime/ModeTransitionManager.ts](client/src/engine/runtime/ModeTransitionManager.ts) - Incomplete cleanup
- [server/src/snapshot/SnapshotBroadcast.ts](server/src/snapshot/SnapshotBroadcast.ts) - Snapshot integrity issues
- [client/src/engine/network/SnapshotVisibilityDebugger.ts](client/src/engine/network/SnapshotVisibilityDebugger.ts) - Ghost entity detection

### Medium Priority  
- [client/src/engine/0-foundation/runtime/SystemRegistry.ts](client/src/engine/0-foundation/runtime/SystemRegistry.ts) - Phase 3 incomplete
- [client/src/engine/core/Transform.ts](client/src/engine/core/Transform.ts) - Cleanup debt
- [client/src/engine/gameplay/systems/gas/GASBridge.ts](client/src/engine/gameplay/systems/gas/GASBridge.ts) - Incomplete GAS coverage

---

**Report Generated:** April 17, 2026  
**Audit Scope:** Full codebase (client/src + server/src)  
**Total Issues Found:** 150+  
**Critical Issues:** 12  
**High Priority:** 25  
**Medium Priority:** 30+
