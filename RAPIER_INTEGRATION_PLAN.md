# Rapier Integration Plan

## Gameplay Verification Sprint Update (2026-05-08)
- Drift Bomb now supports live backend toggling via runtime hotkey path (`legacy` <-> `rapier`) through `PhysicsSystem.switchBackend(...)`.
- Physics backend status is surfaced in the Drift Bomb debug HUD/overlay feed for immediate validation.
- Debug launch command is now available via `npm run debug:driftbomb` with autostart URL parameters.
- Current migration stage: backend scaffold + raycast delegation + runtime toggle and diagnostics; full contact/collision parity is still in-progress.

## Objective
Integrate Rapier into the current engine for higher-quality physics while keeping the existing Three.js rendering and minimizing regressions.

## Constraints
- Keep `PhysicsSystem` as the engine-facing API boundary.
- Avoid broad runtime rewrites in the first milestone.
- Preserve multiplayer stability and current collision-authority behavior.
- Roll out behind feature flags with a rollback path.

## Scope
### In Scope
- Rapier world integration behind existing physics interfaces
- Rigid body and collider lifecycle management
- Fixed timestep simulation
- Query support (raycast, overlap/shape checks)
- Incremental migration of dynamic gameplay interactions

### Out of Scope (Initial Milestones)
- Full replacement of all collision-authority logic on day one
- Immediate dynamic rigid-body player controller rewrite
- Any rendering pipeline replacement

---

## Phase 0: Architecture Freeze
1. Confirm ownership boundaries:
   - `PhysicsSystem` remains public API.
   - Rapier is internal backend implementation detail.
2. Define explicit non-goals for first milestones.
3. Record API invariants that cannot break during migration.

**Deliverable:** short architecture note with invariants and migration constraints.

## Phase 1: Rapier Backend Skeleton
1. Add Rapier dependency and startup guard.
2. Create `RapierPhysicsKernel` module:
   - world init/shutdown
   - fixed-step hook points
   - ID maps for entities -> rigid bodies/colliders
3. Add shape/body translators from existing configs to Rapier descriptors.
4. Keep current `PhysicsSystem` function signatures unchanged.

**Deliverable:** engine boots with Rapier backend initialized but with minimal behavior changes.

## Phase 2: Body/Collider Parity
1. Implement shape mapping:
   - AABB -> cuboid collider
   - sphere -> ball collider
2. Support body classes:
   - static
   - kinematic
   - dynamic
3. Support trigger/sensor semantics.
4. Wire add/remove/update lifecycle from entity events.

**Deliverable:** parity matrix passes for add/remove/body lookup/shape behavior.

## Phase 3: Fixed Timestep and Sync
1. Add accumulator-based fixed timestep stepping.
2. Define sync order:
   - pre-step: push kinematic intents
   - step world
   - post-step: pull transforms/velocities into engine state
3. Add optional interpolation path for render smoothness.

**Deliverable:** stable, frame-rate-independent simulation behavior.

## Phase 4: Queries and Gameplay Bridges
1. Implement Rapier-backed query methods used by gameplay:
   - raycast
   - overlap/shape query
2. Bridge weapon/combat query call sites to physics queries.
3. Preserve editor/selection render-raycast paths where appropriate.
4. Maintain existing callback/event contracts.

**Deliverable:** combat/projectile/pickup behavior parity or improvement.

## Phase 5: Collision Authority Coexistence
1. Keep `CollisionAuthoritySystem` as static layout authority source.
2. Use Rapier first for dynamic interactions.
3. Synchronize world-object dynamic colliders into Rapier.
4. Gate remote prediction with feature flags.

**Deliverable:** multiplayer compatibility maintained during migration.

## Phase 6: Character Movement Upgrade (Optional High Impact)
1. Introduce kinematic capsule/controller path for player movement.
2. Migrate movement resolution incrementally.
3. Tune ground/slope/step/wall-slide behavior.
4. Keep legacy movement fallback flag until parity is reached.

**Deliverable:** improved movement feel with controlled rollout risk.

## Phase 7: Debugging and Instrumentation
1. Add runtime diagnostics:
   - body/collider counts
   - awake/sleeping counts
   - contact pair counts
   - step timings
2. Add collider debug visualization overlay.
3. Add regression probes for collisions and queries.

**Deliverable:** actionable observability for tuning and triage.

## Phase 8: Validation Gates
1. Type-check/build pass.
2. Behavioral tests:
   - body lifecycle
   - trigger enter/exit parity
   - query parity on key scenarios
   - projectile/pickup interactions
3. Multiplayer sanity checks:
   - static layout correctness
   - dynamic collider sync behavior
4. Performance checks:
   - step timing budget
   - memory scaling by body count
   - stress-case throughput

**Deliverable:** go/no-go checklist for default enablement.

---

## Rollout Strategy
1. Introduce feature flag:
   - `physics.backend = legacy | rapier`
2. Default to `legacy` initially.
3. Enable `rapier` in targeted environments and modes.
4. Expand coverage gradually after validation gates pass.
5. Keep legacy backend for at least one release cycle as rollback.

## Risk Register
1. Player movement feel regressions
2. Authority/prediction mismatch in multiplayer
3. Event ordering differences from old solver
4. Performance spikes in high-contact scenes

## Mitigations
1. Backend feature flag + fast rollback path
2. Maintain API compatibility at `PhysicsSystem` boundary
3. Incremental adoption by subsystem (not big-bang)
4. Instrumentation before default enablement

---

## Recommended First Milestone (1-2 sprints)
1. Phase 1 + 2 + 3 only
2. Migrate non-player dynamic props and baseline queries
3. Add diagnostics and feature flag
4. Keep player movement and authority-resolution fallback unchanged

**Success Criteria**
- No regressions in startup and core gameplay loops
- Physics step timing within budget
- Query parity on critical interactions
- Safe rollback confirmed via feature flag
