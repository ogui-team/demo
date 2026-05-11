# Authority Ownership Map

Phase A protected runtime authority is owned by `EngineController`.

## Protected-Key Freeze

The protected authority surface is frozen at exactly these five paths for Phase A and the Phase B entry gate:

- `engine.appState`
- `gameplay.active`
- `game.mode`
- `hud.visible`
- `ui.hud.mode`

This list must stay intentionally small. Expanding it is a contract change and must be done explicitly before the scanner or typed capability layer is widened.

| State path | Owner | Authoritative write path |
| --- | --- | --- |
| `engine.appState` | `EngineController` | `transition()` / `setAppState()` |
| `gameplay.active` | `EngineController` | `syncGameplayActivation()` |
| `game.mode` | `EngineController` | `setGameMode()` / `syncGameMode()` |
| `hud.visible` | `EngineController` | `setHudVisible()` / `syncHudVisibility()` |
| `ui.hud.mode` | `EngineController` | `setHudMode()` / `syncHudVisibility()` |

Read discipline after Phase A:

- Runtime/UI context decisions must resolve through `Engine.getAuthoritativeInputContext()`.
- Engine mode reads must resolve through `Engine.getEngineMode()` so controller truth wins after bootstrap.
- Runtime game-mode decisions must read controller-owned state (`game.mode`) rather than `engineGameModes.getActiveName()`.
- State-managed HUD bootstrap must not inject a local `playerMode` authority default.

## Allowed Authority Escalation Paths

External callers are allowed to request protected-state changes only through these controller-owned entrypoints:

- App-state escalation: `Engine.transitionAppState()` / `Engine.setAppState()` -> `EngineController.setAppState()`.
- Session lifecycle escalation: `createSessionLifecycleCoordinator.requestRuntimeAuthorityIntent(...)` -> `EngineController.requestSessionAuthorityIntent(...)`.
- Runtime game-mode escalation: runtime UI composition, game launch, debug UI, and developer console paths may call `EngineController.setGameMode(...)`.
- Runtime HUD escalation: loading-state and debug-authorized flows may call `EngineController.setHudMode(...)` and `EngineController.setHudVisible(...)`.

Controller-internal synchronization remains allowed only inside `EngineController`:

- `syncGameplayActivation()`
- `syncGameMode()`
- `syncHudVisibility()`
- `syncRuntimeMode()`

No other runtime coordinator, system, or bootstrap phase may mutate the frozen protected-key set directly.