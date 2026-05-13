# Task 29 - Viewport Hover Preview

## Goal
Provide stable in-viewport hover feedback while dragging a prefab.

## Problem
Even with a drag session, placement still feels vague without a world-space hover target.

## What To Do
1. Project the current pointer into world space during drag-over.
2. Show the preview at the projected point on the placement plane or nearest valid target surface.
3. Keep updates smooth and deterministic frame-to-frame.
4. Distinguish invalid targets from valid ones with a small visual change.
5. Preserve a safe fallback position if projection data is unavailable.

## Done When
- The user can see where the prefab will land before dropping.
- Invalid or uncertain targets are visibly different from valid placement.