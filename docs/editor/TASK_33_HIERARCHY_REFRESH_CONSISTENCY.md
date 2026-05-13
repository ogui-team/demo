# Task 33 - Hierarchy Refresh Consistency

## Goal
Keep the hierarchy accurate during rapid editor changes.

## Problem
Hierarchy state can drift after spawn, delete, duplicate, reset, or editor/play transitions.

## What To Do
1. Audit the hierarchy refresh triggers for create, destroy, rename, duplicate, and runtime reset.
2. Remove stale rows when entities disappear.
3. Preserve row highlight for the current valid selection.
4. Clear selection cleanly when the selected entity no longer exists.
5. Ensure no duplicate row is introduced from repeated subscriptions.

## Done When
- The hierarchy reflects actual live editor entities.
- Selection highlight never points at a dead or duplicate row.