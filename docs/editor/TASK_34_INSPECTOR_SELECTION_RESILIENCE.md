# Task 34 - Inspector Selection Resilience

## Goal
Keep the inspector coherent through rapid selection churn.

## Problem
The inspector is vulnerable to stale renders when selection changes, entities are deleted, or editor mode flips quickly.

## What To Do
1. Audit inspector update triggers for select, deselect, delete, duplicate, and runtime reset.
2. Clear component UI when the selected entity becomes invalid.
3. Prevent stale async or event-driven updates from repainting dead selection data.
4. Keep transform inputs and component sections in sync with the latest valid selection only.
5. Verify the inspector survives editor rebuild/re-entry without leaking listeners.

## Done When
- Inspector content always matches the current valid selection.
- Deleted or replaced entities do not leave orphaned UI behind.