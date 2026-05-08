# v0.2.0 PLAYTEST & VISUAL STATE SANITY CHECKS - COMPREHENSIVE GUIDE

**Status:** Ready for Gates 2A → 5B execution
**Baseline Locked:** ✅ baseline-crc32-gate-1a.json
**Build Time:** ✅ 1.6s incremental (sub-10s barrier broken)

---

## PHASE 2: NETWORK REPLICATION & INVENTORY (Gates 2A + 2B)

### Gate 2A: Death Animation Replication

**Objective:** Extend SnapshotContract to v3 schema with death state visualization

#### Visual State Sanity Check 2A.1: Death State Persistence
- [ ] Spawn player in freeplay
- [ ] Navigate to collision with destructible object
- [ ] Verify death animation plays (ragdoll or fade)
- [ ] **Sanity Check:** Death visual state persists for 3+ seconds before respawn queue
- [ ] **Kernel Validation:** CRC32 hash chain matches baseline (no corruption)
- [ ] **Complexity:** O(1) per death event (state mutation in PHASE_RESOLVE)

#### Visual State Sanity Check 2A.2: Multiplayer Death Replication
- [ ] Start 2-player session (localhost:3000 + localhost:3001 via port override)
- [ ] Player A shoots Player B
- [ ] **Sanity Check:** Player B death animation visible on both clients within 1 frame
- [ ] Server snapshot reflects dead state
- [ ] **Kernel Validation:** Inventory cleared for dead player, health = 0 locked
- [ ] **Complexity:** O(N) where N = snapshot delta entities (sparse encoding)

#### Visual State Sanity Check 2A.3: Death Recovery Queue
- [ ] Player dies, joins death recovery queue
- [ ] Wait 5+ seconds
- [ ] Verify respawn triggers with initial inventory reset
- [ ] **Sanity Check:** New spawn location differs from death location
- [ ] **Kernel Validation:** Entity reused (handle generation incremented)
- [ ] **Complexity:** O(1) per respawn (list manipulation)

#### Gate 2A Validation Checkpoint
```
CRC32 Proof Required:
  - 60-tick capture with death events at ticks: 10, 25, 40, 50
  - State hash must change ONLY at death event ticks
  - All hashes unique (no wrap-around collisions)
  - Output: engine/reports/gate-2a-death-animation-crc32.json
```

**Gate 2A Pass Criteria:**
- ✅ SnapshotContract v3 schema compiles without errors
- ✅ Death visual visible on both client & server within 16.67ms (60fps frame)
- ✅ CRC32 hash changes only on death events (no spurious mutations)
- ✅ Inventory cleared for dead players (authoritative server state)
- ✅ No entity leaks (dense-sparse indexing remains valid)

---

### Gate 2B: Inventory DOD Refactor

**Objective:** Route all drop/pickup operations through kernel command queue with DOD compliance

#### Visual State Sanity Check 2B.1: Pickup Command Flow
- [ ] Spawn item on ground (visible 3D object)
- [ ] Walk player over item
- [ ] **Sanity Check:** Item disappears from world
- [ ] UI shows +1 ammo or +1 item in inventory slot
- [ ] **Kernel Validation:** Inventory buffer updated in PHASE_RESOLVE
- [ ] **Complexity:** O(1) per pickup command

#### Visual State Sanity Check 2B.2: Drop Command Flow
- [ ] Player holding weapon with ammo
- [ ] Press drop key
- [ ] **Sanity Check:** Weapon model visible on ground at player feet
- [ ] Item appears in item browser/world explorer
- [ ] **Kernel Validation:** Inventory buffer decremented, physics body spawned
- [ ] **Complexity:** O(1) per drop command

#### Visual State Sanity Check 2B.3: Inventory Mutation Validation
- [ ] Pickup 5 items over 10 ticks
- [ ] Drop 2 items over ticks 15-17
- [ ] **Sanity Check:** UI inventory count: Start (0) → +5 (10 ticks) → -2 (5 ticks) = 3 final
- [ ] **Kernel Validation:** InventoryStorage buffers reflect exact sequence
- [ ] **Complexity:** O(N) where N = command count (queued FIFO)

