# Task 30 - Placement Undo And Selection

## Goal
Make placed entities immediately editable and safely undoable.

## Problem
Placement is a mutation-heavy path and should leave the editor in a coherent post-drop state.

## What To Do
1. Ensure a successful drop selects the newly created entity or primary entity root.
2. Route placement through the editor undo/redo contract if that path already exists.
3. Avoid duplicate commands or extra history entries from one drop gesture.
4. Ensure inspector and hierarchy both reflect the new selection.
5. If preview entities are used, confirm they never enter undo history or saved scene state.

## Done When
- One successful placement yields one undoable create action.
- The new object is selected and editable immediately.