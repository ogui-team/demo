/**
 * SPRINT_A_IMPLEMENTATION_GUIDE.md
 * 
 * Sprint-A: Kernelize HealthSystem + WeaponSystem (v0.1.3 Phase 1)
 * Duration: 3 days
 * Priority: P1 (blockers for Phase-2 network integration)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Phase 1 (Gameplay Domain) targets the two "immediate impact" systems that
 * interact with DOD storage already built in v0.1.3:
 * 
 * 1. HealthSystem (mutate health buffer via DOD data structures)
 * 2. WeaponSystem (mutate ammo buffer + fire state via DOD data structures)
 * 
 * Success Criteria:
 * • Both systems implement IKernelSystem interface (execute(), setActiveCount?)
 * • Systems use DOD buffers (HealthStorage, InventoryStorage) instead of Entity properties
 * • IntegrationCheck.ts validates post-tick consistency ✓
 * • Zero-regression smoke tests (movement, inventory, health mutations all pass)
 * • Frame variance < 1ms (GC-free execution)
 * • All DomainMigrationPlan.ts Sprint-A systems categorized SystemCategory.KERNEL
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE DECISIONS (Gameplay Domain)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ### Data Flow: Command-Driven Architecture
 * 
 * Commands are enqueued by UI/Network, processed during kernel.tickOnce():
 * 
 *   USE_ITEM_CMD → InventorySystem (ammo drain)
 *     ↓
 *   FIRE_CMD → WeaponSystem (fire state + velocity check)
 *     ↓
 *   DAMAGE_CMD → HealthSystem (health decrement + death check)
 *     ↓
 *   (Movement, rotation, physics are separate)
 * 
 * ### Phase Gating
 * 
 * Systems cannot process commands until kernel.enginePhase === READY.
 * StateVault is used for mode transitions (Editor ↔ Play).
 * 
 * ### Zero-Copy Rendering
 * 
 * Mesh positions are updated via MeshBindingTable pulling from position buffer.
 * Mesh destruction happens via MESH_DESTROY_CMD after entity is killed.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * TASK BREAKDOWN
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ## TASK 1: Implement HealthSystem as IKernelSystem
 * 
 *   Time: ~1.5 hours
 *   
 *   ### File: SimulationKernel.ts
 *   ADD: Health-based damage command payload interface + handler
 *   Method: addHealthSystem(system: IKernelSystem)
 *   
 *   ### File: HealthSystem.ts (refactor existing)
 *   IMPLEMENT: IKernelSystem interface
 *   ```typescript
 *   export class HealthSystem implements IKernelSystem {
 *     category = SystemCategory.KERNEL;
 *     name = 'HealthSystem';
 *   
 *     execute(dt: number): void {
 *       // Process accumulated DAMAGE_CMD commands from queue
 *       // Mutate health buffer directly
 *       // Check for death (health <= 0) and emit ENTITY_DIED events
 *     }
 *   
 *     setActiveCount?(count: number): void {
 *       // Optional: track entity count for tight loops
 *     }
 *   }
 *   ```
 *   
 *   REMOVE: Entity property mutation (e.g., entity.health = ...)
 *   ADD: HealthStorage usage (kernel.healths.setHealth(dense, newHealth))
 *   ADD: DAMAGE_CMD command handler
 *     - Payload: { handle: EntityHandle, amount: number, source: string }
 *     - Logic: newHealth = Math.max(0, oldHealth - amount)
 *     - Death: if (newHealth <= 0) → emit ENTITY_DIED event → queue MESH_DESTROY_CMD
 *   
 *   VALIDATION: After each DAMAGE_CMD, read back buffer to confirm mutation
 * 
 * ## TASK 2: Implement WeaponSystem as IKernelSystem
 * 
 *   Time: ~1.5 hours
 *   
 *   ### File: WeaponSystem.ts (refactor existing)
 *   IMPLEMENT: IKernelSystem interface
 *   ```typescript
 *   export class WeaponSystem implements IKernelSystem {
 *     category = SystemCategory.KERNEL;
 *     name = 'WeaponSystem';
 *   
 *     execute(dt: number): void {
 *       // Process accumulated FIRE_CMD commands from queue
 *       // Mutate ammo buffer via kernel.inventories.setAmmo()
 *       // Validate firing conditions (has ammo, not reloading, in range, etc.)
 *     }
 *   
 *     setActiveCount?(count: number): void {
 *       // Optional: preallocate raycast buffers based on EntityCount
 *     }
 *   }
 *   ```
 *   
 *   CHANGE: Ammo decrement from Entity property to DOD buffer mutation
 *   ADD: FIRE_CMD command handler
 *     - Payload: { handle: EntityHandle, targetPos: [x, y, z], source: 'local'|'remote' }
 *     - Logic: 1. Check ammo >= 1 (read buffer)
 *              2. Raycast from entity position to target
 *              3. If hit → queue DAMAGE_CMD to target
 *              4. Decrement ammo: setAmmo(dense, ammo - 1)
 *              5. On reload trigger: setAmmo(dense, maxAmmo) + emit RELOAD_COMPLETE
 *   
 *   FIRE_STATE_TRACKING (optional, can use WaveformCache or per-entity flags):
 *     - If tracking in PerEntityFlags Uint32Array: bit 0 = isReloading, bit 1 = isAiming
 *     - OR use separate typed array if needed (introduced in Sprint-B)
 *   
 *   REPLICATION: Firing events (HITSCAN_CONFIRMED, HITSCAN_MISSED) must be
 *     replicated to remote clients (NetworkSyncSystem subscribes)
 * 
 * ## TASK 3: Wire Systems into SimulationKernel
 * 
 *   Time: ~30 minutes
 *   
 *   ### File: SimulationKernel.ts
 *   CHANGE: constructor or addSystem() to register KERNEL-category systems
 *   ADD: executeSystems(dt) method to run all registered IKernelSystem instances
 *   order: HealthSystem, WeaponSystem (damage must resolve before network replication)
 *   
 *   ### File: KernelMovementIntegration.ts (or main loop)
 *   CHANGE: tickOnce() sequence:
 *     1. Process migrations
 *     2. Execute kernel systems (HealthSystem, WeaponSystem)
 *     3. Integrate physics (velocity → position)
 *     4. Move selection/culling systems
 *     5. Publish buffers to rendering
 *   
 *   ### File: bootstrapClientRuntime.ts
 *   ADD: Initialize HealthSystem + WeaponSystem with kernel reference
 *   ADD: Register systems via kernel.addSystem(healthSystem, 'health')
 *   ADD: Validate with KernelBootstrapValidator.validateBeforeGameplay()
 * 
 * ## TASK 4: Implement DAMAGE_CMD and FIRE_CMD Handlers
 * 
 *   Time: ~1 hour
 *   
 *   ### Command Payload Definitions (core/types.ts)
 *   ADD: union type for both command payloads
 *   ```typescript
 *   export interface DAMAGE_CMD {
 *     handle: EntityHandle;
 *     amount: number;
 *     source: string; // 'weapon' | 'environment' | 'test'
 *   }
 *   
 *   export interface FIRE_CMD {
 *     handle: EntityHandle;
 *     targetPos: [number, number, number];
 *     source: 'local' | 'remote';
 *   }
 *   ```
 *   
 *   ### HealthSystem: consumeCommand(handle, cmd)
 *   if (cmd.type === 'DAMAGE_CMD') {
 *     const dense = this.kernel.entities.getDenseIndex(cmd.handle);
 *     const oldHealth = this.kernel.healths.getHealth(dense);
 *     const newHealth = Math.max(0, oldHealth - cmd.amount);
 *     this.kernel.healths.setHealth(dense, newHealth);
 *     if (newHealth > 0) {
 *       gameBus.emit('HEALTH_CHANGED', { entityId: cmd.handle, health: newHealth, source: cmd.source });
 *     } else {
 *       gameBus.emit('ENTITY_DIED', { entityId: cmd.handle, source: cmd.source });
 *       this.kernel.enqueueCommand(0, Engine.time.now(), 'system', 'MESH_DESTROY_CMD', null, { handle: cmd.handle });
 *     }
 *   }
 *   
 *   ### WeaponSystem: consumeCommand(handle, cmd)
 *   if (cmd.type === 'FIRE_CMD') {\n *     const dense = this.kernel.entities.getDenseIndex(cmd.handle);\n *     const ammo = this.kernel.inventories.getAmmo(dense);\n *     if (ammo < 1) {\n *       gameBus.emit('FIRE_FAILED', { reason: 'NO_AMMO', entityId: cmd.handle });\n *       return;\n *     }\n *     // raycast logic...\n *     const hitHandle = rayCast(fromPos, targetPos, entityFilter);\n *     if (hitHandle) {\n *       this.kernel.enqueueCommand(1, Engine.time.now(), cmd.source, 'DAMAGE_CMD', null, \n *         { handle: hitHandle, amount: 25, source: cmd.handle });\n *       gameBus.emit('HITSCAN_HIT', { attacker: cmd.handle, target: hitHandle });\n *     } else {\n *       gameBus.emit('HITSCAN_MISS', { attacker: cmd.handle });\n *     }\n *     this.kernel.inventories.setAmmo(dense, ammo - 1);\n *   }\n * 
 * ## TASK 5: Create Smoke Tests for Kernel Systems
 * 
 *   Time: ~1 hour
 *   
 *   ### File: HealthSystemSmokeTest.ts
 *   Test: Damage command correctly decrements health buffer
 *   Test: Death event fires when health <= 0
 *   Test: Multiple damage commands process in order
 *   
 *   ### File: WeaponSystemSmokeTest.ts
 *   Test: FIRE_CMD with ammo available → ammo decremented
 *   Test: FIRE_CMD with no ammo → fire fails
 *   Test: Raycast hit → target receives DAMAGE_CMD
 *   
 *   Run: npm run test -- --testPathPattern=\"(Health|Weapon)SmokeTest\"
 * 
 * ## TASK 6: Validate with IntegrationCheck
 * 
 *   Time: ~30 minutes
 *   
 *   ### File: GameplayDomainIntegrationCheck.ts (pre-written)
 *   Run: validator = new KernelBootstrapValidator(kernel)
 *   Call: result = await validator.validateBeforeGameplay()
 *   
 *   Expected: All tests pass (HealthSystem mutation, WeaponSystem tracking, consistency)
 *   If failing: Early exit with console output (FATAL error)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * CHECKLIST
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * HealthSystem:
 * [ ] Implements IKernelSystem (execute, category = KERNEL)
 * [ ] DAMAGE_CMD handler written (damage amount, health decrement logic)
 * [ ] Death check + ENTITY_DIED event emission
 * [ ] HealthStorage buffer mutations (NOT Entity properties)
 * [ ] Registered in SimulationKernel via addSystem()
 * [ ] HealthSystemSmokeTest passing (multiple damage commands, death check)
 * 
 * WeaponSystem:
 * [ ] Implements IKernelSystem (execute, category = KERNEL)
 * [ ] FIRE_CMD handler written (raycast, ammo check, DAMAGE_CMD queue)
 * [ ] Ammo decrement via InventoryStorage buffer
 * [ ] Reload logic + reload event emission
 * [ ] Replication events (HITSCAN_HIT, HITSCAN_MISS)
 * [ ] Registered in SimulationKernel via addSystem()
 * [ ] WeaponSystemSmokeTest passing (ammo tracking, fire conditions)
 * 
 * Integration:
 * [ ] tickOnce() runs HealthSystem + WeaponSystem in correct order
 * [ ] Commands are drained from queue each tick (no accumulation)
 * [ ] Phase-gating prevents execution during BOOT/SYNCING (only READY)
 * [ ] StateVault saves/loads health + ammo on mode transitions
 * [ ] GameplayDomainIntegrationCheck validates all buffers (✓ PASS)
 * [ ] Zero-regression: movement, inventory, physics tests all pass
 * 
 * Documentation:
 * [ ] @docs/SYSTEM_MIGRATION_SPRINT_A.md created (guide for team)
 * [ ] Code comments explain DOD patterns + command flow
 * [ ] Changelog updated (entry for v0.1.3.1-health-weapon-kernelization)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * EXPECTED FRAME PROFILE (Post-Sprint-A)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 60 FPS target:
 * • Frame time: 16.67ms budget
 * • Kernel tick: 0.5ms (no allocations; TypedArray passes only)
 *   - Entity Registry lookup: O(1) via handle
 *   - Buffer mutations: O(n_commands) where n_commands << n_entities
 * • Movement integration: 0.3ms (velocity→position DOD operations)
 * • Rendering publish: 0.2ms (MeshBindingTable buffer binding)
 * • Total gameplay overhead: ~1ms (allowing headroom for physics/culling)
 * 
 * GC: Zero allocation events in hot path (proof via DevTools heap snapshot)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * ROLLBACK PLAN (if integration breaks)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * If IntegrationCheck fails post-merge:
 * 1. Revert staged commit: git revert HEAD
 * 2. Check console for FATAL errors logged by GameplayDomainIntegrationCheck
 * 3. Likely cause: Buffer alignment mismatch or off-by-one in dense index
 * 4. Validate: EntityManager.getDenseIndex() returns consistent values
 * 5. Trace: Add console.log at EntityRegistry.createHandle() to confirm handle→dense mapping
 * 
 * ═══════════════════════════════════════════════════════════════════════════\n * RESOURCES\n * ═══════════════════════════════════════════════════════════════════════════\n * - [v0.1.3 Kernel Architecture](../../docs/ENGINE_ARCHITECTURE.md)\n * - [DOD Patterns in TypeScript](../../docs/DEVELOPER_GUIDE.md#dod-patterns)\n * - [IKernelSystem Interface](../types.ts#L450)\n * - [HealthStorage Implementation](./HealthStorage.ts)\n * - [InventoryStorage Implementation](./InventoryStorage.ts)\n * - [StateVault Reference](./StateVault.ts)\n */

export interface SprintAMilestone {
  taskId: string;
  title: string;
  completedAt?: Date;
  validationStatus: 'pending' | 'passing' | 'failing';
}