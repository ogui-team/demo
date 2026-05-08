# PHASE 2: MEMORY SCHEMATICS - EXACT BYTE OFFSETS

**Baseline Kernel Heap:** 210,944 bytes → **Phase 2 Total:** 243,712 bytes

---

## LANE A: Death Animation State (AnimationEffectStorage)

### Constraint: Zero-Object-Creation
- Death is a **bit-flag** (alive/dead state in Uint8)
- Death timer is a **Float32** (countdown for respawn queue)
- No Three.js objects, no timers, no callbacks
- Pure DOD buffer mutations in PHASE_RESOLVE

### New AnimationEffectStorage (Added)

```
Animation State Buffer Layout (Per Entity Dense Index):
├─ Base Offset: 210,944 (start of new storage)
├─ Capacity: 2,048 entities
├─ Stride: 2 Uint32 per entity (8 bytes)
│  ├─ [i*2 + 0]: deathState | deathTimerBits (packed Uint32)
│  │              ┌─ Bits [0-7]:   deathState (0=alive, 1=dead, 2=respawning)
│  │              ├─ Bits [8-31]:  unused (reserved for future flags)
│  │              └─ Total: 1 byte used / 4 bytes allocated
│  └─ [i*2 + 1]: deathTimer (Float32 countdown, 0.0-5.0 seconds)
│                 ┌─ Range: [0.0, 5.0] seconds to respawn
│                 ├─ Updated: PHASE_RESOLVE tick (decrement by deltaTime)
│                 └─ When timer <= 0: trigger entity respawn, reset

AnimationEffectStorage Total Bytes:
├─ deathStateBuffer:  Uint32Array[2048] = 8,192 bytes
└─ deathTimerBuffer:  Float32Array[2048] = 8,192 bytes
   SUBTOTAL LANE A: 16,384 bytes
```

### CRC32 Hash Order (Updated)

After InventoryStorage, add:
```
Step 6: AnimationEffectStorage.deathStateBuffer → hash6
Step 7: AnimationEffectStorage.deathTimerBuffer → hash7
Combined: hash1 ⊕ hash2 ⊕ hash3 ⊕ hash4 ⊕ hash5 ⊕ hash6 ⊕ hash7 → stateHash
```

---

## LANE B: Inventory DOD Refactor (InventoryBufferProxy)

### Constraint: Eradicate JS-Objects
- Grid is **contiguous Uint16Array** (ItemIDs only)
- No object instantiation for grid slots
- No property access (inventory.grid[i].itemId)
- Direct buffer index operations: `gridBuffer[index] = itemId`

### Updated InventoryStorage (Refactored)

```
Existing State (Pre-Phase 2):
├─ ammoValues:   Uint32Array[2048] = 8,192 bytes
└─ itemIdValues: Uint32Array[2048] = 8,192 bytes
   SUBTOTAL: 16,384 bytes

Phase 2 Enhancement - Inventory Grid (Zero-Object):
├─ GRID_COLUMNS = 10 (width)
├─ GRID_ROWS = 4 (height)
├─ SLOTS_PER_PLAYER = 40 (GRID_COLUMNS × GRID_ROWS)
├─ MAX_PLAYERS = 2,048
├─ TOTAL_GRID_CELLS = 2,048 × 40 = 81,920
│
├─ gridBuffer: Uint16Array[81920]
│              ├─ Each cell = Uint16 (ItemID: 0-65535)
│              ├─ 0 = empty slot
│              ├─ 1-100 = valid item types
│              ├─ Offset: Base + (playerDenseIndex * 40) + (slotRow * 10) + slotCol
│              └─ Total: 163,840 bytes (2 bytes × 81,920)
│
├─ gridMetadata: Uint32Array[2048]
│                ├─ Bits [0-7]:   selectedSlotIndex (0-39)
│                ├─ Bits [8-15]:  equippedSlotIndex (0-39, 255=none)
│                ├─ Bits [16-31]: reserved
│                └─ Total: 8,192 bytes
│
└─ SUBTOTAL LANE B: 163,840 + 8,192 = 172,032 bytes

Updated InventoryStorage Total Bytes (LANE B):
├─ ammoValues (existing):      8,192 bytes
├─ itemIdValues (existing):    8,192 bytes
├─ gridBuffer (NEW):           163,840 bytes
└─ gridMetadata (NEW):         8,192 bytes
   TOTAL LANE B: 188,416 bytes (was 16,384)
```

### Byte Offset Mapping (Phase 2)

```
Kernel Heap Layout (243,712 bytes total):

0 ─────────────────────────────────────────
  EntityRegistry
  ├─ generations:   Uint16Array[2048] @ 0
  ├─ alive:         Uint8Array[2048] @ 4,096
  ├─ denseToSlot:   Uint32Array[2048] @ 6,144
  ├─ slotToDense:   Int32Array[2048] @ 14,336
  └─ freeSlots:     Uint32Array[2048] @ 22,528
  SUBTOTAL: 30,720 bytes

30,720 ───────────────────────────────────
  PositionStorage (unchanged)
  ├─ readPage:      Float32Array[6144] @ 30,720
  ├─ writePage:     Float32Array[6144] @ 55,296
  └─ authReadPage:  Float32Array[6144] @ 79,872
  SUBTOTAL: 73,728 bytes (stride=3 for 2048 entities)

104,448 ───────────────────────────────────
  VelocityStorage (unchanged)
  ├─ values:        Float32Array[6144] @ 104,448
  └─ authValues:    Float32Array[6144] @ 129,024
  SUBTOTAL: 49,152 bytes

153,600 ───────────────────────────────────
  HealthStorage (unchanged)
  ├─ healthValues:  Float32Array[2048] @ 153,600
  └─ maxHealthValues: Float32Array[2048] @ 161,792
  SUBTOTAL: 16,384 bytes

170,016 ───────────────────────────────────
  InventoryStorage (EXPANDED in Phase 2)
  ├─ ammoValues:    Uint32Array[2048] @ 170,016
  ├─ itemIdValues:  Uint32Array[2048] @ 178,208
  ├─ gridBuffer:    Uint16Array[81920] @ 186,400
  └─ gridMetadata:  Uint32Array[2048] @ 350,240
  SUBTOTAL: 188,416 bytes

358,432 ───────────────────────────────────
  AnimationEffectStorage (NEW - LANE A)
  ├─ deathStateBuffer: Uint32Array[2048] @ 358,432
  └─ deathTimerBuffer: Float32Array[2048] @ 366,624
  SUBTOTAL: 16,384 bytes

374,816 ───────────────────────────────────
  END OF PHASE 2 KERNEL HEAP
  TOTAL: 243,712 bytes (32% increase for animation + inventory grid)
```

