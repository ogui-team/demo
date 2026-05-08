# Engine Architecture

This document maps the live v0.1.1 engine layout. It is aligned to the final audited runtime, not to earlier inline-bootstrap phases.

## Composition Layers

```text
client/src/index.ts
  -> bootstrapRuntime()
    -> Engine.ts
    -> ClientWorldRuntimeCoordinator
    -> MultiplayerRuntimeCoordinator
    -> EditorAuthorityCoordinator
    -> RuntimeOverlayCoordinator
    -> RuntimeAuxiliaryAssembly
```

### Entry Layer

- `client/src/index.ts` is the pure bootstrap entrypoint.
- It starts the runtime and owns no policy, replication classification, or long-lived composition logic.

### Engine Layer

- `Engine.ts` owns the stable engine-local services and engine-owned system registration.
- This layer provides the reusable core for editor, freeplay, and multiplayer orchestration.

### Runtime Layer

- `runtime/bootstrapClientRuntime.ts` assembles the live application runtime.
- It wires coordinators, overlays, multiplayer integration, diagnostics bridges, and mode-specific activation.

## Folder Map

```text
client/src/engine/
├── core/       shared engine services and state ownership
├── debug/      debug manager, diagnostics bindings, developer tools
├── game/       gameplay systems and runtime coordinators around actors and modes
├── network/    client networking, snapshot sync, replication helpers
├── reflection/ metadata and replicated-type support
├── runtime/    top-level runtime assembly and coordinator layer
├── systems/    world, gameplay, rendering, UI, and 2D runtime systems
├── ui/         overlay and menu surfaces
├── Engine.ts   engine-local composition root
└── *.ts        engine-owned top-level systems such as ModeManager and controllers
```

## Runtime Coordinators

### ClientWorldRuntimeCoordinator

- owns shared client world startup and teardown
- resolves active runtime player identity
- bootstraps freeplay runtime state
- owns local authoritative player bootstrap coordination

### MultiplayerRuntimeCoordinator

- owns hosted and joined session lifecycle wiring
- applies authoritative snapshot flow into the client runtime
- exposes multiplayer diagnostics and session-facing bridges

### EditorAuthorityCoordinator

- owns editor-facing authority and prefab-library sync
- coordinates editor snapshot capture and editor mutation bridges

### RuntimeOverlayCoordinator

- owns netgraph, scoreboard, server browser, issue inspector, and validation-hook activation
- keeps overlay and lazily loaded UI surfaces out of the entrypoint

### RuntimeAuxiliaryAssembly

- binds the coordinator layer to auxiliary gameplay, UI, and diagnostic systems
- centralizes shared bridges that are neither pure engine core nor standalone UI shell

## Integration Surfaces

### SystemContext

`SystemContext` is the primary shared access surface across the release baseline.

- 51 audited systems use `SystemContext`
- systems integrate through shared context rather than direct cross-system ownership

### EventBus

`EventBus` is the cross-system signal fabric.

- the current audit reports one residual EventBus-light system outside blocking issue status
- gameplay, networking, diagnostics, editor, and UI systems observe shared signals instead of maintaining duplicate state

### Replication Policies

The release baseline assigns an explicit replication policy to every audited system:

- authoritative
- consumer
- derived
- local-only

There are no undeclared systems in v0.1.1.

## Runtime Truth

The live baseline is defined by these rules:

1. world truth lives in systems, not in UI components
2. coordinators orchestrate mode behavior, but do not replace system-owned state
3. editor, freeplay, and multiplayer flows operate on the same runtime inventory
4. bootstrap remains intentionally thin so policy stays in the runtime assembly layer

## Release State

- audited systems: 65
- capability issues: 0
- direct-coupling violations: 0
- average health score: 98.28
- release gates: passing in both freeplay and representative multiplayer
