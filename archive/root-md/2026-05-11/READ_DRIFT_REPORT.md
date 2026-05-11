# Read Drift Report

Resolved read drift:

- `Engine.ts` runtime lifecycle and exported engine-mode helpers now resolve through controller-owned mode truth.
- `MainMenu`, `ServerBrowser`, `InGameModePanel`, and `DebugManager` now restore input context through `Engine.getAuthoritativeInputContext()`.
- `bootstrapClientRuntime` freeplay loadout resolution now reads controller-owned `game.mode` state.
- `RuntimeAuxiliaryAssembly` Horde restart logic now reads controller-owned `game.mode` state.

Allowed read pattern after Phase A:

- Runtime systems may observe controller-owned state through `StateManager.getRaw()` for protected paths.
- Runtime systems may not infer authority from `ModeManager` or `engineGameModes.getActiveName()` on runtime surfaces.

Current scanner expectation:

- No runtime-surface `modeManager.isPlayMode()` or `modeManager.isEditorMode()` reads.
- No runtime-surface `engineGameModes.getActiveName()` reads.
- No state-managed HUD bootstrap with a local `playerMode` override.