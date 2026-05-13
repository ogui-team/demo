# Editor Working Checkpoint - 2026-05-13

## Scope
Stable baseline for editor <-> play transitions, prefab component fidelity, collision visibility debugging, and map portability.

## Applied Fixes
- Restored world-buffer apply path to rebind scene root before runtime deserialize.
- Fixed component rehydrate path to support both wrapped and flat serialized component formats.
- Enabled collider/interactable/pickup restoration through play transitions.
- Updated play-exit flow to merge runtime world back into active editor buffer.
- Refreshed editor scene snapshot during runtime merge.
- Hardened scene clear to force-delete prefab leftovers if prefab-system remove leaves stale entities.
- Added runtime entity purge on editor restore for runtime-only player/debug entities.
- Disabled editor-side player marker materialization on world restore.
- Removed broken builtin plain wall entry from EditorMenu spawn entries.
- Added transparent red debug visualization for invisible entities.
- Added transparent red debug visualization for static network colliders.
- Adjusted camera fallback spawn to gravity-settled spawn position.

## Current Known-Good Behavior
- Player spawner path stable across repeated editor -> play -> editor cycles.
- Prefab collision + interaction components survive transition.
- Invisible colliders become visible as transparent red debug geometry.

## Editor JSON Import/Export
- Export: toolbar Export button or command palette Export Project.
- Import: toolbar Import button or command palette Import Project JSON.
- Import flow validates JSON via world payload validator, then runs Engine.importMap(json, name).

## Test Loop
1. Place prefabs in editor.
2. Enter play mode.
3. Move spawned entities.
4. Return to editor.
5. Repeat at least 3 cycles.
6. Verify no duplicate accumulation, no lingering runtime player model in editor.

## Quick Recovery Notes
- If any cycle regresses, compare behavior against this checkpoint and re-run typecheck.
- Baseline check command: npm run type-check
