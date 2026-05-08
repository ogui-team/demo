# Sprint-A Quick Reference: Kernelize HealthSystem + WeaponSystem

## 🎯 Goal
Convert HealthSystem and WeaponSystem to DOD-based IKernelSystem implementations that operate directly on TypedArrays (no Entity property mutations).

**Timeline:** 3 days | **Priority:** P1 | **Blockers:** Phase-2 network integration requires this complete

---

## 🏗️ Quick Architecture

```
User Input (Click/Shoot) 
  → Game Event 
  → enqueueCommand(FIRE_CMD) 
  → kernel.tickOnce() 
  → WeaponSystem.execute() reads from ammo buffer 
  → Fires raycast 
  → Queues DAMAGE_CMD 
  → HealthSystem.execute() decrements health buffer 
  → Emits ENTITY_DIED event 
  → Mesh destroyed
```

**Key Principle:** Commands, not immediate effects. Buffers, not Entity properties.

---

## 📝 Step-by-Step Tasks

### Task 1: HealthSystem Kernelization (1.5h)

**File:** `client/src/engine/gameplay/combat/HealthSystem.ts`

```diff
+ import { IKernelSystem, SystemCategory } from '@kernel/types';
+ import { SimulationKernel } from '@kernel/SimulationKernel';

- export class HealthSystem {
+ export class HealthSystem implements IKernelSystem {
+   category = SystemCategory.KERNEL;
+   name = 'HealthSystem';
+   
+   constructor(private kernel: SimulationKernel) {}

+   execute(dt: number): void {
+     // Read command queue and process DAMAGE_CMD payloads
+     // Mutate kernel.healths buffer directly
+   }

-   applyDamage(entity: Entity, amount: number) {
-     entity.health -= amount;  // ❌ WRONG: Direct property mutation
+   // REMOVE ALL Entity property mutations
```

**Command Handler Logic:**
```typescript
private processDamagecommand(cmd: { handle: EntityHandle; amount: number; source: string }) {
  const dense = this.kernel.entities.getDenseIndex(cmd.handle);
  if (dense < 0) return; // Entity destroyed
  
  const oldHealth = this.kernel.healths.getHealth(dense);
  const newHealth = Math.max(0, oldHealth - cmd.amount);
  
  this.kernel.healths.setHealth(dense, newHealth);
  
  gameBus.emit('HEALTH_CHANGED', { handle: cmd.handle, health: newHealth });
  
  if (newHealth <= 0) {
    gameBus.emit('ENTITY_DIED', { handle: cmd.handle, source: cmd.source });
    // Queue mesh destruction (renderer will remove Three.js mesh)
    this.kernel.enqueueCommand(0, Date.now(), 'system', 'MESH_DESTROY_CMD', null, 
      { handle: cmd.handle });
  }
}
```

**Tests to Add:**
- ✓ Damage decrements buffer correctly
- ✓ Multiple damage commands process in order
- ✓ Death triggers when health <= 0
- ✓ ENTITY_DIED event emitted (listen in smoke test)

---

### Task 2: WeaponSystem Kernelization (1.5h)

**File:** `client/src/engine/gameplay/weapons/WeaponSystem.ts`

```diff
+ import { IKernelSystem, SystemCategory } from '@kernel/types';
+ import { SimulationKernel } from '@kernel/SimulationKernel';

- export class WeaponSystem {
+ export class WeaponSystem implements IKernelSystem {
+   category = SystemCategory.KERNEL;
+   name = 'WeaponSystem';
+   
+   constructor(private kernel: SimulationKernel) {}

+   execute(dt: number): void {
+     // Read command queue and process FIRE_CMD payloads
+     // Validate ammo, perform raycast, emit replication events
+   }

-   fire(entity: Entity, target: Vector3) {
-     entity.ammo -= 1;  // ❌ WRONG: Direct property mutation
+   // REMOVE ALL Entity property mutations
```

