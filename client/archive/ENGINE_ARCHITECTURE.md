# Engine Architecture

## Release Baseline

This document describes the locked v0.1.2 runtime foundation after the stabilization and truth-alignment pass.

- audited systems: 67
- capability issues: 0
- direct-coupling violations: 0
- average health score: 98.33
- release performance gates: pass for both canonical archives `freeplay:release_freeplay` and `multiplayer:release_representative`

## Architectural Model

The client runtime is coordinator-based. The engine does not maintain separate freeplay, multiplayer, and editor data models; those modes operate over the same world state and system inventory.

The stable architectural split is:

- `src/index.ts`: pure bootstrap entrypoint that imports `bootstrapRuntime()` and starts the application. It owns no runtime policy, system inventory, or replication classification.
- `src/engine/Engine.ts`: engine-local composition root for stable core services and engine-owned systems.
- `src/engine/runtime/bootstrapRuntime.ts`: app/runtime composition layer that assembles coordinators, bridges, overlays, multiplayer wiring, and mode-specific policy.

## Coordinator Runtime Model

The runtime is assembled around five coordinator-layer units:

- `ClientWorldRuntimeCoordinator`: owns shared client world lifecycle, runtime player identity, local freeplay world bootstrapping, and local authoritative player bootstrap flow.
- `MultiplayerRuntimeCoordinator`: owns hosted/joined session wiring, authoritative snapshot application, multiplayer diagnostics, and the client-facing live session contract.
- `EditorAuthorityCoordinator`: owns editor-side authority bridges such as prefab-library sync, editor snapshot capture, and editor-facing world mutation control.
- `RuntimeOverlayCoordinator`: owns runtime overlays and lazily activated control surfaces such as scoreboard, issue inspector, server browser, validation hook, and netgraph bridges.
- `RuntimeAuxiliaryAssembly`: wires auxiliary systems and bridges that sit between the core engine and the coordinator layer, including gameplay, UI, diagnostics, and session-facing runtime helpers.

These coordinators sit above the engine core. They do not replace the core systems; they orchestrate how the same systems are activated and bridged in freeplay, multiplayer, and editor flows.

## Engine Core

The engine core remains the stable data and service layer shared by all runtime modes.

Primary core surfaces include:

- `Engine`: stable engine-owned composition root
- `EngineController`: application state transitions and lifecycle ownership
- `EntityManager`: entity lifecycle and reconstruction
- `StateManager`: shared runtime flags and engine state
- `InputManager`: DOM input ingestion into engine-owned routing
- `SaveLoadManager`: world persistence hooks and replayable state capture
- `UndoRedoSystem`: structural and transform history for authoring workflows
- `FeatureManagerClass`, `MetadataStore`, and `ReplaySystem`: shared/core support surfaces audited as part of the release baseline

## System Integration Model

### SystemContext

`SystemContext` is the primary integration surface for the audited runtime. In the release baseline:

- 53 systems use `SystemContext`
- context-driven access is the normal path for world, state, and engine service coordination
- systems are expected to integrate through shared runtime context instead of reaching across the graph with direct coupling

### EventBus

The runtime uses `EventBus` as the cross-system signal surface.

- EventBus coverage is complete across the audited system surface
- debug integration coverage is complete across the audited baseline
- UI, diagnostics, networking, gameplay, and editor flows observe shared signals rather than shadow state

### Replication Policy Model

Every audited system in v0.1.1 has an explicit replication classification:

- authoritative: 2
- consumer: 18
- derived: 19
- local-only: 28
- undeclared: 0

This model is descriptive of live runtime behavior. It does not imply that every audited system is a replicated network authority; it records how the system participates in the runtime contract.

## Runtime Modes

The coordinator layer activates the same underlying systems for three main operational shapes:

- freeplay: local runtime boot through `ClientWorldRuntimeCoordinator`
- representative multiplayer: client/server session boot through `MultiplayerRuntimeCoordinator`
- editor-authoring flow: editor authority and mutation bridges through `EditorAuthorityCoordinator`

Mode switches do not fork world truth. They change orchestration and surface area around the same engine state.

## Data Ownership

The baseline ownership rules are:

1. world state lives in engine systems, not in UI panels or coordinator-local mirrors
2. coordinators orchestrate mode behavior, but persistent state remains in the audited systems
3. editor, multiplayer, diagnostics, and overlays operate on shared engine state
4. index bootstrap remains intentionally thin so policy and lifecycle logic stay out of the entrypoint