#### Visual State Sanity Check 2B.4: Multiplayer Inventory Sync
- [ ] 2-player session
- [ ] Player A picks up weapon
- [ ] **Sanity Check:** Player A inventory reflects pickup, Player B sees item disappear
- [ ] Player B picks up same item type from different location
- [ ] **Kernel Validation:** Both players' inventory buffers independent (no crosstalk)
- [ ] **Complexity:** O(N) where N = active players (sparse delta encoding)

#### Gate 2B Validation Checkpoint
```
CRC32 Proof Required:
  - 60-tick capture with 20 pickup/drop commands spread across ticks
  - InventoryStorage hash changes only on command ticks
  - No unauthorized mutations (all changes routed through kernel)
  - Output: engine/reports/gate-2b-inventory-refactor-crc32.json
```

**Gate 2B Pass Criteria:**
- ✅ All drop/pickup operations queued through KernelCommand
- ✅ InventoryStorage DOD buffers mutated only in PHASE_RESOLVE
- ✅ UI reflects exact inventory state (no stale reads)
- ✅ Multiplayer: Inventory changes visible to all clients within snapshot period
- ✅ No array allocations in critical path (O(1) complexity per command)

---

### Phase 2 Sync Point: Schema Integration

**After Gates 2A + 2B complete:**

#### Integration Sanity Check
- [ ] Combine Death Animation schema (v3a) + Inventory schema (v3b) → v3 unified
- [ ] No field name collisions in SnapshotContract
- [ ] CRC32 hash chain validates with both schemas active
- [ ] **Complexity:** O(1) per snapshot (fixed buffer strides)

**Phase 2 Sign-Off:**
```
Both Gates 2A + 2B: APPROVED
Combined CRC32 proof in: engine/reports/gate-2-combined-crc32.json
Ready for Phase 3A+3B (Dummy Enemy + Damage Numbers)
```

---

## PHASE 3: GAMEPLAY SYSTEMS (Gates 3A + 3B)

### Gate 3A: Dummy Enemy Integration

**Objective:** Spawn & manage 50 dummy enemies with minimal AI for stress validation

#### Visual State Sanity Check 3A.1: Single Dummy Spawn
- [ ] Execute: `spawnDummy()` console command
- [ ] **Sanity Check:** Green cube appears at (0, 1, 0) with idle animation
- [ ] Dummy has health bar (100 HP)
- [ ] **Kernel Validation:** Entity created in registry, position buffer filled
- [ ] **Complexity:** O(1) per spawn

#### Visual State Sanity Check 3A.2: Dummy Movement (Random Walk)
- [ ] Single dummy spawned
- [ ] Wait 30 ticks (~500ms at 60fps)
- [ ] **Sanity Check:** Dummy moves to random location within [-5, 5] (X-Z plane)
- [ ] Movement visually smooth (interpolated, not teleporting)
- [ ] **Kernel Validation:** Velocity buffer set, position updated per tick
- [ ] **Complexity:** O(1) per dummy per tick

#### Visual State Sanity Check 3A.3: Dummy-Player Collision
- [ ] Dummy spawned ahead of player
- [ ] Player walks into dummy
- [ ] **Sanity Check:** Collision detected, player stops (no clipping)
- [ ] Dummy pushed back slightly or stops
- [ ] **Kernel Validation:** Collision handler fires, movement blocked
- [ ] **Complexity:** O(N) where N = nearby entities (spatial grid)

#### Visual State Sanity Check 3A.4: Dummy Damage & Death
- [ ] Player shoots dummy 5 times (each shot: -20 HP)
- [ ] **Sanity Check:** Health bar decreases visually
- [ ] After 5th shot (100-20*5=0), dummy death animation plays
- [ ] Dummy removed from world
- [ ] **Kernel Validation:** Health buffer set to 0, entity marked for cleanup
- [ ] **Complexity:** O(1) per damage event

#### Visual State Sanity Check 3A.5: Stress Test - 50 Dummies for 60 Ticks
- [ ] Spawn 50 dummies: `for i in 1..50: spawnDummy()`
- [ ] Run for 60 ticks (~1 second at 60fps)
- [ ] Monitor FPS (must remain >30)
- [ ] **Sanity Check:** All 50 dummies visible, moving, responding to physics
- [ ] No entity leaks (check dense-sparse indexing consistency)
- [ ] **Kernel Validation:** 50 entities × 60 ticks × CRC32_computation = O(50*60*210944)
- [ ] **Complexity:** O(50 * 60 * hash_computation) = O(constant)

