# v0.3.1 Feature Audit & Index

**Audit Date:** May 8, 2026  
**Target Version:** v0.3.1  
**Status:** Release-gate validation completed, ready for tag decision

---

## Executive Status

v0.3.1 is materially ahead of the public docs.

The repo now contains a real 0.3.1 runtime/content upgrade stack, not just the earlier bootstrap plan:

- Unified Titan content ownership is implemented and wired into the engine.
- Runtime lifecycle and streaming stability work is integrated at the engine/system level.
- The runtime simulation spine has explicit queue ownership, frame-driven scheduling, and determinism instrumentation.
- World-production and modular content authoring surfaces are present and connected to the runtime.
- The PrefabSystem boot blocker that previously rejected `metadata.runtimeMetadata.biomeCompatibility` is fixed.

### Current Validation Snapshot

- `npm --prefix client run type-check` -> PASSING
- `npm run test -- test/client/runtime/RuntimeDeterminismTrace.test.ts` -> PASSING (2/2)
- Live client boot verified at `http://localhost:3000/` -> main menu loads successfully
- Browser Tier0 suite -> PASSING (19/19)
- Phase reload/idempotency check -> PASSING (`phase3` reloaded 3x with stable system count and no listener growth)

### Release-Gate Summary

**What is green now**

- Client type-check is clean.
- Determinism replay coverage for the new runtime spine is passing.
- The runtime boots to the main menu after the recent prefab metadata fixes.

**What is now closed**

- Tier0 browser suite has been re-run and passed 19/19.
- Bootstrap/idempotency evidence has been refreshed via 3x `phase3` reload.
- Warning set has been reviewed and classified below.

**What remains before physically tagging `0.3.1`**

- Accept the remaining HMR dev-server warning set as known non-release noise.

---

## Audit Findings

### 1. Unified Content Pipeline: Implemented

The content pipeline is no longer just a plan. It owns map save/load, import/export, chunk serialization, prefab asset registration, production bundle ingestion, and streaming hooks.

Key outcomes:

- Engine-facing content APIs delegate through one runtime owner.
- Scene serialization is exposed as reusable entity serialization/deserialization primitives.
- Legacy save/load compatibility is preserved while Titan world/chunk assets are supported.
- Chunk lifecycle now bridges into runtime events and determinism tracing.

Primary owner files:

- `client/src/4-runtime/content/TitanContentPipeline.ts`
- `client/src/4-runtime/editor/SceneSerializationSystem.ts`
- `client/src/0-foundation/foundation/Engine.ts`
- `client/src/2-systems/gameplay/systems/AssetRegistry.ts`

### 2. Runtime Stability Layer: Implemented

The stability work was done at lifecycle boundaries, not through scattered null guards.

Key outcomes:

- Entities now have explicit runtime lifecycle and dormant semantics.
- Simulation activation is chunk-aware and AI/path state is cancelled or sanitized when entities sleep/stream out.
- Pathfinding is hardened against stale targets and transient serialized AI state.
- Streaming transitions explicitly mark entities as `loaded`, `dormant`, or `streamingOut`.

Primary owner files:

- `client/src/2-systems/gameplay/systems/RuntimeLifecycle.ts`
- `client/src/2-systems/gameplay/game/components/DormantComponent.ts`
- `client/src/2-systems/gameplay/game/components/RuntimeLifecycleComponent.ts`
- `client/src/2-systems/gameplay/systems/SimulationActivationSystem.ts`
- `client/src/2-systems/gameplay/systems/PathfindingSystem.ts`
- `client/src/2-systems/gameplay/game/components/AIControllerComponent.ts`

### 3. Runtime Simulation Spine: Implemented and Hardened

This is the biggest architectural delta versus the public `v0.3.0` docs.

Key outcomes:

- Runtime queue ownership is explicit and assembly-owned.
- The director is frame-driven; no `setTimeout` or wall-clock scheduling remains in the simulation director.
- Queued work is drained from the gameplay frame through one controlled path.
- Encounter ownership is epoch-tracked to prevent stale/double work.
- Queue semantics now distinguish `critical_lifecycle`, `gameplay`, and `telemetry_debug` traffic.

Primary owner files:

- `client/src/4-runtime/runtime/RuntimeEventQueue.ts`
- `client/src/4-runtime/runtime/RuntimeSimulationDirector.ts`
- `client/src/4-runtime/runtime/RuntimeAuxiliaryAssembly.ts`
- `client/src/4-runtime/runtime/bootstrapClientRuntime.ts`
- `client/src/4-runtime/runtime/SpatialRuntimeDebugHud.ts`

