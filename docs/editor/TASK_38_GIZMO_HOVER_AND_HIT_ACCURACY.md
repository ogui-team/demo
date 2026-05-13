# Task 38 - Gizmo Hover And Hit Accuracy

## Goal
Improve gizmo affordances and hit confidence.

## Problem
Transform tools feel worse when hover state is unclear or hit testing is too brittle near thin handles.

## What To Do
1. Audit gizmo hover feedback and active-axis highlighting.
2. Tighten hit rules so intended axis picks win more often.
3. Ensure gizmo hits do not leak through to entity selection beneath.
4. Add small visual affordances for hover and active-drag states.
5. Keep changes compatible with the shared viewport raycast path.

## Done When
- Gizmo handles are easier to target.
- Hover and active axis states are obvious before and during drag.