**Command Handler Logic:**
```typescript
private processFireCommand(cmd: { handle: EntityHandle; targetPos: [x, y, z]; source: 'local'|'remote' }) {
  const dense = this.kernel.entities.getDenseIndex(cmd.handle);
  if (dense < 0) return;
  
  // Step 1: Check ammo
  const ammo = this.kernel.inventories.getAmmo(dense);
  if (ammo < 1) {
    gameBus.emit('FIRE_FAILED', { handle: cmd.handle, reason: 'NO_AMMO' });
    return;
  }
  
  // Step 2: Get entity position from buffer
  const pos = this.kernel.positions.getPosition(dense);
  
  // Step 3: Raycast (existing physics code)
  const hitHandle = rayCast(pos, cmd.targetPos, (candidateHandle) => {
    return candidateHandle !== cmd.handle; // Don't hit self
  });
  
  // Step 4: If hit, queue DAMAGE_CMD
  if (hitHandle) {
    this.kernel.enqueueCommand(1, Date.now(), cmd.source, 'DAMAGE_CMD', null,
      { handle: hitHandle, amount: 25, source: cmd.handle });
    gameBus.emit('HITSCAN_HIT', { attacker: cmd.handle, target: hitHandle });
  } else {
    gameBus.emit('HITSCAN_MISS', { attacker: cmd.handle });
  }
  
  // Step 5: Decrement ammo in buffer
  this.kernel.inventories.setAmmo(dense, ammo - 1);
}
```

**Tests to Add:**
- ✓ FIRE_CMD with ammo → ammo buffer decremented
- ✓ FIRE_CMD no ammo → FIRE_FAILED event + no ammo change
- ✓ FIRE_CMD hit → target receives DAMAGE_CMD + HITSCAN_HIT event
- ✓ Multiple fires drain ammo correctly

---

### Task 3: Wire Systems into Kernel (30m)

**File:** `client/src/engine/core/kernel/SimulationKernel.ts`

Add system manager:
```typescript
private kernelSystems: { system: IKernelSystem; name: string }[] = [];

addSystem(system: IKernelSystem, name: string): void {
  this.kernelSystems.push({ system, name });
  console.log(`[Kernel] Registered ${name}`);
}

private executeSystems(dt: number): void {
  for (const { system } of this.kernelSystems) {
    system.execute(dt);
  }
}
```

Update `tickOnce()` sequence:
```typescript
tickOnce(dt: number, commandConsumer?: ..., migrationConsumer?: ...): void {
  // 1. Process migrations
  // 2. Execute kernel systems ← ADD THIS
  this.executeSystems(dt);
  // 3. Integrate physics
  // 4. Validate state
  // 5. Publish buffers
}
```

**File:** `client/src/engine/runtime/bootstrapClientRuntime.ts`

Initialize and register:
```typescript
const healthSystem = new HealthSystem(simulationKernel);
const weaponSystem = new WeaponSystem(simulationKernel, rayCastService);

simulationKernel.addSystem(healthSystem, 'HealthSystem');
simulationKernel.addSystem(weaponSystem, 'WeaponSystem');
```

Validate before gameplay:
```typescript
const validator = new KernelBootstrapValidator(simulationKernel);
try {
  await validator.validateBeforeGameplay();
  console.log('✓ Kernel ready for gameplay');
} catch (error) {
  console.error('FATAL: Kernel validation failed');
  // Prevent game start
  throw error;
}
```

---

### Task 4: Command Payload Definitions (1h)

**File:** `client/src/engine/core/types.ts`

Add interfaces:
```typescript
export interface DAMAGE_CMD {
  handle: EntityHandle;
  amount: number;
  source: string; // 'weapon' | 'environment' | 'test'
}

export interface FIRE_CMD {
  handle: EntityHandle;
  targetPos: [number, number, number];
  source: 'local' | 'remote';
}

// Update command union
export type KernelCommand = 
  | { type: 'MOVE_CMD'; payload: MOVE_CMD }
  | { type: 'FIRE_CMD'; payload: FIRE_CMD }
  | { type: 'DAMAGE_CMD'; payload: DAMAGE_CMD }
  // ... existing commands
```

---

### Task 5: Smoke Tests (1h)

**New File:** `client/src/engine/gameplay/combat/HealthSystemSmokeTest.ts`