#### Gate 3A Validation Checkpoint
```
CRC32 Proof Required:
  - 60-tick capture with 50 dummies alive entire duration
  - No spurious hash changes outside physics/collision updates
  - Output: engine/reports/gate-3a-dummy-enemy-stress-crc32.json
  - Benchmark: FPS profile in engine/reports/gate-3a-fps-profile.json
```

**Gate 3A Pass Criteria:**
- ✅ All 50 dummies spawn without entity leaks
- ✅ Movement & collision: Deterministic per tick
- ✅ Death animation: Plays before entity cleanup
- ✅ FPS >30 during stress test (sub-linear scaling)
- ✅ CRC32 hash chain: No corruption, all ticks unique

---

### Gate 3B: Damage Numbers DOD Compliance

**Objective:** Queue damage number UI updates through UICommandBuffer (deferred, not immediate DOM)

#### Visual State Sanity Check 3B.1: Single Damage Number
- [ ] Player shoots dummy once (20 damage)
- [ ] **Sanity Check:** "+20" damage number appears above dummy head
- [ ] Number floats upward for 0.5s, then fades
- [ ] **Kernel Validation:** CRC32 hash unaffected (UI queued, not kernel state)
- [ ] **Complexity:** O(1) per damage event (deferred)

#### Visual State Sanity Check 3B.2: Multiple Rapid Damage Numbers
- [ ] Rapid fire: 5 shots in 0.2s (5 damage numbers)
- [ ] **Sanity Check:** All 5 numbers visible, staggered upward without overlapping
- [ ] Numbers disappear after 0.5s each
- [ ] **Kernel Validation:** CRC32 matches baseline (no kernel mutation from UI)
- [ ] **Complexity:** O(N) where N = command count (queued)

#### Visual State Sanity Check 3B.3: UI Command Execution Timing
- [ ] Shoot 10 times, record tick numbers
- [ ] Check damage numbers appear within 1-2 frames of shot tick
- [ ] **Sanity Check:** No lag between shot and visual feedback
- [ ] POST_RESOLVE hook executes UI command buffer
- [ ] **Kernel Validation:** UICommandBuffer cleared after each POST_RESOLVE
- [ ] **Complexity:** O(N) where N = queued UI commands (fixed per frame)

#### Gate 3B Validation Checkpoint
```
CRC32 Proof Required:
  - 60-tick capture: CRC32 hash identical to baseline
  - Damage numbers visible but kernel state unaffected
  - UI command buffer: O(N) queued, O(N) flushed per tick
  - Output: engine/reports/gate-3b-damage-numbers-crc32.json
```

**Gate 3B Pass Criteria:**
- ✅ Damage numbers queued in UICommandBuffer (not immediate)
- ✅ CRC32 hash chain: No kernel mutation from UI updates
- ✅ Latency: <2 frames from damage event to visual feedback
- ✅ Scaling: O(N) complexity for N damage numbers per frame
- ✅ Cleanup: UICommandBuffer flushed after POST_RESOLVE

---

### Phase 3 Sync Point: Content Merge

**After Gates 3A + 3B complete:**

#### Integration Sanity Check
- [ ] Combine Dummy Enemy system + Damage Numbers system
- [ ] 50 dummies + player in multiplayer session
- [ ] Rapid fire: Player shoots, damage numbers appear, dummies die
- [ ] **Sanity Check:** All systems work together without conflicts
- [ ] **Kernel Validation:** CRC32 unaffected by UI (separate from game state)
- [ ] **Complexity:** O(50 + N_damage_numbers) per tick

**Phase 3 Sign-Off:**
```
Both Gates 3A + 3B: APPROVED
Combined CRC32 proof in: engine/reports/gate-3-combined-crc32.json
Ready for Phase 4 (Maintainability Extractions)
```

---

## PHASE 4: MAINTAINABILITY (Gates 4A + 4B)

### Gate 4A: Bootstrap Extraction

**Objective:** Reduce [client/src/index.ts](client/src/index.ts) to <25 lines

#### Visual State Sanity Check 4A.1: Bootstrap Startup
- [ ] Build production bundle
- [ ] Load page in browser
- [ ] **Sanity Check:** Game initializes (freeplay mode loads)
- [ ] Same startup behavior as before refactor
- [ ] **Complexity:** O(1) for bootstrap extraction

