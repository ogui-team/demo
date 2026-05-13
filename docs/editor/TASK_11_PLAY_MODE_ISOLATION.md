# Task 11 - Play Mode Isolation

## Goal
Separate editor world state from runtime simulation state.

## Why
This is a major milestone from basic tooling to real editor architecture.

## Must Include
- temporary runtime clone world
- restore-on-exit
- deterministic simulation boundary
- editor-safe rollback
- editor/runtime ownership separation

## Scope
- Treat play mode as a sandbox runtime session derived from editor state.
- Never let runtime mutations silently contaminate editor source world.

## Implementation Steps
1. Define editor world snapshot boundary format.
2. Build runtime clone creation path from editor snapshot.
3. Run play simulation only inside clone world ownership context.
4. On play exit, dispose clone and restore editor authority state.
5. Add explicit opt-in path for applying play results back to editor later.
6. Add deterministic reset hooks for lifecycle orchestrator and systems.

## Integration Targets
- EngineController mode transitions
- world runtime reset path
- scene serialization primitives

## Done When
- Entering play creates isolated simulation state.
- Exiting play restores editor world predictably.
- Runtime-only state cannot leak into editor by accident.