```typescript
export function runHealthSystemSmokeTest(): boolean {
  const kernel = new SimulationKernel({ maxCapacity: 100 });
  const healthSystem = new HealthSystem(kernel);
  kernel.addSystem(healthSystem, 'health');
  
  // Test 1: Damage decrements buffer
  const handle = kernel.createEntity(0, 0, 0);
  kernel.healths.setHealth(kernel.entities.getDenseIndex(handle), 100);
  kernel.enqueueCommand(0, Date.now(), 'test', 'DAMAGE_CMD', null,
    { handle, amount: 25, source: 'test' });
  kernel.tickOnce(1/60);
  
  const health = kernel.healths.getHealth(kernel.entities.getDenseIndex(handle));
  if (health !== 75) {
    console.error('❌ Health not decremented correctly:', health);
    return false;
  }
  
  // Test 2: Death at 0 health
  kernel.enqueueCommand(0, Date.now(), 'test', 'DAMAGE_CMD', null,
    { handle, amount: 75, source: 'test' });
  
  // Listen for ENTITY_DIED
  let deathFired = false;
  gameBus.once('ENTITY_DIED', () => { deathFired = true; });
  kernel.tickOnce(1/60);
  
  if (!deathFired) {
    console.error('❌ ENTITY_DIED not emitted');
    return false;
  }
  
  console.log('✓ HealthSystem smoke test passed');
  return true;
}
```

**New File:** `client/src/engine/gameplay/weapons/WeaponSystemSmokeTest.ts`

```typescript
export function runWeaponSystemSmokeTest(): boolean {
  // Similar structure: create entity, fire, check ammo decremented
  // Check: FIRE_CMD no ammo → fail gracefully
  // Check: FIRE_CMD hit → DAMAGE_CMD queued
  console.log('✓ WeaponSystem smoke test passed');
  return true;
}
```

Run in bootstrap:
```typescript
if (!runHealthSystemSmokeTest() || !runWeaponSystemSmokeTest()) {
  throw new Error('Smoke tests failed');
}
```

---

### Task 6: Integration Validation (30m)

**File:** Already created: `GameplayDomainIntegrationCheck.ts`

This runs automatically during kernel bootstrap:
- ✓ HealthSystem buffer mutations work
- ✓ WeaponSystem ammo tracking works
- ✓ Buffer alignment (sizes match max_capacity)
- ✓ Post-tick consistency

**Usage:**
```typescript
const validator = new KernelBootstrapValidator(simulationKernel);
const result = await validator.validateBeforeGameplay();
if (!result.passed) {
  throw new Error(`Integration failed: ${result.errors.join(', ')}`);
}
```

---

## ✅ Checklist

**HealthSystem:**
- [ ] Implements IKernelSystem
- [ ] DAMAGE_CMD handler implemented
- [ ] Death check + ENTITY_DIED event
- [ ] No Entity property mutations
- [ ] Registered in kernel
- [ ] HealthSystemSmokeTest ✓

**WeaponSystem:**
- [ ] Implements IKernelSystem
- [ ] FIRE_CMD handler implemented
- [ ] Ammo validation + decrement
- [ ] Raycast + DAMAGE_CMD queue
- [ ] Replication events
- [ ] Registered in kernel
- [ ] WeaponSystemSmokeTest ✓

**Integration:**
- [ ] tickOnce() runs systems in order
- [ ] Commands drained each tick
- [ ] Phase-gating enforced (READY only)
- [ ] StateVault saves/loads health+ammo
- [ ] GameplayDomainIntegrationCheck ✓
- [ ] Zero-regression tests ✓
- [ ] Type-check ✓
- [ ] Build ✓

---

## 📊 Expected Results

After Sprint-A:
- **Frame time:** < 17ms (60 FPS headroom)
- **Kernel overhead:** < 1ms (no GC allocations)
- **Network latency:** Unaffected (systems are client-side deterministic)
- **Memory:** No increase (reusing buffers)

---

## 🚨 Troubleshooting

**Buffer size mismatch error:**
- Check: EntityRegistry.maxCapacity matches all buffer sizes
- Fix: Reinitialize buffers with correct capacity

**DAMAGE_CMD not updating health:**
- Check: getDenseIndex() is returning valid index (>= 0)
- Fix: Add console.log in command handler to trace flow

**GameplayDomainIntegrationCheck fails:**
- Check console for FATAL errors
- Rollback commit: `git revert HEAD`
- Trace: Add debug logs at EntityRegistry + Storage methods

---

## 📚 Resources

- [DomainMigrationPlan.ts](./DomainMigrationPlan.ts) — Full 67-system roadmap
- [IKernelSystem Interface](./types.ts#L450) — System contract
- [StateVault Reference](./StateVault.ts) — Mode transition safety
- [ENGINE_ARCHITECTURE.md](../../docs/ENGINE_ARCHITECTURE.md) — Full architecture

---

**Status:** 🚀 Ready to begin | **Start Date:** [TODAY] | **Target Completion:** [+3 days]
