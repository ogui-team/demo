# Engine Systems Overview

## Release Baseline

This inventory is aligned to the locked v0.1.2 foundation and current audit output.

- total audited systems: 67
- capability issues: 0
- direct-coupling violations: 0
- average health score: 98.33
- replication policies: authoritative=2, consumer=18, derived=19, local-only=28, undeclared=0

Naming in this document follows the audited registry exactly. Duplicate class names are disambiguated by scope where necessary.

## Core and Shared State

- `Engine`: stable engine-local composition root for engine-owned systems and services.
- `EngineController`: application lifecycle and engine state transitions.
- `EntityManager`: entity lifecycle, lookup, serialization, and reconstruction.
- `FeatureManagerClass`: shared feature-flag and capability support surface.
- `InputManager`: DOM input ingress into the runtime.
- `MetadataStore`: reflection metadata storage used by audited reflection pathways.
- `ReplaySystem`: deterministic event-recording support surface.
- `SaveLoadManager`: persistence hooks and world-state import/export.
- `ScriptingSystem`: script registration/runtime support surface present in the audited baseline.
- `StateManager`: shared runtime flags and engine state.
- `UndoRedoSystem`: authoring-safe structural and transform history.

## Editor and Authoring

- `EditorController`: editor camera and editor-mode control layer.
- `GizmoSystem`: transform gizmos and commit payload generation.
- `HighlightSystem`: editor-adjacent highlight surface retained in the audited capability set.
- `ModeManager`: editor versus play-mode switching.
- `SelectionSystem`: editor-safe picking and active selection control.

## Gameplay and Actor Runtime

- `AbilitySystem`: gameplay ability execution and replicated ability-facing state derivation.
- `CharacterActorSystem`: client actor runtime for local NPC and actor presentation.
- `CombatSystem`: audited combat capability surface retained as an unbound runtime entry in v0.1.1.
- `EffectSystem`: gameplay effect and attribute application support.
- `GameAudioManager`: gameplay-driven audio orchestration.
- `GameModeManager`: player-facing game-mode coordination.
- `GameModeSystem`: engine-level mode registration and activation.
- `HealthSystem`: runtime health and damage state consumer.
- `Input2DAdapterSystem`: gameplay input bridge for the 2D corridor stack.
- `InteractionManager`: interaction arbitration across gameplay surfaces.
- `InventorySystem`: client inventory runtime consumer.
- `ItemInstanceSystem`: gameplay item-instance support surface.
- `PhysGunSystem`: physics-grab and manipulation gameplay system.
- `Physics2DSystem`: 2D gameplay physics/runtime support.
- `PhysicsSystem`: 3D gameplay/world physics support.
- `PickupSystem`: pickup resolution and inventory-facing gameplay events.
- `PlayController`: local gameplay control and camera-driving layer.
- `PlayerModelSystem`: local and remote player model presentation.
- `SpriteAnimationSystem`: 2D runtime animation controller.
- `WeaponPresentationSystem`: visual weapon presentation and synchronization layer.
- `WeaponSystem`: weapon inventory, firing, and gameplay consumption path.

## World and Content Systems

- `MaterialManager`: runtime material registration and content-facing material state.
- `ObjectCreatorSystem`: world-object creation and placement entrypoint.
- `PathfindingSystem`: audited world/pathing capability surface retained as unbound in v0.1.1.
- `PrefabSystem`: prefab registry, validation, and instantiation.
- `ResourceManager`: asset/resource lifetime and loading support.
- `ScriptedLevelSystem`: scripted level bootstrapping and event-driven world orchestration.
- `SpatialPartitionSystem`: world partitioning and runtime neighborhood queries.
- `SpawnSystem`: shared spawn-point registration and selection.
- `SpritePrefabExtension`: prefab extension surface for sprite/tilemap/UI prefab routing.
- `TilemapSystem`: 2D tilemap world support in the corridor stack.

## Rendering and Presentation

- `Camera2DSystem`: 2D camera support for the corridor runtime.
- `CullingSystem`: visibility pruning and culling diagnostics.
- `ParallaxSystem`: 2D parallax presentation layer.
- `PS1ShaderSystem`: audited shader capability surface retained as unbound in v0.1.1.
- `SpriteAtlasSystem`: 2D sprite atlas management.
- `SpriteRenderSystem`: 2D sprite rendering path.

## Networking and Replication

- `CollisionAuthoritySystem (client)`: client-side collision authority consumer for shared map collision rules.
- `CollisionAuthoritySystem (server)`: authoritative server-side collision validation.
- `InventoryManager (server)`: authoritative inventory state manager.
- `LobbyManager`: lobby/session metadata consumer.
- `MultiplayerClient`: WebSocket client and multiplayer message ingress.
- `NetworkManager`: entity/network state bridge.
- `NetworkSyncSystem`: authoritative snapshot ingestion, reconciliation, and runtime sync.
- `ReplicationSystem`: replicated-entity serialization and change tracking support.
- `WorldObjectAuthorityService`: client-side authority bridge for replicated world-object spawn, update, remove, and placement sync.

## UI and Diagnostics

- `DebugManager`: debug registration and live debug-surface control.
- `HUDSystem`: runtime HUD presentation.
- `InventoryGridManager`: grid-inventory UI management.
- `ToolbarSystem`: runtime/editor toolbar surface.
- `UI2DSystem`: in-engine 2D UI rendering support.

## Integration Rules

The audited baseline follows these integration rules:

1. `SystemContext` is the normal integration surface for shared runtime state.
2. `EventBus` is the normal cross-system signal surface.
3. Replication policy is explicit for every audited system.
4. Coordinator orchestration does not replace system-owned state.
5. The overview above reflects the audited capability registry exactly for v0.1.1.

## Ability → Movement Contract (FINAL)

The movement/ability ownership split for the v0.1.2 foundation is:

- `AbilitySystem`: resolves activation, costs, effects, cooldowns, and optional movement intent description.
- `RuntimeAuxiliaryAssembly`: bridges local gameplay ability movement intent into the existing movement authority path, derives sustained freeplay status modifiers from active GAS effects, and owns the debug/test bridge without moving entities itself.
- `MultiplayerRuntimeCoordinator`: consumes authoritative ability movement payloads for the local player and forwards them into movement authority.
- `NetworkSyncSystem`: applies and clears one-shot movement intent plus sustained status movement modifiers during the same movement step that handles input, reconciliation, and collision resolution.
- `GameSession`: derives authoritative movement intent from validated ability use, derives sustained movement modifiers from authoritative status state, and applies both inside the authoritative movement step.

Rules:

1. ability code must not set player position directly.
2. ability code must not mutate authoritative player velocity outside the movement step.
3. movement intent is one-shot and must be cleared after consumption.
4. sustained status movement modifiers must be re-derived from active/validated status state and not cached in UI-only layers.
5. multiplayer ability movement is authoritative on the server and not trusted from client magnitude values.
6. debug visualization resolves sustained modifier lanes in deterministic order: snapshot-authoritative, local derived, then debug override.
7. authoritative snapshots replicate transforms plus `statusMovementModifier`, not raw client-authored transform or velocity overrides.

Reusable integration steps for future abilities:

1. add the ability template in GAS without embedding transform writes.
2. emit a lightweight movement intent from `AbilitySystem` only if the ability is movement-flavored.
3. bridge local-only use through `RuntimeAuxiliaryAssembly` and authoritative multiplayer use through `MultiplayerRuntimeCoordinator`.
4. derive any sustained movement modifier from status/effect truth rather than from the ability callback itself.
5. consume the intent and modifier inside `NetworkSyncSystem.applyInput()` and `GameSession.processInput()`.
6. clear one-shot intent after use and clear any pending state on join, respawn, or authority rebinding.

Current scope notes:

- `ability_shield_dash` remains the only one-shot player movement ability currently wired into the contract.
- `Rooted`, `Chilled`, and `Electrocuted` now constrain locomotion through the same authoritative movement step instead of remaining metadata-only GAS effects.
- local freeplay derives those modifiers from the active `EffectSystem`; multiplayer consumes the authoritative server result replicated through snapshots.
- the dev-only status movement debug panel and console commands can force those modifiers for validation, while optional multiplayer simulation still routes through a server command and authoritative snapshots.
- the F7 panel now renders all active movement-authority bindings so multiplayer validation can inspect replicated snapshot modifiers alongside local freeplay/debug lanes instead of only the local player view.
- current real server-side status producers are the instant AoE/hitscan abilities already resolvable by `GameSession`; projectile-driven chilled application still needs future projectile-effect authority if it must originate from live multiplayer combat rather than the debug hook.
- grunt and AI world-object movement still bypass `NetworkSyncSystem`: local client grunts move inside `CharacterActorSystem`, and server authoritative actors move inside `AuthoritativeActorRuntime`. Status modifier consumption for those actors therefore needs a separate actor-authority contract.

## Debug Observability Contract

The debug/inspection path is now intentionally separate from gameplay logic:

- `RuntimeAuxiliaryAssembly` builds one normalized debug snapshot per frame for all active players.
- `NetworkSyncSystem` provides authoritative/local/debug lane data for the bound local player.
- `PlayerModelSystem` exposes the latest replicated `statusMovementModifier` for remote players seen in authoritative snapshots.
- the merged debug contract normalizes every lane to an object and adds `hasAuthoritative`, `hasLocal`, and `hasDebug` flags so the UI never has to guess whether `{}` means "missing" or "inactive".
- `StatusMovementDebugPanel` renders the normalized contract directly and does not perform null/undefined repair itself.
- every player card shows explicit lane labels, movement delta, and resolved status summary.
- sparse authoritative snapshots preserve prior remote `statusMovementModifier` state unless the property is explicitly present in the incoming payload.

## Movement Feel Layer

- `MovementTuningConfig.ts` centralizes feel-facing movement config for the live movement step: acceleration, deceleration, max speed, air control, friction, jump impulse, and gravity scale.
- `NetworkSyncSystem` consumes that config inside the existing authoritative-local movement step, so feel tuning does not create a second controller or alternate prediction path.
- The F7 panel now exposes live feel sliders for speed multiplier, acceleration, friction, and floatiness.
- Multiplayer feel tuning is local-only debug preview and must not be interpreted as server authority.
- Prepared hooks now exist for jump request consumption, sprint request plumbing, and air-control toggling without expanding the shipped ability set.

## Known Boundaries

- `NetworkSyncSystem` only owns the local player binding; remote authoritative lanes must come from `PlayerModelSystem` or another snapshot consumer.
- Disconnect and launch cleanup intentionally happen at coordinator boundaries instead of inside movement, GAS, or replication systems.
- The `/servers` API intentionally returns a fallback `Default Server` entry when no joinable room exists, so a non-empty server list is not proof of auto-hosting.
- AI/grunt and replicated world-object movement still live outside the player movement contract.
- Feel tuning remains an iteration layer over the existing movement step and does not modify replication ownership or `GameSession` authority.

This keeps multiplayer debug truth trustworthy without changing movement, GAS, or snapshot contracts.