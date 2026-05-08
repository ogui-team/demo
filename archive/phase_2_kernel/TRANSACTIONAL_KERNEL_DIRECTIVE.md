# 🏛️ TRANSACTIONAL DOD-KERNEL ARCHITECTURE
## v0.1.4-MYTHOS: Hard-Constraint Determinism

**Status**: Architecture Directive (Implementation Starting Sprint 1)  
**Principle**: No state mutation without validated transactions  
**Goal**: Bit-exact determinism + Self-healing error detection  
**Level**: Frostbite/Source2-Grade Engine Architecture

---

# 🎯 The Three Pillars

## 1️⃣ COMMAND-BUFFERED TRANSACTIONAL LOOP
**Pattern**: PHASE_COLLECT → PHASE_RESOLVE (Strict Read/Write Separation)

```
FRAME N
  ↓
┌─────────────────────────────────┐
│ PHASE_COLLECT (Read-Only)       │
├─────────────────────────────────┤
│ All systems.update(dt)          │
│   - Can read buffers            │
│   - Can enqueue commands        │
│   - Cannot mutate buffers!      │
│   - Generates: CommandQueue     │
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│ PHASE_RESOLVE (Mutation)        │
├─────────────────────────────────┤
│ kernel.resolveCommands()        │
│   - Dequeue all commands        │
│   - Each has TransactionID      │
│   - Validate entity handles     │
│   - Atomic buffer mutations     │
│   - Emit state-changed events   │
│   - Log trace for replay        │
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│ AUDIT (Debug-Only)              │
├─────────────────────────────────┤
│ Compare local buffers vs        │
│ shadow buffers                  │
│   - Corruption detected?        │
│   - YES → Panic + Stacktrace    │
│   - NO → Continue               │
└─────────────────────────────────┘
  ↓
FRAME N+1
```

### Key Rules:
✅ Systems can ONLY write via `kernel.commands.enqueue()`  
✅ NO direct buffer mutation from gameplay layer  
✅ Each command has **TraceID** (Tick + Sequence) for replay  
✅ PHASE_RESOLVE is **atomic** (all-or-nothing per command)  
✅ Failed command validation → **panic() + logs**

---

## 2️⃣ DENSE-BUFFER INTEGRITY INVARIANTS
**Pattern**: DODBufferProxy with Hard Assertions

```typescript
// BEFORE (Unsafe):
health[denseIndex] -= damage;  // ❌ Silent corruption possible

// AFTER (Safe):
kernel.healths.setHealth(handle, amount);  
  ↓
// Inside BufferProxy:
assert(kernel.entities.has(handle), `Handle ${handle} not registered!`);
assert(isFinite(amount), `Invalid health value: ${amount}`);
assert(amount >= 0, `Health cannot be negative!`);
mutate(buffer, amount);
```

### Three-Layer Validation:
1. **Handle Validity**: `assert(EntityRegistry.has(handle))`
2. **Bounds Checking**: `assert(value >= min && value <= max)`
3. **Type Safety**: `assert(typeof value === 'number')`

### Shadow-Buffer Audit (Debug Build):
```
After each tick:
  arrayBuffer[i] === shadowBuffer[i]  ?  ✅ : ❌ PANIC
```

---

## 3️⃣ DETERMINISTIC REPLICATION PROTOCOL
**Pattern**: State-Hash Validation

```typescript
// After Kernel.resolveCommands():
const stateHash = computeStateHash(kernel);
// CRC32 over all TypedArrays

// Server sends to client:
{ tick: 42, commands: [...], stateHash: 0xABCD1234 }

// Client locally:
const localHash = computeStateHash(kernel);
if (localHash !== packet.stateHash) {
  throw new DeterminismViolation(
    `Tick 42: hash mismatch! 
     Expected: 0xABCD1234, Got: 0x12340000
     Rollback to Tick ${lastValidTick}...`
  );
}
```

**Result**: 
- ✅ We know EXACTLY when divergence happens (frame-number precision)
- ✅ Automatic rollback to last valid state
- ✅ Network layer gets perfect replay window

---

# 📋 Implementation Roadmap

## File Structure (4 New Modules):

```
client/src/engine/core/kernel/
├── SimulationKernel.ts                   (REFACTOR: Add 2-phase loop)
├── TransactionalKernelMode.ts            (NEW: 2-phase executor)
├── DODBufferProxy.ts                     (NEW: Guard layer + assertions)
├── KernelAuditSystem.ts                  (NEW: Shadow-buffer validator)
└── KernelStateHash.ts                    (NEW: Deterministic hashing)
```

