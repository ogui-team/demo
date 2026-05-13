# Task 21 - Scene Serialization

## Goal
Implement a professional scene save and load pipeline.

## Why
Core infrastructure milestone for editor reliability and project persistence.

## Must Include
- deterministic serialization
- stable entity IDs
- prefab references
- dependency-safe loading
- versioning readiness

## Scope
- Define canonical scene format and deterministic ordering rules.
- Build safe loader with dependency-aware entity materialization.

## Implementation Steps
1. Define scene schema version and migration hooks.
2. Implement deterministic entity ordering for save output.
3. Ensure stable ID assignment and persistence strategy.
4. Serialize prefab references plus overrides.
5. Implement dependency-safe load phases:
- create entities
- attach components
- resolve references
6. Add integrity checks and error reporting during load.

## Integration Targets
- Prefab system
- editor placement metadata
- play mode isolation snapshots

## Done When
- Save output is stable for equivalent scene state.
- Load recreates scene without reference breakage.
- Schema can evolve with version migration path.
