# Engine Overview

This is the single root-level project overview. Detailed docs live in docs/, historical root markdown files live in archive/root-md/.

## Navigation

- Main docs index: docs/INDEX.md
- Getting started: docs/START_HERE.md
- Validation checklist snapshot: archive/root-md/2026-05-11/V0_3_1_VALIDATION_CHECKLIST.md
- SDK source of truth:
  - packages/shared-contracts/src/sdk/
  - client/src/4-runtime/runtime/
  - test/sdk/

## What The Engine Can Do

### Core Runtime Architecture

- Phased runtime bootstrap with lifecycle and cleanup guarantees.
- Idempotent phase execution and reload wiring support.
- Determinism shim integration for time/random/timers in runtime and SDK.

Primary files:
- client/src/4-runtime/runtime/bootstrapClientRuntime.ts
- client/src/4-runtime/runtime/bootstrap/phase1-core.ts
- client/src/4-runtime/runtime/bootstrap/phase3-gameplay.ts
- client/src/4-runtime/runtime/bootstrap/phase4-networking.ts
- client/src/4-runtime/runtime/bootstrap/phase5-ui.ts
- client/src/4-runtime/runtime/bootstrap/phase6CoordinatorWiring.ts

### Gameplay Systems

Created and wired gameplay systems include:

- physicsSystem
- healthSystem
- weaponSystem
- abilitySystem (GAS-oriented runtime)
- objectCreatorSystem
- prefabSystem
- spawnSystem
- characterActorSystem
- playerModelSystem
- menuIdentitySystem
- hordeSystem
- scriptedLevelSystem (optional by runtime mode)

Primary files:
- client/src/4-runtime/runtime/bootstrap/phase3-gameplay.ts
- client/src/4-runtime/runtime/bootstrap/systemRegistration.ts

### Networking and Authority

- multiplayerClient for live session transport and protocol diagnostics.
- collisionAuthoritySystem for authority-side conflict handling.
- worldObjectAuthorityService for replicated world-object ownership/sync.
- Snapshot/protocol diagnostics surfaced into runtime debug state.

Primary files:
- client/src/4-runtime/runtime/bootstrap/phase4-networking.ts
- client/src/4-runtime/runtime/bootstrap/systemRegistration.ts

### Rendering, 2D, Audio, VFX

- spriteAtlasSystem
- camera2DSystem
- spriteAnimationSystem
- tilemapSystem
- parallax2DSystem
- spriteRenderSystem
- ui2DSystem
- materialManager
- vfxSystem
- gameAudioManager
- audioSystem
- weaponPresentationSystem

Primary files:
- client/src/4-runtime/runtime/bootstrap/systemRegistration.ts

### UI and Inventory

- HUDSystem with mount/dispose lifecycle.
- InventorySystem with export/import hooks and defaults.
- UI runtime ownership tracking (listeners + root nodes) for clean teardown.

Primary files:
- client/src/4-runtime/runtime/bootstrap/phase5-ui.ts
- client/src/4-runtime/runtime/bootstrap/systemRegistration.ts

### Editor and Tooling

- Undo/Redo integration as runtime-registered editor system.
- Runtime debug manager and registry-backed metadata/state inspection.
- Scene serialization and editor authority coordination in runtime bootstrap.

Primary files:
- client/src/4-runtime/runtime/bootstrap/systemRegistration.ts
- client/src/4-runtime/runtime/bootstrapClientRuntime.ts

## Public SDK and Plugin Extensibility

### Public Contracts

Plugins consume a public SDK with:

- Plugin lifecycle contract (GamePlugin, PluginInitContext).
- Public system access (ISystemRegistry via PublicSystemRegistry).
- Public event access (IEventBus via PublicEventBus with whitelist/blacklist rules).
- Plugin registry lifecycle management (PluginRegistry).
- Service framework (IService, ServiceRegistry).

Primary files:
- packages/shared-contracts/src/sdk/plugin-contracts.ts
- packages/shared-contracts/src/sdk/services.ts
- client/src/1-kernel/core/PublicSystemRegistry.ts
- client/src/1-kernel/core/PublicEventBus.ts
- client/src/4-runtime/runtime/PluginRegistry.ts
- client/src/4-runtime/runtime/GameEngineSdk.ts

