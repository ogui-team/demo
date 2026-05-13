# Task 23 - Editor Test Scene

## Goal
Create a permanent validation scene for editor regression testing.

## Why
Without a standard test scene, regressions are difficult to reproduce and compare.

## Must Include
- nested entities
- prefabs
- lights
- runtime entities
- stress cases
- serialization tests

## Scope
- Build one canonical scene fixture with broad feature coverage.
- Use it for manual QA and automated editor smoke checks.

## Implementation Steps
1. Define test scene composition matrix:
- hierarchy depth
- prefab nesting
- mixed component types
- high-entity-density zones
2. Add controlled runtime-only entities for boundary checks.
3. Add known stress cluster for selection and rendering tests.
4. Add save and load golden snapshot for serialization validation.
5. Add checklist of interaction tests tied to this scene.
6. Add basic automated boot-and-verify test target.

## Integration Targets
- scene serialization
- selection and gizmo systems
- prefab system
- performance overlay

## Done When
- Team can run a repeatable regression pass on one standard scene.
- Save/load diffs are deterministic and inspectable.
- Major editor interactions are verified against stress content.
