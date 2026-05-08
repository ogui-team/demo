# Coverage Report

## Summary

- Test framework: `vitest`
- Coverage provider: `@vitest/coverage-istanbul`
- Test files executed: `12`
- Tests passed: `62`
- Total failures: `0`

## Result

The current test suite runs successfully and validates:
- `shared/PhysicsConstants.ts`
- `server/src/utils/DeterministicIdHash.ts`
- `server/src/session/SpawnPointRegistry.ts`
- `client/src/engine/core/EventBus.ts`
- `client/src/engine/core/EventListenerRegistry.ts`
- `client/src/engine/ui/OGUITheme.ts`
- `client/src/engine/kernel/SystemRegistry.ts`
- `client/src/engine/runtime/bootstrap/phases.ts` (Phase 5 UI runtime)
- `client/src/engine/core/Entity.ts`
- `client/src/engine/core/Transform.ts`
- `client/src/engine/gameplay/systems/InventorySystem.ts`
- `client/src/engine/gameplay/systems/HealthSystem.ts`

## Coverage snapshot

The current coverage report shows a low total percent because the repository contains many untested modules, but the tested paths are correct and passing.

### Important findings

- `EventBus.ts` is fully covered for core pub/sub functionality.
- `EventListenerRegistry.ts` is covered for adding, disposing, and cleanup behavior.
- `HealthSystem` is covered for registration, damage, healing, shield tracking, and revival behavior.
- The bootstrap UI phase is covered for DOM tracking and disposal semantics.

### Next coverage targets

Add tests for these high-value modules next to improve coverage quickly:
- `client/src/engine/gameplay/systems/WeaponSystem.ts`
- `client/src/engine/playback` and kernel system metadata
- `client/src/engine/runtime/bootstrapClientRuntime.ts` hot-reload / phase wiring
- `server/src/session/SnapshotFilter.ts` and snapshot contract validation
- `client/src/engine/network/NetworkTransport.ts` and replication helpers
- `client/src/engine/gameplay/systems/HUDSystem.ts`

## How to rerun coverage

```bash
npm test -- --coverage
```

## Notes

Because the repository includes many engine subsystems and browser-specific runtime code, full coverage will require:
1. additional isolated unit tests for pure modules,
2. integration-style tests with mocked engine dependencies,
3. browser DOM and event simulation for UI systems,
4. server-side tests for snapshot and multiplayer contract modules.
