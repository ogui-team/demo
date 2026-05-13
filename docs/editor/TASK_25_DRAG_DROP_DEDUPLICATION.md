# Task 25 - Drag Drop Deduplication

## Goal
Ensure one spawn-library drag/drop gesture creates exactly one entity.

## Problem
Dragging a prefab into the viewport currently spawns two objects.

There are at least two nearby ownership paths to inspect first:
- client/src/0-foundation/foundation/Engine.ts
- client/src/4-runtime/runtime/bootstrap/createRuntimeUiCompositionCoordinator.ts

Both paths currently participate in prefab drop handling.

## What To Do
1. Trace one drag/drop gesture end-to-end and confirm whether both handlers can finalize placement.
2. Pick one final spawn authority and remove the duplicate commit path.
3. Preserve drag-over behavior and drop-effect feedback while removing the extra spawn.
4. Ensure click-to-spawn from the library still works and is not affected.
5. Add a small regression guard if the control path is still easy to re-duplicate later.

## Cheap Validation
- Drag one prefab into the viewport and confirm exactly one entity appears.
- Repeat after exiting and re-entering the editor.

## Done When
- A single drop produces a single entity every time.
- No duplicate spawn happens from window-level plus viewport-level handlers.