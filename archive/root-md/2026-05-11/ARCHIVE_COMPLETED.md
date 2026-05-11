# Archive Completed

## Audit Snapshot (v0.3.1 -> v0.4.0)

Completed items were moved out of active execution tracking to keep plans focused on outstanding work only.

## Completed and Verified

- Fixed multiplayer round-mode activation crash caused by stale mode id `ffa` activation path.
- Implemented mode-aware round activation in session lifecycle coordinator.
- Verified bootstrap phase contract exists and is active for Phase 3, 4, and 5 with PhaseResult and dispose support.
- Verified kernel SystemRegistry supports runtime replace/remove/phase removal and disposal paths.
- Added server-authoritative Horde start handshake:
  - client sends `HORDE_START_REQUEST` in multiplayer
  - server broadcasts `HORDE_START_CONFIRMED`
  - clients trigger local Horde start from server confirmation
- Added shared contracts workspace scaffolding in `packages/shared-contracts`.
- Added initial shared geometry and network contract files (`Vector3`, `Transform`, message envelope + Horde start messages).
- Updated workspace and TypeScript path wiring for `@shared/contracts` imports.
- Kept existing client/server `Vec3` definitions in place for now to avoid rootDir/build-boundary regressions; full import migration remains active work.
- Type-check validation passed for both client and server after migration steps.

## Evidence

- `client/src/engine/runtime/bootstrap/createSessionLifecycleCoordinator.ts`
- `client/src/engine/runtime/bootstrap/phases.ts`
- `client/src/engine/kernel/SystemRegistry.ts`
- `server/src/core/GameSession.ts`
- `client/src/engine/network/MultiplayerClient.ts`
- `client/src/engine/runtime/coordinators/ClientWorldRuntimeCoordinator.ts`
- `packages/shared-contracts/src/geometry/vector.ts`
- `server/src/sessionContracts.ts`
- `client/src/engine/network/MultiplayerContracts.ts`

## M1–M4 Sprint Completed (v0.4.0 Horizon)

### Milestone 0 — tsconfig Fix (Unblock cross-package imports)
- Removed `rootDir` from `client/tsconfig.json` and `server/tsconfig.json`.
- Added `"composite": true` to `packages/shared-contracts/tsconfig.json`.
- Both client and server compile clean after fix.

### Milestone 2 — Shared Geometry Migration
- Created `packages/shared-contracts/src/geometry/utils.ts` with 18 Vector3/Transform utility functions.
- Migrated `interface Vec3` out of 7+ files: `MultiplayerClient.ts`, `MultiplayerContracts.ts`, `PlayerState.ts`, `sessionContracts.ts`, `AuthoritativeActorRuntime.ts`, `registerDeveloperConsoleCommands.ts`, `DummyEnemySystem.ts`.
- All migrated files now import `type { Vector3 as Vec3 } from '@shared/contracts'`.

### Milestone 1 — Thin Bootstrap Migration
- `bootstrapClientRuntime.ts` rewritten to pure orchestration (~280 lines, zero `new XSystem()` calls).
- All system instantiation moved to `bootstrap/phases.ts`: Phase3 creates 35 systems, Phase5 creates 7 systems.
- Factory functions added in `bootstrap/runtimeAssemblies.ts` and `bootstrap/coordinatorFactories.ts`.

### Milestone 3 — Entity ID Canonicalization (Tier 0D Gate)
- Added `EntityManager.createEntityWithId(id, type, transform?)` that throws `DUPLICATE_ENTITY_ID` on collision.
- `DummyEnemySystem.createVisualEntity` now uses canonical ID `enemy_visual_${handle}` (deterministic from kernel handle).

### Milestone 4 — Memory & Idempotency Audit
- `DummyEnemySystem.dispose()` added: unsubscribes all 5 gameBus listeners, clears dummies/projectiles/debug markers, cancels hitstop timer.
- `_gameBusUnsubs` array stores unsubscribe functions from constructor; `dispose()` calls them all and clears the array.
- `SystemRegistry.replaceSystem()` confirmed to call `dispose()` before replacing — no changes needed.
- `HealthSystem` confirmed to have no gameBus subscriptions — no dispose needed.

### Final Cleanup — Horde Mode Init Path
- Fixed `'ffa'` hardcode in Horde mode initialization path: `MultiplayerRuntimeCoordinator.hostAutostartMultiplayer` now accepts `mode?` and forwards it to `hostRoom`.
- `createRuntimeUiCompositionCoordinator.ts` `onHostGame` now passes `mode: config.mode` from ServerBrowser selection.
- Both client and server compile clean (EXIT:0) after all changes.

## Remaining Work

- Run Tier0 browser validation (`window.__runTier0Tests()`) and record exact result (target: 19/19).
- Execute bootstrap memory/idempotency loop (3 hot-reloads) and record memory growth target `< 2MB`.
- Expand shared-contract extraction to network payloads/snapshot contracts in batches.