## Ability → Movement Contract (FINAL)

The locked foundation keeps movement authority separate from gameplay ability execution.

Rules:

- `AbilitySystem` does not write player transforms or authoritative velocity directly.
- abilities may describe movement only through a controlled intent payload or a sustained status-movement modifier
- `NetworkSyncSystem` is the client-side movement authority consumer for local prediction/reconciliation
- `GameSession.processInput()` is the authoritative server-side movement consumer
- multiplayer ability movement must be derived from validated ability use or authoritative gameplay events, not from ad hoc client transform writes
- authoritative snapshots replicate transforms plus `statusMovementModifier`, not raw client-side movement overrides

Current flow:

1. input or gameplay code activates an ability through `AbilitySystem`
2. `AbilitySystem` may emit a lightweight movement intent for movement-flavored abilities
3. local non-network gameplay also derives sustained movement modifiers from active GAS statuses (`Rooted`, `Chilled`, `Electrocuted`) and forwards only the resulting modifier into `NetworkSyncSystem`
4. multiplayer derives one-shot movement intent plus any sustained status movement modifier from validated server-side state and returns the modifier through authoritative snapshots
5. movement merges one-shot intent and sustained status modifier inside the same movement step, then clears the one-shot intent after consumption
6. debug inspection resolves sustained modifier lanes in fixed order: authoritative snapshot, local derived modifier, then debug override

Constraints:

- no direct position writes from GAS to player entities
- no replication bypass around authoritative movement
- no persistent coordinator-local movement mirror
- no new per-frame allocation requirement in the movement hot path
- freeplay-only debug simulation must stay outside release/capture runtime paths and must not bypass movement authority

Extension template for future movement-flavored abilities:

1. classify the ability as one-shot movement (`dash`, `jump`, `double_jump`) or sustained movement modifier (`sprint`, `fly`, `hover`)
2. derive only sanitized movement intent from the ability layer
3. derive sustained status movement modifiers only from active/validated status state, never from direct transform edits
4. apply intent and sustained modifier only inside `NetworkSyncSystem` and `GameSession.processInput()`
5. clear one-shot intent immediately after consumption
6. for sustained effects, prefer authoritative state or deterministically re-derived input flags rather than ad hoc transform control

Recommended scalable intent shape:

```ts
interface MovementIntent {
	jumpRequested?: boolean;
	verticalImpulse?: number;
	directionalModifier?: { x: number; y: number; z: number };
	horizontalImpulse?: number;
	abilityFlags?: readonly string[];
}
```

In the current shipped correction only the minimal one-shot dash subset is active. Additional fields should be introduced only when a real ability requires them.

Live sustained modifier subset:

```ts
interface StatusMovementModifier {
	speedMultiplier?: number;
	blockMovement?: boolean;
	impulseOverride?: { x: number; y: number; z: number };
}
```

- `Rooted` maps to `blockMovement: true`
- `Chilled` maps to `speedMultiplier: 0.5`
- `Electrocuted` maps to `blockMovement: true` and may optionally supply a debug/test impulse override through the same movement step
- the freeplay/local validation hook is exposed through the status movement debug panel and developer console, while multiplayer simulation goes through a dev-gated gameplay command and still resolves on the server
- the F7 panel now shows every bound movement-authority player and surfaces replicated authoritative snapshot values alongside local derived/debug lanes; in active multiplayer, empty lanes normalize to `{}` for deterministic inspection output
- non-player world-object actors still bypass `NetworkSyncSystem` by design, so grunt/AI status-to-movement work belongs in the actor/world-object authority path rather than the player movement lane

## Debug Observability Contract

The multiplayer inspection layer builds a single per-frame debug snapshot in `RuntimeAuxiliaryAssembly` and treats that snapshot as the only debug truth source for the F7 panel, console output, and `window.statusMovementDebug` hook.

Per-player contract:

```ts
interface ResolvedDebugMovementState {
	playerId: string;
	authoritative: StatusMovementModifier;
	local: StatusMovementModifier;
	debug: StatusMovementModifier;
	resolved: StatusMovementModifier;
	movementDelta: number;
	hasMovementDelta: boolean;
	hasAuthoritative: boolean;
	hasLocal: boolean;
	hasDebug: boolean;
}
```