---

## v0.1.4: Phase 1 (Sprint 1-2)

### Tasks:
1. **TransactionalKernelMode.ts** (200 lines)
   - Implement PHASE_COLLECT logic
   - Implement PHASE_RESOLVE logic
   - Wire into existing SimulationKernel.tickOnce()

2. **DODBufferProxy.ts** (150 lines)
   - Wrap PositionStorage, HealthStorage, VelocityStorage
   - Add three-layer assertions
   - Release in dev-build only

3. **KernelStateHash.ts** (100 lines)
   - Implement CRC32 over TypedArrays
   - Compute after PHASE_RESOLVE
   - Return 32-bit hash

4. **KernelAuditSystem.ts** (200 lines)
   - Shadow-buffer allocation
   - Post-tick comparison
   - Panic logic with detailed trace

### Integration:
- Wire into `bootstrapClientRuntime.ts`
- Call `kernel.enableTransactionalMode()` at startup
- Audit runs in DEV mode only
- Zero overhead in RELEASE mode

---

## v0.1.5-v0.1.9: Phases 2-3

### v0.1.5: Gameplay Commands
- CombatSystem → enqueue KernelCommand
- DamageNumberUISystem → reads resolved state
- Verify: Command → Buffer mutation → UI update works

### v0.1.6-v0.1.7: Enemy Encounters
- DummyEnemySystem enqueues commands
- Observe deterministic health changes
- StateHash validates local state

### v0.1.8-v0.1.9: Multiplayer Sync
- Server: Send StateHash after tick
- Client: Verify hash matches local
- Network: Rollback on mismatch

---

# 🔧 Technical Details

## PHASE_COLLECT (Read-Only):
```
What CAN happen:
  ✅ system.update(dt) reads buffer data
  ✅ system.update(dt) calls kernel.commands.enqueue()
  ✅ gameBus.emit() broadcasts events
  
What CANNOT happen:
  ❌ Direct buffer[i] = value mutations
  ❌ Entity lifecycle changes
  ❌ Handle creation/destruction
```

## PHASE_RESOLVE (Mutation):
```
What MUST happen for each command:
  1. Dequeue from CommandQueue
  2. Assign TraceID (tick + seq)
  3. Validate payload schema
  4. Validate source entity handle
  5. Validate target entity handle
  6. Atomic mutation via BufferProxy (triggers assertions)
  7. Emit state-changed event
  8. Log command to ReplayLog
  9. All-or-nothing: if any step fails → rollback + panic
```

## Shadow-Buffer Comparison (Debug Only):
```
buffer[i] vs shadowBuffer[i]:
  Match?   ✅ Continue
  Differ?  ❌ Panic with:
    - Corrupted index
    - Expected vs actual value
    - Last valid trace ID
    - System that wrote it
    - Full stack trace
```

---

# 🎓 Why This Is "Myth-Level"

| Traditional OOP | Transactional DOD |
|---|---|
| State scattered across objects | Centralized in TypedArrays |
| Mutations happen "anywhere, anytime" | Only in PHASE_RESOLVE window |
| Race conditions possible | Impossible (2-phase guarantees) |
| Determinism = "hope and prayer" | Determinism = Math (state-hash proof) |
| Bug: "random teleport"? No idea why | Bug: "Determinism violation at Tick 42" ← precise location |
| Multiplayer sync = pain | Multiplayer sync = bit-exact guarantee |
| Memory corruption = silent | Memory corruption = hard-panic |

---

# 📊 Performance Impact

### DEV Build:
- **+5-10%** CPU (shadow buffers + hashing)
- **+50% Memory** (shadow buffers)
- **Worth it**: Perfect error detection

### RELEASE Build:
- **0% Overhead** (assertions stripped)
- **Shadow-buffers** removed
- **StateHash** computed once/tick (negligible)

---

# 🚀 After v0.1.9: The Payoff

Once this is done:
1. **Multiplayer is unbreakable** (state-hash proof < 1ms latency detection)
2. **Bugs have addresses** (panic logs tell exact frame + command)
3. **Performance debugging is trivial** (trace replay from any point)
4. **You can hire programmers** (engine is deterministic = predictable)
5. **AAA-grade stability** at indie scale

---

# 📝 Next: Let's Build It

Ready to start with:
1. `TransactionalKernelMode.ts` - The 2-phase executor
2. `DODBufferProxy.ts` - The guard layer
3. Integration into `SimulationKernel.ts`

**Shall we begin? 🚀**
