# Task 42 - Dirty State And Save Prompts

## Goal
Track unsaved editor changes and warn before risky exits.

## Problem
Once the editor supports more real edits, silent loss from refresh, play transition bugs, or manual navigation becomes too expensive.

## What To Do
1. Define when the scene becomes dirty and when it is considered clean again.
2. Mark dirty state from create, delete, duplicate, transform, and inspector edits.
3. Exclude transient preview or runtime-only mutations.
4. Add prompts or UI affordances for unsaved changes where appropriate.
5. Ensure play mode itself does not falsely clear dirty state.

## Done When
- The editor accurately reflects when there are unsaved changes.
- Risky exits no longer discard work silently.