### 4. Contract Extraction & Determinism: Implemented

The runtime spine no longer depends directly on concrete streaming, horde, or spatial systems where narrow read-only contracts are sufficient.

Key outcomes:

- Director dependencies were narrowed behind runtime contracts.
- Horde encounter execution is adapted through a generalized encounter runtime wrapper.
- Determinism trace captures frame dt, chunk lifecycle, encounter ownership transitions, and queued job execution order.
- Replay digest tests verify identical output for the same input stream and a changed digest for changed execution order.

Primary owner files:

- `client/src/4-runtime/runtime/RuntimeSimulationContracts.ts`
- `client/src/4-runtime/runtime/HordeEncounterRuntime.ts`
- `client/src/4-runtime/runtime/RuntimeDeterminismTrace.ts`
- `test/client/runtime/RuntimeDeterminismTrace.test.ts`

### 5. Production Content Ecosystem: Implemented as a Real Runtime Slice

This is not placeholder scaffolding. The codebase now has a working authored/generated content runtime surface for modular content, biome/material/audio layers, encounter/event graph definitions, and procedural chunk materialization.

Key outcomes:

- Shared contracts define authored and generated world-production state.
- A production runtime manages bundles, biomes, encounters, cinematics, mods, chunk ownership, and replay journal state.
- The content pipeline can register/export/import production bundles and mod packages.
- Built-in production bundle content exists for castle, dungeon, swamp, and volcanic content themes.

Primary owner files:

- `packages/shared-contracts/src/gameplay/world-production.ts`
- `client/src/4-runtime/content/TitanWorldProductionRuntime.ts`
- `client/src/4-runtime/content/TitanProductionQueryLayer.ts`
- `client/src/4-runtime/content/builtinWorldProductionBundle.ts`

### 6. Prefab Metadata & Boot Reliability: Fixed

Recent work closed a live blocker in prefab registration/boot.

Key outcomes:

- Duplicate `linkHierarchy` signature parse failure was removed.
- Runtime metadata shape and validation were aligned with actual authored data.
- `biomeCompatibility`, `aiMetadata`, `gameplay`, and `collisionClass` are accepted and validated consistently.
- The browser no longer fails boot on the old prefab metadata rejection path.

Primary owner file:

- `client/src/2-systems/gameplay/systems/PrefabSystem.ts`

---

## Feature Index

### A. Runtime Content & Persistence

- Unified world save/load/import/export
- Chunk asset generation and manifesting
- Prefab asset registration and runtime metadata exposure
- Editor spawn-library population from runtime assets
- Production bundle and mod package import/export

Jump to:

- `client/src/4-runtime/content/TitanContentPipeline.ts`
- `client/src/4-runtime/editor/SceneSerializationSystem.ts`
- `client/src/0-foundation/foundation/Engine.ts`

### B. Streaming-Safe Runtime Lifecycle

- Dormant vs loaded vs streaming-out lifecycle states
- Chunk-aware simulation activation
- Path cancellation on dormancy/stream-out
- AI transient state stripping during serialization

Jump to:

- `client/src/2-systems/gameplay/systems/RuntimeLifecycle.ts`
- `client/src/2-systems/gameplay/systems/SimulationActivationSystem.ts`
- `client/src/2-systems/gameplay/systems/PathfindingSystem.ts`

### C. Runtime Simulation Scheduling

- Owned runtime queue
- Priority-tier runtime events
- Deterministic background job scheduling
- Encounter ownership invalidation
- Single gameplay-frame drain path

Jump to:

- `client/src/4-runtime/runtime/RuntimeEventQueue.ts`
- `client/src/4-runtime/runtime/RuntimeSimulationDirector.ts`
- `client/src/4-runtime/runtime/RuntimeAuxiliaryAssembly.ts`

### D. Determinism & Replay Trace

- Frame dt trace
- Chunk lifecycle trace
- Encounter ownership trace
- Queued job execution-order trace
- Digest-based replay comparison test

Jump to:

- `client/src/4-runtime/runtime/RuntimeDeterminismTrace.ts`
- `client/src/4-runtime/runtime/RuntimeSimulationContracts.ts`
- `test/client/runtime/RuntimeDeterminismTrace.test.ts`

### E. Production World Authoring Runtime

- Biome region definitions
- Procedural chunk generation inputs
- Encounter and event graph runtime state
- Material layer and audio ecology definitions
- Runtime prefab variants and mod manifests
- Chunk ownership and replay journal state

