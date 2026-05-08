# Runtime Determinism Validation Matrix

**Date:** May 8, 2026  
**Phase:** B - Determinism Enforcement  
**Status:** Baseline replay coverage established

---

## Overview

The runtime determinism matrix documents which event ordering changes produce digest changes (break determinism). This matrix is validated by the replay test suite and must be maintained as the replay trace expands.

---

## Event Ordering Dependencies

### Frame Timing Events

| Event Type | Ordering Impact | Digest Change | Notes |
|------------|-----------------|---------------|-------|
| `recordFrameDt` | Frame index must be monotonic | No (frame index order preserved) | Timing variations within a frame do not break digest |

### Chunk Lifecycle Events

| Event Type | Ordering Impact | Digest Change | Notes |
|------------|-----------------|---------------|-------|
| `recordChunkLifecycle` | Load/unload order is significant | Yes | Reordering chunk load/unload changes digest |
| | Chunk entity count variance | No | Same chunk with different entity counts preserves digest |

### Encounter Ownership Events

| Event Type | Ordering Impact | Digest Change | Notes |
|------------|-----------------|---------------|-------|
| `recordEncounterOwnershipTransition` | Ownership state transitions | Yes | Reordering encounter activation/deactivation changes digest |
| | Epoch tracking | Yes | Encounter epoch must be preserved in order |

### Queued Job Execution Events

| Event Type | Ordering Impact | Digest Change | Notes |
|------------|-----------------|---------------|-------|
| `recordQueuedJobExecution` | Job execution order | Yes | Queued jobs must execute in recorded order |
| | Frame index during execution | No | Job frame index is independent of recording frame |
| | Priority field | No | Priority is informational; actual execution order is definitive |

### AI Activation Events

| Event Type | Ordering Impact | Digest Change | Notes |
|------------|-----------------|---------------|-------|
| `recordAIActivation` | AI activation order | Yes | Reordering AI activation/deactivation changes digest |
| | Encounter epoch pairing | No | Epoch is recorded but AI order is primary |

### Prefab Spawn Events

| Event Type | Ordering Impact | Digest Change | Notes |
|------------|-----------------|---------------|-------|
| `recordPrefabSpawn` | Prefab spawn order | Yes | Spawn order determines entity ID assignment |
| | Chunk placement order | Yes | Chunk-local spawn order is significant |

### Streaming Transition Events

| Event Type | Ordering Impact | Digest Change | Notes |
|------------|-----------------|---------------|-------|
| `recordStreamingTransition` | Transition order | Yes | Dormant/wake/serialize order changes digest |
| | Entity state transitions | Yes | Entity serialization order is deterministic |

---

## Ordering Invariants

### Must-Preserve Invariants

1. **Frame Index Monotonicity**: `recordFrameDt` frame indices must increment.
2. **Epoch Ordering**: Events with `epoch` field must preserve epoch order globally.
3. **Encounter State Machine**: Encounter ownership transitions must follow valid state sequences:
   - `inactive` ↔ `background` ↔ `foreground`
4. **Entity Identity**: Prefab spawns determine entity IDs; reordering changes identity.
5. **Job Execution**: Queued job execution order determines runtime behavior.

### Can-Vary Safely

1. **Frame Timing**: Delta times within a frame can vary without affecting digest.
2. **Event Priority Fields**: Priority metadata does not affect digest, only recorded order.
3. **Entity Count Variance**: Chunk entity count metadata does not affect digest.
4. **Encounter Key Naming**: Encounter key strings are compared directly; renaming changes digest.

---

## Fuzz Testing Coverage

The runtime determinism trace fuzz suite validates that:

1. **Identical Seed Produces Identical Digest**: Same seed → same digest (determinism confirmed)
2. **Different Seeds Produce Different Digests**: Event order variance → digest variance (sensitivity confirmed)
3. **Unstable Ordering Detection**: Multiple permutations can be tested to identify nondeterministic behavior

**Fuzz Configuration:**
- Event types: 5 categories (frame, chunk, encounter, AI, stream)
- Events per run: 20–50 events
- Seed range: 0–100
- Test repetitions: 10–20

---

## Digest Computation

Digest is computed as an FNV-1a hash over serialized event entries:

```
digest = 0x811c9dc5  (FNV offset basis)
for each entry:
  serialized = serializeEntry(entry)
  for each char in serialized:
    digest ^= char.charCodeAt()
    digest = (digest * 0x01000193) & 0xFFFFFFFF
return digest.toString(16)
```

Digest changes if and only if serialized event order or content changes.

---

## Phase B Exit Criteria

All of the following must be true:

- [ ] Identical input streams produce identical replays
- [ ] Ordering detector flags nondeterministic runtime order before merge
- [ ] CI fails on replay drift
- [ ] Expanded determinism trace covers:
  - [x] Queue order
  - [x] Chunk ownership
  - [x] Encounter ownership
  - [x] Streaming transitions
  - [x] AI activation and deactivation
  - [x] Prefab spawn order

---

## Running Determinism Validation

```bash
# Run all replay validation tests
npm run validate:replay

# Output: Pass/fail on 12 determinism tests
```

---

## Known Nondeterminism Sources (If Any)

None currently documented. All observed behaviors are deterministic when input order is preserved.

---

## Phase C Determinism Expansion

Phase C will expand determinism coverage to:

- Streaming churn tolerance (repeated load/unload)
- Dormant state serialization consistency
- Path cancellation ordering
- Concurrent encounter ordering under load

