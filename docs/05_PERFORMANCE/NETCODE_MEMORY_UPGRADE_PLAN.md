# Netcode + Memory Upgrade Plan

## Current integration points

- `client/src/engine/Engine.ts` remains the bootstrap owner and now instantiates the new systems.
- `client/src/engine/core/EngineController.ts` remains the single per-frame orchestrator.
- `client/src/engine/network/NetworkManager.ts` is extended, not replaced, and now carries input, snapshot, lag-comp, and ability-validation channels.
- `client/src/engine/core/EntityManager.ts` remains the lifecycle source of truth.

## New systems

- `client/src/engine/network/NetworkSyncSystem.ts`
  - Client prediction hook for local input.
  - Authoritative snapshot generation and reconciliation.
  - Short transform history buffer for lag-compensated hitscan validation.
  - Ability activation request/validation path.
- `client/src/engine/network/ReplicationSystem.ts`
  - Reflection-driven replicated field capture using `@Replicated()`.
  - Delta-only entity snapshot generation.
  - Snapshot application back onto bound runtime objects.
- `client/src/engine/systems/SpatialPartitionSystem.ts`
  - Extensible grid partition.
  - Nearby/relevance queries.
  - Inactive/unused entity queries for later GC policies.
- `client/src/engine/systems/ResourceManager.ts`
  - Lazy asset loading.
  - Reference counting.
  - Distance-based streaming sources.
  - Throttled unload to avoid frame spikes.

## Example movement flow

1. Input is collected in app code or input systems.
2. App calls `NetworkSyncSystem.queueLocalInput(...)`.
3. Input is applied immediately to the local bound entity.
4. Input command is sent through `NetworkManager.sendInputCommand(...)`.
5. Local authority mode or a future dedicated server processes that input.
6. `ReplicationSystem` emits snapshot deltas.
7. `NetworkSyncSystem` receives authoritative snapshots and replays pending inputs after `ackInputSeq`.

## Example hitscan lag-comp flow

1. Client requests a hitscan validation using `NetworkSyncSystem.requestHitscanValidation(...)`.
2. The authoritative side searches the short history buffer for the closest snapshot frame.
3. The ray is tested against the rewound entity positions.
4. The authoritative hit result is returned and emitted through the event bus.

## Remaining rollout work

- Hook the live server in `server/src/gameSession.ts` into the same snapshot and rewind contract used by `NetworkSyncSystem`.
- Route real GAS ability activation through `abilityActivationRequested` before the cast occurs locally.
- Register streaming sources for real levels/prefabs so `ResourceManager` can load and unload content automatically.
- Use `SpatialPartitionSystem` directly in renderer and physics query hot paths for large-world scaling.
