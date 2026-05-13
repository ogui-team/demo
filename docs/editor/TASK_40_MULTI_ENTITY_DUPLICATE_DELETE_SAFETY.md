# Task 40 - Multi Entity Duplicate Delete Safety

## Goal
Make destructive and cloning actions safe when more than one entity is involved.

## Problem
Single-entity shortcuts do not automatically stay correct once multi-select, grouping, or hierarchy parents are involved.

## What To Do
1. Audit duplicate and delete operations for multi-selection order and stability.
2. Prevent partial deletes or inconsistent duplicate offsets.
3. Route mutating operations through undoable command boundaries where available.
4. Clear or re-home selection deterministically after the action.
5. Verify hierarchy and inspector stay coherent after bulk edits.

## Done When
- Multi-entity duplicate/delete works without leaving broken selection or stale UI.
- One user action maps to one coherent undoable operation.