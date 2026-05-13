# Task 27 - Drop Router Consolidation

## Goal
Collapse prefab drop handling into one explicit control path.

## Problem
Drop ownership is split across window-level and runtime-UI wiring, which makes duplicate spawns and future regressions likely.

## What To Do
1. Identify the best single owner for drag-over, hover projection, and drop commit.
2. Move final placement responsibility into that owner.
3. Convert other listeners into delegation-only or remove them.
4. Document the ownership boundary in code with one short comment at the router entry point.
5. Keep the path compatible with future preview, snapping, undo, and browser tests.

## Integration Targets
- Engine.ts global drag/drop hooks
- createRuntimeUiCompositionCoordinator.ts viewport drop hooks
- InspectorPanel drag metadata

## Done When
- There is one obvious place where a drop becomes a spawn.
- Nearby code no longer hides duplicate ownership.