- every lane is always an object; empty state is represented as `{}` instead of `null`
- merge order is fixed: authoritative snapshot lane, then local/freeplay lane, then debug override lane, then resolved lane
- local player lane data comes from `NetworkSyncSystem`
- remote multiplayer player authoritative lane data comes from replicated snapshot consumption in `PlayerModelSystem`
- the F7 panel renders all active players and labels the lanes as `Authoritative Snapshot`, `Local Derived`, `Debug Override`, and `Resolved Output`
- every player card shows movement delta and a resolved status summary in addition to the individual lanes

## Movement Feel Layer

The movement feel layer is config-driven and intentionally separate from movement authority.

- `src/engine/network/MovementTuningConfig.ts` centralizes feel-facing movement parameters: acceleration, deceleration, max speed, air control, friction, jump impulse, and gravity scale.
- `NetworkSyncSystem` remains the single client-side movement authority consumer; it now resolves the feel config inside the existing movement step instead of introducing a parallel movement path.
- The F7 panel can apply live local feel overrides for speed multiplier, acceleration, friction, and floatiness.
- In multiplayer, feel overrides remain explicitly non-authoritative local preview only; server authority and snapshot contracts remain unchanged.
- Prepared hooks now exist for jump intent, sprint request, and air-control toggling without shipping a new locomotion feature set.

## Known Boundaries

- `NetworkSyncSystem` owns only the local player binding; remote replicated player status lanes must come from authoritative snapshot consumers such as `PlayerModelSystem`.
- The player movement contract does not cover AI or replicated world-object locomotion; those remain on the actor/world-object authority paths.
- Disconnect/session cleanup is enforced at coordinator boundaries (`SessionLifecycleCoordinator`, `GameLaunchCoordinator`, and `ClientWorldRuntimeCoordinator`) rather than by redesigning movement or GAS internals.
- The server browser intentionally reports a fallback `Default Server` entry with id `auto` when no hosted room is joinable; this is not boot-time auto-hosting.
- Feel tuning does not change `GameSession` authority, replication structure, or `NetworkSyncSystem` ownership.

## Release Validation Context

The documentation and runtime agree on these validated facts:

- the capability surface is clean at 67 systems
- runtime assembly is coordinator-based, not inline-only bootstrap glue
- `src/index.ts` is bootstrap-only and owns no policy
- release performance gates are passing with warm-up exclusion and evaluated windows applied in the generated performance budget
- scripted freeplay validation confirms the F7 contract, hidden-by-default scoreboard, TAB scoreboard reveal, and Escape menu path
- scripted 2-client multiplayer validation confirms zero null lanes, explicit labels, movement delta visibility, and rooted authoritative-state persistence on the observer
- scripted lifecycle validation confirms disconnect cleanup returns to the server browser and same-runtime freeplay without stale multiplayer residue

## Related Docs

- [src/engine/ARCHITECTURE.md](src/engine/ARCHITECTURE.md)
- [ENGINE_SYSTEMS_OVERVIEW.md](ENGINE_SYSTEMS_OVERVIEW.md)
- [../engine/reports/ENGINE_CAPABILITY_SUMMARY.md](../engine/reports/ENGINE_CAPABILITY_SUMMARY.md)
- [../engine/reports/ENGINE_PERFORMANCE_BUDGET.md](../engine/reports/ENGINE_PERFORMANCE_BUDGET.md)

---

## Player Initialization Contract (v0.1.2)

A player entity is **Active** only when all four phases are marked ready in `EntityManager`.
Until then, `NetworkSyncSystem` gates authority input commands; movement prediction
(`stepLocalInput`) is never gated.

### Phases

| Phase | Owner | Trigger |
|-------|-------|---------|
| `entity` | `ClientWorldRuntimeCoordinator.ensurePlayerRuntimeState()` | synchronous; called before any async work |
| `inventory` | `InventoryGridManager.init()` → `INVENTORY_READY` gameBus | after the REST fetch resolves |
| `abilities` | `ClientWorldRuntimeCoordinator.ensurePlayerRuntimeState()` | synchronous; same call as `entity` |
| `avatar` | `PlayerModelSystem.bindLocalPlayerEntity()` | after `rebuildLocalAvatarGroup()` completes |

