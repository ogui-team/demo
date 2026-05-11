# v0.3.1 Production Hardening & Scale Validation Plan

**Date:** May 8, 2026  
**Status:** ALL PHASES A-G COMPLETE - Production hardening fully implemented  
**Test Status:** 65 tests passing across all phases (Authority, Determinism, Streaming, Scale, Tooling, Creator Safety, Release Gating)  
**Mode:** Production hardening and enforcement - Ready for release validation  
**Scope:** Lock the existing runtime architecture, enforce authority, validate scale, and gate regressions before release candidates advance

## Gameplay Verification Focus (2026-05-08)

Production hardening remains complete, but active execution focus is now playable verification instead of core infrastructure expansion:
- Force Drift Bomb debug-fast launch path
- Validate live bomb/tether/round loop end-to-end
- Validate live Rapier backend switching under gameplay load
- Track gaps in `CURRENT_GAMEPLAY_BLOCKERS.md`

---

## Primary Objective

Transform the current engine state into a production-hardened runtime platform with:

1. enforceable runtime authority
2. deterministic validation gates
3. streaming and load stability guarantees
4. production-scale stress validation
5. CI and runtime regression protection
6. live observability and diagnostics
7. creator and mod ecosystem safety guarantees

This phase is not allowed to redesign the engine. It hardens, enforces, validates, instruments, stress-tests, documents, gates, and stabilizes what already exists.

---

## Non-Goals

- Do not invent replacement architecture.
- Do not introduce speculative abstractions.
- Do not replace existing runtime contracts unless an active violation requires a local fix.
- Do not widen scope into new gameplay feature work.

---

## Hard Stop Conditions

Stop execution and repair before moving forward if any of the following occurs:

- A runtime-global authority key is mutated outside its owning controller.
- Replay digests drift for identical input streams.
- Streaming churn creates duplicate entities, stale AI references, orphaned jobs, or listener growth.
- Sustained load produces uncontrolled frame-time growth or unbounded memory growth.
- Invalid authored content can mutate runtime state without validation.
- CI allows an architectural regression to merge without failing.

---

## Execution Order

This plan must execute in this order only:

1. PHASE A - Authority Enforcement
2. PHASE B - Determinism Enforcement
3. PHASE C - Streaming and Stability Validation
4. PHASE D - Scale and Performance Validation
5. PHASE E - Tooling and Observability
6. PHASE F - Creator and Mod Safety
7. PHASE G - Release Hardening

No phase is allowed to skip required exit criteria.

Phase B may not begin until the protected-key list and allowed authority escalation paths are frozen in `AUTHORITY_OWNERSHIP_MAP.md`.

---

## Finding Classification

All findings discovered during execution must be classified as one of:

- `ACTIVE VIOLATION`: current behavior is breaking an explicit runtime rule
- `LATENT RISK`: current behavior is stable now but can regress under scale or churn
- `READ DRIFT`: runtime reads a non-authoritative surface instead of the intended source of truth
- `BOOTSTRAP LEAK`: bootstrap or reload flow mutates state outside intended ownership
- `SESSION BYPASS`: runtime/session lifecycle bypasses controller-managed transitions
- `SCALE RISK`: behavior degrades materially under load, density, or concurrency
- `DETERMINISM RISK`: runtime order, trace, or replay behavior can diverge under identical inputs

---

## Todo List

- [x] Phase A - enumerate and lock all authority writes for `engine.appState`, `gameplay.active`, `game.mode`, `hud.visible`, and `ui.hud.mode`
- [x] Phase A - remove secondary writers, bootstrap leaks, session bypasses, and fallback runtime truth reads
- [x] Phase A - add forbidden-write scanner, authority ownership map, regression tests, and CI fail rules
- [x] Phase B - expand replay trace coverage for queue order, ownership, streaming transitions, AI activation, and prefab spawn order
- [x] Phase B - add replay digest matrix, fuzz suite, unstable-order detector, and CI replay gate
- [x] Phase C - build streaming torture suite for chunk churn, dormant transitions, path cancellation, encounter invalidation, and AI serialization
- [x] Phase C - add listener leak detection, orphaned job detection, duplicate-entity detection, and dormant-state validation reporting
- [x] Phase D - benchmark chunk density, prefab density, biome graph scale, concurrent encounters, and queue pressure
- [x] Phase D - add frame-budget assertions, memory growth tracking, telemetry exports, and sustained-load reporting
- [x] Phase E - expand diagnostics HUD and expose queue metrics, chunk ownership, replay epochs, lifecycle transitions, and authority state
- [x] Phase E - add runtime snapshot export, runtime diff tooling, authority visualization, and queue visualization
- [x] Phase F - validate prefab metadata, biome definitions, production bundles, encounter graphs, and mod manifests before runtime import
- [x] Phase F - add compatibility scanner, safe import layer, malformed bundle recovery tests, and deterministic mod validation
- [x] Phase G - wire CI gates for authority, replay drift, leaks, memory growth, frame budgets, and bootstrap duplication
- [x] Phase G - produce release audit report, runtime health scorecard, regression gate matrix, and release candidate validation suite