### Built-in SDK Services (Tier 2)

- settings service (deterministic options/state via StateManager paths).
- audio service (deterministic audio intents plus mute/volume state).

Primary files:
- client/src/4-runtime/runtime/SettingsPlugin.ts
- client/src/4-runtime/runtime/AudioPlugin.ts
- client/src/4-runtime/runtime/bootstrapClientRuntime.ts

## System Inventory (Category View)

Categories used in corridor metadata registration:

- Core
  - featureManager
- Networking
  - multiplayerClient
  - collisionAuthoritySystem
  - worldObjectAuthorityService
- Gameplay
  - gameModeManager
  - healthSystem
  - weaponSystem
  - abilitySystem
  - prefabSystem
  - spawnSystem
  - objectCreatorSystem
  - playerModelSystem
  - characterActorSystem
  - inventorySystem
  - adaptiveRuntime
  - hordeSystem
  - scriptedLevelSystem (optional)
- Simulation
  - physicsSystem
  - physics2DSystem
- Rendering
  - spriteAtlasSystem
  - camera2DSystem
  - spriteRenderSystem
  - spriteAnimationSystem
  - parallax2DSystem
  - materialManager
  - vfxSystem
  - weaponPresentationSystem
- Audio
  - gameAudioManager
  - audioSystem
- UI
  - ui2DSystem
  - hud
- World
  - tilemapSystem
- Editor
  - undoRedoSystem
- Debug
  - debugManager

Primary file:
- client/src/4-runtime/runtime/bootstrap/systemRegistration.ts

## Agent System Prompt Templates

Use these as short role profiles when configuring agents.

### 1) Runtime Bootstrap Agent

Purpose:
- Own phase bootstrap wiring, lifecycle safety, idempotency, and teardown correctness.

Scope:
- client/src/4-runtime/runtime/bootstrapClientRuntime.ts
- client/src/4-runtime/runtime/bootstrap/

Guardrails:
- Preserve phase boundaries.
- Ensure every new runtime-owned component is disposed.
- Avoid hidden side effects outside phase return contracts.

### 2) Gameplay Systems Agent

Purpose:
- Modify gameplay loop systems (weapon, health, ability, spawn, prefab, actor runtime) without breaking deterministic flow.

Scope:
- client/src/2-systems/gameplay/
- phase3-gameplay wiring and systemRegistration metadata

Guardrails:
- Respect authority boundaries.
- Keep system IDs stable.
- Keep save/load handlers aligned.

### 3) Multiplayer and Authority Agent

Purpose:
- Handle multiplayer protocol/client/session sync, collision/world-object authority, and replication diagnostics.

Scope:
- client/src/3-network/
- server/
- runtime networking phase + authority services

Guardrails:
- Never bypass authoritative state ownership rules.
- Preserve protocol compatibility and diagnostics.

### 4) SDK and Plugin Platform Agent

Purpose:
- Evolve public SDK contracts, plugin lifecycle, and service framework while preserving consumer compatibility.

Scope:
- packages/shared-contracts/src/sdk/
- client/src/1-kernel/core/PublicSystemRegistry.ts
- client/src/1-kernel/core/PublicEventBus.ts
- client/src/4-runtime/runtime/GameEngineSdk.ts
- client/src/4-runtime/runtime/PluginRegistry.ts
- test/sdk/

Guardrails:
- Public API first, no internal leakage.
- Enforce event/system safety boundaries.
- Keep external smoke tests green.

### 5) Rendering and Performance Agent

Purpose:
- Optimize render/audio/vfx/2D stack and build footprint while preserving visual correctness.

Scope:
- client/src/2-systems/gameplay/systems/2d/
- render pipeline and system registration
- webpack/build diagnostics

Guardrails:
- Do not break runtime phase contracts.
- Keep warnings and bundle changes documented.

### 6) Documentation and Validation Agent

Purpose:
- Maintain docs index/archives and validation status for release readiness.

Scope:
- docs/
- archive/root-md/
- validation checklists and release summaries

Guardrails:
- Root keeps one overview markdown file.
- Keep links valid after file moves.

## Archive Policy

- Root folder contains one high-level overview markdown file only.
- New or updated detailed docs go into docs/.
- Historic root markdown files move to archive/root-md/<date>/.