#### Visual State Sanity Check 4A.2: Module Loading Order
- [ ] Log each module init step
- [ ] **Sanity Check:** Order preserved: DOM setup → Kernel init → Network init → Rendering init
- [ ] No race conditions (await all async ops)
- [ ] **Complexity:** O(N) where N = modules (sequential)

**Gate 4A Pass Criteria:**
- ✅ [client/src/index.ts](client/src/index.ts) <25 lines (was 50+)
- ✅ All functionality preserved
- ✅ Startup latency unchanged (<100ms to first frame)
- ✅ No initialization errors

---

### Gate 4B: Server Session Modularization

**Objective:** Reduce gameSession.ts to <50 lines orchestration

#### Visual State Sanity Check 4B.1: Session Lifecycle
- [ ] Connect to server
- [ ] Join freeplay room
- [ ] Verify session created
- [ ] **Sanity Check:** Ticks advance, players spawn, physics runs
- [ ] **Complexity:** O(1) for session creation

#### Visual State Sanity Check 4B.2: Session State Transitions
- [ ] Idle → Active (player joins)
- [ ] Active → Paused (all players leave)
- [ ] Paused → Active (player rejoins)
- [ ] **Sanity Check:** Transitions smooth, no state leaks
- [ ] **Complexity:** O(1) per transition

**Gate 4B Pass Criteria:**
- ✅ [server/src/gameSession.ts](server/src/gameSession.ts) <50 lines orchestration
- ✅ All session logic modularized into separate files
- ✅ Session lifecycle: Create → Run → Destroy (clean)
- ✅ No state corruption between sessions

---

## PHASE 5: RELEASE VALIDATION (Gates 5A + 5B)

### Gate 5A: Performance Baseline - 2-Player PvP

**Objective:** Capture performance metrics for v0.2.0 release

#### Visual State Sanity Check 5A.1: 2-Player PvP Session (300 seconds)
- [ ] Start 2-player session on localhost
- [ ] Players engage in combat: move, shoot, dodge for 5 minutes
- [ ] **Sanity Check:** Frame rate stable >30fps
- [ ] No disconnections or latency spikes
- [ ] **Metrics to capture:**
  - Average FPS (target: >45)
  - Peak latency (target: <100ms)
  - Memory usage (target: <150MB per client)
  - Tick rate stability (target: 60fps within ±2%)

#### Visual State Sanity Check 5A.2: Server Performance
- [ ] Monitor server CPU usage during 2-player session
- [ ] **Sanity Check:** CPU <20% (spare capacity for 3rd+ player)
- [ ] Memory stable (no leaks detected over 300s)
- [ ] **Metrics:**
  - Avg server CPU (target: <20%)
  - Memory delta (target: <1MB growth over 300s)
  - Tick computation time (target: <8ms per tick)

#### Visual State Sanity Check 5A.3: Network Bandwidth
- [ ] Capture snapshot sizes during 2-player PvP
- [ ] **Sanity Check:** Avg snapshot ~500 bytes/tick (sparse delta)
- [ ] Bandwidth: ~30KB/s per player (60 ticks × 500 bytes)
- [ ] **Metrics:**
  - Min snapshot: ~200 bytes (no changes)
  - Max snapshot: ~1200 bytes (many entity changes)
  - Avg bandwidth: ~30KB/s per player

**Gate 5A Pass Criteria:**
- ✅ FPS >30 sustained over 300s
- ✅ Latency <100ms p95
- ✅ Memory stable (no leaks)
- ✅ Output: [engine/reports/gate-5a-performance-metrics.json](engine/reports/gate-5a-performance-metrics.json)

---

### Gate 5B: Stress Test - 500 Entity Integration

**Objective:** Validate engine handles 500 entities (50 dummies × 10 spawn cycles)

#### Visual State Sanity Check 5B.1: Progressive Entity Spawn
- [ ] Spawn 50 dummies
- [ ] Tick 60 cycles
- [ ] Repeat 10 times (total 500 dummies spawned)
- [ ] **Sanity Check:** Entity cleanup works correctly
- [ ] Dense-sparse indexing remains valid after cleanup
- [ ] No memory leaks (freed slots reused)