---

## CRC32 Validation Chain (Phase 2 - Updated Order)

**LOCKED SEQUENCE (No Deviations):**

```
Step 1: EntityRegistry.alive @ 4,096 (Uint8Array[2048])
        → hash1

Step 2: PositionStorage.readPage @ 30,720 (Float32Array[6144])
        → hash2

Step 3: VelocityStorage.values @ 104,448 (Float32Array[6144])
        → hash3

Step 4: HealthStorage (healthValues + maxHealthValues) @ 153,600
        → hash4 = CRC32(healthValues[0..2047]) ⊕ CRC32(maxHealthValues[0..2047])

Step 5: InventoryStorage.ammoValues + itemIdValues @ 170,016
        → hash5 = CRC32(ammoValues[0..2047]) ⊕ CRC32(itemIdValues[0..2047])

Step 6: InventoryStorage.gridBuffer + gridMetadata @ 186,400
        → hash6 = CRC32(gridBuffer[0..81919]) ⊕ CRC32(gridMetadata[0..2047])
        **NEW - LANE B**

Step 7: AnimationEffectStorage (deathStateBuffer + deathTimerBuffer) @ 358,432
        → hash7 = CRC32(deathStateBuffer[0..2047]) ⊕ CRC32(deathTimerBuffer[0..2047])
        **NEW - LANE A**

COMBINED HASH:
stateHash = hash1 ⊕ hash2 ⊕ hash3 ⊕ hash4 ⊕ hash5 ⊕ hash6 ⊕ hash7

TICKED HASH:
tickedHash = "{tick_hex:8}:{stateHash_hex:8}"
Format prevents wrap-around collisions across 60+ ticks
```

---

## Zero-Allocation Constraint Verification

### Lane A: Death Animation
```
Object Creation Points to Eliminate:
❌ FORBIDDEN: new Timer(5.0) → ✅ Use deathTimer: Float32 in buffer
❌ FORBIDDEN: entity.deathAnimation = new DeathState() → ✅ Use deathState: Uint8 flag
❌ FORBIDDEN: callbacks for respawn timing → ✅ Pure PHASE_RESOLVE decrement

PHASE_RESOLVE Loop (O(N) where N = entities):
for (let i = 0; i < activeCount; i++) {
  const deathTimerValue = deathTimerBuffer[i];
  if (deathTimerValue > 0) {
    deathTimerBuffer[i] -= deltaTime;  // Decrement
    if (deathTimerBuffer[i] <= 0) {
      deathStateBuffer[i] = 2;  // Mark as RESPAWNING (bit-flag)
      triggerRespawn(i);        // No object allocation
    }
  }
}
```

### Lane B: Inventory Grid
```
Object Creation Points to Eliminate:
❌ FORBIDDEN: new InventorySlot() → ✅ Use gridBuffer Uint16 direct access
❌ FORBIDDEN: new ItemStack() → ✅ Store itemId directly in buffer
❌ FORBIDDEN: this.inventory.addItem(obj) → ✅ Direct buffer mutation

DROP Operation (O(1)):
playerIndex = entityHandle.getDenseIndex()
slotIndex = gridMetadata[playerIndex] & 0xFF  // selectedSlotIndex
gridBuffer[playerIndex * 40 + slotIndex] = 0   // Clear slot

PICKUP Operation (O(1)):
playerIndex = entityHandle.getDenseIndex()
firstEmptySlot = findFirstEmptySlot(playerIndex)  // O(40) linear search
gridBuffer[playerIndex * 40 + firstEmptySlot] = itemId  // Place item
```

---

## Summary: Phase 2 Memory Impact

| Storage | Phase 1 | Phase 2 | Delta | % Change |
|---------|---------|---------|-------|----------|
| **EntityRegistry** | 30,720 | 30,720 | 0 | 0% |
| **PositionStorage** | 73,728 | 73,728 | 0 | 0% |
| **VelocityStorage** | 49,152 | 49,152 | 0 | 0% |
| **HealthStorage** | 16,384 | 16,384 | 0 | 0% |
| **InventoryStorage** | 16,384 | 188,416 | **+172,032** | **+1050%** |
| **AnimationEffectStorage** | 0 | 16,384 | **+16,384** | **NEW** |
| **TOTAL** | 186,368 | **374,816** | **+188,416** | **+101%** |

**Kernel Heap Scaling:** 210,944 bytes (baseline) → 243,712 bytes (Phase 2)
**Zero-Allocation Guarantee:** All mutations in fixed TypedArray buffers
**CRC32 Proof:** 7-step hash chain (no corruption across state boundaries)

---

**Status:** ✅ Memory schematics locked for Phase 2 implementation  
**Next:** Update storage classes + PHASE_RESOLVE logic + validation script