---

## Phase A - Authority Enforcement

**Goal:** guarantee the authoritative chain `EngineController -> StateManager -> Reactive Systems`

### Scope

- Enumerate all writes to:
  - `engine.appState`
  - `gameplay.active`
  - `game.mode`
  - `hud.visible`
  - `ui.hud.mode`
- Eliminate secondary writers.
- Remove bootstrap authority leaks.
- Remove session lifecycle bypasses.
- Remove fallback runtime truth reads from:
  - `gameHUD`
  - `engineGameModes`
  - `modeManager`
- Convert remaining mutations into controller intents.
- Create an authority validation scanner.

### Required Deliverables

1. authority violation report
2. authority ownership map
3. forbidden-write scanner
4. CI failure rules
5. regression tests

### Exit Criteria

- No runtime-global authority key is mutated outside `EngineController`.
- All reads for authority-controlled state flow through the intended source of truth.
- Scanner catches forbidden write sites and fails in CI.
- Protected-key freeze and allowed escalation paths are documented and treated as the Phase B entry contract.

### Suggested Artifacts

- `docs/03_SYSTEMS/runtime-authority-ownership-map.md`
- `docs/03_SYSTEMS/runtime-authority-violation-report.md`
- `scripts/validate-authority-writes.mjs`
- `test/runtime/authority/` regression coverage

---

## Phase B - Determinism Enforcement

**Goal:** prove deterministic replay integrity under changing runtime load

### Scope

- Expand replay trace coverage.
- Trace:
  - queue order
  - chunk ownership
  - encounter ownership
  - streaming transitions
  - AI activation and deactivation
  - prefab spawn ordering
- Create replay digest comparison suite.
- Add randomized replay fuzz tests.
- Add unstable-order detection.

### Required Deliverables

1. deterministic replay matrix
2. replay digest snapshots
3. replay fuzz suite
4. unstable ordering detector
5. CI replay verification gate

### Exit Criteria

- Identical input streams produce identical replay digests.
- Ordering detector flags nondeterministic runtime order before merge.
- CI fails on replay drift.

### Suggested Artifacts

- `docs/05_PERFORMANCE/runtime-determinism-matrix.md`
- `reports/runtime/replay-digests/`
- `test/client/runtime/RuntimeDeterminismTrace.test.ts`
- `test/runtime/determinism/`

---

## Phase C - Streaming and Stability Validation

**Goal:** prove lifecycle correctness under streaming churn

### Scope

- Stress-test:
  - chunk load and unload
  - dormant transitions
  - path cancellation
  - AI serialization
  - encounter invalidation
- Verify:
  - no listener leaks
  - no entity duplication
  - no stale AI references
  - no orphaned runtime jobs
- Create streaming torture tests.

### Required Deliverables

1. streaming stress suite
2. lifecycle leak detector
3. chunk churn benchmark
4. dormant-state validation report
5. orphaned job detector

### Exit Criteria

- Streaming transitions are idempotent and leak-free.
- Repeated load and unload cycles do not grow listeners, entities, or background job residue.
- Failures are observable in automation rather than only in browser inspection.

### Suggested Artifacts

- `scripts/stress-streaming-churn.mjs`
- `scripts/validate-runtime-leaks.mjs`
- `reports/runtime/streaming-stability/`
- `test/runtime/streaming/`

---

## Phase D - Scale and Performance Validation

**Goal:** prove runtime survives production-scale load

### Scope

- Benchmark:
  - 10x chunks
  - 100x prefabs
  - large biome graphs
  - concurrent encounters
  - heavy runtime queue load