#### Visual State Sanity Check 5B.2: Full Integration - All Gates Active
- [ ] 500 entities + 2 players
- [ ] Death animation system active (entities die, respawn)
- [ ] Inventory system active (pickups/drops)
- [ ] Damage numbers active (visual feedback)
- [ ] **Sanity Check:** All systems work together
- [ ] Frame rate >15fps (graceful degradation)

#### Visual State Sanity Check 5B.3: CRC32 Validation - 500 Entity Tick
- [ ] Run single tick with 500 entities active
- [ ] Capture CRC32 hash chain
- [ ] **Sanity Check:** Hash unique (no collisions across all gates)
- [ ] State integrity: No corruption detected
- [ ] **Complexity:** O(500 × 210,944) = O(constant) per tick

#### Visual State Sanity Check 5B.4: End-to-End Playtest
- [ ] Run full 5-minute session with mixed workload:
  - 30 dummies spawned progressively
  - 2 players engage in PvP
  - Pickups/drops scattered throughout
  - Damage numbers constantly generated
- [ ] **Sanity Check:** Session stable, no crashes or hangs
- [ ] All visual feedback responsive
- [ ] **Metrics:** FPS >20 sustained

**Gate 5B Pass Criteria:**
- ✅ 500 entities cycle without leaks
- ✅ All subsystems (animation, inventory, UI) active simultaneously
- ✅ Graceful degradation: FPS >15 at max load
- ✅ Output: [engine/reports/gate-5b-stress-test-results.json](engine/reports/gate-5b-stress-test-results.json)

---

## V0.2.0 RELEASE SIGN-OFF

**When all gates pass:**

1. ✅ PHASE 0: Baseline Lock (CRC32 frozen)
2. ✅ PHASE 1: Compile Optimization (1.6s incremental builds)
3. ✅ PHASE 2: Network Replication & Inventory (Gates 2A + 2B)
4. ✅ PHASE 3: Gameplay Systems (Gates 3A + 3B)
5. ✅ PHASE 4: Maintainability (Gates 4A + 4B)
6. ✅ PHASE 5: Release Validation (Gates 5A + 5B)

**Final Checklist:**
```
□ All CRC32 proofs committed to engine/reports/
□ No kernel corruption detected (all hashes unique)
□ Performance metrics meet targets (FPS >30, latency <100ms)
□ Entity scaling validated (500+ entities)
□ All visual feedback responsive (<2 frames latency)
□ Memory stable (no leaks over 300s+ sessions)
□ Build time: 1.6s incremental (sub-10s barrier broken)
□ Code maintainability: Bootstrap <25 lines, Session <50 lines
□ All tests pass, no errors or warnings
```

**Release Command:**
```bash
git tag v0.2.0
npm run build  # 76.6s clean build
npm run test   # Full integration test suite
npm run publish
```

---

## Quick Reference: Playtest Session Template

**Duration:** ~10 minutes per gate

**Setup:**
1. Terminal 1: `npm run dev` (starts server + dev client)
2. Terminal 2: `npm run client:dev` (optional: second player instance)
3. Browser: http://localhost:3000 (freeplay mode)

**Checklist per gate:**
- [ ] Load game without errors
- [ ] Visual feedback immediate (<2 frames)
- [ ] No FPS drops or stuttering
- [ ] No console errors
- [ ] Multiplayer sync (if applicable)
- [ ] CRC32 validation: Hash matches expected
- [ ] Entity cleanup: No leaks detected

**Report Template:**
```markdown
## Gate X.Y Playtest Results

**Date:** [DATE]
**Duration:** [MINUTES]
**Environment:** [LOCALHOST / DEPLOYED]

### Visual Sanity Checks
- [x] Check 1: PASS
- [x] Check 2: PASS
- [x] Check 3: PASS

### Metrics
- FPS: [XX] avg (target: >30)
- Latency: [XXms] p95 (target: <100ms)
- Memory: [XXmb] (target: stable)

### CRC32 Validation
- Hash chain: PASS
- Collisions: 0
- Corruption: None detected

### Issues
- None

**Sign-off:** Gate X.Y APPROVED ✅
```

---

**Generated:** 2026-04-16 | **Version:** v0.2.0-RC1 | **Status:** READY FOR TESTING