Jump to:

- `packages/shared-contracts/src/gameplay/world-production.ts`
- `client/src/4-runtime/content/TitanWorldProductionRuntime.ts`
- `client/src/4-runtime/content/TitanProductionQueryLayer.ts`
- `client/src/4-runtime/content/builtinWorldProductionBundle.ts`

### F. Modular Prefab Content Additions

- Castle kit pieces
- Dungeon kit pieces
- Vegetation clusters and vines
- Rubble and industrial beam variants
- Runtime biome/material/gameplay metadata on prefab definitions

Jump to:

- `client/src/assets/prefabs/castle_wall.json`
- `client/src/assets/prefabs/castle_arch.json`
- `client/src/assets/prefabs/dungeon_corridor.json`
- `client/src/assets/prefabs/vegetation_vine.json`
- `client/src/assets/prefabs/rock_rubble_pile.json`

### G. Diagnostics & Verification

- Expanded runtime HUD with queue/chunk/encounter metrics
- Runtime lifecycle unit coverage
- Spatial grid and activation coverage
- Determinism replay test coverage

Jump to:

- `client/src/4-runtime/runtime/SpatialRuntimeDebugHud.ts`
- `test/client/engine/runtime/RuntimeLifecycle.test.ts`
- `test/client/engine/runtime/SimulationActivationSystem.test.ts`
- `test/client/engine/runtime/SpatialGridSystem.test.ts`
- `test/client/runtime/RuntimeDeterminismTrace.test.ts`

---

## Validation Matrix

| Check | Status | Notes |
|------|--------|-------|
| Client type-check | PASS | `npm --prefix client run type-check` |
| Runtime determinism test | PASS | `test/client/runtime/RuntimeDeterminismTrace.test.ts` |
| Live boot to main menu | PASS | `http://localhost:3000/` loads `NEXUS Engine` main menu |
| Prefab metadata boot blocker | PASS | `biomeCompatibility` validator mismatch fixed |
| Tier0 browser suite | PASS | 19/19 passing in live browser on May 8, 2026 |
| Bootstrap idempotency/memory capture | PASS | 3x `phase3` reload: system count stable at 15, listeners stable at 0, used heap delta `+1.30 MB` |

---

## Residual Risks

These are the main remaining items between the current code state and a clean `v0.3.1` tag:

1. The live dev client still emits HMR full-reload warnings for non-accepted modules during hot update propagation. These are dev-server ergonomics issues, not release-runtime issues.
2. The documented browser Tier0 hook had regressed and was not exposed on `window`; this validation pass restored that hook in bootstrap, so that change should ship with the release.

These do not currently prevent boot, type-check, determinism replay validation, or the Tier0 suite.

---

## Release-Gate Evidence

### Tier0 Browser Suite

Executed in the live browser via `window.__runTier0Tests()` after restoring the bootstrap exposure hook.

Result:

- Total tests: 19
- Passed: 19
- Failed: 0

Per-gate breakdown:

- `1A` -> 3/3
- `0A` -> 4/4
- `0B` -> 4/4
- `0C` -> 4/4
- `0E` -> 4/4

### Phase Reload / Idempotency / Memory

Executed in the live browser through `window.__reloadPhase('phase3')` three times.

Observed:

- Baseline system count: `15`
- After reload 1: `15`
- After reload 2: `15`
- After reload 3: `15`
- Baseline listener count: `0`
- After reloads: `0`
- Used heap delta across 3 reloads: `+1.30 MB`

Result:

- No duplicate system growth observed.
- No listener accumulation observed.
- Heap growth remained below the `< 2 MB` target.

### Warning Disposition

Current warning set appears to fall into one remaining category:

- HMR full-reload warnings for non-accepted modules. These are dev-server ergonomics issues, not release runtime blockers.

Recommended disposition for `v0.3.1`:

- Accept HMR warnings as non-release issues.
- Ship the restored Tier0/bootstrap hooks and the runtime warning cleanup with the tag.

---

## Recommendation

The codebase is now in a credible `v0.3.1` release-ready state.

Compared with the public docs, the repo already contains the core runtime/content upgrades that `0.3.1` was supposed to deliver. The next move should not be more architecture invention. The correct move is to treat this as release gating:

1. Accept the remaining HMR dev-server warnings as non-release noise.
2. Tag `0.3.1`.

On the evidence captured in this pass, `v0.3.1` is ready to tag.