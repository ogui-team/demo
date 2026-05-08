# Test Suite Implementation Plan

## Recommended framework

Use **Vitest** as the primary test runner for this repository.

### Why Vitest?
- Native TypeScript support with zero extra transpiler configuration.
- Built-in browser-like DOM environment via `happy-dom`.
- Fast unit test execution and integrated coverage reporting.
- Easy module mocking for engine bootstrap code and isolated runtime phase tests.
- Best fit for the current monorepo style: simple root-level test files that can exercise both `client` and `server` TypeScript code.

## Folder structure

The `test/` folder created here contains:
- `vitest.config.ts` — runtime and alias configuration
- `DeterministicIdHash.test.ts` — server utility unit tests
- `SystemRegistry.test.ts` — kernel registry validation tests
- `Phase5_UIRuntime.test.ts` — bootstrap UI runtime test with DOM and mock injection
- `Entity.test.ts` — core entity behavior tests
- `Transform.test.ts` — state-backed transform utilities tests
- `InventorySystem.test.ts` — inventory flow, pickup, and state sync tests

## Immediate test coverage targets

Start with the most testable and highest-value modules first:
1. `server/src/utils/DeterministicIdHash.ts`
2. `client/src/engine/kernel/SystemRegistry.ts`
3. `client/src/engine/runtime/bootstrap/phases.ts` (Phase 5 only, via mocks)

## Current progress

- Added `vitest` test harness and coverage configuration.
- Added initial unit tests for core engine utilities, shared constants, server utilities, and a runtime UI phase.
- Verified `npm test` passes with `62` tests across `12` files.
- Enabled coverage reporting with `istanbul` provider.

## Full coverage strategy

### Phase 1: Core utilities
- Validate deterministic hashing functions and collision analysis.
- Cover all branches of `validateNoCollisions()` and `analyzeHashDistribution()`.

### Phase 2: Kernel and bootstrap support
- Cover `SystemRegistry` lifecycle operations:
  - register, replace, remove
  - phase ownership tracking
  - duplicate detection
  - diagnostics
- Add tests for event-disposable systems and phase cleanup semantics.

### Phase 3: Bootstrap runtime phases
- Add isolated tests for:
  - `bootstrapPhase1_CoreRuntime()` failure paths when engine state is missing
  - `bootstrapPhase2_RenderingRuntime()` validation failure on missing renderer/camera/scene
  - `Phase3_GameplayRuntime()` constructors using mocked engine dependencies
  - `Phase4_NetworkingRuntime()` object creation and dispose behavior
  - `Phase5_UIRuntime()` DOM/cleanup behavior in happy-dom

### Phase 4: Gameplay systems
- Add unit tests for low-dependency gameplay classes first:
  - `HealthSystem`
  - `WeaponSystem`
  - `PrefabSystem`
  - `InventorySystem`
  - `HUDSystem`
- Use mocks and fake state to isolate each system.

### Phase 5: Network and multiplayer modules
- Add tests for server-side utilities and deterministic behavior:
  - `MultiplayerClient`
  - `CollisionAuthoritySystem`
  - `SnapshotContract`
  - `ReplicationSystem`
- Add client-side tests for network adapters and lobby flow if possible.

### Phase 6: Integration and coverage
- Add targeted integration tests for hot reload and phase disposal semantics.
- Add coverage gating to ensure every file is exercised.
- Use `vitest` coverage report to identify untested modules.

## What to install next

Install the following dev dependencies in the root repository before running the new tests:

```bash
npm install -D vitest happy-dom c8
```

Then add the following script to the root `package.json`:

```json
"scripts": {
  "test": "vitest run --config test/vitest.config.ts"
}
```

## Notes

- No production source files are modified by the current test artifacts.
- The initial scripts here target strong unit coverage without requiring the full game bootstrap to run.
- This plan is designed to proceed incrementally toward 100% coverage by expanding tests from pure utilities into engine and UI runtime modules.