### Event flow

```
ensurePlayerRuntimeState(playerId)
  └─ EntityManager.registerPlayerInit(playerId)          ← idempotent
  └─ marks: entity, abilities

initInventoryGrid(playerId)   ← exactly once per player (idempotency guard)
  └─ InventoryGridManager.init()
  └─ _fetchInventory()
  └─ gameBus.emit('INVENTORY_READY', { playerId, equippedWeapon, ... })

bootstrapClientRuntime.on('INVENTORY_READY')
  └─ weaponSystem.equip(playerId, equippedWeapon)
  └─ EntityManager.markPlayerPhaseReady(playerId, 'inventory')

bindLocalPlayerEntity(entity)
  └─ rebuildLocalAvatarGroup()
  └─ EntityManager.markPlayerPhaseReady(playerId, 'avatar')

EntityManager.markPlayerPhaseReady (final phase)
  └─ gameBus.emit('PLAYER_INIT_COMPLETE', { playerId })

bootstrapClientRuntime.on('PLAYER_INIT_COMPLETE')
  └─ networkSyncSystem.setPlayerInitReady(true)          ← commandSink gate opens
```

### Rules

- `initInventoryGrid()` must be called **exactly once** per player per session.
  `SessionLifecycleCoordinator` enforces this with an `inventoryInitiatedForPlayerId` guard
  cleared on disconnect and reset explicitly on respawn.
- `PlayerModelSystem.setLocalAppearance()` writes to `stateManager.set('player.{id}.appearance', ...)`
  so the Character Editor → PLAY transition always restores the correct appearance.
- `setLocalPlayerId()` reads from `stateManager.get('player.{id}.appearance')` before
  falling back to hardcoded defaults.
- `hardResetRuntimeState()` calls `EntityManager.clear()` which flushes all phase records;
  coordinators must call `registerPlayerInit()` again after a hard reset.
- The freeplay path (`authorityMode === 'local'`) does not gate `commandSink` (it is null),
  so freeplay is unaffected by this contract.

### Adding a new phase

1. Add the phase name to `PlayerInitPhase` in `EntityManager.ts`.
2. Add it to `PLAYER_INIT_REQUIRED_PHASES`.
3. Identify the system that owns the phase and call `markPlayerPhaseReady()` once it is done.
4. Document it in this table.

---

## Session Cleanup Contract (v0.1.2)

Governs how the engine returns to the **Lobby / Server Browser** state after any disconnect,
whether initiated by the local client or by the server closing the connection.

### Disconnect sources and reason codes

| Source | `reason` field | Trigger |
|---|---|---|
| `MultiplayerClient.disconnect()` | `disconnected_by_client` | Local code calls `disconnect()` (e.g. user clicks "Leave") |
| `ws.onclose` (server-initiated) | `connection_closed` | Server closes the socket or network drops |

Both paths emit `MultiplayerClient` event `'disconnected'`. Callers **must not**
silence the `'disconnected'` event by setting `ws.onclose = null` after cleanup —
doing so would bypass `SessionLifecycleCoordinator.handleDisconnected()`.

### Cleanup flow

```
MultiplayerClient.disconnect() or ws.onclose
  └── this.emit('disconnected', { reason })
        └── MultiplayerRuntimeCoordinator listener
              └── SessionLifecycleCoordinator.handleDisconnected()
                    ├── emitEngineReset('disconnect_cleanup', 'soft')
                    ├── stopInputSending / unbind controller
                    ├── resetNetworkSyncRuntime / clearRemotePlayers / clearReplicatedWorldObjects
                    ├── setRuntimePlayerId(null) / setAuthorityMode('local')
                    ├── clearPendingInputs / resetLocalPlayerBootstrap
                    ├── hideHud / setHudPlayerMode('hidden')
                    ├── transitionEngineState('lobby') — only if state ∈ {in_game, post_game, starting}
                    └── showServerBrowser()
```

### Rules

- **All** voluntary disconnects must call `MultiplayerClient.disconnect()` — never null the ws
  handlers and close the socket manually.
- `SessionLifecycleCoordinator.handleDisconnected()` is **idempotent**: calling it twice is safe.
- `prepareMultiplayerLobby()` may be called by external code after `disconnect()` for additional
  world teardown.  The redundant `hardResetRuntimeState()` call is harmless.
