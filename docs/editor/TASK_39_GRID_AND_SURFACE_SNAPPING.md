# Task 39 - Grid And Surface Snapping

## Goal
Add reliable snapping for placement and transforms.

## Why
Editor quality improves sharply once placement can be made intentional instead of approximate.

## What To Do
1. Add grid snapping hooks for placement preview and transform commits.
2. Add optional surface/ground snapping where the control path already supports raycast results.
3. Keep snap rules explicit and easy to toggle.
4. Ensure snapped preview and snapped final placement match.
5. Avoid hidden floating-point drift across repeated edits.

## Done When
- Snapping produces predictable, repeatable results.
- The preview and the committed transform agree.