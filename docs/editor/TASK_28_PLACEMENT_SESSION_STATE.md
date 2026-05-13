# Task 28 - Placement Session State

## Goal
Formalize the lifecycle of a prefab placement drag.

## Why
Without explicit session state, preview cleanup, drag cancel, and play-mode transitions are easy to break.

## What To Do
1. Introduce a placement session model with states such as idle, previewing, committing, and cancelled.
2. Store the active prefab id, projected position, and any preview handles in one place.
3. Expose begin, update, commit, and cancel operations.
4. Guarantee cleanup on dragend, escape/cancel, editor teardown, and runtime reset.
5. Make it safe to start a second placement only after the first session fully releases.

## Done When
- Placement lifecycle is explicit instead of spread across ad-hoc flags.
- Preview and drop cleanup are deterministic.