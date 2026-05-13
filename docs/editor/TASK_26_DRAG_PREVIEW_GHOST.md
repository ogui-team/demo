# Task 26 - Drag Preview Ghost

## Goal
Show a visible preview before placement commits.

## Problem
The user cannot see the object while dragging, so placement feels blind until drop.

## What To Do
1. Introduce a lightweight preview state for spawn-library drags.
2. Render either:
   - a viewport ghost mesh at the projected placement point, or
   - a combined HTML plus viewport preview if both are cheap and stable.
3. Make the preview clearly non-committed using transparency, outline, tint, or wireframe.
4. Ensure the preview disappears on drag end, drop complete, editor exit, and play-mode transition.
5. Reuse existing prefab metadata where possible instead of inventing a second preview registry.

## Notes
- This task is about pre-drop visibility, not the final spawn.
- Favor low-overhead visuals over perfect fidelity.

## Done When
- Dragging a prefab shows where it is about to land before release.
- The preview never persists after the gesture ends.