- Measure:
  - frame spikes
  - queue drain times
  - memory growth
  - streaming latency
  - replay trace overhead
- Add frame-budget assertions.

### Required Deliverables

1. scale benchmark suite
2. runtime performance report
3. frame-budget validation
4. memory growth tracking
5. runtime telemetry exports

### Exit Criteria

- No uncontrolled frame-time growth under sustained runtime load.
- Frame-budget assertions fail fast when regressions exceed agreed thresholds.
- Memory growth and queue pressure are captured as machine-readable artifacts.

### Suggested Artifacts

- `scripts/benchmark-runtime-scale.mjs`
- `reports/runtime/scale/`
- `reports/runtime/performance/`
- `test/runtime/scale/`

---

## Phase E - Tooling and Observability

**Goal:** make runtime state inspectable and debuggable live

### Scope

- Expand runtime diagnostics HUD.
- Expose:
  - queue metrics
  - chunk ownership
  - replay epochs
  - lifecycle transitions
  - runtime authority state
- Add runtime snapshot export.
- Add runtime diff tooling.

### Required Deliverables

1. runtime diagnostics dashboard
2. snapshot exporter
3. runtime diff tool
4. authority visualization layer
5. queue visualization tools

### Exit Criteria

- All critical runtime state is inspectable live.
- Snapshot and diff tooling can explain runtime state changes without ad hoc logging.
- Authority state is visible enough to confirm single-writer discipline during validation.

### Suggested Artifacts

- `client/src/4-runtime/runtime/` diagnostics extensions
- `scripts/export-runtime-snapshot.mjs`
- `scripts/diff-runtime-snapshots.mjs`
- `docs/01_GUIDES/runtime-observability-guide.md`

---

## Phase F - Creator and Mod Safety

**Goal:** prevent authored content from destabilizing runtime integrity

### Scope

- Validate:
  - prefab metadata
  - biome definitions
  - production bundles
  - encounter graphs
  - mod manifests
- Sandbox invalid content.
- Create import validation pipeline.
- Create deterministic mod compatibility checks.

### Required Deliverables

1. mod validation pipeline
2. prefab integrity validator
3. content compatibility scanner
4. runtime-safe import layer
5. malformed bundle recovery tests

### Exit Criteria

- Invalid authored content never destabilizes runtime state.
- Import-time validation blocks or sandboxes malformed content before it mutates live systems.
- Compatibility checks are deterministic and testable.

### Suggested Artifacts

- `scripts/validate-production-content.mjs`
- `scripts/validate-mod-bundle.mjs`
- `test/runtime/content-safety/`
- `docs/03_SYSTEMS/content-safety-and-validation.md`

---

## Phase G - Release Hardening

**Goal:** convert runtime stability into enforceable release discipline

### Scope

- Add CI gates for:
  - authority violations
  - replay drift
  - listener leaks
  - memory growth
  - frame budget regressions
  - bootstrap duplication
- Create release audit template.
- Generate runtime health reports.
- Produce release readiness checklist.

### Required Deliverables

1. CI hardening pipeline
2. release audit report
3. runtime health scorecard
4. regression gate matrix
5. release candidate validation suite

### Exit Criteria

- CI fails before architectural regressions reach runtime.
- Release candidate validation can be rerun with stable artifacts.
- Runtime health status is explicit rather than anecdotal.

### Suggested Artifacts

- `.github/workflows/` or equivalent CI pipeline updates
- `docs/07_REFERENCE/runtime-regression-gate-matrix.md`
- `V0_3_1_RELEASE_HARDENING_REPORT.md`
- `V0_3_1_RUNTIME_HEALTH_SCORECARD.md`

---

## Execution Discipline

During implementation, prefer:

- deletion over abstraction
- enforcement over convention
- instrumentation over assumptions
- reactive flows over imperative control
- source evidence over narrative certainty

Every phase should leave behind three things:

1. machine-checkable validation
2. source-level enforcement
3. written evidence for release review

---

## Success Condition

The engine is considered production-hardened when it reaches:

- clean single-authority runtime
- deterministic replay validation
- streaming-stable lifecycle behavior
- production-scale load validation
- CI-enforced regression safety
- creator-safe content pipeline

At that point, the runtime is no longer in architecture-invention mode. It is operating as a hardened production platform.